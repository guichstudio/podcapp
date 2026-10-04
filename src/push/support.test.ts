import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apnsPayload } from './apns.js'
import { adminAlert, excerpt, supportData, userAlert } from './support.js'

test('a briefing payload keeps the shape the app already reads', () => {
  const payload = JSON.parse(
    apnsPayload({
      token: 't',
      environment: 'production',
      title: 'Your briefing is ready',
      body: 'Nvidia · 4 min',
      data: { episode_id: 'e1' },
      collapseId: 'e1',
      threadId: 'briefing',
    }),
  )
  assert.deepEqual(payload, {
    aps: { alert: { title: 'Your briefing is ready', body: 'Nvidia · 4 min' }, sound: 'default', 'thread-id': 'briefing' },
    episode_id: 'e1',
  })
})

test('a support payload says so, under its own thread', () => {
  const payload = JSON.parse(
    apnsPayload({ token: 't', environment: 'production', title: 'x', body: 'y', data: supportData, threadId: 'support' }),
  )
  assert.equal(payload.support, '1')
  assert.equal(payload.aps['thread-id'], 'support')
})

test('an excerpt cuts on a word and says it was cut', () => {
  assert.equal(excerpt('short'), 'short')
  assert.equal(excerpt('  spaced \n out  '), 'spaced out')
  const long = 'word '.repeat(60)
  const cut = excerpt(long)
  assert.ok(cut.length <= 141, `got ${cut.length}`)
  assert.ok(cut.endsWith('…'))
  assert.ok(!cut.includes('wor…'), 'never mid-word')
})

test('the admin is told who wrote, even without an address', () => {
  assert.deepEqual(adminAlert('marie@example.com', 'The voice reads numbers badly'), {
    title: 'Nouveau message',
    body: 'marie@example.com : The voice reads numbers badly',
  })
  assert.equal(adminAlert(null, 'hi').body, 'Apple relais : hi')
})

test('a user is told in their own language', () => {
  assert.equal(userAlert('fr', 'Merci !').title, 'Message de Podcapp')
  assert.equal(userAlert('en', 'Thanks!').title, 'Message from Podcapp')
  assert.equal(userAlert('en', 'Thanks!').body, 'Thanks!')
})
