import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assemble } from './audio/assemble.js'
import { logger } from './log.js'
import { DEFAULT_TTS_MODEL, elevenlabs } from './speech/elevenlabs.js'
import type { SpeechChapter } from './speech/provider.js'

// Renders a script to audio:
//   pnpm tts <script.json|script.md> --voice <id> [--model <id>]
// Chapters are stored individually next to the episode so a single bad chapter
// can be regenerated without paying for the whole run again.

const args = process.argv.slice(2)
const scriptPath = args[0]
if (!scriptPath) throw new Error('usage: pnpm tts <script.json|script.md> --voice <voiceId>')

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const voiceId = flag('voice') ?? process.env.ELEVENLABS_VOICE_ID
if (!voiceId) throw new Error('missing --voice <voiceId> (or ELEVENLABS_VOICE_ID)')
const modelId = flag('model') ?? DEFAULT_TTS_MODEL

function loadChapters(path: string): SpeechChapter[] {
  const raw = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) {
    const parsed = JSON.parse(raw) as { chapters: { title: string; text: string }[] }
    return parsed.chapters.map((c) => ({ title: c.title, text: c.text.trim() }))
  }
  // Markdown: "## Title" starts a chapter, everything until the next heading is its text.
  const chapters: SpeechChapter[] = []
  let current: SpeechChapter | null = null
  for (const line of raw.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/)
    if (heading?.[1]) {
      if (current?.text.trim()) chapters.push({ ...current, text: current.text.trim() })
      current = { title: heading[1].trim(), text: '' }
      continue
    }
    if (line.startsWith('#')) continue
    if (current) current.text += `${line}\n`
  }
  if (current?.text.trim()) chapters.push({ ...current, text: current.text.trim() })
  return chapters
}

const chapters = loadChapters(scriptPath)
if (chapters.length === 0) throw new Error(`no chapters found in ${scriptPath}`)
const totalChars = chapters.reduce((n, c) => n + c.text.length, 0)
logger.info({ chapters: chapters.length, totalChars, voiceId, modelId }, 'starting tts')

const rendered = await elevenlabs.synthesize(chapters, { voiceId, modelId })

const outDir = join(dirname(scriptPath), `${basename(scriptPath).replace(/\.(json|md)$/, '')}-audio`)
mkdirSync(join(outDir, 'chapters'), { recursive: true })
for (const chapter of rendered) {
  writeFileSync(join(outDir, 'chapters', `${String(chapter.index).padStart(2, '0')}.mp3`), chapter.audio)
}

const { audio, durationSec, method } = assemble(rendered.map((c) => c.audio))
const episodePath = join(outDir, 'episode.mp3')
writeFileSync(episodePath, audio)

const minutes = Math.floor(durationSec / 60)
console.log(`
chapters   ${rendered.length}
characters ${totalChars} (~$${((totalChars / 1000) * 0.15).toFixed(2)} at multilingual_v2 rates)
duration   ${minutes}m${String(durationSec % 60).padStart(2, '0')}s
assembly   ${method}${method === 'concat' ? ' (no ffmpeg: no loudnorm, tight chapter joins)' : ''}
output     ${episodePath}
`)
process.exit(0)
