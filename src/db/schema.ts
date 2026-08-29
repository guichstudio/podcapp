import {
  bigserial,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
// Must match EMBEDDING_DIMS in src/config.ts (kept literal here: drizzle-kit's
// CJS loader cannot follow the ESM import).
const EMBEDDING_DIMS = 1536

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMS})`
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value) as number[]
  },
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  apiToken: text('api_token').unique().notNull(),
  rssToken: text('rss_token').unique().notNull(),
  outputLanguage: text('output_language').notNull().default('fr'),
  voiceId: text('voice_id'),
  targetMinutes: integer('target_minutes').notNull().default(15),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    url: text('url'),
    canonicalUrl: text('canonical_url'),
    sourceHash: text('source_hash').notNull(),
    title: text('title'),
    author: text('author'),
    publisher: text('publisher'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    lang: text('lang'),
    raw: jsonb('raw'),
    cleanText: text('clean_text'),
    analysis: jsonb('analysis'),
    embedding: vector('embedding'),
    extractionQuality: real('extraction_quality'),
    status: text('status').notNull().default('received'),
    error: text('error'),
  },
  (t) => [unique().on(t.userId, t.sourceHash)],
)

export const stories = pgTable('stories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  headline: text('headline').notNull(),
  topic: text('topic'),
  sourceIds: uuid('source_ids').array().notNull(),
  claims: jsonb('claims').notNull().default([]),
  embedding: vector('embedding'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('open'),
})

export const episodes = pgTable('episodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull().default('briefing'),
  title: text('title'),
  status: text('status').notNull().default('queued'),
  targetSec: integer('target_sec').notNull(),
  actualSec: integer('actual_sec'),
  storyIds: uuid('story_ids').array().notNull().default([]),
  outline: jsonb('outline'),
  script: jsonb('script'),
  audioUrl: text('audio_url'),
  cost: jsonb('cost'),
  promptVersions: jsonb('prompt_versions'),
  failedStage: text('failed_stage'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const explainedConcepts = pgTable(
  'explained_concepts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    concept: text('concept').notNull(),
    lastExplainedAt: timestamp('last_explained_at', { withTimezone: true }).notNull(),
    episodeId: uuid('episode_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.concept] })],
)

export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id'),
  name: text('name').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
