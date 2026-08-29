import { mkdirSync, writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db/client.js'
import { users } from '../src/db/schema.js'
import { generateEpisode } from '../src/jobs/generateEpisode.js'
import type { CostLedger } from '../src/llm/index.js'

// Builds one episode from the stories left by `pnpm eval:run`, then reports the
// Phase 2 DoD metrics. Run eval:run first (it populates .data/eval).

const db = await createDb({ pglitePath: process.env.EVAL_DB ?? '.data/eval' })
const [user] = await db.select().from(users).where(eq(users.email, 'eval@podcapp.local'))
if (!user) throw new Error('no eval user: run `pnpm eval:run` first')

const targetSec = Number(process.env.TARGET_SEC ?? 900)
const ledger: CostLedger = {}
const started = Date.now()
const artifacts = await generateEpisode(db, { userId: user.id, targetSec, language: 'fr' }, ledger)

const outDir = `eval/out/episode-${new Date().toISOString().replace(/[:.]/g, '-')}`
mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/outline.json`, JSON.stringify(artifacts.outline, null, 2))
writeFileSync(`${outDir}/drafts.json`, JSON.stringify(artifacts.drafts, null, 2))
writeFileSync(`${outDir}/grounding.json`, JSON.stringify(artifacts.grounding, null, 2))
writeFileSync(`${outDir}/script.json`, JSON.stringify(artifacts.script, null, 2))
writeFileSync(`${outDir}/metrics.json`, JSON.stringify(artifacts.metrics, null, 2))
writeFileSync(
  `${outDir}/script.md`,
  artifacts.script.chapters.map((c) => `## ${c.title}\n\n${c.text}`).join('\n\n'),
)

const m = artifacts.metrics
const drift = Math.round(((m.estimated_sec - m.target_sec) / m.target_sec) * 100)
console.log(`
duration      ${m.estimated_sec}s vs ${m.target_sec}s target (${drift > 0 ? '+' : ''}${drift}%)  ${Math.abs(drift) <= 15 ? 'OK' : 'OUT OF RANGE'}
words         ${m.words}
grounding     ${m.sentences_checked} checked, ${m.unsupported_found} unsupported found and fixed/dropped, ${m.unsupported_shipped} shipped  ${m.unsupported_shipped === 0 ? 'OK' : 'FAIL'}
blocklist     ${m.blocklist_hits.length} hits ${m.blocklist_hits.length === 0 ? 'OK' : m.blocklist_hits.join(', ')}
cost          $${Object.values(ledger).reduce((n, c) => n + c.usd, 0).toFixed(4)}
elapsed       ${Math.round((Date.now() - started) / 1000)}s
artifacts     ${outDir}/script.md
`)
process.exit(0)
