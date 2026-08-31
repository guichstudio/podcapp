import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assemble, mp3DurationSec } from './assemble.js'

// Fixtures are built from the MPEG-1 Layer III spec rather than from the tables
// in assemble.ts, so a wrong table there cannot make these tests pass.
const L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const SAMPLE_RATES = [44100, 48000, 32000]
const SAMPLES_PER_FRAME = 1152

function frameLength(bitrateKbps: number, sampleRate: number, padding: boolean): number {
  return Math.floor((144 * bitrateKbps * 1000) / sampleRate) + (padding ? 1 : 0)
}

function frame(bitrateKbps = 128, sampleRate = 44100, padding = false): Buffer {
  const bitrateIndex = L3_BITRATES.indexOf(bitrateKbps)
  const rateIndex = SAMPLE_RATES.indexOf(sampleRate)
  assert.ok(bitrateIndex > 0 && rateIndex >= 0, 'fixture asks for a bitrate or rate outside MPEG-1 Layer III')
  const buf = Buffer.alloc(frameLength(bitrateKbps, sampleRate, padding))
  buf[0] = 0xff
  buf[1] = 0xfb // 11 sync bits, version 11 (MPEG-1), layer 01 (Layer III), no CRC
  buf[2] = (bitrateIndex << 4) | (rateIndex << 2) | (padding ? 0x02 : 0)
  buf[3] = 0xc4 // mono, no emphasis
  return buf
}

function stream(frames: number, bitrateKbps = 128, sampleRate = 44100, padding = false): Buffer {
  return Buffer.concat(Array.from({ length: frames }, () => frame(bitrateKbps, sampleRate, padding)))
}

test('sums the playback time of every MPEG-1 Layer III frame', () => {
  const frames = 383 // 383 * 1152 / 44100 = 10.005 s
  const buf = stream(frames)
  assert.equal(buf.length, frames * 417, 'a 128 kbps 44.1 kHz frame is 417 bytes')
  assert.equal(mp3DurationSec(buf), 10)
  assert.equal(mp3DurationSec(stream(38)), Math.round((38 * SAMPLES_PER_FRAME) / 44100))
  assert.equal(mp3DurationSec(stream(38)), 1)
})

test('reads the sample rate and bitrate from each frame header', () => {
  // Same 10 seconds, different headers: 48 kHz frames are shorter in bytes and in time.
  assert.equal(mp3DurationSec(stream(417, 128, 48000)), 10)
  assert.equal(stream(417, 128, 48000).length, 417 * 384)
  // A 192 kbps frame carries the same 1152 samples but occupies more bytes, so a
  // walker reading the bitrate wrongly would lose alignment and drop frames.
  assert.equal(mp3DurationSec(stream(383, 192)), 10)
  assert.equal(stream(383, 192).length, 383 * 626)
})

test('measures a stream of padded frames', () => {
  // Real 44.1 kHz encoders alternate padded frames (418 bytes) with unpadded ones.
  const buf = stream(383, 128, 44100, true)
  assert.equal(buf.length, 383 * 418)
  assert.equal(mp3DurationSec(buf), 10)
})

test('skips junk before the first frame', () => {
  const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10)])
  assert.equal(mp3DurationSec(Buffer.concat([id3, stream(383)])), 10)
})

test('chapter durations add up when the streams are concatenated', () => {
  // assemble() compares the sum of the chapters against the assembled output, so
  // concatenation must not lose or invent frames.
  const a = stream(383)
  const b = stream(191)
  const total = mp3DurationSec(Buffer.concat([a, b]))
  assert.equal(total, 15)
  assert.ok(Math.abs(total - (mp3DurationSec(a) + mp3DurationSec(b))) <= 1)
})

test('returns 0 when no valid frame is present', () => {
  assert.equal(mp3DurationSec(Buffer.alloc(0)), 0)
  assert.equal(mp3DurationSec(Buffer.from('ceci n est pas un fichier audio')), 0)
  assert.equal(mp3DurationSec(Buffer.alloc(4096)), 0)
  // Sync word present but the frame is unusable: free-format bitrate (index 0).
  assert.equal(mp3DurationSec(Buffer.concat(Array.from({ length: 50 }, () => Buffer.from([0xff, 0xfb, 0x00, 0xc4])))), 0)
  // Sync word present but MPEG-2 (version bits 10), which this walker does not measure.
  assert.equal(mp3DurationSec(Buffer.concat(Array.from({ length: 50 }, () => Buffer.from([0xff, 0xf3, 0x90, 0xc4])))), 0)
})

test('assemble refuses an episode with no chapters', () => {
  // Loud failure over an empty mp3: the caller must see why nothing was produced.
  assert.throws(() => assemble([]), /no chapters/)
})
