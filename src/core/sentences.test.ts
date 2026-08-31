import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countWords, entityTokens, isCheckable, splitSentences } from './sentences.js'

test('splits on sentence-final punctuation, accents included', () => {
  assert.deepEqual(splitSentences("L'été fut chaud à Genève. Où irons-nous ? Nulle part !"), [
    "L'été fut chaud à Genève.",
    'Où irons-nous ?',
    'Nulle part !',
  ])
  assert.deepEqual(splitSentences('Il hésite… Puis il part.'), ['Il hésite…', 'Puis il part.'])
  assert.deepEqual(splitSentences('Premier paragraphe.\n\nDeuxième paragraphe.'), [
    'Premier paragraphe.',
    'Deuxième paragraphe.',
  ])
})

test('abbreviations do not end a sentence', () => {
  assert.deepEqual(splitSentences('Selon M. Dupont, le projet avance. Il ouvrira en mai.'), [
    'Selon M. Dupont, le projet avance.',
    'Il ouvrira en mai.',
  ])
  assert.deepEqual(splitSentences('Des pommes, des poires, etc. Le marché ferme à midi.'), [
    'Des pommes, des poires, etc. Le marché ferme à midi.',
  ])
  assert.deepEqual(splitSentences('It happened in the U.S. Then everything changed.'), [
    'It happened in the U.S. Then everything changed.',
  ])
})

test('numbers do not end a sentence only when a digit follows', () => {
  // A split point between two digits is a number cut in half, not a sentence end.
  assert.deepEqual(splitSentences('Le taux est de 1. 8 pour cent.'), ['Le taux est de 1. 8 pour cent.'])
  // But a sentence that simply ends on a number is a full sentence: the grounding
  // stage checks one sentence per verdict, so merging these two would hide one.
  assert.deepEqual(splitSentences('Le chiffre atteint 42. La suite arrive demain.'), [
    'Le chiffre atteint 42.',
    'La suite arrive demain.',
  ])
  assert.deepEqual(splitSentences("La société a levé 100 millions d'euros en 2024. Depuis, elle recrute."), [
    "La société a levé 100 millions d'euros en 2024.",
    'Depuis, elle recrute.',
  ])
  // Decimals and percentages carry no whitespace, so they never reach a split point.
  assert.deepEqual(splitSentences('Le CA atteint 1,8 milliard. La hausse est de 40 %.'), [
    'Le CA atteint 1,8 milliard.',
    'La hausse est de 40 %.',
  ])
})

test('returns nothing for empty input and never returns blanks', () => {
  assert.deepEqual(splitSentences(''), [])
  assert.deepEqual(splitSentences('   \n\n  '), [])
  assert.deepEqual(splitSentences('Une phrase sans ponctuation finale'), ['Une phrase sans ponctuation finale'])
  assert.deepEqual(splitSentences('  Une phrase espacée.   '), ['Une phrase espacée.'])
})

test('splitting keeps every word of the text', () => {
  const text =
    "La banque centrale a maintenu son taux. Selon M. Dupont, la décision était attendue.\nLe marché a réagi en 2024. Puis tout s'est calmé…"
  const sentences = splitSentences(text)
  assert.equal(
    sentences.reduce((n, s) => n + countWords(s), 0),
    countWords(text),
  )
})

test('isCheckable catches digits, quotes and percentages', () => {
  assert.equal(isCheckable("La société a levé 100 millions d'euros.", []), true)
  assert.equal(isCheckable('Il a déclaré « le marché a changé ».', []), true)
  assert.equal(isCheckable('Il a déclaré "le marché a changé".', []), true)
  assert.equal(isCheckable('Il a déclaré “le marché a changé”.', []), true)
  assert.equal(isCheckable('La hausse atteint plus de dix pour cent.', []), true)
  assert.equal(isCheckable('Une part de marché exprimée en %.', []), true)
})

test('isCheckable flags a name the evidence never mentions', () => {
  // The most dangerous shape there is: an attribution to an entity that appears
  // nowhere in the evidence. It has to reach the grounder, evidence or not.
  assert.equal(isCheckable('Selon Anthropic, la tendance accélère.', []), true)
  assert.equal(isCheckable('Anthropic annonce un nouveau modèle.', []), true)
  assert.equal(isCheckable('La BCE a relevé son taux directeur.', []), true)
  assert.equal(isCheckable("L'Europe accélère son calendrier.", []), true)
  assert.equal(isCheckable('Meta poursuit sa route.', ['Meta']), true)
})

test('isCheckable ignores ordinary sentence-initial capitalization', () => {
  assert.equal(isCheckable('Le ciel est bleu.', []), false)
  assert.equal(isCheckable('Le ciel est bleu.', ['Meta']), false)
  assert.equal(isCheckable('Il repart demain matin.', []), false)
  assert.equal(isCheckable('The sky stays clear.', []), false)
})

test('isCheckable still catches a known entity written in lowercase', () => {
  assert.equal(isCheckable('meta poursuit sa route.', ['META']), true)
  assert.equal(isCheckable('meta poursuit sa route.', []), false)
  // Entities of three characters or less are ignored on this path: substring
  // matching on "UE" or "BCE" would flag almost every sentence. A capitalized
  // acronym is caught by its shape instead.
  assert.equal(isCheckable('elle a relevé son taux directeur.', ['BCE']), false)
})

test('entityTokens keeps names and drops ordinary openers', () => {
  assert.deepEqual(entityTokens('Le marché a doublé. Selon Anthropic, la tendance accélère.'), ['Anthropic'])
  assert.deepEqual(entityTokens("Les États-Unis et l'Europe divergent."), ['États-Unis', 'Europe'])
  assert.deepEqual(entityTokens('Le ciel est bleu.'), [])
})

test('countWords counts whitespace-separated tokens', () => {
  assert.equal(countWords(''), 0)
  assert.equal(countWords('   \n\t '), 0)
  assert.equal(countWords('  un   deux \n trois\ttrois-et-demi  '), 4)
  assert.equal(countWords("L'été fut chaud"), 3)
})
