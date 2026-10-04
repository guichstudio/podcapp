import { logger, schedules, schemaTask } from '@trigger.dev/sdk'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { createDb, type Db } from '../db/client.js'
import { episodes, stories, users } from '../db/schema.js'
import { MAX_TARGET_MINUTES, targetMinutesFor } from '../config.js'
import { deleteAccount } from '../jobs/deleteAccount.js'
import { countAvailableSources, hasEnoughSources } from '../jobs/material.js'
import { generateEpisode } from '../jobs/generateEpisode.js'
import { countEpisodesThisMonth, hasQuotaLeft, PLAN_EPISODE_LIMIT, planOf } from '../jobs/quota.js'
import { processSource } from '../jobs/processSource.js'
import { publishEpisode } from '../jobs/publishEpisode.js'
import { notifyReady } from '../push/notify.js'
import { notifySupport } from '../push/support.js'
import { publishConsole, publishFeed } from '../rss/feed-data.js'
import { createStorage, type Storage } from '../storage/index.js'

// The two durable jobs (ARCHITECTURE §5): processSource per saved link,
// generateEpisode for the full script -> audio -> feed run. The pipeline logic
// lives in src/jobs; these tasks only wire payloads, handles and failure
// bookkeeping. Handles are created inside run() on purpose: worker processes
// are recycled between runs, and a shared pool would outlive the run it was
// opened for.

// Both createDb and createStorage fall back to local, zero-credential modes
// (PGlite on disk, .data/storage). On a laptop that is a feature; on a cloud
// worker it writes episodes to an ephemeral disk nothing will ever serve them
// from: data loss dressed as success. So a worker refuses to start a run
// without the real backends.
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'] as const

function requireCloudEnv(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set: this worker would fall back to an embedded PGlite database on its own ephemeral disk. Set it in the Trigger.dev dashboard.')
  }
  const missing = R2_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(`R2 is not configured (missing ${missing.join(', ')}): this worker would write episodes to its own ephemeral disk. Set the R2 vars in the Trigger.dev dashboard.`)
  }
}

// requireCloudEnv guarantees full R2 config, so this returns the R2 driver.
function createCloudStorage(): Storage {
  requireCloudEnv()
  return createStorage()
}

export const processSourceTask = schemaTask({
  id: 'process-source',
  schema: z.object({ sourceId: z.string().min(1) }),
  // processSource is idempotent by design (every step re-checks state), so the
  // config-level default retries are safe here.
  run: async (payload) => {
    // processSource never touches storage, but a worker missing the R2 vars is
    // misconfigured for the episode run too: surface that on the first, cheap
    // task instead of after a full generation.
    requireCloudEnv()
    const db = await createDb()
    // processSource records its own readable status/error on the source row on
    // failure; a throw here only fails the run.
    return await processSource(db, payload.sourceId)
  },
})

const GenerateEpisodePayload = z.object({
  episodeId: z.string().min(1),
  userId: z.string().min(1),
  // Same bound as POST /episodes and queueBriefing (1..MAX_TARGET_MINUTES minutes), so a
  // manual run from the Trigger.dev dashboard cannot start an oversized
  // generation the product never allows.
  targetSec: z.number().int().min(60).max(MAX_TARGET_MINUTES * 60),
  language: z.string().min(2),
  category: z.string().optional(),
  // A hand-picked run: exactly these saved links, whatever state their stories
  // are in. The bound is the same 50 the API accepts, so a run started from the
  // Trigger.dev dashboard cannot ask for more than the app ever can.
  sourceIds: z.array(z.string().min(1)).min(1).max(50).optional(),
})

// generateEpisode leaves the row status alone when it throws (it persists run
// artifacts and rethrows; in the API the route records the failure). Without
// this write a generation failure would leave the episode stuck on 'queued'
// with no readable reason. Guarded because whatever failed the run (a DB
// outage, say) can fail this write too.
async function recordGenerateFailure(db: Db, episodeId: string, err: unknown): Promise<void> {
  try {
    await db
      .update(episodes)
      // err.message, not String(err): generateEpisode's refusals are written
      // for the user and the app shows this column verbatim, so it must not
      // arrive prefixed with "Error: ". Same shape as publishEpisode.
      .set({ status: 'failed', failedStage: 'generate', error: (err instanceof Error ? err.message : String(err)).slice(0, 2000) })
      .where(and(eq(episodes.id, episodeId), ne(episodes.status, 'failed')))
  } catch (writeErr) {
    logger.error('episode run: could not record the failure', { episodeId, error: String(writeErr) })
  }
}

export const generateEpisodeTask = schemaTask({
  id: 'generate-episode',
  schema: GenerateEpisodePayload,
  // No automatic retries: an attempt that failed after publishEpisode would
  // regenerate the script and re-pay the writer and TTS for an episode that is
  // already published. Failures are readable on the episode row; re-run on
  // purpose, not on a timer.
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const storage = createCloudStorage()
    const db = await createDb()

    // The reapers (API and cron) mark any active row older than 30 minutes as
    // failed, assuming the run died. A run that sat that long in the queue is
    // alive though, and generateEpisode writes statuses unconditionally: it
    // would resurrect the reaped row and pay writer + TTS for a briefing that
    // was already replaced. The reap is terminal; this makes it so.
    const [row] = await db
      .select({ status: episodes.status })
      .from(episodes)
      .where(eq(episodes.id, payload.episodeId))
    if (row?.status !== 'queued') {
      logger.warn('generate-episode skipped: row is not queued anymore', {
        episodeId: payload.episodeId,
        status: row?.status ?? 'missing',
      })
      return { skipped: row?.status ?? 'missing' }
    }

    try {
      await generateEpisode(db, {
        userId: payload.userId,
        targetSec: payload.targetSec,
        language: payload.language, category: payload.category,
        sourceIds: payload.sourceIds,
        episodeId: payload.episodeId,
        storage,
      })
    } catch (err) {
      await recordGenerateFailure(db, payload.episodeId, err)
      throw err
    }

    // publishEpisode records its own status/failedStage/error on the row; a
    // throw here only fails the run.
    const published = await publishEpisode(db, storage, payload.episodeId)

    // Past this point the row says 'ready' and the audio is served from R2: the
    // episode is published. Everything below is delivery, and none of it may
    // walk the episode back to failed.
    //
    // The notification comes FIRST and swallows its own errors, deliberately.
    // It is the only part a listener feels immediately -- the feed and the
    // console can be republished on the next run, a "your briefing is ready"
    // that arrives an hour late is worse than none -- and it must never be the
    // reason a published episode reports failure.
    await notifyReady(db, payload.userId, payload.episodeId).catch((err) => {
      logger.warn('notification failed; the episode is published either way', {
        episodeId: payload.episodeId,
        error: String(err),
      })
    })

    // A feed or console failure must not walk the episode back to failed
    // either. Log and rethrow so the run shows the error.
    try {
      const feed = await publishFeed(db, storage, payload.userId)
      const consolePage = await publishConsole(db, storage, payload.userId)
      return {
        audioUrl: published.audioUrl,
        durationSec: published.durationSec,
        feedUrl: feed.feedUrl,
        consoleUrl: consolePage.consoleUrl,
      }
    } catch (err) {
      logger.error('episode published but feed/console publishing failed; the episode stays ready', {
        episodeId: payload.episodeId,
        userId: payload.userId,
        error: String(err),
      })
      throw err
    }
  },
})

// Keep in sync with ACTIVE_EPISODE_STATUSES in api/index.ts: every status a
// generation moves through before landing on ready or failed.
const ACTIVE_EPISODE_STATUSES = [
  'queued',
  'selecting',
  'outlining',
  'writing',
  'grounding',
  'editing',
  'tts',
  'assembling',
]

type BriefingOutcome = { userId: string; episodeId?: string; skipped?: string }

// One user's morning decision, mirroring POST /episodes: skip when there is
// nothing new (stories are marked 'aired' by publishEpisode, so an open story
// IS new material), skip while a generation can still be alive, reap the ones
// that died without reaching their catch, then queue a run.
async function queueBriefing(
  db: Db,
  user: { id: string; targetMinutes: number; outputLanguage: string; plan: string; planExpiresAt: Date | null },
): Promise<BriefingOutcome> {
  // Same rule as POST /episodes: a morning with three links gets no episode,
  // and the reason is readable in the run.
  const available = await countAvailableSources(db, user.id)
  if (!hasEnoughSources(available)) return { userId: user.id, skipped: `only ${available} source(s) in open stories` }

  // La garde de run actif et la faucheuse passent AVANT le quota, comme dans
  // POST /episodes : une ligne non-'failed' consomme une place, et cette
  // faucheuse est le seul endroit qui rend la sienne a un run mort sans avoir
  // atteint son catch. Sauter sur le quota sans avoir fauche, c'est priver
  // l'utilisateur de ses matins jusqu'au 1er du mois a cause de notre plantage.
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000)
  const actives = await db
    .select({ id: episodes.id, status: episodes.status, createdAt: episodes.createdAt })
    .from(episodes)
    .where(and(eq(episodes.userId, user.id), inArray(episodes.status, ACTIVE_EPISODE_STATUSES)))
  const live = actives.find((a) => a.createdAt > staleBefore)
  if (live) return { userId: user.id, skipped: `active episode ${live.id} (${live.status})` }
  for (const stale of actives) {
    await db
      .update(episodes)
      .set({ status: 'failed', failedStage: stale.status, error: 'Génération interrompue sans se terminer (délai de 30 minutes dépassé).' })
      .where(and(eq(episodes.id, stale.id), inArray(episodes.status, ACTIVE_EPISODE_STATUSES)))
  }

  // Same second rendezvous as POST /episodes, after the links rule and after
  // the reaper: a plan that has spent its month gets no briefing either,
  // silently to the user (no app is open at 06:00) but readable in the outcome.
  const plan = planOf(user)
  const used = await countEpisodesThisMonth(db, user.id)
  if (!hasQuotaLeft(used, plan)) {
    logger.log('skipped: monthly quota spent', { userId: user.id, plan, used, limit: PLAN_EPISODE_LIMIT[plan] })
    return { userId: user.id, skipped: `monthly quota spent (${used}/${PLAN_EPISODE_LIMIT[plan]} on ${plan})` }
  }

  // users.target_minutes is written outside this task, so it gets the same
  // bounds POST /episodes applies rather than being trusted -- et le plafond du
  // palier avec, par le MEME targetMinutesFor. Le cron est le chemin qui depense
  // tous les jours : une borne recopiee a la main ici ignorait PLAN_MAX_MINUTES
  // et generait chaque matin a 5 min quel que soit l'abonnement.
  const targetSec = targetMinutesFor(plan, null, user.targetMinutes) * 60
  // The partial unique index episodes_one_active_per_user closes the race
  // between this insert and a concurrent POST /episodes from the user.
  let row: { id: string } | undefined
  try {
    ;[row] = await db
      .insert(episodes)
      .values({ userId: user.id, targetSec, status: 'queued' })
      .returning({ id: episodes.id })
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return { userId: user.id, skipped: 'lost the race to a concurrent generation' }
    }
    throw err
  }
  if (!row) throw new Error('episode insert returned no row')

  try {
    await generateEpisodeTask.trigger(
      { episodeId: row.id, userId: user.id, targetSec, language: user.outputLanguage },
      // Keyed on the row, like the API: a lost ack must not pay writer + TTS twice.
      { idempotencyKey: `episode-${row.id}` },
    )
  } catch (err) {
    // Nothing else will ever pick this row up: a queued episode nobody will
    // run is a lie, so it is marked failed with the reason.
    await db
      .update(episodes)
      .set({ status: 'failed', failedStage: 'trigger', error: `Envoi au cloud impossible : ${String(err).slice(0, 500)}` })
      .where(eq(episodes.id, row.id))
    throw err
  }
  return { userId: user.id, episodeId: row.id }
}

// The onboarding's promise ("≈ 10 min d'audio · chaque matin") made real:
// every morning, each user whose captures produced uncovered stories gets a
// briefing queued before they wake up. Users with nothing new get nothing:
// no briefing is better than a padded one.
export const dailyBriefingsTask = schedules.task({
  id: 'daily-briefings',
  cron: { pattern: '0 6 * * *', timezone: 'Europe/Paris' },
  run: async () => {
    requireCloudEnv()
    const db = await createDb()
    const allUsers = await db
      .select({
        id: users.id,
        targetMinutes: users.targetMinutes,
        outputLanguage: users.outputLanguage,
        plan: users.plan,
        planExpiresAt: users.planExpiresAt,
      })
      .from(users)

    // Per-user isolation: one user's failure must not cost the others their
    // morning briefing.
    const outcomes: BriefingOutcome[] = []
    for (const user of allUsers) {
      try {
        outcomes.push(await queueBriefing(db, user))
      } catch (err) {
        logger.error('daily briefing failed for a user', { userId: user.id, error: String(err) })
        outcomes.push({ userId: user.id, skipped: `error: ${String(err).slice(0, 200)}` })
      }
    }
    logger.info('daily briefings decided', { outcomes })
    return outcomes
  },
})

const DeleteAccountPayload = z.object({ userId: z.string().uuid() })

// Account erasure, handed here by DELETE /me because the edge function has no
// bucket client. deleteAccount is idempotent, so retries are safe and wanted:
// a half-erased account is the one state this must never leave behind.
export const deleteAccountTask = schemaTask({
  id: 'delete-account',
  schema: DeleteAccountPayload,
  retry: { maxAttempts: 3 },
  run: async (payload) => {
    const storage = createCloudStorage()
    const db = await createDb()
    const result = await deleteAccount(db, storage, payload.userId)
    logger.info('delete-account done', { userId: payload.userId, ...result })
    return result
  },
})

// A support message or a feedback request, announced by push. Queued by the
// edge function, which has no HTTP/2 to reach APNs itself. The message is
// already in the thread when this runs, so a failure here costs a notification,
// never a message; two attempts, because a retry is collapsed per message on
// the phone and cannot ring twice.
const NotifySupportPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('to_admin'), messageId: z.string().uuid(), adminUserIds: z.array(z.string().uuid()) }),
  z.object({ kind: z.literal('to_users'), messageId: z.string().uuid() }),
  z.object({ kind: z.literal('broadcast'), broadcastId: z.string().uuid() }),
])

export const notifySupportTask = schemaTask({
  id: 'notify-support',
  schema: NotifySupportPayload,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    requireCloudEnv()
    const db = await createDb()
    const result = await notifySupport(db, payload)
    logger.info('notify-support done', { kind: payload.kind, ...result })
    return result
  },
})
