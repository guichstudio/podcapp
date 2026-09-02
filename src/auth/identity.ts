import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { identities, users } from '../db/schema.js'
import type { AnyDb, VerifiedIdentity } from './types.js'

// Apple fabrique ces adresses par app et par utilisateur : deux d'entre elles
// ne peuvent pas designer la meme personne chez deux fournisseurs, et une
// egalite fortuite ne prouverait rien. Elles ne rattachent donc jamais.
export const PRIVATE_RELAY_SUFFIX = '@privaterelay.appleid.com'

export function isMergeable(email: string | null, verified: boolean): boolean {
  if (!email || !verified) return false
  return !email.toLowerCase().endsWith(PRIVATE_RELAY_SUFFIX)
}

const token = () => randomBytes(32).toString('base64url')

/// Trouve, rattache ou cree. Renvoie l'id du compte a qui appartient l'identite.
export async function resolveUserId(db: AnyDb, identity: VerifiedIdentity): Promise<string> {
  // 1. L'identite est deja connue : c'est ce compte, sans autre question.
  const [known] = await db
    .select({ userId: identities.userId })
    .from(identities)
    .where(and(eq(identities.provider, identity.provider), eq(identities.subject, identity.subject)))
  if (known) return known.userId

  // 2. Une adresse verifiee et non-relais qui correspond a un compte existant
  //    rattache la nouvelle identite plutot que de dedoubler la personne.
  let userId: string | undefined
  if (isMergeable(identity.email, identity.emailVerified)) {
    const [match] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, identity.email as string))
    userId = match?.id
  }

  // 3. Sinon, un compte neuf. Le jeton RSS est tire ici : un compte sans flux
  //    ne pourrait pas recevoir d'episode.
  //    L'email n'est stocke que s'il est mergeable : sinon deux problemes.
  //    D'abord users.email est unique, et une adresse non fiable (relais,
  //    non verifiee) peut deja appartenir a un autre compte, ce qui ferait
  //    echouer l'insertion. Ensuite, si on la stockait quand meme, un futur
  //    signin verifie avec la meme adresse fusionnerait a tort sur ce compte
  //    (etape 2) alors que la premiere revendication n'a jamais ete prouvee.
  if (!userId) {
    const claimedEmail = isMergeable(identity.email, identity.emailVerified) ? identity.email : null
    const [created] = await db
      .insert(users)
      .values({ email: claimedEmail, apiToken: token(), rssToken: token() })
      .returning({ id: users.id })
    if (!created) throw new Error('could not create the account')
    userId = created.id
  }

  await db.insert(identities).values({
    userId,
    provider: identity.provider,
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
  })
  return userId
}
