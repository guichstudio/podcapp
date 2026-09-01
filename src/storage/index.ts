import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertSafeKey } from './key.js'
import { R2Storage } from './r2.js'

// Audio and run artifacts behind three methods. R2 when the bucket is
// configured, otherwise the local filesystem, so the whole pipeline still runs
// with zero credentials. Nothing outside this file knows which one it got.
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  /// Idempotent: a key that is already gone is a success.
  delete(key: string): Promise<void>
  publicUrl(key: string): string
}

const DEFAULT_ROOT = '.data/storage'
const DEFAULT_BASE_URL = 'http://localhost:8787'

class LocalStorage implements Storage {
  constructor(
    private root: string,
    private baseUrl: string,
  ) {}

  // contentType is ignored: the filesystem carries no object metadata. It stays
  // in the signature because R2 needs it at write time.
  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    assertSafeKey(key)
    const path = join(this.root, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key)
    try {
      return await readFile(join(this.root, key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    try {
      await unlink(join(this.root, key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  publicUrl(key: string): string {
    assertSafeKey(key)
    return `${this.baseUrl}/media/${key}`
  }
}

// R2 is used only when every part of its configuration is present: a half
// configured bucket must not silently fall back to writing episodes on a laptop
// that nothing will ever serve them from.
export function createStorage(opts: { root?: string; baseUrl?: string; forceLocal?: boolean } = {}): Storage {
  const baseUrl = opts.baseUrl ?? process.env.PUBLIC_BASE_URL ?? DEFAULT_BASE_URL
  const r2 = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  }
  const configured = Object.entries(r2).filter(([, v]) => v)
  if (!opts.forceLocal && configured.length > 0) {
    if (configured.length !== Object.keys(r2).length) {
      const missing = Object.entries(r2).filter(([, v]) => !v).map(([k]) => k.replace(/([A-Z])/g, '_$1').toUpperCase())
      throw new Error(`R2 is partially configured: missing ${missing.join(', ')}`)
    }
    return new R2Storage(r2 as { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl: string })
  }
  return new LocalStorage(opts.root ?? DEFAULT_ROOT, baseUrl.replace(/\/+$/, ''))
}

// Run artifacts exist to be read by a human when a script goes wrong, so they
// are stored indented rather than compact.
export async function putJson(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.put(key, Buffer.from(JSON.stringify(value, null, 2), 'utf8'), 'application/json')
}
