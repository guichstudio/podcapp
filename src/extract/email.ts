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
  // Advisory, like the web extractor since 2026-09-04, and for a sharper reason
  // here: a newsletter is short paragraphs and link text, a forwarded thread is
  // quoted lines, a message shared from Mail is a few sentences -- prose density
  // reads all three as thin, and the threshold refused a message a reader had
  // deliberately picked. The score travels to the editor instead, which can
  // weigh it against the claims. An empty body still fails above: that is the
  // real failure, and it is checked by presence, not by score.
  const quality = scoreExtraction(text)
  return { ok: true, extraction: { clean_text: text, title: subject || undefined, quality, raw: { subject } } }
}
