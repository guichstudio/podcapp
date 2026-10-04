import { and, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { MIN_SOURCES_PER_EPISODE } from '../config.js'
import * as schema from '../db/schema.js'
import { stories } from '../db/schema.js'

// The jobs run on node-postgres and the edge function on Neon over HTTP: both
// are PgDatabase, and this is the one helper both call.
type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

// "Enough to make an episode" has one definition, used by the API, the cron and
// the pipeline itself: the distinct saved sources behind the user's OPEN
// stories — what an episode is actually built from. Kept free of heavy imports
// so the edge function can share it.
export async function countAvailableSources(db: AnyDb, userId: string, category?: string): Promise<number> {
  const open = await db
    .select({ sourceIds: stories.sourceIds })
    .from(stories)
    .where(and(eq(stories.userId, userId), eq(stories.status, 'open'), ...(category ? [eq(stories.category, category)] : [])))
  return new Set(open.flatMap((s) => s.sourceIds)).size
}

export function hasEnoughSources(count: number): boolean {
  return count >= MIN_SOURCES_PER_EPISODE
}

/// The refusal, in the user's language: the app shows it verbatim.
export function shortageMessage(language: string, count: number): string {
  const missing = MIN_SOURCES_PER_EPISODE - count
  return language.trim().toLowerCase().startsWith('fr')
    ? `Il faut au moins ${MIN_SOURCES_PER_EPISODE} liens pour fabriquer un épisode : ${count} pour l’instant. Partagez-en encore ${missing}.`
    : `An episode needs at least ${MIN_SOURCES_PER_EPISODE} saved links: ${count} so far. Share ${missing} more.`
}

/// The other refusal: the link count was met, but the editor found nothing
/// worth an episode in ANY of it (three share-wrapper pages with no article
/// behind them is the case that produced it). Those stories are marked
/// 'discarded' before this is thrown, so it says the failure will not repeat —
/// and it must be true.
///
/// Three things this sentence must NOT do, each learned the hard way:
///   - never say "set aside" / "écartés": that is the Library's own action on a
///     SOURCE (sources.set_aside_at, with a Put back button next to it). This
///     mechanism is different, invisible in the Library and not reversible, so
///     borrowing the word would send the user looking for a Put back that does
///     not apply and a counter that will not match.
///   - never name a cause. We do not know one: editorial.v2 also hard-discards
///     encyclopedia entries, reference pages and anything already covered in a
///     recent episode — all perfectly readable. "Empty pages, redirects" would
///     be false for someone who saved four Wikipedia articles.
///   - name the real number of links needed, the way shortageMessage does.
export function unusableMaterialMessage(language: string): string {
  return language.trim().toLowerCase().startsWith('fr')
    ? `Aucun de vos liens ne pouvait donner un épisode : le rédacteur les a tous lus et n’y a trouvé aucun sujet à raconter. Ils ne seront plus proposés, donc l’échec ne se répétera pas. Partagez au moins ${MIN_SOURCES_PER_EPISODE} nouveaux liens et le prochain briefing partira de ceux-là.`
    : `None of your saved links could become an episode: the editor read all of them and found nothing to report on. They will not be tried again, so this will not repeat. Share at least ${MIN_SOURCES_PER_EPISODE} new links and the next briefing will start from those.`
}
