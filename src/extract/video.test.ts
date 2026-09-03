import assert from 'node:assert/strict'
import test from 'node:test'
import { isVideoUrl, vttToText } from './video.js'

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
