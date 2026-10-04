import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { users } from '../db/schema.js'
import { planOf, type Plan } from '../jobs/quota.js'
import { entitledUntil, isEntitled, type AppleSubscription } from './appstore.js'
import { PRODUCT_PLANS } from './link.js'

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>
type Client = { lookup(id: string): Promise<AppleSubscription | null> }

/// Relit l'abonnement chez Apple et aligne la ligne dessus.
///
/// C'est la SEULE facon dont une notification agit : sa charge utile est un
/// ping non verifie, on n'en garde que l'identifiant. Tous les types --
/// DID_RENEW, EXPIRED, REFUND, REVOKE... -- prennent donc ce meme chemin, et il
/// n'y a aucune machine a etats par type de notification a maintenir.
///
/// Le droit se lit avec isEntitled, comme au rattachement -- pas sur
/// expiresDate, que la grace laisse dans le passe et qu'un remboursement laisse
/// dans le futur.
export async function refreshByTransaction(
  db: AnyDb,
  client: Client,
  originalTransactionId: string,
  now: Date = new Date(),
): Promise<'updated' | 'downgraded' | 'unknown'> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.planOriginalTxnId, originalTransactionId))
  if (!row) return 'unknown'

  const sub = await client.lookup(originalTransactionId)
  const plan = sub ? PRODUCT_PLANS[sub.productId] : undefined
  if (!sub || !plan || !isEntitled(sub)) {
    // planOriginalTxnId reste en place, deliberement : c'est ce qui permet a un
    // renouvellement tardif, ou a la levee d'une grace, de retrouver la ligne,
    // et l'index unique partiel continue d'empecher un autre compte de la
    // revendiquer.
    await db.update(users).set({ plan: 'free', planExpiresAt: null }).where(eq(users.id, row.id))
    return 'downgraded'
  }

  await db
    .update(users)
    .set({ plan, planExpiresAt: entitledUntil(sub, now), planEnvironment: sub.environment })
    .where(eq(users.id, row.id))
  return 'updated'
}

const PAID = new Set<string>(['plus', 'pro'])

/// Le palier a appliquer, avec le filet : si la ligne dit un palier payant dont
/// l'echeance est passee, relire chez Apple PLUTOT que de retrograder sur la foi
/// d'un webhook peut-etre manque. Un abonne payant qui perd son palier parce
/// qu'Apple a mal livre une notification est une panne inacceptable ; un appel
/// HTTP avant une depense de 0,55 EUR ne l'est pas.
///
/// Apple injoignable (ou cles absentes) : on garde le palier payant pour cette
/// fois. Couper quelqu'un qui paie sur une panne reseau serait pire que de
/// servir un episode a quelqu'un dont l'abonnement vient de finir ; le filet
/// repasse au prochain appel.
///
/// `client` est une fabrique pour qu'aucune cle ne soit lue quand le filet n'a
/// rien a faire -- le cas de tous les comptes gratuits.
export async function planWithSafetyNet(
  db: AnyDb,
  row: { id: string; plan: string; planExpiresAt: Date | null; planOriginalTxnId: string | null },
  client: () => Client,
  now: Date = new Date(),
): Promise<Plan> {
  const lapsed = PAID.has(row.plan) && row.planExpiresAt !== null && row.planExpiresAt.getTime() <= now.getTime()
  if (!lapsed || !row.planOriginalTxnId) return planOf(row, now)
  try {
    await refreshByTransaction(db, client(), row.planOriginalTxnId, now)
  } catch (err) {
    console.error('subscription safety net could not reach Apple; keeping the paid plan this time', row.id, err)
    return row.plan as Plan
  }
  const [fresh] = await db
    .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
    .from(users)
    .where(eq(users.id, row.id))
  return fresh ? planOf(fresh, now) : 'free'
}
