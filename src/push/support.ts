import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { supportMessages, users } from '../db/schema.js'
import { apnsConfig } from './apns.js'
import { sendToUser } from './notify.js'

// Notifications for the support thread, sent from the worker because the edge
// function has no HTTP/2 (see apns.ts). Same contract as notifyReady: a no-op
// without an APNs key, and never the reason a message fails to be recorded --
// by the time this runs, the message is already in the thread.

/// Read by the app to open the chat when the notification is tapped.
export const supportData = { support: '1' }

export function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/// To Louis, in French: the admin side is one person.
export function adminAlert(email: string | null, body: string): { title: string; body: string } {
  return { title: 'Nouveau message', body: `${email ?? 'Apple relais'} : ${excerpt(body)}` }
}

/// To a tester, titled in their language; the body is the admin's own words.
export function userAlert(language: string, body: string): { title: string; body: string } {
  const french = language.trim().toLowerCase().startsWith('fr')
  // Signed by a person, not a brand: a feedback request answered by the founder
  // himself is the whole point of a hand-run beta (Louis's wording, 2026-10-04).
  return {
    title: french ? 'Louis, fondateur de Podcapp, vous a envoyé un message' : 'Louis, founder of Podcapp, sent you a message',
    body: excerpt(body),
  }
}

export type NotifySupportPayload =
  | { kind: 'to_admin'; messageId: string; adminUserIds: string[] }
  | { kind: 'to_users'; messageId: string }
  | { kind: 'broadcast'; broadcastId: string }

export async function notifySupport(db: Db, payload: NotifySupportPayload): Promise<{ notified: number }> {
  const config = apnsConfig()
  if (!config) return { notified: 0 }

  if (payload.kind === 'to_admin') {
    const [row] = await db
      .select({ body: supportMessages.body, email: users.email })
      .from(supportMessages)
      .innerJoin(users, eq(users.id, supportMessages.userId))
      .where(eq(supportMessages.id, payload.messageId))
    if (!row) return { notified: 0 }
    const alert = adminAlert(row.email, row.body)
    let notified = 0
    for (const adminId of payload.adminUserIds) {
      notified += await sendToUser(db, config, adminId, { ...alert, data: supportData, threadId: 'support' })
    }
    return { notified }
  }

  const rows = await db
    .select({ id: supportMessages.id, userId: supportMessages.userId, body: supportMessages.body, language: users.outputLanguage })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.userId))
    .where(
      payload.kind === 'to_users'
        ? eq(supportMessages.id, payload.messageId)
        : eq(supportMessages.broadcastId, payload.broadcastId),
    )
  let notified = 0
  for (const row of rows) {
    const alert = userAlert(row.language, row.body)
    // Collapsed per message: a retried task must not ring the same phone twice.
    notified += await sendToUser(db, config, row.userId, { ...alert, data: supportData, threadId: 'support', collapseId: row.id })
  }
  return { notified }
}
