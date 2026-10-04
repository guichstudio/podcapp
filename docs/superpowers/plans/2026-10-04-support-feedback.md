# Support in-app et demandes de feedback — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un fil de chat par testeur, Louis qui répond depuis une page web admin, des demandes de feedback envoyées à plusieurs testeurs, et des push qui arrivent enfin.

**Architecture:** une table `support_messages` ; la logique dans `src/support/thread.ts` (pur, PGlite-testable, appelable depuis l'edge) ; des routes fines dans `api/index.ts` ; l'envoi APNs dans une tâche Trigger.dev `notify-support` (l'edge n'a pas `node:http2`) ; côté iOS un `SupportView` présenté par `RootView`, une pastille alimentée par `SupportInbox`, et l'enregistrement push refait à chaque lancement.

**Tech Stack:** Hono sur Vercel Edge, Drizzle (neon-http / PGlite), Trigger.dev v4, SwiftUI iOS 17.

Spec : `docs/superpowers/specs/2026-10-04-support-feedback-design.md`.

## Global Constraints

- Travailler dans `/Users/louisguichard/Code/podcapp-support` (branche `support`, base `origin/main` + b35). Ne jamais `git add -A`.
- Corps de message : 1 à 4000 signes après `trim()`.
- `author` vaut exactement `'user'` ou `'admin'`.
- Migration nommée `0010_support_messages.sql` (0009 est prise sur la branche `appstore`).
- Admin : `Authorization: Bearer <ADMIN_TOKEN>` ; `ADMIN_TOKEN` absent → 503 ; mauvais → 401.
- Les push admin vont aux appareils des comptes listés dans `ADMIN_USER_IDS` (Vercel, ids séparés par des virgules), passés dans le payload de la tâche — le worker n'a besoin d'aucune nouvelle variable.
- Un push qui échoue ne fait jamais échouer l'enregistrement d'un message.
- iOS : l'anglais est la langue source, chaque nouvelle chaîne va dans `ios/design/fr-strings.json` puis `python3 ios/design/make-strings.py`. Build 36 dans `ios/project.yml` ET `ios/Podcapp.xcodeproj/project.pbxproj` (XcodeGen n'est pas installé).
- Tests : `pnpm test` (node:test via tsx), `pnpm typecheck`.

---

### Task 1 : Table et logique du fil

**Files:**
- Create: `src/db/migrations/0010_support_messages.sql`
- Modify: `src/db/schema.ts` (ajout `supportMessages`)
- Create: `src/support/thread.ts`
- Test: `src/support/thread.test.ts`

**Interfaces — Produces:**
```ts
export const MAX_BODY = 4000
export class SupportError extends Error {}
export type Author = 'user' | 'admin'
export interface SupportMessage { id: string; userId: string; author: Author; body: string; broadcastId: string | null; createdAt: Date; readAt: Date | null }
export function cleanBody(raw: unknown): string            // trim, throws SupportError
export async function listThread(db: AnyDb, userId: string): Promise<SupportMessage[]>
export async function postMessage(db: AnyDb, input: { userId: string; author: Author; body: string; broadcastId?: string }): Promise<SupportMessage>
export async function markRead(db: AnyDb, userId: string, author: Author): Promise<void>
export async function unreadFor(db: AnyDb, userId: string): Promise<number>   // messages admin non lus
export interface ThreadSummary { userId: string; email: string | null; language: string; lastBody: string; lastAuthor: Author; lastAt: Date; unread: number; total: number }
export async function listThreads(db: AnyDb): Promise<ThreadSummary[]>         // tri lastAt desc
export interface Recipient { userId: string; email: string | null; language: string; devices: number }
export async function listRecipients(db: AnyDb): Promise<Recipient[]>
export async function broadcast(db: AnyDb, input: { body: string; userIds: string[] | 'all' }): Promise<{ broadcastId: string; userIds: string[] }>
export interface BroadcastStat { broadcastId: string; body: string; sentAt: Date; sent: number; replied: number }
export async function broadcastStats(db: AnyDb): Promise<BroadcastStat[]>      // tri sentAt desc
```

- [ ] **Step 1 : migration**

```sql
CREATE TABLE IF NOT EXISTS "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"broadcast_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_user_idx" ON "support_messages" ("user_id","created_at");
```

- [ ] **Step 2 : schéma Drizzle** — dans `src/db/schema.ts`, après `pushTokens` :

```ts
/// One support thread per user: no tickets, no subjects. `read_at` is set by the
/// RECIPIENT reading it -- the admin for author='user', the user for author='admin'.
/// `broadcast_id` ties together one feedback question sent to several threads.
export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    author: text('author').notNull(),
    body: text('body').notNull(),
    broadcastId: uuid('broadcast_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('support_messages_user_idx').on(t.userId, t.createdAt)],
)
```

- [ ] **Step 3 : tests (doivent échouer)** — `src/support/thread.test.ts` couvre : isolement de deux fils ; `markRead(db, u, 'admin')` ne marque que les messages admin ; `unreadFor` ; `cleanBody` refuse `''`, `'   '`, 4001 signes et accepte 4000 ; `broadcast` sur deux ids crée deux lignes de même `broadcastId` ; `broadcast` `'all'` cible tous les users ; `broadcastStats` compte `replied` = fils avec un message user postérieur ; `listThreads` trié par activité avec `unread` = messages user non lus ; `listRecipients` compte les appareils.

- [ ] **Step 4 : `pnpm test` → FAIL (module absent)**
- [ ] **Step 5 : écrire `src/support/thread.ts`** (calcul des résumés en JS sur les lignes : une bêta = quelques centaines de messages ; `AnyDb` typé comme `src/jobs/material.ts`).
- [ ] **Step 6 : `pnpm test` → PASS, `pnpm typecheck` → OK**
- [ ] **Step 7 : commit** `support: un fil par testeur, lu par son destinataire`

### Task 2 : Suppression de compte

**Files:** Modify `src/jobs/deleteAccount.ts` ; Test : nouveau `src/jobs/deleteAccount.test.ts`.

- [ ] **Step 1 : test (doit échouer)** — un compte avec une ligne `push_tokens` et deux `support_messages` : `deleteAccount(db, fakeStorage, userId)` réussit et ne laisse aucune ligne. Le storage factice implémente `delete` (no-op) et ce que `deleteAccount` lit (vérifier sa signature).
- [ ] **Step 2 : FAIL** (violation de clé étrangère `push_tokens_user_id_fkey`)
- [ ] **Step 3 :** ajouter `await db.delete(supportMessages)…` et `await db.delete(pushTokens)…` avant `users`.
- [ ] **Step 4 : PASS** ; **Step 5 : commit** `deleteAccount: les jetons push bloquaient la suppression du compte`

### Task 3 : Contrôle du jeton admin

**Files:** Create `src/support/admin.ts`, Test `src/support/admin.test.ts`.

**Produces:** `export function checkAdmin(header: string | undefined, expected: string | undefined): 'ok' | 'disabled' | 'denied'` — comparaison en temps constant sans `node:crypto` (edge) : XOR sur les codes de caractères, longueurs différentes → `denied`.

- [ ] Tests : bon jeton → ok ; mauvais → denied ; préfixe du bon → denied ; `expected` absent ou vide → disabled ; header absent → denied ; `Bearer` insensible à la casse.
- [ ] FAIL → implémenter → PASS → commit `support: le jeton admin, compare en temps constant`

### Task 4 : APNs généralisé + notifications de support

**Files:** Modify `src/push/apns.ts`, `src/push/notify.ts` ; Create `src/push/support.ts` ; Test `src/push/support.test.ts`, `src/push/apns.test.ts`.

**Produces:**
```ts
// apns.ts
export interface ApnsMessage { token: string; environment: ApnsEnvironment; title: string; body: string; data?: Record<string, string>; collapseId?: string; threadId?: string }
export function apnsPayload(m: ApnsMessage): string
export async function sendApns(config: ApnsConfig, m: ApnsMessage): Promise<ApnsResult>
// notify.ts
export async function sendToUser(db: Db, config: ApnsConfig, userId: string, alert: Omit<ApnsMessage, 'token' | 'environment'>): Promise<void>
// support.ts
export function excerpt(text: string, max?: number): string            // 140 par défaut, coupe sur un mot, ajoute « … »
export function adminAlert(email: string | null, body: string): { title: string; body: string }
export function userAlert(language: string, body: string): { title: string; body: string }
export type NotifySupportPayload =
  | { kind: 'to_admin'; messageId: string; adminUserIds: string[] }
  | { kind: 'to_users'; messageId: string }
  | { kind: 'broadcast'; broadcastId: string }
export async function notifySupport(db: Db, payload: NotifySupportPayload): Promise<{ notified: number }>
```

- [ ] Tests : `apnsPayload` d'un message briefing garde `episode_id` et `thread-id: 'briefing'` ; d'un message support porte `support: '1'` et `thread-id: 'support'` ; `excerpt` ; `adminAlert(null, …)` dit « Apple relais » ; `userAlert('fr', …)` → « Message de Podcapp », `'en'` → « Message from Podcapp ».
- [ ] `notifyReady` passe par `sendToUser` sans changer son contenu (`data: { episode_id }`, `collapseId: episodeId`, `threadId: 'briefing'`).
- [ ] FAIL → implémenter → PASS → commit `push: un envoi generique, et les alertes du support`

### Task 5 : Tâche Trigger + routes API + page admin

**Files:** Modify `src/trigger/tasks.ts`, `api/index.ts` ; Create `src/support/adminPage.ts`.

- [ ] `notify-support` : `schemaTask` avec `z.discriminatedUnion('kind', …)`, `retry: { maxAttempts: 2 }`, appelle `notifySupport(await createDb(), payload)`.
- [ ] Routes testeur : `GET /support/messages` (liste + `markRead(…, 'admin')`), `POST /support/messages` (201, déclenche `to_admin` avec `adminUserIds` lus de `ADMIN_USER_IDS`, échec journalisé). `meView` reçoit `support_unread`.
- [ ] Sous-app `admin` monté sur `/admin/support` AVANT `app.route('/', authed)` : middleware `checkAdmin` ; `GET /threads` → `{ threads, recipients, broadcasts }` ; `GET /threads/:userId` (400 si pas uuid, 404 si user inconnu) ; `POST /threads/:userId` ; `POST /broadcast`.
- [ ] `GET /admin/support` sert `adminPageHtml()` (`X-Robots-Tag: noindex`), page autonome : jeton en `localStorage`, liste des fils (non-lus en gras), fil ouvert, réponse, formulaire « Demander un feedback » avec cases (tous cochés par défaut sauf `ADMIN_USER_IDS`, indication « pas de push » quand `devices = 0`), bandeaux des envois précédents (« envoyé à N, R réponses »), rafraîchissement 20 s.
- [ ] Vérifier en local : `pnpm typecheck`, puis un script ponctuel qui monte `app` (import de `api/index.ts`, `app.fetch`) contre PGlite n'est PAS possible (neon-http) — la vérification se fait en préproduction : `vercel deploy` (preview) + `curl`.
- [ ] Commit `support: les routes, la tache de notification et la page admin`

### Task 6 : iOS — push réparé, chat, pastille

**Files:** Modify `ios/Podcapp/Push.swift`, `ios/Podcapp/PodcappApp.swift`, `ios/Podcapp/API.swift`, `ios/Podcapp/RootView.swift`, `ios/Podcapp/Screens/SettingsView.swift`, `ios/Podcapp/PrivacyInfo.xcprivacy`, `ios/design/fr-strings.json`, `ios/project.yml`, `ios/Podcapp.xcodeproj/project.pbxproj` ; Create `ios/Podcapp/Screens/SupportView.swift` (+ référence dans le pbxproj, groupe Screens, cible Podcapp).

- [ ] `Push.registerIfAuthorized()` : si `enabled` et statut `.authorized`/`.provisional`/`.ephemeral` → `registerForRemoteNotifications()`. Appelé depuis `Entry` (`.task` et retour `.active`).
- [ ] `PushDelegate.userNotificationCenter(_:didReceive:)` : si `userInfo["support"]` → `Push.pendingSupport = true` + post `.podcappOpenSupport`. `willPresent` → `SupportInbox.shared.refresh()` si support.
- [ ] `API` : `struct SupportMessage: Decodable, Identifiable` (`id`, `author`, `body`, `createdAt`), `supportMessages()`, `sendSupportMessage(_:) -> SupportMessage`, `Me.supportUnread: Int?`.
- [ ] `SupportInbox` (`@MainActor final class: ObservableObject`, `@Published unread`, `refresh()` via `API.me()`).
- [ ] `SupportView` : en-tête, état vide, bulles, envoi optimiste avec états `sending`/`failed` (toucher pour réessayer), relecture 10 s, `Push.askAndRegister()` après le premier envoi réussi.
- [ ] `RootView` : `@StateObject inbox`, point sur l'onglet Réglages, `.sheet` support ouverte par `.podcappOpenSupport` ou `Push.pendingSupport`.
- [ ] `SettingsView` : carte « Contact support » avec pastille, qui poste `.podcappOpenSupport`.
- [ ] Chaînes FR, `make-strings.py`, build 36, `NSPrivacyCollectedDataTypeCustomerSupport`.
- [ ] `xcodebuild -scheme Podcapp -sdk iphonesimulator build` → succès ; commit `b36: le support dans l'app, et le push qui s'enregistre enfin`

### Task 7 : Confidentialité + mise en ligne + vérification

- [ ] `src/legal/privacy.ts` (fr + en) : paragraphe « Messages de support ». `pnpm site:legal` pour régénérer le site.
- [ ] Migration Neon : appliquer `0010_support_messages.sql` (et enregistrer dans `_migrations`).
- [ ] `ADMIN_TOKEN` (généré, 32 octets base64url) et `ADMIN_USER_IDS` sur Vercel (production).
- [ ] Déployer Trigger (`npx trigger.dev deploy`) puis pousser la branche, fusionner dans `main`, `vercel deploy --prod`.
- [ ] Vérifier en production : `/admin/support` 200 ; `/admin/support/threads` sans jeton 401 ; aller-retour complet depuis le simulateur (message testeur → apparaît dans la page admin → réponse → apparaît dans l'app, pastille).
- [ ] TestFlight b36 (`ios/testflight.sh`) après accord de Louis.
- [ ] CLAUDE.md « Current state » + journal des décisions ; HANDOFF.
