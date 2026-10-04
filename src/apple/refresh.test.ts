import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { planOf } from '../jobs/quota.js'
import type { AppleSubscription } from './appstore.js'
import { planWithSafetyNet, refreshByTransaction } from './refresh.js'

const clientReturning = (sub: AppleSubscription | null) => ({ lookup: async () => sub })

const seed = async (db: Awaited<ReturnType<typeof createTestDb>>['db'], over: Record<string, unknown> = {}) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(6).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
      ...over,
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

test('un renouvellement repousse l echeance sans que l app s ouvre', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2026-09-10T00:00:00Z') })
    const out = await refreshByTransaction(db, clientReturning(sub()), '2000000901')
    assert.equal(out, 'updated')
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.planExpiresAt!.toISOString(), '2027-01-01T00:00:00.000Z')
  } finally {
    await cleanup()
  }
})

test('un remboursement retombe en gratuit immediatement', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2027-01-01T00:00:00Z') })
    // Apple ne connait plus cette transaction : revocation.
    const out = await refreshByTransaction(db, clientReturning(null), '2000000901')
    assert.equal(out, 'downgraded')
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.plan, 'free')
    assert.equal(row!.planExpiresAt, null)
  } finally {
    await cleanup()
  }
})

test('une notification pour une transaction inconnue ne touche personne', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    await seed(db)
    assert.equal(await refreshByTransaction(db, clientReturning(sub()), '9999999999'), 'unknown')
  } finally {
    await cleanup()
  }
})

test('UN ABONNE EN GRACE N EST PAS RETROGRADE, echeance passee comprise', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const now = new Date('2026-09-09T12:00:00Z')
    const userId = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2026-09-01T00:00:00Z') })
    const out = await refreshByTransaction(
      db,
      clientReturning(sub({ status: 4, expiresDate: new Date('2026-09-01T00:00:00Z') })),
      '2000000901',
      now,
    )
    assert.equal(out, 'updated')
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(planOf(row!, now), 'pro')
  } finally {
    await cleanup()
  }
})

test('un remboursement retrograde meme quand l echeance d Apple est encore future', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2027-01-01T00:00:00Z') })
    const out = await refreshByTransaction(db, clientReturning(sub({ status: 5 })), '2000000901')
    assert.equal(out, 'downgraded')
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.plan, 'free')
    // Garde : un renouvellement tardif doit pouvoir retrouver la ligne.
    assert.equal(row!.planOriginalTxnId, '2000000901')
  } finally {
    await cleanup()
  }
})

const readRow = async (db: Awaited<ReturnType<typeof createTestDb>>['db'], id: string) => {
  const [row] = await db
    .select({ id: users.id, plan: users.plan, planExpiresAt: users.planExpiresAt, planOriginalTxnId: users.planOriginalTxnId })
    .from(users)
    .where(eq(users.id, id))
  return row!
}

test('le filet ne derange pas Apple pour un compte gratuit ni pour un palier en cours', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    let calls = 0
    const counting = () => ({ lookup: async () => { calls++; return sub() } })
    const free = await seed(db)
    assert.equal(await planWithSafetyNet(db, await readRow(db, free), counting), 'free')
    const paid = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2099-01-01T00:00:00Z') })
    assert.equal(await planWithSafetyNet(db, await readRow(db, paid), counting), 'pro')
    assert.equal(calls, 0)
  } finally {
    await cleanup()
  }
})

test('LE FILET : une echeance passee relit Apple, et un renouvellement manque garde le palier', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    // Le webhook du renouvellement n'est jamais arrive : la base dit echu.
    const id = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2026-09-01T00:00:00Z') })
    const plan = await planWithSafetyNet(db, await readRow(db, id), () => clientReturning(sub()), new Date('2026-09-09T00:00:00Z'))
    assert.equal(plan, 'pro')
  } finally {
    await cleanup()
  }
})

test('le filet suit Apple quand l abonnement a vraiment pris fin', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const id = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2026-09-01T00:00:00Z') })
    const plan = await planWithSafetyNet(
      db,
      await readRow(db, id),
      () => clientReturning(sub({ status: 2, expiresDate: new Date('2026-09-01T00:00:00Z') })),
      new Date('2026-09-09T00:00:00Z'),
    )
    assert.equal(plan, 'free')
  } finally {
    await cleanup()
  }
})

test('APPLE INJOIGNABLE : l abonne garde son palier, on ne coupe pas quelqu un qui paie sur une panne', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const id = await seed(db, { plan: 'plus', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2026-09-01T00:00:00Z') })
    const failing = () => ({ lookup: async (): Promise<AppleSubscription | null> => { throw new Error('app store server api 503') } })
    const plan = await planWithSafetyNet(db, await readRow(db, id), failing, new Date('2026-09-09T00:00:00Z'))
    assert.equal(plan, 'plus')
  } finally {
    await cleanup()
  }
})
