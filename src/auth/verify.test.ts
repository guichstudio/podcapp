import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from 'jose'
import { APPLE_AUDIENCE } from '../config.js'
import { createVerifier } from './verify.js'
import { AuthError, type Provider } from './types.js'

const RAW_NONCE = 'un-alea-tire-par-lapp'
const hashed = (n: string) => createHash('sha256').update(n).digest('hex')

const keys = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256' }
const localKeys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] })
const verify = createVerifier(() => localKeys)

// Un jeton Apple conforme, dont chaque test degrade une seule propriete.
async function appleToken(over: Record<string, unknown> = {}, exp = '5m') {
  return new SignJWT({
    sub: 'apple-subject-1',
    email: 'louis@example.com',
    email_verified: true,
    nonce: hashed(RAW_NONCE),
    ...over,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(keys.privateKey)
}

const rejects = (p: Promise<unknown>) => assert.rejects(p, AuthError)

test('a well-formed Apple token is accepted', async () => {
  const id = await verify({ provider: 'apple', token: await appleToken(), rawNonce: RAW_NONCE })
  assert.deepEqual(id, {
    provider: 'apple' satisfies Provider,
    subject: 'apple-subject-1',
    email: 'louis@example.com',
    emailVerified: true,
  })
})

test('an expired token is rejected', async () => {
  await rejects(verify({ provider: 'apple', token: await appleToken({}, '-1s'), rawNonce: RAW_NONCE }))
})

test('a token minted for another app is rejected', async () => {
  const token = await new SignJWT({ sub: 'x', nonce: hashed(RAW_NONCE) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://appleid.apple.com')
    .setAudience('com.someone.else')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
  await rejects(verify({ provider: 'apple', token, rawNonce: RAW_NONCE }))
})

test('an unexpected issuer is rejected', async () => {
  const token = await new SignJWT({ sub: 'x', nonce: hashed(RAW_NONCE) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://evil.example.com')
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
  await rejects(verify({ provider: 'apple', token, rawNonce: RAW_NONCE }))
})

test('a tampered signature is rejected', async () => {
  const token = await appleToken()
  const [h, p] = token.split('.')
  await rejects(verify({ provider: 'apple', token: `${h}.${p}.AAAA`, rawNonce: RAW_NONCE }))
})

test('an unsigned token is rejected', async () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = `${b64({ alg: 'none' })}.${b64({
    sub: 'x',
    iss: 'https://appleid.apple.com',
    aud: APPLE_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: hashed(RAW_NONCE),
  })}.`
  await rejects(verify({ provider: 'apple', token, rawNonce: RAW_NONCE }))
})

test('a replayed token with the wrong nonce is rejected', async () => {
  await rejects(verify({ provider: 'apple', token: await appleToken(), rawNonce: 'un-autre-alea' }))
})

test('a token carrying no nonce is rejected', async () => {
  await rejects(verify({ provider: 'apple', token: await appleToken({ nonce: undefined }), rawNonce: RAW_NONCE }))
})

test('an unverified email is reported as unverified', async () => {
  const id = await verify({
    provider: 'apple',
    token: await appleToken({ email_verified: 'false' }),
    rawNonce: RAW_NONCE,
  })
  assert.equal(id.emailVerified, false)
})

test('a token without an email yields a null email', async () => {
  const id = await verify({ provider: 'apple', token: await appleToken({ email: undefined }), rawNonce: RAW_NONCE })
  assert.equal(id.email, null)
  assert.equal(id.emailVerified, false)
})
