import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { pushTokens, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import {
  broadcast,
  broadcastStats,
  cleanBody,
  listRecipients,
  listThread,
  listThreads,
  markRead,
  MAX_BODY,
  postMessage,
  SupportError,
  unreadFor,
} from './thread.js'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

const seedUser = async (db: TestDb, email: string | null = `${randomBytes(4).toString('hex')}@example.com`) => {
  const [u] = await db
    .insert(users)
    .values({ email, apiToken: randomBytes(16).toString('hex'), rssToken: randomBytes(16).toString('hex') })
    .returning({ id: users.id })
  return u!.id
}

// Timestamps from now() collide within one statement batch; the order of a
// thread is part of what is under test, so the clock is moved by hand.
const tick = () => new Promise((r) => setTimeout(r, 5))

test('two threads never see each other', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    const b = await seedUser(db)
    await postMessage(db, { userId: a, author: 'user', body: 'from a' })
    await postMessage(db, { userId: b, author: 'user', body: 'from b' })
    const thread = await listThread(db, a)
    assert.deepEqual(
      thread.map((m) => m.body),
      ['from a'],
    )
  } finally {
    await cleanup()
  }
})

test('a thread reads in the order it was written', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    await postMessage(db, { userId: a, author: 'user', body: 'one' })
    await tick()
    await postMessage(db, { userId: a, author: 'admin', body: 'two' })
    await tick()
    await postMessage(db, { userId: a, author: 'user', body: 'three' })
    assert.deepEqual(
      (await listThread(db, a)).map((m) => m.body),
      ['one', 'two', 'three'],
    )
  } finally {
    await cleanup()
  }
})

test('reading marks only the other side as read', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    await postMessage(db, { userId: a, author: 'admin', body: 'question' })
    await postMessage(db, { userId: a, author: 'user', body: 'answer' })
    assert.equal(await unreadFor(db, a), 1)
    // The user opening the chat reads what the admin wrote, never their own.
    await markRead(db, a, 'admin')
    assert.equal(await unreadFor(db, a), 0)
    const [thread] = await listThreads(db)
    assert.equal(thread!.unread, 1, 'the user message is still unread by the admin')
    await markRead(db, a, 'user')
    const [after] = await listThreads(db)
    assert.equal(after!.unread, 0)
  } finally {
    await cleanup()
  }
})

test('a body is trimmed, never empty, and bounded', () => {
  assert.equal(cleanBody('  hello  '), 'hello')
  assert.throws(() => cleanBody(''), SupportError)
  assert.throws(() => cleanBody('   \n '), SupportError)
  assert.throws(() => cleanBody(42), SupportError)
  assert.throws(() => cleanBody('x'.repeat(MAX_BODY + 1)), SupportError)
  assert.equal(cleanBody('x'.repeat(MAX_BODY)).length, MAX_BODY)
})

test('postMessage refuses an empty body', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    await assert.rejects(postMessage(db, { userId: a, author: 'user', body: '  ' }), SupportError)
    assert.equal((await listThread(db, a)).length, 0)
  } finally {
    await cleanup()
  }
})

test('a broadcast writes one admin message per thread, under one id', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    const b = await seedUser(db)
    const c = await seedUser(db)
    const sent = await broadcast(db, { body: 'How was this morning?', userIds: [a, b] })
    assert.deepEqual([...sent.userIds].sort(), [a, b].sort())
    const ta = await listThread(db, a)
    const tb = await listThread(db, b)
    assert.equal(ta[0]!.author, 'admin')
    assert.equal(ta[0]!.broadcastId, sent.broadcastId)
    assert.equal(tb[0]!.broadcastId, sent.broadcastId)
    assert.equal((await listThread(db, c)).length, 0)
  } finally {
    await cleanup()
  }
})

test('a broadcast to all reaches every account, and ignores unknown ids', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    const b = await seedUser(db)
    const all = await broadcast(db, { body: 'Hello all', userIds: 'all' })
    assert.deepEqual([...all.userIds].sort(), [a, b].sort())
    const some = await broadcast(db, { body: 'Hello one', userIds: [a, '00000000-0000-0000-0000-000000000000'] })
    assert.deepEqual(some.userIds, [a])
  } finally {
    await cleanup()
  }
})

test('broadcast stats count the threads that answered after the question', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db)
    const b = await seedUser(db)
    // Written before the question: not an answer to it.
    await postMessage(db, { userId: b, author: 'user', body: 'earlier' })
    await tick()
    const sent = await broadcast(db, { body: 'Too long?', userIds: [a, b] })
    await tick()
    await postMessage(db, { userId: a, author: 'user', body: 'A bit' })
    await tick()
    await postMessage(db, { userId: a, author: 'user', body: 'and the voice' })
    const [stat] = await broadcastStats(db)
    assert.equal(stat!.broadcastId, sent.broadcastId)
    assert.equal(stat!.body, 'Too long?')
    assert.equal(stat!.sent, 2)
    assert.equal(stat!.replied, 1)
  } finally {
    await cleanup()
  }
})

test('threads list by latest activity with their last message', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db, 'a@example.com')
    const b = await seedUser(db, null)
    await postMessage(db, { userId: a, author: 'user', body: 'old' })
    await tick()
    await postMessage(db, { userId: b, author: 'user', body: 'newer' })
    await tick()
    await postMessage(db, { userId: a, author: 'admin', body: 'newest' })
    const threads = await listThreads(db)
    assert.deepEqual(
      threads.map((t) => [t.email, t.lastBody, t.lastAuthor, t.total]),
      [
        ['a@example.com', 'newest', 'admin', 2],
        [null, 'newer', 'user', 1],
      ],
    )
  } finally {
    await cleanup()
  }
})

test('recipients list every account with its push devices', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const a = await seedUser(db, 'a@example.com')
    await seedUser(db, 'b@example.com')
    await db.insert(pushTokens).values({ token: 'ab'.repeat(32), userId: a, environment: 'production' })
    const recipients = await listRecipients(db)
    const byEmail = Object.fromEntries(recipients.map((r) => [r.email, r.devices]))
    assert.deepEqual(byEmail, { 'a@example.com': 1, 'b@example.com': 0 })
  } finally {
    await cleanup()
  }
})
