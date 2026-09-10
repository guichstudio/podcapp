import { importPKCS8, SignJWT } from 'jose'

// L'App Store Server API, parlee directement. Pas de SDK : c'est un GET signe
// par un JWT ES256, et jose fait les deux.
//
// jose et NON node:crypto, contrairement a src/push/apns.ts : ce fichier est
// importe par api/index.ts, qui declare `runtime: 'edge'`. createSign n'y
// existe pas.
//
// L'ANCRE DE CONFIANCE EST TLS, comme pour le JWKS d'Apple dans auth/verify.ts.
// Le JWS que presente l'app n'est jamais verifie : on n'en lit que
// l'originalTransactionId, et l'etat vient de la reponse d'Apple.

const HOSTS = {
  Production: 'https://api.storekit.itunes.apple.com',
  Sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
} as const

export type AppleEnvironment = keyof typeof HOSTS

export interface AppleSubscription {
  originalTransactionId: string
  productId: string
  bundleId: string
  expiresDate: Date
  appAccountToken: string | null
  environment: AppleEnvironment
}

const decodeSegment = (segment: string): Record<string, unknown> | null => {
  try {
    const json = atob(segment.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/// Le SEUL champ qu'on accepte de lire dans un JWS non verifie. Tout le reste
/// de la charge utile est ignore : un ping falsifie ne peut donc provoquer
/// qu'un appel HTTP vers Apple, jamais un changement d'etat.
///
/// Filtre en chiffres uniquement : cette valeur part dans un chemin d'URL.
export function readOriginalTransactionId(jws: string): string | null {
  const parts = jws.split('.')
  if (parts.length !== 3) return null
  const payload = decodeSegment(parts[1]!)
  const id = payload?.originalTransactionId
  if (typeof id !== 'string' || !/^[0-9]{1,32}$/.test(id)) return null
  return id
}

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

/// Le .p8 dans la forme ou il a survecu au copier-coller. Meme lecon que
/// decodeKey() de push/apns.ts : un champ de tableau de bord transforme les
/// sauts de ligne en espaces, et un PEM sans ses sauts de ligne n'est pas un
/// PEM. Le base64 du fichier entier est la voie documentee. Reimplemente ici
/// (plutot que partage) parce que ce fichier tourne sur l'edge : pas de
/// Buffer, atob a la place.
export function decodePem(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes('BEGIN')) {
    return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed
  }
  try {
    const decoded = atob(trimmed)
    if (decoded.includes('BEGIN')) return decoded
  } catch {
    // tombe sur la valeur brute, qui echouera bruyamment a la signature
  }
  return trimmed
}

async function providerToken(): Promise<string> {
  const keyId = env('APPLE_IAP_KEY_ID')
  const issuer = env('APPLE_IAP_ISSUER_ID')
  const bundleId = env('APPLE_IAP_BUNDLE_ID')
  const key = await importPKCS8(decodePem(env('APPLE_IAP_KEY')), 'ES256')
  return new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('30m') // Apple refuse au-dela de 60 min
    .setAudience('appstoreconnect-v1')
    .sign(key)
}

export function createAppStoreClient(fetchImpl: typeof fetch = fetch) {
  async function on(environment: AppleEnvironment, id: string, token: string): Promise<AppleSubscription | null> {
    const res = await fetchImpl(`${HOSTS[environment]}/inApps/v1/subscriptions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // 4040010 = transaction id not found. C'est la reponse normale quand on
    // interroge le mauvais environnement, et la procedure d'Apple est
    // d'essayer la production d'abord, puis le sandbox.
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`app store server api ${res.status}`)

    const body = (await res.json()) as { data?: { lastTransactions?: { signedTransactionInfo?: string }[] }[] }
    const signed = body.data?.[0]?.lastTransactions?.[0]?.signedTransactionInfo
    if (!signed) return null
    // Cette charge utile arrive PAR TLS depuis Apple, pas par le reseau public :
    // c'est la seule qu'on lit en entier.
    const info = decodeSegment(signed.split('.')[1] ?? '')
    if (!info) return null

    const expires = info.expiresDate
    const token_ = info.appAccountToken
    return {
      originalTransactionId: id,
      productId: String(info.productId ?? ''),
      bundleId: String(info.bundleId ?? ''),
      expiresDate: new Date(typeof expires === 'number' ? expires : 0),
      appAccountToken: typeof token_ === 'string' ? token_ : null,
      environment,
    }
  }

  return {
    /// Production d'abord, sandbox ensuite : c'est aussi ce qui renseigne
    /// plan_environment, et les deux espaces d'identifiants sont disjoints.
    async lookup(originalTransactionId: string): Promise<AppleSubscription | null> {
      const token = await providerToken()
      return (
        (await on('Production', originalTransactionId, token)) ??
        (await on('Sandbox', originalTransactionId, token))
      )
    },
  }
}
