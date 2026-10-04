import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { episodes, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import {
  countEpisodesThisMonth,
  hasQuotaLeft,
  monthResetsAt,
  planOf,
  PLAN_EPISODE_LIMIT,
  quotaMessage,
} from './quota.js'

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

test('un palier expire retombe en gratuit sans rien reecrire', () => {
  const now = new Date('2026-09-15T00:00:00Z')
  assert.equal(planOf({ plan: 'pro', planExpiresAt: new Date('2026-09-20T00:00:00Z') }, now), 'pro')
  assert.equal(planOf({ plan: 'pro', planExpiresAt: new Date('2026-09-01T00:00:00Z') }, now), 'free')
  assert.equal(planOf({ plan: 'pro', planExpiresAt: null }, now), 'free')
  assert.equal(planOf({ plan: 'free', planExpiresAt: null }, now), 'free')
})

test('une valeur de palier inconnue en base vaut gratuit', () => {
  const now = new Date('2026-09-15T00:00:00Z')
  const far = new Date('2027-01-01T00:00:00Z')
  assert.equal(planOf({ plan: 'platinum', planExpiresAt: far }, now), 'free')
})

test('le quota compte les episodes prets et ceux en vol, jamais les echoues', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const now = new Date('2026-09-15T12:00:00Z')
    await db.insert(episodes).values([
      { userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-09-02T00:00:00Z') },
      { userId, targetSec: 180, status: 'failed', createdAt: new Date('2026-09-03T00:00:00Z') },
    ])
    assert.equal(await countEpisodesThisMonth(db, userId, now), 1)

    // Un run en vol occupe une place. Le meme insert ne peut pas cohabiter avec
    // un autre actif : l'index partiel episodes_one_active_per_user l'interdit.
    await db.insert(episodes).values({ userId, targetSec: 180, status: 'tts', createdAt: now })
    assert.equal(await countEpisodesThisMonth(db, userId, now), 2)
  } finally {
    await cleanup()
  }
})

test("l'episode exclu ne se compte pas lui-meme, et sans exclusion rien ne change", async () => {
  // La difference entre les deux moments ou la regle est lue. La porte d'entree
  // (POST /episodes, le cron) compte AVANT d'inserer : "reste-t-il une place ?".
  // Le pipeline compte APRES, depuis un run qui possede deja sa ligne 'queued' :
  // sans s'exclure il verrait sa propre place comme prise et le gratuit
  // (limite 1) echouerait a tous les coups.
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const now = new Date('2026-09-15T12:00:00Z')
    const [mine] = await db
      .insert(episodes)
      .values({ userId, targetSec: 180, status: 'queued', createdAt: now })
      .returning({ id: episodes.id })

    // Sans exclusion : la porte d'entree voit bien la ligne en vol.
    assert.equal(await countEpisodesThisMonth(db, userId, now), 1)
    // Option donnee mais vide : meme reponse que sans option du tout.
    assert.equal(await countEpisodesThisMonth(db, userId, now, {}), 1)
    assert.equal(await countEpisodesThisMonth(db, userId, now, { exceptEpisodeId: null }), 1)
    // Avec exclusion : le run ne se compte pas lui-meme, il reste une place.
    assert.equal(await countEpisodesThisMonth(db, userId, now, { exceptEpisodeId: mine!.id }), 0)

    // L'exclusion ne porte QUE sur cette ligne : un autre episode du mois compte
    // toujours, sinon elle deviendrait une porte derobee sur tout le quota.
    const [other] = await db
      .insert(episodes)
      .values({ userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-09-02T00:00:00Z') })
      .returning({ id: episodes.id })
    assert.equal(await countEpisodesThisMonth(db, userId, now, { exceptEpisodeId: mine!.id }), 1)
    assert.equal(await countEpisodesThisMonth(db, userId, now, { exceptEpisodeId: other!.id }), 1)
    assert.equal(await countEpisodesThisMonth(db, userId, now), 2)
  } finally {
    await cleanup()
  }
})

test('le mois est calendaire UTC : le mois precedent ne compte pas', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    await db.insert(episodes).values([
      { userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-08-31T23:59:59Z') },
      { userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-09-01T00:00:00Z') },
    ])
    assert.equal(await countEpisodesThisMonth(db, userId, new Date('2026-09-15T00:00:00Z')), 1)
  } finally {
    await cleanup()
  }
})

test('les episodes d un autre compte ne comptent pas', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const mine = await seedUser(db)
    const theirs = await seedUser(db)
    await db.insert(episodes).values({ userId: theirs, targetSec: 180, status: 'ready' })
    assert.equal(await countEpisodesThisMonth(db, mine, new Date()), 0)
  } finally {
    await cleanup()
  }
})

test('chaque palier refuse exactement a sa limite', () => {
  assert.equal(hasQuotaLeft(0, 'free'), true)
  assert.equal(hasQuotaLeft(1, 'free'), false)
  assert.equal(hasQuotaLeft(7, 'plus'), true)
  assert.equal(hasQuotaLeft(8, 'plus'), false)
  assert.equal(hasQuotaLeft(11, 'pro'), true)
  assert.equal(hasQuotaLeft(12, 'pro'), false)
  assert.deepEqual(PLAN_EPISODE_LIMIT, { free: 1, plus: 8, pro: 12 })
})

test('la remise a zero est le 1er du mois suivant, en UTC', () => {
  assert.equal(monthResetsAt(new Date('2026-09-15T12:00:00Z')).toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(monthResetsAt(new Date('2026-12-31T23:59:59Z')).toISOString(), '2027-01-01T00:00:00.000Z')
})

test('le refus est dans la langue de l utilisateur et nomme le palier', () => {
  assert.match(quotaMessage('fr', 'free'), /1 épisode/)
  assert.match(quotaMessage('en-US', 'plus'), /8 episodes/)
})
