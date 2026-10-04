import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import {
  APPLE_SUBSCRIPTION_STATUS,
  createAppStoreClient,
  entitledUntil,
  isEntitled,
  readOriginalTransactionId,
  readSignedTransactionFromNotification,
  type AppleSubscription,
} from './appstore.js'

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

// lastTransactions[] porte originalTransactionId et status AU NIVEAU DE LA
// LIGNE (doc Apple, LastTransactionsItem) : c'est ce champ qui identifie la
// bonne ligne parmi les groupes d'abonnement du client.
const responseWith = (signedTransactionInfo: string | undefined, status = 200) =>
  new Response(
    JSON.stringify(
      signedTransactionInfo
        ? { data: [{ lastTransactions: [{ originalTransactionId: '2000000901', status: 1, signedTransactionInfo }] }] }
        : {}
    ),
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
    if (u.startsWith(PROD))
      return new Response(JSON.stringify({ errorCode: 4040010, errorMessage: 'Transaction id not found.' }), {
        status: 404,
      })
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
  // 4040010 : Apple dit "transaction id not found", donc "pas dans cet
  // environnement". Un 404 nu, lui, leve desormais (voir plus bas).
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ errorCode: 4040010, errorMessage: 'Transaction id not found.' }), {
      status: 404,
    })) as typeof fetch
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
    status: 1,
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

// --- Revue de Task 4 : les trois defauts corriges ------------------------
//
// Documentation consultee (developer.apple.com, via les JSON docc, 2026-09-09) :
//   GET /inApps/v1/subscriptions/{originalTransactionId} repond 404 avec
//   AccountNotFoundError (4040001), AccountNotFoundRetryableError (4040002),
//   AppNotFoundError (4040003), AppNotFoundRetryableError (4040004) ou
//   TransactionIdNotFoundError (4040010). Un seul de ces cinq veut dire
//   "cette transaction n'est pas ici".
//   lastTransactions[] porte originalTransactionId ET status (1 actif,
//   2 expire, 3 relance de facturation, 4 delai de grace, 5 REVOQUE/rembourse).

const notFound = (errorCode: number, errorMessage = 'x') =>
  new Response(JSON.stringify({ errorCode, errorMessage }), { status: 404 })

const groups = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })

test('un identifiant qui n est pas une chaine de chiffres n atteint JAMAIS l URL', async () => {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return responseWith(validTransaction())
  }) as typeof fetch
  const client = createAppStoreClient(fetchImpl)

  // Sans filtre, fetch normalise ce chemin en
  // https://api.storekit-sandbox.itunes.apple.com/v1/notifications/test?x=
  // -- un AUTRE endpoint d'Apple, avec notre jeton de fournisseur attache.
  await assert.rejects(() => client.lookup('../../../v1/notifications/test?x='))
  await assert.rejects(() => client.lookup('2000000901/../../evil'))
  await assert.rejects(() => client.lookup('2000000901?status=1'))
  await assert.rejects(() => client.lookup(''))
  assert.deepEqual(calls, [])
})

test('404 avec 4040010 (transaction inconnue ici) rend null : c est le seul code qui le peut', async () => {
  const fetchImpl = (async () => notFound(4040010, 'Transaction id not found.')) as typeof fetch
  assert.equal(await createAppStoreClient(fetchImpl).lookup('2000000901'), null)
})

test('404 de mauvaise configuration (app/compte introuvable) LEVE en nommant le code, sans jamais degrader un abonne', async () => {
  for (const code of [4040001, 4040002, 4040003, 4040004]) {
    const fetchImpl = (async () => notFound(code)) as typeof fetch
    await assert.rejects(
      () => createAppStoreClient(fetchImpl).lookup('2000000901'),
      (e: Error) => e.message.includes(String(code)),
      `errorCode ${code} devrait lever en nommant le code`
    )
  }
})

test('404 dont le corps est illisible leve aussi : on ne devine pas "pas d abonnement"', async () => {
  const fetchImpl = (async () => new Response('<html>nope</html>', { status: 404 })) as typeof fetch
  await assert.rejects(() => createAppStoreClient(fetchImpl).lookup('2000000901'))
})

test('aucun identifiant, jeton ni cle ne fuit dans le message d erreur', async () => {
  let sentToken = ''
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentToken = String((init?.headers as Record<string, string>)?.Authorization ?? '')
    return notFound(4040003)
  }) as typeof fetch
  await assert.rejects(
    () => createAppStoreClient(fetchImpl).lookup('2000000901'),
    (e: Error) => {
      assert.ok(sentToken.startsWith('Bearer '), 'le jeton doit bien avoir ete envoye')
      const message = `${e.message}\n${e.stack ?? ''}`
      assert.ok(!message.includes(sentToken.slice(7)), 'le jeton de fournisseur fuit')
      assert.ok(!message.includes('PRIVATE KEY'), 'la cle fuit')
      assert.ok(!message.includes(process.env.APPLE_IAP_ISSUER_ID!), 'l issuer id fuit')
      return true
    }
  )
})

test('la ligne rendue est CELLE de l identifiant demande, pas la premiere du premier groupe', async () => {
  // Un client peut avoir plusieurs groupes d'abonnement, et un groupe peut
  // porter une transaction expiree a cote de l'active.
  const fetchImpl = (async () =>
    groups([
      {
        subscriptionGroupIdentifier: '111',
        lastTransactions: [
          {
            originalTransactionId: '9999999999',
            status: 2,
            signedTransactionInfo: validTransaction({
              originalTransactionId: '9999999999',
              productId: 'com.autre.groupe',
            }),
          },
        ],
      },
      {
        subscriptionGroupIdentifier: '222',
        lastTransactions: [
          {
            originalTransactionId: '8888888888',
            status: 2,
            signedTransactionInfo: validTransaction({
              originalTransactionId: '8888888888',
              productId: 'com.mauvaise.ligne',
            }),
          },
          {
            originalTransactionId: '2000000901',
            status: 1,
            signedTransactionInfo: validTransaction({ productId: 'com.louisguichard.podcapp.pro' }),
          },
        ],
      },
    ])) as typeof fetch

  const result = await createAppStoreClient(fetchImpl).lookup('2000000901')
  assert.equal(result?.originalTransactionId, '2000000901')
  assert.equal(result?.productId, 'com.louisguichard.podcapp.pro')
  assert.equal(result?.status, 1)
})

test('aucune ligne ne correspond a l identifiant demande : null, jamais l etat d un voisin', async () => {
  const fetchImpl = (async () =>
    groups([
      {
        lastTransactions: [
          {
            originalTransactionId: '9999999999',
            status: 1,
            signedTransactionInfo: validTransaction({ originalTransactionId: '9999999999' }),
          },
        ],
      },
    ])) as typeof fetch
  assert.equal(await createAppStoreClient(fetchImpl).lookup('2000000901'), null)
})

test('un abonnement REVOQUE (status 5, rembourse) est visible meme si expiresDate est dans le futur', async () => {
  const fetchImpl = (async () =>
    groups([
      {
        lastTransactions: [
          {
            originalTransactionId: '2000000901',
            status: 5,
            signedTransactionInfo: validTransaction({ expiresDate: 4102444800000 }),
          },
        ],
      },
    ])) as typeof fetch

  const result = await createAppStoreClient(fetchImpl).lookup('2000000901')
  assert.equal(result?.status, APPLE_SUBSCRIPTION_STATUS.revoked)
  assert.ok(result!.expiresDate > new Date(), 'le piege : la date seule dirait "valide"')
})

test('un status absent ou non documente devient null plutot qu un chiffre invente', async () => {
  const without = (async () =>
    groups([{ lastTransactions: [{ originalTransactionId: '2000000901', signedTransactionInfo: validTransaction() }] }])) as typeof fetch
  assert.equal((await createAppStoreClient(without).lookup('2000000901'))?.status, null)

  const bogus = (async () =>
    groups([
      { lastTransactions: [{ originalTransactionId: '2000000901', status: 99, signedTransactionInfo: validTransaction() }] },
    ])) as typeof fetch
  assert.equal((await createAppStoreClient(bogus).lookup('2000000901'))?.status, null)
})

const subOf = (over: Partial<AppleSubscription> = {}): AppleSubscription => ({
  originalTransactionId: '2000000901',
  productId: 'com.louisguichard.podcapp.pro.monthly',
  bundleId: 'com.louisguichard.podcapp',
  expiresDate: new Date('2027-01-01T00:00:00Z'),
  appAccountToken: null,
  environment: 'Production',
  status: 1,
  ...over,
})

test('le droit suit le statut d Apple : actif, nouvelle tentative et grace y ont droit', () => {
  assert.equal(isEntitled(subOf({ status: APPLE_SUBSCRIPTION_STATUS.active })), true)
  assert.equal(isEntitled(subOf({ status: APPLE_SUBSCRIPTION_STATUS.billingRetry })), true)
  assert.equal(isEntitled(subOf({ status: APPLE_SUBSCRIPTION_STATUS.gracePeriod })), true)
  assert.equal(isEntitled(subOf({ status: APPLE_SUBSCRIPTION_STATUS.expired })), false)
  // Rembourse : l'echeance est encore dans le futur, et c'est le statut qui dit non.
  assert.equal(isEntitled(subOf({ status: APPLE_SUBSCRIPTION_STATUS.revoked })), false)
  // Apple n'a rien dit, ou une valeur inconnue : ce n'est pas un droit.
  assert.equal(isEntitled(subOf({ status: null })), false)
})

test('LA GRACE : statut 4 avec une echeance deja passee a toujours droit', () => {
  assert.equal(isEntitled(subOf({ status: 4, expiresDate: new Date('2026-01-01T00:00:00Z') })), true)
})

test('le droit s inscrit en base jusqu a l echeance, ou pour un jour quand elle est deja passee', () => {
  const now = new Date('2026-09-09T12:00:00Z')
  // Echeance future : on la prend telle quelle.
  assert.equal(entitledUntil(subOf(), now).toISOString(), '2027-01-01T00:00:00.000Z')
  // Grace : l'echeance d'Apple est passee, planOf la lirait comme gratuit. Un
  // bail d'un jour, et le filet relit chez Apple quand il expire.
  const lease = entitledUntil(subOf({ status: 4, expiresDate: new Date('2026-09-01T00:00:00Z') }), now)
  assert.equal(lease.toISOString(), '2026-09-10T12:00:00.000Z')
})

test('la notification V2 emboite le JWS de la transaction dans le sien', () => {
  const seg = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  const inner = `h.${seg({ originalTransactionId: '2000000901' })}.s`
  const outer = `h.${seg({ notificationType: 'DID_RENEW', data: { signedTransactionInfo: inner } })}.s`
  assert.equal(readSignedTransactionFromNotification(outer), inner)
  assert.equal(readOriginalTransactionId(readSignedTransactionFromNotification(outer)!), '2000000901')
  assert.equal(readSignedTransactionFromNotification('not.a.jws'), null)
  assert.equal(readSignedTransactionFromNotification(`h.${seg({ data: {} })}.s`), null)
})
