// All tunable constants. Swapping a stage's model must never require code changes.

export const MODELS = {
  analyze:    { provider: 'deepseek',  model: 'deepseek-chat' },
  adjudicate: { provider: 'deepseek',  model: 'deepseek-chat' },
  editorial:  { provider: 'deepseek',  model: 'deepseek-reasoner' },
  ground:     { provider: 'deepseek',  model: 'deepseek-chat' },
  write:      { provider: 'anthropic', model: 'claude-sonnet-5' },
  edit:       { provider: 'anthropic', model: 'claude-sonnet-5' },
  embed:      { provider: 'openai',    model: 'text-embedding-3-small' },
} as const

export type Stage = keyof typeof MODELS

export const EMBEDDING_DIMS = 1536

export const MIN_EXTRACTION_QUALITY = 0.35
export const SIMILARITY_MERGE = 0.86
export const SIMILARITY_REVIEW = 0.7

export const DEFAULT_TARGET_MINUTES = 15
export const WORDS_PER_MINUTE = 150
export const INTRO_OUTRO_SEC = 60

export const PROMPT_VERSIONS = {
  analyzer: 'v1',
  adjudicate: 'v1',
} as const

// USD per 1M tokens; kept close to provider price sheets, updated by hand.
export const PRICING: Record<string, { in: number; out: number }> = {
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
}

export const JINA_READER_BASE = 'https://r.jina.ai/'

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}
