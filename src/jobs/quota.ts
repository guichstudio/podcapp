import { and, count, eq, gte, lt, ne } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { episodes } from '../db/schema.js'

// Meme contrainte de typage que src/jobs/material.ts : les jobs tournent sur
// node-postgres et la fonction edge sur Neon en HTTP. Les deux sont PgDatabase,
// et ceci est le seul helper que les deux appellent. Aucun import lourd ici.
type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type Plan = 'free' | 'plus' | 'pro'

/// L'interrupteur du freemium. Eteint tant que FREEMIUM_ENFORCED ne vaut pas
/// exactement 'true' : le code des paliers est sur main, mais l'ecran d'achat
/// (taches 7 et 8 du plan) n'existe pas encore, et l'allumer plafonnerait les
/// testeurs a 1 episode par mois sans aucun moyen de payer pour lever la
/// limite (decision de Louis, 2026-10-04). Eteint, AUCUNE borne de palier ne
/// s'applique : ni le compte mensuel, ni la duree, ni le choix de voix -- le
/// produit se comporte exactement comme avant la fusion. Lu a chaque appel,
/// pas une seule fois au chargement, pour que les tests puissent le basculer.
export function freemiumEnforced(): boolean {
  return process.env.FREEMIUM_ENFORCED === 'true'
}

// Les plafonds. Ils ne sont pas un choix de packaging : a ~0,55 EUR l'episode de
// 3 min et ~0,90 EUR celui de 5 min, de l'illimite a 9,99 / 19,99 perd de
// l'argent des qu'un abonne ecoute tous les jours -- et le produit EST un cron
// quotidien. 8 et 12 restent rentables meme a la commission de 30 %.
// null = illimite. Le gratuit l'est depuis la decision de Louis du 2026-10-04 :
// sortie sur l'App Store sans paywall, episodes illimites, mais 3 min et la voix
// de sa langue (PLAN_MAX_MINUTES, PLAN_CHOOSES_VOICE). Plus et Pro gardent les
// plafonds de la spec pour le jour ou l'achat existera.
export const PLAN_EPISODE_LIMIT: Record<Plan, number | null> = { free: null, plus: 8, pro: 12 }
// Le gratuit a tout ouvert depuis l'arrivee des credits (2026-10-04) : un
// briefing plus long ou une autre voix consomment des credits, ils n'ont plus a
// etre interdits (voir credits.ts).
export const PLAN_MAX_MINUTES: Record<Plan, number> = { free: 5, plus: 3, pro: 5 }
export const PLAN_CHOOSES_VOICE: Record<Plan, boolean> = { free: true, plus: false, pro: true }

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

/// `exceptEpisodeId` : l'episode qu'on est en train de generer ne se compte pas
/// lui-meme. CE N'EST PAS UNE FAILLE, c'est la difference entre les deux
/// moments ou la regle est lue. POST /episodes et le cron lisent le compteur
/// AVANT d'inserer la ligne : "reste-t-il une place pour un episode de plus ?".
/// Le pipeline le lit APRES, depuis un run qui possede deja sa ligne 'queued' :
/// sans exclusion il compte sa propre place comme prise, et le gratuit (limite
/// 1) echoue a TOUS les coups -- la porte laisse entrer, le pipeline refuse.
/// La question du pipeline est "cette ligne-ci avait-elle droit d'exister ?",
/// donc elle s'exclut du compte et personne d'autre.
export type CountEpisodesOptions = {
  /// L'episode dont le run pose la question. Omis (eval, appel manuel), rien
  /// n'est exclu et le compte reste celui de la porte d'entree.
  exceptEpisodeId?: string | null
}

/// Ce qui consomme le quota : les episodes du mois calendaire UTC qui ne sont
/// PAS 'failed'. Un episode echoue ne consomme rien -- c'est notre panne, pas
/// celle de l'utilisateur. Un run en vol occupe donc une place et la libere s'il
/// echoue : le compte est dynamique, et l'app le relit au lieu de le memoriser.
export async function countEpisodesThisMonth(
  db: AnyDb,
  userId: string,
  now: Date = new Date(),
  opts: CountEpisodesOptions = {},
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(episodes)
    .where(
      and(
        eq(episodes.userId, userId),
        ne(episodes.status, 'failed'),
        gte(episodes.createdAt, monthStart(now)),
        lt(episodes.createdAt, monthResetsAt(now)),
        ...(opts.exceptEpisodeId ? [ne(episodes.id, opts.exceptEpisodeId)] : []),
      ),
    )
  return row?.n ?? 0
}

export function hasQuotaLeft(used: number, plan: Plan): boolean {
  if (!freemiumEnforced()) return true
  const limit = PLAN_EPISODE_LIMIT[plan]
  return limit === null || used < limit
}

/// Le refus, dans la langue de l'utilisateur : l'app l'affiche tel quel, comme
/// shortageMessage() de material.ts.
export function quotaMessage(language: string, plan: Plan): string {
  // Jamais appele pour un palier illimite (hasQuotaLeft ne refuse pas) ; 0 garde
  // la phrase grammaticale si cela arrivait quand meme.
  const limit = PLAN_EPISODE_LIMIT[plan] ?? 0
  if (language.trim().toLowerCase().startsWith('fr')) {
    const s = limit > 1 ? 's' : ''
    return `Vous avez utilisé vos ${limit} épisode${s} de ce mois-ci. Le compteur repart le 1er.`
  }
  const s = limit > 1 ? 's' : ''
  return `You have used your ${limit} episode${s} this month. The counter resets on the 1st.`
}
