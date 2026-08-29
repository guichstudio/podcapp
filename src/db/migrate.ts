import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Db } from './client.js'

const MIGRATIONS_DIR = new URL('./migrations', import.meta.url).pathname

// Plain sequential runner over drizzle-kit's generated .sql files. Works on both
// drivers (node-postgres and PGlite); tracks applied files in _migrations.
export async function migrate(db: Db): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  )
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const f of files) {
    const done = await db.execute(sql`SELECT 1 FROM _migrations WHERE name = ${f}`)
    if (done.rows.length > 0) continue
    const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    for (const statement of body.split('--> statement-breakpoint')) {
      const s = statement.trim()
      if (s) await db.execute(sql.raw(s))
    }
    await db.execute(sql`INSERT INTO _migrations (name) VALUES (${f})`)
    console.log(`applied ${f}`)
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() as string)
if (isMain) {
  const db = await createDb()
  await migrate(db)
  console.log('migrations up to date')
  process.exit(0)
}
