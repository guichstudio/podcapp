import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { planOf } from '../jobs/quota.js'
import type { AppleSubscription } from './appstore.js'
import { linkSubscription } from './link.js'

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db']) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(6).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

const sub = (over: Partial<AppleSubscription> = {}): AppleSubscription => ({
  originalTransactionId: '2000000901',
  productId: 'com.louisguichard.podcapp.pro.monthly',
  bundleId: 'com.louisguichard.podcapp',
  expiresDate: new Date('2027-01-01T00:00:00Z'),
  appAccountToken: null,
  environment: 'Production',
  status: 1,
  ...over,
})

test('un achat marque a mon nom me donne mon palier', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const res = await linkSubscription(db, userId, sub({ appAccountToken: userId }))
    assert.deepEqual(res, { ok: true, plan: 'pro' })
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.plan, 'pro')
    assert.equal(row!.planOriginalTxnId, '2000000901')
    assert.equal(row!.planEnvironment, 'Production')
  } finally {
    await cleanup()
  }
})

test('LE VOL D ABONNEMENT : le jeton de compte d un autre est refuse', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const mine = await seedUser(db)
    const theirs = await seedUser(db)
    const res = await linkSubscription(db, mine, sub({ appAccountToken: theirs }))
    assert.deepEqual(res, { ok: false, reason: 'not_my_purchase' })
    const [row] = await db.select().from(users).where(eq(users.id, mine))
    assert.equal(row!.plan, 'free')
  } finally {
    await cleanup()
  }
})

test('un achat sans jeton de compte est refuse', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    assert.deepEqual(await linkSubscription(db, userId, sub({ appAccountToken: null })), {
      ok: false,
      reason: 'not_my_purchase',
    })
  } finally {
    await cleanup()
  }
})

test('un bundle etranger ou un produit inconnu sont refuses', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    assert.deepEqual(
      await linkSubscription(db, userId, sub({ appAccountToken: userId, bundleId: 'com.autre.app' })),
      { ok: false, reason: 'wrong_bundle' },
    )
    assert.deepEqual(
      await linkSubscription(db, userId, sub({ appAccountToken: userId, productId: 'com.louisguichard.podcapp.platinum' })),
      { ok: false, reason: 'unknown_product' },
    )
  } finally {
    await cleanup()
  }
})

test('un abonnement expire ne donne aucun palier', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const res = await linkSubscription(
      db,
      userId,
      sub({ appAccountToken: userId, status: 2, expiresDate: new Date('2026-01-01T00:00:00Z') }),
      new Date('2026-09-09T00:00:00Z'),
    )
    assert.deepEqual(res, { ok: false, reason: 'not_entitled' })
  } finally {
    await cleanup()
  }
})

test('UN ABONNE EN PERIODE DE GRACE GARDE SON PALIER, echeance passee comprise', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    // Statut 4 : Apple le considere comme ayant droit pendant qu'il regle son
    // incident de paiement, et son expiresDate est DEJA passe. Une comparaison
    // de dates lui couperait le service.
    const res = await linkSubscription(
      db,
      userId,
      sub({ appAccountToken: userId, status: 4, expiresDate: new Date('2026-09-01T00:00:00Z') }),
      new Date('2026-09-09T00:00:00Z'),
    )
    assert.deepEqual(res, { ok: true, plan: 'pro' })
    // Et le palier EFFECTIF, celui que lit tout le reste du code, est bien pro :
    // l'echeance d'Apple etant passee, une ecriture brute la ferait lire gratuit.
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(planOf(row!, new Date('2026-09-09T00:00:00Z')), 'pro')
  } finally {
    await cleanup()
  }
})

test('un abonnement rembourse ne donne aucun palier, meme avec une echeance future', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const res = await linkSubscription(db, userId, sub({ appAccountToken: userId, status: 5 }))
    assert.deepEqual(res, { ok: false, reason: 'not_entitled' })
  } finally {
    await cleanup()
  }
})

test('un abonnement deja rattache ailleurs ne peut pas etre revendique', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const first = await seedUser(db)
    const second = await seedUser(db)
    await linkSubscription(db, first, sub({ appAccountToken: first }))
    // Meme transaction, mais le jeton de compte designe le premier : refus.
    const res = await linkSubscription(db, second, sub({ appAccountToken: first }))
    assert.deepEqual(res, { ok: false, reason: 'not_my_purchase' })
  } finally {
    await cleanup()
  }
})

test('une transaction deja tenue par un autre compte est refusee, sans erreur 500', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const first = await seedUser(db)
    const second = await seedUser(db)
    await linkSubscription(db, first, sub({ appAccountToken: first }))
    // Le jeton designe bien le second, mais l'index unique garde la transaction
    // au premier : on le dit, on ne laisse pas la contrainte lever.
    const res = await linkSubscription(db, second, sub({ appAccountToken: second }))
    assert.deepEqual(res, { ok: false, reason: 'not_my_purchase' })
    const [row] = await db.select().from(users).where(eq(users.id, second))
    assert.equal(row!.plan, 'free')
  } finally {
    await cleanup()
  }
})
