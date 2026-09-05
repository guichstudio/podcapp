import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { episodes, pushTokens, users } from '../db/schema.js'
import { logger } from '../log.js'
import { apnsConfig, logApns, sendApns, type ApnsEnvironment, type ApnsResult } from './apns.js'

/// "Your briefing is ready", to every device that asked for it.
///
/// Silent and total no-op when no APNs key is configured, which is the state
/// until someone downloads one: a product that has no notifications yet must
/// not spend a run failing over them.
///
/// Written in the listener's own language for the same reason the episode is:
/// the phone that will show this is the phone that chose it.
export async function notifyReady(db: Db, userId: string, episodeId: string): Promise<void> {
  const config = apnsConfig()
  if (!config) return

  const devices = await db
    .select({ token: pushTokens.token, environment: pushTokens.environment })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId))
  if (devices.length === 0) return

  const [episode] = await db
    .select({ title: episodes.title, actualSec: episodes.actualSec })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
  const [user] = await db.select({ language: users.outputLanguage }).from(users).where(eq(users.id, userId))

  const french = (user?.language ?? 'fr').toLowerCase().startsWith('fr')
  const minutes = Math.max(1, Math.round((episode?.actualSec ?? 0) / 60))
  const title = french ? 'Votre briefing est prêt' : 'Your briefing is ready'
  // The episode's own title, which names what is in it, rather than a count of
  // minutes nobody asked for. The duration is the subtitle, not the news.
  const headline = episode?.title?.trim()
  const body = headline
    ? `${headline} · ${minutes} min`
    : french
      ? `${minutes} min à écouter`
      : `${minutes} min to listen`

  const results: ApnsResult[] = []
  for (const device of devices) {
    const environment = device.environment === 'production' ? 'production' : ('development' as ApnsEnvironment)
    results.push(await sendApns(config, { token: device.token, environment, title, body, episodeId }))
  }
  logApns(results)

  // 410 is Apple saying this device will never be reachable again -- the app
  // was deleted, or restored onto another phone. It is the only reliable moment
  // to learn it, so the row goes now rather than being retried forever.
  const dead = results.filter((r) => r.gone).map((r) => r.token)
  if (dead.length) {
    await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), inArray(pushTokens.token, dead)))
    logger.info({ userId, removed: dead.length }, 'dead push tokens removed')
  }
}
