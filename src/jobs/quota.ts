import { and, count, eq, gte, lt, ne } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { episodes } from '../db/schema.js'

// Meme contrainte de typage que src/jobs/material.ts : les jobs tournent sur
// node-postgres et la fonction edge sur Neon en HTTP. Les deux sont PgDatabase,
// et ceci est le seul helper que les deux appellent. Aucun import lourd ici.
type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type Plan = 'free' | 'plus' | 'pro'

// Les plafonds. Ils ne sont pas un choix de packaging : a ~0,55 EUR l'episode de
// 3 min et ~0,90 EUR celui de 5 min, de l'illimite a 9,99 / 19,99 perd de
// l'argent des qu'un abonne ecoute tous les jours -- et le produit EST un cron
// quotidien. 8 et 12 restent rentables meme a la commission de 30 %.
export const PLAN_EPISODE_LIMIT: Record<Plan, number> = { free: 1, plus: 8, pro: 12 }
export const PLAN_MAX_MINUTES: Record<Plan, number> = { free: 3, plus: 3, pro: 5 }
export const PLAN_CHOOSES_VOICE: Record<Plan, boolean> = { free: false, plus: false, pro: true }

const PLANS = new Set<string>(['free', 'plus', 'pro'])

/// Le palier REEL, borne a la lecture -- exactement comme MAX_TARGET_MINUTES
/// borne users.target_minutes sans jamais reecrire la colonne. Une ligne peut
/// dire 'pro' avec une echeance depassee : elle vaut alors 'free', et personne
/// n'a besoin d'un balayage pour la corriger. Une valeur inconnue vaut 'free' :
/// un palier qu'on ne connait pas ne peut pas etre un palier qui donne droit.
export function planOf(row: { plan: string; planExpiresAt: Date | null }, now: Date = new Date()): Plan {
  if (!PLANS.has(row.plan) || row.plan === 'free') return 'free'
  if (!row.planExpiresAt || row.planExpiresAt.getTime() <= now.getTime()) return 'free'
  return row.plan as Plan
}

export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function monthResetsAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/// Ce qui consomme le quota : les episodes du mois calendaire UTC qui ne sont
/// PAS 'failed'. Un episode echoue ne consomme rien -- c'est notre panne, pas
/// celle de l'utilisateur. Un run en vol occupe donc une place et la libere s'il
/// echoue : le compte est dynamique, et l'app le relit au lieu de le memoriser.
export async function countEpisodesThisMonth(db: AnyDb, userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(episodes)
    .where(
      and(
        eq(episodes.userId, userId),
        ne(episodes.status, 'failed'),
        gte(episodes.createdAt, monthStart(now)),
        lt(episodes.createdAt, monthResetsAt(now)),
      ),
    )
  return row?.n ?? 0
}

export function hasQuotaLeft(used: number, plan: Plan): boolean {
  return used < PLAN_EPISODE_LIMIT[plan]
}

/// Le refus, dans la langue de l'utilisateur : l'app l'affiche tel quel, comme
/// shortageMessage() de material.ts.
export function quotaMessage(language: string, plan: Plan): string {
  const limit = PLAN_EPISODE_LIMIT[plan]
  if (language.trim().toLowerCase().startsWith('fr')) {
    const s = limit > 1 ? 's' : ''
    return `Vous avez utilisé vos ${limit} épisode${s} de ce mois-ci. Le compteur repart le 1er.`
  }
  const s = limit > 1 ? 's' : ''
  return `You have used your ${limit} episode${s} this month. The counter resets on the 1st.`
}
