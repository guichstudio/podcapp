import { eq } from 'drizzle-orm'
import { createDb } from '../db/client.js'
import { users } from '../db/schema.js'
import { createStorage } from '../storage/index.js'
import { publishConsole } from '../rss/feed-data.js'

// Thin argv wrapper around publishConsole (src/rss/feed-data.ts), which the
// generate-episode job also calls after publishing audio.
//   pnpm console:publish <email>

const email = process.argv[2]
if (!email) throw new Error('usage: pnpm console:publish <email>')

const db = await createDb()
const storage = createStorage()

const [user] = await db.select().from(users).where(eq(users.email, email))
if (!user) throw new Error(`no user with email ${email}`)

const { consoleUrl, episodeCount } = await publishConsole(db, storage, user.id)

console.log(`
episodes  ${episodeCount}
console   ${consoleUrl}
`)
process.exit(0)
