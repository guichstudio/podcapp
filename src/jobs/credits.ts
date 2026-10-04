import { and, eq, gte, lt, ne } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { TTS_USD_PER_1K_CHARS } from '../config.js'
import * as schema from '../db/schema.js'
import { episodes } from '../db/schema.js'
import { freemiumEnforced, monthResetsAt, monthStart, type Plan } from './quota.js'

// Les credits du gratuit (decision de Louis, 2026-10-04) : episodes illimites,
// mais 100 credits par mois, et 100 credits valent 5 EUR de cout reel. C'est ce
// qui borne ce qu'un utilisateur gratuit peut couter, quelle que soit la duree
// ou la voix qu'il choisit -- un briefing plus long consomme simplement plus.
//
// Un credit se mesure sur le cout REEL de l'episode (episodes.cost.total_usd,
// ecrit a la publication), pas sur une estimation : le cout varie du simple au
// double d'un episode a l'autre (mesure sur 15 episodes le 2026-10-04). Seul un
// episode encore en cours, qui n'a pas de cout, compte a son prix de reserve.
//
// Meme typage que material.ts et quota.ts : appelable depuis l'edge (Neon HTTP)
// et depuis les jobs (node-postgres), sans import lourd.

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

/// null = pas de credits a compter. Plus et Pro n'en ont pas tant que l'achat
/// n'existe pas ; ils gardent leurs plafonds d'episodes (PLAN_EPISODE_LIMIT).
export const PLAN_MONTHLY_CREDITS: Record<Plan, number | null> = { free: 100, plus: null, pro: null }

export const EUR_PER_CREDIT = 0.05
/// Le taux retenu par la spec freemium, arrondi. Les couts sont en dollars
/// (ceux des fournisseurs), les credits en euros.
export const USD_PER_EUR = 1.09

export function creditsForUsd(usd: number): number {
  return usd / USD_PER_EUR / EUR_PER_CREDIT
}

// Mesure sur les 15 derniers episodes reels (2026-10-04) : ~800 signes de script
// par minute d'audio, et 0,03 a 0,22 USD de modeles de langue par episode.
const TTS_CHARS_PER_MINUTE = 800
const LLM_USD_TYPICAL = 0.13
const LLM_USD_HIGH = 0.22

/// Ce qu'un briefing de cette duree coute d'habitude, pour l'afficher.
export function typicalCredits(minutes: number): number {
  const tts = ((minutes * TTS_CHARS_PER_MINUTE) / 1000) * TTS_USD_PER_1K_CHARS
  return Math.round(creditsForUsd(LLM_USD_TYPICAL + tts))
}

/// Ce qu'on reserve avant de lancer un briefing : le haut de la fourchette
/// mesuree, script 20 % plus long compris. C'est la reserve, pas l'habitude, qui
/// tient la promesse des 5 EUR : on ne lance un episode que si elle tient dans
/// ce qui reste, et son cout reel la depasse rarement.
export function reserveCredits(minutes: number): number {
  const tts = ((minutes * TTS_CHARS_PER_MINUTE * 1.2) / 1000) * TTS_USD_PER_1K_CHARS
  return Math.ceil(creditsForUsd(LLM_USD_HIGH + tts))
}

export type SpentOptions = {
  /// L'episode dont le run pose la question : il ne se compte pas lui-meme,
  /// pour la meme raison que dans countEpisodesThisMonth.
  exceptEpisodeId?: string | null
}

/// Les credits consommes ce mois calendaire UTC. Un episode 'failed' ne coute
/// rien -- c'est notre panne, pas celle de l'utilisateur.
export async function spentCreditsThisMonth(
  db: AnyDb,
  userId: string,
  now: Date = new Date(),
  opts: SpentOptions = {},
): Promise<number> {
  const rows = await db
    .select({ cost: episodes.cost, targetSec: episodes.targetSec, status: episodes.status })
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
  let spent = 0
  for (const row of rows) {
    const usd = (row.cost as { total_usd?: unknown } | null)?.total_usd
    spent += row.status === 'ready' && typeof usd === 'number' ? creditsForUsd(usd) : reserveCredits(row.targetSec / 60)
  }
  return spent
}

export function hasCreditsFor(plan: Plan, spent: number, minutes: number): boolean {
  if (!freemiumEnforced()) return true
  const monthly = PLAN_MONTHLY_CREDITS[plan]
  if (monthly === null) return true
  return monthly - spent >= reserveCredits(minutes)
}

/// Ce que l'app affiche : le solde, le renouvellement, et le prix habituel de
/// chaque duree. null quand il n'y a rien a compter (interrupteur eteint, ou
/// palier sans credits) : l'app cache alors la jauge.
export function creditsView(plan: Plan, spent: number, now: Date = new Date()) {
  const monthly = PLAN_MONTHLY_CREDITS[plan]
  if (!freemiumEnforced() || monthly === null) return null
  return {
    monthly,
    left: Math.max(0, Math.floor(monthly - spent)),
    resets_at: monthResetsAt(now).toISOString(),
    per_episode: { '3': typicalCredits(3), '4': typicalCredits(4), '5': typicalCredits(5) },
    // What the server demands before starting each length: the app greys out
    // Generate exactly when the server would refuse, never on its own guess.
    reserve: { '3': reserveCredits(3), '4': reserveCredits(4), '5': reserveCredits(5) },
  }
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/// Le refus, dans la langue de l'utilisateur ; l'app l'affiche tel quel.
export function creditsMessage(language: string, left: number, minutes: number, now: Date = new Date()): string {
  const month = monthResetsAt(now).getUTCMonth()
  const remaining = Math.max(0, Math.floor(left))
  if (language.trim().toLowerCase().startsWith('fr')) {
    const s = remaining > 1 ? 's' : ''
    return `Il vous reste ${remaining} crédit${s}, pas assez pour un briefing de ${minutes} min. Vos 100 crédits reviennent le 1er ${MONTHS_FR[month]}.`
  }
  const s = remaining === 1 ? '' : 's'
  return `You have ${remaining} credit${s} left, not enough for a ${minutes}-minute briefing. Your 100 credits come back on ${MONTHS_EN[month]} 1.`
}
