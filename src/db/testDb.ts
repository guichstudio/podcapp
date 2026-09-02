import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, type Db } from './client.js'
import { migrate } from './migrate.js'

// Une base PGlite neuve par test : les tests d'authentification ecrivent des
// utilisateurs et des sessions, et un etat partage rendrait leur ordre
// significatif. DATABASE_URL est neutralise pour que createDb ne parte pas
// sur Neon quand la variable traine dans l'environnement du developpeur ; le
// try/finally la restaure meme si createDb ou migrate echoue, pour ne pas
// laisser le reste du process tourner sans DATABASE_URL.
export async function createTestDb(): Promise<{ db: Db; cleanup: () => Promise<void> }> {
  const previous = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    const dir = mkdtempSync(join(tmpdir(), 'podcapp-test-'))
    const db = await createDb({ pglitePath: dir })
    await migrate(db, { quiet: true })
    return {
      db,
      cleanup: async () => {
        rmSync(dir, { recursive: true, force: true })
      },
    }
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous
  }
}
