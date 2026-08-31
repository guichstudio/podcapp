import { and, eq, inArray } from 'drizzle-orm'
import { createDb } from '../db/client.js'
import { sources, users } from '../db/schema.js'
import { logger } from '../log.js'
import { processSource } from './processSource.js'
import type { CostLedger } from '../llm/index.js'

// The other half of the capture loop: /ingest records a link in milliseconds,
// this drains the queue on a machine that can afford a minute per source.
//   pnpm process:pending [email]

const email = process.argv[2]
const db = await createDb()

const owner = email ? await db.select({ id: users.id }).from(users).where(eq(users.email, email)) : []
if (email && owner.length === 0) throw new Error(`no user with email ${email}`)

const pending = await db
  .select()
  .from(sources)
  .where(
    owner[0]
      ? and(eq(sources.userId, owner[0].id), inArray(sources.status, ['received', 'extracting']))
      : inArray(sources.status, ['received', 'extracting']),
  )

if (pending.length === 0) {
  console.log('nothing pending')
  process.exit(0)
}
console.log(`${pending.length} source${pending.length > 1 ? 's' : ''} to process\n`)

const ledger: CostLedger = {}
let ready = 0
let failed = 0
for (const source of pending) {
  const label = source.url ?? source.title ?? source.id
  try {
    const result = await processSource(db, source.id, ledger)
    if (result.status === 'ready') ready++
    else failed++
    console.log(`${result.status.padEnd(18)} ${result.clustering ?? ''} ${label}`)
  } catch (err) {
    // A single bad source must not abandon the rest of the queue; the row keeps
    // its own readable status from processSource.
    failed++
    logger.error({ sourceId: source.id, err }, 'process:pending failed on one source')
    console.log(`error              ${label}: ${String(err).slice(0, 120)}`)
  }
}

const usd = Object.values(ledger).reduce((n, c) => n + c.usd, 0)
console.log(`\n${ready} ready, ${failed} failed, $${usd.toFixed(4)}`)
process.exit(0)
