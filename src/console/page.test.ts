import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildConsole, buildManifest, escapeHtml, type ConsoleEpisode } from './page.js'

const episode = (over: Partial<ConsoleEpisode> = {}): ConsoleEpisode => ({
  id: 'ep-1',
  title: 'Briefing',
  audioUrl: 'https://cdn.example/a.mp3',
  durationSec: 845,
  publishedAt: new Date('2026-08-29T18:00:00Z'),
  chapters: [{ title: 'Intro', text: 'Bonjour.', sources: [] }],
  metrics: null,
  ...over,
})

test('escapes hostile text in titles, prose and source labels', () => {
  const html = buildConsole({
    episodes: [
      episode({
        title: 'A & B <script>alert(1)</script>',
        chapters: [
          {
            title: "L'ONU & <b>",
            text: '5 > 3 & "cited"',
            sources: [{ title: '<img src=x onerror=alert(1)>', url: 'https://e.test/?a=1&b=2' }],
          },
        ],
      }),
    ],
    feedUrl: 'https://cdn.example/f.xml?a=1&b=2',
    manifestUrl: 'https://cdn.example/m.webmanifest',
  })
  assert.ok(!html.includes('<script>alert(1)</script>'), 'a script tag must never survive')
  assert.ok(!html.includes('<img src=x'), 'an image handler must never survive')
  assert.ok(html.includes('A &amp; B &lt;script&gt;'))
  assert.ok(html.includes('5 &gt; 3 &amp; &quot;cited&quot;'))
  assert.ok(html.includes('href="https://e.test/?a=1&amp;b=2"'))
})

test('renders the French date, duration and chapter count', () => {
  const html = buildConsole({ episodes: [episode()], feedUrl: 'f', manifestUrl: 'm' })
  assert.ok(html.includes('samedi 29 août 2026'), '2026-08-29 is a Saturday')
  assert.ok(html.includes('14 min 05'))
  assert.ok(html.includes('1 chapitres'))
})

test('the accuracy verdict is green at zero and red above it', () => {
  const metrics = { words: 10, sentencesChecked: 4, unsupportedFound: 1, unsupportedShipped: 0, editsRejected: 0, usd: 0.43 }
  const clean = buildConsole({ episodes: [episode({ metrics })], feedUrl: 'f', manifestUrl: 'm' })
  assert.ok(clean.includes('class="m ok"'))
  const dirty = buildConsole({
    episodes: [episode({ metrics: { ...metrics, unsupportedShipped: 2 } })],
    feedUrl: 'f',
    manifestUrl: 'm',
  })
  assert.ok(dirty.includes('class="m bad"'))
  assert.ok(dirty.includes('non sourcées diffusées'), 'the label agrees in number')
})

test('an episode with no metrics shows no panel rather than zeros', () => {
  const html = buildConsole({ episodes: [episode({ metrics: null })], feedUrl: 'f', manifestUrl: 'm' })
  assert.ok(!html.includes('phrases vérifiées'))
})

test('an empty catalogue says so instead of rendering an empty shell', () => {
  const html = buildConsole({ episodes: [], feedUrl: 'f', manifestUrl: 'm' })
  assert.ok(html.includes('Aucun épisode'))
})

test('the manifest is valid JSON pointing at the console', () => {
  const m = JSON.parse(buildManifest('https://cdn.example/c.html')) as Record<string, string>
  assert.equal(m.start_url, 'https://cdn.example/c.html')
  assert.equal(m.display, 'standalone')
})

test('escapeHtml covers every dangerous character', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
})
