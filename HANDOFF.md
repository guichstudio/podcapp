# Podcapp — passation (2026-09-01, soir)

Point d'entrée pour une nouvelle session. Le détail vit dans
[README.md](README.md) (produit, opérations) et [CLAUDE.md](CLAUDE.md)
(mémoire de travail, journal des décisions). Ce fichier dit où on en est,
ce qui vient ensuite, et ce qui piège.

## Ce qui tourne

| Brique | État |
|---|---|
| API | https://podcapp.vercel.app (Vercel Edge, Hono). Déployée depuis `main`, pnpm épinglé (`packageManager`). |
| Tâches cloud | Trigger.dev **v20260901.8**, 4 tâches : `process-source`, `generate-episode`, `daily-briefings` (06:00 Paris), `delete-account`. |
| Base | Neon, migration **0004** appliquée (colonnes `category` sur `sources` et `stories`). |
| App iOS | **b26 sur l'iPhone de Louis**. Xcode 26.6, SDK iOS 26.5, macOS 26.6.2. Signature Apple Developer Program, équipe `V7BMDJS5C7` (l'adhésion a gardé l'id de l'équipe personnelle, prouvé par un export App Store). |
| Politique de confidentialité | `GET /privacy`, anglais par défaut, français si le navigateur le demande. |

## Livré aujourd'hui (tout est commité et déployé)

1. **TestFlight, côté code** : `PrivacyInfo.xcprivacy` (2 cibles), `ITSAppUsesNonExemptEncryption`, versions pilotées par le build, iPhone seul, `ios/testflight.sh`, textes App Store Connect dans `docs/testflight.md`.
2. **Retours haptiques + 4 sons** (`ios/Podcapp/Feedback.swift`, sons régénérables par `ios/design/make-sounds.sh`), deux interrupteurs dans Réglages.
3. **Bilingue EN/FR, suit le téléphone** — interface (343 chaînes, `ios/design/make-strings.py` ← `fr-strings.json`) ET épisodes (`PUT /me/language` → `users.output_language`).
4. **Voix par langue** : Eric en anglais (choix provisoire de Louis sur test d'écoute), `writer.v2` avec débit en paramètre (fr 150 demandé/140 mesuré, en 165/162).
5. **Règles produit** : ≥ 4 liens (sources distinctes derrière les stories ouvertes, `src/jobs/material.ts`, appliqué à l'API, au cron, au pipeline, à l'app) et ≤ 5 min.
6. **App Review** : audio en arrière-plan, écran verrouillé + écouteurs, UI factice retirée, **suppression de compte in-app** (`DELETE /me` → tâche durable, déclenche PUIS révoque).
7. **Design v3** : bandeau héros paginé, anneau N/4, feuille de génération en direct, sélecteur de voix, aide « partager en 3 étapes », copie du lien RSS, « Revoir l'intro », onglet Bibliothèque avec étagères et « Générer un épisode <étagère> » ; `analyzer.v2` (+ champ `category`), `GET/PUT /me`.
8. **Eval après le prompt v2** : 53/54, 0 fusion fautive, 0 % de doublons — identique à la ligne de base.

## État du compte de Louis (le seul utilisateur)

- Téléphone en anglais → `output_language = en` → prochain épisode **en anglais, voix Eric**.
- `voice_id` NULL (défaut de langue), cible 5 min.
- 24 sources, **0 disponible** : les 4 `received` du 31 août restent en l'état (décision Louis, ne plus proposer de les traiter). Les étagères sont vides tant que de nouvelles sources n'arrivent pas.

## Prochaines actions, dans l'ordre

1. **TestFlight** : **le build 27 est en ligne** (téléversé le 2026-09-02,
   état `VALID`). Les testeurs internes l'ont ; les externes attendent la
   Beta App Review, non soumise. Reste à coller les identifiants de démo dans
   TestFlight → Test Information → « Connexion requise » (utilisateur
   `beta-review@podcapp.fr`, mot de passe = le jeton d'API du compte), puis à
   soumettre pour revue quand tu veux des testeurs externes.
   **Supprimer la clé API Admin `4M524UGZT6`** si ce n'est pas déjà fait.
2. **Beta App Review** : le compte de démonstration existe et est peuplé
   (`beta-review@podcapp.fr`, anglais, voix Eric, 5 min, 6 sources, épisode
   `a5978667-…` publié à 4 min 50). Rien à refaire.
3. **Postmark** (Louis, 5 min, voir README) puis `INGEST_ADDRESS=<adresse>` dans l'env Vercel : la ligne « Adresse d'ingestion » apparaît alors seule dans Réglages.
4. **Premier épisode anglais** : il existe — celui du compte de démo,
   `a5978667-545b-40c0-88e2-392b1bda8867`, 4 min 50, voix Eric. La porte
   qualité (4/5) n'a jamais été passée en anglais : à écouter comme le
   français l'a été, avec `eval/rubric.md`.
5. **Voix française** : toujours la voix Phase 0 via l'env Trigger ; remplacer sur test d'écoute (même méthode que pour Eric).
6. Optionnel : reclasser les anciennes sources (`category` NULL) si les étagères doivent se remplir sans attendre.

## Pièges connus (les coûteux)

- `ios/project.yml` **génère** les deux `Info.plist` : une édition à la main disparaît à la régénération. Tout va dans le yaml.
- XcodeGen n'est pas installé durablement : `curl` de la release GitHub dans `/tmp/xcodegen/` (vidé au redémarrage). N'importe quelle version depuis Xcode 26.
- Vercel construit **depuis GitHub** : commit + push AVANT `pnpm exec vercel deploy --prod --yes`, sinon on redéploie l'ancien code.
- Tâches : `pnpm dlx trigger.dev@4.5.15 deploy` après tout changement dans `src/jobs`, `src/trigger`, `src/prompts`, `src/config.ts`.
- SwiftUI ne traduit que `Text("…")` ; un `String` passé à un helper (`label:`, `fieldLabel("…")`) doit être enveloppé dans `String(localized:)`. Après tout ajout : compléter `ios/design/fr-strings.json` puis `python3 ios/design/make-strings.py`.
- Lancer le simulateur avec le **vrai** jeton fait remonter SA langue au serveur et bascule le compte. Utiliser un jeton factice, ou remettre la langue après (`PUT /me/language`).
- Le prototype Claude Design v3 ne se rend pas fidèlement hors de son hôte ; sa logique est extraite dans le scratchpad de la session (`design-v3/logic.js`) — repartir des textes, pas des captures.
- Une page bloquée par un anti-bot peut passer la porte d'extraction : AP News
  a marqué 0,37 pour `MIN_EXTRACTION_QUALITY = 0,35`, est entrée dans le
  matériau sous le titre « Page unavailable », et l'outro a affirmé qu'aucune
  source n'avait échoué. Rien d'infondé n'est parti à l'antenne (le rédacteur ne
  l'a pas retenue) mais l'affirmation de l'outro est fausse. Le score seul ne
  sépare pas un article maigre d'une page de blocage : il faut un signal de
  forme. Non corrigé.
- Un prompt est un actif versionné : jamais d'édition en place, copier en vN+1, basculer dans `config.ts`, puis `pnpm eval:run`.

## Commandes utiles

```
pnpm test · pnpm exec tsc --noEmit · pnpm eval:run
pnpm exec vercel deploy --prod --yes · pnpm dlx trigger.dev@4.5.15 deploy
cd ios && xcodegen generate --spec project.yml
xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build
xcrun devicectl device install app --device FEE86561-3A03-5119-BCB2-A8C6C300D13F <chemin .app>
```
Incrémenter `CURRENT_PROJECT_VERSION` dans `project.yml` à chaque installation (le `b<N>` s'affiche dans l'onboarding).
