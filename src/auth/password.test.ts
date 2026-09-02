import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import {
  FAILURE_THRESHOLD,
  LOCKOUT_BASE_MS,
  authenticateWithPassword,
  hashPassword,
  lockoutUntil,
  verifyPassword,
} from './password.js'

const seedUser = async (
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  opts: { email?: string; password?: string } = {},
) => {
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email ?? `${randomBytes(4).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
      password: opts.password !== undefined ? await hashPassword(opts.password) : null,
    })
    .returning({ id: users.id, email: users.email })
  return u!
}

// --- hashPassword / verifyPassword: pure, no database ---------------------

test('a hash produced by the code verifies against it', async () => {
  const stored = await hashPassword('correct horse battery staple')
  assert.equal(await verifyPassword('correct horse battery staple', stored), true)
})

test('a wrong password does not verify', async () => {
  const stored = await hashPassword('correct horse battery staple')
  assert.equal(await verifyPassword('wrong guess', stored), false)
})

test('hashing the same password twice yields different stored values', async () => {
  const a = await hashPassword('same password')
  const b = await hashPassword('same password')
  assert.notEqual(a, b, 'the salt must differ per call')
  assert.equal(await verifyPassword('same password', a), true)
  assert.equal(await verifyPassword('same password', b), true)
})

test('the stored hash is self-describing', async () => {
  const stored = await hashPassword('whatever')
  const [algo, iterations, salt, hash] = stored.split('$')
  assert.equal(algo, 'pbkdf2-sha256')
  assert.ok(Number(iterations) > 0)
  assert.match(salt!, /^[A-Za-z0-9_-]+$/)
  assert.match(hash!, /^[A-Za-z0-9_-]+$/)
})

test('a corrupted stored value fails like any other wrong credential', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-real-hash'), false)
  assert.equal(await verifyPassword('anything', 'pbkdf2-sha256$not-a-number$abc$def'), false)
})

test('no password set does not answer measurably faster than a wrong guess against a real hash', async () => {
  const stored = await hashPassword('some real password')
  const timeIt = async (fn: () => Promise<boolean>) => {
    const t0 = performance.now()
    await fn()
    return performance.now() - t0
  }
  // Average a few runs each way: a single sample is noisy enough to flake.
  const runs = 5
  let withPassword = 0
  let withoutPassword = 0
  for (let i = 0; i < runs; i++) {
    withPassword += await timeIt(() => verifyPassword('a wrong guess', stored))
    withoutPassword += await timeIt(() => verifyPassword('a wrong guess', null))
  }
  const avgWith = withPassword / runs
  const avgWithout = withoutPassword / runs
  // Generous tolerance: this only needs to catch a *shortcut* (returning
  // early without hashing), not scheduler jitter. A real shortcut is orders
  // of magnitude faster, not a few percent.
  assert.ok(
    avgWithout > avgWith * 0.5,
    `no-password path (${avgWithout.toFixed(1)}ms) looks like it skipped the hash vs with-password (${avgWith.toFixed(1)}ms)`,
  )
})

// --- lockoutUntil: pure function of (failCount, now) -----------------------

test('lockoutUntil is null below the threshold', () => {
  for (let i = 0; i < FAILURE_THRESHOLD; i++) {
    assert.equal(lockoutUntil(i), null, `failCount=${i} must not lock yet`)
  }
})

test('lockoutUntil engages at the threshold and grows with further failures', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const first = lockoutUntil(FAILURE_THRESHOLD, now)
  assert.equal(first!.getTime() - now.getTime(), LOCKOUT_BASE_MS)
  const second = lockoutUntil(FAILURE_THRESHOLD + 1, now)
  assert.equal(second!.getTime() - now.getTime(), LOCKOUT_BASE_MS * 2, 'the window doubles with each further failure')
})

// --- authenticateWithPassword: the full DB-backed sign-in step -------------

test('a correct password authenticates', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const user = await seedUser(db, { password: 'letmein-please' })
    const result = await authenticateWithPassword(db, user.email!, 'letmein-please')
    assert.deepEqual(result, { userId: user.id })
  } finally {
    await cleanup()
  }
})

test('a wrong password does not authenticate', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const user = await seedUser(db, { password: 'letmein-please' })
    assert.equal(await authenticateWithPassword(db, user.email!, 'nope'), null)
  } finally {
    await cleanup()
  }
})

test('an account with no password set does not authenticate', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const user = await seedUser(db) // Apple-only: no password
    assert.equal(await authenticateWithPassword(db, user.email!, 'anything'), null)
  } finally {
    await cleanup()
  }
})

test('an unknown email does not authenticate', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    assert.equal(await authenticateWithPassword(db, 'nobody@example.com', 'anything'), null)
  } finally {
    await cleanup()
  }
})

test('email lookup is case-insensitive', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const user = await seedUser(db, { email: 'Reviewer@Example.com', password: 'letmein-please' })
    const result = await authenticateWithPassword(db, 'reviewer@example.com', 'letmein-please')
    assert.deepEqual(result, { userId: user.id })
  } finally {
    await cleanup()
  }
})

test('the lockout engages after the threshold and clears after a success', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const user = await seedUser(db, { password: 'letmein-please' })

    // FAILURE_THRESHOLD consecutive wrong guesses trips the lockout.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      assert.equal(await authenticateWithPassword(db, user.email!, 'wrong'), null)
    }
    const [lockedRow] = await db.select({ lockedUntil: users.passwordLockedUntil }).from(users).where(eq(users.id, user.id))
    assert.ok(lockedRow!.lockedUntil, 'the account must be locked after the threshold-th failure')

    // While locked, even the *correct* password is refused.
    assert.equal(await authenticateWithPassword(db, user.email!, 'letmein-please'), null, 'a lockout blocks correct passwords too')

    // Once the window has passed, the correct password succeeds again and
    // clears the lockout state.
    const past = new Date(lockedRow!.lockedUntil!.getTime() + 1_000)
    const result = await authenticateWithPassword(db, user.email!, 'letmein-please', past)
    assert.deepEqual(result, { userId: user.id })

    const [clearedRow] = await db
      .select({ failCount: users.passwordFailCount, lockedUntil: users.passwordLockedUntil })
      .from(users)
      .where(eq(users.id, user.id))
    assert.equal(clearedRow!.failCount, 0, 'a success resets the failure counter')
    assert.equal(clearedRow!.lockedUntil, null, 'a success clears the lockout')
  } finally {
    await cleanup()
  }
})

test('failures below the threshold do not lock the account', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const user = await seedUser(db, { password: 'letmein-please' })
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      assert.equal(await authenticateWithPassword(db, user.email!, 'wrong'), null)
    }
    // Still under the threshold: the correct password works immediately.
    const result = await authenticateWithPassword(db, user.email!, 'letmein-please')
    assert.deepEqual(result, { userId: user.id })
  } finally {
    await cleanup()
  }
})
