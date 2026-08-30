import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../log.js'

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const MPEG1_RATES = [44100, 48000, 32000, 0]

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
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

export interface AssembleResult {
  audio: Buffer
  durationSec: number
  method: 'ffmpeg' | 'concat'
}

// ffmpeg path follows ARCHITECTURE §5.9: 300 ms between chapters, loudnorm to
// broadcast level. Without ffmpeg the frames are concatenated directly, which
// plays correctly but leaves loudness untouched and cuts tight between chapters.
export function assemble(chapters: Buffer[]): AssembleResult {
  if (chapters.length === 0) throw new Error('assemble: no chapters')

  if (hasFfmpeg()) {
    const dir = mkdtempSync(join(tmpdir(), 'podcapp-'))
    const silence = join(dir, 'silence.mp3')
    execFileSync('ffmpeg', [
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '0.3', '-b:a', '128k', '-y', silence,
    ], { stdio: 'ignore' })

    const parts: string[] = []
    chapters.forEach((audio, i) => {
      const p = join(dir, `chapter-${i}.mp3`)
      writeFileSync(p, audio)
      if (i > 0) parts.push(silence)
      parts.push(p)
    })
    const listPath = join(dir, 'list.txt')
    writeFileSync(listPath, parts.map((p) => `file '${p}'`).join('\n'))
    const outPath = join(dir, 'episode.mp3')
    execFileSync('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-b:a', '128k', '-y', outPath,
    ], { stdio: 'ignore' })
    const audio = readFileSync(outPath)
    if (!existsSync(outPath)) throw new Error('assemble: ffmpeg produced no output')
    return { audio, durationSec: mp3DurationSec(audio), method: 'ffmpeg' }
  }

  logger.warn('ffmpeg not found: concatenating MP3 frames without loudnorm or inter-chapter silence')
  const audio = Buffer.concat(chapters.map((c, i) => (i === 0 ? c : stripId3(c))))
  return { audio, durationSec: mp3DurationSec(audio), method: 'concat' }
}
