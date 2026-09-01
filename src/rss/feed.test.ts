import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFeed, escapeXml, itunesDuration, rfc2822, type FeedEpisode } from './feed.js'

function episode(over: Partial<FeedEpisode> = {}): FeedEpisode {
  return {
    id: 'ep-1',
    title: 'Briefing du 30 aout',
    description: 'Trois histoires.',
    audioUrl: 'https://cdn.example.com/episodes/ep-1.mp3',
    audioBytes: 13_542_912,
    durationSec: 843,
    publishedAt: new Date(Date.UTC(2026, 7, 30, 9, 12, 0)),
    ...over,
  }
}

test('rfc2822 formats a known date in UTC with English names', () => {
  // 2026-08-30 is a Sunday; the tables must not depend on the host locale.
  assert.equal(rfc2822(new Date(Date.UTC(2026, 7, 30, 9, 12, 0))), 'Sun, 30 Aug 2026 09:12:00 GMT')
  assert.equal(rfc2822(new Date(Date.UTC(2026, 0, 5, 23, 59, 59))), 'Mon, 05 Jan 2026 23:59:59 GMT')
})

test('escapeXml escapes the five XML metacharacters', () => {
  assert.equal(
    escapeXml(`Fusion & "rachat" <urgent> de l'IA`),
    'Fusion &amp; &quot;rachat&quot; &lt;urgent&gt; de l&#39;IA',
  )
})

test('a title with markup characters lands escaped in the feed', () => {
  const xml = buildFeed(feed({ episodes: [episode({ title: `A & B <b>"x"</b> l'an 1` })] }))
  assert.match(xml, /<title>A &amp; B &lt;b&gt;&quot;x&quot;&lt;\/b&gt; l&#39;an 1<\/title>/)
  assert.doesNotMatch(xml, /<title>A & B/)
})

test('itunesDuration always emits HH:MM:SS', () => {
  assert.equal(itunesDuration(0), '00:00:00')
  assert.equal(itunesDuration(42), '00:00:42')
  assert.equal(itunesDuration(59.6), '00:01:00')
  assert.equal(itunesDuration(843), '00:14:03')
  assert.equal(itunesDuration(3661), '01:01:01')
  assert.equal(itunesDuration(37_230), '10:20:30')
})

test('episodes are emitted newest first whatever the input order', () => {
  const xml = buildFeed(
    feed({
      episodes: [
        episode({ id: 'old', publishedAt: new Date(Date.UTC(2026, 7, 1)) }),
        episode({ id: 'new', publishedAt: new Date(Date.UTC(2026, 7, 30)) }),
        episode({ id: 'mid', publishedAt: new Date(Date.UTC(2026, 7, 15)) }),
      ],
    }),
  )
  const order = [...xml.matchAll(/<guid isPermaLink="false">([^<]+)<\/guid>/g)].map((m) => m[1])
  assert.deepEqual(order, ['new', 'mid', 'old'])
  // lastBuildDate follows the newest episode, not the clock.
  assert.match(xml, /<lastBuildDate>Sun, 30 Aug 2026 00:00:00 GMT<\/lastBuildDate>/)
})

test('the enclosure carries url, byte length and mime type', () => {
  const xml = buildFeed(feed({ episodes: [episode({ audioBytes: 13_542_912 })] }))
  assert.match(
    xml,
    /<enclosure url="https:\/\/cdn\.example\.com\/episodes\/ep-1\.mp3" length="13542912" type="audio\/mpeg"\/>/,
  )
})

test('an episode without a byte length fails the publish instead of shipping mute audio', () => {
  assert.throws(
    () => buildFeed(feed({ episodes: [episode({ audioBytes: 0 })] })),
    /unusable audio length/,
  )
})

test('the channel carries every tag Apple Podcasts requires', () => {
  const xml = buildFeed(feed({ imageUrl: 'https://cdn.example.com/cover.jpg' }))
  for (const expected of [
    '<?xml version="1.0" encoding="UTF-8"?>',
    'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"',
    'xmlns:atom="http://www.w3.org/2005/Atom"',
    '<link>https://podcapp.example.com</link>',
    '<atom:link href="https://podcapp.example.com/rss/tok.xml" rel="self" type="application/rss+xml"/>',
    '<language>fr</language>',
    '<itunes:author>Louis</itunes:author>',
    '<itunes:explicit>false</itunes:explicit>',
    '<itunes:category text="News"/>',
    '<itunes:image href="https://cdn.example.com/cover.jpg"/>',
    '<itunes:episodeType>full</itunes:episodeType>',
    '</channel>',
    '</rss>',
  ]) {
    assert.ok(xml.includes(expected), `missing from the feed: ${expected}`)
  }
  // The bucket is public: nothing in the feed may identify the account.
  assert.ok(!xml.includes('itunes:owner'), 'the owner block must not be published')
  assert.ok(!xml.includes('@'.concat('example.com')), 'no email address in the public feed')
})

test('a "]]>" inside a description does not break out of its CDATA section', () => {
  const xml = buildFeed(feed({ episodes: [episode({ description: 'evil ]]> break' })] }))
  assert.ok(xml.includes('<![CDATA[evil ]]]]><![CDATA[> break]]>'))
  // Every opened section is closed: an early close would leave the counts uneven.
  assert.equal(xml.split('<![CDATA[').length, xml.split(']]>').length)
})

test('imageUrl is omitted when absent', () => {
  assert.doesNotMatch(buildFeed(feed()), /itunes:image/)
})

test('the channel link is the public site, never the secret feed URL', () => {
  const xml = buildFeed(feed())
  assert.match(xml, /<link>https:\/\/podcapp\.example\.com<\/link>/)
  // The token URL belongs to atom:link rel=self only: clients display <link>.
  assert.doesNotMatch(xml, /<link>[^<]*\/rss\/tok\.xml<\/link>/)
})

test('control characters are stripped so the feed stays parseable', () => {
  const xml = buildFeed(
    feed({
      title: 'Briefing\u0007',
      episodes: [episode({ title: 'Titre\u0000 avec\u001f controle', description: 'desc\u000b ici' })],
    }),
  )
  assert.match(xml, /<title>Titre avec controle<\/title>/)
  assert.ok(xml.includes('<![CDATA[desc ici]]>'))
  // No real XML parser ships with Node, so well-formedness is checked against the
  // characters XML 1.0 forbids: one of them makes every client reject the feed.
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
})

test('escapeXml keeps tab, newline and carriage return, which XML allows', () => {
  assert.equal(escapeXml('a\tb\nc\rd'), 'a\tb\nc\rd')
})

function feed(over: Partial<Parameters<typeof buildFeed>[0]> = {}) {
  return {
    title: 'Briefing',
    description: 'Le briefing quotidien.',
    author: 'Louis',
    language: 'fr',
    link: 'https://podcapp.example.com',
    selfUrl: 'https://podcapp.example.com/rss/tok.xml',
    episodes: [episode()],
    ...over,
  }
}
