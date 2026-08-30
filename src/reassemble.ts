import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assemble, mp3DurationSec } from './audio/assemble.js'

// Rebuilds episode.mp3 from already-synthesized chapters: no TTS credits spent.
//   pnpm reassemble <chapters-dir>

const dir = process.argv[2]
if (!dir) throw new Error('usage: pnpm reassemble <chapters-dir>')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.mp3'))
  .sort()
const chapters = files.map((f) => readFileSync(join(dir, f)))
if (chapters.length === 0) throw new Error(`no mp3 chapters in ${dir}`)

const before = chapters.reduce((n, c) => n + mp3DurationSec(c), 0)
const result = assemble(chapters)
const out = join(dirname(dir), 'episode.mp3')
writeFileSync(out, result.audio)

console.log(`
chapters   ${files.length}
method     ${result.method}
duration   ${Math.floor(result.durationSec / 60)}m${String(result.durationSec % 60).padStart(2, '0')}s (chapters alone: ${before}s, gaps add ${result.durationSec - before}s)
size       ${(result.audio.length / 1e6).toFixed(1)} MB
output     ${out}
`)
