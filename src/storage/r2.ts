import { AwsClient } from 'aws4fetch'
import type { Storage } from './index.js'
import { assertSafeKey, encodeKey } from './key.js'

// Cloudflare R2 through its S3-compatible API. aws4fetch signs the requests
// (SigV4) without pulling in the AWS SDK, which would be an order of magnitude
// larger for the three verbs this interface needs.
export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
}

export class R2Storage implements Storage {
  private client: AwsClient
  private endpoint: string
  private publicBaseUrl: string

  constructor(config: R2Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // R2 ignores the region but SigV4 requires one in the signature.
      service: 's3',
      region: 'auto',
    })
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`
    this.publicBaseUrl = config.publicBaseUrl.replace(/\/+$/, '')
  }

  private url(key: string): string {
    assertSafeKey(key)
    return `${this.endpoint}/${encodeKey(key)}`
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': contentType, 'Content-Length': String(body.length) },
    })
    if (!res.ok) {
      throw new Error(`r2 put ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.client.fetch(this.url(key), { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`r2 get ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), { method: 'DELETE' })
    // S3 answers 204 for a delete, and 404 only for a bucket that does not
    // exist: a missing object is a 204 too. Both mean "not there anymore".
    if (res.status === 204 || res.status === 404) return
    if (!res.ok) {
      throw new Error(`r2 delete ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
    }
  }

  publicUrl(key: string): string {
    assertSafeKey(key)
    return `${this.publicBaseUrl}/${encodeKey(key)}`
  }
}
