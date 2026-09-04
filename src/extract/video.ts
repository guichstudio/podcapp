import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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

/// YouTube answers a datacenter address with "Sign in to confirm you're not a
/// bot". Measured 2026-09-03: the identical yt-dlp call that reads a video from
/// a laptop is refused from the Trigger.dev worker, so every video shared from
/// the phone failed in production while the feature passed every test locally.
/// A cookie jar exported from a signed-in browser is yt-dlp's documented answer
/// and the only one that keeps the video's own subtitles -- the free, exact,
/// human-written rung -- reachable from the cloud.
///
/// Optional by design. Without it the ladder still runs and simply fails with a
/// readable reason, because a source this pipeline could not read gets named on
/// air rather than invented.
///
/// The jar is a live credential: written 0600 into the run's own temp directory
/// (removed in the caller's finally), never logged, and never shared between
/// runs -- yt-dlp rewrites the file as the session rotates. Entries are
/// domain-scoped in the Netscape format, so yt-dlp sends a cookie only to the
/// host it came from: handing the jar to a TikTok URL leaks nothing.
export async function cookieJar(dir: string): Promise<string | null> {
  const raw = process.env.YOUTUBE_COOKIES
  if (!raw?.trim()) return null
  const path = join(dir, 'cookies.txt')
  await writeFile(path, raw.endsWith('\n') ? raw : `${raw}\n`, { mode: 0o600 })
  return path
}

// execFile, never a shell: the URL comes from whatever the reader shared.
async function ytDlp(args: string[], timeoutMs: number, cookies: string | null): Promise<string> {
  const jar = cookies ? ['--cookies', cookies] : []
  const { stdout } = await run(YTDLP, ['--no-warnings', '--no-playlist', ...jar, ...args], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

async function probe(url: string, cookies: string | null): Promise<Probe> {
  const raw = await ytDlp(['--skip-download', '-J', url], 60_000, cookies)
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

async function fetchSubtitles(
  url: string,
  track: { lang: string; auto: boolean },
  dir: string,
  cookies: string | null,
): Promise<string | null> {
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
    cookies,
  )
  const file = (await readdir(dir)).find((f) => f.endsWith('.vtt'))
  if (!file) return null
  const text = vttToText(await readFile(join(dir, file), 'utf8'))
  return text || null
}

/// The paid rung. Downloaded rather than handed over as a URL, and the reason
/// is not the one the documentation suggests.
///
/// ElevenLabs documents source_url as accepting "YouTube video URLs, TikTok
/// video URLs, and other video hosting services", and their own product does
/// it. Their API, on this workspace, does not: measured 2026-09-04 over nine
/// distinct videos and three URL shapes (watch?v=, youtu.be, m.youtube.com),
/// every one came back "Failed to download the file from the provided URL
/// (upstream status 400)". The single exception is the 2005 clip every demo
/// uses, which smells like a cache hit rather than a fetch.
///
/// The controls matter more than the failures, because they rule out the
/// explanations one would otherwise chase for an afternoon: a plain public mp3
/// of 342 seconds on our own R2 bucket transcribes fine through the SAME
/// parameter and key, so the fetcher works, the key is sufficient, and neither
/// duration nor synchronous mode is the limit. Music and public-institution
/// videos fail alike, so it is not a copyright filter. It is YouTube, and it is
/// theirs, not ours.
///
/// So yt-dlp gets the audio, and the cookie jar above is what lets it.
async function transcribeAudio(url: string, dir: string, cookies: string | null): Promise<string> {
  await ytDlp(['-f', 'bestaudio/best', '-o', join(dir, 'audio.%(ext)s'), url], 600_000, cookies)
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
    const cookies = await cookieJar(dir)

    let meta: Probe
    try {
      meta = await probe(url, cookies)
    } catch (err) {
      return {
        ok: false,
        status: 'extraction_failed',
        error: `could not read the video: ${accessHint(message(err), cookies !== null)}`,
      }
    }

    let text: string | null = null
    let rung: 'captions' | 'scribe' = 'captions'

    const track = pickTrack(meta)
    if (track) {
      try {
        text = await fetchSubtitles(url, track, dir, cookies)
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
        text = await transcribeAudio(url, dir, cookies)
        rung = 'scribe'
      } catch (err) {
        return {
          ok: false,
          status: 'extraction_failed',
          error: `transcription failed: ${accessHint(message(err), cookies !== null)}`,
        }
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

/// yt-dlp's own words, plus whose problem this is. The distinction is the point
/// of the status line: "Private video" is the reader's, "the jar expired" is
/// ours, and a source row that says only "Sign in to confirm you're not a bot"
/// sends whoever reads it looking in the wrong place -- which is exactly the
/// afternoon this cost.
export function accessHint(text: string, hadCookies: boolean): string {
  // "not a bot" and nothing else. "Sign in to confirm" also opens YouTube's age
  // gate, and the word "cookies" appears in our own --cookies argument: either
  // one would blame the jar for a video the reader simply cannot share.
  if (!/not a bot/i.test(text)) return text
  return hadCookies
    ? `${text} — the YOUTUBE_COOKIES jar was sent and refused: export it again`
    : `${text} — no YOUTUBE_COOKIES set, so this went out unauthenticated from a datacenter address`
}

export function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  const lines = text
    .split('\n')
    .filter(
      (l) =>
        l.trim() &&
        // execFile prefixes the failure with the whole argv, which carries
        // --cookies and the jar's path.
        !l.startsWith('Command failed:') &&
        // yt-dlp echoes a rejected jar entry -- cookie NAME AND VALUE -- and
        // writes it straight to stderr, where --no-warnings cannot reach it.
        // A jar pasted through a web field with its tabs turned to spaces
        // produces one such line per cookie. This string is persisted to
        // sources.error and handed to the app by GET /sources, so a live
        // session cookie would be displayed in the Sources screen.
        !/skipping cookie file entry/i.test(l),
    )
  // Something must always be said: a killed or timed-out child leaves empty
  // stderr, and the argv we just dropped was the only text in the message.
  if (!lines.length) return 'yt-dlp produced no output (it was killed, or it timed out)'
  // yt-dlp puts the useful line on stderr; keep it, it names the real reason
  // (private video, region lock, "please update yt-dlp"). The jar's path can
  // still appear inside that line -- yt-dlp quotes the file it failed to read.
  return lines.slice(-3).join(' ').replace(/\S*podcapp-video-\S+/g, '<jar>').slice(0, 300)
}
