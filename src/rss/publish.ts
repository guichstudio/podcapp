import { and, desc, eq } from 'drizzle-orm'
import { ScriptSchema } from '../core/types.js'
import { createDb } from '../db/client.js'
import { episodes, users } from '../db/schema.js'
import { episodeAudioKey } from '../jobs/publishEpisode.js'
import { logger } from '../log.js'
import { createStorage } from '../storage/index.js'
import { buildFeed, COVER_KEYS, type FeedEpisode } from './feed.js'

// Writes the feed as a static object next to the audio it points at.
// The API serves the same feed from the database, but this needs no server at
// all: with a public bucket, a podcast client can subscribe while the pipeline
// still runs on a laptop.
//   pnpm feed:publish <email>

const FEED_TITLE = 'Briefing'
const FEED_DESCRIPTION = 'Personal audio briefing, built from the articles and newsletters you saved.'

export function feedKey(rssToken: string): string {
  return `feeds/${rssToken}.xml`
}

const email = process.argv[2]
if (!email) throw new Error('usage: pnpm feed:publish <email>')

const db = await createDb()
const storage = createStorage()

const [user] = await db.select().from(users).where(eq(users.email, email))
if (!user) throw new Error(`no user with email ${email}: create one with "pnpm inspect create-user ${email}"`)

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

console.log(`
episodes   ${items.length}
artwork    ${imageUrl ?? 'none (pnpm inspect cover <file.jpg>)'}
feed       ${selfUrl}

Subscribe to that URL in Apple Podcasts or Overcast.
`)
process.exit(0)
