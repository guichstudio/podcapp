import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Db } from '../db/client.js'
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
