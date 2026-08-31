import { randomUUID } from 'node:crypto'
import { createStorage } from './index.js'

// Proves the configured storage driver actually works before an episode depends
// on it: writes an object, reads it back, checks the public URL is really public.
//   pnpm storage:check

const storage = createStorage()
const key = `checks/${randomUUID()}.txt`
const body = Buffer.from(`podcapp storage check ${new Date().toISOString()}`, 'utf8')

console.log(`driver     ${storage.constructor.name}`)
await storage.put(key, body, 'text/plain')
console.log(`put        ${key} (${body.length} bytes)`)

const read = await storage.get(key)
if (!read) throw new Error(`get returned null for the key just written: ${key}`)
if (!read.equals(body)) throw new Error(`get returned ${read.length} bytes, expected ${body.length}`)
console.log('get        round trip identical')

const missing = await storage.get(`checks/${randomUUID()}.txt`)
if (missing !== null) throw new Error('get of an absent key must return null')
console.log('missing    returns null')

const url = storage.publicUrl(key)
console.log(`url        ${url}`)
if (url.startsWith('http') && !url.includes('localhost')) {
  // The podcast client fetches this URL with no credentials, so anything other
  // than a public 200 means episodes would download as errors in the app.
  const res = await fetch(url)
  const fetched = res.ok ? Buffer.from(await res.arrayBuffer()) : null
  if (!res.ok) {
    throw new Error(`public URL is not public: ${res.status}. The bucket needs public access enabled.`)
  }
  if (!fetched?.equals(body)) throw new Error('public URL served different bytes than were written')
  console.log('public     fetched anonymously, bytes match')
}
console.log('\nstorage OK')
process.exit(0)
