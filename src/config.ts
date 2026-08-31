// All tunable constants. Swapping a stage's model must never require code changes.

// Model ids verified against the live DeepSeek /models endpoint on 2026-08-29:
// deepseek-v4-flash, deepseek-v4-pro. Embeddings run on Jina (free tier), the
// same account whose key raises Reader rate limits for extraction.
export const MODELS = {
  analyze:    { provider: 'deepseek',  model: 'deepseek-v4-flash', thinking: false },
  adjudicate: { provider: 'deepseek',  model: 'deepseek-v4-flash', thinking: false },
  editorial:  { provider: 'deepseek',  model: 'deepseek-v4-pro', thinking: true },
  ground:     { provider: 'deepseek',  model: 'deepseek-v4-flash', thinking: false },
  write:      { provider: 'anthropic', model: 'claude-sonnet-5' },
  edit:       { provider: 'anthropic', model: 'claude-sonnet-5' },
  embed:      { provider: 'jina',      model: 'jina-embeddings-v5-text-small' },
} as const

export type Stage = keyof typeof MODELS

// jina-embeddings-v3 native dimension. Must match the literal in src/db/schema.ts.
export const EMBEDDING_DIMS = 1024

export const MIN_EXTRACTION_QUALITY = 0.35
// Tuned on eval/dataset with jina-embeddings-v5-text-small (2026-08-29): true
// duplicates land at 0.90-0.97 but a meta-source wrongly absorbed stories at
// 0.909; blind merge only above 0.93, the 0.70-0.93 band goes to the adjudicator.
export const SIMILARITY_MERGE = 0.93
export const SIMILARITY_REVIEW = 0.7

export const DEFAULT_TARGET_MINUTES = 10
// Hard ceiling (Louis, 2026-08-31): TTS is the cost driver, and a briefing
// should be dense rather than long.
export const MAX_TARGET_MINUTES = 10
// Measured, not assumed: the 2026-08-29 episode ran 1973 words in 842.8s of
// ElevenLabs multilingual_v2 French speech = 140.4 wpm.
export const WORDS_PER_MINUTE = 140
export const INTRO_OUTRO_SEC = 60

export const PROMPT_VERSIONS = {
  analyzer: 'v1',
  adjudicate: 'v2',
} as const

// USD per 1M tokens; kept close to provider price sheets, updated by hand.
export const PRICING: Record<string, { in: number; out: number }> = {
  // v4 prices assumed at v3 chat/reasoner levels until checked on the price page;
  // the ledger is an order-of-magnitude guardrail, the balance page is the truth.
  'deepseek-v4-flash': { in: 0.27, out: 1.1 },
  'deepseek-v4-pro': { in: 0.55, out: 2.19 },
  'gpt-5-mini': { in: 0.25, out: 2 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'jina-embeddings-v5-text-small': { in: 0.02, out: 0 },
}

// ElevenLabs multilingual_v2 list price. TTS dominates the cost of an episode
// (§6), so its characters and dollars are recorded next to the LLM breakdown.
export const TTS_USD_PER_1K_CHARS = 0.15

// Absolute origin the API is reachable at. Podcast clients fetch the feed and
// the audio from outside the process, so enclosure URLs can never be relative.
// Set it to the public hostname in production; the storage layer builds its
// public URLs from the same variable.
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:8787').replace(/\/+$/, '')

export const JINA_READER_BASE = 'https://r.jina.ai/'

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}
