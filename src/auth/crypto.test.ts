import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { randomToken, sha256Hex } from './crypto.js'

// node:crypto here is only the test's own oracle, to prove the WebCrypto
// replacement matches it byte for byte -- it is never imported by the modules
// under test, which is the whole point (see CRITICAL 1: node:crypto is not
// reachable on Vercel's Edge runtime, where api/index.ts and everything it
// imports must run).

test('randomToken looks like the base64url shape a bearer token needs', () => {
  const token = randomToken()
  assert.ok(token.length >= 40, 'the token must not be guessable')
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'base64url only: no +, / or padding')
})

test('randomToken never repeats across calls', () => {
  const seen = new Set(Array.from({ length: 50 }, () => randomToken()))
  assert.equal(seen.size, 50)
})

test('randomToken matches the length of the node:crypto call it replaces', () => {
  const reference = randomBytes(32).toString('base64url')
  assert.equal(randomToken().length, reference.length)
})

test('sha256Hex matches node:crypto createHash for a known input', async () => {
  const expected = createHash('sha256').update('podcapp-nonce').digest('hex')
  assert.equal(await sha256Hex('podcapp-nonce'), expected)
})

test('sha256Hex matches node:crypto createHash for an empty string', async () => {
  const expected = createHash('sha256').update('').digest('hex')
  assert.equal(await sha256Hex(''), expected)
})

test('sha256Hex is 64 lowercase hex characters', async () => {
  const digest = await sha256Hex('anything')
  assert.match(digest, /^[0-9a-f]{64}$/)
})
