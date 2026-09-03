import assert from 'node:assert/strict'
import test from 'node:test'
import { isVideoUrl } from './video.js'

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
