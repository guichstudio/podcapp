import { logger, schemaTask } from '@trigger.dev/sdk'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { createDb, type Db } from '../db/client.js'
import { episodes } from '../db/schema.js'
import { generateEpisode } from '../jobs/generateEpisode.js'
import { processSource } from '../jobs/processSource.js'
import { publishEpisode } from '../jobs/publishEpisode.js'
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
  // Same bound as POST /episodes: an out-of-range value would overflow the
  // target_sec integer column.
  targetSec: z.number().int().min(60).max(3600),
  language: z.string().min(2),
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
      .set({ status: 'failed', failedStage: 'generate', error: String(err).slice(0, 2000) })
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

    try {
      await generateEpisode(db, {
        userId: payload.userId,
        targetSec: payload.targetSec,
        language: payload.language,
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
    // episode is published, and a feed or console failure must not walk it back
    // to failed. Log and rethrow so the run shows the error.
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
