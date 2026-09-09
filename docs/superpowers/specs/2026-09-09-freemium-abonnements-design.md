# Freemium et abonnements — spec de conception

**Date :** 2026-09-09 · **Cible :** 1.0 (Louis a choisi de ne pas sortir 1.0 en
gratuit d'abord) · **État :** conception validée, implémentation non commencée.

---

## 1. Ce qu'on construit, et pourquoi ces chiffres

Podcapp devient freemium. Trois paliers, un plafond mensuel d'épisodes sur
chacun, deux abonnements auto-renouvelables mensuels en StoreKit 2.

Le plafond n'est pas un choix de packaging, c'est de l'arithmétique. Avec les
constantes du dépôt (`TTS_USD_PER_1K_CHARS = 0.15`, `WORDS_PER_MINUTE.en = 162`)
un épisode coûte **~0,60 $ à 3 min** et **~1,00 $ à 5 min** — TTS pour l'essentiel,
le reste en rédaction, grounding et édition. **Tout le reste de cette spec compte
en euros**, au taux de change arrondi retenu ici (1 € ≈ 1,09 $) : **0,55 € et
0,90 € par épisode**. Ce qui reste après la commission Apple : 8,49 € et 16,99 €
au taux Small Business (15 %), 6,99 € et 13,99 € au taux standard (30 %).

Ces deux coûts sont des estimations dérivées de constantes, pas des mesures : la
seule mesure directe du dépôt est 2,36 $ pour un épisode de 14 min à 17 sources
(1,93 $ de TTS pour 12 861 signes, 0,43 $ de LLM). **Première tâche
d'implémentation : mesurer réellement un épisode de 3 min et un de 5 min**, et
corriger cette section si l'écart dépasse 20 %.

| | coût/épisode | 30 épisodes | net à 15 % | marge |
|---|---|---|---|---|
| 3 min | ~0,55 € | ~16,50 € | 8,49 € | **−8 €** |
| 5 min | ~0,90 € | ~27 € | 16,99 € | **−10 €** |

Autrement dit : **de l'illimité à ces prix perd de l'argent sur l'usage nominal**,
et le produit *est* un cron quotidien. Plus l'abonné aime Podcapp, plus il coûte.
Les plafonds retenus (8 et 12) restent rentables même au taux 30 %, ce qui rend
la grille robuste au fait que l'inscription au Small Business Program n'est pas
faite.

**Décision de Louis contre l'illimité, prise sur ces chiffres.**

---

## 2. Les paliers

| | Gratuit | **Plus** — 9,99 €/mois | **Pro** — 19,99 €/mois |
|---|---|---|---|
| Épisodes par mois | **1** | **8** | **12** |
| Longueur | 3 min | 3 min | **3 / 4 / 5 min au choix** |
| Voix | celle de sa langue | celle de sa langue | **au choix** (3 en, 2 fr) |
| Tout le reste | identique | identique | identique |

« Tout le reste » veut dire : partage illimité de liens, bibliothèque, lecture,
texte des chapitres et sources, flux RSS privé, notifications, catégories.
**Rien de ce qui existe aujourd'hui n'est repris à personne sauf le volume, la
longueur et le choix de voix.** Le paywall ne se met jamais entre un utilisateur
et un épisode déjà produit.

Marge de contrôle, au taux le plus défavorable (30 %) : Plus = 8 × 0,55 = 4,40 €
de coût contre 6,99 € encaissés (**37 %**) ; Pro = 12 × 0,90 = 10,80 € contre
13,99 € (**23 %**).

Noms `Plus` / `Pro` : provisoires, ils ne sont portés que par des chaînes
localisées et les identifiants produit ci-dessous.

Identifiants produit, un seul groupe d'abonnement `podcapp` pour que
l'upgrade/downgrade soit natif (Pro en niveau 1, Plus en niveau 2) :

```
com.louisguichard.podcapp.plus.monthly
com.louisguichard.podcapp.pro.monthly
```

---

## 3. Ce qui change en base

Une migration, quatre colonnes sur `users`, aucune table nouvelle. Le palier est
un attribut de l'utilisateur, pas une entité à gérer.

```
users.plan                    text    not null default 'free'   -- 'free' | 'plus' | 'pro'
users.plan_expires_at         timestamptz                        -- null pour 'free'
users.plan_original_txn_id    text                               -- clé de rapprochement Apple
users.plan_environment        text                               -- 'Production' | 'Sandbox'
```

`plan_original_txn_id` est l'`originalTransactionId` d'Apple : il survit aux
renouvellements et c'est la seule clé stable pour rapprocher une notification
serveur d'une ligne `users`. Il porte un index unique partiel (non nul), qui
empêche deux comptes de revendiquer le même abonnement.

`plan_environment` existe parce qu'une transaction sandbox et une transaction de
production ont des espaces d'identifiants **disjoints** : sans ce champ, un
achat de relecteur en sandbox et un achat réel peuvent entrer en collision.

Le comptage du quota ne stocke rien : il se lit depuis `episodes`.

---

## 4. Le quota a une seule définition

Exactement la discipline de `MIN_SOURCES_PER_EPISODE` (`src/jobs/material.ts`,
décision du 2026-09-01) : une fonction, quatre points d'application, aucun
recalcul côté client.

Nouveau fichier `src/jobs/quota.ts`, typé `PgDatabase<PgQueryResultHKT, typeof
schema>` comme `material.ts` — appelable depuis l'edge (Neon HTTP) **et** depuis
les jobs (node-postgres), et sans import lourd.

```ts
export const PLAN_EPISODE_LIMIT = { free: 1, plus: 8, pro: 12 }
export const PLAN_MAX_MINUTES   = { free: 3, plus: 3, pro: 5 }
export const PLAN_CHOOSES_VOICE = { free: false, plus: false, pro: true }

planOf(user): Plan                       // 'free' dès que plan_expires_at est dépassé
countEpisodesThisMonth(db, userId)       // episodes du mois calendaire UTC
hasQuotaLeft(count, plan): boolean
quotaMessage(language, count, plan)      // le refus, dans la langue de l'utilisateur
```

**Ce qui compte contre le quota :** les épisodes du mois calendaire **UTC** dont
le statut est `ready`, plus ceux en vol (statut non terminal). Un épisode
**échoué ne consomme pas de quota** : c'est notre panne, pas la sienne. Le coût
de cette générosité est borné par le verrou d'exécution qui existe déjà (409 +
index unique partiel + faucheuse à 30 min), qui interdit deux runs simultanés.

Le compte est donc **dynamique** : un épisode en vol occupe une place, et la
libère s'il échoue. Un utilisateur à sa dernière place voit « 0 restant » pendant
la génération et retrouve « 1 restant » si elle échoue. C'est voulu, et c'est ce
que l'app doit afficher — elle relit `GET /sources`, elle ne mémorise rien.

**Deux refus distincts, deux codes distincts**, que l'app ne doit pas confondre :
**422** = pas assez de liens (`MIN_SOURCES_PER_EPISODE`, règle existante),
**402** = quota épuisé. Les messages et les paywalls sont différents.

**Le mois calendaire UTC, pas la date anniversaire de l'abonnement.** Une seule
fenêtre à raisonner, un seul fuseau, et un compteur que l'utilisateur peut
prédire. L'écart avec la facturation Apple est assumé et dit dans l'app :
« 3 épisodes restants — remis à zéro le 1er ».

**Les quatre points d'application, tous obligatoires :**

1. `POST /episodes` dans `api/index.ts` (edge) → **402**, message dans la langue
   de l'utilisateur, `plan`/`used`/`limit`/`resets_at` dans le corps.
2. `POST /episodes` dans `src/api/index.ts` (Node local) → idem, pour que les
   deux entrypoints ne divergent pas.
3. La tâche planifiée `daily-briefings` → skip lisible, comme le skip actuel
   « only N source(s) in open stories ».
4. `generateEpisode` → refus **avant** de payer le rédacteur et le TTS.

Le quatrième n'est pas redondant : c'est le seul qui protège la dépense quand un
run est déclenché autrement que par les trois autres.

`GET /sources` renvoie déjà `available` et `minimum` ; il renverra en plus
`plan`, `used`, `limit`, `resets_at`. **L'app affiche ces nombres et ne les
recalcule jamais** — la règle tenue depuis le 2026-09-01.

---

## 5. Longueur et voix se bornent à la lecture

Aucune migration, aucune écriture corrective, exactement comme `MAX_TARGET_MINUTES`
borne déjà `users.target_minutes` dont la valeur par défaut en base est restée 10.

```ts
targetMinutesFor(plan, requested)  // min(requested ?? défaut, PLAN_MAX_MINUTES[plan], MAX_TARGET_MINUTES)
voiceFor(language, override, plan) // ignore override quand PLAN_CHOOSES_VOICE[plan] est faux
```

`voiceFor` existe déjà (`src/config.ts:139`) avec la signature
`(language, override)` : elle prend un troisième paramètre. Une colonne en base
ne peut alors jamais mentir, parce qu'aucune lecture ne la croit sur parole. Un
abonné Pro qui redescend en gratuit garde `voice_id` en base et réentend la voix
par défaut — et la retrouve intacte s'il se réabonne.

---

## 6. Comment le serveur sait qui a payé

**App Store Server API + App Store Server Notifications V2.** Ce n'est pas
optionnel ici : le cron génère à 06:00 **sans qu'aucune app ne tourne**, donc un
entitlement lu sur l'appareil n'existe pas au moment où la dépense est engagée.
Seul un état tenu par le serveur peut fermer la vanne.

**Écartées :** l'app qui déclare son palier (falsifiable avec un proxy, et
l'attaquant dépense notre budget TTS ; ne ferme pas le cron) ; RevenueCat (un
SDK tiers détenant l'état de paiement contredit `NSPrivacyTracking: false`,
« no third-party SDK » dans les notes de review et « no advertising, no
tracking » dans la description de l'App Store — la posture est un argument de
vente).

### 6.0 L'ancre de confiance est TLS, pas une chaîne x5c vérifiée localement

**Corrigé le 2026-09-09, pendant la planification.** La première version de cette
section demandait de vérifier la chaîne `x5c` du JWS jusqu'à la racine *Apple Root
CA - G3* épinglée. **Ce n'est pas implémentable ici** : `api/index.ts` déclare
`export const config = { runtime: 'edge' }` (ligne 55), et le runtime edge n'a pas
`node:crypto` — donc pas de `X509Certificate`, pas de `checkIssued`. Il faudrait
un parseur DER écrit à la main pour extraire chaque `tbsCertificate` et vérifier
sa signature par Web Crypto. C'est faisable et c'est une mauvaise idée : de la
cryptographie maison sur le chemin du paiement, pour rien.

Rien, parce que **le JWS n'a pas besoin d'être l'autorité**. L'autorité, c'est
l'App Store Server API interrogée en TLS avec notre propre clé — exactement
l'ancre de confiance que `src/auth/verify.ts` utilise déjà aujourd'hui en allant
chercher le JWKS d'Apple en HTTPS.

**Règle qui en découle, tenue partout : tout JWS venu du réseau — celui de l'app
comme celui du webhook — est un PING NON VÉRIFIÉ.** On n'en lit qu'une chose,
l'`originalTransactionId`, et jamais l'état. L'état vient toujours d'un appel
frais et authentifié à
`GET /inApps/v1/subscriptions/{originalTransactionId}`.

Un ping falsifié ne peut donc rien faire d'autre que provoquer un appel HTTP.

### 6.1 `POST /me/subscription`

1. lire `originalTransactionId` dans le JWS **sans le vérifier** (décodage base64
   du payload, rien de plus) ;
2. appeler l'App Store Server API pour cet identifiant, sur l'hôte de production
   puis, sur `4040010` (*transaction id not found*), sur l'hôte sandbox — c'est la
   procédure d'Apple, et c'est aussi ce qui renseigne `plan_environment` ;
3. **contrôler que `appAccountToken` de la transaction est égal à l'`id` de
   l'utilisateur authentifié** ;
4. contrôler `bundleId == com.louisguichard.podcapp` et `productId` parmi les deux
   connus ;
5. écrire `plan`, `plan_expires_at`, `plan_original_txn_id`, `plan_environment`.

**L'étape 3 est celle qui ferme le trou** que la vérification de chaîne ne
fermait pas de toute façon : sans elle, quiconque connaît l'`originalTransactionId`
d'un tiers pourrait rattacher l'abonnement de ce tiers à son propre compte, et un
JWS parfaitement signé par Apple ne dit rien de *qui* le présente. `appAccountToken`
est le mécanisme prévu par Apple pour lier un achat à un compte applicatif :
l'app le pose à l'achat (`Product.PurchaseOption.appAccountToken(UUID)`), il
revient dans la transaction, et c'est un UUID — donc `users.id` y entre tel quel,
sans conversion.

Une transaction sans `appAccountToken`, ou avec un `appAccountToken` qui ne
correspond pas, est **refusée en 403**.

Signature de notre jeton d'API : `jose` (`importPKCS8` + `SignJWT`), pas
`node:crypto`. `src/push/apns.ts` signe déjà en ES256 pour Apple mais avec
`createSign`, et il tourne sur Trigger.dev en Node — **ne pas le réutiliser tel
quel sur l'edge**, il ne s'y importe pas.

### 6.2 `POST /apple/notifications`

Le webhook des notifications serveur V2. Sa charge utile est un ping au sens de
§6.0 : on en extrait `originalTransactionId`, on ignore tout le reste, et on
**relit** l'abonnement via l'App Store Server API. `DID_RENEW`, `EXPIRED`,
`DID_CHANGE_RENEWAL_STATUS`, `REFUND`, `REVOKE`, `GRACE_PERIOD_EXPIRED` prennent
donc tous le même chemin, et il n'y a pas de machine à états à écrire par type de
notification. C'est ce qui garde l'état juste quand l'app n'est jamais ouverte —
précisément le cas d'un abonné qui écoute son flux RSS dans Overcast.

Une notification pour un `originalTransactionId` inconnu répond **200** et
atterrit dans `events` — même règle que `email_inbound_rejected` : jamais de
5xx à un webhook tiers, jamais d'échec silencieux non plus.

L'URL du webhook porte un secret en paramètre (`APPLE_NOTIFICATIONS_TOKEN`),
comme `POST /ingest/email` le fait déjà pour Postmark. Ce n'est pas de
l'authentification — c'est ce qui empêche un tiers de nous faire marteler l'API
d'Apple depuis une URL devinée.

### 6.3 Le filet

Avant toute génération, si `plan != 'free'` et que `plan_expires_at` est dépassé,
le serveur **relit** l'abonnement via l'App Store Server API
(`/inApps/v1/subscriptions/{originalTransactionId}`) plutôt que de dégrader sur
la foi d'une notification peut-être manquée. Un abonné payant qui perd son palier
parce qu'Apple a mal livré un webhook est une panne inacceptable ; un appel HTTP
avant une dépense de 0,55 $ ne l'est pas.

### 6.4 Où vit ce code

**Sur `api/index.ts`, l'entrypoint edge servi par Vercel.** `pnpm dev` boote
`src/api/index.ts`, l'ancienne implémentation Node qui n'a ni `/auth/*` ni
`/me/sessions` : **le flux d'abonnement ne pourra pas être exercé en local par
`pnpm dev`**, exactement comme le flux de connexion aujourd'hui. Les fonctions
pures (vérification du JWS, quota, bornage) sont testées unitairement ; le bout
en bout se fait en sandbox contre le déploiement.

---

## 7. L'app

- **StoreKit 2**, `Podcapp/Store.swift` : chargement des produits, achat,
  `Transaction.updates` écouté au lancement, `AppStore.sync()` derrière un
  bouton **Restore Purchases** dans Réglages (exigé, 3.1.1).
- **La transaction n'est `finish()`-ée qu'après le 200 du serveur.** Si le
  serveur est injoignable, elle reste en attente et StoreKit la représente au
  lancement suivant : personne ne paie sans obtenir son palier.
- **Le paywall apparaît à trois endroits et nulle part ailleurs :** la carte
  Générer quand le quota est épuisé, le sélecteur de durée au-delà de 3 min, le
  sélecteur de voix. Chacun dit ce qui manque et ce que ça débloque.
- **La feuille d'abonnement** porte, parce qu'Apple l'exige : nom, durée, prix
  par période, reconduction automatique, et des liens vers les CGU
  (`podcapp.fr/terms`) et la politique de confidentialité (`podcapp.fr/privacy`).
- Les chaînes suivent `ios/design/make-strings.py` depuis `fr-strings.json` —
  **ne jamais éditer les `.strings` à la main**.

---

## 8. App Review

Personne n'est grand-fathered (décision de Louis) : le compte de démonstration
`beta-review@podcapp.fr` passe en gratuit comme les autres.

Le relecteur teste les paliers par **achat sandbox**, qui est gratuit pour lui.
Cela impose deux choses au serveur, et c'est un motif de rejet classique quand
elles manquent :

1. accepter les JWS dont l'`environment` est `Sandbox`, et interroger l'hôte
   sandbox de l'App Store Server API pour ceux-là ;
2. ne jamais rapprocher une transaction sandbox et une transaction de production
   — d'où `plan_environment`.

Les notes de review devront décrire le parcours d'achat sandbox et rappeler que
le compte de démonstration part en gratuit à 1 épisode.

---

## 9. Ce qui casse, et comment ça le dit

| Panne | Comportement |
|---|---|
| Achat validé, serveur injoignable | transaction non `finish()`-ée, rejouée au lancement suivant |
| JWS invalide ou chaîne non vérifiable | 400, `events`, palier inchangé, message lisible dans l'app |
| Notification Apple manquée | relecture par l'App Store Server API avant génération (§6.3) |
| Notification pour un compte inconnu | 200 + `events`, jamais de 5xx |
| Quota épuisé | 402 avec `plan`/`used`/`limit`/`resets_at`, paywall, cron qui skippe en le disant |
| Abonnement expiré en cours de mois | retombe en gratuit ; les épisodes déjà produits restent lisibles |
| Remboursement / révocation | `REFUND`/`REVOKE` → gratuit immédiatement |

Aucun échec silencieux : la règle du projet s'applique telle quelle.

---

## 10. Étapes humaines, toutes bloquantes pour VENDRE

Aucune n'empêche de construire ni de tester en local, toutes empêchent
d'encaisser.

1. **Contrat Paid Applications** — coordonnées bancaires et fiscales dans App
   Store Connect. Sans lui, **aucun abonnement ne peut même être créé**. Vérifié
   le 2026-09-09 : `asc subscriptions groups list` et `asc iap list` renvoient
   vide, et le statut du contrat n'est pas exposé par l'API publique.
2. **Statut de commerçant DSA** — repoussé le 2026-09-02 au motif qu'« il ne
   conditionne que la disponibilité dans l'UE ». Des prix en euros font de l'UE
   le marché des testeurs : **il redevient bloquant**. Il bute toujours sur le
   désaccord d'entité noté ce jour-là — compte au nom de *louis guichard* à Lyon,
   justificatifs disponibles au nom de *guich, LLC* (Delaware, adresse Brooklyn).
   À trancher avant, pas pendant.
3. **Apple Small Business Program** — inscription volontaire, fait passer la
   commission de 30 % à 15 %. Les plafonds retenus sont rentables sans, mais
   c'est le double de marge pour un formulaire.

**Ce qui n'est PAS bloqué :** un fichier de configuration StoreKit (`.storekit`)
dans Xcode permet d'acheter en simulateur **sans aucun produit dans App Store
Connect et sans contrat**. Tout le chemin app + paywall + vérification serveur se
construit et se teste avant que la première case administrative soit cochée.

---

## 11. Hors périmètre (YAGNI)

Essai gratuit, offres promotionnelles, codes d'offre, paliers annuels, remises
famille, abonnements web, paiement hors App Store, tableau de bord de revenus.
Rien de tout cela n'est nécessaire pour vendre deux abonnements mensuels, et
chaque ligne ajoutée est une surface de rejet en plus sous la 3.1.

---

## 12. Tests

Au standard du dépôt (152 tests aujourd'hui), et au standard de rigueur déjà posé
par les tests d'identité Apple/Google :

- **Rattachement d'abonnement : un test par forme d'abus** — `appAccountToken`
  absent, `appAccountToken` d'un autre utilisateur (le vol d'abonnement, §6.1),
  `bundleId` étranger, `productId` inconnu, `originalTransactionId` déjà rattaché
  à un autre compte. L'App Store Server API est simulée par injection, comme
  `createVerifier(keyFor)` accepte déjà son résolveur de clés.
- **Quota :** frontières de mois en UTC, un échec ne consomme rien, un run en vol
  compte, chacun des trois paliers à sa limite exacte et un cran au-dessus.
- **Bornage :** `targetMinutesFor` et `voiceFor` sur les trois paliers, y compris
  un `voice_id` en base sur un compte redescendu en gratuit.
- **Application :** les quatre points refusent, et refusent avec le même message.
- **Environnement :** une transaction sandbox et une transaction de production
  portant le même `originalTransactionId` ne se rapprochent pas.

---

## 13. Ordre de construction

1. Migration + `src/jobs/quota.ts` + tests unitaires (rien d'externe).
2. Bornage longueur/voix + tests.
3. Les quatre points d'application + `GET /sources` enrichi.
4. Vérification du JWS + `POST /me/subscription` + tests de contrefaçon.
5. Webhook des notifications V2 + filet de relecture.
6. App : `Store.swift`, paywall aux trois endroits, Restore, chaînes localisées.
7. Test bout en bout avec un fichier `.storekit` en simulateur.
8. **Étapes humaines** (§10), puis produits créés via `asc subscriptions`.
9. Test sandbox sur appareil, notes de review réécrites, build, soumission.

Les étapes 1 à 7 ne dépendent d'aucune action administrative. L'étape 8 est le
seul vrai chemin critique, et elle peut démarrer aujourd'hui en parallèle.
