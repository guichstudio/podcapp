import assert from 'node:assert/strict'
import { createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { decodeKey } from './apns.js'

const PEM = '-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\n'

test('a .p8 survives every shape a paste can leave it in', () => {
  // Straight from a .env or a file.
  assert.equal(decodeKey(PEM).trim(), PEM.trim())
  // Base64 of the whole file, which is what a dashboard field cannot mangle.
  assert.equal(decodeKey(Buffer.from(PEM).toString('base64')), PEM)
  // Whitespace around a pasted blob is normal and must not break it.
  assert.equal(decodeKey(`  ${Buffer.from(PEM).toString('base64')}\n`), PEM)
  // A PEM whose newlines became literal backslash-n, which some shells do.
  assert.equal(decodeKey(PEM.replace(/\n/g, '\\n')).trim(), PEM.trim())
})

test('the signing key really parses as a P-256 private key', () => {
  // Not a shape test: the point of decodeKey is that crypto accepts the result.
  const path = '/Users/louisguichard/Downloads/AuthKey_BRT2X5BBBA.p8'
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return // the key is not on every machine; the shape tests above still ran
  }
  for (const shape of [raw, Buffer.from(raw).toString('base64')]) {
    const parsed = createPublicKey(decodeKey(shape))
    assert.equal(parsed.asymmetricKeyDetails?.namedCurve, 'prime256v1')
  }
})
