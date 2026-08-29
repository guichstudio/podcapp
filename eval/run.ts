import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db/client.js'
import { migrate } from '../src/db/migrate.js'
import { sources, stories, users } from '../src/db/schema.js'
import { processSource, type ProcessResult } from '../src/jobs/processSource.js'
import type { CostLedger } from '../src/llm/index.js'

// Full processSource pipeline over the committed cache -> fresh embedded DB ->
// clusters + auto-metrics. Reproducible: network only for LLM/embedding calls.

const DB_PATH = process.env.EVAL_DB ?? '.data/eval'
rmSync(DB_PATH, { recursive: true, force: true })
const db = await createDb({ pglitePath: DB_PATH })
await migrate(db)

const [user] = await db
  .insert(users)
  .values({ email: 'eval@podcapp.local', apiToken: 'eval-token', rssToken: 'eval-rss' })
  .returning()
if (!user) throw new Error('failed to seed eval user')

interface CacheEntry {
  id: string
  url?: string
  title?: string
  topic: string
  lang: string
  group?: string
  expect_failure?: string
  ok: boolean
  status?: string
  error?: string
  extraction?: { clean_text: string; title?: string; quality: number; published_at?: string }
}

const entries = readdirSync('eval/dataset/cache')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(`eval/dataset/cache/${f}`, 'utf8')) as CacheEntry)

const ledger: CostLedger = {}
const results: (ProcessResult & { evalId: string; group?: string })[] = []
const started = Date.now()

for (const entry of entries) {
  if (!entry.ok || !entry.extraction) {
    results.push({ evalId: entry.id, sourceId: '', status: `cache:${entry.status ?? 'failed'}` })
    continue
  }
  const [row] = await db
    .insert(sources)
    .values({
      userId: user.id,
      type: entry.url ? 'web' : 'text',
      url: entry.url ?? null,
      title: entry.extraction.title ?? entry.title ?? null,
      lang: entry.lang,
      cleanText: entry.extraction.clean_text,
      extractionQuality: entry.extraction.quality,
      sourceHash: `pending-${entry.id}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) throw new Error('source insert failed')
  try {
    const r = await processSource(db, row.id, ledger)
    results.push({ ...r, evalId: entry.id, ...(entry.group ? { group: entry.group } : {}) })
    console.log(`${entry.id}  ${r.status}  ${r.clustering ?? ''}`)
  } catch (e) {
    results.push({ evalId: entry.id, sourceId: row.id, status: 'error', error: String(e).slice(0, 300) })
    console.log(`${entry.id}  ERROR  ${String(e).slice(0, 160)}`)
  }
}

// ---- metrics ----
const allStories = await db.select().from(stories).where(eq(stories.userId, user.id))
const storyOf = new Map<string, string>()
for (const s of allStories) for (const sid of s.sourceIds) storyOf.set(sid, s.id)

const processed = results.filter((r) => r.status === 'ready')
const byGroup = new Map<string, string[]>()
for (const r of processed.filter((r) => r.group)) {
  const list = byGroup.get(r.group as string) ?? []
  list.push(storyOf.get(r.sourceId) ?? 'unclustered')
  byGroup.set(r.group as string, list)
}

let missedMerges = 0
let labeledSources = 0
for (const [group, storyIds] of byGroup) {
  labeledSources += storyIds.length
  const distinct = new Set(storyIds).size
  if (distinct > 1) {
    missedMerges += distinct - 1
    console.log(`SPLIT group ${group}: ${distinct} stories for ${storyIds.length} sources`)
  }
}
let wrongMerges = 0
for (const s of allStories) {
  const groups = new Set(
    s.sourceIds.map((sid) => results.find((r) => r.sourceId === sid)?.group).filter(Boolean),
  )
  if (groups.size > 1) {
    wrongMerges++
    console.log(`WRONG MERGE story "${s.headline}": groups ${[...groups].join(', ')}`)
  }
}

const totalUsd = Object.values(ledger).reduce((n, c) => n + c.usd, 0)
const metrics = {
  ran_at: new Date().toISOString(),
  duration_ms: Date.now() - started,
  sources_total: entries.length,
  sources_ready: processed.length,
  sources_failed_cache: results.filter((r) => r.status.startsWith('cache:')).length,
  sources_failed_pipeline: results.filter((r) => r.status === 'error').length,
  duplicates_exact: results.filter((r) => r.status === 'duplicate').length,
  stories: allStories.length,
  multi_source_stories: allStories.filter((s) => s.sourceIds.length > 1).length,
  labeled_sources: labeledSources,
  missed_merges: missedMerges,
  wrong_merges: wrongMerges,
  dup_story_rate: labeledSources ? Math.round((missedMerges / labeledSources) * 1000) / 1000 : 0,
  cost: ledger,
  total_usd: Math.round(totalUsd * 10_000) / 10_000,
}

const outDir = `eval/out/${new Date().toISOString().replace(/[:.]/g, '-')}`
mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/metrics.json`, JSON.stringify(metrics, null, 2))
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 2))
writeFileSync(
  `${outDir}/stories.json`,
  JSON.stringify(
    allStories.map((s) => ({ id: s.id, headline: s.headline, topic: s.topic, sources: s.sourceIds.length, claims: (s.claims as unknown[]).length })),
    null,
    2,
  ),
)
console.log('\nmetrics:', JSON.stringify(metrics, null, 2))
console.log(`artifacts: ${outDir} | inspect stories: pnpm inspect stories`)
process.exit(0)
