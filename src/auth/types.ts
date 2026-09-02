import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../db/schema.js'

// Les jobs tournent sur node-postgres, la fonction Edge sur Neon en HTTP : les
// deux sont des PgDatabase. Meme motif que src/jobs/material.ts, pour que ce
// module reste importable depuis le bundle Edge.
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type Provider = 'apple' | 'google'

export type VerifiedIdentity = {
  provider: Provider
  subject: string
  email: string | null
  emailVerified: boolean
}

// Une seule classe d'erreur, sans detail expose : le client apprend que le
// jeton est refuse, pas pourquoi.
export class AuthError extends Error {}
