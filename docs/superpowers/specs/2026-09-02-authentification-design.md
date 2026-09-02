# Authentification Apple et Google — design

**Date** : 2026-09-02
**État** : validé, prêt pour le plan d'implémentation

## Le problème

L'app se configure aujourd'hui en collant un jeton d'API fabriqué à la main
(`pnpm inspect create-user`). Personne d'autre que Louis ne peut donc créer un
compte. Deux conséquences :

- un testeur TestFlight ne peut pas s'inscrire seul ;
- une mise en vente publique se ferait refuser, parce qu'une app dont aucun
  utilisateur ne peut créer de compte ne fonctionne pas comme annoncé.

`ARCHITECTURE.md:306` acte l'état actuel — *« Auth V1 = manually issued
api_token per user. No signup flow yet »* — comme un report, pas comme une
exclusion : l'authentification ne figure pas dans la liste OUT du §1. Cette
spec lève le report.

## Périmètre

**Dans le périmètre.** Sign in with Apple et connexion Google, création de
compte autonome, sessions par appareil révocables, rattachement de deux
identités à un même compte, mise à jour des déclarations de confidentialité.

**Hors périmètre.** La migration des comptes existants : décision prise de
repartir de zéro. Les anciennes lignes ne sont pas supprimées, elles cessent
simplement d'être atteignables depuis l'app ; les rattacher plus tard reste
possible par une commande CLI si le besoin apparaît. Également hors périmètre :
lien magique par e-mail, connexion web, comptes d'organisation.

## Décisions et leurs raisons

| Décision | Raison |
|---|---|
| Apple **et** Google | Choix produit de Louis. La règle App Store 4.8 impose Apple dès qu'un fournisseur tiers est proposé ; l'inverse est libre. Le coût est côté serveur (vérification Google), pas côté app. |
| Un jeton opaque par appareil | L'extension de partage ne peut pas dérouler de flux OAuth : il faut un porteur longue durée dans le conteneur App Group. Un jeton court à rafraîchir obligerait l'extension à savoir se rafraîchir, pour un gain nul à un utilisateur par compte. |
| Table `identities` séparée de `users` | Une même personne doit pouvoir arriver par Apple puis par Google sans se dédoubler. |
| Jamais de fusion sur une adresse relais Apple | Ces adresses sont générées par app et par utilisateur : elles ne peuvent structurellement pas correspondre à une adresse Google. Les accepter n'ouvrirait qu'un risque sans rendre le service attendu. |
| Google via `ASWebAuthenticationSession` + PKCE, sans SDK | Préserve une propriété actuelle de l'app : aucune dépendance tierce dans le bundle. Donc aucun SDK à auditer et rien à ajouter au manifeste de confidentialité au titre d'un tiers. |
| `jose` côté serveur | La vérification de signature est l'endroit où une erreur donne accès au compte d'un autre, et où les erreurs sont silencieuses. `createRemoteJWKSet` gère cache et rotation des clés, et fonctionne sur l'Edge de Vercel. Seule dépendance ajoutée. |

## Modèle de données

```
users            (existant)  id, rss_token, output_language, voice_id, target_minutes
                             email devient nullable — Apple peut n'en fournir aucune
                             api_token conservé, mais réservé à la CLI et à l'eval

identities       (nouveau)   id, user_id → users (on delete cascade)
                             provider        'apple' | 'google'
                             subject         identifiant stable du fournisseur (claim sub)
                             email, email_verified   tels que déclarés à la 1re connexion
                             created_at
                             unique (provider, subject)

sessions         (nouveau)   id, user_id → users (on delete cascade)
                             token           opaque, 32 octets aléatoires, unique
                             device_name     libellé lisible, fourni par l'app.
                                             `UIDevice.current.name` renvoie un
                                             libellé générique (« iPhone ») sans
                                             entitlement dédié : on s'en contente
                                             plutôt que de demander cette
                                             autorisation, et on désambiguïse
                                             avec la date de création.
                             created_at, last_seen_at, revoked_at (nullable)
```

`users.api_token` change de rôle : il n'est plus la porte de l'app, seulement
une clé de service. L'app ne l'écrit ni ne le lit plus jamais.

### Règle de rattachement

Appliquée à chaque connexion, dans cet ordre, premier cas satisfait l'emporte :

1. une identité `(provider, subject)` existe → c'est ce compte ;
2. sinon, si l'e-mail est **vérifié**, **non-relais**, et correspond à l'e-mail
   d'un compte existant → la nouvelle identité est rattachée à ce compte ;
3. sinon → nouveau compte, nouvelle identité.

Une adresse se terminant par `@privaterelay.appleid.com` est traitée comme
non-rattachable à l'étape 2, quelle que soit la valeur de `email_verified`.

## API

```
POST   /auth/apple    { identity_token, nonce, device_name }  → 200 { token }
POST   /auth/google   { id_token, nonce, device_name }         → 200 { token }
GET    /me/sessions                                            → appareils connectés
DELETE /me/sessions/:id                                        → révoque une session
```

### Vérification des jetons

Cinq contrôles, tous obligatoires, sur chaque jeton reçu. La charge utile n'est
jamais lue sans que la signature ait été vérifiée.

| Contrôle | Apple | Google |
|---|---|---|
| Signature RS256 contre le JWKS | `appleid.apple.com/auth/keys` | `googleapis.com/oauth2/v3/certs` |
| `iss` | `https://appleid.apple.com` | `accounts.google.com` |
| `aud` | `com.louisguichard.podcapp` | id client OAuth iOS |
| `exp` | non expiré | non expiré |
| `nonce` | = SHA-256 du nonce généré par l'app | idem |

Le nonce empêche le rejeu : l'app tire un aléa, en envoie l'empreinte au
fournisseur et l'original au serveur, qui vérifie la correspondance.

### Middleware d'authentification

Cherche dans `sessions.token` avec `revoked_at is null`, et non plus dans
`users.api_token`. `last_seen_at` n'est rafraîchi que si sa valeur date de plus
d'une heure : une écriture par requête sur Neon en HTTP coûterait de la latence
sur chaque appel pour une précision sans usage. `users.api_token` reste accepté
en second recours, pour la CLI et l'eval.

`DELETE /me` existe déjà et doit effacer identités et sessions en cascade.
Apple exige la suppression de compte dans l'app dès qu'on permet d'en créer un.

### Abus

Un compte neuf ne coûte rien : la génération exige au moins 4 sources
sauvegardées, donc un compte vide ne déclenche ni appel LLM ni synthèse vocale.
La surface d'abus se limite à des lignes en base. Aucune limitation de débit
n'est prévue à ce stade.

## App iOS

L'extension de partage **n'est pas modifiée**. Elle lit un porteur dans le
conteneur App Group et le poste à `/ingest` ; on remplace le contenu de cette
case, pas le mécanisme. Le piège connu — le conteneur n'existe que si
l'entitlement est présent, `Shared.swift:19` — reste résolu comme il l'est.

- **Onboarding** : le dernier écran perd son champ de saisie et gagne deux
  boutons. Apple par `SignInWithAppleButton` d'`AuthenticationServices`.
- **Google** : `ASWebAuthenticationSession`, OAuth 2.0 avec PKCE. L'app récupère
  un code, l'échange elle-même contre un `id_token` (un client iOS n'a pas de
  secret client, PKCE suffit) et poste ce jeton à `/auth/google`.
- **Réglages** : section « Appareils connectés », liste des sessions avec
  révocation. Se déconnecter efface la valeur de l'App Group, donc l'extension
  de partage cesse de fonctionner en même temps — comportement voulu.
- **`project.yml`** porte la capacité *Sign in with Apple* dans les entitlements
  et le schéma d'URL de redirection Google. Jamais d'édition manuelle des
  `Info.plist` : ils sont générés.
- **Portail développeur** : la capacité *Sign in with Apple* doit être activée
  sur l'App ID. La signature automatique peut le faire ; c'est une étape
  d'infrastructure à traiter avant le premier build, pas pendant.
- **Localisation** : chaque chaîne nouvelle passe par `ios/design/fr-strings.json`
  puis `make-strings.py`. Tout `String` passé à un helper doit être enveloppé
  dans `String(localized:)`.

## Confidentialité — à mettre à jour, sous peine de contradiction

L'app va collecter une **adresse e-mail**. L'étiquette publiée le 2026-09-01 ne
déclare que deux types de données (contenu utilisateur, identifiant). Il faut
ajouter *Contact Info → Email Address* — collectée, **liée** à l'utilisateur,
**pas** de suivi, finalité fonctionnement de l'app — **aux deux endroits** :

- les `PrivacyInfo.xcprivacy` des deux cibles,
- le questionnaire App Privacy d'App Store Connect.

Les deux doivent dire la même chose, mot pour mot. Une divergence est relevée
par Apple comme une contradiction.

## Conséquences sur la revue

- Le compte de démonstration `beta-review@podcapp.fr` devient inutile, ainsi que
  les identifiants de connexion renseignés dans TestFlight.
- Les notes de revue actuelles (« collez le jeton fourni dans le champ mot de
  passe ») doivent être réécrites : le relecteur se connectera avec son propre
  compte Apple.
- `docs/testflight.md` est à mettre à jour en conséquence.

## Tests

La vérification des jetons est le seul endroit du projet où un bug donne accès
au compte d'un autre. Elle se teste avec une paire de clés de test et un JWKS
simulé.

| Cas | Attendu |
|---|---|
| Jeton valide | accepté, identité résolue |
| Expiré | rejeté |
| `aud` d'une autre app | rejeté |
| `iss` inattendu | rejeté |
| Signature altérée | rejeté |
| `alg: none` ou confusion d'algorithme | rejeté |
| Nonce absent ou différent | rejeté |

Résolution d'identité :

| Cas | Attendu |
|---|---|
| Première connexion | crée compte + identité |
| Même `(provider, subject)` | même compte, aucun doublon |
| Google, e-mail vérifié = compte existant | identité rattachée |
| Apple, adresse relais | jamais de rattachement |
| E-mail non vérifié | jamais de rattachement |
| Session révoquée | jeton refusé |
| Révocation d'un appareil | les autres sessions continuent |

Le pipeline éditorial n'est pas touché : `pnpm eval:run` n'a rien à comparer
ici. Les portes sont `pnpm test` et `pnpm exec tsc --noEmit`.

## Ce qu'il faudra décider plus tard

- Rattacher ou non les anciens comptes (hors périmètre aujourd'hui, faisable).
- Une limitation de débit sur les endpoints d'authentification, si le volume
  d'inscriptions le justifie un jour.
