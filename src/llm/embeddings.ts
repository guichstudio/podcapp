import { MODELS, env } from '../config.js'

export interface EmbeddingResult {
  embedding: number[]
  tokens: number
}

export async function embed(text: string): Promise<EmbeddingResult> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODELS.embed.model, input: text.slice(0, 30_000) }),
  })
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as {
    data: { embedding: number[] }[]
    usage: { prompt_tokens: number }
  }
  const embedding = data.data[0]?.embedding
  if (!embedding) throw new Error('openai embeddings: empty result')
  return { embedding, tokens: data.usage.prompt_tokens }
}
