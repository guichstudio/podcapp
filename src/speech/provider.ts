export interface SpeechChapter {
  title: string
  text: string
}

export interface SynthesizedChapter {
  title: string
  index: number
  audio: Buffer
  chars: number
}

export interface SpeechProvider {
  synthesize(chapters: SpeechChapter[], opts: { voiceId: string; modelId?: string }): Promise<SynthesizedChapter[]>
}
