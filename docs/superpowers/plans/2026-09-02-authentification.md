# Authentification Apple et Google — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la saisie manuelle d'un jeton d'API par Sign in with Apple et une connexion Google, pour qu'un testeur crée son compte seul.

**Architecture:** Trois rôles aujourd'hui confondus dans `users.api_token` se séparent : `identities` porte l'identité chez un fournisseur, `sessions` porte un jeton opaque par appareil, `users` reste le compte. Le serveur vérifie le JWT du fournisseur contre son JWKS puis émet un jeton de session, déposé dans le conteneur App Group là où le jeton d'API vivait — ce qui laisse l'extension de partage inchangée.

**Tech Stack:** TypeScript, Hono sur Vercel Edge, Drizzle + Neon (PGlite en local et en test), `jose` pour la vérification JWT, SwiftUI + AuthenticationServices côté iOS.

**Spec:** [docs/superpowers/specs/2026-09-02-authentification-design.md](../specs/2026-09-02-authentification-design.md)

## Global Constraints

- **La fonction Edge doit rester légère.** `api/index.ts` porte un commentaire explicite : le bundle ne doit contenir ni ffmpeg ni le pipeline audio. Tout module sous `src/auth/` ne peut importer que `jose`, `drizzle-orm`, `zod` et `src/db/schema.js`. **Jamais `src/db/client.js`** (il tire `pg` et PGlite). Le précédent à suivre est `src/jobs/material.ts`, qui prend une base en paramètre typée `AnyDb`.
- **Les prompts sont des actifs versionnés** : aucun n'est touché ici. `pnpm eval:run` n'a rien à comparer.
- **Les portes sont `pnpm test` et `pnpm exec tsc --noEmit`.** Les deux doivent passer avant chaque commit.
- **`ios/project.yml` génère les deux `Info.plist` et les entitlements.** Une édition manuelle d'un `Info.plist` disparaît à la régénération. Tout passe par le yaml, puis `xcodegen generate --spec project.yml`.
- **XcodeGen n'est pas installé durablement** : le binaire est à `/tmp/xcodegen/xcodegen/bin/xcodegen` (vidé au redémarrage ; le retélécharger depuis les releases GitHub si absent).
- **Localisation iOS** : toute chaîne nouvelle passe par `ios/design/fr-strings.json` puis `python3 ios/design/make-strings.py`. SwiftUI ne localise que `Text("…")` ; un `String` passé à un helper doit être enveloppé dans `String(localized:)`.
- **`CURRENT_PROJECT_VERSION` dans `ios/project.yml`** s'incrémente à chaque installation sur un appareil ou envoi TestFlight.
- **Déploiement** : Vercel construit depuis GitHub, donc commit + push **avant** `pnpm exec vercel deploy --prod --yes`. Aucun changement ici sous `src/jobs`, `src/trigger` ou `src/prompts`, donc pas de redéploiement Trigger.dev.
- **Il n'existe pas de cible de tests iOS** dans `ios/project.yml`. Les tâches iOS se vérifient par compilation et par exécution au simulateur, pas par tests unitaires — les étapes le disent explicitement plutôt que d'inventer un harnais.
- **Valeurs exactes** : bundle id `com.louisguichard.podcapp`, App Group `group.com.louisguichard.podcapp`, équipe `V7BMDJS5C7`, API de production `https://podcapp.vercel.app`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/db/schema.ts` *(modifié)* | Ajoute `identities` et `sessions` ; `users.email` devient nullable |
| `src/db/migrations/0005_*.sql` *(généré)* | La migration correspondante |
| `src/auth/types.ts` *(créé)* | `Provider`, `VerifiedIdentity`, `AuthError`, `AnyDb` |
| `src/auth/verify.ts` *(créé)* | Vérifie un JWT Apple ou Google. Le seul endroit où une erreur donne le compte d'un autre |
| `src/auth/verify.test.ts` *(créé)* | Signature, `iss`, `aud`, `exp`, `nonce`, confusion d'algorithme |
| `src/auth/identity.ts` *(créé)* | Résout une identité vérifiée vers un `user_id` : trouve, rattache ou crée |
| `src/auth/identity.test.ts` *(créé)* | Règle de rattachement, dont le refus des adresses relais |
| `src/auth/session.ts` *(créé)* | Émet, résout, liste et révoque les jetons de session |
| `src/auth/session.test.ts` *(créé)* | Révocation, isolation entre appareils, throttle de `last_seen_at` |
| `src/db/testDb.ts` *(créé)* | Base PGlite jetable + migrations, pour les tests |
| `api/index.ts` *(modifié)* | `/auth/apple`, `/auth/google`, `/me/sessions`, middleware |
| `src/config.ts` *(modifié)* | `APPLE_AUDIENCE`, `GOOGLE_CLIENT_ID` |
| `ios/Podcapp/Auth.swift` *(créé)* | Flux Apple et Google côté app, échange PKCE |
| `ios/Podcapp/Shared.swift` *(modifié)* | `apiToken` devient `sessionToken`, même emplacement App Group |
| `ios/Podcapp/Screens/OnboardingView.swift` *(modifié)* | Le champ jeton devient deux boutons |
| `ios/Podcapp/Screens/SettingsView.swift` *(modifié)* | Section « Appareils connectés », déconnexion |
| `ios/project.yml` *(modifié)* | Entitlement Sign in with Apple, schéma d'URL Google |
| `ios/Podcapp/PrivacyInfo.xcprivacy`, `ios/ShareExtension/PrivacyInfo.xcprivacy` *(modifiés)* | Ajout de l'adresse e-mail |

---

### Task 1 : Schéma et migration

**Files:**
- Modify: `src/db/schema.ts` (bloc `users`, lignes 33-42)
- Create: `src/db/migrations/0005_*.sql` (généré par drizzle-kit)
- Create: `src/db/testDb.ts`

**Interfaces:**
- Consumes: rien.
- Produces: les tables `identities` et `sessions` exportées depuis `src/db/schema.js` ; `createTestDb(): Promise<{ db: Db; cleanup: () => Promise<void> }>` depuis `src/db/testDb.js`.

- [ ] **Step 1 : Rendre `users.email` nullable et ajouter les deux tables**

Dans `src/db/schema.ts`, remplacer la ligne `email` de `users` :

```ts
  // Nullable depuis l'arrivee de Sign in with Apple : Apple peut n'envoyer
  // aucune adresse si l'utilisateur la masque et qu'aucun relais n'est cree.
  email: text('email').unique(),
```

Puis ajouter après le bloc `users` :

```ts
export const identities = pgTable(
  'identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'apple' | 'google'
    provider: text('provider').notNull(),
    // Le claim `sub` du fournisseur : stable, opaque, propre a notre app.
    subject: text('subject').notNull(),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ providerSubject: unique('identities_provider_subject').on(t.provider, t.subject) }),
)

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').unique().notNull(),
  deviceName: text('device_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})
```

Ajouter `boolean` à la liste d'imports depuis `drizzle-orm/pg-core` en tête de fichier.

- [ ] **Step 2 : Générer la migration**

Run: `pnpm db:generate`
Expected: un fichier `src/db/migrations/0005_<nom>.sql` apparaît, contenant `CREATE TABLE "identities"`, `CREATE TABLE "sessions"` et `ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`.

Le lire et vérifier ces trois éléments avant de continuer. Si `ALTER COLUMN` manque, drizzle-kit a proposé un `DROP`/`ADD` destructeur : corriger le `.sql` à la main pour n'avoir qu'un `DROP NOT NULL`.

- [ ] **Step 3 : Écrire le helper de base jetable**

Create `src/db/testDb.ts` :

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, type Db } from './client.js'
import { migrate } from './migrate.js'

// Une base PGlite neuve par test : les tests d'authentification ecrivent des
// utilisateurs et des sessions, et un etat partage rendrait leur ordre
// significatif. DATABASE_URL est neutralise pour que createDb ne parte pas
// sur Neon quand la variable traine dans l'environnement du developpeur.
export async function createTestDb(): Promise<{ db: Db; cleanup: () => Promise<void> }> {
  const previous = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  const dir = mkdtempSync(join(tmpdir(), 'podcapp-test-'))
  const db = await createDb({ pglitePath: dir })
  await migrate(db)
  if (previous !== undefined) process.env.DATABASE_URL = previous
  return {
    db,
    cleanup: async () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
```

- [ ] **Step 4 : Vérifier que le helper démarre**

Create `src/db/testDb.test.ts` :

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from './testDb.js'

test('a fresh test database has the auth tables', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const r = await db.execute(sql`SELECT to_regclass('identities') AS a, to_regclass('sessions') AS b`)
    assert.equal(r.rows[0]?.a, 'identities')
    assert.equal(r.rows[0]?.b, 'sessions')
  } finally {
    await cleanup()
  }
})
```

Run: `pnpm exec tsx --test src/db/testDb.test.ts`
Expected: PASS.

- [ ] **Step 5 : Portes et commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: les deux passent.

```bash
git add src/db/schema.ts src/db/migrations src/db/testDb.ts src/db/testDb.test.ts
git commit -m "identities and sessions, and a throwaway database to test them"
```

---

### Task 2 : Vérification des jetons Apple et Google

C'est le seul endroit du projet où un bug donne accès au compte d'un autre. Il s'écrit en TDD strict : chaque cas de rejet a son test, écrit avant le code.

**Files:**
- Create: `src/auth/types.ts`
- Create: `src/auth/verify.ts`
- Create: `src/auth/verify.test.ts`
- Modify: `src/config.ts`
- Modify: `package.json` (ajout de `jose`)

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type Provider = 'apple' | 'google'`
  - `type VerifiedIdentity = { provider: Provider; subject: string; email: string | null; emailVerified: boolean }`
  - `class AuthError extends Error { constructor(message: string) }`
  - `createVerifier(keyFor?: (p: Provider) => JWTVerifyGetKey): (input: { provider: Provider; token: string; rawNonce: string }) => Promise<VerifiedIdentity>`
  - `const verifyIdentityToken` — le vérificateur par défaut, câblé sur les JWKS distants.

- [ ] **Step 1 : Installer `jose` et déclarer les audiences**

Run: `pnpm add jose`

Dans `src/config.ts`, ajouter :

```ts
// Le `aud` que doit porter un jeton Apple : notre bundle id, pas un id client.
export const APPLE_AUDIENCE = 'com.louisguichard.podcapp'
// L'id client OAuth iOS du projet Google Cloud. Sans lui, /auth/google refuse.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
```

- [ ] **Step 2 : Écrire les types**

Create `src/auth/types.ts` :

```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../db/schema.js'

// Les jobs tournent sur node-postgres, la fonction Edge sur Neon en HTTP : les
// deux sont des PgDatabase. Meme motif que src/jobs/material.ts, pour que ce
// module reste importable depuis le bundle Edge.
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type Provider = 'apple' | 'google'

export type VerifiedIdentity = {
  provider: Provider
  subject: string
  email: string | null
  emailVerified: boolean
}

// Une seule classe d'erreur, sans detail expose : le client apprend que le
// jeton est refuse, pas pourquoi.
export class AuthError extends Error {}
```

- [ ] **Step 3 : Écrire les tests de vérification, avant le code**

Create `src/auth/verify.test.ts` :

```ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from 'jose'
import { APPLE_AUDIENCE } from '../config.js'
import { createVerifier } from './verify.js'
import { AuthError, type Provider } from './types.js'

const RAW_NONCE = 'un-alea-tire-par-lapp'
const hashed = (n: string) => createHash('sha256').update(n).digest('hex')

const keys = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256' }
const localKeys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] })
const verify = createVerifier(() => localKeys)

// Un jeton Apple conforme, dont chaque test degrade une seule propriete.
async function appleToken(over: Record<string, unknown> = {}, exp = '5m') {
  return new SignJWT({
    sub: 'apple-subject-1',
    email: 'louis@example.com',
    email_verified: true,
    nonce: hashed(RAW_NONCE),
    ...over,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(keys.privateKey)
}

const rejects = (p: Promise<unknown>) => assert.rejects(p, AuthError)

test('a well-formed Apple token is accepted', async () => {
  const id = await verify({ provider: 'apple', token: await appleToken(), rawNonce: RAW_NONCE })
  assert.deepEqual(id, {
    provider: 'apple' satisfies Provider,
    subject: 'apple-subject-1',
    email: 'louis@example.com',
    emailVerified: true,
  })
})

test('an expired token is rejected', async () => {
  await rejects(verify({ provider: 'apple', token: await appleToken({}, '-1s'), rawNonce: RAW_NONCE }))
})

test('a token minted for another app is rejected', async () => {
  const token = await new SignJWT({ sub: 'x', nonce: hashed(RAW_NONCE) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://appleid.apple.com')
    .setAudience('com.someone.else')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
  await rejects(verify({ provider: 'apple', token, rawNonce: RAW_NONCE }))
})

test('an unexpected issuer is rejected', async () => {
  const token = await new SignJWT({ sub: 'x', nonce: hashed(RAW_NONCE) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://evil.example.com')
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
  await rejects(verify({ provider: 'apple', token, rawNonce: RAW_NONCE }))
})

test('a tampered signature is rejected', async () => {
  const token = await appleToken()
  const [h, p] = token.split('.')
  await rejects(verify({ provider: 'apple', token: `${h}.${p}.AAAA`, rawNonce: RAW_NONCE }))
})

test('an unsigned token is rejected', async () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = `${b64({ alg: 'none' })}.${b64({
    sub: 'x',
    iss: 'https://appleid.apple.com',
    aud: APPLE_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: hashed(RAW_NONCE),
  })}.`
  await rejects(verify({ provider: 'apple', token, rawNonce: RAW_NONCE }))
})

test('a replayed token with the wrong nonce is rejected', async () => {
  await rejects(verify({ provider: 'apple', token: await appleToken(), rawNonce: 'un-autre-alea' }))
})

test('a token carrying no nonce is rejected', async () => {
  await rejects(verify({ provider: 'apple', token: await appleToken({ nonce: undefined }), rawNonce: RAW_NONCE }))
})

test('an unverified email is reported as unverified', async () => {
  const id = await verify({
    provider: 'apple',
    token: await appleToken({ email_verified: 'false' }),
    rawNonce: RAW_NONCE,
  })
  assert.equal(id.emailVerified, false)
})

test('a token without an email yields a null email', async () => {
  const id = await verify({ provider: 'apple', token: await appleToken({ email: undefined }), rawNonce: RAW_NONCE })
  assert.equal(id.email, null)
  assert.equal(id.emailVerified, false)
})
```

- [ ] **Step 4 : Lancer les tests pour les voir échouer**

Run: `pnpm exec tsx --test src/auth/verify.test.ts`
Expected: FAIL — `Cannot find module './verify.js'`.

- [ ] **Step 5 : Écrire la vérification**

Create `src/auth/verify.ts` :

```ts
import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { APPLE_AUDIENCE, GOOGLE_CLIENT_ID } from '../config.js'
import { AuthError, type Provider, type VerifiedIdentity } from './types.js'

// Apple accepte un seul issuer ; Google en a historiquement deux, et refuser
// la forme sans schema ferait echouer des jetons parfaitement valides.
const RULES: Record<Provider, { jwks: string; issuers: string[]; audience: () => string }> = {
  apple: {
    jwks: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audience: () => APPLE_AUDIENCE,
  },
  google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audience: () => GOOGLE_CLIENT_ID,
  },
}

// createRemoteJWKSet garde les cles en cache et suit leur rotation ; une
// instance par fournisseur, creee une fois, pour ne pas retelecharger le JWKS
// a chaque connexion.
const remote = new Map<Provider, JWTVerifyGetKey>()
const remoteKeyFor = (p: Provider): JWTVerifyGetKey => {
  const cached = remote.get(p)
  if (cached) return cached
  const set = createRemoteJWKSet(new URL(RULES[p].jwks))
  remote.set(p, set)
  return set
}

// `email_verified` arrive tantot en booleen, tantot en chaine selon le
// fournisseur et le moment : les deux formes vraies sont acceptees, tout le
// reste vaut faux.
const isTrue = (v: unknown): boolean => v === true || v === 'true'

export function createVerifier(keyFor: (p: Provider) => JWTVerifyGetKey = remoteKeyFor) {
  return async function verify(input: {
    provider: Provider
    token: string
    rawNonce: string
  }): Promise<VerifiedIdentity> {
    const rule = RULES[input.provider]
    const audience = rule.audience()
    if (!audience) throw new AuthError(`no audience configured for ${input.provider}`)

    let payload: Record<string, unknown>
    try {
      // algorithms est explicite : sans lui, un jeton `alg: none` ou signe avec
      // un algorithme symetrique pourrait passer.
      const result = await jwtVerify(input.token, keyFor(input.provider), {
        issuer: rule.issuers,
        audience,
        algorithms: ['RS256'],
      })
      payload = result.payload as Record<string, unknown>
    } catch {
      throw new AuthError('token rejected')
    }

    const expected = createHash('sha256').update(input.rawNonce).digest('hex')
    if (typeof payload.nonce !== 'string' || payload.nonce !== expected) {
      throw new AuthError('nonce mismatch')
    }

    const subject = payload.sub
    if (typeof subject !== 'string' || subject.length === 0) throw new AuthError('no subject')

    const email = typeof payload.email === 'string' ? payload.email : null
    return {
      provider: input.provider,
      subject,
      email,
      // Une adresse absente ne peut pas etre verifiee, quoi que dise le claim.
      emailVerified: email !== null && isTrue(payload.email_verified),
    }
  }
}

export const verifyIdentityToken = createVerifier()
```

- [ ] **Step 6 : Lancer les tests pour les voir passer**

Run: `pnpm exec tsx --test src/auth/verify.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7 : Portes et commit**

Run: `pnpm exec tsc --noEmit && pnpm test`

```bash
git add src/auth/types.ts src/auth/verify.ts src/auth/verify.test.ts src/config.ts package.json pnpm-lock.yaml
git commit -m "verify Apple and Google identity tokens, with a test per way to forge one"
```

---

### Task 3 : Résolution d'identité

**Files:**
- Create: `src/auth/identity.ts`
- Create: `src/auth/identity.test.ts`

**Interfaces:**
- Consumes: `VerifiedIdentity`, `AnyDb`, `AuthError` depuis `./types.js`.
- Produces:
  - `const PRIVATE_RELAY_SUFFIX = '@privaterelay.appleid.com'`
  - `isMergeable(email: string | null, verified: boolean): boolean`
  - `resolveUserId(db: AnyDb, identity: VerifiedIdentity): Promise<string>`

- [ ] **Step 1 : Écrire les tests, avant le code**

Create `src/auth/identity.test.ts` :

```ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { identities, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { isMergeable, resolveUserId } from './identity.js'
import type { VerifiedIdentity } from './types.js'

const apple = (over: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  provider: 'apple',
  subject: 'apple-1',
  email: 'louis@example.com',
  emailVerified: true,
  ...over,
})

const google = (over: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  provider: 'google',
  subject: 'google-1',
  email: 'louis@example.com',
  emailVerified: true,
  ...over,
})

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db'], email: string | null) => {
  const [u] = await db
    .insert(users)
    .values({
      email,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

test('a private relay address never merges', () => {
  assert.equal(isMergeable('abc@privaterelay.appleid.com', true), false)
  assert.equal(isMergeable('ABC@PrivateRelay.AppleID.com', true), false)
})

test('an unverified or absent address never merges', () => {
  assert.equal(isMergeable('louis@example.com', false), false)
  assert.equal(isMergeable(null, true), false)
})

test('a verified ordinary address merges', () => {
  assert.equal(isMergeable('louis@example.com', true), true)
})

test('a first sign-in creates the account and its identity', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await resolveUserId(db, apple())
    const rows = await db.select().from(identities).where(eq(identities.userId, userId))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.provider, 'apple')
    assert.equal(rows[0]?.subject, 'apple-1')
  } finally {
    await cleanup()
  }
})

test('signing in again returns the same account and creates no duplicate', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const first = await resolveUserId(db, apple())
    const second = await resolveUserId(db, apple())
    assert.equal(first, second)
    assert.equal((await db.select().from(identities)).length, 1)
    assert.equal((await db.select().from(users)).length, 1)
  } finally {
    await cleanup()
  }
})

test('Google attaches to the existing account when the verified email matches', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const appleUser = await resolveUserId(db, apple())
    const googleUser = await resolveUserId(db, google())
    assert.equal(googleUser, appleUser, 'the same person must not get two accounts')
    assert.equal((await db.select().from(identities)).length, 2)
  } finally {
    await cleanup()
  }
})

test('a private relay address does not attach to a matching account', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const existing = await seedUser(db, 'relay@privaterelay.appleid.com')
    const resolved = await resolveUserId(db, apple({ email: 'relay@privaterelay.appleid.com' }))
    assert.notEqual(resolved, existing, 'a relay address proves nothing about identity')
  } finally {
    await cleanup()
  }
})

test('an unverified email does not attach to a matching account', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const existing = await seedUser(db, 'louis@example.com')
    const resolved = await resolveUserId(db, google({ emailVerified: false }))
    assert.notEqual(resolved, existing)
  } finally {
    await cleanup()
  }
})

test('an account created without an email is still usable', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await resolveUserId(db, apple({ email: null, emailVerified: false }))
    const [u] = await db.select().from(users).where(eq(users.id, userId))
    assert.equal(u?.email, null)
    assert.ok(u?.rssToken, 'a feed token is minted whether or not an email exists')
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2 : Lancer les tests pour les voir échouer**

Run: `pnpm exec tsx --test src/auth/identity.test.ts`
Expected: FAIL — `Cannot find module './identity.js'`.

- [ ] **Step 3 : Écrire la résolution**

Create `src/auth/identity.ts` :

```ts
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { identities, users } from '../db/schema.js'
import type { AnyDb, VerifiedIdentity } from './types.js'

// Apple fabrique ces adresses par app et par utilisateur : deux d'entre elles
// ne peuvent pas designer la meme personne chez deux fournisseurs, et une
// egalite fortuite ne prouverait rien. Elles ne rattachent donc jamais.
export const PRIVATE_RELAY_SUFFIX = '@privaterelay.appleid.com'

export function isMergeable(email: string | null, verified: boolean): boolean {
  if (!email || !verified) return false
  return !email.toLowerCase().endsWith(PRIVATE_RELAY_SUFFIX)
}

const token = () => randomBytes(32).toString('base64url')

/// Trouve, rattache ou cree. Renvoie l'id du compte a qui appartient l'identite.
export async function resolveUserId(db: AnyDb, identity: VerifiedIdentity): Promise<string> {
  // 1. L'identite est deja connue : c'est ce compte, sans autre question.
  const [known] = await db
    .select({ userId: identities.userId })
    .from(identities)
    .where(and(eq(identities.provider, identity.provider), eq(identities.subject, identity.subject)))
  if (known) return known.userId

  // 2. Une adresse verifiee et non-relais qui correspond a un compte existant
  //    rattache la nouvelle identite plutot que de dedoubler la personne.
  let userId: string | undefined
  if (isMergeable(identity.email, identity.emailVerified)) {
    const [match] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, identity.email as string))
    userId = match?.id
  }

  // 3. Sinon, un compte neuf. Le jeton RSS est tire ici : un compte sans flux
  //    ne pourrait pas recevoir d'episode.
  if (!userId) {
    const [created] = await db
      .insert(users)
      .values({ email: identity.email, apiToken: token(), rssToken: token() })
      .returning({ id: users.id })
    if (!created) throw new Error('could not create the account')
    userId = created.id
  }

  await db.insert(identities).values({
    userId,
    provider: identity.provider,
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
  })
  return userId
}
```

- [ ] **Step 4 : Lancer les tests pour les voir passer**

Run: `pnpm exec tsx --test src/auth/identity.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5 : Portes et commit**

Run: `pnpm exec tsc --noEmit && pnpm test`

```bash
git add src/auth/identity.ts src/auth/identity.test.ts
git commit -m "resolve an identity to an account, and never merge on a relay address"
```

---

### Task 4 : Sessions par appareil

**Files:**
- Create: `src/auth/session.ts`
- Create: `src/auth/session.test.ts`

**Interfaces:**
- Consumes: `AnyDb` depuis `./types.js`.
- Produces:
  - `createSession(db: AnyDb, userId: string, deviceName: string): Promise<string>` — renvoie le jeton
  - `userIdForToken(db: AnyDb, token: string): Promise<string | null>`
  - `listSessions(db: AnyDb, userId: string): Promise<{ id: string; deviceName: string; createdAt: Date; lastSeenAt: Date }[]>`
  - `revokeSession(db: AnyDb, userId: string, sessionId: string): Promise<boolean>`
  - `const LAST_SEEN_THROTTLE_MS = 3_600_000`

- [ ] **Step 1 : Écrire les tests, avant le code**

Create `src/auth/session.test.ts` :

```ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { sessions, users } from '../db/schema.js'
import { createTestDb } from '../db/testDb.js'
import { createSession, listSessions, revokeSession, userIdForToken } from './session.js'

const seedUser = async (db: Awaited<ReturnType<typeof createTestDb>>['db']) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `${randomBytes(4).toString('hex')}@example.com`,
      apiToken: randomBytes(16).toString('hex'),
      rssToken: randomBytes(16).toString('hex'),
    })
    .returning({ id: users.id })
  return u!.id
}

test('a fresh session authenticates its user', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    assert.ok(token.length >= 40, 'the token must not be guessable')
    assert.equal(await userIdForToken(db, token), userId)
  } finally {
    await cleanup()
  }
})

test('an unknown token authenticates nobody', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    assert.equal(await userIdForToken(db, 'nope'), null)
  } finally {
    await cleanup()
  }
})

test('a revoked session stops authenticating', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, token))
    assert.equal(await revokeSession(db, userId, row!.id), true)
    assert.equal(await userIdForToken(db, token), null)
  } finally {
    await cleanup()
  }
})

test('revoking one device leaves the others signed in', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const phone = await createSession(db, userId, 'iPhone')
    const pad = await createSession(db, userId, 'iPad')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, phone))
    await revokeSession(db, userId, row!.id)
    assert.equal(await userIdForToken(db, phone), null)
    assert.equal(await userIdForToken(db, pad), userId, 'the iPad must survive')
  } finally {
    await cleanup()
  }
})

test('a user cannot revoke a session that is not theirs', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const mine = await seedUser(db)
    const theirs = await seedUser(db)
    const token = await createSession(db, theirs, 'iPhone')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, token))
    assert.equal(await revokeSession(db, mine, row!.id), false)
    assert.equal(await userIdForToken(db, token), theirs, 'the victim stays signed in')
  } finally {
    await cleanup()
  }
})

test('the device list shows only the live sessions of that user', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const other = await seedUser(db)
    await createSession(db, userId, 'iPhone')
    const pad = await createSession(db, userId, 'iPad')
    await createSession(db, other, 'Intruder')
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.token, pad))
    await revokeSession(db, userId, row!.id)
    const listed = await listSessions(db, userId)
    assert.deepEqual(
      listed.map((s) => s.deviceName),
      ['iPhone'],
    )
  } finally {
    await cleanup()
  }
})

test('last_seen_at is not rewritten on every call', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    await userIdForToken(db, token)
    const [first] = await db.select({ at: sessions.lastSeenAt }).from(sessions).where(eq(sessions.token, token))
    await userIdForToken(db, token)
    const [second] = await db.select({ at: sessions.lastSeenAt }).from(sessions).where(eq(sessions.token, token))
    assert.equal(first!.at.getTime(), second!.at.getTime(), 'a write per request would cost latency for nothing')
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2 : Lancer les tests pour les voir échouer**

Run: `pnpm exec tsx --test src/auth/session.test.ts`
Expected: FAIL — `Cannot find module './session.js'`.

- [ ] **Step 3 : Écrire les sessions**

Create `src/auth/session.ts` :

```ts
import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { sessions } from '../db/schema.js'
import type { AnyDb } from './types.js'

// Une ecriture par requete sur Neon en HTTP coute une latence reelle, pour une
// precision dont personne ne se sert : `last_seen_at` n'est rafraichi que si sa
// valeur date de plus d'une heure.
export const LAST_SEEN_THROTTLE_MS = 3_600_000

export async function createSession(db: AnyDb, userId: string, deviceName: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.insert(sessions).values({ userId, token, deviceName })
  return token
}

export async function userIdForToken(db: AnyDb, token: string): Promise<string | null> {
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
  return row.userId
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
```

- [ ] **Step 4 : Lancer les tests pour les voir passer**

Run: `pnpm exec tsx --test src/auth/session.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5 : Étendre la suppression de compte**

`src/jobs/deleteAccount.ts` supprime chaque table enfant explicitement avant le
parent (« Children before the parent »). Les clés étrangères de la tâche 1
portent `onDelete: 'cascade'`, donc Postgres nettoierait de lui-même — mais
laisser deux tables implicites au milieu d'un fichier où tout le reste est
explicite est une incohérence qui se paiera. Ajouter dans `deleteAccount`, juste
avant `await db.delete(users)` :

```ts
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await db.delete(identities).where(eq(identities.userId, userId))
```

et compléter l'import : `import { episodes, events, explainedConcepts, identities, sessions, sources, stories, users } from '../db/schema.js'`.

- [ ] **Step 6 : Tester que la suppression emporte bien les sessions**

Ajouter à `src/auth/session.test.ts` :

```ts
test('deleting the account destroys its sessions', async () => {
  const { db, cleanup } = await createTestDb()
  try {
    const userId = await seedUser(db)
    const token = await createSession(db, userId, 'iPhone')
    await db.delete(sessions).where(eq(sessions.userId, userId))
    await db.delete(users).where(eq(users.id, userId))
    assert.equal(await userIdForToken(db, token), null, 'a deleted account must not keep authenticating')
  } finally {
    await cleanup()
  }
})
```

Run: `pnpm exec tsx --test src/auth/session.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7 : Portes et commit**

Run: `pnpm exec tsc --noEmit && pnpm test`

```bash
git add src/auth/session.ts src/auth/session.test.ts src/jobs/deleteAccount.ts
git commit -m "one revocable session per device, and account deletion takes them with it"
```

---

### Task 5 : Endpoints et middleware

**Files:**
- Modify: `api/index.ts` (middleware lignes 249-258 ; nouveaux endpoints)

**Interfaces:**
- Consumes: `verifyIdentityToken`, `resolveUserId`, `createSession`, `userIdForToken`, `listSessions`, `revokeSession`, `AuthError`.
- Produces: `POST /auth/apple`, `POST /auth/google`, `GET /me/sessions`, `DELETE /me/sessions/:id`.

- [ ] **Step 1 : Ajouter les imports et le schéma de requête**

Dans `api/index.ts`, après les imports existants :

```ts
import { resolveUserId } from '../src/auth/identity.js'
import { createSession, listSessions, revokeSession, userIdForToken } from '../src/auth/session.js'
import { AuthError, type Provider } from '../src/auth/types.js'
import { verifyIdentityToken } from '../src/auth/verify.js'
```

Puis, près des autres schémas zod :

```ts
const SignInSchema = z.object({
  token: z.string().min(1),
  // L'alea brut : le serveur en recalcule l'empreinte et la compare au claim
  // `nonce` du jeton. C'est ce qui rend un jeton intercepte inutilisable.
  nonce: z.string().min(8),
  device_name: z.string().trim().min(1).max(64).default('iPhone'),
})
```

- [ ] **Step 2 : Écrire les deux endpoints de connexion**

Avant `authed.use('*')` — ils doivent rester **hors** du middleware authentifié :

```ts
// Publics par necessite : c'est ici qu'on obtient le jeton que le middleware
// exigera partout ailleurs.
async function signIn(c: Parameters<Parameters<typeof app.post>[1]>[0], provider: Provider) {
  const parsed = SignInSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'expected { token, nonce, device_name? }' }, 400)
  const conn = db()
  try {
    const identity = await verifyIdentityToken({ provider, token: parsed.data.token, rawNonce: parsed.data.nonce })
    const userId = await resolveUserId(conn, identity)
    const token = await createSession(conn, userId, parsed.data.device_name)
    return c.json({ token }, 200)
  } catch (err) {
    // Un jeton refuse et une panne de base ne se repondent pas pareil : le
    // premier est la faute du client, le second la notre.
    if (err instanceof AuthError) return c.json({ error: 'sign-in rejected' }, 401)
    throw err
  }
}

app.post('/auth/apple', (c) => signIn(c, 'apple'))
app.post('/auth/google', (c) => signIn(c, 'google'))
```

- [ ] **Step 3 : Basculer le middleware sur les sessions**

Remplacer le corps de `authed.use('*', …)` (lignes 249-258) par :

```ts
authed.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return c.json({ error: 'missing bearer token' }, 401)
  const conn = db()
  // La session d'abord : c'est la porte de l'app. api_token n'est plus qu'une
  // cle de service pour la CLI et l'eval, jamais ecrite ni lue par l'app.
  let userId = await userIdForToken(conn, token)
  if (!userId) {
    const [service] = await conn.select({ id: users.id }).from(users).where(eq(users.apiToken, token))
    userId = service?.id ?? null
  }
  if (!userId) return c.json({ error: 'invalid token' }, 401)
  c.set('conn', conn)
  c.set('userId', userId)
  await next()
})
```

- [ ] **Step 4 : Ajouter la gestion des appareils**

Après `authed.put('/me', …)` :

```ts
authed.get('/me/sessions', async (c) => {
  const rows = await listSessions(c.get('conn'), c.get('userId'))
  return c.json({
    sessions: rows.map((s) => ({
      id: s.id,
      device_name: s.deviceName,
      created_at: s.createdAt,
      last_seen_at: s.lastSeenAt,
    })),
  })
})

authed.delete('/me/sessions/:id', async (c) => {
  const id = c.req.param('id')
  // Meme 404 qu'un id etranger : le demandeur n'apprend rien de la forme d'un id.
  if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404)
  const done = await revokeSession(c.get('conn'), c.get('userId'), id)
  if (!done) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})
```

- [ ] **Step 5 : Vérifier la compilation et l'absence de dépendance lourde**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `grep -rn "from '\.\./src/db/client" api/index.ts`
Expected: aucune ligne. La fonction Edge ne doit pas tirer `pg` ni PGlite.

- [ ] **Step 6 : Vérifier le rejet à la main, en local**

Run: `pnpm dev` dans un terminal, puis :

```bash
curl -s -X POST http://localhost:8787/auth/apple -H 'Content-Type: application/json' -d '{"token":"pas-un-jwt","nonce":"douze-caracteres"}'
```
Expected: `{"error":"sign-in rejected"}` avec un statut 401 — jamais 500, jamais une trace.

- [ ] **Step 7 : Portes et commit**

Run: `pnpm test && pnpm exec tsc --noEmit`

```bash
git add api/index.ts
git commit -m "sign-in endpoints, and the middleware moves from account tokens to sessions"
```

---

### Task 6 : iOS — Sign in with Apple

**Files:**
- Modify: `ios/project.yml` (entitlements)
- Create: `ios/Podcapp/Auth.swift`
- Modify: `ios/Podcapp/Shared.swift` (lignes 34-38)
- Modify: `ios/Podcapp/Screens/OnboardingView.swift` (lignes 114-280)
- Modify: `ios/design/fr-strings.json`

**Interfaces:**
- Consumes: `POST /auth/apple { token, nonce, device_name }` → `{ token }`.
- Produces: `Config.sessionToken` (String, App Group) ; `Auth.signInWithApple() async throws -> String`.

- [ ] **Step 1 : Déclarer la capacité dans le yaml**

Dans `ios/project.yml`, sur la cible `Podcapp`, ajouter à ses entitlements :

```yaml
        com.apple.developer.applesignin:
          - Default
```

Puis régénérer :

Run: `cd ios && /tmp/xcodegen/xcodegen/bin/xcodegen generate --spec project.yml`
Expected: `Created project at …/Podcapp.xcodeproj`.

Vérifier que l'entitlement est bien dans le fichier généré :

Run: `grep -A2 applesignin ios/Podcapp/Podcapp.entitlements`
Expected: la clé apparaît.

- [ ] **Step 2 : Renommer le jeton stocké**

Dans `ios/Podcapp/Shared.swift`, remplacer `apiToken` par :

```swift
    // Le jeton de session emis par /auth/apple ou /auth/google. Il occupe la
    // place ou vivait le jeton d'API : l'extension de partage lit cette meme
    // case et n'a donc pas eu a changer.
    static var sessionToken: String {
        get { store.string(forKey: "apiToken") ?? "" }
        set { store.set(newValue, forKey: "apiToken") }
    }

    static var isConfigured: Bool { !sessionToken.isEmpty }
```

La **clé de stockage reste `"apiToken"`** : la changer déconnecterait silencieusement l'extension de partage sur les installations existantes.

Run: `grep -rn "Config.apiToken" ios/`
Expected: lister tous les appels restants et les remplacer par `Config.sessionToken`.

- [ ] **Step 3 : Écrire le flux Apple**

Create `ios/Podcapp/Auth.swift` :

```swift
import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

enum AuthError: LocalizedError {
    case cancelled
    case noToken
    case server(String)

    var errorDescription: String? {
        switch self {
        case .cancelled: return String(localized: "Sign-in cancelled.")
        case .noToken: return String(localized: "The provider returned no identity token.")
        case .server(let message): return message
        }
    }
}

enum Auth {
    /// L'alea que le serveur re-empreinte pour refuser un jeton rejoue.
    static func makeNonce() -> String {
        Data((0..<32).map { _ in UInt8.random(in: 0...255) }).base64EncodedString()
    }

    static func sha256Hex(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Le libelle affiche dans « Appareils connectes ». iOS 16+ renvoie un nom
    /// generique sans entitlement dedie : on s'en contente plutot que de
    /// demander cette autorisation pour un confort mineur.
    static var deviceName: String { UIDevice.current.name }

    /// Echange un jeton de fournisseur contre un jeton de session, et le range.
    static func exchange(path: String, token: String, nonce: String) async throws -> String {
        struct Body: Encodable { let token: String; let nonce: String; let device_name: String }
        struct Reply: Decodable { let token: String }
        let session = try await API.shared.postUnauthenticated(
            path: path,
            body: Body(token: token, nonce: nonce, device_name: deviceName),
            as: Reply.self
        )
        Config.sessionToken = session.token
        return session.token
    }
}
```

Ajouter dans `ios/Podcapp/API.swift` la méthode non authentifiée dont ce fichier dépend :

```swift
    /// Les deux endpoints de connexion sont les seuls appels sans porteur :
    /// c'est eux qui le fabriquent.
    func postUnauthenticated<B: Encodable, R: Decodable>(path: String, body: B, as: R.Type) async throws -> R {
        var request = URLRequest(url: URL(string: Config.baseURL + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw AuthError.server(String(localized: "Sign-in was refused. Please try again."))
        }
        return try JSONDecoder().decode(R.self, from: data)
    }
```

- [ ] **Step 4 : Remplacer le champ jeton par le bouton Apple**

Dans `OnboardingView.swift`, sur le dernier écran, retirer le `TextField` du jeton et sa fonction `connect()`, et mettre à la place :

```swift
    @State private var nonce = Auth.makeNonce()

    private var appleButton: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.email]
            // Apple ne recoit que l'empreinte ; l'original part au serveur, qui
            // verifie que les deux correspondent.
            request.nonce = Auth.sha256Hex(nonce)
        } onCompletion: { result in
            Task { await handleApple(result) }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: 50)
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure:
            status = .failed(AuthError.cancelled.localizedDescription)
        case .success(let auth):
            guard
                let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                let data = credential.identityToken,
                let token = String(data: data, encoding: .utf8)
            else {
                status = .failed(AuthError.noToken.localizedDescription)
                return
            }
            status = .checking
            do {
                _ = try await Auth.exchange(path: "/auth/apple", token: token, nonce: nonce)
                onDone()
            } catch {
                Config.sessionToken = ""
                // Un nonce ne sert qu'une fois : sans ce renouvellement, un
                // deuxieme essai apres echec serait refuse pour rejeu.
                nonce = Auth.makeNonce()
                status = .failed(error.localizedDescription)
            }
        }
    }
```

Ajouter `import AuthenticationServices` en tête du fichier.

- [ ] **Step 5 : Localiser les chaînes nouvelles**

Ajouter à `ios/design/fr-strings.json` :

```json
  "Sign-in cancelled.": "Connexion annulée.",
  "The provider returned no identity token.": "Le fournisseur n'a renvoyé aucun jeton d'identité.",
  "Sign-in was refused. Please try again.": "La connexion a été refusée. Réessayez."
```

Run: `python3 ios/design/make-strings.py`
Expected: les fichiers de localisation sont régénérés sans erreur.

- [ ] **Step 6 : Compiler**

Run:
```bash
cd ios && xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 7 : Vérifier sur un appareil**

Sign in with Apple **ne fonctionne pas sur un simulateur non connecté à un compte Apple** : incrémenter `CURRENT_PROJECT_VERSION`, régénérer, installer sur l'iPhone et dérouler l'onboarding. Vérifier qu'après la connexion l'écran d'accueil s'affiche, puis que le partage d'un lien depuis Safari fonctionne — c'est ce qui prouve que l'extension lit bien le nouveau jeton.

- [ ] **Step 8 : Commit**

```bash
git add ios/project.yml ios/Podcapp ios/design/fr-strings.json ios/Podcapp.xcodeproj
git commit -m "sign in with Apple, in the slot where the pasted token used to go"
```

---

### Task 7 : iOS — Google sans SDK

**Files:**
- Modify: `ios/project.yml` (schéma d'URL)
- Modify: `ios/Podcapp/Auth.swift`
- Modify: `ios/Podcapp/Screens/OnboardingView.swift`
- Modify: `ios/design/fr-strings.json`

**Interfaces:**
- Consumes: `Auth.exchange(path:token:nonce:)` de la tâche 6 ; `POST /auth/google`.
- Produces: `Auth.signInWithGoogle(clientId:) async throws -> String`.

**Prérequis d'infrastructure**, à faire avant d'écrire le code : créer un projet Google Cloud, un identifiant client OAuth de type **iOS** avec le bundle `com.louisguichard.podcapp`. Reporter l'id client dans `GOOGLE_CLIENT_ID` (env Vercel) et dans le yaml ci-dessous. Le schéma de redirection est l'id client **inversé**, forme `com.googleusercontent.apps.<id>`.

- [ ] **Step 1 : Déclarer le schéma d'URL**

Dans `ios/project.yml`, cible `Podcapp`, sous `info.properties` :

```yaml
        CFBundleURLTypes:
          - CFBundleURLSchemes:
              - com.googleusercontent.apps.REMPLACER_PAR_ID_CLIENT_INVERSE
```

Run: `cd ios && /tmp/xcodegen/xcodegen/bin/xcodegen generate --spec project.yml`

- [ ] **Step 2 : Écrire le flux PKCE**

Ajouter à `ios/Podcapp/Auth.swift` :

```swift
extension Auth {
    /// OAuth 2.0 avec PKCE plutot que le SDK Google : l'app n'embarque aucune
    /// dependance tierce aujourd'hui, et cette propriete vaut d'etre gardee.
    /// Un client iOS n'a pas de secret client, le verifier suffit.
    @MainActor
    static func signInWithGoogle(clientId: String, presenting: ASPresentationAnchor) async throws -> String {
        let verifier = makeNonce().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let challenge = base64URL(SHA256.hash(data: Data(verifier.utf8)))
        let nonce = makeNonce()
        let redirect = "com.googleusercontent.apps.\(reversed(clientId)):/oauth2redirect"

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            .init(name: "client_id", value: clientId),
            .init(name: "redirect_uri", value: redirect),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: "openid email"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "nonce", value: sha256Hex(nonce)),
        ]

        let callback = try await withCheckedThrowingContinuation { (k: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: components.url!,
                callbackURLScheme: "com.googleusercontent.apps.\(reversed(clientId))"
            ) { url, error in
                if let url { k.resume(returning: url) } else { k.resume(throwing: error ?? AuthError.cancelled) }
            }
            session.presentationContextProvider = AnchorProvider(anchor: presenting)
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        guard
            let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value
        else { throw AuthError.cancelled }

        struct TokenReply: Decodable { let id_token: String }
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            .init(name: "client_id", value: clientId),
            .init(name: "code", value: code),
            .init(name: "code_verifier", value: verifier),
            .init(name: "grant_type", value: "authorization_code"),
            .init(name: "redirect_uri", value: redirect),
        ]
        request.httpBody = form.query?.data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let reply = try? JSONDecoder().decode(TokenReply.self, from: data)
        else { throw AuthError.noToken }

        return try await exchange(path: "/auth/google", token: reply.id_token, nonce: nonce)
    }

    private static func base64URL<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// « 123-abc.apps.googleusercontent.com » -> « 123-abc ».
    private static func reversed(_ clientId: String) -> String {
        String(clientId.split(separator: ".").first ?? "")
    }
}

private final class AnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    let anchor: ASPresentationAnchor
    init(anchor: ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
}
```

- [ ] **Step 3 : Ajouter le bouton**

Dans `OnboardingView.swift`, sous le bouton Apple :

```swift
    private var googleButton: some View {
        Button {
            Task { await handleGoogle() }
        } label: {
            Text("Continue with Google")
                .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.bordered)
    }

    private func handleGoogle() async {
        guard let anchor = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first
        else { return }
        status = .checking
        do {
            _ = try await Auth.signInWithGoogle(clientId: Config.googleClientId, presenting: anchor)
            onDone()
        } catch {
            Config.sessionToken = ""
            status = .failed(error.localizedDescription)
        }
    }
```

Ajouter dans `Shared.swift` :

```swift
    /// Fixe a la compilation : c'est un identifiant public, pas un secret.
    static let googleClientId = "REMPLACER_PAR_ID_CLIENT"
```

- [ ] **Step 4 : Localiser**

Ajouter à `ios/design/fr-strings.json` : `"Continue with Google": "Continuer avec Google"`.

Run: `python3 ios/design/make-strings.py`

- [ ] **Step 5 : Compiler et essayer**

Run:
```bash
cd ios && xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build
```
Expected: `** BUILD SUCCEEDED **`.

Installer, appuyer sur « Continuer avec Google », dérouler le consentement. Vérifier ensuite en base que la personne n'a **pas** été dédoublée si elle s'était déjà connectée par Apple avec la même adresse vérifiée :

```bash
psql "$DATABASE_URL" -c "select u.id, u.email, i.provider from users u join identities i on i.user_id = u.id order by u.created_at desc limit 5"
```
Expected: deux lignes `identities` (apple, google) pour un seul `users.id`.

- [ ] **Step 6 : Commit**

```bash
git add ios/project.yml ios/Podcapp ios/design/fr-strings.json ios/Podcapp.xcodeproj
git commit -m "continue with Google, over PKCE and without a third-party SDK"
```

---

### Task 8 : iOS — appareils connectés et déconnexion

**Files:**
- Modify: `ios/Podcapp/API.swift`
- Modify: `ios/Podcapp/Screens/SettingsView.swift`
- Modify: `ios/design/fr-strings.json`

**Interfaces:**
- Consumes: `GET /me/sessions`, `DELETE /me/sessions/:id`.
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1 : Ajouter les appels**

Dans `ios/Podcapp/API.swift` :

```swift
struct DeviceSession: Decodable, Identifiable {
    let id: String
    let device_name: String
    let last_seen_at: Date
}

extension API {
    func sessions() async throws -> [DeviceSession] {
        struct Reply: Decodable { let sessions: [DeviceSession] }
        return try await get("/me/sessions", as: Reply.self).sessions
    }

    func revokeSession(id: String) async throws {
        try await delete("/me/sessions/\(id)")
    }
}
```

Si `get(_:as:)` ou `delete(_:)` n'existent pas sous ces noms dans `API.swift`, les remplacer par les helpers réellement présents plutôt que d'en ajouter.

- [ ] **Step 2 : Afficher la liste**

Dans `SettingsView.swift`, ajouter une section :

```swift
    @State private var devices: [DeviceSession] = []

    private var devicesSection: some View {
        Section {
            ForEach(devices) { device in
                HStack {
                    Text(device.device_name)
                    Spacer()
                    Button {
                        Task { await revoke(device) }
                    } label: {
                        Text("Sign out")
                    }
                }
            }
        } header: {
            Text("Signed-in devices")
        }
        .task { devices = (try? await API.shared.sessions()) ?? [] }
    }

    private func revoke(_ device: DeviceSession) async {
        try? await API.shared.revokeSession(id: device.id)
        devices = (try? await API.shared.sessions()) ?? []
    }
```

- [ ] **Step 3 : Déconnecter l'appareil courant**

Ajouter un bouton qui efface la valeur partagée :

```swift
    private func signOut() {
        // Efface aussi ce que lit l'extension de partage : la garder connectee
        // alors que l'app ne l'est plus serait une surprise desagreable.
        Config.sessionToken = ""
        Config.reportedLanguage = nil
    }
```

- [ ] **Step 4 : Localiser**

Ajouter à `ios/design/fr-strings.json` :

```json
  "Signed-in devices": "Appareils connectés",
  "Sign out": "Déconnecter"
```

Run: `python3 ios/design/make-strings.py`

- [ ] **Step 5 : Compiler et essayer**

Run:
```bash
cd ios && xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build
```
Expected: `** BUILD SUCCEEDED **`.

Sur l'appareil : ouvrir Réglages, vérifier que l'iPhone apparaît dans la liste. Déconnecter l'appareil courant, vérifier que l'app revient à l'onboarding **et** qu'un partage depuis Safari échoue proprement.

- [ ] **Step 6 : Commit**

```bash
git add ios/Podcapp ios/design/fr-strings.json
git commit -m "signed-in devices in Settings, and signing out takes the share extension with it"
```

---

### Task 9 : Confidentialité et documentation

Sans cette tâche, le bundle déclare deux types de données et l'app en collecte trois. Apple relève la contradiction.

**Files:**
- Modify: `ios/Podcapp/PrivacyInfo.xcprivacy`
- Modify: `ios/ShareExtension/PrivacyInfo.xcprivacy`
- Modify: `docs/testflight.md`
- Modify: `ARCHITECTURE.md` (ligne 306)
- Modify: `CLAUDE.md` (journal des décisions)

- [ ] **Step 1 : Déclarer l'adresse e-mail dans les deux manifestes**

Dans chacun des deux `PrivacyInfo.xcprivacy`, ajouter au tableau `NSPrivacyCollectedDataTypes` :

```xml
		<dict>
			<!-- L'adresse rendue par Sign in with Apple ou par Google a la
			     connexion. Relais Apple compris : c'est une adresse malgre tout. -->
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeEmailAddress</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
```

- [ ] **Step 2 : Mettre le questionnaire App Store Connect en accord**

Manuel, dans le navigateur : App Store Connect → Distribution → Confidentialité de l'app → Types de données → **Modifier** → cocher **Coordonnées → Adresse e-mail**, puis la configurer : finalité *Fonctionnalité de l'app*, **liée** à l'utilisateur, **pas** de suivi. Publier.

Les deux déclarations doivent dire la même chose, mot pour mot.

- [ ] **Step 3 : Réécrire la section de revue**

Dans `docs/testflight.md`, remplacer la section « Beta App Review — informations de connexion » : le compte de démonstration n'est plus nécessaire, la case « Connexion requise » se décoche, et les notes de revue deviennent :

```
Podcapp is an audio briefing app. The interface and the episodes follow the
phone's language (English or French).

Create an account from the last onboarding screen with Sign in with Apple or
with Google — no invitation or code is needed. A new account starts empty:
share three or four links from Safari to see an episode built.

All content comes from links the account holder saved; nothing is generated
without user-submitted sources.
```

Ajouter une ligne rappelant que le compte `beta-review@podcapp.fr` peut être supprimé une fois cette version en revue.

- [ ] **Step 4 : Corriger l'architecture**

Dans `ARCHITECTURE.md`, remplacer la ligne 306 :

```
Auth V1 = Sign in with Apple ou Google -> un jeton de session opaque par
appareil (`sessions.token`), revocable depuis Reglages. `users.api_token`
subsiste comme cle de service pour la CLI et l'eval, jamais utilisee par l'app.
```

- [ ] **Step 5 : Journal des décisions**

Ajouter à la table de `CLAUDE.md` :

```
| 2026-09-02 | Authentification Apple + Google, session opaque par appareil | Personne d'autre que Louis ne pouvait creer un compte, ce qui bloquait les testeurs et aurait fait rejeter une mise en vente. La session vit la ou vivait le jeton d'API, ce qui laisse l'extension de partage inchangee ; un jeton court a rafraichir l'aurait obligee a savoir se rafraichir |
```

- [ ] **Step 6 : Portes, build et commit**

Run: `pnpm test && pnpm exec tsc --noEmit`
Run: `cd ios && xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build`

```bash
git add ios/Podcapp/PrivacyInfo.xcprivacy ios/ShareExtension/PrivacyInfo.xcprivacy docs/testflight.md ARCHITECTURE.md CLAUDE.md
git commit -m "declare the email address everywhere it is now collected"
```

- [ ] **Step 7 : Déployer**

```bash
git push
pnpm exec vercel deploy --prod --yes
```

Vercel construit depuis GitHub : sans le `push` d'abord, c'est l'ancien code qui repart. Vérifier ensuite que `GOOGLE_CLIENT_ID` est bien présent dans l'environnement Vercel, sinon `/auth/google` refusera toute connexion.

Puis incrémenter `CURRENT_PROJECT_VERSION`, régénérer le projet, et envoyer un build TestFlight avec `ios/testflight.sh` — en se rappelant qu'il faut une clé API en rôle **Admin**, à révoquer après.
