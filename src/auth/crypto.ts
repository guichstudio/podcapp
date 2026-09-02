// WebCrypto only, never node:crypto: this module sits under src/auth/, which
// api/index.ts reaches directly, and that function runs on Vercel's Edge
// runtime. Edge exposes only a small allowlist of node builtins and `crypto`
// is not in it -- importing node:crypto anywhere in this graph fails the
// build for the whole API, not just the auth routes. `crypto` here is the
// WebCrypto global, which both Edge and Node 20+ provide with no import.
//
// Shared by identity.ts (account/session tokens) and session.ts (session
// tokens) and verify.ts (nonce hashing) so neither has to import node:crypto,
// or import each other just to reuse an encoder.

/// 32 random bytes, base64url-encoded (unpadded): the shape a bearer token
/// wants. Matches the length and alphabet of node:crypto's
/// `randomBytes(32).toString('base64url')`, which this replaces.
export function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/// SHA-256 of a UTF-8 string, hex-encoded. Async because SubtleCrypto is --
/// every caller here is already inside an async function, so it costs
/// nothing. Matches node:crypto's
/// `createHash('sha256').update(input).digest('hex')`, which this replaces.
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
