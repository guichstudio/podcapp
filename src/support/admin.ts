// The admin page's one credential: ADMIN_TOKEN, sent as a bearer.
//
// 'disabled' is its own answer, not 'denied': an unset variable must never
// read as "anyone may enter", and saying so plainly (503) beats a 401 that
// sends someone hunting for the right token when there is none.
//
// Compared in constant time without node:crypto, which the edge runtime does
// not have: every character is visited whatever the first mismatch.
export function checkAdmin(header: string | undefined, expected: string | undefined): 'ok' | 'disabled' | 'denied' {
  const secret = expected?.trim()
  if (!secret) return 'disabled'
  const match = header?.match(/^Bearer\s+(.+)$/i)
  if (!match) return 'denied'
  const given = match[1]!.trim()
  let diff = given.length ^ secret.length
  for (let i = 0; i < secret.length; i++) diff |= (given.charCodeAt(i) || 0) ^ secret.charCodeAt(i)
  return diff === 0 ? 'ok' : 'denied'
}
