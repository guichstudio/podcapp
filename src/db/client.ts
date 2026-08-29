import { mkdirSync } from 'node:fs'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { PGlite } from '@electric-sql/pglite'
import { vector as pgliteVector } from '@electric-sql/pglite/vector'
import pg from 'pg'
import * as schema from './schema.js'

// Both drivers extend the same PgDatabase core; typing everything as the
// node-postgres flavor keeps one call signature across drivers.
export type Db = NodePgDatabase<typeof schema>

// DATABASE_URL set (Neon in prod) -> node-postgres. Otherwise an embedded PGlite
// database (file-backed), same schema, same pgvector operators. Local dev and the
// eval runner work with zero infrastructure; swapping to Neon is just the env var.
export async function createDb(opts?: { pglitePath?: string }): Promise<Db> {
  const url = process.env.DATABASE_URL
  if (url) {
    const pool = new pg.Pool({ connectionString: url })
    return drizzlePg(pool, { schema })
  }
  const path = opts?.pglitePath ?? '.data/pglite'
  mkdirSync(path, { recursive: true })
  const pglite = await PGlite.create(path, {
    extensions: { vector: pgliteVector },
  })
  await pglite.exec('CREATE EXTENSION IF NOT EXISTS vector;')
  return drizzlePglite(pglite, { schema }) as unknown as Db
}
