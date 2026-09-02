import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from './testDb.js'

test('a fresh test database has the auth tables', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const r = await db.execute(sql`SELECT to_regclass('identities') AS a, to_regclass('sessions') AS b`)
    assert.equal(r.rows[0]?.a, 'identities')
    assert.equal(r.rows[0]?.b, 'sessions')
  } finally {
    await cleanup()
  }
})
