import { env } from '../config.js'
import type { ChatProvider, ChatRequest, ChatResponse } from './provider.js'

export const anthropic: ChatProvider = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        max_tokens: req.maxTokens ?? 4096,
        // temperature is deprecated on claude-sonnet-5: only sent when a caller
        // explicitly asks for one, so older models keep working.
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as {
      content: { type: string; text?: string }[]
      usage: { input_tokens: number; output_tokens: number }
    }
    const text = data.content.find((b) => b.type === 'text')?.text
    if (!text) throw new Error('anthropic: empty completion')
    return { text, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
  },
}
