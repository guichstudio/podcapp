import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { logger } from '../log.js'

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const MPEG1_RATES = [44100, 48000, 32000, 0]

// ffmpeg-static ships a prebuilt binary with the package, so no system install
// (and no Homebrew) is needed. A system ffmpeg on PATH still wins if present.
function findFfmpeg(): string | null {
  // ffmpeg-static's default export is the binary path at runtime, but its types
  // describe the module namespace under NodeNext resolution.
  const bundled = ffmpegStatic as unknown as string | null
  for (const candidate of [bundled, 'ffmpeg']) {
    if (!candidate) continue
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' })
      return candidate
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

// ID3v2 sits before the first frame; concatenating it mid-stream confuses players.
function stripId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.subarray(0, 3).toString() !== 'ID3') return buf
  const size =
    ((buf[6] ?? 0) << 21) | ((buf[7] ?? 0) << 14) | ((buf[8] ?? 0) << 7) | (buf[9] ?? 0)
  return buf.subarray(10 + size)
}

// Walks MPEG frame headers to sum real playback time: no ffprobe needed and it
// double-checks that the concatenated stream is well-formed.
export function mp3DurationSec(buf: Buffer): number {
  let offset = 0
  let seconds = 0
  let frames = 0
  while (offset + 4 <= buf.length) {
    const b0 = buf[offset] ?? 0
    const b1 = buf[offset + 1] ?? 0
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
      offset++
      continue
    }
    const b2 = buf[offset + 2] ?? 0
    const versionBits = (b1 >> 3) & 0x03
    const bitrate = MPEG1_L3_BITRATES[(b2 >> 4) & 0x0f] ?? 0
    const sampleRate = MPEG1_RATES[(b2 >> 2) & 0x03] ?? 0
    if (versionBits !== 3 || bitrate === 0 || sampleRate === 0) {
      offset++
      continue
    }
    const padding = (b2 >> 1) & 0x01
    const frameLength = Math.floor((144 * bitrate * 1000) / sampleRate) + padding
    if (frameLength <= 0) {
      offset++
      continue
    }
    seconds += 1152 / sampleRate
    frames++
    offset += frameLength
  }
  return frames > 0 ? Math.round(seconds) : 0
}

function probeFormat(ffmpeg: string, path: string): { sampleRate: number; layout: string } {
  let output = ''
  try {
    execFileSync(ffmpeg, ['-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    // ffmpeg exits non-zero when given no output file; the stream info is on stderr.
    output = String((e as { stderr?: Buffer }).stderr ?? '')
  }
  const stream = output.match(/Audio: mp3, (\d+) Hz, (mono|stereo)/)
  return {
    sampleRate: Number(stream?.[1] ?? 44100),
    layout: stream?.[2] ?? 'mono',
  }
}

export interface AssembleResult {
  audio: Buffer
  durationSec: number
  method: 'ffmpeg' | 'concat'
}

// An episode that quietly loses a chapter is worse than one that fails loudly:
// ffmpeg's concat demuxer drops audio without an error when streams mismatch.
function assertNoAudioLost(chapters: Buffer[], durationSec: number): void {
  const expected = chapters.reduce((n, c) => n + mp3DurationSec(c), 0)
  if (durationSec < expected - 2) {
    throw new Error(
      `assemble: output is ${durationSec}s but chapters total ${expected}s: ${expected - durationSec}s of audio was dropped`,
    )
  }
}

// ffmpeg path follows ARCHITECTURE §5.9: 300 ms between chapters, loudnorm to
// broadcast level. Without ffmpeg the frames are concatenated directly, which
// plays correctly but leaves loudness untouched and cuts tight between chapters.
export function assemble(chapters: Buffer[]): AssembleResult {
  if (chapters.length === 0) throw new Error('assemble: no chapters')

  const ffmpeg = findFfmpeg()
  if (ffmpeg) {
    const dir = mkdtempSync(join(tmpdir(), 'podcapp-'))
    try {
      const parts: string[] = []
      const chapterPaths = chapters.map((audio, i) => {
        const p = join(dir, `chapter-${i}.mp3`)
        writeFileSync(p, audio)
        return p
      })

      // The concat demuxer silently drops audio when streams differ, so the silence
      // must match the chapters' own sample rate and channel layout.
      const format = probeFormat(ffmpeg, chapterPaths[0] as string)
      const silence = join(dir, 'silence.mp3')
      execFileSync(ffmpeg, [
        '-f', 'lavfi', '-i', `anullsrc=r=${format.sampleRate}:cl=${format.layout}`,
        '-t', '0.3', '-b:a', '128k', '-y', silence,
      ], { stdio: 'ignore' })

      chapterPaths.forEach((p, i) => {
        if (i > 0) parts.push(silence)
        parts.push(p)
      })
      const listPath = join(dir, 'list.txt')
      writeFileSync(listPath, parts.map((p) => `file '${p}'`).join('\n'))
      const outPath = join(dir, 'episode.mp3')
      execFileSync(ffmpeg, [
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ar', '44100', '-b:a', '128k', '-y', outPath,
      ], { stdio: 'ignore' })
      if (!existsSync(outPath)) throw new Error('assemble: ffmpeg produced no output')
      const audio = readFileSync(outPath)
      const durationSec = mp3DurationSec(audio)
      assertNoAudioLost(chapters, durationSec)
      return { audio, durationSec, method: 'ffmpeg' }
    } finally {
      // Roughly twice the episode size per run, so it is removed on both paths.
      // Safe here: the audio is already in memory.
      rmSync(dir, { recursive: true, force: true })
    }
  }

  logger.warn('ffmpeg not found: concatenating MP3 frames without loudnorm or inter-chapter silence')
  const audio = Buffer.concat(chapters.map((c, i) => (i === 0 ? c : stripId3(c))))
  return { audio, durationSec: mp3DurationSec(audio), method: 'concat' }
}
