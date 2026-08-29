import { createHash } from 'node:crypto'

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$|s$|si$)/

export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw)
  u.hash = ''
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
  }
  let s = u.toString()
  if (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

export function sourceHash(canonicalUrl: string | null, cleanText: string): string {
  return createHash('sha256')
    .update(canonicalUrl ?? '')
    .update('||')
    .update(cleanText.slice(0, 2000))
    .digest('hex')
}
