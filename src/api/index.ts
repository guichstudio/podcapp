import { serve } from '@hono/node-server'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDb, type Db } from '../db/client.js'
import { sources, stories, users } from '../db/schema.js'
import { processSource } from '../jobs/processSource.js'
import { logger } from '../log.js'

type Env = { Variables: { userId: string; db: Db } }

const db = await createDb()
const app = new Hono<Env>()

app.use('*', async (c, next) => {
  c.set('db', db)
  await next()
})

const authed = new Hono<Env>()
authed.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'missing bearer token' }, 401)
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.apiToken, token))
  if (!user) return c.json({ error: 'invalid token' }, 401)
  c.set('userId', user.id)
  await next()
})

authed.post('/ingest', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { url?: string; text?: string; html?: string; subject?: string } | null
  if (!body || (!body.url && !body.text && !body.html)) {
    return c.json({ error: 'expected { url } | { text } | { html, subject }' }, 400)
  }
  const type = body.url ? 'web' : body.html ? 'email' : 'text'
  const [row] = await db
    .insert(sources)
    .values({
      userId: c.get('userId'),
      type,
      url: body.url ?? null,
      raw: body.url ? null : body,
      sourceHash: `pending-${crypto.randomUUID()}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)
  // Local async processing; moves to a Trigger.dev task once TRIGGER_SECRET_KEY exists.
  void processSource(db, row.id).catch((e) => logger.error({ sourceId: row.id, err: String(e) }, 'processSource failed'))
  return c.json({ source_id: row.id }, 202)
})

authed.get('/sources/:id', async (c) => {
  const [s] = await db.select().from(sources).where(eq(sources.id, c.req.param('id')))
  if (!s || s.userId !== c.get('userId')) return c.json({ error: 'not found' }, 404)
  return c.json({ ...s, embedding: undefined, cleanText: s.cleanText?.slice(0, 1000) })
})

authed.get('/stories', async (c) => {
  const all = await db.select().from(stories).where(eq(stories.userId, c.get('userId'))).orderBy(desc(stories.lastSeenAt))
  return c.json(all.map((s) => ({ ...s, embedding: undefined })))
})

app.route('/', authed)
app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => logger.info({ port }, 'api listening'))
