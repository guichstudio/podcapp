import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { accessHint, cookieJar, decodeJar, isVideoUrl, message, vttToText } from './video.js'

// Routing is the part that costs money when it is wrong: a link sent to the
// transcriber is billed by the minute, and a video sent to the page fetcher
// comes back as somebody's comment section.
test('the video hosts route to transcription', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://youtube.com/watch?v=abc&t=90',
    'https://m.youtube.com/watch?v=abc',
    'https://youtu.be/jNQXAC9IVRw',
    'https://www.youtube.com/shorts/abc123',
    'https://www.tiktok.com/@someone/video/123',
    'https://vimeo.com/123456',
    'https://www.dailymotion.com/video/x8abcd',
  ]) {
    assert.ok(isVideoUrl(url), `${url} should be treated as a video`)
  }
})

test('pages that merely mention video stay on the page path', () => {
  for (const url of [
    // A channel or a search is not one piece of speech.
    'https://www.youtube.com/@TED',
    'https://www.youtube.com/results?search_query=stress',
    // Instagram and X pages carry the caption, which is usually the content.
    'https://www.instagram.com/reel/DclvjbqCKy8/',
    'https://x.com/someone/status/123',
    // An article about a video is an article.
    'https://www.lemonde.fr/pixels/article/2026/01/youtube-video.html',
    'https://blog.example.com/why-youtube.com-changed',
  ]) {
    assert.ok(!isVideoUrl(url), `${url} should stay on the page path`)
  }
})

test('a malformed or non-http url never routes to a paid call', () => {
  for (const url of ['', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://youtube.com/watch?v=x']) {
    assert.ok(!isVideoUrl(url), `${url} should not be treated as a video`)
  }
})

// The conversion, not the network: a caption file is the free rung's whole
// output, and everything downstream reads what comes out of here.
test('WebVTT becomes prose', () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

1
00:00:01.000 --> 00:00:04.000
A few years ago, I broke into my own house.

2
00:00:04.000 --> 00:00:07.500
I had just driven home, it was around midnight.`
  assert.equal(
    vttToText(vtt),
    'A few years ago, I broke into my own house. I had just driven home, it was around midnight.',
  )
})

test('auto-caption scrolling repeats collapse, and karaoke tags go', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
this is a three

00:00:03.000 --> 00:00:05.000
this is a three

00:00:05.000 --> 00:00:07.000
<00:00:05.100><c>it's sloppily written</c>`
  assert.equal(vttToText(vtt), "this is a three it's sloppily written")
})

test('an empty or header-only track yields nothing rather than junk', () => {
  assert.equal(vttToText('WEBVTT\n\nKind: captions\nLanguage: en\n'), '')
  assert.equal(vttToText(''), '')
})

test('the cookie jar is absent unless one is configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcapp-jar-'))
  try {
    const before = process.env.YOUTUBE_COOKIES
    delete process.env.YOUTUBE_COOKIES
    assert.equal(await cookieJar(dir), null)
    // Whitespace is not a jar: an env var set to "" or a stray newline in a
    // dashboard field must not make yt-dlp read an empty file and fail oddly.
    process.env.YOUTUBE_COOKIES = '   \n '
    assert.equal(await cookieJar(dir), null)
    if (before === undefined) delete process.env.YOUTUBE_COOKIES
    else process.env.YOUTUBE_COOKIES = before
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a configured jar lands 0600 in the run directory, newline-terminated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcapp-jar-'))
  const before = process.env.YOUTUBE_COOKIES
  try {
    // yt-dlp rejects a Netscape jar whose last line has no newline.
    process.env.YOUTUBE_COOKIES = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx'
    const path = await cookieJar(dir)
    assert.ok(path)
    const body = await readFile(path, 'utf8')
    assert.ok(body.endsWith('\n'))
    assert.ok(body.includes('SID'))
    // A live credential must not be world-readable on a shared image.
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  } finally {
    if (before === undefined) delete process.env.YOUTUBE_COOKIES
    else process.env.YOUTUBE_COOKIES = before
    await rm(dir, { recursive: true, force: true })
  }
})

test('the bot wall says whose problem it is; other failures are left alone', () => {
  const wall = 'ERROR: [youtube] x: Sign in to confirm you are not a bot. Use --cookies'
  assert.match(accessHint(wall, false), /no YOUTUBE_COOKIES set/)
  assert.match(accessHint(wall, true), /expired|export it again/)
  // A reader-side failure must not be dressed up as our configuration problem.
  const private_ = 'ERROR: [youtube] x: Private video. Sign in if you have been granted access'
  assert.equal(accessHint(private_, false), private_)
})

// The failure text is not a log line: processSource writes it to sources.error,
// and GET /sources hands that column to the app. Everything below is about what
// must never reach that screen.
test('the jar never reaches the error text, by path or by content', () => {
  const err = new Error(
    [
      "Command failed: yt-dlp --no-warnings --no-playlist --cookies /tmp/podcapp-video-a1B2c3/cookies.txt --skip-download -J https://youtu.be/x",
      "WARNING: skipping cookie file entry due to invalid length 1: '.youtube.com TRUE / TRUE 0 __Secure-3PSID AbC-secret-value'",
      'ERROR: [youtube] x: Sign in to confirm you are not a bot. Use --cookies for the authentication',
      '',
    ].join('\n'),
  )
  const out = message(err)
  assert.ok(!out.includes('__Secure-3PSID'), `cookie name leaked: ${out}`)
  assert.ok(!out.includes('AbC-secret-value'), `cookie value leaked: ${out}`)
  assert.ok(!out.includes('cookies.txt'), `jar path leaked: ${out}`)
  assert.ok(!out.includes('Command failed'), `argv leaked: ${out}`)
  // and the reason itself survives, otherwise the row says nothing
  assert.match(out, /not a bot/)
})

test('a path yt-dlp quotes itself is redacted too', () => {
  const out = message(new Error("ERROR: unable to open '/var/folders/xk/T/podcapp-video-99/cookies.txt': no such file"))
  assert.ok(!out.includes('podcapp-video-99'), out)
  assert.match(out, /<jar>/)
})

test('a killed child still says something', () => {
  // execFile on timeout: the argv is the whole message and stderr is empty, so
  // dropping the argv must not leave an empty reason.
  assert.match(message(new Error('Command failed: yt-dlp --cookies /tmp/podcapp-video-a/cookies.txt https://youtu.be/x\n')), /killed|timed out/)
})

test('only the bot wall is blamed on the jar', () => {
  const wall = 'ERROR: [youtube] x: Sign in to confirm you are not a bot'
  assert.match(accessHint(wall, false), /no YOUTUBE_COOKIES set/)
  assert.match(accessHint(wall, true), /export it again/)
  // Everything the reader cannot fix by re-exporting a jar is left alone.
  for (const other of [
    'ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate',
    'ERROR: [youtube] x: Private video. Sign in if you have been granted access',
    'ERROR: [youtube] x: Join this channel to get access to members-only content',
    'ERROR: [youtube] x: Video unavailable. This video is not available in your country',
  ]) {
    assert.equal(accessHint(other, true), other, `wrongly blamed on the jar: ${other}`)
  }
})

const JAR = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue\n'

test('a raw jar passes through, a base64 one is decoded', () => {
  assert.equal(decodeJar(JAR), JAR.trim())
  assert.ok(decodeJar(JAR).includes('SID'))
  assert.equal(decodeJar(Buffer.from(JAR).toString('base64')), JAR.trim())
  // Whitespace around a pasted base64 blob is normal and must not break it.
  assert.equal(decodeJar(`  ${Buffer.from(JAR).toString('base64')}\n`), JAR.trim())
})

test('a jar whose newlines a web form ate fails loudly instead of sending nothing', () => {
  // Exactly what the Trigger.dev field produced: same bytes, newlines as spaces.
  const flattened = JAR.replace(/\n/g, ' ')
  assert.throws(() => decodeJar(flattened), /base64/)
  // and the same for a value that is neither a jar nor base64 of one
  assert.throws(() => decodeJar('some pasted nonsense'), /base64/)
})

test('a proxy password never survives into the error text', () => {
  const err = new Error(
    [
      'Command failed: yt-dlp --proxy http://user:s3cr3t@geo.iproyal.com:12321 --skip-download https://youtu.be/x',
      'ERROR: unable to connect to proxy http://user:s3cr3t@geo.iproyal.com:12321: timed out',
      '',
    ].join('\n'),
  )
  const out = message(err)
  assert.ok(!out.includes('s3cr3t'), `proxy password leaked: ${out}`)
  assert.ok(!out.includes('user:'), `proxy credentials leaked: ${out}`)
  // the diagnosis itself survives, otherwise the row says nothing useful
  assert.match(out, /unable to connect to proxy/)
  assert.match(out, /<proxy>/)
})
