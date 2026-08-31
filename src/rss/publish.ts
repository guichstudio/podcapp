import { eq } from 'drizzle-orm'
import { createDb } from '../db/client.js'
import { users } from '../db/schema.js'
import { createStorage } from '../storage/index.js'
import { publishFeed } from './feed-data.js'

// Thin argv wrapper around publishFeed (src/rss/feed-data.ts), which the
// generate-episode job also calls after publishing audio.
//   pnpm feed:publish <email>

const email = process.argv[2]
if (!email) throw new Error('usage: pnpm feed:publish <email>')

const db = await createDb()
const storage = createStorage()

const [user] = await db.select().from(users).where(eq(users.email, email))
if (!user) throw new Error(`no user with email ${email}: create one with "pnpm inspect create-user ${email}"`)

const { feedUrl, episodeCount, imageUrl } = await publishFeed(db, storage, user.id)

console.log(`
episodes   ${episodeCount}
artwork    ${imageUrl ?? 'none (pnpm inspect cover <file.jpg>)'}
feed       ${feedUrl}

Subscribe to that URL in Apple Podcasts or Overcast.
`)
process.exit(0)
