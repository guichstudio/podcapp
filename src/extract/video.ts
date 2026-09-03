import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MAX_TRANSCRIBE_SECONDS, MIN_TRANSCRIPT_CHARS, SCRIBE_MODEL, env } from '../config.js'
import type { ExtractResult } from '../core/types.js'
import { logger } from '../log.js'
import { scoreExtraction } from './quality.js'

const run = promisify(execFile)

// Installed into the image by the yt-dlp build extension; overridable so a
// laptop can point at its own copy.
const YTDLP = process.env.YTDLP_PATH ?? 'yt-dlp'
const SCRIBE = 'https://api.elevenlabs.io/v1/speech-to-text'

// Only hosts where a link is unambiguously a piece of speech. Instagram and X
// are deliberately absent: a reel is video but a post is text, and their pages
// carry the caption -- which is usually the thing worth hearing about. Sending
// every X link to a per-minute transcriber would spend money to get less.
const VIDEO_PATTERNS: RegExp[] = [
  /^(www\.|m\.)?youtube\.com\/(watch|shorts|live)\b/,
  /^(www\.)?youtu\.be\/[\w-]+/,
  /^(www\.)?tiktok\.com\/.+\/video\//,
  /^(www\.)?vimeo\.com\/\d+/,
  /^(www\.)?dailymotion\.com\/video\//,
]

export function isVideoUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return VIDEO_PATTERNS.some((p) => p.test(url.host + url.pathname))
  } catch {
    return false
  }
}

interface Probe {
  duration?: number | undefined
  title?: string | undefined
  language?: string | undefined
  subtitles: string[]
  automatic: string[]
}

// execFile, never a shell: the URL comes from whatever the reader shared.
async function ytDlp(args: string[], timeoutMs: number): Promise<string> {
  const { stdout } = await run(YTDLP, ['--no-warnings', '--no-playlist', ...args], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

async function probe(url: string): Promise<Probe> {
  const raw = await ytDlp(['--skip-download', '-J', url], 60_000)
  const meta = JSON.parse(raw) as {
    duration?: number
    title?: string
    language?: string
    subtitles?: Record<string, unknown>
    automatic_captions?: Record<string, unknown>
  }
  return {
    duration: meta.duration,
    title: meta.title,
    language: meta.language,
    subtitles: Object.keys(meta.subtitles ?? {}),
    automatic: Object.keys(meta.automatic_captions ?? {}),
  }
}

/// Which subtitle track to ask for, cheapest and truest first.
///
/// The video's own language before English: the writer translates from claims
/// anyway, so a track in the original is a better source than someone's
/// translation of it. A track written by a human before one written by a
/// recogniser, for the same reason.
function pickTrack(meta: Probe): { lang: string; auto: boolean } | null {
  const wanted = [meta.language, 'en', 'fr'].filter((l): l is string => !!l)
  const match = (list: string[], lang: string) =>
    list.find((code) => code === lang || code.startsWith(`${lang}-`))
  for (const lang of wanted) {
    const manual = match(meta.subtitles, lang)
    if (manual) return { lang: manual, auto: false }
  }
  for (const lang of wanted) {
    const auto = match(meta.automatic, lang)
    if (auto) return { lang: auto, auto: true }
  }
  return null
}

/// WebVTT to prose: drop the cue numbers, the timings and the inline karaoke
/// tags, and collapse the repeats auto-captions emit as a line scrolls.
export function vttToText(vtt: string): string {
  const out: string[] = []
  for (const line of vtt.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('WEBVTT') || s.startsWith('Kind:') || s.startsWith('Language:') || s.startsWith('NOTE')) continue
    if (s.includes('-->') || /^\d+$/.test(s)) continue
    const clean = s.replace(/<[^>]+>/g, '').trim()
    if (!clean || out[out.length - 1] === clean) continue
    out.push(clean)
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

async function fetchSubtitles(url: string, track: { lang: string; auto: boolean }, dir: string): Promise<string | null> {
  await ytDlp(
    [
      '--skip-download',
      track.auto ? '--write-auto-subs' : '--write-subs',
      '--sub-langs',
      track.lang,
      '--sub-format',
      'vtt/best',
      '-o',
      join(dir, 'subs.%(ext)s'),
      url,
    ],
    120_000,
  )
  const file = (await readdir(dir)).find((f) => f.endsWith('.vtt'))
  if (!file) return null
  const text = vttToText(await readFile(join(dir, file), 'utf8'))
  return text || null
}

/// The paid rung. Downloaded rather than handed over as a URL: ElevenLabs can
/// take a source_url, but YouTube and TikTok block its fetcher -- measured at
/// one success in eight, and the success was a 2005 clip. yt-dlp gets the audio
/// that ElevenLabs cannot.
async function transcribeAudio(url: string, dir: string): Promise<string> {
  await ytDlp(['-f', 'bestaudio/best', '-o', join(dir, 'audio.%(ext)s'), url], 600_000)
  const file = (await readdir(dir)).find((f) => f.startsWith('audio.'))
  if (!file) throw new Error('yt-dlp produced no audio file')
  const path = join(dir, file)
  const size = (await stat(path)).size

  const form = new FormData()
  form.append('model_id', SCRIBE_MODEL)
  form.append('file', new Blob([await readFile(path)]), file)
  const res = await fetch(SCRIBE, { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: form })
  if (!res.ok) throw new Error(`scribe ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { text?: string }
  logger.info({ bytes: size }, 'audio transcribed')
  return (body.text ?? '').trim()
}

/// A video source: what was SAID, not the page around it.
///
/// This is why the branch exists at all. Fetching a video's page as a page
/// succeeds and returns the wrong thing -- a TED talk came back as 31,103
/// characters whose longest lines were viewers' comments -- and a briefing that
/// promises every sentence is checked against its source cannot be written from
/// a comment section. The same talk's own subtitle track is 12,360 characters
/// of the talk.
export async function extractVideo(url: string): Promise<ExtractResult> {
  const dir = await mkdtemp(join(tmpdir(), 'podcapp-video-'))
  try {
    let meta: Probe
    try {
      meta = await probe(url)
    } catch (err) {
      return { ok: false, status: 'extraction_failed', error: `could not read the video: ${message(err)}` }
    }

    let text: string | null = null
    let rung: 'captions' | 'scribe' = 'captions'

    const track = pickTrack(meta)
    if (track) {
      try {
        text = await fetchSubtitles(url, track, dir)
      } catch (err) {
        // A missing track is not a failure of the source: fall through and pay.
        logger.warn({ url, track, err: message(err) }, 'subtitles unavailable, falling back')
      }
    }

    if (!text) {
      // The only rung that costs money, so the guard sits here rather than at
      // the top: a video with subtitles is free at any length.
      if (meta.duration && meta.duration > MAX_TRANSCRIBE_SECONDS) {
        return {
          ok: false,
          status: 'unsupported',
          error: `no subtitles and ${Math.round(meta.duration / 60)} minutes long, over the ${Math.round(MAX_TRANSCRIBE_SECONDS / 60)}-minute transcription limit`,
        }
      }
      try {
        text = await transcribeAudio(url, dir)
        rung = 'scribe'
      } catch (err) {
        return { ok: false, status: 'extraction_failed', error: `transcription failed: ${message(err)}` }
      }
    }

    if (text.length < MIN_TRANSCRIPT_CHARS) {
      return {
        ok: false,
        status: 'low_quality',
        error: `only ${text.length} characters of speech, under ${MIN_TRANSCRIPT_CHARS} (a clip too short to say anything)`,
      }
    }

    logger.info({ url, rung, chars: text.length, seconds: meta.duration }, 'video read')
    return {
      ok: true,
      extraction: {
        clean_text: text,
        title: meta.title,
        lang: meta.language,
        quality: scoreExtraction(text),
        raw: { transcript_source: rung, seconds: meta.duration },
      },
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  // yt-dlp puts the useful line on stderr; keep it, it names the real reason
  // (private video, region lock, "please update yt-dlp").
  return text.split('\n').slice(-3).join(' ').slice(0, 300)
}
