import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { sessions } from '../db/schema.js'
import { randomToken } from './crypto.js'
import type { AnyDb } from './types.js'

// Une ecriture par requete sur Neon en HTTP coute une latence reelle, pour une
// precision dont personne ne se sert : `last_seen_at` n'est rafraichi que si sa
// valeur date de plus d'une heure.
export const LAST_SEEN_THROTTLE_MS = 3_600_000

export async function createSession(db: AnyDb, userId: string, deviceName: string): Promise<string> {
  const token = randomToken()
  await db.insert(sessions).values({ userId, token, deviceName })
  return token
}

/// La ligne complete derriere un jeton encore valide, ou null. Sert a la fois
/// a authentifier (userId) et a distinguer, dans /me/sessions, laquelle des
/// lignes de l'appelant est celle de cette requete meme (id).
export async function sessionForToken(db: AnyDb, token: string): Promise<{ id: string; userId: string } | null> {
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, token), isNull(sessions.revokedAt)))
  if (!row) return null
  const stale = new Date(Date.now() - LAST_SEEN_THROTTLE_MS)
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(sessions.id, row.id), lt(sessions.lastSeenAt, stale)))
  return row
}

export async function userIdForToken(db: AnyDb, token: string): Promise<string | null> {
  const session = await sessionForToken(db, token)
  return session?.userId ?? null
}

export async function listSessions(db: AnyDb, userId: string) {
  return db
    .select({
      id: sessions.id,
      deviceName: sessions.deviceName,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt))
}

/// Faux quand la session n'existe pas ou appartient a quelqu'un d'autre : le
/// filtre sur userId est ce qui empeche de deconnecter un inconnu.
export async function revokeSession(db: AnyDb, userId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id })
  return rows.length > 0
}

/// Revoque toutes les sessions vivantes d'un compte d'un coup : ce que
/// DELETE /me doit faire pour qu'aucun autre appareil ne reste connecte apres
/// une suppression de compte. Renvoie le nombre de lignes touchees.
export async function revokeAllSessions(db: AnyDb, userId: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id })
  return rows.length
}
