import { JINA_READER_BASE, MIN_EXTRACTION_CHARS } from '../config.js'
import type { ExtractResult } from '../core/types.js'
import { scoreExtraction } from './quality.js'

interface JinaData {
  title?: string
  content?: string
  publishedTime?: string
  [k: string]: unknown
}

// Jina Reader first. A Playwright + Readability fallback for pages Jina cannot
// read is planned for when the eval dataset shows it is needed; until then a
// low-quality result gets an honest status, never a silent pass-through.
export async function extractWeb(url: string): Promise<ExtractResult> {
  let res: Response
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`
    res = await fetch(`${JINA_READER_BASE}${url}`, { headers, signal: AbortSignal.timeout(45_000) })
  } catch (e) {
    return { ok: false, status: 'extraction_failed', error: `fetch failed: ${String(e).slice(0, 200)}` }
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    const status = res.status === 451 || res.status === 403 ? 'unsupported' : 'extraction_failed'
    return { ok: false, status, error: `jina ${res.status}: ${body}`, raw: body }
  }
  const payload = (await res.json()) as { data?: JinaData }
  const data = payload.data ?? {}
  const content = (data.content ?? '').trim()
  if (!content) return { ok: false, status: 'extraction_failed', error: 'jina returned empty content', raw: payload }

  // Length before quality: an interstitial is short AND well written, so the
  // score cannot catch it and the reason the reader sees should say what
  // actually happened.
  if (content.length < MIN_EXTRACTION_CHARS) {
    return {
      ok: false,
      status: 'low_quality',
      error: `only ${content.length} characters extracted, under ${MIN_EXTRACTION_CHARS} (blocked page, consent wall or a stub)`,
      raw: payload,
    }
  }

  // The score ADVISES, it does not refuse. It reads prose density, and prose
  // density is a poor judge of what a reader meant to save: a transcript, a
  // liveblog, a thread, a page of figures all score badly while carrying
  // exactly what the listener wanted. Blocking on it dropped real material
  // silently, which is the opposite of this pipeline's promise -- it exists to
  // NAME what it could not read, not to quietly bin what it read poorly.
  //
  // What still refuses is the length gate above, and it is the sharper tool:
  // an anti-bot page or a consent wall is SHORT, and no amount of prose
  // scoring separates a thin article from "Page unavailable" the way a
  // character count does.
  //
  // The score travels on instead: `extraction_quality` on the row, and the
  // weakest source's score in the editorial digest, where the editor is told
  // to hedge the angle or drop the story on thin evidence. A judgement made
  // with the claims in front of it beats a threshold that never saw them.
  const quality = scoreExtraction(content)
  return {
    ok: true,
    extraction: {
      clean_text: content,
      title: data.title || undefined,
      published_at: data.publishedTime || undefined,
      quality,
      raw: payload,
    },
  }
}
