import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extractWeb } from '../src/extract/web.js'

// Fetch every dataset URL once through the real extractor and commit the result.
// Re-runs skip already-cached ids (delete a cache file to refetch it).

interface UrlEntry {
  id: string
  url: string
  topic: string
  lang: string
  group?: string
  expect_failure?: string
}
interface LocalEntry {
  id: string
  file: string
  title: string
  topic: string
  lang: string
}

const dataset = JSON.parse(readFileSync('eval/dataset/urls.json', 'utf8')) as {
  sources: UrlEntry[]
  local: LocalEntry[]
}

const CACHE_DIR = 'eval/dataset/cache'
mkdirSync(CACHE_DIR, { recursive: true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let ok = 0
let failed = 0
for (const entry of dataset.sources) {
  const path = `${CACHE_DIR}/${entry.id}.json`
  if (existsSync(path)) {
    ok++
    continue
  }
  const result = await extractWeb(entry.url)
  if (result.ok) {
    const { raw: _raw, ...ext } = result.extraction
    writeFileSync(path, JSON.stringify({ ...entry, ok: true, extraction: ext }, null, 2))
    console.log(`ok      ${entry.id} q=${result.extraction.quality} ${entry.url}`)
    ok++
  } else {
    writeFileSync(path, JSON.stringify({ ...entry, ok: false, status: result.status, error: result.error }, null, 2))
    console.log(`FAILED  ${entry.id} ${result.status} ${entry.url} :: ${result.error.slice(0, 120)}`)
    failed++
  }
  await sleep(process.env.JINA_API_KEY ? 700 : 3500)
}

for (const entry of dataset.local) {
  const path = `${CACHE_DIR}/${entry.id}.json`
  if (existsSync(path)) continue
  const text = readFileSync(entry.file, 'utf8')
  writeFileSync(
    path,
    JSON.stringify({ ...entry, ok: true, extraction: { clean_text: text, title: entry.title, quality: 0.9 } }, null, 2),
  )
  console.log(`local   ${entry.id} ${entry.file}`)
}

console.log(`\ncache complete: ${ok} ok, ${failed} failed (failures are part of the dataset: they exercise the failure path)`)
