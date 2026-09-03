import { MIN_TRANSCRIPT_CHARS, SCRIBE_MODEL, env } from '../config.js'
import type { ExtractResult } from '../core/types.js'
import { logger } from '../log.js'
import { scoreExtraction } from './quality.js'

const API = 'https://api.elevenlabs.io/v1/speech-to-text'

// Only hosts where a link is unambiguously a piece of speech. Instagram and X
// are deliberately absent: a reel is video but a post is text, and their pages
// carry the caption -- which is usually the thing worth hearing about. Sending
// every X link to a paid transcriber would spend money to get less.
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

/// The first rung of ARCHITECTURE's transcript ladder: the platform's own
/// captions, which are free.
///
/// It returns null because the rung is currently closed, and that was measured
/// on 2026-09-03 rather than assumed. The watch page still lists 41 caption
/// tracks, but every track's baseUrl now answers 200 with an empty body --
/// timedtext wants a proof-of-origin token bound to a player session -- and the
/// InnerTube player endpoint answers 400 for the mobile clients and UNPLAYABLE
/// for the web one. Reaching them again means yt-dlp's machinery: rotating
/// client versions and PO tokens, which break every few weeks.
///
/// Left as a function rather than deleted so the ladder is visible in the code
/// and the cheap rung can be reconnected without rearranging anything.
async function platformCaptions(_url: string): Promise<string | null> {
  return null
}

/// The second rung: ElevenLabs Scribe, which takes the URL directly. Nothing is
/// downloaded, converted or stored on our side -- the platform serves them, not
/// us -- which is also what keeps this clear of the App Store's rule about
/// third-party media.
async function transcribe(url: string): Promise<{ text: string; lang?: string | undefined; seconds?: number | undefined }> {
  const form = new FormData()
  form.append('model_id', SCRIBE_MODEL)
  form.append('source_url', url)
  const res = await fetch(API, { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: form })
  if (!res.ok) throw new Error(`scribe ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as {
    text?: string
    language_code?: string
    words?: { end?: number }[]
  }
  const words = body.words ?? []
  return {
    text: (body.text ?? '').trim(),
    lang: body.language_code,
    seconds: words.length ? words[words.length - 1]?.end : undefined,
  }
}

/// A video source: what was SAID, not the page around it.
///
/// This is why the branch exists. Fetching a YouTube page as a page returns the
/// description, the sidebar and the comments -- measured at 31,103 characters
/// for a TED talk, whose longest lines were other viewers' opinions. A briefing
/// that promises every sentence is checked against its source cannot be written
/// from the comment section.
export async function extractVideo(url: string): Promise<ExtractResult> {
  let text: string
  let lang: string | undefined
  let seconds: number | undefined
  let rung: 'captions' | 'scribe'

  const captions = await platformCaptions(url)
  if (captions) {
    text = captions
    rung = 'captions'
  } else {
    try {
      const spoken = await transcribe(url)
      text = spoken.text
      lang = spoken.lang
      seconds = spoken.seconds
      rung = 'scribe'
    } catch (err) {
      // A private, deleted or region-locked video is a readable failure, not a
      // crash: the outro names it and moves on.
      return { ok: false, status: 'extraction_failed', error: `transcription failed: ${(err as Error).message}` }
    }
  }

  if (text.length < MIN_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      status: 'low_quality',
      error: `only ${text.length} characters of speech, under ${MIN_TRANSCRIPT_CHARS} (a clip too short to say anything)`,
    }
  }

  logger.info({ url, rung, chars: text.length, seconds }, 'video transcribed')
  return {
    ok: true,
    extraction: {
      clean_text: text,
      quality: scoreExtraction(text),
      lang,
      raw: { transcript_source: rung, seconds },
    },
  }
}
