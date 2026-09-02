import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
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

// The empty-audience guard is the only thing standing between an unconfigured
// GOOGLE_CLIENT_ID and a call to jwtVerify with audience: ''. It must run
// before any key resolution: a keyFor that would blow up if ever invoked
// proves the guard short-circuits instead of falling through into signature
// verification and only failing there.
test('an unconfigured Google audience is rejected before any signature work', async () => {
  let keyForCalled = false
  const verifyWithoutGoogleConfigured = createVerifier(() => {
    keyForCalled = true
    throw new Error('key resolution must not run when no audience is configured')
  })
  await rejects(verifyWithoutGoogleConfigured({ provider: 'google', token: 'not-even-a-jwt', rawNonce: RAW_NONCE }))
  assert.equal(keyForCalled, false, 'the audience guard must return before touching the key resolver')
})

// GOOGLE_CLIENT_ID is read once, at module load, from src/config.ts. Mutating
// process.env inside this process cannot change what verify.ts already
// captured (its `RULES.google.audience` closes over that one binding, and
// jose in verify.ts's own import graph is loaded once too) - only a fresh
// process, started with the env var already set, does. Spawning tsx directly
// (not through pnpm) keeps this to one process start rather than pnpm's own
// wrapper on top.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TSX_BIN = join(REPO_ROOT, 'node_modules/.bin/tsx')
const VERIFY_TS_PATH = join(REPO_ROOT, 'src/auth/verify.ts')

function googleAcceptedProbeSource(): string {
  return `
import { createHash } from 'node:crypto'
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose'
import { createVerifier } from ${JSON.stringify(VERIFY_TS_PATH)}

const RAW_NONCE = 'google-probe-nonce'
const hashed = (n) => createHash('sha256').update(n).digest('hex')

const keys = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'probe-key', alg: 'RS256' }
const localKeys = createLocalJWKSet({ keys: [jwk] })
const verify = createVerifier(() => localKeys)

async function googleToken(issuer) {
  return new SignJWT({
    sub: 'google-subject-1',
    email: 'louis@example.com',
    email_verified: true,
    nonce: hashed(RAW_NONCE),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'probe-key' })
    .setIssuer(issuer)
    .setAudience(process.env.GOOGLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
}

const results = []
for (const issuer of ['https://accounts.google.com', 'accounts.google.com']) {
  results.push(await verify({ provider: 'google', token: await googleToken(issuer), rawNonce: RAW_NONCE }))
}
process.stdout.write(JSON.stringify(results))
`
}

test('a Google token is accepted when GOOGLE_CLIENT_ID is set, for both issuer forms', async () => {
  // Under node_modules/ (gitignored, never left behind - removed in the
  // finally block below) so the probe's bare `import 'jose'` resolves: Node
  // walks up from the file looking for a node_modules folder, and the OS temp
  // dir has no such ancestor.
  const dir = await mkdtemp(join(REPO_ROOT, 'node_modules', '.tmp-auth-probe-'))
  try {
    // .mts, not .ts: this temp dir has no package.json to declare "type":
    // "module", and a plain .ts there would transform to CJS, which cannot
    // run this script's top-level await.
    const probePath = join(dir, 'googleAccepted.probe.mts')
    await writeFile(probePath, googleAcceptedProbeSource())
    const stdout = execFileSync(TSX_BIN, [probePath], {
      env: { ...process.env, GOOGLE_CLIENT_ID: 'test-google-client-id' },
      encoding: 'utf8',
    })
    const results: unknown[] = JSON.parse(stdout)
    assert.equal(results.length, 2, 'one result per issuer form')
    for (const identity of results) {
      assert.deepEqual(identity, {
        provider: 'google' satisfies Provider,
        subject: 'google-subject-1',
        email: 'louis@example.com',
        emailVerified: true,
      })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
