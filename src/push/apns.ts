import { createSign } from 'node:crypto'
import { connect, constants } from 'node:http2'
import { logger } from '../log.js'

// Apple's token-based APNs, spoken directly over HTTP/2. No SDK: the protocol
// is one POST per device, the signature is an ES256 JWT, and Node has both. A
// library here would be three dependencies for forty lines.
//
// The key is the .p8 downloaded once from the developer portal. It is a
// credential: it is read from the environment, never logged, and never travels
// in an error message -- see how failures are reported below.

const HOSTS = {
  production: 'https://api.push.apple.com',
  development: 'https://api.sandbox.push.apple.com',
} as const

export type ApnsEnvironment = keyof typeof HOSTS

export interface ApnsConfig {
  keyId: string
  teamId: string
  key: string
  topic: string
}

/// Absent when the build has no key, which is the normal state until someone
/// downloads one: everything downstream then skips silently rather than
/// failing an episode over a notification.
export function apnsConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const key = process.env.APNS_KEY
  const topic = process.env.APNS_TOPIC
  if (!keyId || !teamId || !key || !topic) return null
  return { keyId, teamId, key: decodeKey(key), topic }
}

/// The .p8 in whatever shape it survived being pasted.
///
/// A dashboard field turns newlines into SPACES -- measured on 2026-09-04, when
/// a 44-line cookie jar arrived as one line of the same byte count -- and a PEM
/// without its line breaks is not a PEM: the crypto layer fails with a message
/// about an unsupported format, which points nowhere near the paste that caused
/// it. So base64 of the whole file is the documented way in, a raw PEM still
/// works from a .env, and a PEM whose newlines became literal \n is repaired.
export function decodeKey(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes('BEGIN')) {
    return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
    if (decoded.includes('BEGIN')) return decoded
  } catch {
    // falls through to the raw value, which will fail loudly at signing time
  }
  return trimmed
}

/// Apple refuses a token younger than 20 minutes on refresh and older than 60,
/// so one is minted per hour and reused. Cached on the module: a worker process
/// handles several runs, and a fresh token per notification is what gets an
/// account rate-limited (TooManyProviderTokenUpdates).
let cached: { token: string; madeAt: number } | null = null

function providerToken(config: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000)
  if (cached && now - cached.madeAt < 45 * 60) return cached.token
  const header = { alg: 'ES256', kid: config.keyId }
  const payload = { iss: config.teamId, iat: now }
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const body = `${part(header)}.${part(payload)}`
  // ieee-p1363, not DER: JOSE wants the raw r|s pair, and Node's default
  // encoding would produce a signature Apple rejects as malformed.
  const signature = createSign('SHA256')
    .update(body)
    .sign({ key: config.key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url')
  cached = { token: `${body}.${signature}`, madeAt: now }
  return cached.token
}

export interface ApnsResult {
  token: string
  status: number
  /// True when Apple says this token will never work again, which is the only
  /// reliable moment to learn that a device is gone: the app was deleted, or
  /// restored onto another phone. The caller deletes the row.
  gone: boolean
  reason?: string | undefined
}

/// One alert to one device, whatever it announces. `data` rides next to `aps`
/// as top-level keys: the app reads `episode_id` to open a briefing and
/// `support` to open the chat.
export interface ApnsMessage {
  token: string
  environment: ApnsEnvironment
  title: string
  body: string
  data?: Record<string, string>
  /// The same id twice is one notification on the phone, not two.
  collapseId?: string
  /// Groups notifications in Notification Centre.
  threadId?: string
}

export function apnsPayload(message: ApnsMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: 'default',
      ...(message.threadId ? { 'thread-id': message.threadId } : {}),
    },
    ...message.data,
  })
}

/// Returns rather than throws: a notification that fails must never fail the
/// episode or the message that triggered it.
export async function sendApns(config: ApnsConfig, message: ApnsMessage): Promise<ApnsResult> {
  const client = connect(HOSTS[message.environment])
  try {
    return await new Promise<ApnsResult>((resolve) => {
      const req = client.request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${message.token}`,
        authorization: `bearer ${providerToken(config)}`,
        'apns-topic': config.topic,
        'apns-push-type': 'alert',
        ...(message.collapseId ? { 'apns-collapse-id': message.collapseId.slice(0, 64) } : {}),
        'content-type': 'application/json',
      })
      let status = 0
      let raw = ''
      req.on('response', (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0)
      })
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => {
        raw += chunk
      })
      req.on('end', () => {
        const reason = raw ? (JSON.parse(raw) as { reason?: string }).reason : undefined
        resolve({ token: message.token, status, gone: status === 410 || reason === 'BadDeviceToken', reason })
      })
      req.on('error', (err) => {
        // The message, never the config: an HTTP/2 error can quote the request
        // it failed on, and the authorization header is in it.
        resolve({ token: message.token, status: 0, gone: false, reason: err.name })
      })
      req.end(apnsPayload(message))
    })
  } finally {
    client.close()
  }
}

export function logApns(results: ApnsResult[]): void {
  const sent = results.filter((r) => r.status === 200).length
  const gone = results.filter((r) => r.gone).length
  const failed = results.filter((r) => r.status !== 200 && !r.gone)
  logger.info(
    { sent, gone, failed: failed.length, reasons: [...new Set(failed.map((f) => f.reason))] },
    'apns notifications sent',
  )
}
