import { eq } from 'drizzle-orm'
import { ScriptSchema } from '../core/types.js'
import type { Db } from '../db/client.js'
import { episodes, events, explainedConcepts, identities, sessions, sources, stories, users } from '../db/schema.js'
import { consoleToken } from '../rss/feed-data.js'
import { feedKey } from '../rss/feed.js'
import type { Storage } from '../storage/index.js'
import { chapterKey, episodeAudioKey } from './publishEpisode.js'
import { RUN_ARTIFACTS, runArtifactKey } from './runArtifacts.js'

// Erases an account and everything it ever produced, bucket first: the bucket
// is public and the feed URL is out in podcast apps, so the audio must be gone
// before the rows that would let anyone find it are. Idempotent by design — a
// second run over a half-erased account simply finishes the job, which is why
// the task that calls this is allowed to retry.
export async function deleteAccount(
  db: Db,
  storage: Storage,
  userId: string,
): Promise<{ episodes: number; objects: number }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) return { episodes: 0, objects: 0 }

  const rows = await db
    .select({ id: episodes.id, script: episodes.script })
    .from(episodes)
    .where(eq(episodes.userId, userId))

  const keys: string[] = []
  for (const row of rows) {
    keys.push(episodeAudioKey(row.id), ...RUN_ARTIFACTS.map((name) => runArtifactKey(row.id, name)))
    // Chapter files are numbered from the script. A row that failed before
    // writing has no script and no chapters on the bucket, and a delete that
    // finds nothing is a success.
    const script = ScriptSchema.safeParse(row.script)
    const count = script.success ? script.data.chapters.length : 0
    for (let i = 0; i < count; i++) keys.push(chapterKey(row.id, i))
  }
  // The feed, the console under its own token, and the console's legacy path
  // under the rss token that publishConsole still tombstones.
  const token = consoleToken(user.apiToken)
  keys.push(
    feedKey(user.rssToken),
    `console/${token}.html`,
    `console/${token}.webmanifest`,
    `console/${user.rssToken}.html`,
    `console/${user.rssToken}.webmanifest`,
  )
  for (const key of keys) await storage.delete(key)

  // Children before the parent: every table here references users.id.
  await db.delete(events).where(eq(events.userId, userId))
  await db.delete(explainedConcepts).where(eq(explainedConcepts.userId, userId))
  await db.delete(episodes).where(eq(episodes.userId, userId))
  await db.delete(stories).where(eq(stories.userId, userId))
  await db.delete(sources).where(eq(sources.userId, userId))
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await db.delete(identities).where(eq(identities.userId, userId))
  await db.delete(users).where(eq(users.id, userId))
  return { episodes: rows.length, objects: keys.length }
}
