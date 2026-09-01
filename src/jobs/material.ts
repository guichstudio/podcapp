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
