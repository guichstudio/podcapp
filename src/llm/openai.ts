import { env } from '../config.js'
import type { ChatProvider, ChatRequest, ChatResponse } from './provider.js'

export const openai: ChatProvider = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_completion_tokens: req.maxTokens ?? 4096,
        ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as {
      choices: { message: { content: string } }[]
      usage: { prompt_tokens: number; completion_tokens: number }
    }
    const text = data.choices[0]?.message.content
    if (!text) throw new Error('openai: empty completion')
    return { text, inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
  },
}
