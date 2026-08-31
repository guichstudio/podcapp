import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalizeUrl, sourceHash } from './canonical.js'

test('strips tracking params, the fragment, www and host case', () => {
  assert.equal(
    canonicalizeUrl('https://WWW.Example.com/actu/article-42?utm_source=newsletter&id=42&utm_campaign=x&fbclid=abc#lire-la-suite'),
    'https://example.com/actu/article-42?id=42',
  )
  assert.equal(
    canonicalizeUrl('https://www.lemonde.fr/economie/titre_123.html?gclid=1&mc_cid=2&mc_eid=3'),
    'https://lemonde.fr/economie/titre_123.html',
  )
  // www. is only stripped as a leading label, never inside the host.
  assert.equal(canonicalizeUrl('https://news.example.com/a'), 'https://news.example.com/a')
})

test('keeps meaningful query params', () => {
  assert.equal(
    canonicalizeUrl('https://example.com/p?ref=twitter&reference=y&s=1&search=chat&si=3&page=2'),
    'https://example.com/p?reference=y&search=chat&page=2',
  )
  assert.equal(
    canonicalizeUrl('https://example.com/article?q=chat%20noir&sort=new'),
    'https://example.com/article?q=chat%20noir&sort=new',
  )
})

test('removes a trailing slash', () => {
  assert.equal(canonicalizeUrl('https://example.com/path/'), 'https://example.com/path')
  assert.equal(canonicalizeUrl('http://EXAMPLE.com:8080/a/b/'), 'http://example.com:8080/a/b')
  assert.equal(canonicalizeUrl('https://example.com/'), 'https://example.com')
  assert.equal(canonicalizeUrl('https://example.com'), 'https://example.com')
})

test('is idempotent: canonicalizing twice changes nothing', () => {
  const urls = [
    'https://WWW.Example.com/actu/?utm_source=x#top',
    'https://example.com/p?page=2',
    'https://example.com/',
    'http://example.com:8080/a/b/',
  ]
  for (const url of urls) {
    const once = canonicalizeUrl(url)
    assert.equal(canonicalizeUrl(once), once, `not idempotent for ${url}`)
  }
})

test('throws on a url that cannot be parsed', () => {
  // processSource relies on this failing loudly: a silently mangled canonical url
  // would poison the dedupe key for that source forever.
  assert.throws(() => canonicalizeUrl('pas une url'), TypeError)
  assert.throws(() => canonicalizeUrl(''), TypeError)
})

test('sourceHash is a stable sha256 of the url plus the text head', () => {
  const hash = sourceHash('https://example.com/a', 'Le texte extrait.')
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hash, sourceHash('https://example.com/a', 'Le texte extrait.'))
})

test('sourceHash differs when the text or the url differs', () => {
  const url = 'https://example.com/a'
  assert.notEqual(sourceHash(url, 'Le texte extrait.'), sourceHash(url, 'Un autre texte.'))
  assert.notEqual(sourceHash(url, 'Le texte.'), sourceHash('https://example.com/b', 'Le texte.'))
  // A text-only source (no url) must not collide with an empty-url one being a
  // different thing: null is hashed as the empty string, by design.
  assert.equal(sourceHash(null, 'Le texte.'), sourceHash('', 'Le texte.'))
  assert.notEqual(sourceHash(null, 'Le texte.'), sourceHash(url, 'Le texte.'))
})

test('sourceHash only covers the first 2000 characters of the text', () => {
  // Deliberate: the dedupe key is the head of the extraction, so a page whose
  // footer changes between two captures still hashes to the same source.
  const head = 'a'.repeat(2000)
  assert.equal(sourceHash('https://example.com/a', `${head}FIN`), sourceHash('https://example.com/a', `${head}AUTRE`))
  assert.notEqual(sourceHash('https://example.com/a', `${'a'.repeat(1999)}X`), sourceHash('https://example.com/a', `${'a'.repeat(1999)}Y`))
})
