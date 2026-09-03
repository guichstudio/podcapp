import { neon } from '@neondatabase/serverless'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { Hono, type Context } from 'hono'
import { handle } from 'hono/vercel'
import { z } from 'zod'
import { ScriptSchema, type Script } from '../src/core/types.js'
import { CATEGORIES, MAX_TARGET_MINUTES, MIN_SOURCES_PER_EPISODE, VOICE_OPTIONS, voiceFor } from '../src/config.js'
import { feedKey } from '../src/rss/feed.js'
import { countAvailableSources, hasEnoughSources, shortageMessage } from '../src/jobs/material.js'
import { privacyHtml } from '../src/legal/privacy.js'
import { termsHtml } from '../src/legal/terms.js'
import * as schema from '../src/db/schema.js'
import { resolveUserId } from '../src/auth/identity.js'
import { authenticateWithPassword } from '../src/auth/password.js'
import { createSession, listSessions, revokeAllSessions, revokeSession, sessionForToken } from '../src/auth/session.js'
import { AuthError, type Provider } from '../src/auth/types.js'
import { verifyIdentityToken } from '../src/auth/verify.js'

// The endpoints that have to be reachable from a phone: capture, and reading
// back what capture produced.
//
// /ingest deliberately does NOT run processSource inline. Extraction and
// analysis take about a minute, and generation takes minutes and shells out to
// ffmpeg; neither belongs in this bundle (which must stay free of the 78 MB
// ffmpeg and the whole audio pipeline). A saved link must be recorded in a few
// hundred milliseconds and never lost.
//
// The durable work is handed to Trigger.dev instead, over its plain HTTP API:
// the SDK needs Node and this function runs on Edge, but a trigger is one
// authenticated fetch. Everything is gated on TRIGGER_SECRET_KEY so the
// laptop-only mode (batch drain on the machine) keeps working unchanged when
// the cloud is not wired up.
//
// Neon over HTTP rather than the node-postgres pool the jobs use: a serverless
// invocation cannot keep a pool alive between requests, and doing so exhausted
// the connection limit and timed the function out in production.
//
// Edge runtime, not Node: under the Node adapter every request that read its
// body hung until the 25s gateway timeout, because Vercel has already consumed
// the raw stream by the time Hono rebuilds a Request from it. On Edge, Hono gets
// the platform Request directly and the Neon HTTP driver works unchanged.

export const config = { runtime: 'edge' }

const { episodes, events, sources, stories, users } = schema

type Conn = ReturnType<typeof db>
// sessionId is null when the caller authenticated with users.api_token (the
// CLI/eval service key) rather than a sessions.token: there is no session row
// to point at, so nothing in the list can be "this one".
type Env = { Variables: { userId: string; conn: Conn; sessionId: string | null } }

// A malformed id reaching a uuid column is a driver error, not an empty result,
// so it is rejected here. Case-insensitive: this guard exists to keep garbage
// away from Postgres, not to enforce the lowercase rendering Postgres prints.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const IngestSchema = z.union([
  z.object({ url: z.string().url() }),
  z.object({ text: z.string().min(1) }),
  z.object({ html: z.string().min(1), subject: z.string().optional() }),
])

const EpisodeRequestSchema = z.object({
  target_min: z.number().int().min(1).max(MAX_TARGET_MINUTES).optional(),
  // One shelf of the library; the four-link rule then applies to that shelf.
  category: z.enum(CATEGORIES).optional(),
})

const SignInSchema = z.object({
  token: z.string().min(1),
  // The raw entropy: the server recomputes its hash and compares it to the
  // token's `nonce` claim. This is what makes an intercepted token unusable.
  nonce: z.string().min(8),
  device_name: z.string().trim().min(1).max(64).default('iPhone'),
})

// App Review needs a way in without an Apple/Google account to sign in with.
// This is a login path, not a signup product: there is no registration
// endpoint here, accounts with a password are provisioned from the CLI
// (`pnpm inspect set-password`), and there is deliberately no "forgot
// password" flow (Postmark is not configured).
const PasswordSignInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  device_name: z.string().trim().min(1).max(64).default('iPhone'),
})

// Every status generateEpisode moves through before landing on ready or failed.
// While one of these is live, a second generation would burn real model and TTS
// money on a briefing nobody asked for twice, so POST /episodes refuses.
const ACTIVE_EPISODE_STATUSES = [
  'queued',
  'selecting',
  'outlining',
  'writing',
  'grounding',
  'editing',
  'tts',
  'assembling',
]

// Trigger.dev answers a trigger with the run it created; the id is all we keep.
const TriggerAckSchema = z.object({ id: z.string().min(1) })

// Hands a payload to a deployed Trigger.dev task over the plain HTTP API and
// returns the run id. Throws with the response text on any failure: callers
// decide whether that is fatal (/episodes) or merely logged (/ingest).
async function triggerTask(taskId: string, payload: Record<string, unknown>, idempotencyKey?: string): Promise<string> {
  const key = process.env.TRIGGER_SECRET_KEY
  if (!key) throw new Error('Missing env var TRIGGER_SECRET_KEY')
  const res = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, ...(idempotencyKey ? { options: { idempotencyKey } } : {}) }),
    // A hung trigger call must fail here, not at the gateway's 25s: past this
    // point the caller cannot tell whether the run was accepted.
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`trigger of ${taskId} answered ${res.status}: ${text}`)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`trigger of ${taskId} answered ${res.status} with a non-JSON body: ${text}`)
  }
  const ack = TriggerAckSchema.safeParse(body)
  if (!ack.success) throw new Error(`trigger of ${taskId} answered without a run id: ${text}`)
  return ack.data.id
}

function db() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Missing env var DATABASE_URL')
  return drizzle(neon(url), { schema })
}

// The analyzer rarely fills `publisher`; the domain is what a reader recognizes.
function publisherOf(publisher: string | null, url: string | null): string | null {
  if (publisher) return publisher
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

// Built from the bucket's public base rather than read from episodes.audio_url:
// rows written before R2 existed still carry a localhost enclosure there.
function audioUrl(base: string, episodeId: string): string {
  return `${base.replace(/\/+$/, '')}/episodes/${episodeId}/episode.mp3`
}

// A queued or failed episode has no mp3, so it gets no url: a link that 404s in
// a player is worse than an episode that plainly says it is not ready.
function readyAudioUrl(base: string, status: string, episodeId: string): string | null {
  return status === 'ready' ? audioUrl(base, episodeId) : null
}

function chaptersOf(script: unknown): Script['chapters'] {
  const parsed = ScriptSchema.safeParse(script)
  return parsed.success ? parsed.data.chapters : []
}

const app = new Hono<Env>()

app.get('/health', (c) => c.json({ ok: true }))

// Public and unauthenticated on purpose: App Store Connect asks for this URL and
// Beta App Review opens it without any credential.
app.get('/privacy', (c) =>
  c.html(privacyHtml(c.req.header('accept-language')), 200, {
    // Vary, or a cache would hand the French page to an English reader.
    'Cache-Control': 'public, max-age=3600',
    Vary: 'Accept-Language',
  }),
)

// Same reasoning as /privacy: an app that lets you create an account has to say
// on what terms, and the reviewer reaches this without credentials.
app.get('/terms', (c) =>
  c.html(termsHtml(c.req.header('accept-language')), 200, {
    'Cache-Control': 'public, max-age=3600',
    Vary: 'Accept-Language',
  }),
)

// Postmark's inbound payload, reduced to what routing and extraction need.
// Everything else Postmark sends is ignored by safeParse.
const PostmarkInboundSchema = z.object({
  FromFull: z.object({ Email: z.string().min(1) }),
  Subject: z.string().optional(),
  HtmlBody: z.string().optional(),
  TextBody: z.string().optional(),
  MessageID: z.string().optional(),
  Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
})

// Routing trusts the From header, which is forgeable. Postmark passes the
// upstream SPF verdict through in the raw headers: an explicit hard fail is
// rejected, everything else (pass, softfail, none, absent) is let through so a
// legitimate forwarder with imperfect DNS never loses mail.
function spfHardFail(headers: { Name: string; Value: string }[] | undefined): boolean {
  if (!headers) return false
  return headers.some(
    (h) => h.Name.toLowerCase() === 'received-spf' && /^\s*fail\b/i.test(h.Value),
  )
}

// Postmark inbound webhook (ARCHITECTURE §7). Registered on the bare app, like
// /health: Postmark cannot send our bearer, so the webhook URL carries a shared
// secret and the SENDER address routes the mail. One inbound address serves
// every beta user; forwarding from the address on your users row is the auth.
// Rejections answer 200 on purpose (a non-2xx would make Postmark retry a mail
// that will never route) and land in events so no failure is silent.
app.post('/ingest/email', async (c) => {
  const secret = process.env.POSTMARK_INBOUND_TOKEN
  if (!secret) return c.json({ error: 'server misconfigured: POSTMARK_INBOUND_TOKEN is not set' }, 500)
  if (c.req.query('token') !== secret) return c.json({ error: 'invalid token' }, 401)

  const parsed = PostmarkInboundSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'not a Postmark inbound payload' }, 400)
  const mail = parsed.data

  const conn = db()
  const from = mail.FromFull.Email.trim().toLowerCase()
  const rejected = async (reason: string, userId?: string) => {
    await conn.insert(events).values({
      userId: userId ?? null,
      name: 'email_inbound_rejected',
      payload: { from, subject: mail.Subject ?? null, messageId: mail.MessageID ?? null, reason },
    })
    return c.json({ accepted: false, reason }, 200)
  }

  if (spfHardFail(mail.Headers)) return rejected('spf hard fail')

  const [user] = await conn
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${from}`)
  if (!user) return rejected('unknown sender')

  const html = mail.HtmlBody?.trim()
  const text = mail.TextBody?.trim()
  if (!html && !text) return rejected('empty body', user.id)

  const [row] = await conn
    .insert(sources)
    .values({
      userId: user.id,
      // Same shapes POST /ingest accepts; processSource routes on the type.
      type: html ? 'email' : 'text',
      raw: html ? { html, subject: mail.Subject } : { text },
      sourceHash: `pending-${crypto.randomUUID()}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)

  // Same contract as /ingest: the row is stored either way; the laptop drain
  // picks it up if the cloud trigger fails.
  let queued = false
  if (process.env.TRIGGER_SECRET_KEY) {
    try {
      await triggerTask('process-source', { sourceId: row.id })
      queued = true
    } catch (err) {
      console.error('process-source trigger failed', row.id, err)
    }
  }
  return c.json({ accepted: true, source_id: row.id, queued }, 200)
})

// Public by necessity: this is where a caller obtains the token the
// authed middleware will demand everywhere else.
async function signIn(c: Context<Env>, provider: Provider) {
  const parsed = SignInSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'expected { token, nonce, device_name? }' }, 400)
  const conn = db()
  try {
    const identity = await verifyIdentityToken({ provider, token: parsed.data.token, rawNonce: parsed.data.nonce })
    const userId = await resolveUserId(conn, identity)
    const token = await createSession(conn, userId, parsed.data.device_name)
    return c.json({ token }, 200)
  } catch (err) {
    // A rejected token and a database outage don't get the same answer: the
    // first is the caller's fault, the second is ours.
    if (err instanceof AuthError) return c.json({ error: 'sign-in rejected' }, 401)
    throw err
  }
}

app.post('/auth/apple', (c) => signIn(c, 'apple'))
app.post('/auth/google', (c) => signIn(c, 'google'))

// Same public-by-necessity reasoning as signIn above, and the same flat 401
// on any failure -- unknown email, no password on the account, wrong
// password, or a lockout still in effect all look identical from the
// outside. See src/auth/password.ts for why and how.
app.post('/auth/password', async (c) => {
  const parsed = PasswordSignInSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'expected { email, password, device_name? }' }, 400)
  const conn = db()
  const result = await authenticateWithPassword(conn, parsed.data.email, parsed.data.password)
  if (!result) return c.json({ error: 'sign-in rejected' }, 401)
  const token = await createSession(conn, result.userId, parsed.data.device_name)
  return c.json({ token }, 200)
})

// Registered before the authed sub-app is mounted: mounting at '/' installs the
// bearer check on '/*', which would otherwise also cover /health.
const authed = new Hono<Env>()

authed.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'missing bearer token' }, 401)
  const conn = db()
  // Session first: it's the front door of the app. api_token is now only a
  // service key for the CLI and the eval runner, never written or read by the app.
  let userId: string | null = null
  let sessionId: string | null = null
  const session = await sessionForToken(conn, token)
  if (session) {
    userId = session.userId
    sessionId = session.id
  } else {
    const [service] = await conn.select({ id: users.id }).from(users).where(eq(users.apiToken, token))
    userId = service?.id ?? null
  }
  if (!userId) return c.json({ error: 'invalid token' }, 401)
  c.set('conn', conn)
  c.set('userId', userId)
  c.set('sessionId', sessionId)
  await next()
})

authed.post('/ingest', async (c) => {
  const parsed = IngestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'expected { url } | { text } | { html, subject }' }, 400)
  }

  const body = parsed.data
  const type = 'url' in body ? 'web' : 'html' in body ? 'email' : 'text'
  const [row] = await c
    .get('conn')
    .insert(sources)
    .values({
      userId: c.get('userId'),
      type,
      url: 'url' in body ? body.url : null,
      raw: 'url' in body ? null : body,
      // The real hash is computed from the extracted text; until then this only
      // has to be unique, since (user_id, source_hash) is a unique index.
      sourceHash: `pending-${crypto.randomUUID()}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)

  // Hand extraction to the cloud when it is wired up. A trigger failure is
  // logged, not returned: the source is already stored as received, which is
  // exactly what the laptop drain picks up, so nothing is lost. `queued` tells
  // the app whether the cloud took the job or the next batch run will.
  let queued = false
  if (process.env.TRIGGER_SECRET_KEY) {
    try {
      await triggerTask('process-source', { sourceId: row.id })
      queued = true
    } catch (err) {
      console.error('process-source trigger failed', row.id, err)
    }
  }
  return c.json({ source_id: row.id, status: 'received', queued }, 202)
})

// The app reports the language its interface resolved to, and the pipeline
// writes and speaks in it from the next episode on. Persisted rather than
// passed per request: the 06:00 cron generates with no app in the loop.
const LanguageSchema = z.object({ language: z.string().trim().min(2).max(8) })


// The account as the app shows it: what the pipeline will do next, and the
// few knobs a user may turn. One shape for GET and PUT so the app has one model.
const MeUpdateSchema = z.object({
  language: z.string().trim().min(2).max(8).optional(),
  voice_id: z.string().trim().min(1).max(64).nullable().optional(),
  target_minutes: z.number().int().min(1).max(MAX_TARGET_MINUTES).optional(),
})

function meView(user: { outputLanguage: string; voiceId: string | null; targetMinutes: number; rssToken: string }) {
  const language = user.outputLanguage.trim().toLowerCase().slice(0, 2)
  const base = (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  return {
    language,
    voice_id: user.voiceId,
    // The narrator the next episode will actually use, override or default.
    voice: voiceFor(language, user.voiceId) ?? null,
    voices: VOICE_OPTIONS,
    target_minutes: Math.min(MAX_TARGET_MINUTES, Math.max(1, user.targetMinutes)),
    max_minutes: MAX_TARGET_MINUTES,
    minimum_sources: MIN_SOURCES_PER_EPISODE,
    daily_at: '06:00',
    // Public by necessity (podcast apps fetch it anonymously); the token in it
    // is the only thing standing between a stranger and your episodes, which
    // is why it only ever travels to the authenticated app.
    feed_url: base ? `${base}/${feedKey(user.rssToken)}` : null,
    // Null until the Postmark inbound address exists; the app hides the row.
    ingest_address: process.env.INGEST_ADDRESS ?? null,
  }
}

authed.get('/me', async (c) => {
  const [user] = await c
    .get('conn')
    .select({ outputLanguage: users.outputLanguage, voiceId: users.voiceId, targetMinutes: users.targetMinutes, rssToken: users.rssToken })
    .from(users)
    .where(eq(users.id, c.get('userId')))
  if (!user) return c.json({ error: 'not found' }, 404)
  return c.json(meView(user))
})

authed.put('/me', async (c) => {
  const parsed = MeUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'expected { language?, voice_id?, target_minutes? }' }, 400)
  const patch: Partial<{ outputLanguage: string; voiceId: string | null; targetMinutes: number }> = {}
  if (parsed.data.language !== undefined) {
    const language = parsed.data.language.slice(0, 2).toLowerCase()
    if (!/^[a-z]{2}$/.test(language)) return c.json({ error: 'unsupported language' }, 400)
    patch.outputLanguage = language
  }
  if (parsed.data.voice_id !== undefined) {
    if (parsed.data.voice_id !== null && !VOICE_OPTIONS.some((v) => v.id === parsed.data.voice_id)) {
      return c.json({ error: 'unknown voice' }, 400)
    }
    patch.voiceId = parsed.data.voice_id
  }
  if (parsed.data.target_minutes !== undefined) patch.targetMinutes = parsed.data.target_minutes
  const conn = c.get('conn')
  const userId = c.get('userId')
  if (Object.keys(patch).length > 0) await conn.update(users).set(patch).where(eq(users.id, userId))
  const [user] = await conn
    .select({ outputLanguage: users.outputLanguage, voiceId: users.voiceId, targetMinutes: users.targetMinutes, rssToken: users.rssToken })
    .from(users)
    .where(eq(users.id, userId))
  if (!user) return c.json({ error: 'not found' }, 404)
  return c.json(meView(user))
})

authed.get('/me/sessions', async (c) => {
  const rows = await listSessions(c.get('conn'), c.get('userId'))
  const sessionId = c.get('sessionId')
  return c.json({
    sessions: rows.map((s) => ({
      id: s.id,
      device_name: s.deviceName,
      created_at: s.createdAt,
      last_seen_at: s.lastSeenAt,
      // Marks the one row the app itself is authenticating with right now, so
      // it can tell its own device apart from the others in the list. Always
      // false when the caller used a service api_token: there is no session
      // row behind that, so nothing in the list is "this one".
      current: sessionId !== null && s.id === sessionId,
    })),
  })
})

authed.delete('/me/sessions/:id', async (c) => {
  const id = c.req.param('id')
  // Same 404 as a foreign id: the requester learns nothing about an id's shape.
  if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404)
  const done = await revokeSession(c.get('conn'), c.get('userId'), id)
  if (!done) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})

// The one route that needs no id: it revokes whichever session the caller is
// authenticating with right now, which is the only thing an app that never
// loaded the device list still knows for certain about itself. This is what
// makes signing out actually end the session server-side, rather than merely
// clearing the app's own copy of a token that stays live forever.
authed.delete('/me/session', async (c) => {
  const sessionId = c.get('sessionId')
  // A caller on the service api_token has no session to revoke: nothing to do.
  if (!sessionId) return c.json({ error: 'not a session' }, 400)
  await revokeSession(c.get('conn'), c.get('userId'), sessionId)
  return c.json({ ok: true })
})

authed.put('/me/language', async (c) => {
  const parsed = LanguageSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'expected { language }' }, 400)
  // Two letters is what the prompts and the RSS language tag want; a phone
  // sends en-US or fr-FR.
  const language = parsed.data.language.slice(0, 2).toLowerCase()
  if (!/^[a-z]{2}$/.test(language)) return c.json({ error: 'unsupported language' }, 400)
  const conn = c.get('conn')
  await conn.update(users).set({ outputLanguage: language }).where(eq(users.id, c.get('userId')))
  return c.json({ language })
})

// App Review 5.1.1(v), and the privacy policy's "erasure is final". Two steps,
// because this function has no bucket client: the durable task erases audio,
// feed, console and rows, and right here both tokens are replaced with values
// nobody holds AND every live session is revoked, so the app, the share
// sheet, every other signed-in device and every podcast client holding the
// feed URL are all locked out before this request even returns. Revoking the
// tokens alone used to be enough, back when the app authenticated with
// api_token; it now authenticates with sessions.token, which the durable job
// below only clears once it deletes the rows -- possibly never, if that job
// fails, since it deletes bucket objects before rows. Revoking every session
// here, synchronously, is what closes that gap.
authed.delete('/me', async (c) => {
  if (!process.env.TRIGGER_SECRET_KEY) {
    return c.json({ error: 'account deletion needs the cloud worker' }, 503)
  }
  const conn = c.get('conn')
  const userId = c.get('userId')
  // Trigger BEFORE revoking. The other way round, a trigger that fails leaves
  // a user locked out of an account that still exists, with no token left to
  // retry with. This way a failure changes nothing; and if the revoke itself
  // fails, the task deletes the row within the minute and the tokens die
  // with it.
  await triggerTask('delete-account', { userId }, `delete-account:${userId}`)
  await conn
    .update(users)
    .set({ apiToken: `revoked:${crypto.randomUUID()}`, rssToken: `revoked:${crypto.randomUUID()}` })
    .where(eq(users.id, userId))
  await revokeAllSessions(conn, userId)
  return c.json({ status: 'deleting' }, 202)
})

authed.post('/episodes', async (c) => {
  if (!process.env.TRIGGER_SECRET_KEY) {
    return c.json(
      { error: 'La génération n’est pas encore reliée au cloud : elle se lance depuis l’ordinateur pour le moment.' },
      503,
    )
  }

  // A missing body means "use my defaults", so it parses as {}.
  const parsed = EpisodeRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: `expected { target_min?: 1..${MAX_TARGET_MINUTES} }` }, 400)

  const conn = c.get('conn')
  const userId = c.get('userId')

  const [user] = await conn
    .select({ targetMinutes: users.targetMinutes, outputLanguage: users.outputLanguage })
    .from(users)
    .where(eq(users.id, userId))
  if (!user) return c.json({ error: 'internal error' }, 500)

  // The rule before the queue: a thin pile is refused with the count, not
  // turned into a two-minute episode.
  const category = parsed.data.category
  const available = await countAvailableSources(conn, userId, category)
  if (!hasEnoughSources(available)) {
    return c.json({ error: shortageMessage(user.outputLanguage, available), available, minimum: MIN_SOURCES_PER_EPISODE, category: category ?? null }, 422)
  }

  // An active row only blocks while its run can still be alive: maxDuration is
  // 900s, so anything older than 30 minutes died without reaching its catch
  // (worker crash, misconfigured env). Left alone it would 409 forever.
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000)
  const actives = await conn
    .select({ id: episodes.id, status: episodes.status, createdAt: episodes.createdAt })
    .from(episodes)
    .where(and(eq(episodes.userId, userId), inArray(episodes.status, ACTIVE_EPISODE_STATUSES)))
  const live = actives.find((a) => a.createdAt > staleBefore)
  if (live) {
    return c.json(
      { error: `Un épisode est déjà en préparation (statut : ${live.status}). Attendez qu’il se termine avant d’en lancer un autre.` },
      409,
    )
  }
  for (const stale of actives) {
    await conn
      .update(episodes)
      .set({ status: 'failed', failedStage: stale.status, error: 'Génération interrompue sans se terminer (délai de 30 minutes dépassé).' })
      .where(and(eq(episodes.id, stale.id), inArray(episodes.status, ACTIVE_EPISODE_STATUSES)))
  }

  // users.target_minutes is written outside this route, so it gets the same
  // bounds as the request body rather than being trusted.
  const targetMin = Math.min(MAX_TARGET_MINUTES, Math.max(1, parsed.data.target_min ?? user.targetMinutes))
  const targetSec = targetMin * 60
  // The select-based guard above gives the friendly message; the partial
  // unique index episodes_one_active_per_user makes it correct under two
  // concurrent requests (no transaction is possible on the HTTP driver).
  let row: { id: string } | undefined
  try {
    ;[row] = await conn
      .insert(episodes)
      .values({ userId, targetSec, status: 'queued' })
      .returning({ id: episodes.id })
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return c.json(
        { error: 'Un épisode est déjà en préparation. Attendez qu’il se termine avant d’en lancer un autre.' },
        409,
      )
    }
    throw err
  }
  if (!row) return c.json({ error: 'insert failed' }, 500)

  try {
    await triggerTask(
      'generate-episode',
      { episodeId: row.id, userId, targetSec, language: user.outputLanguage, ...(category ? { category } : {}) },
      // Keyed on the row: if the ack was lost but the run was accepted, a retry
      // reuses it instead of paying writer and TTS twice.
      `episode-${row.id}`,
    )
  } catch (err) {
    console.error('generate-episode trigger failed', row.id, err)
    // A timeout is NOT a rejection: the run may have been accepted after the
    // abort, and its idempotency key lives on this row. Leaving the row queued
    // keeps the active guard blocking retries while the outcome is unknown;
    // the 30-minute reaper cleans it up if the run truly never started.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return c.json(
        { error: 'Le cloud met trop de temps à répondre. L’épisode reste en file : vérifiez son statut dans quelques minutes.' },
        503,
      )
    }
    // A definite rejection: nothing else will ever pick this row up, and a
    // queued episode nobody will run is a lie.
    const reason = err instanceof Error ? err.message : String(err)
    try {
      await conn
        .update(episodes)
        .set({ status: 'failed', failedStage: 'trigger', error: `Envoi au cloud impossible : ${reason}` })
        .where(eq(episodes.id, row.id))
    } catch (recoveryErr) {
      // The stale-run cutoff above will reap this row on the next attempt.
      console.error('could not record the trigger failure', row.id, recoveryErr)
    }
    return c.json(
      { error: 'Impossible de lancer la génération dans le cloud. Réessayez dans quelques minutes.' },
      503,
    )
  }

  return c.json({ episode_id: row.id, status: 'queued' }, 202)
})

authed.get('/episodes', async (c) => {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) return c.json({ error: 'server misconfigured: R2_PUBLIC_BASE_URL is not set' }, 500)

  // The list only shows chapter titles and source counts, but chapters carry
  // the full spoken text: selecting the script column shipped ~50 complete
  // scripts from Neon through the Edge function on every open of the app. The
  // projection happens in SQL so neither hop pays for the prose.
  const rows = await c
    .get('conn')
    .select({
      id: episodes.id,
      title: episodes.title,
      status: episodes.status,
      createdAt: episodes.createdAt,
      actualSec: episodes.actualSec,
      audioBytes: episodes.audioBytes,
      chapterSummaries: sql<{ title: string | null; source_count: number }[] | null>`(
        select jsonb_agg(jsonb_build_object(
          'title', ch->>'title',
          'source_count', jsonb_array_length(coalesce(ch->'source_ids', '[]'::jsonb))
        ) order by ord)
        from jsonb_array_elements(
          case when jsonb_typeof(${episodes.script}->'chapters') = 'array'
               then ${episodes.script}->'chapters' else '[]'::jsonb end
        ) with ordinality t(ch, ord)
      )`,
    })
    .from(episodes)
    .where(eq(episodes.userId, c.get('userId')))
    .orderBy(desc(episodes.createdAt))
    .limit(50)

  return c.json({
    episodes: rows.map((ep) => ({
      id: ep.id,
      title: ep.title,
      status: ep.status,
      createdAt: ep.createdAt.toISOString(),
      actualSec: ep.actualSec,
      audioUrl: readyAudioUrl(base, ep.status, ep.id),
      audioBytes: ep.audioBytes,
      chapters: (ep.chapterSummaries ?? []).map((ch) => ({
        title: ch.title ?? '',
        sourceCount: ch.source_count,
      })),
    })),
  })
})

authed.get('/episodes/:id', async (c) => {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) return c.json({ error: 'server misconfigured: R2_PUBLIC_BASE_URL is not set' }, 500)

  const id = c.req.param('id')
  // Same 404 as a foreign id: a caller learns nothing from the shape of the id.
  if (!isUuid(id)) return c.json({ error: 'not found' }, 404)

  const conn = c.get('conn')
  const [ep] = await conn
    .select({
      id: episodes.id,
      userId: episodes.userId,
      title: episodes.title,
      status: episodes.status,
      createdAt: episodes.createdAt,
      actualSec: episodes.actualSec,
      audioBytes: episodes.audioBytes,
      script: episodes.script,
      grounding: episodes.grounding,
      outline: episodes.outline,
      cost: episodes.cost,
      promptVersions: episodes.promptVersions,
      targetSec: episodes.targetSec,
    })
    .from(episodes)
    .where(eq(episodes.id, id))
  if (!ep || ep.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)

  // An episode still being written has no script yet, which is not a failure.
  // A script that is present but unreadable is one, and rendering it as an
  // episode with zero chapters would hide it.
  const parsed = ScriptSchema.safeParse(ep.script)
  if (ep.script !== null && !parsed.success) {
    return c.json({ error: 'the stored script is unreadable' }, 500)
  }
  const chapters = parsed.success ? parsed.data.chapters : []

  // The writer fills source_ids from its evidence, so they are only strings
  // here: anything that is not a uuid would fail the query outright.
  const cited = [...new Set(chapters.flatMap((ch) => ch.source_ids))].filter(isUuid)
  const rows = cited.length
    ? await conn
        .select({
          id: sources.id,
          userId: sources.userId,
          publisher: sources.publisher,
          title: sources.title,
          url: sources.url,
          lang: sources.lang,
          extractionQuality: sources.extractionQuality,
        })
        .from(sources)
        .where(inArray(sources.id, cited))
    : []
  const byId = new Map(rows.filter((s) => s.userId === c.get('userId')).map((s) => [s.id, s]))

  // The verification report, grouped by the chapter it belongs to. It is served
  // here, authenticated, and never from the bucket: the bucket is public.
  const GroundingEntrySchema = z.object({
    chapter: z.string(),
    sentence: z.string(),
    supported: z.boolean(),
    action: z.string(),
    fix: z.string().optional(),
  })
  const report = z.array(GroundingEntrySchema).safeParse(ep.grounding)
  const groundingByChapter = new Map<string, z.infer<typeof GroundingEntrySchema>[]>()
  if (report.success) {
    for (const entry of report.data) {
      const list = groundingByChapter.get(entry.chapter) ?? []
      list.push(entry)
      groundingByChapter.set(entry.chapter, list)
    }
  }

  // What the editorial stage decided before a word was written, and what the run
  // cost. The app's backstage view is the debug trail of ARCHITECTURE §9 made
  // readable, so it needs the plan, not only the result.
  const OutlineShape = z.object({
    sections: z.array(z.object({ story_id: z.string(), title: z.string(), airtime_sec: z.number() })).default([]),
    discarded: z.array(z.object({ story_id: z.string(), reason: z.string() })).default([]),
  })
  const outline = OutlineShape.safeParse(ep.outline)
  // publishEpisode merges scalar totals (tts_usd, total_usd) into the per-stage
  // ledger, so the shape is mixed: prefer the total, else sum the stages.
  const CostShape = z.record(z.union([z.object({ usd: z.number().optional() }).passthrough(), z.number()]))
  const costs = CostShape.safeParse(ep.cost)
  const entries = report.success ? report.data : []

  return c.json({
    id: ep.id,
    title: ep.title,
    status: ep.status,
    createdAt: ep.createdAt.toISOString(),
    actualSec: ep.actualSec,
    targetSec: ep.targetSec,
    // The airtime budget, in the order the outline set it.
    budget: outline.success ? outline.data.sections.map((s) => ({ title: s.title, airtimeSec: s.airtime_sec })) : [],
    discarded: outline.success ? outline.data.discarded.map((d) => d.reason) : [],
    verification: {
      checked: entries.length,
      corrected: entries.filter((e) => e.action === 'fixed').length,
      dropped: entries.filter((e) => e.action.startsWith('dropped')).length,
    },
    usd: costs.success
      ? typeof costs.data.total_usd === 'number'
        ? costs.data.total_usd
        : Object.values(costs.data).reduce<number>(
            (n, v) => n + (typeof v === 'number' ? 0 : typeof v.usd === 'number' ? v.usd : 0),
            0,
          )
      : null,
    promptVersions: ep.promptVersions ?? null,
    audioUrl: readyAudioUrl(base, ep.status, ep.id),
    audioBytes: ep.audioBytes,
    chapters: chapters.map((ch) => ({
      title: ch.title,
      text: ch.text,
      sourceIds: ch.source_ids,
      // An intro carries no external claim, so an empty list is the honest answer
      // rather than a missing field the app would have to guess about.
      grounding: (groundingByChapter.get(ch.title) ?? []).map((g) => ({
        sentence: g.sentence,
        supported: g.supported,
        action: g.action,
        ...(g.fix ? { fix: g.fix } : {}),
      })),
      sources: ch.source_ids.flatMap((sourceId) => {
        const s = byId.get(sourceId)
        return s
          ? [
              {
                id: s.id,
                publisher: publisherOf(s.publisher, s.url),
                title: s.title,
                url: s.url,
                lang: s.lang,
                extractionQuality: s.extractionQuality,
              },
            ]
          : []
      }),
    })),
  })
})

// Deleting sources from the library. Bulk rather than one call per row: the
// app deletes a selection, and a partial failure across twenty edge invocations
// would leave the library in a state neither side can describe.
//
// What it does NOT do is rewrite history. A source cited by an episode that has
// already aired stays cited: the episode detail already reports "no longer in
// your library" for a missing source rather than reconstructing it, which is
// the honest answer and the reason the field exists. So stories lose the
// deleted ids, and a story left with nothing is removed only when it is still
// open -- an aired story is the record of what was broadcast, not a working
// set.
const DeleteSourcesSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })

authed.post('/sources/delete', async (c) => {
  const parsed = DeleteSourcesSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'expected { ids: [uuid] }' }, 400)
  const conn = c.get('conn')
  const userId = c.get('userId')
  const { ids } = parsed.data

  // Scoped to the caller in the same statement that selects them: an id that
  // belongs to somebody else simply does not match, and the count below is what
  // the app is told was deleted.
  const owned = await conn
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, userId), inArray(sources.id, ids)))
  if (owned.length === 0) return c.json({ deleted: 0 })
  const found = new Set(owned.map((row) => row.id))

  // The story rewrite happens in TypeScript rather than in one clever
  // statement: a uuid[] parameter inside drizzle's sql template does not
  // survive the neon-http driver (it answered 500 until this was rewritten),
  // and a user has a handful of stories, so reading them and writing back only
  // the ones that actually changed costs less than the bug did.
  const owning = await conn
    .select({ id: stories.id, sourceIds: stories.sourceIds, status: stories.status })
    .from(stories)
    .where(eq(stories.userId, userId))
  for (const story of owning) {
    const kept = story.sourceIds.filter((sid) => !found.has(sid))
    const where = and(eq(stories.userId, userId), eq(stories.id, story.id))
    // An open story with nothing behind it is dead weight: it can never air and
    // it counts for nothing. It goes whether this call emptied it or an earlier
    // one did -- the emptied-but-not-removed case is real, a half-applied
    // delete left exactly that row behind while this endpoint was being built.
    if (kept.length === 0 && story.status === 'open') {
      await conn.delete(stories).where(where)
      continue
    }
    if (kept.length === story.sourceIds.length) continue
    await conn.update(stories).set({ sourceIds: kept }).where(where)
  }

  await conn.delete(sources).where(and(eq(sources.userId, userId), inArray(sources.id, [...found])))

  return c.json({ deleted: found.size })
})

authed.get('/sources', async (c) => {
  const conn = c.get('conn')
  const userId = c.get('userId')

  // stories.source_ids is a uuid array, so membership is answered from the
  // user's own stories rather than with a containment query per source. Both
  // selects depend only on userId, so they share one wait over the HTTP driver.
  const [rows, storyRows] = await Promise.all([
    conn
      .select({
        id: sources.id,
        title: sources.title,
        url: sources.url,
        publisher: sources.publisher,
        type: sources.type,
        lang: sources.lang,
        status: sources.status,
        category: sources.category,
        extractionQuality: sources.extractionQuality,
        error: sources.error,
        capturedAt: sources.capturedAt,
      })
      .from(sources)
      .where(eq(sources.userId, userId))
      .orderBy(desc(sources.capturedAt))
      .limit(100),
    conn
      .select({ sourceIds: stories.sourceIds, status: stories.status })
      .from(stories)
      .where(eq(stories.userId, userId)),
  ])
  const clustered = new Set(storyRows.flatMap((s) => s.sourceIds))
  // Same definition as the generation rule, so the app's counter and the
  // server's refusal can never disagree.
  const available = new Set(storyRows.filter((s) => s.status === 'open').flatMap((s) => s.sourceIds)).size

  return c.json({
    sources: rows.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      publisher: publisherOf(s.publisher, s.url),
      type: s.type,
      lang: s.lang,
      status: s.status,
      category: s.category,
      extractionQuality: s.extractionQuality,
      error: s.error,
      capturedAt: s.capturedAt.toISOString(),
      inStory: clustered.has(s.id),
    })),
    available,
    minimum: MIN_SOURCES_PER_EPISODE,
    categories: CATEGORIES,
  })
})

app.route('/', authed)

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((err, c) => {
  // A driver stack tells a caller nothing and leaks schema details; the log keeps it.
  console.error('request failed', c.req.method, c.req.path, err)
  return c.json({ error: 'internal error' }, 500)
})

export default handle(app)
