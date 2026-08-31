// The debug trail of ARCHITECTURE section 9 as one static page: what aired, what
// it was built from, and what the accuracy gate measured. Published next to the
// audio on the bucket, so it needs no server and opens on a phone.

export interface ConsoleChapter {
  title: string
  text: string
  sources: { title: string; url: string | null }[]
}

export interface ConsoleEpisode {
  id: string
  title: string
  audioUrl: string
  durationSec: number
  publishedAt: Date
  chapters: ConsoleChapter[]
  metrics: {
    words: number
    sentencesChecked: number
    unsupportedFound: number
    unsupportedShipped: number
    editsRejected: number
    usd: number
  } | null
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function duration(totalSec: number): string {
  return `${Math.floor(totalSec / 60)} min ${String(totalSec % 60).padStart(2, '0')}`
}

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function frenchDate(date: Date): string {
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function chapterHtml(chapter: ConsoleChapter): string {
  const sources = chapter.sources
    .map((s) =>
      s.url
        ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(s.title)}</a>`
        : `<span>${escapeHtml(s.title)}</span>`,
    )
    .join('')
  return `<details class="ch">
<summary><span class="ch-t">${escapeHtml(chapter.title)}</span></summary>
<p>${escapeHtml(chapter.text)}</p>
${sources ? `<div class="srcs">${sources}</div>` : ''}
</details>`
}

// unsupported_shipped is the promise itself (no unverified factual sentence
// reached the audio), so it leads and is coloured as a verdict.
function metricsHtml(m: NonNullable<ConsoleEpisode['metrics']>): string {
  const plural = m.unsupportedShipped > 1 ? 's' : ''
  return `<div class="mx">
<div class="m ${m.unsupportedShipped === 0 ? 'ok' : 'bad'}"><b>${m.unsupportedShipped}</b><span>non sourcée${plural} diffusée${plural}</span></div>
<div class="m"><b>${m.sentencesChecked}</b><span>phrases vérifiées</span></div>
<div class="m"><b>${m.unsupportedFound}</b><span>corrigées ou coupées</span></div>
<div class="m"><b>${m.editsRejected}</b><span>éditions rejetées</span></div>
<div class="m"><b>${m.words}</b><span>mots</span></div>
<div class="m"><b>${m.usd.toFixed(2)} $</b><span>coût</span></div>
</div>`
}

function episodeHtml(ep: ConsoleEpisode): string {
  return `<article class="ep">
<h2>${escapeHtml(ep.title)}</h2>
<div class="meta">${frenchDate(ep.publishedAt)} · ${duration(ep.durationSec)} · ${ep.chapters.length} chapitres</div>
<audio controls preload="none" src="${escapeHtml(ep.audioUrl)}"></audio>
${ep.metrics ? metricsHtml(ep.metrics) : ''}
${ep.chapters.map(chapterHtml).join('\n')}
</article>`
}

export function buildConsole(input: { episodes: ConsoleEpisode[]; feedUrl: string; manifestUrl: string }): string {
  const body = input.episodes.length
    ? input.episodes.map(episodeHtml).join('\n')
    : '<p class="empty">Aucun épisode publié pour le moment.</p>'
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Briefing</title>
<link rel="manifest" href="${escapeHtml(input.manifestUrl)}">
<meta name="theme-color" content="#0d0d0f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Briefing">
<style>
*{box-sizing:border-box}
body{margin:0 auto;padding:24px 20px 64px;background:#0d0d0f;color:#e9e9ec;max-width:44rem;
font:16px/1.6 ui-sans-serif,-apple-system,system-ui,sans-serif;-webkit-text-size-adjust:100%}
header{padding:8px 0 24px;border-bottom:1px solid #24242a;margin-bottom:28px}
h1{margin:0;font-size:1.5rem;letter-spacing:-.02em}
.sub{color:#8a8a94;font-size:.85rem;margin-top:6px}
.sub a{color:#8a8a94}
.ep{padding-bottom:36px;margin-bottom:36px;border-bottom:1px solid #24242a}
.ep:last-child{border-bottom:0;margin-bottom:0}
h2{margin:0 0 4px;font-size:1.2rem;letter-spacing:-.01em}
.meta{color:#8a8a94;font-size:.85rem;margin-bottom:16px}
audio{width:100%;margin-bottom:20px}
.mx{display:grid;grid-template-columns:repeat(auto-fit,minmax(6.5rem,1fr));gap:8px;margin-bottom:24px}
.m{background:#16161a;border:1px solid #24242a;border-radius:10px;padding:10px 12px}
.m b{display:block;font-size:1.15rem;font-variant-numeric:tabular-nums}
.m span{display:block;color:#8a8a94;font-size:.72rem;line-height:1.3;margin-top:3px}
.m.ok b{color:#4ade80}
.m.bad b{color:#f87171}
.ch{border-top:1px solid #1c1c22;padding:12px 0}
.ch summary{cursor:pointer;list-style:none;display:flex;gap:8px}
.ch summary::-webkit-details-marker{display:none}
.ch summary::before{content:'+';color:#6c6c78;width:1ch;flex:none}
.ch[open] summary::before{content:'−'}
.ch-t{font-weight:500}
.ch p{margin:12px 0 0;padding-left:calc(1ch + 8px);color:#c9c9d1;white-space:pre-wrap}
.srcs{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;padding-left:calc(1ch + 8px)}
.srcs a,.srcs span{font-size:.75rem;background:#16161a;border:1px solid #24242a;border-radius:999px;
padding:3px 10px;color:#9a9aa4;text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srcs a:active{color:#e9e9ec}
.empty{color:#8a8a94}
</style>
</head>
<body>
<header>
<h1>Briefing</h1>
<div class="sub">Console de test · <a href="${escapeHtml(input.feedUrl)}">flux RSS</a></div>
</header>
${body}
</body>
</html>`
}

export function buildManifest(startUrl: string): string {
  return JSON.stringify(
    {
      name: 'Briefing',
      short_name: 'Briefing',
      description: 'Console de test du briefing audio personnel',
      start_url: startUrl,
      display: 'standalone',
      background_color: '#0d0d0f',
      theme_color: '#0d0d0f',
      lang: 'fr',
    },
    null,
    2,
  )
}
