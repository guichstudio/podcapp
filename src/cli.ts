import { desc, eq } from 'drizzle-orm'
import { createDb } from './db/client.js'
import { sources, stories } from './db/schema.js'

// Tiny inspector over the local DB (defaults to the eval database).
//   pnpm inspect stories
//   pnpm inspect story <id>
//   pnpm inspect sources
//   pnpm inspect source <id>

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
} else {
  console.log('usage: pnpm inspect stories | story <id> | sources | source <id>')
}
process.exit(0)
