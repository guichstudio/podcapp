import { and, desc, eq, inArray } from 'drizzle-orm'
import { ScriptSchema } from '../core/types.js'
import { createDb } from '../db/client.js'
import { episodes, sources, users } from '../db/schema.js'
import { episodeAudioKey } from '../jobs/publishEpisode.js'
import { runArtifactKey } from '../jobs/runArtifacts.js'
import { createStorage } from '../storage/index.js'
import { feedKey } from '../rss/feed.js'
import { buildConsole, buildManifest, type ConsoleEpisode } from './page.js'

// Publishes the console next to the feed, behind the same rss_token: the bucket
// is public, so the token is what keeps a personal briefing personal.
//   pnpm console:publish <email>

const email = process.argv[2]
if (!email) throw new Error('usage: pnpm console:publish <email>')

const db = await createDb()
const storage = createStorage()

const [user] = await db.select().from(users).where(eq(users.email, email))
if (!user) throw new Error(`no user with email ${email}`)

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

console.log(`
episodes  ${items.length}
console   ${storage.publicUrl(consoleKey)}
`)
process.exit(0)
