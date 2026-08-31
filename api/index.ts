import { neon } from '@neondatabase/serverless'
import { desc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { ScriptSchema, type Script } from '../src/core/types.js'
import * as schema from '../src/db/schema.js'

// The endpoints that have to be reachable from a phone: capture, and reading
// back what capture produced.
//
// /ingest deliberately does NOT run processSource. Extraction and analysis take
// about a minute and belong to the batch run on the laptop, which also keeps this
// bundle free of ffmpeg (78 MB) and the whole audio pipeline. A saved link must
// be recorded in a few hundred milliseconds and never lost.
//
// For the same reason there is no generate trigger here: generation spends
// minutes and shells out to ffmpeg, neither of which a serverless function can
// do. The read endpoints below are strictly read-only.
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

function db() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Missing env var DATABASE_URL')
  return drizzle(neon(url), { schema })
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
  return c.json({ source_id: row.id, status: 'received' }, 202)
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

  return c.json({
    id: ep.id,
    title: ep.title,
    status: ep.status,
    createdAt: ep.createdAt.toISOString(),
    actualSec: ep.actualSec,
    audioUrl: readyAudioUrl(base, ep.status, ep.id),
    audioBytes: ep.audioBytes,
    chapters: chapters.map((ch) => ({
      title: ch.title,
      text: ch.text,
      sourceIds: ch.source_ids,
      sources: ch.source_ids.flatMap((sourceId) => {
        const s = byId.get(sourceId)
        return s
          ? [
              {
                id: s.id,
                publisher: s.publisher,
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
      publisher: s.publisher,
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
