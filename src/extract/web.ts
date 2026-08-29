import { JINA_READER_BASE, MIN_EXTRACTION_QUALITY } from '../config.js'
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

  const quality = scoreExtraction(content)
  if (quality < MIN_EXTRACTION_QUALITY) {
    return {
      ok: false,
      status: 'low_quality',
      error: `extraction quality ${quality} below ${MIN_EXTRACTION_QUALITY} (paywall, listing page or thin content)`,
      raw: payload,
    }
  }
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
