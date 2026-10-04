import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { pushTokens, supportMessages, users } from '../db/schema.js'

// The support thread: one per user, answered by hand from the admin page.
//
// Shared by the edge function (Neon over HTTP) and the tests (PGlite), so it
// takes any PgDatabase and stays free of heavy imports, like jobs/material.ts.
//
// The admin views (threads, recipients, broadcast stats) are computed in JS
// over the rows rather than in SQL: a beta is tens of users and hundreds of
// messages, and the grouping reads plainly here where a window query would not.

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export const MAX_BODY = 4000

/// A message the caller sent wrong -- empty, too long, not text. The routes
/// turn it into a 400 with this message; anything else is a 500.
export class SupportError extends Error {}

export type Author = 'user' | 'admin'

export interface SupportMessage {
  id: string
  userId: string
  author: Author
  body: string
  broadcastId: string | null
  createdAt: Date
  readAt: Date | null
}

export function cleanBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new SupportError('message must be text')
  const body = raw.trim()
  if (!body) throw new SupportError('message is empty')
  if (body.length > MAX_BODY) throw new SupportError(`message is longer than ${MAX_BODY} characters`)
  return body
}

function asMessage(row: typeof supportMessages.$inferSelect): SupportMessage {
  return { ...row, author: row.author === 'admin' ? 'admin' : 'user' }
}

export async function listThread(db: AnyDb, userId: string): Promise<SupportMessage[]> {
  const rows = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.userId, userId))
    .orderBy(asc(supportMessages.createdAt))
  return rows.map(asMessage)
}

export async function postMessage(
  db: AnyDb,
  input: { userId: string; author: Author; body: string; broadcastId?: string },
): Promise<SupportMessage> {
  const body = cleanBody(input.body)
  const [row] = await db
    .insert(supportMessages)
    .values({ userId: input.userId, author: input.author, body, broadcastId: input.broadcastId ?? null })
    .returning()
  return asMessage(row!)
}

/// Marks as read what `author` wrote in this thread: the user opening the chat
/// calls it with 'admin', the admin opening a thread with 'user'.
export async function markRead(db: AnyDb, userId: string, author: Author): Promise<void> {
  await db
    .update(supportMessages)
    .set({ readAt: new Date() })
    .where(and(eq(supportMessages.userId, userId), eq(supportMessages.author, author), isNull(supportMessages.readAt)))
}

/// Admin messages the user has not opened yet: the badge in the app.
export async function unreadFor(db: AnyDb, userId: string): Promise<number> {
  const rows = await db
    .select({ id: supportMessages.id })
    .from(supportMessages)
    .where(and(eq(supportMessages.userId, userId), eq(supportMessages.author, 'admin'), isNull(supportMessages.readAt)))
  return rows.length
}

export interface ThreadSummary {
  userId: string
  email: string | null
  language: string
  lastBody: string
  lastAuthor: Author
  lastAt: Date
  /// User messages the admin has not opened.
  unread: number
  total: number
}

export async function listThreads(db: AnyDb): Promise<ThreadSummary[]> {
  const rows = await db
    .select({ message: supportMessages, email: users.email, language: users.outputLanguage })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.userId))
    .orderBy(asc(supportMessages.createdAt))
  const threads = new Map<string, ThreadSummary>()
  for (const { message, email, language } of rows) {
    const m = asMessage(message)
    const thread = threads.get(m.userId) ?? {
      userId: m.userId,
      email,
      language,
      lastBody: m.body,
      lastAuthor: m.author,
      lastAt: m.createdAt,
      unread: 0,
      total: 0,
    }
    thread.lastBody = m.body
    thread.lastAuthor = m.author
    thread.lastAt = m.createdAt
    thread.total += 1
    if (m.author === 'user' && !m.readAt) thread.unread += 1
    threads.set(m.userId, thread)
  }
  return [...threads.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
}

export interface Recipient {
  userId: string
  email: string | null
  language: string
  /// Registered push devices. Zero means a feedback request will only be seen
  /// the next time this person opens the app.
  devices: number
}

export async function listRecipients(db: AnyDb): Promise<Recipient[]> {
  const people = await db
    .select({ userId: users.id, email: users.email, language: users.outputLanguage, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt))
  const tokens = await db.select({ userId: pushTokens.userId }).from(pushTokens)
  const devices = new Map<string, number>()
  for (const t of tokens) devices.set(t.userId, (devices.get(t.userId) ?? 0) + 1)
  return people.map((p) => ({ userId: p.userId, email: p.email, language: p.language, devices: devices.get(p.userId) ?? 0 }))
}

/// One feedback question to several threads. Ids that match no account are
/// dropped rather than failing the batch: the list comes from a page that may
/// have been open while an account was deleted.
export async function broadcast(
  db: AnyDb,
  input: { body: string; userIds: string[] | 'all' },
): Promise<{ broadcastId: string; userIds: string[] }> {
  const body = cleanBody(input.body)
  const targets =
    input.userIds === 'all'
      ? await db.select({ id: users.id }).from(users)
      : input.userIds.length === 0
        ? []
        : await db.select({ id: users.id }).from(users).where(inArray(users.id, input.userIds))
  if (targets.length === 0) throw new SupportError('no recipient')
  const broadcastId = crypto.randomUUID()
  await db.insert(supportMessages).values(targets.map((t) => ({ userId: t.id, author: 'admin', body, broadcastId })))
  return { broadcastId, userIds: targets.map((t) => t.id) }
}

export interface BroadcastStat {
  broadcastId: string
  body: string
  sentAt: Date
  sent: number
  /// Threads with at least one user message written after the question.
  replied: number
}

export async function broadcastStats(db: AnyDb): Promise<BroadcastStat[]> {
  const rows = await db.select().from(supportMessages).orderBy(asc(supportMessages.createdAt))
  const stats = new Map<string, BroadcastStat & { threads: Set<string> }>()
  for (const row of rows) {
    if (!row.broadcastId) continue
    const stat = stats.get(row.broadcastId) ?? {
      broadcastId: row.broadcastId,
      body: row.body,
      sentAt: row.createdAt,
      sent: 0,
      replied: 0,
      threads: new Set<string>(),
    }
    stat.sent += 1
    stat.threads.add(row.userId)
    stats.set(row.broadcastId, stat)
  }
  for (const stat of stats.values()) {
    const answered = new Set(
      rows
        .filter((r) => r.author === 'user' && stat.threads.has(r.userId) && r.createdAt > stat.sentAt)
        .map((r) => r.userId),
    )
    stat.replied = answered.size
  }
  return [...stats.values()]
    .map(({ threads: _threads, ...stat }) => stat)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
}
