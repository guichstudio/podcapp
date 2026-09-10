import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { createAppStoreClient, readOriginalTransactionId } from './appstore.js'

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

const fakeJws = (payload: unknown) =>
  `${b64url({ alg: 'ES256', x5c: ['nope'] })}.${b64url(payload)}.c2ln`

test('on ne lit que l identifiant de transaction, jamais l etat', () => {
  const jws = fakeJws({ originalTransactionId: '2000000901', productId: 'com.x.pro', expiresDate: 4102444800000 })
  assert.equal(readOriginalTransactionId(jws), '2000000901')
})

test('un JWS illisible ne jette pas, il rend null', () => {
  assert.equal(readOriginalTransactionId('pas-un-jws'), null)
  assert.equal(readOriginalTransactionId(''), null)
  assert.equal(readOriginalTransactionId('a.b'), null)
  assert.equal(readOriginalTransactionId(fakeJws({ productId: 'com.x.pro' })), null)
})

test('un identifiant qui n est pas une chaine de chiffres est refuse', () => {
  // Il part dans une URL vers Apple : rien d'autre que des chiffres n'y entre.
  assert.equal(readOriginalTransactionId(fakeJws({ originalTransactionId: '../../evil' })), null)
  assert.equal(readOriginalTransactionId(fakeJws({ originalTransactionId: 12345 })), null)
})

// --- createAppStoreClient: la vraie prise de risque de ce fichier -------
//
// Le brief ne teste que readOriginalTransactionId (la moitie sans etat). La
// moitie qui compte est ici : c'est createAppStoreClient qui parle a Apple,
// choisit l'environnement, et decide entre null/lancer/renvoyer un objet.
// fetchImpl est injectable pour exactement cette raison ; aucun de ces tests
// ne touche le reseau.
//
// providerToken() signe reellement un JWT (jose + importPKCS8) avant chaque
// appel HTTP, donc les tests ont besoin d'une vraie cle EC P-256 valide -- une
// fausse chaine ferait echouer la signature avant meme d'atteindre fetchImpl.
// Generer la cle est le seul moyen de rendre lookup() testable sans reseau ET
// sans modifier createAppStoreClient pour contourner providerToken().
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
process.env.APPLE_IAP_KEY_ID = 'TESTKEY123'
process.env.APPLE_IAP_ISSUER_ID = '11111111-2222-3333-4444-555555555555'
process.env.APPLE_IAP_BUNDLE_ID = 'com.louisguichard.podcapp'
process.env.APPLE_IAP_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const PROD = 'https://api.storekit.itunes.apple.com'
const SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com'

const fakeTransactionInfo = (payload: unknown) => `${b64url({ alg: 'ES256' })}.${b64url(payload)}.c2ln`

const responseWith = (signedTransactionInfo: string | undefined, status = 200) =>
  new Response(
    JSON.stringify(signedTransactionInfo ? { data: [{ lastTransactions: [{ signedTransactionInfo }] }] } : {}),
    { status }
  )

const validTransaction = (over: Record<string, unknown> = {}) =>
  fakeTransactionInfo({
    originalTransactionId: '2000000901',
    productId: 'com.louisguichard.podcapp.pro',
    bundleId: 'com.louisguichard.podcapp',
    expiresDate: 4102444800000,
    ...over,
  })

test('production est essayee en premier, sandbox seulement sur 404, environment reflete l hote qui repond', async () => {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith(PROD)) return new Response('not found', { status: 404 })
    assert.ok(u.startsWith(SANDBOX), `unexpected host: ${u}`)
    return responseWith(validTransaction())
  }) as typeof fetch

  const client = createAppStoreClient(fetchImpl)
  const result = await client.lookup('2000000901')

  assert.deepEqual(
    calls.map((u) => u.split('/')[2]),
    ['api.storekit.itunes.apple.com', 'api.storekit-sandbox.itunes.apple.com']
  )
  assert.ok(result)
  assert.equal(result?.environment, 'Sandbox')
})

test('un 404 des DEUX hotes rend null, pas une exception', async () => {
  const fetchImpl = (async () => new Response('not found', { status: 404 })) as typeof fetch
  const client = createAppStoreClient(fetchImpl)
  assert.equal(await client.lookup('2000000901'), null)
})

test('un statut d erreur autre que 404 leve, il ne rend jamais null en silence', async () => {
  const fetchImpl = (async () => new Response('server error', { status: 500 })) as typeof fetch
  const client = createAppStoreClient(fetchImpl)
  await assert.rejects(() => client.lookup('2000000901'))
})

test('une reponse bien formee est decodee au bon format, appAccountToken present', async () => {
  const fetchImpl = (async () => responseWith(validTransaction({ appAccountToken: 'user-123' }))) as typeof fetch
  const client = createAppStoreClient(fetchImpl)
  const result = await client.lookup('2000000901')

  assert.deepEqual(result, {
    originalTransactionId: '2000000901',
    productId: 'com.louisguichard.podcapp.pro',
    bundleId: 'com.louisguichard.podcapp',
    expiresDate: new Date(4102444800000),
    appAccountToken: 'user-123',
    environment: 'Production',
  })
})

test('une reponse bien formee SANS appAccountToken le rend null, pas absent ni undefined', async () => {
  const fetchImpl = (async () => responseWith(validTransaction())) as typeof fetch
  const client = createAppStoreClient(fetchImpl)
  const result = await client.lookup('2000000901')
  assert.equal(result?.appAccountToken, null)
})

test('signedTransactionInfo absent rend null plutot qu un objet a moitie construit', async () => {
  const fetchImpl = (async () => responseWith(undefined)) as typeof fetch
  const client = createAppStoreClient(fetchImpl)
  assert.equal(await client.lookup('2000000901'), null)
})

test('signedTransactionInfo illisible (pas un JWS a 3 parties, ou payload non-JSON) rend null', async () => {
  const notThreeParts = (async () => responseWith('juste-une-chaine')) as typeof fetch
  assert.equal(await createAppStoreClient(notThreeParts).lookup('2000000901'), null)

  const unparseablePayload = (async () =>
    responseWith('aGVhZGVy.pas-du-base64url-json.c2ln')) as typeof fetch
  assert.equal(await createAppStoreClient(unparseablePayload).lookup('2000000901'), null)
})
