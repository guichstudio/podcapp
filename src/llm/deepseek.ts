import { env } from '../config.js'
import type { ChatProvider, ChatRequest, ChatResponse } from './provider.js'

// OpenAI-compatible API. Stable prompt content must come first in the request
// (system, then few-shots) so DeepSeek context caching bills repeats at hit rate.
export const deepseek: ChatProvider = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('DEEPSEEK_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
        ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        // v4 models are hybrid reasoners: left enabled, long sources can burn the
        // whole token budget in reasoning_content and return an empty content.
        thinking: { type: req.thinking ? 'enabled' : 'disabled' },
      }),
    })
    if (!res.ok) throw new Error(`deepseek ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as {
      choices: { message: { content: string } }[]
      usage: { prompt_tokens: number; completion_tokens: number }
    }
    const text = data.choices[0]?.message.content
    if (!text) throw new Error('deepseek: empty completion')
    return { text, inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
  },
}
