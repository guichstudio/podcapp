import { env } from '../config.js'
import { logger } from '../log.js'
import type { SpeechChapter, SpeechProvider, SynthesizedChapter } from './provider.js'

const API = 'https://api.elevenlabs.io/v1/text-to-speech'
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2'

// One request per chapter, carrying previous_text / next_text so prosody stays
// continuous across the cuts (request stitching). Per-chapter requests also make
// retries and partial regeneration cheap: a bad chapter is redone alone.
async function synthesizeChapter(
  chapter: SpeechChapter,
  index: number,
  previousText: string,
  nextText: string,
  opts: { voiceId: string; modelId?: string },
): Promise<SynthesizedChapter> {
  const body = {
    text: chapter.text,
    model_id: opts.modelId ?? DEFAULT_TTS_MODEL,
    // Stitching context is capped: the API rejects oversized neighbours.
    previous_text: previousText.slice(-600) || undefined,
    next_text: nextText.slice(0, 600) || undefined,
  }
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}/${opts.voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer())
      logger.info({ chapter: chapter.title, index, chars: chapter.text.length, bytes: audio.length }, 'chapter synthesized')
      return { title: chapter.title, index, audio, chars: chapter.text.length }
    }
    lastError = `${res.status}: ${(await res.text()).slice(0, 200)}`
    logger.warn({ chapter: chapter.title, attempt, error: lastError }, 'tts retry')
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  throw new Error(`elevenlabs tts failed for chapter "${chapter.title}": ${lastError}`)
}

export const elevenlabs: SpeechProvider = {
  async synthesize(chapters, opts) {
    const out: SynthesizedChapter[] = []
    for (const [index, chapter] of chapters.entries()) {
      out.push(
        await synthesizeChapter(
          chapter,
          index,
          chapters[index - 1]?.text ?? '',
          chapters[index + 1]?.text ?? '',
          opts,
        ),
      )
    }
    return out
  },
}
