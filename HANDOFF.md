# Podcapp — passation (2026-09-05, fin de journée)

Point d'entrée pour une nouvelle session. Le détail vit dans
[README.md](README.md) (produit, opérations) et [CLAUDE.md](CLAUDE.md)
(mémoire de travail, journal des décisions). Ce fichier dit où on en est, ce
qui vient ensuite, et ce qui piège.

> **Mise à jour 2026-10-04 — b36 : support in-app et feedback.** Le push n'avait JAMAIS enregistré un seul appareil (0 jeton pour 10 comptes) : c'est réparé et vérifié au simulateur avec une vraie notification APNs. Le « seul point ouvert » ci-dessous est donc clos côté code ; il reste à le confirmer sur un vrai iPhone avec la b36. Nouveau : chat de support (raccourci en haut à droite d'Aujourd'hui), page admin `https://podcapp.vercel.app/admin/support` (jeton `ADMIN_TOKEN` dans `.env`), bouton « Demander un feedback ». Détail dans CLAUDE.md. À FAIRE PAR LOUIS : ouvrir la b36 sur son iPhone (enregistre son jeton, sinon pas d'alerte « nouveau message »), étiquette de confidentialité App Store Connect → ajouter « Support client ». b36 diffusée aux groupes Interne et Beta publique le 2026-10-04 (IN_BETA_TESTING). SUITE DU MÊME JOUR : premier appareil réel enregistré (l’iPhone de Louis, après son premier message au support), première demande de feedback envoyée (en : 4 fils, fr : 1 fil), titre des notifications signé « Louis, founder of Podcapp, sent you a message » (worker 20261004.2, reçu sur l’iPhone). b37 diffusée aux deux groupes : elle demande l’autorisation au lancement quand iOS ne l’a jamais fait — sans elle, un testeur qui n’écrit pas au support ne reçoit jamais rien.

---

## En une phrase

Tout tourne — capture depuis le téléphone, vidéos comprises, traitement et
génération dans le cloud, flux RSS, **b34 sur TestFlight en public** — sauf
**les notifications push, dont l'enregistrement de l'appareil n'a jamais eu
lieu** ; c'est le seul point ouvert et il est instrumenté pour se diagnostiquer
tout seul.

---

## État vérifié

| | |
|---|---|
| API | Vercel, `podcapp.vercel.app` — `/health` 200, `/privacy` 200, `/episodes` sans jeton 401 |
| Worker | Trigger.dev `20260905.3` |
| iOS | **b34** distribuée aux groupes *Interne* et *Beta publique*, revue beta APPROVED |
| Lien public | `https://testflight.apple.com/join/MXSY1gGy` |
| Tests | **152 / 152** |
| Dépôt | `main`, **6 commits non poussés** — voir Prochaine action |

---

## Ce que la journée a produit

### Les vidéos marchent, et la leçon n'était pas celle attendue

YouTube refuse **toute adresse de centre de données**, et un pot de cookies
valide n'y change **rien** : la comparaison avec et sans cookies dans la même
région donne le refus identique au caractère près. Ce n'était pas l'identité,
c'était l'adresse.

Ce qui a résolu : **`YOUTUBE_PROXY`**, un proxy résidentiel IPRoyal. Les six
combinaisons mesurées sont dans README.md. Facebook suit sur les formes dont le
chemin dit vidéo (`/share/r/`, `/share/v/`, `/watch`, `/reel/`, `/videos/`,
`fb.watch`) — deux liens sur trois testés ; le troisième est un trou dans
l'extracteur Facebook de yt-dlp, dernière version, avec et sans proxy.

Coût dérisoire : les sous-titres d'une vidéo de 18 min pèsent **168 Ko** contre
17,9 Mo pour son audio. Un gigaoctet non expirant vaut des milliers de vidéos.

`YOUTUBE_COOKIES` a été **supprimé** de la production. Le mécanisme reste dans
le code, inutilisé, il ne coûte rien.

### Le rédacteur ne peut plus déguiser une contrainte en jugement

Un épisode a diffusé 2 des 4 liens partagés. La cause était **arithmétique** :
`editorial.v1` imposait 60 s plancher par section, un épisode de 3 min a 120 s
de budget, donc deux sections — et le rédacteur, tenu d'inscrire chaque story
quelque part, a **inventé des motifs de qualité** pour ce qu'il ne pouvait pas
caser. Un énoncé faux dans un artefact qui sert de preuve.

`editorial.v2` : plancher 25 s, couvrir prime sur approfondir, et un manque de
place doit **le dire** (`over budget: N seconds for M stories`).
`MIN_SOURCES_PER_EPISODE` **4 → 3**.

Vérifié sur un vrai épisode : 4 liens choisis → **4 chapitres, 0 écarté**.

### Le score de qualité conseille au lieu de refuser

Il lit la densité de prose, mauvais juge de ce qu'on a voulu sauver :
transcription, live, thread, page de chiffres. Le plancher de **caractères**
reste — c'est l'outil net contre une page anti-bot. Le score part au rédacteur
(`weakest_source_quality`) et s'affiche en pastille **LECTURE FAIBLE**.

L'eval a donné raison à ce changement : `missed_merges` 1 → **0**,
`dup_story_rate` 0,091 → **0**. Une source que le seuil jetait était la moitié
manquante d'une paire. Le même filtre bloquait aussi dans `extractEmail`, il y a
été retiré aussi.

### Authentification, partage, interface

- **Sign in with Google** sans le SDK — `ASWebAuthenticationSession` + PKCE,
  zéro dépendance. Vérifié de bout en bout par Louis.
- **L'extension de partage était masquée** dès qu'un lien s'accompagnait d'une
  image d'aperçu — Threads notamment. Règle d'activation passée en prédicat
  SUBQUERY, six types acceptés.
- **PDF** : le texte est lu sur le téléphone (PDFKit) et envoyé en
  `{ text, title }`. Un scan sans couche texte le dit.
- **Mail** : partagé depuis l'app Mail en `{ html, subject }`, la forme que le
  serveur accepte depuis les newsletters transférées.
- **Swipe latéral** entre onglets, sans casser le rail de catégories ni le
  balayage des lignes.
- **Épisode à partir de liens choisis**, qui ignore volontairement le statut des
  stories : « refaire avec ces liens » est une demande de réutiliser.
- **Loader sur l'accueil** tant qu'un briefing se fabrique, quelle que soit son
  origine, avec relance toutes les 10 s attachée à l'identifiant de l'épisode.

### Deux bugs trouvés en vérifiant autre chose

- **Repartager un article plantait le job** et laissait la source bloquée en
  `extracting` pour toujours : la branche doublon écrivait le vrai hash, que
  l'index unique interdit. Strandait des lignes depuis le 3 septembre.
- **Le jeton de partage `is=` de l'app YouTube** n'était pas retiré par
  `canonicalizeUrl`, donc la même vidéo partagée deux fois ne dédoublonnait
  jamais.

---

## Le seul point ouvert : le push

**Ce qui est certain :**

- le serveur fonctionne — `POST /me/push-token` appelé à la main répond `ok` et
  la ligne apparaît en base
- l'app n'a **jamais** appelé — zéro jeton, alors que l'épisode était `ready`
- donc ça casse entre la demande d'autorisation iOS et l'envoi

**Ce qui a été mal fait :** les deux chemins d'échec étaient **silencieux**
(erreur d'enregistrement APNs avalée, envoi au serveur en `try?`). Impossible de
dire lequel a lâché. C'est le même silence qui avait coûté un après-midi sur
l'extension de partage.

**Réparé en b34** : les deux erreurs sont conservées et la ligne **Réglages →
Notifications** affiche l'état réel — *Actives sur cet appareil*, *Refusées dans
les Réglages iOS*, *En attente du jeton de l'appareil…*, ou l'erreur elle-même.

**Prochaine étape :** ouvrir Réglages sur la b34 et lire cette ligne. Elle
désigne l'étape fautive. La question qui coupe l'arbre en deux : *est-ce qu'iOS
a montré une fenêtre d'autorisation ?*

Tout le reste du push est en place et vérifié : clé APNs `BRT2X5BBBA` posée sur
Trigger (`APNS_KEY` en base64, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`),
signature ES256 validée contre la vraie clé (64 octets `r|s`, `prime256v1`),
table `push_tokens` migrée sur Neon, envoi après publication qui avale ses
propres erreurs pour ne jamais faire échouer un épisode publié.

---

## Les pièges payés aujourd'hui — à ne pas repayer

**Un champ de formulaire web transforme les sauts de ligne en ESPACES.** Un pot
de cookies de 44 lignes est arrivé sur une ligne du même nombre d'octets ;
yt-dlp l'a lu comme un commentaire et a chargé zéro cookie, sans que rien n'ait
l'air faux. D'où le base64 pour `YOUTUBE_COOKIES` **et** pour `APNS_KEY`, et un
refus bruyant plutôt qu'un repli silencieux.

**`execFile` recopie tout l'argv dans l'erreur**, et yt-dlp écrit sur stderr la
ligne rejetée d'un pot mal formé — nom **et valeur** du cookie — que
`--no-warnings` n'atteint pas. Les deux finissaient dans `sources.error`, que
`GET /sources` affiche dans l'app. `message()` filtre les deux formes et masque
toute URL à identifiants (le proxy en porte un).

**Une sonde de diagnostic qui imprime un champ dérivé d'un secret le recrache en
entier** quand ce secret tient sur une ligne. C'est arrivé.

**`pnpm eval:run` avec `.env` chargé écrit dans NEON** (production) et meurt sur
`users_email_unique`. Il faut charger les clés et `unset DATABASE_URL`.

**Activer une capacité invalide les profils de provisioning.** Push a fait
passer « Podcapp Dev » en `INVALID` et a aussi périmé le profil App Store en
cache d'Xcode (`~/Library/Developer/Xcode/UserData/Provisioning Profiles/`),
d'où un `EXPORT FAILED`. Méthode qui marche : régénérer par l'API ASC, supprimer
le profil en cache, et **lancer une build de contrôle avant d'écrire la moindre
ligne de code** pour séparer un problème de signature d'un problème de code.

**`PlistBuddy` supprime les guillemets** autour de `"public.url"`, et un littéral
non quoté devient un chemin de clé — la règle d'activation n'aurait jamais
matché. Écrire le plist avec `plistlib` et **relire** pour vérifier.

**XcodeGen n'est pas installé** : `project.yml` et le `pbxproj` doivent porter
la même modification, sinon la prochaine régénération annule en silence.

**`GET builds/{id}/betaGroups` renvoie une liste vide** alors que l'assignation
a réussi — vérifier dans l'autre sens, `GET betaGroups/{id}/builds`.

**En SwiftUI, une vue transparente posée derrière un `ScrollView` ne reçoit pas
le tap** : le défilement gagne le test de collision. Pour fermer un clavier, il
faut `simultaneousGesture` — mesuré, pas supposé.

---

## Prochaines actions

1. **Lire Réglages → Notifications** sur la b34 et me dire ce qu'affiche la
   ligne. C'est la seule chose qui bloque le push.
2. **Pousser les 6 commits** en attente : `git push origin main`. Vercel
   construit depuis GitHub, donc un futur déploiement repartirait sinon d'un
   dépôt en retard.
3. **Ménage local** : compte Google jetable dans Brave à déconnecter,
   `yt-cookies.txt` et `yt-cookies-clean.txt` à supprimer du Bureau. Ils ne
   servent plus depuis le proxy.
4. **Révoquer la clé API Admin `4M524UGZT6`** quand les uploads seront finis ;
   les `.p8` traînent dans `~/Downloads`.
5. **Tester sur le téléphone** ce qui n'a jamais été vérifié en conditions
   réelles : partage d'un lien **Threads**, d'un **PDF**, d'un **mail**.
6. Optionnel, et meilleur que le proxy s'il aboutit : **ticket au support
   ElevenLabs**. Leur doc promet `source_url` sur YouTube, leur produit le fait,
   leur API répond 400 sur neuf vidéos alors que le même appel avale un mp3 de
   342 s depuis notre bucket.

---

## Comptes multiples, à savoir

Louis a plusieurs comptes : deux Apple (un avec adresse, un en relais privé),
un Google (`laphotodepapa@gmail.com`), plus `design-check@podcapp.test` pour les
tests. Ce sont des bibliothèques séparées, c'est voulu, et le relais privé ne
pourra **jamais** fusionner automatiquement faute d'adresse vérifiable. Un lien
partagé se range dans le compte où l'app est connectée — c'est ce qui explique
un épisode qui « oublie » des liens.
