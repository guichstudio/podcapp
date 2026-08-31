import { handle } from '@hono/node-server/vercel'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '../src/db/client.js'
import { sources, users } from '../src/db/schema.js'

// The only endpoint that has to be reachable from a phone: capture.
// It deliberately does NOT run processSource. Extraction and analysis take about
// a minute and belong to the batch run on the laptop, which also keeps the
// serverless bundle free of ffmpeg (78 MB) and the whole audio pipeline.
// A saved link must be recorded in a few hundred milliseconds and never lost.

const IngestSchema = z.union([
  z.object({ url: z.string().url() }),
  z.object({ text: z.string().min(1) }),
  z.object({ html: z.string().min(1), subject: z.string().optional() }),
])

const app = new Hono()
const db = await createDb()

app.get('/health', (c) => c.json({ ok: true }))

app.post('/ingest', async (c) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'missing bearer token' }, 401)
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.apiToken, token))
  if (!user) return c.json({ error: 'invalid token' }, 401)

  const parsed = IngestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'expected { url } | { text } | { html, subject }' }, 400)
  }
  const body = parsed.data
  const type = 'url' in body ? 'web' : 'html' in body ? 'email' : 'text'
  const [row] = await db
    .insert(sources)
    .values({
      userId: user.id,
      type,
      url: 'url' in body ? body.url : null,
      raw: 'url' in body ? null : body,
      // The real hash is computed from the extracted text; until then this only
      // has to be unique, since (user_id, source_hash) is a unique index.
      sourceHash: `pending-${crypto.randomUUID()}`,
      status: 'received',
    })
    .returning({ id: sources.id })
  if (!row) return c.json({ error: 'insert failed' }, 500)
  return c.json({ source_id: row.id, status: 'received' }, 202)
})

app.notFound((c) => c.json({ error: 'not found' }, 404))

export default handle(app)
