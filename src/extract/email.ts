import { MIN_EXTRACTION_QUALITY } from '../config.js'
import type { ExtractResult } from '../core/types.js'
import { scoreExtraction } from './quality.js'

// Forwarded newsletter HTML -> readable text. Deliberately simple: strip
// non-content blocks and tags, keep line structure and link targets out.
export function extractEmail(html: string, subject?: string): ExtractResult {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!text) return { ok: false, status: 'extraction_failed', error: 'empty email body after HTML stripping' }
  const quality = scoreExtraction(text)
  if (quality < MIN_EXTRACTION_QUALITY) {
    return { ok: false, status: 'low_quality', error: `email extraction quality ${quality} below ${MIN_EXTRACTION_QUALITY}` }
  }
  return { ok: true, extraction: { clean_text: text, title: subject || undefined, quality, raw: { subject } } }
}
