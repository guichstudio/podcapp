import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { pushTokens, supportMessages, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import type { Storage } from '../storage/index.js'
import { deleteAccount } from './deleteAccount.js'

const storage: Storage = {
  put: async () => {},
  get: async () => null,
  delete: async () => {},
  publicUrl: (key) => key,
}

test('an account with a push device and a support thread is erased whole', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const [u] = await db
      .insert(users)
      .values({ email: 'gone@example.com', apiToken: randomBytes(16).toString('hex'), rssToken: randomBytes(16).toString('hex') })
      .returning({ id: users.id })
    const userId = u!.id
    // push_tokens references users without a cascade: before this test the
    // final delete of the users row failed on it, for anyone who had ever
    // allowed notifications.
    await db.insert(pushTokens).values({ token: 'cd'.repeat(32), userId, environment: 'production' })
    await db.insert(supportMessages).values([
      { userId, author: 'user', body: 'hello' },
      { userId, author: 'admin', body: 'hi' },
    ])
    await deleteAccount(db, storage, userId)
    assert.equal((await db.select().from(users).where(eq(users.id, userId))).length, 0)
    assert.equal((await db.select().from(pushTokens).where(eq(pushTokens.userId, userId))).length, 0)
    assert.equal((await db.select().from(supportMessages).where(eq(supportMessages.userId, userId))).length, 0)
  } finally {
    await cleanup()
  }
})
