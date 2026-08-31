import { neon } from '@neondatabase/serverless'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { ScriptSchema, type Script } from '../src/core/types.js'
import * as schema from '../src/db/schema.js'

// The endpoints that have to be reachable from a phone: capture, and reading
// back what capture produced.
//
// /ingest deliberately does NOT run processSource inline. Extraction and
// analysis take about a minute, and generation takes minutes and shells out to
// ffmpeg; neither belongs in this bundle (which must stay free of the 78 MB
// ffmpeg and the whole audio pipeline). A saved link must be recorded in a few
// hundred milliseconds and never lost.
//
// The durable work is handed to Trigger.dev instead, over its plain HTTP API:
// the SDK needs Node and this function runs on Edge, but a trigger is one
// authenticated fetch. Everything is gated on TRIGGER_SECRET_KEY so the
// laptop-only mode (batch drain on the machine) keeps working unchanged when
// the cloud is not wired up.
//
// Neon over HTTP rather than the node-postgres pool the jobs use: a serverless
// invocation cannot keep a pool alive between requests, and doing so exhausted
// the connection limit and timed the function out in production.
//
// Edge runtime, not Node: under the Node adapter every request that read its
// body hung until the 25s gateway timeout, because Vercel has already consumed
// the raw stream by the time Hono rebuilds a Request from it. On Edge, Hono gets
// the platform Request directly and the Neon HTTP driver works unchanged.

export const config = { runtime: 'edge' }

const { episodes, sources, stories, users } = schema

type Conn = ReturnType<typeof db>
type Env = { Variables: { userId: string; conn: Conn } }

// A malformed id reaching a uuid column is a driver error, not an empty result,
// so it is rejected here. Case-insensitive: this guard exists to keep garbage
// away from Postgres, not to enforce the lowercase rendering Postgres prints.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const IngestSchema = z.union([
  z.object({ url: z.string().url() }),
  z.object({ text: z.string().min(1) }),
  z.object({ html: z.string().min(1), subject: z.string().optional() }),
])

const EpisodeRequestSchema = z.object({
  target_min: z.number().int().min(1).max(60).optional(),
})

// Every status generateEpisode moves through before landing on ready or failed.
// While one of these is live, a second generation would burn real model and TTS
// money on a briefing nobody asked for twice, so POST /episodes refuses.
const ACTIVE_EPISODE_STATUSES = [
  'queued',
  'selecting',
  'outlining',
  'writing',
  'grounding',
  'editing',
  'tts',
  'assembling',
]

// Trigger.dev answers a trigger with the run it created; the id is all we keep.
const TriggerAckSchema = z.object({ id: z.string().min(1) })

// Hands a payload to a deployed Trigger.dev task over the plain HTTP API and
// returns the run id. Throws with the response text on any failure: callers
// decide whether that is fatal (/episodes) or merely logged (/ingest).
async function triggerTask(taskId: string, payload: Record<string, unknown>, idempotencyKey?: string): Promise<string> {
  const key = process.env.TRIGGER_SECRET_KEY
  if (!key) throw new Error('Missing env var TRIGGER_SECRET_KEY')
  const res = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, ...(idempotencyKey ? { options: { idempotencyKey } } : {}) }),
    // A hung trigger call must fail here, not at the gateway's 25s: past this
    // point the caller cannot tell whether the run was accepted.
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`trigger of ${taskId} answered ${res.status}: ${text}`)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`trigger of ${taskId} answered ${res.status} with a non-JSON body: ${text}`)
  }
  const ack = TriggerAckSchema.safeParse(body)
  if (!ack.success) throw new Error(`trigger of ${taskId} answered without a run id: ${text}`)
  return ack.data.id
}

function db() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Missing env var DATABASE_URL')
  return drizzle(neon(url), { schema })
}

// The analyzer rarely fills `publisher`; the domain is what a reader recognizes.
function publisherOf(publisher: string | null, url: string | null): string | null {
  if (publisher) return publisher
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

// Built from the bucket's public base rather than read from episodes.audio_url:
// rows written before R2 existed still carry a localhost enclosure there.
function audioUrl(base: string, episodeId: string): string {
  return `${base.replace(/\/+$/, '')}/episodes/${episodeId}/episode.mp3`
}

// A queued or failed episode has no mp3, so it gets no url: a link that 404s in
// a player is worse than an episode that plainly says it is not ready.
function readyAudioUrl(base: string, status: string, episodeId: string): string | null {
  return status === 'ready' ? audioUrl(base, episodeId) : null
}

function chaptersOf(script: unknown): Script['chapters'] {
  const parsed = ScriptSchema.safeParse(script)
  return parsed.success ? parsed.data.chapters : []
}

const app = new Hono<Env>()

app.get('/health', (c) => c.json({ ok: true }))

// Registered before the authed sub-app is mounted: mounting at '/' installs the
// bearer check on '/*', which would otherwise also cover /health.
const authed = new Hono<Env>()

authed.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'missing bearer token' }, 401)
  const conn = db()
  const [user] = await conn.select({ id: users.id }).from(users).where(eq(users.apiToken, token))
  if (!user) return c.json({ error: 'invalid token' }, 401)
  c.set('conn', conn)
  c.set('userId', user.id)
  await next()
})

authed.post('/ingest', async (c) => {
  const parsed = IngestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'expected { url } | { text } | { html, subject }' }, 400)
  }

  const body = parsed.data
  const type = 'url' in body ? 'web' : 'html' in body ? 'email' : 'text'
  const [row] = await c
    .get('conn')
    .insert(sources)
    .values({
      userId: c.get('userId'),
      type,
      url: 'url' in body ? body.url : null,
      raw: 'url' in body ? null : body,
      // The real hash is computed from the extracted text; until then this only
      // has to be unique, since (user_id, source_hash) is a unique index.
      sourceHash: `pending-${crypto.randomUUID()}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)

  // Hand extraction to the cloud when it is wired up. A trigger failure is
  // logged, not returned: the source is already stored as received, which is
  // exactly what the laptop drain picks up, so nothing is lost. `queued` tells
  // the app whether the cloud took the job or the next batch run will.
  let queued = false
  if (process.env.TRIGGER_SECRET_KEY) {
    try {
      await triggerTask('process-source', { sourceId: row.id })
      queued = true
    } catch (err) {
      console.error('process-source trigger failed', row.id, err)
    }
  }
  return c.json({ source_id: row.id, status: 'received', queued }, 202)
})

authed.post('/episodes', async (c) => {
  if (!process.env.TRIGGER_SECRET_KEY) {
    return c.json(
      { error: 'La génération n’est pas encore reliée au cloud : elle se lance depuis l’ordinateur pour le moment.' },
      503,
    )
  }

  // A missing body means "use my defaults", so it parses as {}.
  const parsed = EpisodeRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'expected { target_min?: 1..60 }' }, 400)

  const conn = c.get('conn')
  const userId = c.get('userId')

  const [user] = await conn
    .select({ targetMinutes: users.targetMinutes, outputLanguage: users.outputLanguage })
    .from(users)
    .where(eq(users.id, userId))
  if (!user) return c.json({ error: 'internal error' }, 500)

  // An active row only blocks while its run can still be alive: maxDuration is
  // 900s, so anything older than 30 minutes died without reaching its catch
  // (worker crash, misconfigured env). Left alone it would 409 forever.
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000)
  const actives = await conn
    .select({ id: episodes.id, status: episodes.status, createdAt: episodes.createdAt })
    .from(episodes)
    .where(and(eq(episodes.userId, userId), inArray(episodes.status, ACTIVE_EPISODE_STATUSES)))
  const live = actives.find((a) => a.createdAt > staleBefore)
  if (live) {
    return c.json(
      { error: `Un épisode est déjà en préparation (statut : ${live.status}). Attendez qu’il se termine avant d’en lancer un autre.` },
      409,
    )
  }
  for (const stale of actives) {
    await conn
      .update(episodes)
      .set({ status: 'failed', failedStage: stale.status, error: 'Génération interrompue sans se terminer (délai de 30 minutes dépassé).' })
      .where(and(eq(episodes.id, stale.id), inArray(episodes.status, ACTIVE_EPISODE_STATUSES)))
  }

  // users.target_minutes is written outside this route, so it gets the same
  // bounds as the request body rather than being trusted.
  const targetMin = Math.min(60, Math.max(1, parsed.data.target_min ?? user.targetMinutes))
  const targetSec = targetMin * 60
  const [row] = await conn
    .insert(episodes)
    .values({ userId, targetSec, status: 'queued' })
    .returning({ id: episodes.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)

  try {
    await triggerTask(
      'generate-episode',
      { episodeId: row.id, userId, targetSec, language: user.outputLanguage },
      // Keyed on the row: if the ack was lost but the run was accepted, a retry
      // reuses it instead of paying writer and TTS twice.
      `episode-${row.id}`,
    )
  } catch (err) {
    // Unlike /ingest, nothing else will ever pick this row up: a queued episode
    // nobody will run is a lie, so it is marked failed with the reason.
    console.error('generate-episode trigger failed', row.id, err)
    const reason = err instanceof Error ? err.message : String(err)
    try {
      await conn
        .update(episodes)
        .set({ status: 'failed', failedStage: 'trigger', error: `Envoi au cloud impossible : ${reason}` })
        .where(eq(episodes.id, row.id))
    } catch (recoveryErr) {
      // The stale-run cutoff above will reap this row on the next attempt.
      console.error('could not record the trigger failure', row.id, recoveryErr)
    }
    return c.json(
      { error: 'Impossible de lancer la génération dans le cloud. Réessayez dans quelques minutes.' },
      503,
    )
  }

  return c.json({ episode_id: row.id, status: 'queued' }, 202)
})

authed.get('/episodes', async (c) => {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) return c.json({ error: 'server misconfigured: R2_PUBLIC_BASE_URL is not set' }, 500)

  const rows = await c
    .get('conn')
    .select({
      id: episodes.id,
      title: episodes.title,
      status: episodes.status,
      createdAt: episodes.createdAt,
      actualSec: episodes.actualSec,
      audioBytes: episodes.audioBytes,
      script: episodes.script,
    })
    .from(episodes)
    .where(eq(episodes.userId, c.get('userId')))
    .orderBy(desc(episodes.createdAt))
    .limit(50)

  return c.json({
    episodes: rows.map((ep) => ({
      id: ep.id,
      title: ep.title,
      status: ep.status,
      createdAt: ep.createdAt.toISOString(),
      actualSec: ep.actualSec,
      audioUrl: readyAudioUrl(base, ep.status, ep.id),
      audioBytes: ep.audioBytes,
      chapters: chaptersOf(ep.script).map((ch) => ({
        title: ch.title,
        sourceCount: ch.source_ids.length,
      })),
    })),
  })
})

authed.get('/episodes/:id', async (c) => {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) return c.json({ error: 'server misconfigured: R2_PUBLIC_BASE_URL is not set' }, 500)

  const id = c.req.param('id')
  // Same 404 as a foreign id: a caller learns nothing from the shape of the id.
  if (!isUuid(id)) return c.json({ error: 'not found' }, 404)

  const conn = c.get('conn')
  const [ep] = await conn
    .select({
      id: episodes.id,
      userId: episodes.userId,
      title: episodes.title,
      status: episodes.status,
      createdAt: episodes.createdAt,
      actualSec: episodes.actualSec,
      audioBytes: episodes.audioBytes,
      script: episodes.script,
      grounding: episodes.grounding,
      outline: episodes.outline,
      cost: episodes.cost,
      promptVersions: episodes.promptVersions,
      targetSec: episodes.targetSec,
    })
    .from(episodes)
    .where(eq(episodes.id, id))
  if (!ep || ep.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)

  // An episode still being written has no script yet, which is not a failure.
  // A script that is present but unreadable is one, and rendering it as an
  // episode with zero chapters would hide it.
  const parsed = ScriptSchema.safeParse(ep.script)
  if (ep.script !== null && !parsed.success) {
    return c.json({ error: 'the stored script is unreadable' }, 500)
  }
  const chapters = parsed.success ? parsed.data.chapters : []

  // The writer fills source_ids from its evidence, so they are only strings
  // here: anything that is not a uuid would fail the query outright.
  const cited = [...new Set(chapters.flatMap((ch) => ch.source_ids))].filter(isUuid)
  const rows = cited.length
    ? await conn
        .select({
          id: sources.id,
          userId: sources.userId,
          publisher: sources.publisher,
          title: sources.title,
          url: sources.url,
          lang: sources.lang,
          extractionQuality: sources.extractionQuality,
        })
        .from(sources)
        .where(inArray(sources.id, cited))
    : []
  const byId = new Map(rows.filter((s) => s.userId === c.get('userId')).map((s) => [s.id, s]))

  // The verification report, grouped by the chapter it belongs to. It is served
  // here, authenticated, and never from the bucket: the bucket is public.
  const GroundingEntrySchema = z.object({
    chapter: z.string(),
    sentence: z.string(),
    supported: z.boolean(),
    action: z.string(),
    fix: z.string().optional(),
  })
  const report = z.array(GroundingEntrySchema).safeParse(ep.grounding)
  const groundingByChapter = new Map<string, z.infer<typeof GroundingEntrySchema>[]>()
  if (report.success) {
    for (const entry of report.data) {
      const list = groundingByChapter.get(entry.chapter) ?? []
      list.push(entry)
      groundingByChapter.set(entry.chapter, list)
    }
  }

  // What the editorial stage decided before a word was written, and what the run
  // cost. The app's backstage view is the debug trail of ARCHITECTURE §9 made
  // readable, so it needs the plan, not only the result.
  const OutlineShape = z.object({
    sections: z.array(z.object({ story_id: z.string(), title: z.string(), airtime_sec: z.number() })).default([]),
    discarded: z.array(z.object({ story_id: z.string(), reason: z.string() })).default([]),
  })
  const outline = OutlineShape.safeParse(ep.outline)
  // publishEpisode merges scalar totals (tts_usd, total_usd) into the per-stage
  // ledger, so the shape is mixed: prefer the total, else sum the stages.
  const CostShape = z.record(z.union([z.object({ usd: z.number().optional() }).passthrough(), z.number()]))
  const costs = CostShape.safeParse(ep.cost)
  const entries = report.success ? report.data : []

  return c.json({
    id: ep.id,
    title: ep.title,
    status: ep.status,
    createdAt: ep.createdAt.toISOString(),
    actualSec: ep.actualSec,
    targetSec: ep.targetSec,
    // The airtime budget, in the order the outline set it.
    budget: outline.success ? outline.data.sections.map((s) => ({ title: s.title, airtimeSec: s.airtime_sec })) : [],
    discarded: outline.success ? outline.data.discarded.map((d) => d.reason) : [],
    verification: {
      checked: entries.length,
      corrected: entries.filter((e) => e.action === 'fixed').length,
      dropped: entries.filter((e) => e.action.startsWith('dropped')).length,
    },
    usd: costs.success
      ? typeof costs.data.total_usd === 'number'
        ? costs.data.total_usd
        : Object.values(costs.data).reduce<number>(
            (n, v) => n + (typeof v === 'number' ? 0 : typeof v.usd === 'number' ? v.usd : 0),
            0,
          )
      : null,
    promptVersions: ep.promptVersions ?? null,
    audioUrl: readyAudioUrl(base, ep.status, ep.id),
    audioBytes: ep.audioBytes,
    chapters: chapters.map((ch) => ({
      title: ch.title,
      text: ch.text,
      sourceIds: ch.source_ids,
      // An intro carries no external claim, so an empty list is the honest answer
      // rather than a missing field the app would have to guess about.
      grounding: (groundingByChapter.get(ch.title) ?? []).map((g) => ({
        sentence: g.sentence,
        supported: g.supported,
        action: g.action,
        ...(g.fix ? { fix: g.fix } : {}),
      })),
      sources: ch.source_ids.flatMap((sourceId) => {
        const s = byId.get(sourceId)
        return s
          ? [
              {
                id: s.id,
                publisher: publisherOf(s.publisher, s.url),
                title: s.title,
                url: s.url,
                lang: s.lang,
                extractionQuality: s.extractionQuality,
              },
            ]
          : []
      }),
    })),
  })
})

authed.get('/sources', async (c) => {
  const conn = c.get('conn')
  const userId = c.get('userId')

  const rows = await conn
    .select({
      id: sources.id,
      title: sources.title,
      url: sources.url,
      publisher: sources.publisher,
      type: sources.type,
      lang: sources.lang,
      status: sources.status,
      extractionQuality: sources.extractionQuality,
      error: sources.error,
      capturedAt: sources.capturedAt,
    })
    .from(sources)
    .where(eq(sources.userId, userId))
    .orderBy(desc(sources.capturedAt))
    .limit(100)

  // stories.source_ids is a uuid array, so membership is answered from the
  // user's own stories rather than with a containment query per source.
  const storyRows = await conn
    .select({ sourceIds: stories.sourceIds })
    .from(stories)
    .where(eq(stories.userId, userId))
  const clustered = new Set(storyRows.flatMap((s) => s.sourceIds))

  return c.json({
    sources: rows.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      publisher: publisherOf(s.publisher, s.url),
      type: s.type,
      lang: s.lang,
      status: s.status,
      extractionQuality: s.extractionQuality,
      error: s.error,
      capturedAt: s.capturedAt.toISOString(),
      inStory: clustered.has(s.id),
    })),
  })
})

app.route('/', authed)

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((err, c) => {
  // A driver stack tells a caller nothing and leaks schema details; the log keeps it.
  console.error('request failed', c.req.method, c.req.path, err)
  return c.json({ error: 'internal error' }, 500)
})

export default handle(app)
