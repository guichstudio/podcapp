import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { desc, eq } from 'drizzle-orm'
import { PUBLIC_BASE_URL } from './config.js'
import { createDb } from './db/client.js'
import { sources, stories, users } from './db/schema.js'
import { COVER_KEYS } from './rss/feed.js'
import { createStorage } from './storage/index.js'

const COVER_REQUIREMENT =
  'Apple Podcasts requires a square JPEG or PNG, 1400x1400 to 3000x3000 pixels.'

// Tiny inspector over the local DB (defaults to the eval database).
//   pnpm inspect stories
//   pnpm inspect story <id>
//   pnpm inspect sources
//   pnpm inspect source <id>
//   pnpm inspect create-user <email>
//   pnpm inspect cover [path-to-jpg-or-png]

const db = await createDb({ pglitePath: process.env.EVAL_DB ?? '.data/eval' })
const [cmd, arg] = process.argv.slice(2)

if (cmd === 'stories') {
  const all = await db.select().from(stories).orderBy(desc(stories.lastSeenAt))
  for (const s of all) {
    console.log(`${s.id}  [${s.topic ?? '-'}]  ${s.sourceIds.length} src, ${(s.claims as unknown[]).length} claims  ${s.headline}`)
  }
  console.log(`\n${all.length} stories`)
} else if (cmd === 'story' && arg) {
  const [s] = await db.select().from(stories).where(eq(stories.id, arg))
  if (!s) throw new Error('story not found')
  console.log(JSON.stringify({ ...s, embedding: s.embedding ? '<vector>' : null }, null, 2))
} else if (cmd === 'sources') {
  const all = await db.select().from(sources).orderBy(desc(sources.capturedAt))
  for (const s of all) {
    console.log(`${s.id}  ${s.status.padEnd(18)} q=${s.extractionQuality ?? '-'}  ${s.title ?? s.url ?? ''}`)
  }
  console.log(`\n${all.length} sources`)
} else if (cmd === 'source' && arg) {
  const [s] = await db.select().from(sources).where(eq(sources.id, arg))
  if (!s) throw new Error('source not found')
  console.log(JSON.stringify({ ...s, embedding: s.embedding ? '<vector>' : null, cleanText: `${(s.cleanText ?? '').slice(0, 500)}...` }, null, 2))
} else if (cmd === 'create-user' && arg) {
  // Users belong to the database the API serves from, not the eval one, so this
  // command opens its own handle (DATABASE_URL, else .data/pglite).
  const appDb = await createDb()
  const apiToken = randomBytes(32).toString('base64url')
  const rssToken = randomBytes(32).toString('base64url')
  const [created] = await appDb.insert(users).values({ email: arg, apiToken, rssToken }).returning()
  if (!created) throw new Error(`could not create user ${arg}`)
  // Printed once: the tokens are the only credentials and are never shown again.
  console.log(`user      ${created.id}  ${created.email}`)
  console.log(`api token ${apiToken}`)
  console.log(`rss token ${rssToken}`)
  console.log(`feed url  ${PUBLIC_BASE_URL}/rss/${rssToken}.xml`)
} else if (cmd === 'cover') {
  const storage = createStorage({ baseUrl: PUBLIC_BASE_URL })
  // The feed picks the first cover that exists, so the CLI resolves it the same
  // way rather than printing a URL for an object nobody will ever be served.
  const active = async (): Promise<(typeof COVER_KEYS)[number] | undefined> => {
    for (const cover of COVER_KEYS) if (await storage.get(cover.key)) return cover
    return undefined
  }
  if (!arg) {
    const current = await active()
    if (current) {
      console.log(`cover ${current.key}`)
      console.log(storage.publicUrl(current.key))
    } else {
      console.log('no cover uploaded: the feed carries no artwork until you run')
      console.log('  pnpm inspect cover <path-to-jpg-or-png>')
    }
    console.log(COVER_REQUIREMENT)
  } else {
    const ext = extname(arg).toLowerCase()
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
      throw new Error(`cover must be a .jpg or .png file, got "${arg}"`)
    }
    const key = ext === '.png' ? 'cover.png' : 'cover.jpg'
    const body = readFileSync(arg)
    await storage.put(key, body, ext === '.png' ? 'image/png' : 'image/jpeg')
    console.log(`stored ${body.length} bytes at ${key}`)
    const current = await active()
    // Both formats can sit in storage at once and only one reaches the feed.
    if (current && current.key !== key) {
      console.log(`warning: the feed still serves ${current.key}; delete it for ${key} to take effect`)
    }
    console.log(storage.publicUrl(key))
    // Not checked here: reading the pixel size means decoding the image, and a
    // wrong guess is worse than the requirement stated plainly.
    console.log(COVER_REQUIREMENT)
  }
} else {
  console.log(
    'usage: pnpm inspect stories | story <id> | sources | source <id> | create-user <email> | cover [path-to-jpg-or-png]',
  )
}
process.exit(0)
