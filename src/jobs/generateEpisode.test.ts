import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { MIN_SOURCES_PER_EPISODE } from '../config.js'
import type { Db } from '../db/client.js'
import { sources, stories, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import type { Storage } from '../storage/index.js'
import { countAvailableSources, hasEnoughSources, unusableMaterialMessage } from './material.js'
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

// --- The morning that repeated itself ---------------------------------------
// A real account failed six times in one morning on one open story whose three
// links were Facebook share wrappers: no article behind them, so the editor
// selected nothing, the run threw, the story stayed `open`, it still satisfied
// the link rule, and 06:00 replayed it the next day. These two tests fence the
// fix in from both sides: zero sections must close the loop, and one section
// must leave everything alone.

interface StubbedCall {
  url: string
  body: string
}

// The pipeline's only seam is fetch: the providers call it directly. Stubbing
// it here runs the REAL runEpisode against a real (PGlite) database, which is
// the only way a test can prove what the story rows look like afterwards.
function stubLlm(handler: (call: StubbedCall) => unknown | Error): () => void {
  const real = globalThis.fetch
  const keys = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const answer = handler({ url, body: String(init?.body ?? '') })
    if (answer instanceof Error) throw answer
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
    for (const [k, v] of Object.entries(keys)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// DeepSeek is OpenAI-shaped; the outline is whatever JSON we hand back here.
const asDeepseek = (payload: unknown): unknown => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
  usage: { prompt_tokens: 10, completion_tokens: 10 },
})

const outlineWith = (sections: unknown[], discarded: { story_id: string; reason: string }[]): unknown => ({
  intro: 'Bonjour.',
  sections,
  discarded,
  outro: 'À demain.',
})

const outlineSection = (storyId: string): unknown => ({
  story_id: storyId,
  title: 'Un sujet',
  airtime_sec: 120,
  angle: 'angle',
  why_it_matters: 'pourquoi',
  new_information: ['du neuf'],
  transition_hint: 'ensuite',
})

// A user whose only open story is backed by enough links to pass the link rule
// — which is exactly what made the incident possible: the count was green.
async function seedOpenStory(
  db: Db,
  // A good story reads exactly the same to this code path as an unusable one:
  // the tests below that seed quality material rely on that, because the whole
  // question is what happens when the pipeline CANNOT tell them apart.
  opts: { headline?: string; quality?: number; claim?: string } = {},
): Promise<{ userId: string; storyId: string }> {
  const headline = opts.headline ?? 'Facebook'
  const [user] = await db
    .insert(users)
    .values({ email: `t-${randomUUID()}@podcapp.test`, apiToken: randomUUID(), rssToken: randomUUID() })
    .returning()
  if (!user) throw new Error('seed: no user')
  const rows = await db
    .insert(sources)
    .values(
      Array.from({ length: MIN_SOURCES_PER_EPISODE }, (_, i) => ({
        userId: user.id,
        type: 'web',
        url: `https://facebook.com/share/r/${i}/`,
        sourceHash: randomUUID(),
        title: headline,
        cleanText: headline,
        extractionQuality: opts.quality ?? 0.2,
        status: 'ready',
      })),
    )
    .returning({ id: sources.id })
  const [story] = await db
    .insert(stories)
    .values({
      userId: user.id,
      headline,
      topic: 'other',
      sourceIds: rows.map((r) => r.id),
      claims: [
        {
          text: opts.claim ?? 'Une page de partage Facebook.',
          type: 'fact',
          evidence_quote: headline,
          confidence: opts.quality ?? 0.2,
        },
      ],
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      status: 'open',
    })
    .returning({ id: stories.id })
  if (!story) throw new Error('seed: no story')
  return { userId: user.id, storyId: story.id }
}

test('an outline that keeps nothing discards the material, so the next morning cannot replay it', async () => {
  const { db, cleanup } = await createTestDb()
  const { userId, storyId } = await seedOpenStory(db)
  // The editor read the share wrappers and kept none of them.
  const restore = stubLlm(() => asDeepseek(outlineWith([], [{ story_id: storyId, reason: 'no article behind the link' }])))
  try {
    assert.equal(await countAvailableSources(db, userId), MIN_SOURCES_PER_EPISODE)

    // 1. The refusal is the sentence written for the user, not the internal
    //    one: episodes.error is displayed verbatim by the app.
    await assert.rejects(generateEpisode(db, { userId, targetSec: 300, language: 'en' }), (err: Error) => {
      assert.equal(err.message, unusableMaterialMessage('en'))
      assert.doesNotMatch(err.message, /no known story|story_id|outline/)
      return true
    })

    // 2. The editor's judgement is now persisted instead of thrown away.
    const [after] = await db.select({ status: stories.status }).from(stories).where(eq(stories.id, storyId))
    assert.equal(after?.status, 'discarded')

    // 3. Which is what closes the loop: the shared definition of "enough
    //    material" filters on 'open', so the count drops on its own and the
    //    app's Generate button greys out with no change to the counter.
    assert.equal(await countAvailableSources(db, userId), 0)
    assert.equal(hasEnoughSources(await countAvailableSources(db, userId)), false)

    // 4. Tomorrow's 06:00 run refuses on thin material instead of replaying
    //    the same failure forever.
    await assert.rejects(generateEpisode(db, { userId, targetSec: 300, language: 'en' }), (err: Error) => {
      assert.doesNotMatch(err.message, /no known story/)
      assert.match(err.message, /no open stories/)
      return true
    })
  } finally {
    restore()
    await cleanup()
  }
})

test('a story dropped while others are kept stays open: crowded out is not unusable', async () => {
  // The guard-rail on the fix. editorial.v2 exists because v1 invented quality
  // reasons for stories it merely had no room for (2026-09-04); marking those
  // discarded would destroy material permanently. Only ZERO sections means the
  // editor judged the material itself, so only zero sections may mark.
  const { db, cleanup } = await createTestDb()
  const { userId, storyId } = await seedOpenStory(db)
  const restore = stubLlm((call) =>
    call.url.includes('deepseek')
      ? asDeepseek(outlineWith([outlineSection(storyId)], [{ story_id: randomUUID(), reason: 'no airtime left' }]))
      : // The run is stopped at the writer: what matters is that it got PAST
        // the zero-section branch with a section in hand.
        new Error('stub: the writer is not part of this test'),
  )
  try {
    await assert.rejects(generateEpisode(db, { userId, targetSec: 300, language: 'en' }), /stub: the writer/)
    const [after] = await db.select({ status: stories.status }).from(stories).where(eq(stories.id, storyId))
    assert.equal(after?.status, 'open')
    assert.equal(await countAvailableSources(db, userId), MIN_SOURCES_PER_EPISODE)
  } finally {
    restore()
    await cleanup()
  }
})

// --- The other way to reach zero sections ------------------------------------
// `sections` is the FILTERED list, so it also hits zero when the model answers
// with story_ids that are not ours (OutlineSchema types story_id as a bare
// string: nothing checks membership). That is our bug, not a verdict on the
// user's material, and it is self-healing — the next sample probably returns
// real ids. Marking there would destroy good stories permanently, with no
// in-app undo, so the guard reads the UNFILTERED count.

test('an outline that selects unknown ids leaves the material open: an id mismatch is our bug, not a verdict', async () => {
  const { db, cleanup } = await createTestDb()
  // Quality material the editor WANTED to air — it returned a section for it.
  const { userId, storyId } = await seedOpenStory(db, {
    headline: 'La BCE relève ses taux',
    quality: 0.86,
    claim: 'La BCE a relevé son taux directeur de 25 points de base.',
  })
  // Same story, hallucinated id: the section is real, the identifier is not.
  const restore = stubLlm(() => asDeepseek(outlineWith([outlineSection(randomUUID())], [])))
  try {
    await assert.rejects(generateEpisode(db, { userId, targetSec: 300, language: 'en' }), (err: Error) => {
      // Loud and technical: this must page us, not accuse the user's links.
      assert.match(err.message, /no known story/)
      assert.notEqual(err.message, unusableMaterialMessage('en'))
      return true
    })

    // The story the editor picked is still there for tomorrow's run.
    const [after] = await db.select({ status: stories.status }).from(stories).where(eq(stories.id, storyId))
    assert.equal(after?.status, 'open')
    assert.equal(await countAvailableSources(db, userId), MIN_SOURCES_PER_EPISODE)
  } finally {
    restore()
    await cleanup()
  }
})

test('an outline that puts everything over budget leaves the material open: no airtime is not unusable', async () => {
  // editorial.v2 (rule: "keep the most useful") makes a zero-selection from
  // arithmetic impossible in principle — but v2 exists BECAUSE v1 mishandled
  // the budget case, and a model can violate a prompt. The reason string it is
  // told to write is the signal, so we read it and refuse to mark.
  const { db, cleanup } = await createTestDb()
  const { userId, storyId } = await seedOpenStory(db, { headline: 'Un vrai sujet', quality: 0.8 })
  const restore = stubLlm(() =>
    asDeepseek(outlineWith([], [{ story_id: storyId, reason: 'over budget: 240 seconds for 5 stories' }])),
  )
  try {
    await assert.rejects(generateEpisode(db, { userId, targetSec: 300, language: 'en' }), (err: Error) => {
      assert.notEqual(err.message, unusableMaterialMessage('en'))
      return true
    })
    const [after] = await db.select({ status: stories.status }).from(stories).where(eq(stories.id, storyId))
    assert.equal(after?.status, 'open')
    assert.equal(await countAvailableSources(db, userId), MIN_SOURCES_PER_EPISODE)
  } finally {
    restore()
    await cleanup()
  }
})

test('a hand-picked run never rewrites an aired story: only rows still open are marked', async () => {
  // A hand-picked run selects by SOURCE id whatever the status, so `open` here
  // holds aired stories too. Marking one 'discarded' would rewrite the record
  // of what was broadcast. Deleting the status filter in generateEpisode makes
  // this test — and only this test — fail.
  const { db, cleanup } = await createTestDb()
  const [user] = await db
    .insert(users)
    .values({ email: `t-${randomUUID()}@podcapp.test`, apiToken: randomUUID(), rssToken: randomUUID() })
    .returning()
  if (!user) throw new Error('seed: no user')
  const insertSources = async (n: number): Promise<string[]> => {
    const rows = await db
      .insert(sources)
      .values(
        Array.from({ length: n }, () => ({
          userId: user.id,
          type: 'web',
          url: `https://example.test/${randomUUID()}`,
          sourceHash: randomUUID(),
          title: 'Un article',
          cleanText: 'Un article',
          extractionQuality: 0.8,
          status: 'ready',
        })),
      )
      .returning({ id: sources.id })
    return rows.map((r) => r.id)
  }
  const insertStory = async (sourceIds: string[], status: string): Promise<string> => {
    const [story] = await db
      .insert(stories)
      .values({
        userId: user.id,
        headline: `Sujet ${status}`,
        topic: 'other',
        sourceIds,
        claims: [{ text: 'Un fait.', type: 'fact', evidence_quote: 'Un article', confidence: 0.8 }],
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        status,
      })
      .returning({ id: stories.id })
    if (!story) throw new Error('seed: no story')
    return story.id
  }
  const airedSources = await insertSources(2)
  const openSources = await insertSources(MIN_SOURCES_PER_EPISODE)
  const airedId = await insertStory(airedSources, 'aired')
  const openId = await insertStory(openSources, 'open')
  // The editor kept nothing at all: the marking branch, on a mixed pile.
  const restore = stubLlm(() => asDeepseek(outlineWith([], [{ story_id: openId, reason: 'no article behind the link' }])))
  try {
    await assert.rejects(
      generateEpisode(db, {
        userId: user.id,
        targetSec: 300,
        language: 'en',
        sourceIds: [...airedSources, ...openSources],
      }),
      (err: Error) => {
        assert.equal(err.message, unusableMaterialMessage('en'))
        return true
      },
    )
    const [aired] = await db.select({ status: stories.status }).from(stories).where(eq(stories.id, airedId))
    assert.equal(aired?.status, 'aired')
    const [openAfter] = await db.select({ status: stories.status }).from(stories).where(eq(stories.id, openId))
    assert.equal(openAfter?.status, 'discarded')
  } finally {
    restore()
    await cleanup()
  }
})
