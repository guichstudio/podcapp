# Freemium et abonnements — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trois paliers plafonnés (1 / 8 / 12 épisodes par mois) et deux
abonnements mensuels StoreKit 2, dont l'état vit sur le serveur pour que le cron
de 06:00 puisse refuser de dépenser.

**Architecture:** Le quota suit la discipline de `MIN_SOURCES_PER_EPISODE` — une
définition dans `src/jobs/quota.ts`, quatre points d'application, jamais de
recalcul côté client. L'entitlement n'est jamais lu sur l'appareil : tout JWS
venu du réseau est un ping non vérifié dont on n'extrait que
l'`originalTransactionId`, et l'état vient d'un appel TLS authentifié à l'App
Store Server API. `appAccountToken` lie l'achat au compte.

**Tech Stack:** TypeScript, Hono sur Vercel **edge**, Drizzle + Neon (HTTP) et
node-postgres, Trigger.dev, `jose`, SwiftUI + StoreKit 2.

**Spec:** `docs/superpowers/specs/2026-09-09-freemium-abonnements-design.md`
(commits `f0472e5` et `564e1ce`).

## Global Constraints

- **Règle de Louis, 2026-10-04 : aucun paywall tant que l'app n'est pas en ligne sur l'App Store.** Pendant la bêta TestFlight, `FREEMIUM_ENFORCED` reste non posé (aucune borne de palier) et l'écran d'achat n'est jamais présenté. Les tâches 7 et 8 (StoreKit, paywall) attendent la sortie publique, ou livrent le paywall caché derrière la même règle.

- **Worktree `~/Code/podcapp-appstore`, branche `appstore`. Jamais de commit sur `main`.** Jamais de `git add -A` ni `git add .` : stager les chemins qu'on a touchés.
- **Tests :** `pnpm test` (`tsx --test src/**/*.test.ts`, runner `node:test`). 152 tests passent aujourd'hui — le compte ne doit jamais baisser. Base de test : `createTestDb()` de `src/db/testDb.ts` (PGlite neuf par test).
- **`api/index.ts` déclare `export const config = { runtime: 'edge' }` (ligne 55).** Pas de `node:crypto` : ni `createSign`, ni `X509Certificate`, ni `Buffer`. Signature ES256 par `jose` (`importPKCS8` + `SignJWT`). **Ne jamais importer `src/push/apns.ts` depuis l'edge**, il tourne en Node sur Trigger.dev.
- **`pnpm dev` boote `src/api/index.ts`**, l'ancienne implémentation Node sans `/auth/*`. **Le flux d'abonnement ne s'exerce pas en local** : fonctions pures en test unitaire, bout en bout en sandbox contre le déploiement.
- **Deux entrypoints à tenir alignés :** `api/index.ts` (edge, déployé) et `src/api/index.ts` (Node, local). Toute règle de refus va dans les deux.
- **iOS :** les `.strings` se génèrent par `ios/design/make-strings.py` depuis `ios/design/fr-strings.json`. **Ne jamais éditer un `.strings` à la main.** L'anglais est la clé : chaque `Text("...")` du code EST la chaîne anglaise.
- **XcodeGen n'est pas installé.** Toute modification de cible doit être portée **à la fois** dans `ios/project.yml` et dans `ios/Podcapp.xcodeproj/project.pbxproj`, sinon la prochaine régénération l'annule en silence.
- **Bumper `CURRENT_PROJECT_VERSION`** (dans les deux fichiers) à chaque installation sur appareil — le numéro s'affiche en `b<N>` dans l'onboarding.
- Chaque échec écrit un statut et une raison lisibles. Aucun échec silencieux.
- Prompts : jamais édités en place. Aucun prompt n'est touché par ce plan, donc **aucun `pnpm eval:run` n'est requis**.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/db/migrations/0009_plans.sql` | 4 colonnes sur `users` + index unique partiel |
| `src/db/schema.ts` (modif) | déclaration Drizzle des 4 colonnes |
| `src/jobs/quota.ts` (créer) | **la** définition du quota : paliers, comptage, refus |
| `src/jobs/quota.test.ts` (créer) | frontières de mois, échec non consommant, run en vol |
| `src/config.ts` (modif) | `targetMinutesFor`, `voiceFor` prend le palier |
| `src/config.test.ts` (créer) | bornage longueur/voix par palier |
| `src/apple/appstore.ts` (créer) | client App Store Server API, edge-compatible |
| `src/apple/appstore.test.ts` (créer) | rattachement, vol d'abonnement, sandbox/prod |
| `api/index.ts` (modif) | 402 sur `/episodes`, `/sources` enrichi, `/me/subscription`, `/apple/notifications` |
| `src/api/index.ts` (modif) | même 402 sur `/episodes` |
| `src/trigger/tasks.ts` (modif) | skip lisible du cron `daily-briefings` (ligne 262) |
| `src/jobs/generateEpisode.ts` (modif) | refus dans le pipeline, avant rédacteur et TTS |
| `ios/Podcapp/Store.swift` (créer) | StoreKit 2 : produits, achat, restore, `Transaction.updates` |
| `ios/Podcapp/Screens/PaywallSheet.swift` (créer) | la feuille d'abonnement, un seul endroit |
| `ios/Podcapp.storekit` (créer) | achats en simulateur sans App Store Connect |

---

## Task 1 : Le quota, sa définition et ses tests

**Files:**
- Create: `src/db/migrations/0009_plans.sql`
- Modify: `src/db/schema.ts` (bloc `users`, après `targetMinutes`)
- Create: `src/jobs/quota.ts`
- Create: `src/jobs/quota.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` de `src/db/testDb.ts`, `episodes`/`users` de `src/db/schema.ts`.
- Produces: `type Plan = 'free' | 'plus' | 'pro'` ; `PLAN_EPISODE_LIMIT: Record<Plan, number>` ; `PLAN_MAX_MINUTES: Record<Plan, number>` ; `PLAN_CHOOSES_VOICE: Record<Plan, boolean>` ; `planOf(row: { plan: string; planExpiresAt: Date | null }, now?: Date): Plan` ; `countEpisodesThisMonth(db: AnyDb, userId: string, now?: Date): Promise<number>` ; `hasQuotaLeft(used: number, plan: Plan): boolean` ; `monthResetsAt(now?: Date): Date` ; `quotaMessage(language: string, plan: Plan): string`.

- [ ] **Step 1: Écrire la migration**

Créer `src/db/migrations/0009_plans.sql` :

```sql
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;
ALTER TABLE "users" ADD COLUMN "plan_expires_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "plan_original_txn_id" text;
ALTER TABLE "users" ADD COLUMN "plan_environment" text;
--> statement-breakpoint
-- Un abonnement ne peut appartenir qu'a un compte. L'index est PARTIEL parce
-- que la colonne est nulle pour tout compte gratuit, et que NULL ne collisionne
-- pas avec NULL en SQL mais l'index reste plus petit ainsi.
CREATE UNIQUE INDEX "users_one_account_per_subscription"
  ON "users" ("plan_original_txn_id")
  WHERE "plan_original_txn_id" IS NOT NULL;
```

Ajouter l'entrée correspondante dans `src/db/migrations/meta/_journal.json` en
copiant la forme de l'entrée `0008_push_tokens` (incrémenter `idx`, mettre
`tag: "0009_plans"`, `when` = `Date.now()` au moment de l'écriture).

- [ ] **Step 2: Déclarer les colonnes dans le schéma Drizzle**

Dans `src/db/schema.ts`, dans `pgTable('users', {...})`, juste après la ligne
`targetMinutes: integer('target_minutes').notNull().default(10),` :

```ts
  // Le palier d'abonnement. 'free' | 'plus' | 'pro' -- volontairement du texte
  // et pas un enum PG : ajouter un palier ne doit pas demander une migration de
  // type. La valeur est bornee a la LECTURE par planOf(), comme target_minutes.
  plan: text('plan').notNull().default('free'),
  // Null pour 'free'. Depasse => planOf() rend 'free' sans rien reecrire.
  planExpiresAt: timestamp('plan_expires_at', { withTimezone: true }),
  // L'originalTransactionId d'Apple : il survit aux renouvellements et c'est la
  // seule cle stable pour rapprocher une notification serveur d'une ligne.
  planOriginalTxnId: text('plan_original_txn_id'),
  // 'Production' | 'Sandbox'. Les deux espaces d'identifiants sont DISJOINTS :
  // sans ce champ, l'achat sandbox d'un relecteur peut entrer en collision avec
  // un achat reel.
  planEnvironment: text('plan_environment'),
```

Puis, dans le tableau de contraintes de `users` (créer le second argument de
`pgTable` s'il n'existe pas encore, sur le modèle de `episodes`) :

```ts
  (t) => [
    uniqueIndex('users_one_account_per_subscription')
      .on(t.planOriginalTxnId)
      .where(sql`plan_original_txn_id is not null`),
  ],
```

- [ ] **Step 3: Écrire les tests, qui doivent échouer**

Créer `src/jobs/quota.test.ts` :

```ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { episodes, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import {
  countEpisodesThisMonth,
  hasQuotaLeft,
  monthResetsAt,
  planOf,
  PLAN_EPISODE_LIMIT,
  quotaMessage,
} from './quota.js'

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db']) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(6).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

test('un palier expire retombe en gratuit sans rien reecrire', () => {
  const now = new Date('2026-09-15T00:00:00Z')
  assert.equal(planOf({ plan: 'pro', planExpiresAt: new Date('2026-09-20T00:00:00Z') }, now), 'pro')
  assert.equal(planOf({ plan: 'pro', planExpiresAt: new Date('2026-09-01T00:00:00Z') }, now), 'free')
  assert.equal(planOf({ plan: 'pro', planExpiresAt: null }, now), 'free')
  assert.equal(planOf({ plan: 'free', planExpiresAt: null }, now), 'free')
})

test('une valeur de palier inconnue en base vaut gratuit', () => {
  const now = new Date('2026-09-15T00:00:00Z')
  const far = new Date('2027-01-01T00:00:00Z')
  assert.equal(planOf({ plan: 'platinum', planExpiresAt: far }, now), 'free')
})

test('le quota compte les episodes prets et ceux en vol, jamais les echoues', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const now = new Date('2026-09-15T12:00:00Z')
    await db.insert(episodes).values([
      { userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-09-02T00:00:00Z') },
      { userId, targetSec: 180, status: 'failed', createdAt: new Date('2026-09-03T00:00:00Z') },
    ])
    assert.equal(await countEpisodesThisMonth(db, userId, now), 1)

    // Un run en vol occupe une place. Le meme insert ne peut pas cohabiter avec
    // un autre actif : l'index partiel episodes_one_active_per_user l'interdit.
    await db.insert(episodes).values({ userId, targetSec: 180, status: 'tts', createdAt: now })
    assert.equal(await countEpisodesThisMonth(db, userId, now), 2)
  } finally {
    await cleanup()
  }
})

test('le mois est calendaire UTC : le mois precedent ne compte pas', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    await db.insert(episodes).values([
      { userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-08-31T23:59:59Z') },
      { userId, targetSec: 180, status: 'ready', createdAt: new Date('2026-09-01T00:00:00Z') },
    ])
    assert.equal(await countEpisodesThisMonth(db, userId, new Date('2026-09-15T00:00:00Z')), 1)
  } finally {
    await cleanup()
  }
})

test('les episodes d un autre compte ne comptent pas', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const mine = await seedUser(db)
    const theirs = await seedUser(db)
    await db.insert(episodes).values({ userId: theirs, targetSec: 180, status: 'ready' })
    assert.equal(await countEpisodesThisMonth(db, mine, new Date()), 0)
  } finally {
    await cleanup()
  }
})

test('chaque palier refuse exactement a sa limite', () => {
  assert.equal(hasQuotaLeft(0, 'free'), true)
  assert.equal(hasQuotaLeft(1, 'free'), false)
  assert.equal(hasQuotaLeft(7, 'plus'), true)
  assert.equal(hasQuotaLeft(8, 'plus'), false)
  assert.equal(hasQuotaLeft(11, 'pro'), true)
  assert.equal(hasQuotaLeft(12, 'pro'), false)
  assert.deepEqual(PLAN_EPISODE_LIMIT, { free: 1, plus: 8, pro: 12 })
})

test('la remise a zero est le 1er du mois suivant, en UTC', () => {
  assert.equal(monthResetsAt(new Date('2026-09-15T12:00:00Z')).toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(monthResetsAt(new Date('2026-12-31T23:59:59Z')).toISOString(), '2027-01-01T00:00:00.000Z')
})

test('le refus est dans la langue de l utilisateur et nomme le palier', () => {
  assert.match(quotaMessage('fr', 'free'), /1 épisode/)
  assert.match(quotaMessage('en-US', 'plus'), /8 episodes/)
})
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './quota.js'`.

- [ ] **Step 5: Écrire `src/jobs/quota.ts`**

```ts
import { and, count, eq, gte, lt, ne } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { episodes } from '../db/schema.js'

// Meme contrainte de typage que src/jobs/material.ts : les jobs tournent sur
// node-postgres et la fonction edge sur Neon en HTTP. Les deux sont PgDatabase,
// et ceci est le seul helper que les deux appellent. Aucun import lourd ici.
type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type Plan = 'free' | 'plus' | 'pro'

// Les plafonds. Ils ne sont pas un choix de packaging : a ~0,55 EUR l'episode de
// 3 min et ~0,90 EUR celui de 5 min, de l'illimite a 9,99 / 19,99 perd de
// l'argent des qu'un abonne ecoute tous les jours -- et le produit EST un cron
// quotidien. 8 et 12 restent rentables meme a la commission de 30 %.
export const PLAN_EPISODE_LIMIT: Record<Plan, number> = { free: 1, plus: 8, pro: 12 }
export const PLAN_MAX_MINUTES: Record<Plan, number> = { free: 3, plus: 3, pro: 5 }
export const PLAN_CHOOSES_VOICE: Record<Plan, boolean> = { free: false, plus: false, pro: true }

const PLANS = new Set<string>(['free', 'plus', 'pro'])

/// Le palier REEL, borne a la lecture -- exactement comme MAX_TARGET_MINUTES
/// borne users.target_minutes sans jamais reecrire la colonne. Une ligne peut
/// dire 'pro' avec une echeance depassee : elle vaut alors 'free', et personne
/// n'a besoin d'un balayage pour la corriger. Une valeur inconnue vaut 'free' :
/// un palier qu'on ne connait pas ne peut pas etre un palier qui donne droit.
export function planOf(row: { plan: string; planExpiresAt: Date | null }, now: Date = new Date()): Plan {
  if (!PLANS.has(row.plan) || row.plan === 'free') return 'free'
  if (!row.planExpiresAt || row.planExpiresAt.getTime() <= now.getTime()) return 'free'
  return row.plan as Plan
}

export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function monthResetsAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/// Ce qui consomme le quota : les episodes du mois calendaire UTC qui ne sont
/// PAS 'failed'. Un episode echoue ne consomme rien -- c'est notre panne, pas
/// celle de l'utilisateur. Un run en vol occupe donc une place et la libere s'il
/// echoue : le compte est dynamique, et l'app le relit au lieu de le memoriser.
export async function countEpisodesThisMonth(db: AnyDb, userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(episodes)
    .where(
      and(
        eq(episodes.userId, userId),
        ne(episodes.status, 'failed'),
        gte(episodes.createdAt, monthStart(now)),
        lt(episodes.createdAt, monthResetsAt(now)),
      ),
    )
  return row?.n ?? 0
}

export function hasQuotaLeft(used: number, plan: Plan): boolean {
  return used < PLAN_EPISODE_LIMIT[plan]
}

/// Le refus, dans la langue de l'utilisateur : l'app l'affiche tel quel, comme
/// shortageMessage() de material.ts.
export function quotaMessage(language: string, plan: Plan): string {
  const limit = PLAN_EPISODE_LIMIT[plan]
  if (language.trim().toLowerCase().startsWith('fr')) {
    const s = limit > 1 ? 's' : ''
    return `Vous avez utilisé vos ${limit} épisode${s} de ce mois-ci. Le compteur repart le 1er.`
  }
  const s = limit > 1 ? 's' : ''
  return `You have used your ${limit} episode${s} this month. The counter resets on the 1st.`
}
```

- [ ] **Step 6: Lancer les tests**

Run: `pnpm test 2>&1 | tail -20`
Expected: PASS, et le total est passé de 152 à 160.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/0009_plans.sql src/db/migrations/meta/_journal.json src/db/schema.ts src/jobs/quota.ts src/jobs/quota.test.ts
git commit -m "quota: une seule definition des paliers et de leur plafond"
```

---

## Task 2 : Longueur et voix bornées par le palier

**Files:**
- Modify: `src/config.ts:139` (`voiceFor`), et ajout de `targetMinutesFor`
- Create: `src/config.test.ts`

**Interfaces:**
- Consumes: `Plan`, `PLAN_MAX_MINUTES`, `PLAN_CHOOSES_VOICE` de `src/jobs/quota.ts`.
- Produces: `targetMinutesFor(plan: Plan, requested: number | null | undefined, stored: number): number` ; `voiceFor(language: string, override: string | null | undefined, plan: Plan): string | undefined`.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

Créer `src/config.test.ts` :

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { targetMinutesFor, voiceFor } from './config.js'

test('le palier plafonne la duree, meme si la base dit plus', () => {
  assert.equal(targetMinutesFor('free', null, 10), 3)
  assert.equal(targetMinutesFor('plus', 5, 5), 3)
  assert.equal(targetMinutesFor('pro', 5, 5), 5)
  assert.equal(targetMinutesFor('pro', null, 10), 5) // MAX_TARGET_MINUTES
  assert.equal(targetMinutesFor('pro', 4, 5), 4)
})

test('une duree absurde est ramenee dans les bornes, jamais rejetee', () => {
  assert.equal(targetMinutesFor('pro', 0, 5), 1)
  assert.equal(targetMinutesFor('pro', -7, 5), 1)
  assert.equal(targetMinutesFor('pro', 99, 5), 5)
})

test('seul le palier pro choisit sa voix', () => {
  const nico = 'MAZdzkb78f8SA7DNBT41'
  const eric = 'cjVigY5qzO86Huf0OWal'
  assert.equal(voiceFor('en', nico, 'pro'), nico)
  // Un voice_id reste en base sur un compte redescendu : il est IGNORE, pas
  // efface, pour que le reabonnement retrouve le choix intact.
  assert.equal(voiceFor('en', nico, 'free'), eric)
  assert.equal(voiceFor('en', nico, 'plus'), eric)
  assert.equal(voiceFor('en', null, 'pro'), eric)
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test 2>&1 | tail -20`
Expected: FAIL — `targetMinutesFor is not a function`.

- [ ] **Step 3: Modifier `src/config.ts`**

Remplacer le corps de `voiceFor` (ligne 139) et ajouter `targetMinutesFor`
juste au-dessus :

```ts
/// La duree reelle, bornee a la LECTURE. Trois bornes se composent : ce que la
/// requete demande, ce que le palier autorise, et le plafond absolu du produit.
/// users.target_minutes garde son defaut de 10 en base et n'est jamais reecrit.
export function targetMinutesFor(plan: Plan, requested: number | null | undefined, stored: number): number {
  const asked = requested ?? stored
  return Math.min(MAX_TARGET_MINUTES, PLAN_MAX_MINUTES[plan], Math.max(1, Math.floor(asked)))
}

export function voiceFor(language: string, override: string | null | undefined, plan: Plan): string | undefined {
  // Le choix de voix est un droit du palier pro. Un voice_id ecrit du temps d'un
  // abonnement reste en base apres la retrogradation : il est ignore ici, pas
  // efface, pour que le reabonnement retrouve le choix intact.
  const chosen = PLAN_CHOOSES_VOICE[plan] ? override : null
  return chosen ?? DEFAULT_VOICES[language.trim().toLowerCase().slice(0, 2)] ?? process.env.ELEVENLABS_VOICE_ID
}
```

Et en tête de `src/config.ts`, ajouter l'import :

```ts
import { PLAN_CHOOSES_VOICE, PLAN_MAX_MINUTES, type Plan } from './jobs/quota.js'
```

- [ ] **Step 4: Réparer tous les appelants de `voiceFor`**

Run: `grep -rn "voiceFor(" src/ api/ --include="*.ts" | grep -v config.test`
Chaque appel prend un troisième argument. Là où le palier n'est pas encore
disponible dans la portée, charger la ligne `users` (`plan`, `planExpiresAt`) et
passer `planOf(user)`.

- [ ] **Step 5: Lancer les tests et la vérification de types**

Run: `pnpm test 2>&1 | tail -20 && npx tsc --noEmit`
Expected: PASS, 0 erreur TypeScript.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts src/jobs/ src/api/ api/
git commit -m "paliers: la duree et la voix se bornent a la lecture"
```

---

## Task 3 : Les quatre points d'application, et `GET /sources`

**Files:**
- Modify: `api/index.ts` (`POST /episodes` vers la ligne 621 ; `GET /sources` vers 1135 ; `GET /me` ligne 464)
- Modify: `src/api/index.ts` (`POST /episodes`)
- Modify: `src/trigger/tasks.ts` (cron `daily-briefings`, ligne 262)
- Modify: `src/jobs/generateEpisode.ts` (refus dans le pipeline)

**Interfaces:**
- Consumes: `planOf`, `countEpisodesThisMonth`, `hasQuotaLeft`, `quotaMessage`, `monthResetsAt`, `PLAN_EPISODE_LIMIT` de `src/jobs/quota.ts` ; `targetMinutesFor` de `src/config.ts`.
- Produces: réponse **402** de forme `{ error, plan, used, limit, resets_at }` ; `GET /sources` gagne `plan`, `used`, `limit`, `resets_at`.

- [ ] **Step 1: Ajouter le refus dans `POST /episodes` de `api/index.ts`**

Dans le `select` qui charge `user` (vers la ligne 638), ajouter les deux
colonnes du palier :

```ts
  const [user] = await conn
    .select({
      targetMinutes: users.targetMinutes,
      outputLanguage: users.outputLanguage,
      plan: users.plan,
      planExpiresAt: users.planExpiresAt,
      voiceId: users.voiceId,
    })
    .from(users)
    .where(eq(users.id, userId))
```

Puis, **juste après** le bloc de la règle des liens (après le `else { ... }` qui
se termine sur le 422) et **avant** la faucheuse de runs périmés :

```ts
  // Le quota, deuxieme rendez-vous apres la regle des liens. Code DISTINCT du
  // 422 : l'app doit pouvoir distinguer "pas assez de liens" de "plus de
  // quota", les deux ecrans ne sont pas les memes.
  const plan = planOf(user)
  const used = await countEpisodesThisMonth(conn, userId)
  if (!hasQuotaLeft(used, plan)) {
    return c.json(
      {
        error: quotaMessage(user.outputLanguage, plan),
        plan,
        used,
        limit: PLAN_EPISODE_LIMIT[plan],
        resets_at: monthResetsAt().toISOString(),
      },
      402,
    )
  }
```

Enfin, remplacer le calcul de `targetMin` (vers la ligne 693) :

```ts
  const targetMin = targetMinutesFor(plan, parsed.data.target_min, user.targetMinutes)
```

- [ ] **Step 2: Répéter dans `src/api/index.ts`**

Appliquer le même bloc de refus et le même `targetMinutesFor` dans le
`POST /episodes` de l'entrypoint Node. Les deux entrypoints ne doivent jamais
diverger sur une règle de refus.

Run: `grep -n "402\|targetMinutesFor" src/api/index.ts`
Expected: les deux apparaissent.

- [ ] **Step 3: Enrichir `GET /sources`**

Dans `api/index.ts`, `GET /sources` charge déjà les lignes. Ajouter avant le
`return c.json({...})` :

```ts
  const [planRow] = await conn
    .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
    .from(users)
    .where(eq(users.id, userId))
  const plan = planRow ? planOf(planRow) : 'free'
  const used = await countEpisodesThisMonth(conn, userId)
```

et dans l'objet retourné, à côté de `available` et `minimum` :

```ts
    plan,
    used,
    limit: PLAN_EPISODE_LIMIT[plan],
    resets_at: monthResetsAt().toISOString(),
```

- [ ] **Step 4: Le cron saute en le disant**

Dans `src/trigger/tasks.ts`, tâche `daily-briefings` : là où le skip actuel
compte les sources, ajouter avant la mise en file :

```ts
      const plan = planOf(u)
      const used = await countEpisodesThisMonth(db, u.id)
      if (!hasQuotaLeft(used, plan)) {
        logger.log('skipped: monthly quota spent', { userId: u.id, plan, used, limit: PLAN_EPISODE_LIMIT[plan] })
        continue
      }
```

Le `select` des utilisateurs doit désormais rapporter `plan` et `planExpiresAt`.

- [ ] **Step 4b: `GET /me` doit renvoyer l'`id` du compte**

Vérifié le 2026-09-09 : il ne le renvoie pas. Or `appAccountToken` (Task 5, 7)
exige que l'app connaisse l'UUID de son compte — sans lui, **tout achat sera
refusé en 403**. C'est une dépendance dure, pas une finition.

Dans `api/index.ts` ligne 464, ajouter `id: users.id` au `select`, et le
propager dans `meView` (`grep -n "function meView" -A 12 api/index.ts`) :

```ts
    .select({ id: users.id, outputLanguage: users.outputLanguage, voiceId: users.voiceId, targetMinutes: users.targetMinutes, rssToken: users.rssToken })
```

`meView` existe dans **les deux** entrypoints — `api/index.ts:443` et
`src/api/index.ts:472` — et les deux routes `/me` l'utilisent. Les deux doivent
gagner `id`, sinon l'app se comporte différemment selon l'entrypoint.

- [ ] **Step 5: Le pipeline refuse avant de payer**

Dans **`src/jobs/generateEpisode.ts`** (et non `src/trigger/tasks.ts`, qui ne
fait que l'appeler ligne 124), au même endroit que le refus existant sur les
sources — **avant** l'appel au rédacteur et au TTS :

```ts
  const plan = planOf(user)
  if (!hasQuotaLeft(await countEpisodesThisMonth(db, userId), plan)) {
    throw new Error(`monthly quota spent for plan ${plan}`)
  }
```

Ce quatrième point n'est pas redondant : c'est le seul qui protège la dépense
quand un run est déclenché autrement que par les trois autres.

- [ ] **Step 6: Vérifier**

Run: `pnpm test 2>&1 | tail -5 && npx tsc --noEmit && grep -c "countEpisodesThisMonth" api/index.ts src/api/index.ts src/trigger/tasks.ts`
Expected: tests PASS, 0 erreur TS, et les trois fichiers rapportent au moins 1.

- [ ] **Step 7: Commit**

```bash
git add api/index.ts src/api/index.ts src/trigger/tasks.ts
git commit -m "quota: les quatre points d'application, et le compteur dans /sources"
```

---

## Task 4 : Le client App Store Server API

**Files:**
- Create: `src/apple/appstore.ts`
- Create: `src/apple/appstore.test.ts`

**Interfaces:**
- Consumes: `jose` (`importPKCS8`, `SignJWT`) — **edge-compatible**, contrairement à `node:crypto`.
- Produces: `interface AppleSubscription { originalTransactionId: string; productId: string; bundleId: string; expiresDate: Date; appAccountToken: string | null; environment: 'Production' | 'Sandbox' }` ; `readOriginalTransactionId(jws: string): string | null` ; `createAppStoreClient(fetchImpl?: typeof fetch): { lookup(originalTransactionId: string): Promise<AppleSubscription | null> }`.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

Créer `src/apple/appstore.test.ts` :

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readOriginalTransactionId } from './appstore.js'

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url')

const fakeJws = (payload: unknown) =>
  `${b64url({ alg: 'ES256', x5c: ['nope'] })}.${b64url(payload)}.c2ln`

test('on ne lit que l identifiant de transaction, jamais l etat', () => {
  const jws = fakeJws({ originalTransactionId: '2000000901', productId: 'com.x.pro', expiresDate: 4102444800000 })
  assert.equal(readOriginalTransactionId(jws), '2000000901')
})

test('un JWS illisible ne jette pas, il rend null', () => {
  assert.equal(readOriginalTransactionId('pas-un-jws'), null)
  assert.equal(readOriginalTransactionId(''), null)
  assert.equal(readOriginalTransactionId('a.b'), null)
  assert.equal(readOriginalTransactionId(fakeJws({ productId: 'com.x.pro' })), null)
})

test('un identifiant qui n est pas une chaine de chiffres est refuse', () => {
  // Il part dans une URL vers Apple : rien d'autre que des chiffres n'y entre.
  assert.equal(readOriginalTransactionId(fakeJws({ originalTransactionId: '../../evil' })), null)
  assert.equal(readOriginalTransactionId(fakeJws({ originalTransactionId: 12345 })), null)
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './appstore.js'`.

- [ ] **Step 3: Écrire `src/apple/appstore.ts`**

```ts
import { importPKCS8, SignJWT } from 'jose'

// L'App Store Server API, parlee directement. Pas de SDK : c'est un GET signe
// par un JWT ES256, et jose fait les deux.
//
// jose et NON node:crypto, contrairement a src/push/apns.ts : ce fichier est
// importe par api/index.ts, qui declare `runtime: 'edge'`. createSign n'y
// existe pas.
//
// L'ANCRE DE CONFIANCE EST TLS, comme pour le JWKS d'Apple dans auth/verify.ts.
// Le JWS que presente l'app n'est jamais verifie : on n'en lit que
// l'originalTransactionId, et l'etat vient de la reponse d'Apple.

const HOSTS = {
  Production: 'https://api.storekit.itunes.apple.com',
  Sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
} as const

export type AppleEnvironment = keyof typeof HOSTS

export interface AppleSubscription {
  originalTransactionId: string
  productId: string
  bundleId: string
  expiresDate: Date
  appAccountToken: string | null
  environment: AppleEnvironment
}

const decodeSegment = (segment: string): Record<string, unknown> | null => {
  try {
    const json = atob(segment.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/// Le SEUL champ qu'on accepte de lire dans un JWS non verifie. Tout le reste
/// de la charge utile est ignore : un ping falsifie ne peut donc provoquer
/// qu'un appel HTTP vers Apple, jamais un changement d'etat.
///
/// Filtre en chiffres uniquement : cette valeur part dans un chemin d'URL.
export function readOriginalTransactionId(jws: string): string | null {
  const parts = jws.split('.')
  if (parts.length !== 3) return null
  const payload = decodeSegment(parts[1]!)
  const id = payload?.originalTransactionId
  if (typeof id !== 'string' || !/^[0-9]{1,32}$/.test(id)) return null
  return id
}

async function providerToken(): Promise<string> {
  const keyId = env('APPLE_IAP_KEY_ID')
  const issuer = env('APPLE_IAP_ISSUER_ID')
  const bundleId = env('APPLE_IAP_BUNDLE_ID')
  const key = await importPKCS8(decodePem(env('APPLE_IAP_KEY')), 'ES256')
  return new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('30m') // Apple refuse au-dela de 60 min
    .setAudience('appstoreconnect-v1')
    .sign(key)
}

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/// Le .p8 dans la forme ou il a survecu au copier-coller. Meme lecon que
/// decodeKey() de push/apns.ts : un champ de tableau de bord transforme les
/// sauts de ligne en espaces, et un PEM sans ses sauts de ligne n'est pas un
/// PEM. Le base64 du fichier entier est la voie documentee.
export function decodePem(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes('BEGIN')) {
    return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed
  }
  try {
    const decoded = atob(trimmed)
    if (decoded.includes('BEGIN')) return decoded
  } catch {
    // tombe sur la valeur brute, qui echouera bruyamment a la signature
  }
  return trimmed
}

export function createAppStoreClient(fetchImpl: typeof fetch = fetch) {
  async function on(environment: AppleEnvironment, id: string, token: string): Promise<AppleSubscription | null> {
    const res = await fetchImpl(`${HOSTS[environment]}/inApps/v1/subscriptions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // 4040010 = transaction id not found. C'est la reponse normale quand on
    // interroge le mauvais environnement, et la procedure d'Apple est
    // d'essayer la production d'abord, puis le sandbox.
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`app store server api ${res.status}`)

    const body = (await res.json()) as { data?: { lastTransactions?: { signedTransactionInfo?: string }[] }[] }
    const signed = body.data?.[0]?.lastTransactions?.[0]?.signedTransactionInfo
    if (!signed) return null
    // Cette charge utile arrive PAR TLS depuis Apple, pas par le reseau public :
    // c'est la seule qu'on lit en entier.
    const info = decodeSegment(signed.split('.')[1] ?? '')
    if (!info) return null

    const expires = info.expiresDate
    const token_ = info.appAccountToken
    return {
      originalTransactionId: id,
      productId: String(info.productId ?? ''),
      bundleId: String(info.bundleId ?? ''),
      expiresDate: new Date(typeof expires === 'number' ? expires : 0),
      appAccountToken: typeof token_ === 'string' ? token_ : null,
      environment,
    }
  }

  return {
    /// Production d'abord, sandbox ensuite : c'est aussi ce qui renseigne
    /// plan_environment, et les deux espaces d'identifiants sont disjoints.
    async lookup(originalTransactionId: string): Promise<AppleSubscription | null> {
      const token = await providerToken()
      return (
        (await on('Production', originalTransactionId, token)) ??
        (await on('Sandbox', originalTransactionId, token))
      )
    },
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apple/appstore.ts src/apple/appstore.test.ts
git commit -m "apple: client App Store Server API, signe par jose pour l'edge"
```

---

## Task 5 : Rattacher un abonnement à un compte — FAIT 2026-10-04

> **Écarts voulus.** (1) `entitledUntil` : le code ci-dessous écrivait `expiresDate` telle quelle, et `planOf` lit une date passée comme gratuit — l'abonné en grâce était déclaré pro puis lu gratuit ; un bail d'un jour est écrit quand l'échéance est passée. (2) Le type `LinkResult` disait `expired`, le code `not_entitled` : c'est `not_entitled`. (3) Une transaction déjà tenue par un autre compte rend `not_my_purchase` au lieu de lever sur l'index unique. (4) 503 lisible tant que `APPLE_IAP_KEY` n'est pas posée.

**Files:**
- Create: `src/apple/link.ts`
- Create: `src/apple/link.test.ts`
- Modify: `api/index.ts` (route `authed.post('/me/subscription')`)

**Interfaces:**
- Consumes: `AppleSubscription`, `createAppStoreClient`, `APPLE_SUBSCRIPTION_STATUS` de `src/apple/appstore.ts` ; `Plan` de `src/jobs/quota.ts`.
- Produces: `isEntitled(sub): boolean` dans `src/apple/appstore.ts` (voir Step 0) ; `PRODUCT_PLANS: Record<string, Plan>` ; `linkSubscription(db, userId, sub, now?): Promise<{ ok: true; plan: Plan } | { ok: false; reason: 'wrong_bundle' | 'unknown_product' | 'not_my_purchase' | 'not_entitled' }>`.

- [ ] **Step 0 : `isEntitled`, AVANT tout le reste — sinon on coupe des abonnés qui paient**

Trouvé par la revue de la Task 4, et c'est un piège à deux détentes.

**Pendant une période de grâce, `expiresDate` est DANS LE PASSÉ.** Apple laisse
l'abonné avoir droit au service pendant qu'il règle son incident de paiement
(statut 4, et le statut 3 peut le précéder). Donc les deux tests qu'on écrit
spontanément sont faux tous les deux :

- `status === 1` coupe les abonnés en grâce et en nouvelle tentative ;
- `expiresDate > now` les coupe aussi, puisque leur échéance est passée.

Et `status: null` — Apple n'a rien envoyé, ou a envoyé une valeur inconnue —
échoue également à `=== 1`, alors qu'il veut dire « on ne sait pas », jamais
« tout va bien ».

La règle s'écrit **une fois**, dans `src/apple/appstore.ts`, à côté de
`APPLE_SUBSCRIPTION_STATUS` — pas re-dérivée dans cette tâche puis dans la
Task 6 :

```ts
/// A-t-on le droit de servir cet abonnement ?
///
/// PAS `status === 1`, et PAS `expiresDate > now` : pendant une periode de
/// grace (4), et pendant une nouvelle tentative de paiement (3), Apple
/// considere l'abonne comme AYANT DROIT alors que son expiresDate est deja
/// DANS LE PASSE. Ecrire l'une ou l'autre de ces conditions coupe le service a
/// quelqu'un qui paie et dont le paiement vient d'echouer -- exactement la
/// personne qu'il ne faut pas braquer.
///
/// `null` veut dire "Apple n'a rien dit, ou a dit quelque chose qu'on ne
/// connait pas". Ce n'est pas un droit.
export function isEntitled(sub: AppleSubscription): boolean {
  return sub.status === APPLE_SUBSCRIPTION_STATUS.active
    || sub.status === APPLE_SUBSCRIPTION_STATUS.billingRetry
    || sub.status === APPLE_SUBSCRIPTION_STATUS.gracePeriod
}
```

Tests à ajouter dans `src/apple/appstore.test.ts` : les cinq statuts documentés,
`null`, et **le cas qui compte — statut 4 avec un `expiresDate` passé rend
`true`**.

Le champ `expiresDate` reste écrit en base pour l'affichage et pour le filet de
la Task 6 ; il ne décide plus, à lui seul, du droit.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

Créer `src/apple/link.test.ts` :

```ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import type { AppleSubscription } from './appstore.js'
import { linkSubscription } from './link.js'

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db']) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(6).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

const sub = (over: Partial<AppleSubscription> = {}): AppleSubscription => ({
  originalTransactionId: '2000000901',
  productId: 'com.louisguichard.podcapp.pro.monthly',
  bundleId: 'com.louisguichard.podcapp',
  expiresDate: new Date('2027-01-01T00:00:00Z'),
  appAccountToken: null,
  environment: 'Production',
  status: 1,
  ...over,
})

test('un achat marque a mon nom me donne mon palier', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const res = await linkSubscription(db, userId, sub({ appAccountToken: userId }))
    assert.deepEqual(res, { ok: true, plan: 'pro' })
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.plan, 'pro')
    assert.equal(row!.planOriginalTxnId, '2000000901')
    assert.equal(row!.planEnvironment, 'Production')
  } finally {
    await cleanup()
  }
})

test('LE VOL D ABONNEMENT : le jeton de compte d un autre est refuse', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const mine = await seedUser(db)
    const theirs = await seedUser(db)
    const res = await linkSubscription(db, mine, sub({ appAccountToken: theirs }))
    assert.deepEqual(res, { ok: false, reason: 'not_my_purchase' })
    const [row] = await db.select().from(users).where(eq(users.id, mine))
    assert.equal(row!.plan, 'free')
  } finally {
    await cleanup()
  }
})

test('un achat sans jeton de compte est refuse', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    assert.deepEqual(await linkSubscription(db, userId, sub({ appAccountToken: null })), {
      ok: false,
      reason: 'not_my_purchase',
    })
  } finally {
    await cleanup()
  }
})

test('un bundle etranger ou un produit inconnu sont refuses', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    assert.deepEqual(
      await linkSubscription(db, userId, sub({ appAccountToken: userId, bundleId: 'com.autre.app' })),
      { ok: false, reason: 'wrong_bundle' },
    )
    assert.deepEqual(
      await linkSubscription(db, userId, sub({ appAccountToken: userId, productId: 'com.louisguichard.podcapp.platinum' })),
      { ok: false, reason: 'unknown_product' },
    )
  } finally {
    await cleanup()
  }
})

test('un abonnement expire ne donne aucun palier', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const res = await linkSubscription(
      db,
      userId,
      sub({ appAccountToken: userId, status: 2, expiresDate: new Date('2026-01-01T00:00:00Z') }),
      new Date('2026-09-09T00:00:00Z'),
    )
    assert.deepEqual(res, { ok: false, reason: 'not_entitled' })
  } finally {
    await cleanup()
  }
})

test('UN ABONNE EN PERIODE DE GRACE GARDE SON PALIER, echeance passee comprise', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    // Statut 4 : Apple le considere comme ayant droit pendant qu'il regle son
    // incident de paiement, et son expiresDate est DEJA passe. Une comparaison
    // de dates lui couperait le service.
    const res = await linkSubscription(
      db,
      userId,
      sub({ appAccountToken: userId, status: 4, expiresDate: new Date('2026-09-01T00:00:00Z') }),
      new Date('2026-09-09T00:00:00Z'),
    )
    assert.deepEqual(res, { ok: true, plan: 'pro' })
  } finally {
    await cleanup()
  }
})

test('un abonnement rembourse ne donne aucun palier, meme avec une echeance future', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const res = await linkSubscription(db, userId, sub({ appAccountToken: userId, status: 5 }))
    assert.deepEqual(res, { ok: false, reason: 'not_entitled' })
  } finally {
    await cleanup()
  }
})

test('un abonnement deja rattache ailleurs ne peut pas etre revendique', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const first = await seedUser(db)
    const second = await seedUser(db)
    await linkSubscription(db, first, sub({ appAccountToken: first }))
    // Meme transaction, mais le jeton de compte designe le premier : refus.
    const res = await linkSubscription(db, second, sub({ appAccountToken: first }))
    assert.deepEqual(res, { ok: false, reason: 'not_my_purchase' })
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './link.js'`.

- [ ] **Step 3: Écrire `src/apple/link.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { users } from '../db/schema.js'
import type { Plan } from '../jobs/quota.js'
import type { AppleSubscription } from './appstore.js'

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export const APPLE_BUNDLE_ID = 'com.louisguichard.podcapp'

export const PRODUCT_PLANS: Record<string, Plan> = {
  'com.louisguichard.podcapp.plus.monthly': 'plus',
  'com.louisguichard.podcapp.pro.monthly': 'pro',
}

export type LinkResult =
  | { ok: true; plan: Plan }
  | { ok: false; reason: 'wrong_bundle' | 'unknown_product' | 'not_my_purchase' | 'expired' }

/// Rattache un abonnement lu chez Apple au compte authentifie.
///
/// La verification qui compte est `appAccountToken === userId`. Un JWS
/// parfaitement signe par Apple ne dit PAS qui le presente : sans ce controle,
/// quiconque connait l'originalTransactionId d'un tiers rattacherait
/// l'abonnement de ce tiers a son propre compte. appAccountToken est le
/// mecanisme prevu par Apple pour lier un achat a un compte applicatif, et
/// c'est un UUID -- donc users.id y entre tel quel.
export async function linkSubscription(
  db: AnyDb,
  userId: string,
  sub: AppleSubscription,
  now: Date = new Date(),
): Promise<LinkResult> {
  if (sub.bundleId !== APPLE_BUNDLE_ID) return { ok: false, reason: 'wrong_bundle' }
  const plan = PRODUCT_PLANS[sub.productId]
  if (!plan) return { ok: false, reason: 'unknown_product' }
  if (!sub.appAccountToken || sub.appAccountToken.toLowerCase() !== userId.toLowerCase()) {
    return { ok: false, reason: 'not_my_purchase' }
  }
  // isEntitled, PAS une comparaison de dates : pendant une periode de grace
  // l'abonne a droit au service alors que son expiresDate est deja passe.
  if (!isEntitled(sub)) return { ok: false, reason: 'not_entitled' }

  await db
    .update(users)
    .set({
      plan,
      planExpiresAt: sub.expiresDate,
      planOriginalTxnId: sub.originalTransactionId,
      planEnvironment: sub.environment,
    })
    .where(eq(users.id, userId))
  return { ok: true, plan }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Ajouter la route dans `api/index.ts`**

À placer parmi les autres routes `authed`, à côté de `authed.post('/me/push-token')` :

```ts
authed.post('/me/subscription', async (c) => {
  const body = await c.req.json().catch(() => null)
  const jws = (body as { signed_transaction?: unknown } | null)?.signed_transaction
  if (typeof jws !== 'string') return c.json({ error: 'expected { signed_transaction: string }' }, 400)

  // Ping non verifie : on n'en lit que l'identifiant. L'etat vient d'Apple.
  const id = readOriginalTransactionId(jws)
  if (!id) return c.json({ error: 'unreadable transaction' }, 400)

  const sub = await createAppStoreClient().lookup(id)
  if (!sub) return c.json({ error: 'unknown transaction' }, 404)

  const conn = c.get('conn')
  const result = await linkSubscription(conn, c.get('userId'), sub)
  if (!result.ok) {
    await conn.insert(events).values({
      userId: c.get('userId'),
      name: 'subscription_rejected',
      payload: { reason: result.reason, originalTransactionId: id },
    })
    // 403 et pas 400 : la requete est bien formee, c'est le droit qui manque.
    return c.json({ error: result.reason }, 403)
  }
  return c.json({ plan: result.plan, expires_at: sub.expiresDate.toISOString() })
})
```

**Il n'existe AUCUN helper `recordEvent` dans ce dépôt** — vérifié le
2026-09-09. `POST /ingest/email` écrit ses rejets par un `conn.insert(events)`
en ligne, dans une closure locale (`api/index.ts:262`). L'insert ci-dessus suit
cette forme exacte. `events` est déjà déstructuré depuis `schema` en tête de
fichier (`api/index.ts:58`), donc rien à importer.

- [ ] **Step 6: Vérifier**

Run: `pnpm test 2>&1 | tail -5 && npx tsc --noEmit`
Expected: PASS, 0 erreur TS.

- [ ] **Step 7: Commit**

```bash
git add src/apple/link.ts src/apple/link.test.ts api/index.ts
git commit -m "abonnements: appAccountToken ferme le vol d'abonnement"
```

---

## Task 6 : Le webhook des notifications, et le filet — FAIT 2026-10-04

> **Écarts voulus.** (1) `refreshByTransaction` décide avec `isEntitled`, pas avec `expiresDate <= now` (même piège que la Task 5, que l'étape 0 interdisait de re-dériver). (2) Le filet est écrit une fois, `planWithSafetyNet`, appelé par `POST /episodes` et le cron ; Apple injoignable → le palier payant est gardé pour cette fois. (3) Un échec de lecture chez Apple dans le webhook lève (500) pour qu'Apple rejoue ; seul un corps illisible répond 200.

**Files:**
- Modify: `api/index.ts` (route publique `app.post('/apple/notifications')`, **avant** `app.route('/', authed)`)
- Create: `src/apple/refresh.ts`
- Create: `src/apple/refresh.test.ts`

**Interfaces:**
- Consumes: `createAppStoreClient`, `readOriginalTransactionId` de `src/apple/appstore.ts` ; `PRODUCT_PLANS` de `src/apple/link.ts`.
- Produces: `refreshByTransaction(db, client, originalTransactionId, now?): Promise<'updated' | 'downgraded' | 'unknown'>`.

- [ ] **Step 1: Écrire le test, qui doit échouer**

Créer `src/apple/refresh.test.ts` :

```ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import type { AppleSubscription } from './appstore.js'
import { refreshByTransaction } from './refresh.js'

const clientReturning = (sub: AppleSubscription | null) => ({ lookup: async () => sub })

const seed = async (db: Awaited<ReturnType<typeof createTestDb>>['db'], over: Record<string, unknown> = {}) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(6).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
      ...over,
    })
    .returning({ id: users.id })
  return u!.id
}

const sub = (over: Partial<AppleSubscription> = {}): AppleSubscription => ({
  originalTransactionId: '2000000901',
  productId: 'com.louisguichard.podcapp.pro.monthly',
  bundleId: 'com.louisguichard.podcapp',
  expiresDate: new Date('2027-01-01T00:00:00Z'),
  appAccountToken: null,
  environment: 'Production',
  status: 1,
  ...over,
})

test('un renouvellement repousse l echeance sans que l app s ouvre', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2026-09-10T00:00:00Z') })
    const out = await refreshByTransaction(db, clientReturning(sub()), '2000000901')
    assert.equal(out, 'updated')
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.planExpiresAt!.toISOString(), '2027-01-01T00:00:00.000Z')
  } finally {
    await cleanup()
  }
})

test('un remboursement retombe en gratuit immediatement', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seed(db, { plan: 'pro', planOriginalTxnId: '2000000901', planExpiresAt: new Date('2027-01-01T00:00:00Z') })
    // Apple ne connait plus cette transaction : revocation.
    const out = await refreshByTransaction(db, clientReturning(null), '2000000901')
    assert.equal(out, 'downgraded')
    const [row] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(row!.plan, 'free')
    assert.equal(row!.planExpiresAt, null)
  } finally {
    await cleanup()
  }
})

test('une notification pour une transaction inconnue ne touche personne', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    await seed(db)
    assert.equal(await refreshByTransaction(db, clientReturning(sub()), '9999999999'), 'unknown')
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './refresh.js'`.

- [ ] **Step 3: Écrire `src/apple/refresh.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema.js'
import { users } from '../db/schema.js'
import type { AppleSubscription } from './appstore.js'
import { PRODUCT_PLANS } from './link.js'

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>
type Client = { lookup(id: string): Promise<AppleSubscription | null> }

/// Relit l'abonnement chez Apple et aligne la ligne dessus.
///
/// C'est la SEULE facon dont une notification agit : sa charge utile est un
/// ping non verifie, on n'en garde que l'identifiant. Tous les types --
/// DID_RENEW, EXPIRED, REFUND, REVOKE... -- prennent donc ce meme chemin, et il
/// n'y a aucune machine a etats par type de notification a maintenir.
export async function refreshByTransaction(
  db: AnyDb,
  client: Client,
  originalTransactionId: string,
  now: Date = new Date(),
): Promise<'updated' | 'downgraded' | 'unknown'> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.planOriginalTxnId, originalTransactionId))
  if (!row) return 'unknown'

  const sub = await client.lookup(originalTransactionId)
  const plan = sub ? PRODUCT_PLANS[sub.productId] : undefined
  if (!sub || !plan || sub.expiresDate.getTime() <= now.getTime()) {
    await db
      .update(users)
      .set({ plan: 'free', planExpiresAt: null })
      .where(eq(users.id, row.id))
    return 'downgraded'
  }

  await db
    .update(users)
    .set({ plan, planExpiresAt: sub.expiresDate, planEnvironment: sub.environment })
    .where(eq(users.id, row.id))
  return 'updated'
}
```

**Note :** `planOriginalTxnId` est délibérément **laissé en place** lors d'une
rétrogradation. C'est ce qui permet à un renouvellement tardif, ou à la levée
d'une période de grâce, de retrouver la ligne — et l'index unique partiel
continue d'empêcher un autre compte de la revendiquer.

- [ ] **Step 4: Ajouter la route publique dans `api/index.ts`**

À placer **avant** `app.route('/', authed)`, à côté de `app.post('/ingest/email')` —
sinon elle réclamerait un bearer, le piège déjà payé par `GET /privacy` :

```ts
// Le webhook des notifications serveur V2. Le secret dans l'URL n'est pas de
// l'authentification -- la charge utile n'est de toute facon jamais crue --
// c'est ce qui empeche un tiers de nous faire marteler l'API d'Apple depuis une
// URL devinee. Meme forme que POST /ingest/email pour Postmark.
app.post('/apple/notifications', async (c) => {
  const expected = process.env.APPLE_NOTIFICATIONS_TOKEN
  if (!expected || c.req.query('token') !== expected) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json().catch(() => null)
  const payload = (body as { signedPayload?: unknown } | null)?.signedPayload
  // 200 meme sur un corps illisible : jamais de 5xx a un webhook tiers, Apple
  // rejouerait pendant des jours. La trace part dans events.
  if (typeof payload !== 'string') return c.json({ ok: true })

  const conn = c.get('conn')
  const inner = readSignedTransactionFromNotification(payload)
  const id = inner ? readOriginalTransactionId(inner) : null
  if (!id) {
    await conn.insert(events).values({ userId: null, name: 'apple_notification_unreadable', payload: {} })
    return c.json({ ok: true })
  }

  const outcome = await refreshByTransaction(conn, createAppStoreClient(), id)
  if (outcome === 'unknown') {
    await conn.insert(events).values({
      userId: null,
      name: 'apple_notification_unknown_txn',
      payload: { originalTransactionId: id },
    })
  }
  return c.json({ ok: true })
})
```

Comme en Task 5 : **pas de helper `recordEvent`** dans ce dépôt, l'insert se
fait en ligne sur le modèle d'`api/index.ts:262`. `events` est déjà déstructuré
ligne 58.

**Attention à `c.get('conn')` sur une route PUBLIQUE.** `POST /ingest/email`,
qui est aussi publique, appelle `db()` directement (`api/index.ts:259`) et non
`c.get('conn')`, lequel est posé par le middleware d'authentification. Vérifier
lequel des deux est disponible ici avant d'écrire — se tromper donne un
`undefined` au premier appel réel, pas à la compilation.

et, dans `src/apple/appstore.ts`, la fonction d'extraction imbriquée (la
notification porte `data.signedTransactionInfo` **dans** son propre payload) :

```ts
/// La notification V2 emboite le JWS de la transaction dans son propre JWS.
export function readSignedTransactionFromNotification(signedPayload: string): string | null {
  const payload = decodeSegment(signedPayload.split('.')[1] ?? '')
  const signed = (payload?.data as { signedTransactionInfo?: unknown } | undefined)?.signedTransactionInfo
  return typeof signed === 'string' ? signed : null
}
```

- [ ] **Step 5: Le filet, dans `POST /episodes` et dans le cron**

Dans les deux, avant de calculer le palier : si la ligne dit un palier payant
mais que `planExpiresAt` est dépassé, **relire chez Apple** plutôt que de
dégrader sur la foi d'un webhook peut-être manqué.

```ts
  // Un abonne payant qui perd son palier parce qu'Apple a mal livre un webhook
  // est une panne inacceptable ; un appel HTTP avant une depense de 0,55 EUR ne
  // l'est pas.
  if (user.plan !== 'free' && user.planExpiresAt && user.planExpiresAt <= new Date() && user.planOriginalTxnId) {
    await refreshByTransaction(conn, createAppStoreClient(), user.planOriginalTxnId)
  }
```

Recharger la ligne `users` après cet appel, avant `planOf`.

- [ ] **Step 6: Vérifier**

Run: `pnpm test 2>&1 | tail -5 && npx tsc --noEmit`
Expected: PASS, 0 erreur TS.

- [ ] **Step 7: Commit**

```bash
git add src/apple/refresh.ts src/apple/refresh.test.ts src/apple/appstore.ts api/index.ts src/trigger/tasks.ts
git commit -m "abonnements: la notification est un ping, la verite vient d'Apple"
```

---

## Task 7 : StoreKit 2 dans l'app

**Files:**
- Create: `ios/Podcapp/Store.swift`
- Create: `ios/Podcapp.storekit`
- Modify: `ios/Podcapp/API.swift` (méthode `postSubscription`)
- Modify: `ios/project.yml` **et** `ios/Podcapp.xcodeproj/project.pbxproj` (bump `CURRENT_PROJECT_VERSION` 35 → 36)

**Interfaces:**
- Consumes: `API.shared` (motif des appels existants, cf. `registerPushToken`).
- Produces: `Store.shared` avec `products: [Product]`, `purchase(_ product: Product) async throws`, `restore() async`, `start()` (écoute `Transaction.updates`).

- [ ] **Step 1: Créer le fichier de configuration StoreKit**

Créer `ios/Podcapp.storekit` — c'est ce qui permet d'acheter **en simulateur,
sans aucun produit dans App Store Connect et sans contrat Paid Applications** :

```json
{
  "identifier": "podcapp",
  "nonRenewingSubscriptions": [],
  "products": [],
  "settings": { "_timeRate": 0 },
  "subscriptionGroups": [
    {
      "id": "podcapp",
      "name": "Podcapp",
      "subscriptions": [
        {
          "displayPrice": "9.99",
          "familyShareable": false,
          "groupNumber": 2,
          "internalID": "plusmonthly",
          "productID": "com.louisguichard.podcapp.plus.monthly",
          "recurringSubscriptionPeriod": "P1M",
          "referenceName": "Podcapp Plus"
        },
        {
          "displayPrice": "19.99",
          "familyShareable": false,
          "groupNumber": 1,
          "internalID": "promonthly",
          "productID": "com.louisguichard.podcapp.pro.monthly",
          "recurringSubscriptionPeriod": "P1M",
          "referenceName": "Podcapp Pro"
        }
      ]
    }
  ],
  "version": { "major": 3, "minor": 0 }
}
```

Puis, dans Xcode : *Product → Scheme → Edit Scheme → Run → Options →
StoreKit Configuration* → choisir `Podcapp.storekit`.

- [ ] **Step 2: Écrire `ios/Podcapp/Store.swift`**

```swift
import Foundation
import StoreKit

/// StoreKit 2, sans SDK tiers. L'app n'est jamais l'autorite sur le palier :
/// elle achete, elle envoie la transaction signee au serveur, et c'est le
/// serveur qui decide -- parce que le briefing de 06:00 se fabrique sans
/// qu'aucune app ne tourne, donc un droit lu sur l'appareil n'existe pas au
/// moment ou la depense est engagee.
@MainActor
final class Store: ObservableObject {
    static let shared = Store()

    static let productIDs = [
        "com.louisguichard.podcapp.plus.monthly",
        "com.louisguichard.podcapp.pro.monthly",
    ]

    @Published private(set) var products: [Product] = []
    @Published private(set) var lastError: String?

    private var updates: Task<Void, Never>?

    /// Ecoute les transactions qui arrivent HORS du flux d'achat : un
    /// renouvellement, un achat fait sur un autre appareil, ou une transaction
    /// qu'on n'avait pas pu confirmer au serveur la derniere fois.
    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.send(result)
            }
        }
        Task { await load() }
        Task { await syncCurrentEntitlements() }
    }

    func load() async {
        do {
            products = try await Product.products(for: Store.productIDs)
                .sorted { $0.price < $1.price }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func purchase(_ product: Product) async throws {
        // appAccountToken lie l'achat au compte : sans lui, le serveur refuse
        // en 403. C'est ce qui empeche quelqu'un de rattacher l'abonnement d'un
        // tiers au sien -- une transaction signee par Apple ne dit pas QUI la
        // presente.
        guard let account = Config.userID.flatMap(UUID.init(uuidString:)) else {
            throw StoreError.noAccount
        }
        let result = try await product.purchase(options: [.appAccountToken(account)])
        switch result {
        case .success(let verification):
            await send(verification)
        case .userCancelled, .pending:
            break
        @unknown default:
            break
        }
    }

    func restore() async {
        try? await AppStore.sync()
        await syncCurrentEntitlements()
    }

    private func syncCurrentEntitlements() async {
        for await result in Transaction.currentEntitlements {
            await send(result)
        }
    }

    /// La transaction n'est `finish()`-ee QU'APRES le 200 du serveur. Si le
    /// serveur est injoignable, elle reste en attente et StoreKit la represente
    /// au lancement suivant : personne ne paie sans obtenir son palier.
    private func send(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        do {
            try await API.shared.postSubscription(signed: result.jwsRepresentation)
            await transaction.finish()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    enum StoreError: LocalizedError {
        case noAccount
        var errorDescription: String? { String(localized: "Sign in before subscribing.") }
    }
}
```

**Prérequis, vérifié le 2026-09-09 : `Config.userID` N'EXISTE PAS.** Il faut
l'ajouter dans cette tâche, sinon `purchase()` jette `noAccount` et aucun achat
n'aboutit. Côté serveur, `GET /me` renvoie déjà `id` depuis la Task 3 step 4b.
Côté app :

- ajouter `id` à la structure qui décode `/me` dans `API.swift` ;
- dans `Shared.swift`, une propriété `Config.userID` (`String?`) stockée au même
  endroit que le jeton de session, écrite à chaque `GET /me` réussi ;
- l'effacer dans le même chemin que la déconnexion efface le jeton (`grep -n "signOut\|clearToken" ios/Podcapp/*.swift`).

- [ ] **Step 3: Ajouter `postSubscription` dans `API.swift`**

Sur le modèle exact de `registerPushToken` (le retrouver par
`grep -n "registerPushToken" -A 12 ios/Podcapp/API.swift`) :

```swift
    func postSubscription(signed: String) async throws {
        struct Body: Encodable { let signed_transaction: String }
        _ = try await request(method: "POST", path: "/me/subscription", body: Body(signed_transaction: signed))
    }
```

- [ ] **Step 4: Démarrer le Store au lancement**

Dans `ios/Podcapp/PodcappApp.swift`, là où `Push` est déjà branché, ajouter
`Store.shared.start()`.

- [ ] **Step 5: Bumper le numéro de build dans LES DEUX fichiers**

```bash
sed -i '' 's/CURRENT_PROJECT_VERSION: "35"/CURRENT_PROJECT_VERSION: "36"/' ios/project.yml
sed -i '' 's/CURRENT_PROJECT_VERSION = 35;/CURRENT_PROJECT_VERSION = 36;/g' ios/Podcapp.xcodeproj/project.pbxproj
grep -n "CURRENT_PROJECT_VERSION" ios/project.yml ios/Podcapp.xcodeproj/project.pbxproj
```

Expected: `36` partout. XcodeGen n'est pas installé : le `pbxproj` est ce qui
construit réellement, et `project.yml` doit rester d'accord avec lui.

- [ ] **Step 6: Compiler**

Run: `cd ios && xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphonesimulator -configuration Debug build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 7: Commit**

```bash
git add ios/Podcapp/Store.swift ios/Podcapp.storekit ios/Podcapp/API.swift ios/Podcapp/PodcappApp.swift ios/project.yml ios/Podcapp.xcodeproj/project.pbxproj
git commit -m "b36: StoreKit 2, et la transaction n'est finie qu'apres le 200 du serveur"
```

---

## Task 8 : Le paywall, aux trois endroits et nulle part ailleurs

**Files:**
- Create: `ios/Podcapp/Screens/PaywallSheet.swift`
- Modify: `ios/Podcapp/Screens/TodayView.swift` (carte Générer)
- Modify: `ios/Podcapp/Screens/SettingsView.swift` (durée, voix, Restore)
- Modify: `ios/design/fr-strings.json`, puis régénérer les `.strings`

**Interfaces:**
- Consumes: `Store.shared` ; les champs `plan`, `used`, `limit`, `resets_at` de `GET /sources` (Task 3).
- Produces: `PaywallSheet(reason: PaywallReason)` avec `enum PaywallReason { case quota, length, voice }`.

- [ ] **Step 1: Décoder les nouveaux champs de `GET /sources`**

Dans la structure Swift qui décode `/sources` (`grep -n "available\|minimum" ios/Podcapp/API.swift`),
ajouter `plan: String`, `used: Int`, `limit: Int`, `resetsAt: Date` — en
respectant la stratégie de clés déjà en place (`resets_at`).

- [ ] **Step 2: Écrire `PaywallSheet.swift`**

La feuille doit porter, **parce qu'Apple l'exige (3.1.2)** : nom, durée, prix par
période, mention de la reconduction automatique, et des liens vers les CGU et la
politique de confidentialité.

```swift
import StoreKit
import SwiftUI

enum PaywallReason { case quota, length, voice }

struct PaywallSheet: View {
    let reason: PaywallReason
    @StateObject private var store = Store.shared
    @Environment(\.dismiss) private var dismiss

    private var headline: Text {
        switch reason {
        case .quota:  return Text("You have used this month's briefings.")
        case .length: return Text("Longer briefings are part of Pro.")
        case .voice:  return Text("Choosing a voice is part of Pro.")
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headline.font(Typo.title)
                ForEach(store.products, id: \.id) { product in
                    Button { Task { try? await store.purchase(product); dismiss() } } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(product.displayName).font(Typo.body)
                            // Prix ET periode : afficher le prix seul est un
                            // motif de rejet sous 3.1.2.
                            Text("\(product.displayPrice) per month, renews automatically until cancelled.")
                                .font(Typo.caption)
                        }
                    }
                }
                Button { Task { await store.restore() } } label: { Text("Restore Purchases") }
                HStack(spacing: 12) {
                    Link(destination: URL(string: Config.siteURL + "terms/")!) { Text("Terms of Use") }
                    Link(destination: URL(string: Config.siteURL + "privacy/")!) { Text("Privacy Policy") }
                }
                if let error = store.lastError { Text(error).font(Typo.caption) }
            }
            .padding(20)
        }
        .task { await store.load() }
    }
}
```

Aligner `Typo.*`, les couleurs et le style des boutons sur
`ios/Podcapp/Design/Theme.swift` et `Components.swift` — ne pas inventer de style.

- [ ] **Step 3: Brancher les trois déclencheurs**

- `TodayView` : la carte Générer est déjà grisée sous le minimum de liens. Quand
  `used >= limit`, elle présente `PaywallSheet(reason: .quota)` au tap et affiche
  « N épisodes restants — remis à zéro le 1er ».
- `SettingsView`, sélecteur de durée : au-delà de 3 min sur un palier non-pro,
  `PaywallSheet(reason: .length)`.
- `SettingsView`, sélecteur de voix : sur un palier non-pro,
  `PaywallSheet(reason: .voice)`.
- `SettingsView` : une ligne **Restore Purchases** permanente, hors paywall.

- [ ] **Step 4: Traduire**

Ajouter chaque nouvelle chaîne anglaise dans `ios/design/fr-strings.json`, puis :

```bash
python3 ios/design/make-strings.py
git diff --stat ios/Podcapp/Resources ios/ShareExtension
```

Expected: les deux paires de `.strings` régénérées. **Ne jamais les éditer à la main.**

- [ ] **Step 5: Compiler et vérifier au simulateur**

```bash
cd ios && xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphonesimulator -configuration Debug build 2>&1 | tail -5
```

Puis lancer au simulateur avec la configuration StoreKit active et vérifier les
trois déclencheurs, plus un achat de bout en bout. **Piège connu :** lancer le
simulateur avec un VRAI jeton fait remonter la langue du simulateur au serveur
(`PUT /me/language`) et bascule le compte — utiliser un compte de test.

- [ ] **Step 6: Commit**

```bash
git add ios/Podcapp/Screens/PaywallSheet.swift ios/Podcapp/Screens/TodayView.swift ios/Podcapp/Screens/SettingsView.swift ios/Podcapp/API.swift ios/design/fr-strings.json ios/Podcapp/Resources ios/ShareExtension
git commit -m "paywall: trois declencheurs, un Restore, et le prix avec sa periode"
```

---

## Task 9 : Mesurer le coût réel, et refermer la boucle App Store

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-freemium-abonnements-design.md` (§1, si l'écart dépasse 20 %)
- Modify: `CLAUDE.md` (Current state + Decision log), `HANDOFF.md`

- [ ] **Step 1: Mesurer un épisode de 3 min et un de 5 min**

La spec §1 le demande explicitement : les 0,55 € et 0,90 € sont **déduits de
constantes, pas mesurés**, et ce sont eux qui décident des plafonds. Générer un
épisode de chaque longueur et lire le champ `cost` de la ligne `episodes` :

```bash
node -e "…" # ou : pnpm inspect episodes, puis lire episodes.cost
```

Si l'écart avec 0,55 / 0,90 dépasse **20 %**, corriger §1 de la spec **et
rouvrir les plafonds** avec Louis avant d'aller plus loin. Les plafonds ne sont
pas un choix de packaging : ils sortent de ces deux nombres.

- [ ] **Step 2: Les étapes humaines, que le code ne peut pas faire**

Aucune n'empêche ce qui précède ; toutes empêchent d'encaisser.

1. **Contrat Paid Applications** (coordonnées bancaires et fiscales). Sans lui,
   aucun abonnement ne peut être créé chez Apple.
2. **Statut de commerçant DSA** — repoussé le 2026-09-02 au motif qu'il ne
   conditionnait que l'UE. Des prix en euros font de l'UE le marché des
   testeurs : il redevient bloquant, et le désaccord d'entité noté ce jour-là
   (compte *louis guichard* à Lyon / justificatifs *guich, LLC*) doit être
   tranché avant.
3. **Apple Small Business Program** — 30 % → 15 % pour un formulaire.

- [ ] **Step 3: Créer les produits chez Apple**

Une fois le contrat actif :

```bash
export PATH="$HOME/.local/bin:$PATH"
asc subscriptions groups create --app 6807563809 --reference-name "Podcapp"
# puis une souscription par palier ; asc subscriptions --help porte la forme exacte
asc validate --app 6807563809 --version 1.0 --output table
```

- [ ] **Step 4: Réécrire les notes de review**

Elles décrivent aujourd'hui une app **sans abonnement**. Elles doivent :
décrire le parcours d'achat **sandbox** (gratuit pour le relecteur), dire que le
compte de démonstration part en gratuit à 1 épisode, et expliquer que le bouton
Générer grisé est le quota, pas une panne.

```bash
asc review details-update --id 213b898d-5e03-4b0d-92f8-89c24feac262 --notes "…"
```

- [ ] **Step 5: Mettre à jour la mémoire du projet**

`CLAUDE.md` : une entrée **Current state** pour cette session, et deux lignes au
**Decision log** — les plafonds et leur arithmétique ; l'ancre de confiance TLS
+ `appAccountToken` plutôt que la vérification de chaîne x5c, impossible sur
l'edge. `HANDOFF.md` : l'état, la prochaine action, les pièges.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md HANDOFF.md docs/superpowers/specs/
git commit -m "session: freemium livre, plafonds mesures, memoire a jour"
```

---

## Self-review

**Couverture de la spec.** §2 paliers → Tasks 1, 2 ; §3 base → Task 1 ; §4 quota
et quatre points → Tasks 1, 3 ; §5 bornage → Task 2 ; §6.0–6.1 → Tasks 4, 5 ;
§6.2 webhook → Task 6 ; §6.3 filet → Task 6 step 5 ; §6.4 edge → contrainte
globale ; §7 app → Tasks 7, 8 ; §8 App Review sandbox → Tasks 4 (`lookup`
production puis sandbox), 9 ; §9 pannes → couvertes par les tests des Tasks 5, 6
et le `finish()` différé de la Task 7 ; §10 étapes humaines → Task 9 ; §11 YAGNI
→ rien hors périmètre n'est planifié ; §12 tests → Tasks 1, 2, 4, 5, 6 ; §13
ordre → l'ordre des tâches.

**Trou trouvé et comblé :** la spec ne demandait nulle part de mesurer réellement
les deux coûts dont elle fait dépendre les plafonds. C'est la Task 9 step 1, avec
un seuil de révision explicite.

**Cohérence des types :** `Plan` est défini une fois dans `src/jobs/quota.ts` et
importé partout ; `planOf` prend `{ plan, planExpiresAt }` dans les six endroits
qui l'appellent ; `AppleSubscription` a la même forme dans `appstore.ts`,
`link.ts` et `refresh.ts` ; `voiceFor` prend trois arguments dans toutes les
tâches après la Task 2.
