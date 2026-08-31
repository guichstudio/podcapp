import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Audio and run artifacts behind three methods. Only the local driver exists:
// it runs the whole pipeline with zero credentials. The R2 driver (§2) plugs in
// here once the bucket exists, and nothing outside this file has to change.
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  publicUrl(key: string): string
}

const DEFAULT_ROOT = '.data/storage'
const DEFAULT_BASE_URL = 'http://localhost:8787'

// Keys are assembled from episode ids and fixed file names, so a key that could
// escape the root is an upstream bug: fail loudly instead of silently rewriting it.
function assertSafeKey(key: string): void {
  if (key.length === 0) throw new Error('Storage key must not be empty')
  if (key.startsWith('/')) throw new Error(`Storage key must be relative: ${key}`)
  if (key.includes('..')) throw new Error(`Storage key must not contain "..": ${key}`)
}

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

  publicUrl(key: string): string {
    assertSafeKey(key)
    return `${this.baseUrl}/media/${key}`
  }
}

export function createStorage(opts: { root?: string; baseUrl?: string } = {}): Storage {
  const baseUrl = opts.baseUrl ?? process.env.PUBLIC_BASE_URL ?? DEFAULT_BASE_URL
  return new LocalStorage(opts.root ?? DEFAULT_ROOT, baseUrl.replace(/\/+$/, ''))
}

// Run artifacts exist to be read by a human when a script goes wrong, so they
// are stored indented rather than compact.
export async function putJson(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.put(key, Buffer.from(JSON.stringify(value, null, 2), 'utf8'), 'application/json')
}
