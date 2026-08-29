import { EMBEDDING_DIMS, MODELS, env } from '../config.js'

export interface EmbeddingResult {
  embedding: number[]
  tokens: number
}

async function embedOpenai(text: string): Promise<EmbeddingResult> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODELS.embed.model, input: text, dimensions: EMBEDDING_DIMS }),
  })
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { data: { embedding: number[] }[]; usage: { prompt_tokens: number } }
  const embedding = data.data[0]?.embedding
  if (!embedding) throw new Error('openai embeddings: empty result')
  return { embedding, tokens: data.usage.prompt_tokens }
}

async function embedJina(text: string): Promise<EmbeddingResult> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('JINA_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELS.embed.model,
      task: 'text-matching',
      dimensions: EMBEDDING_DIMS,
      input: [text],
    }),
  })
  if (!res.ok) throw new Error(`jina embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { data: { embedding: number[] }[]; usage?: { total_tokens?: number } }
  const embedding = data.data[0]?.embedding
  if (!embedding) throw new Error('jina embeddings: empty result')
  if (embedding.length !== EMBEDDING_DIMS) {
    throw new Error(`jina embeddings: got ${embedding.length} dims, expected ${EMBEDDING_DIMS}`)
  }
  return { embedding, tokens: data.usage?.total_tokens ?? 0 }
}

export async function embed(text: string): Promise<EmbeddingResult> {
  const input = text.slice(0, 30_000)
  return MODELS.embed.provider === 'jina' ? embedJina(input) : embedOpenai(input)
}
