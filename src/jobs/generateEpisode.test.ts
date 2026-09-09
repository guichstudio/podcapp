import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { Db } from '../db/client.js'
import { createTestDb } from '../db/testDb.js'
import { episodes, stories, users } from '../db/schema.js'
import type { Storage } from '../storage/index.js'
import {
  countUnsupportedShipped,
  editDrift,
  generateEpisode,
  mergeEditedChapters,
  stripBlocklist,
  type GroundingEntry,
} from './generateEpisode.js'
import { RUN_ARTIFACTS, runArtifactKey } from './runArtifacts.js'

test('stripBlocklist removes the filler clause and leaves a sentence behind', () => {
  // A speech engine reads what is left out loud, so the cut takes the conjunction
  // the clause introduced and the sentence starts on a capital again.
  assert.equal(stripBlocklist('Il est important de noter que le marché a doublé.'), 'Le marché a doublé.')
  assert.equal(stripBlocklist("It's important to note that the market doubled."), 'The market doubled.')
  assert.equal(stripBlocklist('Sans plus attendre , le sujet du jour.'), 'Le sujet du jour.')
  assert.equal(
    stripBlocklist('Le marché a doublé, il est important de noter que la tendance continue.'),
    'Le marché a doublé, la tendance continue.',
  )
})

test('stripBlocklist drops a sentence that was nothing but filler', () => {
  assert.equal(stripBlocklist("Let's dive in. The market doubled."), 'The market doubled.')
  assert.equal(stripBlocklist('Buckle up. Le marché a doublé.'), 'Le marché a doublé.')
})

test('stripBlocklist never deletes a single word inside a clause', () => {
  // These would leave an ungrammatical sentence the model editor cannot repair,
  // because it only ever sees the mutilated version.
  const sentences = [
    "Le décryptage de la semaine porte sur l'énergie.",
    'This is a fascinating result for the field.',
    'The deal is a game-changer for the sector.',
    "C'est une véritable révolution pour le secteur.",
    'Plongeons dans les chiffres.',
    'Accrochez-vous, les chiffres arrivent.',
  ]
  for (const sentence of sentences) assert.equal(stripBlocklist(sentence), sentence)
})

test('mergeEditedChapters matches by position, not by title', () => {
  const preEdit = [
    { title: 'IA', text: 'Premier bloc.' },
    { title: 'IA', text: 'Deuxième bloc.' },
    { title: 'Outro', text: 'Fin.' },
  ]
  const edited = [
    { title: 'IA', text: 'Premier bloc édité.' },
    { title: 'IA', text: 'Deuxième bloc édité.' },
    { title: 'Outro', text: 'Fin éditée.' },
  ]
  assert.deepEqual(mergeEditedChapters(preEdit, edited), {
    texts: ['Premier bloc édité.', 'Deuxième bloc édité.', 'Fin éditée.'],
    rejected: 0,
  })
})

test('mergeEditedChapters keeps the edit when the model renames a chapter', () => {
  const preEdit = [{ title: 'IA générative', text: 'Avant.' }]
  const edited = [{ title: "L'IA générative", text: 'Après.' }]
  assert.deepEqual(mergeEditedChapters(preEdit, edited), { texts: ['Après.'], rejected: 0 })
})

test('mergeEditedChapters falls back to the pre-edit text when a chapter comes back empty', () => {
  const preEdit = [
    { title: 'Intro', text: 'Bonjour.' },
    { title: 'Sujet', text: 'Le fond du sujet.' },
  ]
  const edited = [
    { title: 'Intro', text: '   ' },
    { title: 'Sujet', text: ' Le fond du sujet, resserré. ' },
  ]
  assert.deepEqual(mergeEditedChapters(preEdit, edited), {
    texts: ['Bonjour.', 'Le fond du sujet, resserré.'],
    rejected: 0,
  })
})

test('mergeEditedChapters throws when the edit pass loses or invents a chapter', () => {
  const preEdit = [
    { title: 'Intro', text: 'A.' },
    { title: 'Sujet', text: 'B.' },
  ]
  assert.throws(() => mergeEditedChapters(preEdit, [{ title: 'Intro', text: 'A.' }]), /returned 1 chapters for 2 sent/)
  assert.throws(
    () =>
      mergeEditedChapters(preEdit, [
        { title: 'Intro', text: 'A.' },
        { title: 'Sujet', text: 'B.' },
        { title: 'Bonus', text: 'C.' },
      ]),
    /returned 3 chapters for 2 sent/,
  )
})

// The edit pass ships without being re-grounded, so this guard is the only thing
// standing between a rewritten fact and the listener.
const GROUNDED = "La société a levé environ 100 millions d'euros. Selon Les Échos, le tour est bouclé."

test('editDrift passes a reword that keeps every fact', () => {
  assert.equal(
    editDrift(GROUNDED, "Selon Les Échos, la société a levé environ 100 millions d'euros, et le tour est bouclé."),
    null,
  )
  assert.equal(editDrift(GROUNDED, 'Selon Les Échos, le tour est bouclé.'), null)
})

test('editDrift passes an edit that only re-cuts the sentences', () => {
  // Splitting a sentence promotes an ordinary word to first position, where it
  // is shaped like a name. It was already in the text, so it is not a new fact.
  assert.equal(
    editDrift('Le tour est bouclé grâce à cette levée.', 'Le tour est bouclé. Grâce à cette levée, le marché suit.'),
    null,
  )
})

test('editDrift rejects a number, a name or a quote the editor introduced', () => {
  assert.match(
    editDrift(GROUNDED, "La société a levé environ 100 millions d'euros, en hausse de 12 pour cent.") ?? '',
    /number "12 pour cent"/,
  )
  assert.match(
    editDrift(GROUNDED, "Selon Anthropic, la société a levé environ 100 millions d'euros.") ?? '',
    /name "Anthropic"/,
  )
  assert.match(
    editDrift('Le patron parle de prudence.', 'Le patron évoque « une année difficile ».') ?? '',
    /quote "une année difficile"/,
  )
})

test('editDrift rejects a hedge dropped from a number', () => {
  // "environ 100 millions" becoming "100 millions" is the exact failure the
  // editor's byte-identical instruction cannot enforce on its own.
  assert.match(
    editDrift(GROUNDED, "La société a levé 100 millions d'euros. Selon Les Échos, le tour est bouclé.") ?? '',
    /hedge dropped on "100 millions"/,
  )
  // The writer spells numbers out for the voice, so this is the shape it takes
  // on air: "plus de mille huit cents milliards" turned into a flat figure.
  assert.match(
    editDrift('Le marché pèse plus de mille huit cents milliards.', 'Le marché pèse mille huit cents milliards.') ?? '',
    /hedge dropped on "mille huit cents milliards"/,
  )
})

test('mergeEditedChapters keeps the grounded text when the edit changes a fact', () => {
  const preEdit = [
    { title: 'Levée', text: "La société a levé environ 100 millions d'euros." },
    { title: 'Suite', text: 'Le tour est bouclé.' },
  ]
  const edited = [
    { title: 'Levée', text: "La société a levé 100 millions d'euros." },
    { title: 'Suite', text: 'Le tour est désormais bouclé.' },
  ]
  assert.deepEqual(mergeEditedChapters(preEdit, edited), {
    texts: ["La société a levé environ 100 millions d'euros.", 'Le tour est désormais bouclé.'],
    rejected: 1,
  })
})

const ENTRIES: GroundingEntry[] = [
  { chapter: 'A', sentence: "La société a levé 100 millions d'euros.", supported: true, action: 'kept' },
  { chapter: 'A', sentence: 'Le tour dépasse 300 millions.', supported: false, action: 'dropped' },
  { chapter: 'B', sentence: 'La valorisation atteint 4 milliards.', supported: false, action: 'dropped_no_verdict' },
]

test('countUnsupportedShipped clears what the grounder explicitly supported', () => {
  assert.equal(
    countUnsupportedShipped(ENTRIES, [
      { text: "La société a levé 100 millions d'euros. Le reste attendra.", entities: [] },
    ]),
    0,
  )
  // The editor may reword: what must survive is the fact, not the wording.
  assert.equal(
    countUnsupportedShipped(ENTRIES, [
      { text: "Elle a levé 100 millions d'euros selon le communiqué.", entities: [] },
    ]),
    0,
  )
})

test('countUnsupportedShipped counts what ships without a supported verdict', () => {
  // A dropped sentence that found its way back in.
  assert.equal(countUnsupportedShipped(ENTRIES, [{ text: 'Le tour dépasse 300 millions.', entities: [] }]), 1)
  // A sentence no verdict ever covered.
  assert.equal(countUnsupportedShipped(ENTRIES, [{ text: 'La valorisation atteint 4 milliards.', entities: [] }]), 1)
  // An attribution the editor, or an ungrounded intro, invented outright.
  assert.equal(countUnsupportedShipped(ENTRIES, [{ text: 'Selon Anthropic, la tendance accélère.', entities: [] }]), 1)
  assert.equal(
    countUnsupportedShipped(ENTRIES, [
      { text: "La société a levé 100 millions d'euros.", entities: [] },
      { text: 'Selon Anthropic, la tendance accélère. La valorisation atteint 4 milliards.', entities: [] },
    ]),
    2,
  )
})

test('countUnsupportedShipped ships the fix the grounder wrote, not the sentence it replaced', () => {
  const entries: GroundingEntry[] = [
    {
      chapter: 'A',
      sentence: 'La société a levé 100 millions.',
      supported: false,
      action: 'fixed',
      fix: 'Selon Les Échos, la société a levé 100 millions.',
    },
  ]
  assert.equal(
    countUnsupportedShipped(entries, [{ text: 'Selon Les Échos, la société a levé 100 millions.', entities: [] }]),
    0,
  )
})

test('a run that throws still persists the artifacts it produced', async () => {
  // The expensive failures are the late ones, and they used to leave nothing to
  // read. Here the run dies on its very first query, which is the poorest case:
  // even then the record has to exist and say why.
  const written = new Map<string, string>()
  const storage: Storage = {
    put: async (key, body) => {
      written.set(key, body.toString('utf8'))
    },
    get: async () => null,
      delete: async () => {},
    publicUrl: (key) => key,
  }
  const db = {
    select: () => {
      throw new Error('db down')
    },
  } as unknown as Db

  await assert.rejects(generateEpisode(db, { userId: 'u1', targetSec: 900, episodeId: 'ep1', storage }), /db down/)
  assert.deepEqual(
    [...written.keys()].sort(),
    RUN_ARTIFACTS.map((name) => runArtifactKey('ep1', name)).sort(),
  )
  const metrics = JSON.parse(written.get(runArtifactKey('ep1', 'metrics')) ?? '{}') as { error?: string }
  assert.match(metrics.error ?? '', /db down/)
})

// Seed exactly the way every real caller seeds. POST /episodes (both
// entrypoints) and the 06:00 cron insert the 'queued' row FIRST and only then
// hand its id to the pipeline, so a test that calls generateEpisode with no
// episodeId and no queued row is testing a sequence nobody runs -- and it
// passes identically whether the counting rule is right or wrong.
async function seedLikeTheApi(
  db: Db,
  opts: { plan: string; alreadyReadyThisMonth: number },
): Promise<{ userId: string; episodeId: string }> {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(6).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
      plan: opts.plan,
    })
    .returning({ id: users.id })
  const userId = u!.id

  for (let i = 0; i < opts.alreadyReadyThisMonth; i++) {
    await db.insert(episodes).values({ userId, targetSec: 180, status: 'ready' })
  }

  // Plenty of material: an open story with three distinct sources clears the
  // links rule on its own, so anything refused below is refused by the quota.
  await db.insert(stories).values({
    userId,
    headline: 'Test story',
    sourceIds: [randomUUID(), randomUUID(), randomUUID()],
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    status: 'open',
  })

  // The row the route inserts before triggering the run. It is 'queued', so it
  // is not 'failed', so the plain monthly count sees it.
  const [ep] = await db
    .insert(episodes)
    .values({ userId, targetSec: 180, status: 'queued' })
    .returning({ id: episodes.id })
  return { userId, episodeId: ep!.id }
}

const noopStorage: Storage = {
  put: async () => {},
  get: async () => null,
  delete: async () => {},
  publicUrl: (key) => key,
}

test('the pipeline refuses to spend on a run that reached it with no quota left', async () => {
  // The fourth enforcement point: it must fire even when the links rule alone
  // would let the run through (three distinct sources, well above the
  // MIN_SOURCES_PER_EPISODE floor), because it is the only guard standing
  // between a run triggered some other way (a retry, a manual dashboard
  // trigger) and paying the writer and TTS for an episode nobody is owed.
  const { db, cleanup } = await createTestDb()
  try {
    // Free's entire monthly ration (PLAN_EPISODE_LIMIT.free = 1) is already
    // spent by a published episode; the queued row is the SECOND of the month.
    const { userId, episodeId } = await seedLikeTheApi(db, { plan: 'free', alreadyReadyThisMonth: 1 })

    await assert.rejects(
      generateEpisode(db, { userId, targetSec: 180, episodeId, storage: noopStorage }),
      /monthly quota spent for plan free/,
    )
  } finally {
    await cleanup()
  }
})

test('the first episode of the month is not refused to a free user', async () => {
  // The off-by-one this whole guard nearly shipped with. The route counts
  // BEFORE inserting ("is there room for one more?") and lets the user in; the
  // pipeline counts AFTER, from inside a run that already owns its 'queued'
  // row. Counting that row makes used=1 against a limit of 1, so EVERY free
  // episode fails, forever, and the 06:00 cron repeats it every morning.
  const { db, cleanup } = await createTestDb()
  try {
    const { userId, episodeId } = await seedLikeTheApi(db, { plan: 'free', alreadyReadyThisMonth: 0 })

    // Past the quota gate the next thing the pipeline does is call the
    // editorial model, so the run still throws -- but on a missing API key, not
    // on the quota. Cleared explicitly so this never reaches the network.
    const saved = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    let err: unknown
    try {
      await generateEpisode(db, { userId, targetSec: 180, episodeId, storage: noopStorage })
    } catch (e) {
      err = e
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved
    }

    assert.doesNotMatch(
      String(err ?? ''),
      /monthly quota spent/,
      'a free user with zero episodes this month was refused their first one',
    )
    // And it really did get all the way past the gate, rather than stopping
    // somewhere earlier for an unrelated reason.
    assert.match(String(err ?? ''), /Missing env var DEEPSEEK_API_KEY/)
  } finally {
    await cleanup()
  }
})
