import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { identities, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { isMergeable, resolveUserId } from './identity.js'
import type { VerifiedIdentity } from './types.js'

const apple = (over: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  provider: 'apple',
  subject: 'apple-1',
  email: 'louis@example.com',
  emailVerified: true,
  ...over,
})

const google = (over: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  provider: 'google',
  subject: 'google-1',
  email: 'louis@example.com',
  emailVerified: true,
  ...over,
})

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db'], email: string | null) => {
  const [u] = await db
    .insert(users)
    .values({
      email,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

test('a private relay address never merges', () => {
  assert.equal(isMergeable('abc@privaterelay.appleid.com', true), false)
  assert.equal(isMergeable('ABC@PrivateRelay.AppleID.com', true), false)
})

test('an unverified or absent address never merges', () => {
  assert.equal(isMergeable('louis@example.com', false), false)
  assert.equal(isMergeable(null, true), false)
})

test('a verified ordinary address merges', () => {
  assert.equal(isMergeable('louis@example.com', true), true)
})

test('a first sign-in creates the account and its identity', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await resolveUserId(db, apple())
    const rows = await db.select().from(identities).where(eq(identities.userId, userId))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.provider, 'apple')
    assert.equal(rows[0]?.subject, 'apple-1')
  } finally {
    await cleanup()
  }
})

test('signing in again returns the same account and creates no duplicate', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const first = await resolveUserId(db, apple())
    const second = await resolveUserId(db, apple())
    assert.equal(first, second)
    assert.equal((await db.select().from(identities)).length, 1)
    assert.equal((await db.select().from(users)).length, 1)
  } finally {
    await cleanup()
  }
})

test('Google attaches to the existing account when the verified email matches', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const appleUser = await resolveUserId(db, apple())
    const googleUser = await resolveUserId(db, google())
    assert.equal(googleUser, appleUser, 'the same person must not get two accounts')
    assert.equal((await db.select().from(identities)).length, 2)
  } finally {
    await cleanup()
  }
})

test('a private relay address does not attach to a matching account', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const existing = await seedUser(db, 'relay@privaterelay.appleid.com')
    const resolved = await resolveUserId(db, apple({ email: 'relay@privaterelay.appleid.com' }))
    assert.notEqual(resolved, existing, 'a relay address proves nothing about identity')
  } finally {
    await cleanup()
  }
})

test('an unverified email does not attach to a matching account', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const existing = await seedUser(db, 'louis@example.com')
    const resolved = await resolveUserId(db, google({ emailVerified: false }))
    assert.notEqual(resolved, existing)
  } finally {
    await cleanup()
  }
})

test('an account created without an email is still usable', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await resolveUserId(db, apple({ email: null, emailVerified: false }))
    const [u] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(u?.email, null)
    assert.ok(u?.rssToken, 'a feed token is minted whether or not an email exists')
  } finally {
    await cleanup()
  }
})
