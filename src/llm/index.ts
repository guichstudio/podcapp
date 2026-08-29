import type { z } from 'zod'
import { MODELS, PRICING, type Stage } from '../config.js'
import { logger } from '../log.js'
import { anthropic } from './anthropic.js'
import { deepseek } from './deepseek.js'
import type { ChatProvider } from './provider.js'

export { embed } from './embeddings.js'

const providers: Record<string, ChatProvider> = { deepseek, anthropic }

export interface StageCost {
  in: number
  out: number
  usd: number
}

export type CostLedger = Partial<Record<Stage | 'embed', StageCost>>

export function addCost(ledger: CostLedger, stage: Stage | 'embed', model: string, inTok: number, outTok: number): void {
  const price = PRICING[model] ?? { in: 0, out: 0 }
  const entry = (ledger[stage] ??= { in: 0, out: 0, usd: 0 })
  entry.in += inTok
  entry.out += outTok
  entry.usd += (inTok * price.in + outTok * price.out) / 1_000_000
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) return fenced[1].trim()
  const start = text.search(/[[{]/)
  if (start >= 0) return text.slice(start).trim()
  return text.trim()
}

// Single entry point for every structured LLM call: routes per MODELS, forces
// JSON, zod-validates, retries once with the validation error, records cost.
export async function callStructured<T>(
  stage: Stage,
  schema: z.ZodType<T>,
  input: { system: string; user: string; maxTokens?: number },
  ledger?: CostLedger,
): Promise<T> {
  const { provider: providerName, model } = MODELS[stage]
  const provider = providers[providerName]
  if (!provider) throw new Error(`No chat provider for stage ${stage} (${providerName})`)

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = attempt === 0 ? input.user : `${input.user}\n\nYour previous output failed validation: ${lastError}\nReturn ONLY corrected JSON.`
    const started = Date.now()
    const res = await provider.chat({
      model,
      system: input.system,
      user,
      jsonMode: true,
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    })
    if (ledger) addCost(ledger, stage, model, res.inputTokens, res.outputTokens)
    logger.info(
      { stage, model, ms: Date.now() - started, in: res.inputTokens, out: res.outputTokens, attempt },
      'llm call',
    )
    try {
      const parsed: unknown = JSON.parse(extractJson(res.text))
      const result = schema.safeParse(parsed)
      if (result.success) return result.data
      lastError = result.error.message.slice(0, 500)
    } catch (e) {
      lastError = `invalid JSON: ${String(e).slice(0, 200)}`
    }
  }
  throw new Error(`callStructured(${stage}) failed validation after retry: ${lastError}`)
}
