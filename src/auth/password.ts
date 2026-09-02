import { eq, sql } from 'drizzle-orm'
import { users } from '../db/schema.js'
import type { AnyDb } from './types.js'

// PBKDF2-HMAC-SHA256 password hashing for POST /auth/password
// (api/index.ts). WebCrypto only, never node:crypto -- this module sits
// under src/auth/, reachable from api/index.ts's Vercel Edge bundle; see
// crypto.ts's header comment for why that rules out node:crypto (and with it
// bcrypt/scrypt/argon2, which are all Node-native).
//
// Iteration count: measured locally with a throwaway `node -e` benchmark
// (crypto.subtle, a fixed 16-byte salt, a 32-byte/256-bit derived key):
//   100,000 iterations   ~23ms
//   210,000 iterations   ~42ms
//   300,000 iterations   ~58ms
//   400,000 iterations   ~77ms
//   600,000 iterations  ~117ms
//   800,000 iterations  ~157ms
// 1,000,000 iterations  ~194ms
// Chosen: 600,000, OWASP's current floor for PBKDF2-HMAC-SHA256. ~117ms
// measured leaves comfortable headroom under Vercel Edge's execution budget,
// and this endpoint exists for exactly one intended caller -- the
// operator-provisioned App Review reviewer account -- signing in rarely, so
// there is no throughput pressure to trade cost for a lower count.

const ALGO = 'pbkdf2-sha256'
const ITERATIONS = 600_000
const SALT_BYTES = 16
const KEY_BITS = 256 // 32-byte derived key

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveBits(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, keyMaterial, KEY_BITS)
  return new Uint8Array(bits)
}

/// A self-describing hash string: algorithm and iteration count travel with
/// the hash itself, so the cost can be raised later (new rows get the new
/// count, old rows keep verifying against the count they were written with)
/// without a migration that cannot tell old rows from new.
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const hash = await deriveBits(password, salt, ITERATIONS)
  return `${ALGO}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

function parseHash(stored: string): { iterations: number; salt: Uint8Array<ArrayBuffer>; hash: Uint8Array<ArrayBuffer> } | null {
  const [algo, iterationsPart, saltPart, hashPart, ...rest] = stored.split('$')
  if (algo !== ALGO || saltPart === undefined || hashPart === undefined || rest.length > 0) return null
  const iterations = Number(iterationsPart)
  if (!Number.isInteger(iterations) || iterations <= 0) return null
  try {
    return { iterations, salt: fromBase64Url(saltPart), hash: fromBase64Url(hashPart) }
  } catch {
    return null
  }
}

// Used whenever there is no real hash to check against -- an Apple/Google-only
// account with no password, an unknown email, or (defensively) a corrupted
// stored value. verifyPassword still runs a full PBKDF2 derivation against
// this fixed record before answering false, so none of those cases resolve
// measurably faster than a wrong password on a real account, which is what
// would otherwise tell an attacker which emails exist. The salt and hash
// bytes are arbitrary and never compared against a real secret; only the
// iteration count matters, and it is kept equal to ITERATIONS so the cost
// matches a genuine check.
const DUMMY = {
  iterations: ITERATIONS,
  salt: new Uint8Array(SALT_BYTES).fill(7),
  hash: new Uint8Array(KEY_BITS / 8).fill(11),
}

function constantTimeEqual(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/// True only if `password` matches the account's stored hash. `stored` is
/// null for an account with no password set (Apple/Google-only, or unknown
/// entirely -- callers pass null either way); this still performs a
/// full-cost PBKDF2 derivation against a dummy record before returning
/// false, so that case never answers faster than a wrong password on a real
/// account. The digest comparison itself is constant-time over its fixed
/// byte length. Never throws: a corrupted stored value is treated the same
/// as no password.
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const record = (stored === null ? null : parseHash(stored)) ?? DUMMY
  const candidate = await deriveBits(password, record.salt, record.iterations)
  const matches = constantTimeEqual(candidate, record.hash)
  // record === DUMMY covers both "no password set" and "corrupted stored
  // value"; either way there is no real secret to have matched.
  return record !== DUMMY && matches
}

// --- Rate limiting -----------------------------------------------------
//
// Five free failures, then a lockout window that doubles with every further
// failure and clears on the next success. Both numbers are deliberate:
//
// - FAILURE_THRESHOLD = 5: comfortably above the couple of retries a human
//   typo or a wrong keyboard layout costs, so a legitimate reviewer is very
//   unlikely to trip it, while still bounding an attacker to five free
//   PBKDF2-cost guesses.
// - LOCKOUT_BASE_MS = 30s, doubling (30s, 60s, 120s, ...) up to
//   LOCKOUT_MAX_MS = 24h: an attacker who keeps failing pays an exponentially
//   growing wait, but the lockout always self-clears -- there is no password
//   reset flow (Postmark is not configured, and building one is explicitly
//   out of scope here), so a real reviewer locked out by their own mistakes
//   must eventually get back in without operator intervention, not be stuck
//   forever after the fifth typo.
export const FAILURE_THRESHOLD = 5
export const LOCKOUT_BASE_MS = 30_000
export const LOCKOUT_MAX_MS = 24 * 60 * 60 * 1000

/// The lockout deadline after `failCount` consecutive failures, or null if
/// that count does not yet warrant one. Pure function of the count and the
/// clock so it is trivial to test without touching a database.
export function lockoutUntil(failCount: number, now: Date = new Date()): Date | null {
  if (failCount < FAILURE_THRESHOLD) return null
  const extra = failCount - FAILURE_THRESHOLD
  const durationMs = Math.min(LOCKOUT_BASE_MS * 2 ** extra, LOCKOUT_MAX_MS)
  return new Date(now.getTime() + durationMs)
}

/// The account behind POST /auth/password, or null on any failure -- unknown
/// email, no password set, wrong password, or a lockout still in effect all
/// return null identically; the caller (api/index.ts) turns that into the
/// same flat 401 whatever the cause. Detail belongs in logs, not here.
///
/// A locked-out account is refused before touching verifyPassword at all,
/// regardless of whether the password given is actually correct -- that is
/// the point of the lockout, and it is why a real account replies faster
/// while locked than while not (skipping the PBKDF2 derivation entirely).
/// That is a narrower, accepted gap in the timing protection: it only tells
/// an attacker anything once they have already driven that specific email
/// through five-plus failures, at which point the throttling has already
/// done its job. An unknown email never locks (there is no row to carry the
/// counter), so it always pays the full derivation, same as any other wrong
/// guess against a real, unlocked account.
///
/// `now` is injectable so tests can move past a lockout window without
/// sleeping; every other caller lets it default to the real clock.
export async function authenticateWithPassword(
  db: AnyDb,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<{ userId: string } | null> {
  const [user] = await db
    .select({
      id: users.id,
      password: users.password,
      failCount: users.passwordFailCount,
      lockedUntil: users.passwordLockedUntil,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)

  if (user?.lockedUntil && user.lockedUntil.getTime() > now.getTime()) return null

  const ok = await verifyPassword(password, user?.password ?? null)
  if (!user) return null

  if (!ok) {
    const failCount = user.failCount + 1
    await db
      .update(users)
      .set({ passwordFailCount: failCount, passwordLockedUntil: lockoutUntil(failCount, now) })
      .where(eq(users.id, user.id))
    return null
  }

  await db.update(users).set({ passwordFailCount: 0, passwordLockedUntil: null }).where(eq(users.id, user.id))
  return { userId: user.id }
}
