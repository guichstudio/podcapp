# Support in-app et demandes de feedback — design

Validé par Louis le 2026-10-04 (maquettes montrées en conversation).

## Objectif

Deux choses pour la bêta :

1. un **chat de support** dans l'app : le testeur écrit, Louis répond à la main ;
2. des **demandes de feedback par notification** : Louis écrit une question depuis
   une page admin et l'envoie à tous les testeurs ou à certains ; elle arrive comme
   un message de Louis dans leur fil, avec un push.

Décisions de Louis : réponse humaine (pas d'IA, pas de service tiers) ; Louis est
prévenu par push et répond depuis une page web admin ; les demandes de feedback sont
déclenchées à la main ; la version part de `main` (+ le commit b35), pas de la
branche `appstore` dont les quotas freemium n'ont pas encore leur paywall.

## Constat préalable : le push n'a jamais fonctionné

Le 2026-10-04, `push_tokens` en production : **0 ligne pour 10 comptes**. Causes
lues dans le code :

- `registerForRemoteNotifications` n'est appelé que depuis `Push.askAndRegister()`,
  lui-même appelé seulement à l'ouverture de `GenerationSheet` et quand l'interrupteur
  de Réglages passe de off à on. Il n'y a **aucun ré-enregistrement au lancement**,
  alors que le commentaire de `API.registerPushToken` le prétend : un envoi raté une
  fois ne se refait jamais.
- Un testeur qui vit sur le cron de 06:00 n'ouvre jamais la feuille de génération,
  donc n'est jamais sollicité.

Sans réparation, une demande de feedback n'atteint personne. La réparation fait donc
partie de cette version :

- au lancement (et au retour au premier plan), si l'autorisation iOS est
  `.authorized`/`.provisional` et que `Push.enabled`, appeler
  `registerForRemoteNotifications()` — le jeton est renvoyé au serveur, qui fait un upsert ;
- demander l'autorisation à un deuxième moment évident : juste après l'envoi du
  premier message de support (« Louis vous répondra ici ; une notification vous
  préviendra »).

## Données

Migration `0010_support_messages.sql` (0009 est prise par `0009_plans` sur la branche
`appstore` ; le runner applique par nom de fichier trié, l'écart n'a pas d'effet) :

```
support_messages
  id            uuid pk default random
  user_id       uuid not null references users(id) on delete cascade
  author        text not null  -- 'user' | 'admin'
  body          text not null  -- 1..4000 signes, contrôlé par l'API
  broadcast_id  uuid null      -- même valeur pour une question envoyée à plusieurs fils
  created_at    timestamptz not null default now()
  read_at       timestamptz null  -- lu par le DESTINATAIRE (admin pour author=user, testeur pour author=admin)
index (user_id, created_at)
```

Un seul fil par utilisateur, pas de tickets. `deleteAccount` supprime explicitement
les messages (et, au passage, les `push_tokens`, que le code oubliait et dont la clé
étrangère sans cascade fait échouer la suppression du compte).

## Logique serveur — `src/support/thread.ts`

Fonctions pures sur un `PgDatabase` (même typage que `src/jobs/material.ts`, appelables
depuis l'edge et testables sur PGlite) :

- `listThread(db, userId)` → messages du fil, ordre chronologique
- `postMessage(db, { userId, author, body, broadcastId? })` → la ligne créée ; refuse un
  corps vide ou > 4000 signes (`SupportError`)
- `markRead(db, userId, author)` → marque lus les messages de `author` dans ce fil
- `unreadFor(db, userId)` → nombre de messages admin non lus par le testeur
- `listThreads(db)` → un résumé par fil : user id, adresse (ou « Apple relais » si null),
  langue, dernier message, nombre de messages testeur non lus, date ; trié par activité
- `broadcast(db, { body, userIds | 'all' })` → crée un message admin par fil cible avec
  le même `broadcast_id`, renvoie `{ broadcastId, userIds }`
- `broadcastStats(db)` → par `broadcast_id` : date, extrait, envoyés, fils ayant répondu
  après l'envoi

## API — `api/index.ts`

Côté testeur (session habituelle) :

- `GET /support/messages` → `{ messages: [{ id, author, body, created_at }] }`, marque
  lus les messages admin
- `POST /support/messages { body }` → 201 + le message ; déclenche la tâche
  `notify-support` `{ kind: 'to_admin', messageId }`. Un échec de déclenchement est
  journalisé, jamais renvoyé : le message est enregistré, c'est l'essentiel.
- `GET /me` ajoute `support_unread`

Côté admin, `Authorization: Bearer <ADMIN_TOKEN>` comparé en temps constant ;
`ADMIN_TOKEN` absent → 503 « admin disabled: ADMIN_TOKEN is not set » :

- `GET /admin/support/threads` → `listThreads` + `broadcastStats`
- `GET /admin/support/threads/:userId` → fil complet + marque lus les messages testeur
- `POST /admin/support/threads/:userId { body }` → message admin + `notify-support`
  `{ kind: 'to_users', messageId }` (un seul destinataire)
- `POST /admin/support/broadcast { body, user_ids: string[] | 'all' }` → `broadcast` +
  `notify-support { kind: 'broadcast', broadcastId }`

Page : `GET /admin/support` (publique, HTML statique dans `src/support/adminPage.ts`,
`noindex`), enregistrée avant le montage du sous-app authentifié. Elle demande le jeton
une fois (gardé dans `localStorage`), liste les fils, ouvre un fil, répond, et propose
« Demander un feedback » (texte + tous / cases à cocher). Rafraîchit la liste toutes les
20 s. Utilisable au téléphone.

## Push — tâche Trigger.dev `notify-support`

L'edge n'a pas `node:http2` : l'envoi APNs vit dans le worker, comme `notifyReady`.

`src/push/support.ts` :

- `to_admin` : appareils de `ADMIN_USER_ID` (env Trigger) ; titre « Nouveau message »,
  corps « <adresse ou "Apple relais"> : <extrait 140 signes> » ; donnée `support_user_id`.
- `to_users` / `broadcast` : appareils de chaque destinataire ; titre « Message de
  Podcapp » / « Message from Podcapp » selon `users.output_language` ; corps = extrait du
  message ; donnée `support: true`.
- `sendApns` est généralisé : `episodeId` devient une donnée optionnelle parmi d'autres
  (`data: Record<string, string>`), `collapseId` et `threadId` optionnels. `notifyReady`
  garde son comportement exact.
- Même hygiène que `notifyReady` : no-op sans clé APNs, erreurs avalées et journalisées,
  jetons 410 supprimés.

## iOS (b36)

- `API.swift` : `supportMessages()`, `sendSupportMessage(_:)`, `Me.supportUnread`.
- `Screens/SupportView.swift` : bulles (testeur à droite en `Palette.ink`, Louis à
  gauche), en-tête « Louis · Podcapp », état vide « Une question, un bug, une idée ?
  Louis lit tout et répond ici. », champ multiligne + bouton envoyer, défilement en bas,
  relecture toutes les 10 s tant que l'écran est visible. Message en échec : bulle
  rouge « Échec, toucher pour réessayer ». Après le premier envoi réussi :
  `Push.askAndRegister()`.
- Réglages : ligne « Écrire au support » avec pastille de non-lus, qui ouvre
  `SupportView` en feuille.
- Onglet Réglages : point rouge quand `support_unread > 0` (lu depuis `GET /me` au
  lancement, au retour au premier plan et à la réception d'un push).
- Toucher une notification portant `support` ouvre `SupportView` (via
  `userNotificationCenter(_:didReceive:)` → `NotificationCenter` → `RootView`).
- Push réparé comme décrit plus haut.
- Chaînes : `ios/design/fr-strings.json` + `make-strings.py`. Build 36 dans
  `project.yml` ET le `pbxproj`.
- `PrivacyInfo.xcprivacy` : `NSPrivacyCollectedDataTypeCustomerSupport`, lié, pas de
  pistage, finalité fonctionnement de l'app.

## Confidentialité

`src/legal/privacy.ts` mentionne les messages de support (contenu, conservation jusqu'à
la suppression du compte, lus par Louis seul). Étape humaine : étiquette App Store
Connect, ajouter « Support client ».

## Erreurs

- corps vide / trop long → 400 lisible ; fil d'un autre utilisateur inaccessible par
  construction (le userId vient de la session, jamais de la requête côté testeur)
- admin : jeton faux → 401, absent de l'environnement → 503, userId invalide → 400,
  utilisateur inconnu → 404
- push indisponible → message conservé, pastille non-lu à l'ouverture

## Tests

`src/support/thread.test.ts` (PGlite) : isolement des fils, marquage lu par auteur,
compteur non-lus, refus vide/trop long, broadcast N lignes même `broadcast_id`,
statistiques de réponses, `listThreads` trié. `src/support/admin.test.ts` :
comparaison du jeton (bon, faux, absent). `src/push/support.test.ts` : contenu des
notifications (langue, extrait, adresse nulle). `deleteAccount` : un compte avec jeton
push et messages se supprime. Puis simulateur : aller-retour complet.

## Hors périmètre

Pièces jointes, indicateur de frappe, demandes automatiques, notes 1–5, repli e-mail,
plusieurs administrateurs.

## Étapes humaines

`ADMIN_TOKEN` sur Vercel, `ADMIN_USER_ID` sur Trigger.dev, étiquette de confidentialité
App Store Connect. Migration Neon et déploiements : faits par la session.
