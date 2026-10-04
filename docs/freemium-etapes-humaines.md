# Freemium — les étapes que le code ne peut pas faire

Livrable de la Task 9 du plan `2026-09-09-freemium-abonnements.md`. Louis a
décidé le 2026-09-09 que les tâches 1 à 8 (tout le code) seraient exécutées par
des agents, et que celle-ci serait un rapport plutôt qu'une exécution : elle est
faite d'actions web sur des comptes, et d'une mesure qui dépense de l'argent réel.

**Aucune de ces étapes n'empêche de construire ou de tester.** Un fichier
`ios/Podcapp.storekit` permet d'acheter en simulateur sans aucun produit chez
Apple et sans contrat. Toutes empêchent en revanche d'**encaisser**.

L'ordre ci-dessous est contraignant : chaque étape a besoin de la précédente.

> **État au 2026-10-04 (relevé dans App Store Connect) :** contrat Applications
> gratuites actif jusqu'au 1er septembre 2027 ; contrat Applications payantes au
> statut « Nouveau », jamais signé ; Apple exige de mettre à jour l'entité
> juridique (aujourd'hui louis guichard, Lyon) et le statut DSA avant de le
> signer ; aucun groupe d'abonnement ni produit. **Étape 1 tranchée le même jour : on vend en NOM PROPRE,
> sous l'auto-entreprise française de Louis** (l'entité déjà enregistrée chez
> Apple, louis guichard, Lyon). Le passage à guich, LLC est reporté : il exige de
> convertir l'adhésion développeur (D-U-N-S, site et e-mail sur le domaine,
> demande au support Apple) — dans App Store Connect, nom, type et pays de
> l'entité sont verrouillés. Prochaines étapes, sans urgence puisque le paywall
> attend la sortie : statut DSA (commerçant en nom propre) puis contrat payant — rien ne presse, le paywall attend la sortie sur
> l'App Store. L'étiquette App Privacy, elle, est faite (Assistance client et
> Identifiant de l'appareil ajoutés le 2026-10-04). Les étapes bancaires,
> fiscales et la clé d'achat intégré restent à faire par Louis lui-même.

---

## 1. Trancher la question d'entité — avant tout le reste

C'est le seul point qui n'est pas administratif mais décisionnel, et il bloque
les deux suivants.

Le journal de décisions du 2026-09-02 le note déjà : le compte Apple est au nom
de **louis guichard, à Lyon**, et les justificatifs disponibles sont ceux de
**guich, LLC (Delaware, adresse Brooklyn)**. Tant que les deux ne concordent
pas, le statut de commerçant DSA ne peut pas aboutir, et les coordonnées
bancaires et fiscales du contrat Paid Applications se heurteront au même
désaccord.

Deux issues, et c'est un choix à faire une fois :

- **Vendre en personne physique** (louis guichard, Lyon) : coordonnées bancaires
  et fiscales françaises, statut DSA de commerçant en nom propre. Le plus court.
- **Vendre au nom de guich, LLC** : il faut alors transférer le compte
  développeur à l'entité, ce qui est une démarche Apple à part entière (D-U-N-S,
  vérification d'entité) et prend des semaines.

Rien d'autre ne peut avancer tant que ce n'est pas tranché.

## 2. Statut de commerçant DSA

Il a été repoussé le 2026-09-02 au motif qu'« il ne conditionne que la
disponibilité dans l'UE ». **Des prix en euros font de l'UE le marché des
testeurs : il redevient bloquant.**

App Store Connect → *Business* → *Trader Status*. Adresse, téléphone et e-mail
publics — ils seront **affichés sur la fiche App Store**, c'est le but du texte
européen.

## 3. Contrat Paid Applications

App Store Connect → *Business* → *Agreements* → *Paid Applications* :
coordonnées bancaires, informations fiscales, contacts.

**Sans lui, aucun abonnement ne peut même être créé** — vérifié le 2026-09-09 :
`asc subscriptions groups list --app 6807563809` et `asc iap list --app
6807563809` renvoient vide, et le statut du contrat n'est pas exposé par l'API
publique (`asc account status` le dit lui-même).

Compter plusieurs jours entre la saisie et l'activation.

## 4. Apple Small Business Program

Facultatif, et c'est le meilleur rapport effort/gain du lot : la commission
passe de **30 % à 15 %** pour un formulaire.

Les plafonds retenus (8 et 12 épisodes) sont rentables **sans** — c'est
délibéré, la grille ne devait pas dépendre d'une inscription non faite. Avec, la
marge double : 48 % au lieu de 37 % sur le palier Plus, 36 % au lieu de 23 % sur
Pro.

## 5. Créer les produits

Une fois le contrat actif, depuis ce dépôt (le CLI `asc` est installé dans
`~/.local/bin` et authentifié sous le nom `podcapp`) :

```bash
export PATH="$HOME/.local/bin:$PATH"
asc subscriptions groups create --app 6807563809 --reference-name "Podcapp"
```

Puis une souscription par palier. Les identifiants doivent être **exactement**
ceux que le code attend (`PRODUCT_PLANS` dans `src/apple/link.ts`) :

| Identifiant produit | Palier | Prix | Période |
|---|---|---|---|
| `com.louisguichard.podcapp.plus.monthly` | plus | 9,99 € | P1M |
| `com.louisguichard.podcapp.pro.monthly` | pro | 19,99 € | P1M |

Dans le groupe, **Pro doit être au niveau 1 et Plus au niveau 2** : c'est ce qui
fait qu'un passage de l'un à l'autre est un upgrade natif géré par Apple, sans
une ligne de code de notre côté.

```bash
asc subscriptions --help          # la forme exacte des sous-commandes
asc validate --app 6807563809 --version 1.0 --output table
```

## 6. La clé d'API In-App Purchase

Différente de la clé App Store Connect qui sert aux uploads. App Store Connect →
*Users and Access* → *Integrations* → **In-App Purchase** → générer, télécharger
le `.p8` **une seule fois**.

Quatre variables à poser sur Vercel **et** sur Trigger.dev :

```
APPLE_IAP_KEY_ID      = <le key id>
APPLE_IAP_ISSUER_ID   = <l'issuer id de cette clé>
APPLE_IAP_BUNDLE_ID   = com.louisguichard.podcapp
APPLE_IAP_KEY         = <le .p8 entier, EN BASE64>
```

**En base64, impérativement.** La leçon a déjà été payée deux fois sur ce projet
(le pot de cookies YouTube, puis la clé APNs) : un champ de formulaire web
transforme les sauts de ligne en **espaces**, et un PEM sans ses sauts de ligne
n'est pas un PEM — l'erreur qui en sort ne pointe nulle part près de la cause.
`decodePem()` dans `src/apple/appstore.ts` accepte les deux formes, mais le
base64 est la voie sûre.

```bash
base64 -i ~/Downloads/SubscriptionKey_XXXXXXXX.p8 | tr -d '\n' | pbcopy
```

## 7. Le webhook des notifications

App Store Connect → l'app → *App Information* → *App Store Server Notifications*
→ **Version 2** :

```
https://podcapp.vercel.app/apple/notifications?token=<APPLE_NOTIFICATIONS_TOKEN>
```

Poser `APPLE_NOTIFICATIONS_TOKEN` sur Vercel d'abord (une valeur aléatoire :
`openssl rand -hex 32`). Renseigner **l'URL de production et celle de sandbox** —
sans la seconde, les achats du relecteur d'App Review ne notifient rien.

Le secret dans l'URL n'est pas de l'authentification : la charge utile n'est de
toute façon jamais crue. Il empêche qu'un tiers nous fasse marteler l'API
d'Apple depuis une URL devinée. Même forme que `POST /ingest/email` pour
Postmark.

## 8. Réécrire les notes de review

Elles décrivent aujourd'hui une app **sans abonnement**, et elles ont déjà été
réécrites une fois ce jour-là pour retirer un texte périmé. Elles doivent
maintenant dire :

- que le relecteur teste les paliers par **achat sandbox**, gratuit pour lui ;
- que le compte de démonstration `beta-review@podcapp.fr` est en **gratuit**,
  donc à 1 épisode par mois ;
- que le bouton Générer grisé est **le quota**, pas une panne ;
- que le bouton grisé « Share N more » est **la règle des 3 liens**, autre chose
  encore.

```bash
asc review details-update --id 213b898d-5e03-4b0d-92f8-89c24feac262 --notes "…"
```

## 9. Mesurer le coût réel — la seule étape qui peut invalider la grille

**Non faite dans cette session, et c'est le trou connu.**

La spec fait dépendre les plafonds de deux nombres — **0,55 € pour 3 min** et
**0,90 € pour 5 min** — qui sont *déduits* des constantes du dépôt
(`TTS_USD_PER_1K_CHARS = 0.15`, `WORDS_PER_MINUTE.en = 162`), **pas mesurés**.
La seule mesure directe qui existe est 2,36 $ pour un épisode de 14 min à
17 sources.

Générer un vrai épisode de chaque longueur et lire le champ `cost` de la ligne
`episodes`. **Si l'écart dépasse 20 %, les plafonds 8 et 12 doivent être
rouverts avant la mise en vente** : ils ne sont pas un choix de packaging, ils
sortent de ces deux nombres.

Coût de la mesure : environ 1,50 $ et vingt minutes. Elle demande assez de liens
non diffusés sur un compte.

---

## Ce qui, une fois tout cela fait, reste à lancer

```bash
cd ios && TEAM_ID=V7BMDJS5C7 ASC_KEY_ID=5UV866QGX3 \
  ASC_ISSUER_ID=db780c95-286b-4f79-b97c-560411a660ee \
  ASC_KEY_PATH=~/Downloads/AuthKey_5UV866QGX3.p8 ./testflight.sh
```

Puis rattacher la build à la version 1.0, revalider, et soumettre :

```bash
asc versions attach-build --version-id 01d27160-94d0-425d-9b62-9411d866eb99 --build-id <id>
asc validate --app 6807563809 --version 1.0 --output table
```

Et l'étape qui ne passe toujours pas par l'API : **publier le questionnaire App
Privacy** (il doit déclarer le Device ID pour rester cohérent avec les
`PrivacyInfo.xcprivacy`), sur
https://appstoreconnect.apple.com/apps/6807563809/appPrivacy
