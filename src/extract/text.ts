import type { ExtractResult } from '../core/types.js'
import { scoreExtraction } from './quality.js'

export function extractText(text: string): ExtractResult {
  const clean = text.trim()
  if (!clean) return { ok: false, status: 'extraction_failed', error: 'empty text submission' }
  return { ok: true, extraction: { clean_text: clean, quality: Math.max(scoreExtraction(clean), 0.5), raw: null } }
}
