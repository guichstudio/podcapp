import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoreExtraction } from './quality.js'

const SENTENCE = 'la banque centrale a maintenu son taux directeur inchange lors de sa reunion de mars.'

// A padded index keeps every generated line the same width, so two fixtures can
// be compared while differing in one dimension only (links, or line uniqueness).
const proseLine = (i: number) => `Paragraphe ${String(i).padStart(2, '0')} : ${SENTENCE}`
const linkLine = (i: number) =>
  `[Article numero ${String(i).padStart(2, '0')}](https://example.com/rubrique/${i}-titre-complet-de-larticle)`
const joinLines = (n: number, line: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => line(i)).join('\n')

test('short text scores low', () => {
  assert.equal(scoreExtraction('Article reserve aux abonnes.'), 0.1)
  assert.equal(scoreExtraction('a'.repeat(199)), 0.1)
  assert.equal(scoreExtraction(''), 0.1)
  assert.equal(scoreExtraction('   \n\n   '), 0.1)
  // Whitespace is trimmed before the length test, so padding cannot lift a stub.
  assert.equal(scoreExtraction(`${' '.repeat(500)}Article reserve aux abonnes.${' '.repeat(500)}`), 0.1)
})

test('a rich article scores high', () => {
  const article = joinLines(60, proseLine)
  assert.ok(article.length > 2500, 'fixture must exceed the length ceiling')
  assert.ok(scoreExtraction(article) >= 0.9, `expected a high score, got ${scoreExtraction(article)}`)
})

test('a link farm scores lower than prose of the same length', () => {
  const farm = joinLines(40, linkLine)
  const prose = joinLines(60, proseLine).slice(0, farm.length)
  assert.equal(prose.length, farm.length, 'both fixtures must have the same length')
  assert.ok(
    scoreExtraction(farm) < scoreExtraction(prose) - 0.2,
    `link farm ${scoreExtraction(farm)} should be well below prose ${scoreExtraction(prose)}`,
  )
})

test('bare urls count as links too, not only markdown links', () => {
  const bare = joinLines(40, (i) => `https://example.com/rubrique/${String(i).padStart(2, '0')}-titre-complet-article`)
  const prose = joinLines(60, proseLine).slice(0, bare.length)
  assert.ok(scoreExtraction(bare) < scoreExtraction(prose) - 0.2)
})

test('repeated boilerplate lines lower the score', () => {
  const unique = joinLines(40, proseLine)
  const repeated = joinLines(40, () => proseLine(0))
  assert.equal(repeated.length, unique.length, 'both fixtures must have the same length')
  assert.ok(
    scoreExtraction(repeated) < scoreExtraction(unique) - 0.2,
    `repeated ${scoreExtraction(repeated)} should be well below unique ${scoreExtraction(unique)}`,
  )
})

test('the score always lands in 0..1', () => {
  const inputs: [string, string][] = [
    ['empty', ''],
    ['whitespace', '   \n\n  '],
    ['exactly at the length floor', 'a'.repeat(200)],
    ['very long single line', SENTENCE.repeat(500)],
    ['only urls', joinLines(200, (i) => `https://example.com/very/long/path/segment/${i}`)],
    ['link farm', joinLines(40, linkLine)],
    ['one repeated line', joinLines(40, () => proseLine(0))],
    ['rich article', joinLines(60, proseLine)],
  ]
  for (const [label, text] of inputs) {
    const score = scoreExtraction(text)
    assert.ok(score >= 0 && score <= 1, `${label}: ${score} out of range`)
  }
})
