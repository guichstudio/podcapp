import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Cache for deterministic-enough LLM stage outputs, keyed by everything that
// could change the result. Re-running eval only pays for what changed.
export interface StageCache {
  get(key: string): unknown | null
  set(key: string, value: unknown): void
}

export function cacheKey(parts: Record<string, string>): string {
  const h = createHash('sha256')
  for (const [k, v] of Object.entries(parts)) h.update(k).update('=').update(v).update(';')
  return h.digest('hex').slice(0, 32)
}

export class FileStageCache implements StageCache {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true })
  }
  get(key: string): unknown | null {
    const p = join(this.dir, `${key}.json`)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as unknown
  }
  set(key: string, value: unknown): void {
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value))
  }
}
