import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAdmin } from './admin.js'

const SECRET = 'k3y-0f-the-admin-page-000000000000'

test('the right token opens the admin routes', () => {
  assert.equal(checkAdmin(`Bearer ${SECRET}`, SECRET), 'ok')
  assert.equal(checkAdmin(`bearer ${SECRET}`, SECRET), 'ok')
})

test('a wrong, partial or missing token is refused', () => {
  assert.equal(checkAdmin(`Bearer ${SECRET}x`, SECRET), 'denied')
  assert.equal(checkAdmin(`Bearer ${SECRET.slice(0, -1)}`, SECRET), 'denied')
  assert.equal(checkAdmin('Bearer ', SECRET), 'denied')
  assert.equal(checkAdmin(undefined, SECRET), 'denied')
  assert.equal(checkAdmin(SECRET, SECRET), 'denied', 'the scheme is required')
})

test('no configured token disables the routes instead of opening them', () => {
  assert.equal(checkAdmin(`Bearer ${SECRET}`, undefined), 'disabled')
  assert.equal(checkAdmin('Bearer ', ''), 'disabled')
  assert.equal(checkAdmin(undefined, '   '), 'disabled')
})
