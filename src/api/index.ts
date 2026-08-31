import { serve } from '@hono/node-server'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { PUBLIC_BASE_URL } from '../config.js'
import { ScriptSchema } from '../core/types.js'
import { createDb, type Db } from '../db/client.js'
import { episodes, sources, stories, users } from '../db/schema.js'
import { generateEpisode } from '../jobs/generateEpisode.js'
import { processSource } from '../jobs/processSource.js'
import { chapterKey, episodeAudioKey, publishEpisode } from '../jobs/publishEpisode.js'
import { RUN_ARTIFACTS, runArtifactKey } from '../jobs/runArtifacts.js'
import { logger } from '../log.js'
import { buildFeed, COVER_KEYS, type FeedEpisode } from '../rss/feed.js'
import { createStorage } from '../storage/index.js'

type Env = { Variables: { userId: string; db: Db } }

const FEED_TITLE = 'Briefing'
const FEED_DESCRIPTION = 'Personal audio briefing, built from the articles and newsletters you saved.'

// Path params land in uuid columns, where a malformed value is a driver error
// rather than an empty result. Postgres renders uuids lowercase, so a key built
// from an episode id always matches this shape.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_RE = new RegExp(`^${UUID}$`)
const PUBLIC_MEDIA_KEY_RE = new RegExp(`^episodes/${UUID}/episode\\.mp3$`)
const CHAPTER_NAME_RE = /^chapter-(\d{2})$/

// users.output_language is free text and doubles as the writer prompt's language
// instruction, so only a known tag reaches the feed: <language> must be BCP 47.
const FEED_LANGUAGES = new Set(['fr', 'en', 'es', 'de', 'it', 'pt', 'nl'])

const IngestSchema = z.union([
  z.object({ url: z.string().url() }),
  z.object({ text: z.string().min(1) }),
  z.object({ html: z.string().min(1), subject: z.string().optional() }),
])

const CreateEpisodeSchema = z.object({
  target_min: z.number().int().min(1).max(60).optional(),
})

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function feedLanguage(value: string): string {
  const tag = value.trim().toLowerCase()
  return FEED_LANGUAGES.has(tag) ? tag : 'fr'
}

// Only a single "bytes=start-end": that is what podcast clients send to resume a
// download, and RFC 9110 requires ignoring any Range we do not understand.
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}

// The listing and the download route must agree on what a name means, so both go
// through here; anything else is a 404 rather than an arbitrary storage read.
function runObjectKey(episodeId: string, name: string): { key: string; contentType: string } | null {
  if (name === 'episode') return { key: episodeAudioKey(episodeId), contentType: 'audio/mpeg' }
  const chapter = CHAPTER_NAME_RE.exec(name)
  if (chapter) {
    return { key: chapterKey(episodeId, Number(chapter[1])), contentType: 'audio/mpeg' }
  }
  const artifact = RUN_ARTIFACTS.find((a) => a === name)
  if (artifact) return { key: runArtifactKey(episodeId, artifact), contentType: 'application/json' }
  return null
}

function chapterName(index: number): string {
  return `chapter-${String(index).padStart(2, '0')}`
}

function runUrl(episodeId: string, name: string): string {
  return `${PUBLIC_BASE_URL}/admin/runs/${episodeId}/${name}`
}

const db = await createDb()
const storage = createStorage({ baseUrl: PUBLIC_BASE_URL })
const app = new Hono<Env>()

app.use('*', async (c, next) => {
  c.set('db', db)
  await next()
})

// A driver stack tells a caller nothing and leaks schema details; the log keeps it.
app.onError((err, c) => {
  logger.error({ method: c.req.method, path: c.req.path, err: String(err) }, 'request failed')
  return c.json({ error: 'internal error' }, 500)
})

// Public routes are registered BEFORE the authed sub-app is mounted: mounting it
// at '/' installs its bearer check on '/*', which would then also cover anything
// added afterwards. A podcast client cannot send a bearer token, which is exactly
// why the feed URL carries an unguessable rss_token instead.
app.get('/health', (c) => c.json({ ok: true }))

app.get('/rss/:token', async (c) => {
  const token = c.req.param('token').replace(/\.xml$/, '')
  const [user] = await db.select().from(users).where(eq(users.rssToken, token))
  if (!user) return c.json({ error: 'not found' }, 404)

  const rows = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.userId, user.id), eq(episodes.status, 'ready')))
    .orderBy(desc(episodes.createdAt))
    .limit(100)

  const items: FeedEpisode[] = []
  for (const ep of rows) {
    // Measured once at publish time: sizing every enclosure by reading the mp3
    // back made a single feed poll pull the whole catalogue into memory.
    let audioBytes = ep.audioBytes ?? 0
    if (audioBytes <= 0) {
      // The column alone never condemns an episode: everything published before
      // audio_bytes existed has a null there, so storage is asked first and the
      // measurement is written back. Only a genuinely missing object fails it.
      const stored = await storage.get(episodeAudioKey(ep.id))
      if (!stored || stored.length === 0) {
        logger.warn({ episodeId: ep.id }, 'feed: episode audio is gone from storage')
        await markAudioMissing(ep.id, ep.storyIds)
        continue
      }
      audioBytes = stored.length
      await backfillAudioBytes(ep.id, audioBytes)
    }
    const script = ScriptSchema.safeParse(ep.script)
    const title = ep.title ?? `${FEED_TITLE} ${ep.createdAt.toISOString().slice(0, 10)}`
    items.push({
      id: ep.id,
      title,
      description: script.success ? script.data.chapters.map((ch) => ch.title).join(' / ') : title,
      // Built at feed time, not read from episodes.audio_url: an episode published
      // before PUBLIC_BASE_URL was set would otherwise keep a localhost enclosure.
      audioUrl: storage.publicUrl(episodeAudioKey(ep.id)),
      audioBytes,
      durationSec: ep.actualSec ?? 0,
      publishedAt: ep.createdAt,
    })
  }

  const image = await coverUrl()
  const feed = buildFeed({
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    author: user.email.split('@')[0] ?? user.email,
    email: user.email,
    language: feedLanguage(user.outputLanguage),
    // The token stays in atom:link rel=self only: clients render <link> as "visit
    // website" and can leak it as a referrer.
    link: PUBLIC_BASE_URL,
    selfUrl: `${PUBLIC_BASE_URL}/rss/${token}.xml`,
    // Only advertised when the object is really there: a cover that 404s is
    // worse in a podcast client than no cover at all.
    ...(image ? { imageUrl: image } : {}),
    episodes: items,
  })
  return c.body(feed, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' })
})

// Storage exposes no head, so the object is read to prove it exists. That is one
// small image per poll, unlike sizing every episode's mp3.
async function coverUrl(): Promise<string | undefined> {
  for (const cover of COVER_KEYS) {
    try {
      if (await storage.get(cover.key)) return storage.publicUrl(cover.key)
    } catch (err) {
      logger.error({ key: cover.key, err: String(err) }, 'feed: could not read the cover')
      return undefined
    }
  }
  return undefined
}

// The measurement is worth keeping, but the item ships either way: never fails
// the poll.
async function backfillAudioBytes(episodeId: string, audioBytes: number): Promise<void> {
  try {
    await db.update(episodes).set({ audioBytes }).where(eq(episodes.id, episodeId))
  } catch (err) {
    logger.error({ episodeId, err: String(err) }, 'feed: could not backfill the audio length')
  }
}

// Otherwise the feed quietly drops the item while GET /episodes/:id still calls
// it ready. Never fails the poll: the feed itself is still serveable.
async function markAudioMissing(episodeId: string, storyIds: readonly string[]): Promise<void> {
  try {
    await db
      .update(episodes)
      .set({ status: 'failed', failedStage: 'assembling', error: 'audio missing from storage' })
      .where(and(eq(episodes.id, episodeId), eq(episodes.status, 'ready')))
    // The audio is gone, so nothing this episode aired was ever delivered: its
    // stories go back in the pool instead of being lost with it.
    if (storyIds.length > 0) {
      await db.update(stories).set({ status: 'open' }).where(inArray(stories.id, [...storyIds]))
    }
  } catch (err) {
    logger.error({ episodeId, err: String(err) }, 'feed: could not mark episode failed')
  }
}

// Serves what the local storage driver wrote, so publicUrl() resolves in dev.
// With R2 the bucket serves these URLs directly and this route goes unused.
// Unauthenticated because podcast clients hold no token, so it exposes exactly
// one object per episode plus the show artwork: chapters and run artifacts live
// behind /admin/runs. The cover is public by nature and leaks nothing.
app.on(['GET', 'HEAD'], '/media/*', async (c) => {
  let key: string
  try {
    key = decodeURIComponent(c.req.path.slice('/media/'.length))
  } catch {
    // A malformed percent escape is a bad URL, not a crash.
    return c.json({ error: 'not found' }, 404)
  }
  const cover = COVER_KEYS.find((k) => k.key === key)
  if (!cover && !PUBLIC_MEDIA_KEY_RE.test(key)) return c.json({ error: 'not found' }, 404)
  const body = await storage.get(key)
  if (!body) return c.json({ error: 'not found' }, 404)

  const headers: Record<string, string> = {
    'Content-Type': cover ? cover.contentType : 'audio/mpeg',
    'Accept-Ranges': 'bytes',
  }
  const range = parseRange(c.req.header('Range'), body.length)
  if (range === 'unsatisfiable') {
    headers['Content-Range'] = `bytes */${body.length}`
    return c.body(null, 416, headers)
  }
  const slice = range ? body.subarray(range.start, range.end + 1) : body
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${body.length}`
  // Clients size and resume a download from these two headers.
  headers['Content-Length'] = String(slice.length)
  const status = range ? 206 : 200
  if (c.req.method === 'HEAD') return c.body(null, status, headers)
  return c.body(new Uint8Array(slice), status, headers)
})

const authed = new Hono<Env>()
authed.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'missing bearer token' }, 401)
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.apiToken, token))
  if (!user) return c.json({ error: 'invalid token' }, 401)
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
  const [row] = await db
    .insert(sources)
    .values({
      userId: c.get('userId'),
      type,
      url: 'url' in body ? body.url : null,
      raw: 'url' in body ? null : body,
      sourceHash: `pending-${crypto.randomUUID()}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)
  // Local async processing; moves to a Trigger.dev task once TRIGGER_SECRET_KEY exists.
  void processSource(db, row.id).catch((e) => logger.error({ sourceId: row.id, err: String(e) }, 'processSource failed'))
  return c.json({ source_id: row.id }, 202)
})

authed.get('/sources/:id', async (c) => {
  const id = c.req.param('id')
  // Same 404 as a foreign id: a caller learns nothing from the shape of the id.
  if (!isUuid(id)) return c.json({ error: 'not found' }, 404)
  const [s] = await db.select().from(sources).where(eq(sources.id, id))
  if (!s || s.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)
  return c.json({ ...s, embedding: undefined, cleanText: s.cleanText?.slice(0, 1000) })
})

authed.get('/stories', async (c) => {
  const all = await db.select().from(stories).where(eq(stories.userId, c.get('userId'))).orderBy(desc(stories.lastSeenAt))
  return c.json(all.map((s) => ({ ...s, embedding: undefined })))
})

authed.post('/episodes', async (c) => {
  const userId = c.get('userId')
  const parsed = CreateEpisodeSchema.safeParse((await c.req.json().catch(() => null)) ?? {})
  if (!parsed.success) {
    return c.json({ error: 'target_min must be a whole number of minutes between 1 and 60' }, 400)
  }
  const [user] = await db
    .select({ targetMinutes: users.targetMinutes, outputLanguage: users.outputLanguage })
    .from(users)
    .where(eq(users.id, userId))
  if (!user) return c.json({ error: 'user not found' }, 404)
  const targetMin = parsed.data.target_min ?? user.targetMinutes
  // users.target_minutes is written outside this route, so it gets the same bound:
  // an out-of-range value would overflow the target_sec integer column.
  if (!Number.isInteger(targetMin) || targetMin < 1 || targetMin > 60) {
    return c.json({ error: 'target minutes must be a whole number between 1 and 60' }, 400)
  }
  const targetSec = targetMin * 60
  const [row] = await db
    .insert(episodes)
    .values({ userId, status: 'queued', targetSec })
    .returning({ id: episodes.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)

  const episodeId = row.id
  void (async () => {
    await generateEpisode(db, { userId, targetSec, language: user.outputLanguage, episodeId, storage })
    await publishEpisode(db, storage, episodeId)
  })().catch(async (err: unknown) => {
    logger.error({ episodeId, err: String(err) }, 'episode run failed')
    // publishEpisode records its own failed stage; this only covers a generation
    // failure, which would otherwise leave the episode stuck on 'queued'. The
    // recovery write is guarded because whatever failed the run (a DB outage,
    // say) can fail it too, and an unhandled rejection here kills the process.
    try {
      await db
        .update(episodes)
        .set({ status: 'failed', failedStage: 'generate', error: String(err).slice(0, 2000) })
        .where(and(eq(episodes.id, episodeId), ne(episodes.status, 'failed')))
    } catch (writeErr) {
      logger.error({ episodeId, err: String(writeErr) }, 'episode run: could not record the failure')
    }
  })
  return c.json({ episode_id: episodeId }, 202)
})

authed.get('/episodes/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) return c.json({ error: 'not found' }, 404)
  const [ep] = await db.select().from(episodes).where(eq(episodes.id, id))
  if (!ep || ep.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)
  return c.json({
    episode_id: ep.id,
    status: ep.status,
    title: ep.title,
    script: ep.script,
    audio_url: ep.audioUrl,
    actual_sec: ep.actualSec,
    cost: ep.cost,
    failed_stage: ep.failedStage,
    error: ep.error,
  })
})

authed.get('/admin/runs/:episodeId', async (c) => {
  const episodeId = c.req.param('episodeId')
  if (!isUuid(episodeId)) return c.json({ error: 'not found' }, 404)
  const [ep] = await db.select().from(episodes).where(eq(episodes.id, episodeId))
  if (!ep || ep.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)

  // Every url points back at this authed route: a run holds drafts, grounding
  // and metrics, none of which belong on the unauthenticated media route.
  const artifacts: { name: string; key: string; url: string; title?: string }[] = []
  for (const name of RUN_ARTIFACTS) {
    const key = runArtifactKey(ep.id, name)
    if (await storage.get(key)) artifacts.push({ name, key, url: runUrl(ep.id, name) })
  }
  // Chapters and the episode are listed from the row rather than probed: sizing
  // every mp3 to build a debug listing would pull the whole episode back from R2.
  const script = ScriptSchema.safeParse(ep.script)
  if (script.success) {
    script.data.chapters.forEach((chapter, index) => {
      const name = chapterName(index)
      artifacts.push({ name, key: chapterKey(ep.id, index), url: runUrl(ep.id, name), title: chapter.title })
    })
  }
  if (ep.audioUrl) {
    artifacts.push({ name: 'episode', key: episodeAudioKey(ep.id), url: runUrl(ep.id, 'episode') })
  }

  return c.json({ episode_id: ep.id, status: ep.status, failed_stage: ep.failedStage, artifacts })
})

authed.get('/admin/runs/:episodeId/:name', async (c) => {
  const episodeId = c.req.param('episodeId')
  if (!isUuid(episodeId)) return c.json({ error: 'not found' }, 404)
  const [ep] = await db
    .select({ userId: episodes.userId })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
  if (!ep || ep.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)

  const target = runObjectKey(episodeId, c.req.param('name'))
  if (!target) return c.json({ error: 'not found' }, 404)
  const body = await storage.get(target.key)
  if (!body) return c.json({ error: 'not found' }, 404)
  return c.body(new Uint8Array(body), 200, {
    'Content-Type': target.contentType,
    'Content-Length': String(body.length),
  })
})

app.route('/', authed)

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => logger.info({ port }, 'api listening'))
