import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createStorage, putJson } from './index.js'

const root = await mkdtemp(join(tmpdir(), 'podcapp-storage-'))
const storage = createStorage({ root, baseUrl: 'http://localhost:8787' })

after(async () => {
  await rm(root, { recursive: true, force: true })
})

test('put then get round trips a nested key', async () => {
  const key = 'episodes/11111111-1111-1111-1111-111111111111/episode.mp3'
  await storage.put(key, Buffer.from('audio bytes'), 'audio/mpeg')
  const got = await storage.get(key)
  assert.equal(got?.toString(), 'audio bytes')
})

test('putJson round trips a run artifact', async () => {
  const key = 'episodes/11111111-1111-1111-1111-111111111111/run/outline.json'
  await putJson(storage, key, { chapters: [{ title: 'Intro' }] })
  const got = await storage.get(key)
  assert.deepEqual(JSON.parse(got?.toString() ?? 'null'), { chapters: [{ title: 'Intro' }] })
})

test('get returns null for a missing key', async () => {
  assert.equal(await storage.get('episodes/nope/episode.mp3'), null)
})

test('traversal keys throw on every method', async () => {
  for (const key of ['../secrets.txt', 'episodes/../../etc/passwd', '/etc/passwd', '']) {
    await assert.rejects(() => storage.put(key, Buffer.from('x'), 'text/plain'))
    await assert.rejects(() => storage.get(key))
    assert.throws(() => storage.publicUrl(key))
  }
})

test('publicUrl uses the media prefix and drops a trailing slash on the base', () => {
  assert.equal(
    storage.publicUrl('episodes/abc/episode.mp3'),
    'http://localhost:8787/media/episodes/abc/episode.mp3',
  )
  const trailing = createStorage({ root, baseUrl: 'https://cdn.example.com/' })
  assert.equal(
    trailing.publicUrl('episodes/abc/episode.mp3'),
    'https://cdn.example.com/media/episodes/abc/episode.mp3',
  )
})

test('publicUrl falls back to PUBLIC_BASE_URL then localhost', () => {
  const previous = process.env.PUBLIC_BASE_URL
  try {
    process.env.PUBLIC_BASE_URL = 'https://podcast.example.com'
    assert.equal(createStorage({ root }).publicUrl('a.mp3'), 'https://podcast.example.com/media/a.mp3')
    delete process.env.PUBLIC_BASE_URL
    assert.equal(createStorage({ root }).publicUrl('a.mp3'), 'http://localhost:8787/media/a.mp3')
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = previous
  }
})
