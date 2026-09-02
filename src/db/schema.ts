import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
// Must match EMBEDDING_DIMS in src/config.ts (kept literal here: drizzle-kit's
// CJS loader cannot follow the ESM import).
const EMBEDDING_DIMS = 1024

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
  // Nullable depuis l'arrivee de Sign in with Apple : Apple peut n'envoyer
  // aucune adresse si l'utilisateur la masque et qu'aucun relais n'est cree.
  email: text('email').unique(),
  apiToken: text('api_token').unique().notNull(),
  rssToken: text('rss_token').unique().notNull(),
  // Null for every Apple/Google-only account -- that is the normal state, not
  // an error. Set only by `pnpm inspect set-password` for the App Review
  // reviewer account (see POST /auth/password). Self-describing so the cost
  // can be raised later without a migration that cannot tell old rows from
  // new: "pbkdf2-sha256$<iterations>$<saltB64url>$<hashB64url>" (src/auth/password.ts).
  password: text('password'),
  // Consecutive-failure counter and lockout deadline for POST /auth/password
  // (src/auth/password.ts). Reset to 0 / null on a successful sign-in.
  passwordFailCount: integer('password_fail_count').notNull().default(0),
  passwordLockedUntil: timestamp('password_locked_until', { withTimezone: true }),
  outputLanguage: text('output_language').notNull().default('fr'),
  voiceId: text('voice_id'),
  targetMinutes: integer('target_minutes').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const identities = pgTable(
  'identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'apple' | 'google'
    provider: text('provider').notNull(),
    // Le claim `sub` du fournisseur : stable, opaque, propre a notre app.
    subject: text('subject').notNull(),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ providerSubject: unique('identities_provider_subject').on(t.provider, t.subject) }),
)

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').unique().notNull(),
  deviceName: text('device_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
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
    // One of config.CATEGORIES, written by the analyzer. Null on rows analysed
    // before it existed; the library files those under no shelf.
    category: text('category'),
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
  // The category of the first source that opened the story; a category-scoped
  // episode selects on it.
  category: text('category'),
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
  audioBytes: integer('audio_bytes'),
  // The per-sentence verification report. It lives here rather than as a run
  // artifact on the bucket: the bucket is public (podcast clients must fetch
  // audio anonymously) and an episode id is published in the feed, so anything
  // stored there is readable by anyone holding the feed URL.
  grounding: jsonb('grounding'),
  cost: jsonb('cost'),
  promptVersions: jsonb('prompt_versions'),
  failedStage: text('failed_stage'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [
    // One live generation per user, enforced where the check-then-insert race
    // cannot be: POST /episodes and the daily cron both read active rows and
    // then insert, without a transaction (the neon-http driver cannot hold
    // one), so two concurrent requests would otherwise both pay writer + TTS.
    uniqueIndex('episodes_one_active_per_user')
      .on(t.userId)
      .where(sql`status not in ('ready', 'failed')`),
  ],
)

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
