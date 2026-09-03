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

// A page has to be long enough to BE an article, whatever it scores.
//
// The quality heuristic answers "is this a piece of writing"; it cannot answer
// "is this the piece of writing I asked for". YouTube's anti-bot interstitial
// -- "Our systems have detected unusual traffic from your computer network" --
// is 378 characters of perfectly well-formed prose and scored 0.58, sailed past
// the threshold, and sat in an open story as material for a briefing. Consent
// walls and "page unavailable" notices have the same shape.
//
// Measured on the 66 extracted sources in the database rather than picked: the
// shortest real article is 2,371 characters (a Belgian daily's piece), the
// median is 24,687, and exactly one source falls under 1,200 -- the interstitial.
// So this sits at a sixth of the shortest thing it must keep, which is a gap,
// not a tuning. It is deliberately NOT a change to the quality score, so the
// scores of the cached eval corpus are untouched.
export const MIN_EXTRACTION_CHARS = 1200

// Transcription. A shared video is read for what was SAID, which a page fetch
// cannot give: fetching a TED talk's page returns 31,103 characters of
// description, sidebar and comments, and a briefing must not be written from a
// comment section.
export const SCRIBE_MODEL = 'scribe_v2'

// The article floor above is calibrated on prose and would reject a minute of
// speech. Speech runs about 150 words a minute, so 400 characters is roughly
// twenty-five seconds -- under that there is not enough said to build a claim
// from, and the source says so rather than failing silently.
export const MIN_TRANSCRIPT_CHARS = 400
// Tuned on eval/dataset with jina-embeddings-v5-text-small (2026-08-29): true
// duplicates land at 0.90-0.97 but a meta-source wrongly absorbed stories at
// 0.909; blind merge only above 0.93, the 0.70-0.93 band goes to the adjudicator.
export const SIMILARITY_MERGE = 0.93
export const SIMILARITY_REVIEW = 0.7

export const DEFAULT_TARGET_MINUTES = 5
// Hard ceiling (Louis, 2026-09-01, down from 10): TTS is the cost driver, and
// a briefing should be dense rather than long. Enforced wherever a target is
// read — request body, users.target_minutes, the cron — never trusted.
export const MAX_TARGET_MINUTES = 5
// No episode from a thin pile (Louis, 2026-09-01): fewer than four saved links
// in the open stories and nothing is generated, by hand or by the cron.
export const MIN_SOURCES_PER_EPISODE = 4
// Measured, not assumed, per narrator. French: the 2026-08-29 episode ran
// 1973 words in 842.8s = 140.4 wpm. English (Eric): 67 words in 24.79s on the
// 2026-09-01 listening test = 162 wpm. Used for the estimated_sec metric.
export const WORDS_PER_MINUTE = { fr: 140, en: 162 } satisfies Record<string, number>
export function wordsPerMinute(language: string): number {
  const code = language.trim().toLowerCase().slice(0, 2)
  return (WORDS_PER_MINUTE as Record<string, number | undefined>)[code] ?? WORDS_PER_MINUTE.fr
}

// What the writer is ASKED for, which is not what is measured: v1 asked 150
// and the French voice delivered 140, and that gap is baked into the 4/5
// rubric, so French keeps its number. English asks the measured pace with the
// same slack on top.
export const WRITER_WORDS_PER_MINUTE = { fr: 150, en: 165 } satisfies Record<string, number>
export function writerWordsPerMinute(language: string): number {
  const code = language.trim().toLowerCase().slice(0, 2)
  return (WRITER_WORDS_PER_MINUTE as Record<string, number | undefined>)[code] ?? WRITER_WORDS_PER_MINUTE.fr
}
export const INTRO_OUTRO_SEC = 60

export const PROMPT_VERSIONS = {
  analyzer: 'v2',
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

// The five shelves of the library, plus the one for everything else. Fixed on
// purpose: analysis tags are free text and cannot be filtered on; a category
// is a choice among these, made once by the analyzer and never re-derived.
export const CATEGORIES = ['tech', 'politics', 'history', 'science', 'finance', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

// The narrator per output language. users.voice_id overrides this per user;
// ELEVENLABS_VOICE_ID (set in the Trigger.dev env, where the French voice lives)
// is the fallback for a language with no entry here. `en` was picked by Louis
// on a listening test of five voices over the same passage (2026-09-01), as a
// provisional choice: smooth, American, the closest to the "Jarvis-like" brief.
export const DEFAULT_VOICES: Record<string, string> = {
  en: 'cjVigY5qzO86Huf0OWal', // Eric — smooth, trustworthy, American
}

// What the app's voice picker offers, per language. Only these ids can be
// written to users.voice_id: an arbitrary ElevenLabs id is a cost and a quality
// risk nobody has listened to. English: the 2026-09-01 listening test. French:
// the two voices the project has actually aired with.
export interface VoiceOption { id: string; name: string; style: string; language: string }
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', style: 'documentary', language: 'en' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', style: 'newsroom', language: 'en' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', style: 'broadcaster', language: 'en' },
  { id: 'MAZdzkb78f8SA7DNBT41', name: 'Nico', style: 'parisien', language: 'fr' },
  { id: 'jGGIwkfv43kUFffPXEEO', name: 'Louis', style: 'documentaire', language: 'fr' },
]

export function voiceFor(language: string, override: string | null | undefined): string | undefined {
  return override ?? DEFAULT_VOICES[language.trim().toLowerCase().slice(0, 2)] ?? process.env.ELEVENLABS_VOICE_ID
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

// Le `aud` que doit porter un jeton Apple : notre bundle id, pas un id client.
export const APPLE_AUDIENCE = 'com.louisguichard.podcapp'
// L'id client OAuth iOS du projet Google Cloud. Sans lui, /auth/google refuse.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}
