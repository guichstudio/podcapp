import { and, desc, eq, inArray } from 'drizzle-orm'
import { ScriptSchema } from '../core/types.js'
import { buildConsole, buildManifest, type ConsoleEpisode } from '../console/page.js'
import type { Db } from '../db/client.js'
import { episodes, sources, users } from '../db/schema.js'
import { episodeAudioKey } from '../jobs/publishEpisode.js'
import { runArtifactKey } from '../jobs/runArtifacts.js'
import { logger } from '../log.js'
import type { Storage } from '../storage/index.js'
import { buildFeed, COVER_KEYS, feedKey, type FeedEpisode } from './feed.js'

// Feed and console publishing as plain functions, so the generate-episode job
// can refresh both right after the audio lands. The argv scripts
// (src/rss/publish.ts, src/console/publish.ts) are thin wrappers around these.

const FEED_TITLE = 'Briefing'
const FEED_DESCRIPTION = 'Personal audio briefing, built from the articles and newsletters you saved.'

// Writes the feed as a static object next to the audio it points at. The API
// serves the same feed from the database, but this needs no server at all: with
// a public bucket, a podcast client can subscribe while the pipeline still runs
// on a laptop.
export async function publishFeed(
  db: Db,
  storage: Storage,
  userId: string,
): Promise<{ feedUrl: string; episodeCount: number; imageUrl: string | null }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) throw new Error(`no user with id ${userId}`)

  const rows = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.userId, user.id), eq(episodes.status, 'ready')))
    .orderBy(desc(episodes.createdAt))
    .limit(100)

  const items: FeedEpisode[] = []
  for (const ep of rows) {
    const key = episodeAudioKey(ep.id)
    let bytes = ep.audioBytes ?? 0
    if (bytes <= 0) {
      const stored = await storage.get(key)
      if (!stored || stored.length === 0) {
        logger.warn({ episodeId: ep.id }, 'feed: episode audio is missing from storage, skipping')
        continue
      }
      bytes = stored.length
      await db.update(episodes).set({ audioBytes: bytes }).where(eq(episodes.id, ep.id))
    }
    const script = ScriptSchema.safeParse(ep.script)
    const title = ep.title ?? `${FEED_TITLE} ${ep.createdAt.toISOString().slice(0, 10)}`
    items.push({
      id: ep.id,
      title,
      description: script.success ? script.data.chapters.map((c) => c.title).join(' / ') : title,
      audioUrl: storage.publicUrl(key),
      audioBytes: bytes,
      durationSec: ep.actualSec ?? 0,
      publishedAt: ep.createdAt,
    })
  }
  if (items.length === 0) throw new Error('no ready episode with stored audio: nothing to publish')

  let imageUrl: string | undefined
  for (const cover of COVER_KEYS) {
    if (await storage.get(cover.key)) {
      imageUrl = storage.publicUrl(cover.key)
      break
    }
  }

  const selfUrl = storage.publicUrl(feedKey(user.rssToken))
  const xml = buildFeed({
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    author: user.email.split('@')[0] ?? user.email,
    email: user.email,
    language: user.outputLanguage.trim().toLowerCase().slice(0, 2),
    // Clients surface this as the show's website, so it has to resolve. FEED_LINK
    // is where a real site goes; the bucket root is a working fallback.
    link: process.env.FEED_LINK ?? process.env.R2_PUBLIC_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? '',
    selfUrl,
    ...(imageUrl ? { imageUrl } : {}),
    episodes: items,
  })

  await storage.put(feedKey(user.rssToken), Buffer.from(xml, 'utf8'), 'application/rss+xml; charset=utf-8')

  return { feedUrl: selfUrl, episodeCount: items.length, imageUrl: imageUrl ?? null }
}

// Publishes the console next to the feed, behind the same rss_token: the bucket
// is public, so the token is what keeps a personal briefing personal.
export async function publishConsole(
  db: Db,
  storage: Storage,
  userId: string,
): Promise<{ consoleUrl: string; episodeCount: number }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) throw new Error(`no user with id ${userId}`)

  const consoleKey = `console/${user.rssToken}.html`
  const manifestKey = `console/${user.rssToken}.webmanifest`

  const rows = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.userId, user.id), eq(episodes.status, 'ready')))
    .orderBy(desc(episodes.createdAt))
    .limit(50)

  const items: ConsoleEpisode[] = []
  for (const ep of rows) {
    const script = ScriptSchema.safeParse(ep.script)
    if (!script.success) continue

    const sourceIds = [...new Set(script.data.chapters.flatMap((c) => c.source_ids))]
    const rowsById = new Map(
      sourceIds.length
        ? (await db
            .select({ id: sources.id, title: sources.title, url: sources.url, publisher: sources.publisher })
            .from(sources)
            .where(inArray(sources.id, sourceIds))
        ).map((s) => [s.id, s])
        : [],
    )

    // Metrics live in the run artifacts rather than on the row, so a missing file
    // hides the panel instead of inventing zeros that would read as a clean run.
    const raw = await storage.get(runArtifactKey(ep.id, 'metrics'))
    let metrics: ConsoleEpisode['metrics'] = null
    if (raw) {
      const m = JSON.parse(raw.toString('utf8')) as Record<string, number | Record<string, { usd: number }>>
      const cost = (m.cost ?? {}) as Record<string, { usd?: number }>
      metrics = {
        words: Number(m.words ?? 0),
        sentencesChecked: Number(m.sentences_checked ?? 0),
        unsupportedFound: Number(m.unsupported_found ?? 0),
        unsupportedShipped: Number(m.unsupported_shipped ?? 0),
        editsRejected: Number(m.edits_rejected ?? 0),
        usd: Object.values(cost).reduce((n, c) => n + (c.usd ?? 0), 0),
      }
    }

    items.push({
      id: ep.id,
      title: ep.title ?? `Briefing ${ep.createdAt.toISOString().slice(0, 10)}`,
      audioUrl: storage.publicUrl(episodeAudioKey(ep.id)),
      durationSec: ep.actualSec ?? 0,
      publishedAt: ep.createdAt,
      chapters: script.data.chapters.map((c) => ({
        title: c.title,
        text: c.text,
        sources: c.source_ids
          .map((id) => rowsById.get(id))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({
            title: s.publisher ?? s.title ?? s.url ?? 'source',
            url: s.url,
          })),
      })),
      metrics,
    })
  }

  const html = buildConsole({
    episodes: items,
    feedUrl: storage.publicUrl(feedKey(user.rssToken)),
    manifestUrl: storage.publicUrl(manifestKey),
  })
  await storage.put(consoleKey, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8')
  await storage.put(
    manifestKey,
    Buffer.from(buildManifest(storage.publicUrl(consoleKey)), 'utf8'),
    'application/manifest+json',
  )

  return { consoleUrl: storage.publicUrl(consoleKey), episodeCount: items.length }
}
