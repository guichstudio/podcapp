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

/// Les valeurs de lastTransactions[].status, telles que documentees par Apple
/// ("status | App Store Server API", consulte le 2026-09-09). Nommees ici pour
/// que les appelants ecrivent `=== APPLE_SUBSCRIPTION_STATUS.revoked` et non
/// `=== 5` : `revoked` veut dire rembourse ou retire du partage familial, et
/// c'est le cas ou expiresDate ment (elle reste dans le futur).
export const APPLE_SUBSCRIPTION_STATUS = {
  active: 1,
  expired: 2,
  billingRetry: 3,
  gracePeriod: 4,
  revoked: 5,
} as const

const KNOWN_STATUSES: readonly number[] = Object.values(APPLE_SUBSCRIPTION_STATUS)

export interface AppleSubscription {
  originalTransactionId: string
  productId: string
  bundleId: string
  expiresDate: Date
  appAccountToken: string | null
  /// null quand Apple n'envoie rien, ou une valeur hors des cinq documentees :
  /// on n'invente pas un etat sur le chemin du paiement.
  status: number | null
  environment: AppleEnvironment
}

/// A-t-on le droit de servir cet abonnement ?
///
/// PAS `status === 1`, et PAS `expiresDate > now` : pendant une periode de
/// grace (4), et pendant une nouvelle tentative de paiement (3), Apple
/// considere l'abonne comme AYANT DROIT alors que son expiresDate est deja
/// DANS LE PASSE. Ecrire l'une ou l'autre de ces conditions coupe le service a
/// quelqu'un qui paie et dont le paiement vient d'echouer -- exactement la
/// personne qu'il ne faut pas braquer.
///
/// `null` veut dire "Apple n'a rien dit, ou a dit quelque chose qu'on ne
/// connait pas". Ce n'est pas un droit.
export function isEntitled(sub: AppleSubscription): boolean {
  return (
    sub.status === APPLE_SUBSCRIPTION_STATUS.active ||
    sub.status === APPLE_SUBSCRIPTION_STATUS.billingRetry ||
    sub.status === APPLE_SUBSCRIPTION_STATUS.gracePeriod
  )
}

const GRACE_LEASE_MS = 24 * 60 * 60 * 1000

/// La date a ecrire dans users.plan_expires_at pour un abonnement qui a droit.
///
/// planOf() lit le palier comme gratuit des que cette date est passee. Ecrire
/// l'expiresDate d'Apple telle quelle rendait donc la grace inutile : Apple dit
/// "a droit", la base dit "echu", et planOf tranche pour la base. Quand
/// l'echeance d'Apple est deja passee, on ecrit un bail d'un jour ; le filet
/// (POST /episodes et le cron) relit chez Apple des que le bail expire, et la
/// notification de renouvellement ou d'expiration le remplace avant.
export function entitledUntil(sub: AppleSubscription, now: Date = new Date()): Date {
  return sub.expiresDate.getTime() > now.getTime() ? sub.expiresDate : new Date(now.getTime() + GRACE_LEASE_MS)
}

/// 4040010 = TransactionIdNotFoundError, le SEUL des cinq 404 documentes de
/// cet endpoint qui veuille dire "cette transaction n'est pas dans cet
/// environnement". Les quatre autres (4040001/4040002 compte introuvable,
/// 4040003/4040004 app introuvable) sont des pannes ou des erreurs de
/// configuration : les lire comme "pas d'abonnement" degraderait en silence
/// tous les abonnes payants le jour ou APPLE_IAP_ISSUER_ID est faux.
const TRANSACTION_NOT_FOUND = 4040010

/// Le format d'un originalTransactionId chez Apple, et la seule forme qu'on
/// laisse entrer dans un chemin d'URL.
const TRANSACTION_ID = /^[0-9]{1,32}$/

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
  if (typeof id !== 'string' || !TRANSACTION_ID.test(id)) return null
  return id
}

/// La notification serveur V2 emboite le JWS de la transaction dans son propre
/// JWS (`data.signedTransactionInfo`). Meme regle que readOriginalTransactionId :
/// ni l'un ni l'autre n'est verifie, on n'en tire qu'un identifiant, et l'etat
/// vient d'Apple par TLS.
export function readSignedTransactionFromNotification(signedPayload: string): string | null {
  const parts = signedPayload.split('.')
  if (parts.length !== 3) return null
  const payload = decodeSegment(parts[1]!)
  const signed = (payload?.data as { signedTransactionInfo?: unknown } | undefined)?.signedTransactionInfo
  return typeof signed === 'string' ? signed : null
}

/// Le filtre vit ICI, dans la fonction qui construit l'URL, et non seulement
/// dans readOriginalTransactionId : lookup() sera bientot appelee avec une
/// valeur relue de la base ou d'un corps de requete, pas fraichement passee par
/// le lecteur de JWS. Sans ce garde, `../../../v1/notifications/test?x=` sort
/// de /inApps/v1/subscriptions/ et atteint un AUTRE endpoint d'Apple avec notre
/// jeton de fournisseur attache.
///
/// La valeur refusee n'est jamais recopiee dans le message : elle vient du
/// reseau, et ce message peut finir dans un log ou en base.
function requireTransactionId(id: string): string {
  if (!TRANSACTION_ID.test(id)) {
    throw new Error('app store server api: originalTransactionId must be 1 to 32 digits')
  }
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

/// Le errorCode du corps d'erreur d'Apple, ou null si le corps n'est pas
/// lisible (page HTML d'un proxy, corps vide...). Ne leve jamais : c'est
/// l'appelant qui decide quoi faire d'un code absent, et il choisit de lever.
async function errorCode(res: Response): Promise<number | null> {
  try {
    const body = (await res.json()) as { errorCode?: unknown }
    return typeof body?.errorCode === 'number' ? body.errorCode : null
  } catch {
    return null
  }
}

export function createAppStoreClient(fetchImpl: typeof fetch = fetch) {
  async function on(environment: AppleEnvironment, id: string, token: string): Promise<AppleSubscription | null> {
    const res = await fetchImpl(`${HOSTS[environment]}/inApps/v1/subscriptions/${requireTransactionId(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Un 404 ne dit pas a lui seul "pas d'abonnement" : Apple en renvoie un
    // pour cinq codes distincts. Seul 4040010 est un "pas ici", et c'est celui
    // qui fait passer de la production au sandbox. Tous les autres levent en
    // nommant le code, parce qu'un abonne paye.
    if (res.status === 404) {
      const code = await errorCode(res)
      if (code === TRANSACTION_NOT_FOUND) return null
      throw new Error(`app store server api 404 errorCode=${code ?? 'unreadable'} (${environment})`)
    }
    if (!res.ok) throw new Error(`app store server api ${res.status}`)

    const body = (await res.json()) as {
      data?: { lastTransactions?: { originalTransactionId?: string; status?: number; signedTransactionInfo?: string }[] }[]
    }
    // data[] est la liste des GROUPES d'abonnement du client, et un groupe peut
    // porter plusieurs lignes. Prendre data[0].lastTransactions[0] revenait a
    // rendre l'etat d'une transaction voisine sous l'identifiant demande.
    const row = (body.data ?? [])
      .flatMap((group) => group?.lastTransactions ?? [])
      .find((entry) => entry?.originalTransactionId === id)
    const signed = row?.signedTransactionInfo
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
      status: typeof row.status === 'number' && KNOWN_STATUSES.includes(row.status) ? row.status : null,
      environment,
    }
  }

  return {
    /// Production d'abord, sandbox ensuite : c'est aussi ce qui renseigne
    /// plan_environment, et les deux espaces d'identifiants sont disjoints.
    async lookup(originalTransactionId: string): Promise<AppleSubscription | null> {
      // Avant de signer quoi que ce soit : un identifiant malforme ne merite
      // pas un jeton de fournisseur.
      requireTransactionId(originalTransactionId)
      const token = await providerToken()
      return (
        (await on('Production', originalTransactionId, token)) ??
        (await on('Sandbox', originalTransactionId, token))
      )
    },
  }
}
