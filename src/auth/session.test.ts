import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { sessions, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { createSession, listSessions, revokeSession, userIdForToken } from './session.js'

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db']) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(4).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

test('a fresh session authenticates its user', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    assert.ok(token.length >= 40, 'the token must not be guessable')
    assert.equal(await userIdForToken(db, token), userId)
  } finally {
    await cleanup()
  }
})

test('an unknown token authenticates nobody', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    assert.equal(await userIdForToken(db, 'nope'), null)
  } finally {
    await cleanup()
  }
})

test('a revoked session stops authenticating', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, token))
    assert.equal(await revokeSession(db, userId, row!.id), true)
    assert.equal(await userIdForToken(db, token), null)
  } finally {
    await cleanup()
  }
})

test('revoking one device leaves the others signed in', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const phone = await createSession(db, userId, 'iPhone')
    const pad = await createSession(db, userId, 'iPad')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, phone))
    await revokeSession(db, userId, row!.id)
    assert.equal(await userIdForToken(db, phone), null)
    assert.equal(await userIdForToken(db, pad), userId, 'the iPad must survive')
  } finally {
    await cleanup()
  }
})

test('a user cannot revoke a session that is not theirs', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const mine = await seedUser(db)
    const theirs = await seedUser(db)
    const token = await createSession(db, theirs, 'iPhone')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, token))
    assert.equal(await revokeSession(db, mine, row!.id), false)
    assert.equal(await userIdForToken(db, token), theirs, 'the victim stays signed in')
  } finally {
    await cleanup()
  }
})

test('the device list shows only the live sessions of that user', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const other = await seedUser(db)
    await createSession(db, userId, 'iPhone')
    const pad = await createSession(db, userId, 'iPad')
    await createSession(db, other, 'Intruder')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, pad))
    await revokeSession(db, userId, row!.id)
    const listed = await listSessions(db, userId)
    assert.deepEqual(
      listed.map((s) => s.deviceName),
      ['iPhone'],
    )
  } finally {
    await cleanup()
  }
})

test('last_seen_at is not rewritten on every call', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    await userIdForToken(db, token)
    const [first] = await db.select({ at: sessions.lastSeenAt }).from(sessions).where(eq(sessions.token, token))
    await userIdForToken(db, token)
    const [second] = await db.select({ at: sessions.lastSeenAt }).from(sessions).where(eq(sessions.token, token))
    assert.equal(first!.at.getTime(), second!.at.getTime(), 'a write per request would cost latency for nothing')
  } finally {
    await cleanup()
  }
})

test('deleting the account destroys its sessions', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    await db.delete(sessions).where(eq(sessions.userId, userId))
    await db.delete(users).where(eq(users.id, userId))
    assert.equal(await userIdForToken(db, token), null, 'a deleted account must not keep authenticating')
  } finally {
    await cleanup()
  }
})
