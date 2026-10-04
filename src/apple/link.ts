import { and, eq, ne } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { users } from '../db/schema.js'
import type { Plan } from '../jobs/quota.js'
import { entitledUntil, isEntitled, type AppleSubscription } from './appstore.js'

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export const APPLE_BUNDLE_ID = 'com.louisguichard.podcapp'

export const PRODUCT_PLANS: Record<string, Plan> = {
  'com.louisguichard.podcapp.plus.monthly': 'plus',
  'com.louisguichard.podcapp.pro.monthly': 'pro',
}

export type LinkResult =
  | { ok: true; plan: Plan }
  | { ok: false; reason: 'wrong_bundle' | 'unknown_product' | 'not_my_purchase' | 'not_entitled' }

/// Rattache un abonnement lu chez Apple au compte authentifie.
///
/// La verification qui compte est `appAccountToken === userId`. Un JWS
/// parfaitement signe par Apple ne dit PAS qui le presente : sans ce controle,
/// quiconque connait l'originalTransactionId d'un tiers rattacherait
/// l'abonnement de ce tiers a son propre compte. appAccountToken est le
/// mecanisme prevu par Apple pour lier un achat a un compte applicatif, et
/// c'est un UUID -- donc users.id y entre tel quel.
export async function linkSubscription(
  db: AnyDb,
  userId: string,
  sub: AppleSubscription,
  now: Date = new Date(),
): Promise<LinkResult> {
  if (sub.bundleId !== APPLE_BUNDLE_ID) return { ok: false, reason: 'wrong_bundle' }
  const plan = PRODUCT_PLANS[sub.productId]
  if (!plan) return { ok: false, reason: 'unknown_product' }
  if (!sub.appAccountToken || sub.appAccountToken.toLowerCase() !== userId.toLowerCase()) {
    return { ok: false, reason: 'not_my_purchase' }
  }
  // isEntitled, PAS une comparaison de dates : pendant une periode de grace
  // l'abonne a droit au service alors que son expiresDate est deja passe.
  if (!isEntitled(sub)) return { ok: false, reason: 'not_entitled' }

  // Une transaction deja tenue par un autre compte : l'index unique partiel
  // l'empecherait de toute facon, mais en levant -- un 500 la ou la reponse
  // honnete est "ce n'est pas votre achat".
  const [holder] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.planOriginalTxnId, sub.originalTransactionId), ne(users.id, userId)))
  if (holder) return { ok: false, reason: 'not_my_purchase' }

  await db
    .update(users)
    .set({
      plan,
      planExpiresAt: entitledUntil(sub, now),
      planOriginalTxnId: sub.originalTransactionId,
      planEnvironment: sub.environment,
    })
    .where(eq(users.id, userId))
  return { ok: true, plan }
}
