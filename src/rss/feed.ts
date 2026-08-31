// Podcast RSS 2.0 + iTunes tags (ARCHITECTURE §5.10). Pure function: the jobs
// layer supplies the rows and writes the result, so a feed can be rebuilt and
// diffed without touching the DB or R2.

// Show artwork lives at one fixed object per accepted format, so the uploader
// (CLI), the media route and this feed all name the same key without having to
// pass it around. Apple accepts JPEG and PNG only, hence exactly these two.
export const COVER_KEYS = [
  { key: 'cover.jpg', contentType: 'image/jpeg' },
  { key: 'cover.png', contentType: 'image/png' },
] as const

export interface FeedEpisode {
  id: string
  title: string
  description: string
  audioUrl: string
  audioBytes: number
  durationSec: number
  publishedAt: Date
}

export interface FeedInput {
  title: string
  description: string
  author: string
  email: string
  language: string
  // The show's website, surfaced by clients. Kept apart from selfUrl so the
  // secret feed URL is never displayed as the podcast's public home.
  link: string
  selfUrl: string
  imageUrl?: string
  episodes: FeedEpisode[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// Feed dates must be RFC 2822 with English day/month names whatever the host
// locale is, so the names come from fixed tables rather than toLocaleString.
export function rfc2822(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('rss: invalid date')
  // getUTCDay is 0..6 and getUTCMonth 0..11, so both lookups are always in range.
  const day = DAYS[date.getUTCDay()] as string
  const month = MONTHS[date.getUTCMonth()] as string
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  return `${day}, ${pad2(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ${time} GMT`
}

// Apple expects HH:MM:SS; some clients mis-read the bare-seconds form on long
// episodes, so hours are always emitted even for a 40 second trailer.
export function itunesDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) {
    throw new Error(`rss: invalid duration ${totalSec}`)
  }
  const s = Math.round(totalSec)
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`
}

// XML 1.0 has no representation for these control characters, not even inside
// CDATA: one of them in an LLM-written title would make the whole feed
// unparseable for every client. They carry no meaning in text, so they go.
const XML_FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function stripControls(value: string): string {
  return value.replace(XML_FORBIDDEN_CONTROLS, '')
}

// The apostrophe uses a numeric reference: &apos; is legal XML but undefined in
// the HTML entity tables some feed consumers parse with.
export function escapeXml(value: string): string {
  return stripControls(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Descriptions carry source links as HTML, which CDATA keeps readable to the
// clients that render it. A literal "]]>" inside would close the section early,
// so it is split across two sections that reassemble into the same text.
function cdata(text: string): string {
  return `<![CDATA[${stripControls(text).split(']]>').join(']]]]><![CDATA[>')}]]>`
}

// An episode with no byte length downloads as 0 bytes in Apple Podcasts instead
// of erroring, so a bad length fails the whole publish rather than shipping mute.
function enclosureLength(episode: FeedEpisode): number {
  const bytes = episode.audioBytes
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(`rss: episode ${episode.id} has an unusable audio length (${bytes} bytes)`)
  }
  return bytes
}

export function buildFeed(input: FeedInput): string {
  // Podcast clients read the feed top-down and expect the latest episode first.
  const episodes = [...input.episodes].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  )

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(input.title)}</title>`,
    `    <description>${cdata(input.description)}</description>`,
    `    <link>${escapeXml(input.link)}</link>`,
    `    <language>${escapeXml(input.language)}</language>`,
    `    <atom:link href="${escapeXml(input.selfUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <itunes:author>${escapeXml(input.author)}</itunes:author>`,
    '    <itunes:explicit>false</itunes:explicit>',
    '    <itunes:category text="News"/>',
    '    <itunes:owner>',
    `      <itunes:name>${escapeXml(input.author)}</itunes:name>`,
    `      <itunes:email>${escapeXml(input.email)}</itunes:email>`,
    '    </itunes:owner>',
  ]

  if (input.imageUrl) lines.push(`    <itunes:image href="${escapeXml(input.imageUrl)}"/>`)

  // Taken from the newest episode, not the clock: the same input must always
  // produce the same bytes, otherwise every republish looks like a change.
  const newest = episodes[0]
  if (newest) lines.push(`    <lastBuildDate>${rfc2822(newest.publishedAt)}</lastBuildDate>`)

  for (const ep of episodes) {
    lines.push(
      '    <item>',
      `      <title>${escapeXml(ep.title)}</title>`,
      `      <description>${cdata(ep.description)}</description>`,
      `      <guid isPermaLink="false">${escapeXml(ep.id)}</guid>`,
      `      <pubDate>${rfc2822(ep.publishedAt)}</pubDate>`,
      `      <enclosure url="${escapeXml(ep.audioUrl)}" length="${enclosureLength(ep)}" type="audio/mpeg"/>`,
      `      <itunes:duration>${itunesDuration(ep.durationSec)}</itunes:duration>`,
      '      <itunes:episodeType>full</itunes:episodeType>',
      '    </item>',
    )
  }

  lines.push('  </channel>', '</rss>', '')
  return lines.join('\n')
}
