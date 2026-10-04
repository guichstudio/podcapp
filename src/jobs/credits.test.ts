import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { episodes, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import {
  creditsForUsd,
  creditsMessage,
  creditsView,
  hasCreditsFor,
  PLAN_MONTHLY_CREDITS,
  reserveCredits,
  spentCreditsThisMonth,
  typicalCredits,
} from './credits.js'

// Ces tests exercent les regles ALLUMEES (voir freemiumEnforced dans quota.ts).
process.env.FREEMIUM_ENFORCED = 'true'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

const seedUser = async (db: TestDb) => {
  const [u] = await db
    .insert(users)
    .values({ email: `${randomBytes(6).toString('hex')}@example.com`, apiToken: randomBytes(16).toString('hex'), rssToken: randomBytes(16).toString('hex') })
    .returning({ id: users.id })
  return u!.id
}

const NOW = new Date('2026-10-15T12:00:00Z')

test('100 credits valent 5 euros', () => {
  assert.equal(PLAN_MONTHLY_CREDITS.free, 100)
  // 5 EUR au taux retenu de 1,09 USD pour 1 EUR.
  assert.equal(Math.round(creditsForUsd(5 * 1.09)), 100)
})

test('un briefing plus long coute plus, et la reserve couvre toujours l estimation', () => {
  assert.ok(typicalCredits(3) < typicalCredits(5))
  for (const m of [3, 4, 5]) assert.ok(reserveCredits(m) >= typicalCredits(m), `reserve ${m} min`)
  // Une dizaine a une vingtaine de briefings pour 100 credits, comme annonce.
  assert.ok(100 / typicalCredits(3) >= 12 && 100 / typicalCredits(5) <= 20)
})

test('le mois se compte sur le cout reel des episodes, et un echec ne coute rien', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const at = new Date('2026-10-05T08:00:00Z')
    await db.insert(episodes).values([
      { userId, targetSec: 180, status: 'ready', cost: { total_usd: 0.545 }, createdAt: at },
      { userId, targetSec: 300, status: 'failed', cost: { total_usd: 0.4 }, createdAt: at },
      // Le mois precedent ne compte pas.
      { userId, targetSec: 300, status: 'ready', cost: { total_usd: 0.6 }, createdAt: new Date('2026-09-30T23:00:00Z') },
    ])
    assert.equal(Math.round(await spentCreditsThisMonth(db, userId, NOW)), 10)
  } finally {
    await cleanup()
  }
})

test('un episode en cours reserve sa place au prix fort, sauf pour lui-meme', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const [inFlight] = await db
      .insert(episodes)
      .values({ userId, targetSec: 300, status: 'tts', createdAt: new Date('2026-10-14T06:00:00Z') })
      .returning({ id: episodes.id })
    assert.equal(await spentCreditsThisMonth(db, userId, NOW), reserveCredits(5))
    // Le pipeline se pose la question pour son propre episode : il ne se compte pas.
    assert.equal(await spentCreditsThisMonth(db, userId, NOW, { exceptEpisodeId: inFlight!.id }), 0)
  } finally {
    await cleanup()
  }
})

test('on ne lance un briefing que si la reserve tient dans ce qui reste', () => {
  assert.equal(hasCreditsFor('free', 0, 5), true)
  assert.equal(hasCreditsFor('free', 100 - reserveCredits(3), 3), true)
  assert.equal(hasCreditsFor('free', 100 - reserveCredits(3) + 0.5, 3), false)
  // Les paliers payants n'ont pas de credits (illimites tant que l'achat n'existe pas).
  assert.equal(hasCreditsFor('pro', 1000, 5), true)
})

test('eteint, personne n a de credits a compter', () => {
  delete process.env.FREEMIUM_ENFORCED
  try {
    assert.equal(hasCreditsFor('free', 1000, 5), true)
    assert.equal(creditsView('free', 50, NOW), null)
  } finally {
    process.env.FREEMIUM_ENFORCED = 'true'
  }
})

test('l app recoit le solde, le renouvellement et le prix de chaque duree', () => {
  const view = creditsView('free', 28.4, NOW)!
  assert.equal(view.monthly, 100)
  assert.equal(view.left, 71)
  assert.equal(view.resets_at, '2026-11-01T00:00:00.000Z')
  assert.deepEqual(Object.keys(view.per_episode), ['3', '4', '5'])
  assert.equal(view.reserve['3'], reserveCredits(3))
  assert.equal(creditsView('free', 140, NOW)!.left, 0)
  assert.equal(creditsView('pro', 10, NOW), null)
})

test('le refus dit ce qui reste et quand ca revient, dans la langue de l utilisateur', () => {
  const fr = creditsMessage('fr', 3, 3, NOW)
  assert.match(fr, /3 crédits/)
  assert.match(fr, /1er novembre/)
  const en = creditsMessage('en-US', 3, 3, NOW)
  assert.match(en, /3 credits/)
  assert.match(en, /November 1/)
})
