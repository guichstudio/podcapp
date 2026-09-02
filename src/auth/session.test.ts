import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { sessions, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { createSession, listSessions, revokeAllSessions, revokeSession, sessionForToken, userIdForToken } from './session.js'

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

test('revokeAllSessions signs out every device at once (account deletion)', async () => {
  // Regression for CRITICAL 2: DELETE /me used to revoke only api_token and
  // rss_token, which the app stopped authenticating with once sessions
  // shipped. An iPad session survived account deletion until the durable job
  // eventually deleted the rows -- indefinitely, if that job failed. DELETE
  // /me now calls revokeAllSessions in the same request; this is what proves
  // it actually signs out every device, not just the one that asked.
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const other = await seedUser(db)
    const phone = await createSession(db, userId, 'iPhone')
    const pad = await createSession(db, userId, 'iPad')
    const untouched = await createSession(db, other, 'Someone else’s phone')

    const count = await revokeAllSessions(db, userId)

    assert.equal(count, 2, 'both of the deleted account’s sessions are revoked')
    assert.equal(await userIdForToken(db, phone), null, 'the iPhone that asked for deletion is signed out')
    assert.equal(await userIdForToken(db, pad), null, 'the iPad must not survive account deletion')
    assert.equal(await userIdForToken(db, untouched), other, 'a different account’s session is untouched')
  } finally {
    await cleanup()
  }
})

test('revokeAllSessions on an account with no live sessions is a no-op', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    assert.equal(await revokeAllSessions(db, userId), 0)
  } finally {
    await cleanup()
  }
})

test('a device can revoke the very session it is authenticating with', async () => {
  // Regression for IMPORTANT 3: this is the mechanism DELETE /me/session uses
  // -- sessionForToken resolves the caller's own session id from its bearer
  // token (the same lookup the authed middleware already does), and that id
  // is handed straight back into revokeSession. Proves the round trip
  // actually kills the token afterwards, not just that revokeSession works in
  // isolation.
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    const self = await sessionForToken(db, token)
    assert.ok(self, 'the token must resolve to a live session')
    assert.equal(await revokeSession(db, userId, self!.id), true)
    assert.equal(await userIdForToken(db, token), null, 'the token used to revoke itself must stop working')
  } finally {
    await cleanup()
  }
})

test('sessionForToken exposes the session id alongside the user id', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, token))
    assert.deepEqual(await sessionForToken(db, token), { id: row!.id, userId })
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
