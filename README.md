# Podcapp

Votre radio quotidienne : sourcée par vous, vérifiée par nous.

Podcapp transforme ce que vous n'avez pas eu le temps de lire ou de regarder
(articles, vidéos, threads, PDF, newsletters) en un briefing audio d'environ
10 minutes, en français, avec chaque phrase vérifiée contre ses sources. Les
épisodes arrivent dans votre application de podcast habituelle via un flux RSS
privé, et dans l'app iOS Podcapp.

Ce document est le point d'entrée : ce qui existe, comment s'en servir, comment
l'opérer. Les contrats techniques détaillés vivent dans [ARCHITECTURE.md](ARCHITECTURE.md),
la mémoire de travail dans [CLAUDE.md](CLAUDE.md).

---

## Ce qui tourne aujourd'hui (2026-09-01)

| Brique | État | Où |
|---|---|---|
| API de capture et de lecture | En prod | https://podcapp.vercel.app (Vercel Edge, Hono) |
| Base de données | En prod | Neon Postgres + pgvector |
| Stockage audio, flux RSS, console | En prod | Cloudflare R2 (bucket public) |
| Jobs durables (extraction, génération) | En prod | Trigger.dev v4, projet `proj_ppdrrnrfsnmtqphobkec` |
| App iOS + extension de partage | Sur l'iPhone de Louis (b16+) | `ios/`, signature Apple ID gratuite (7 jours) |
| Briefing automatique du matin | Planifié 06:00 Europe/Paris | tâche `daily-briefings` |
| Email entrant (newsletters) | Webhook prêt | `POST /ingest/email` (reste : compte Postmark, voir plus bas) |

Chiffres au moment de l'écriture : 24 sources capturées, 2 épisodes publiés
(~21 minutes d'audio), premier épisode 100 % cloud généré en 4 min 35 de
calcul pour ~1 $ tout compris.

## Comment on s'en sert

**Capturer.** Trois chemins, tous vers la même base :

1. **Partager depuis l'iPhone** : bouton Partager → Podcapp, depuis Safari,
   YouTube, X, etc. L'extension envoie l'URL à `POST /ingest`.
2. **Transférer une newsletter** par email vers l'adresse inbound (une seule
   adresse pour tous les testeurs : c'est l'ADRESSE D'EXPÉDITION qui identifie
   l'utilisateur, comparée à `users.email` sans tenir compte de la casse).
3. **API directe** : `POST /ingest` avec `Bearer <api_token>` et
   `{ url }`, `{ text }` ou `{ html, subject }`.

Chaque capture est extraite, analysée, vectorisée et regroupée en "stories"
dans le cloud, en une minute environ. Les échecs ne sont jamais silencieux :
chaque source porte un statut lisible (`ready`, `duplicate`, `low_quality`,
`extraction_failed`...), et les emails refusés atterrissent dans la table
`events`.

**Écouter.** Chaque matin à 06:00 (Paris), si des stories non couvertes
existent, un épisode est généré automatiquement : sélection éditoriale,
écriture, vérification phrase par phrase contre les sources, correction, voix
ElevenLabs, assemblage FFmpeg, publication. Sinon : pas d'épisode, plutôt que
du remplissage. Le bouton Générer de l'app fait la même chose à la demande
(garde anti-doublon : 409 tant qu'une génération est en cours, moissonnage des
runs morts après 30 minutes).

**Vérifier.** L'app montre, pour chaque épisode, le rapport de vérification :
phrases VÉRIFIÉES, phrases CORRIGÉES (avec l'original barré), phrases coupées,
sources écartées et pourquoi, budget d'antenne par story, et le coût réel de
l'épisode.

## Le pipeline, en une ligne

```
capture → extract → analyze → embed → cluster (stories)
       → select + outline → write → ground → edit → TTS → FFmpeg → R2 → RSS
```

Modèles (voir `src/config.ts`) : DeepSeek V4 Flash/Pro sur l'analyse, l'arbitrage
de clustering, la vérification et l'éditorial ; **Claude Sonnet à l'écriture**
(le rédacteur reste frontier-class, c'est une règle du projet) ; embeddings
Jina ; voix ElevenLabs `eleven_multilingual_v2`. Épisodes plafonnés à 10 min.

## Opérations

### Commandes (depuis `~/Code/podcapp`)

```
pnpm test                  # 76 tests
pnpm exec tsc --noEmit     # typecheck (ne jamais masquer le code de sortie)
pnpm eval:run              # pipeline complet sur le dataset gelé → métriques
pnpm eval:episode          # stories → script (~0,43 $, ~8 min)
pnpm exec vercel deploy --prod          # déploie l'API
pnpm dlx trigger.dev@4.5.15 deploy      # déploie les tâches cloud
```

### iOS (depuis `ios/`)

Le projet Xcode est GÉNÉRÉ : modifier `project.yml` puis
`xcodegen generate --spec project.yml` (binaire dans `/tmp/xcodegen/`). À chaque
installation sur téléphone : incrémenter `CURRENT_PROJECT_VERSION` (le numéro
s'affiche à côté du logo dans l'onboarding, c'est le seul moyen fiable de
savoir quelle version tourne), désinstaller puis :

```
xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos \
  -configuration Debug -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build
xcrun devicectl device install app --device <UDID> <chemin du .app>
```

La signature Apple ID gratuite expire au bout de 7 jours : réinstaller, ou
passer au Developer Program (99 $/an) pour TestFlight.

### Secrets

Tous dans `.env` (jamais commité) et recopiés dans les dashboards Vercel et
Trigger.dev : `DATABASE_URL`, `R2_*`, `ELEVENLABS_API_KEY`, `DEEPSEEK_API_KEY`,
`ANTHROPIC_API_KEY`, `JINA_API_KEY`, `TRIGGER_SECRET_KEY`,
`POSTMARK_INBOUND_TOKEN`.

### Débogage

Chaque run d'épisode persiste TOUS ses artefacts intermédiaires (sélection,
plan, brouillons, rapport de vérification, script final, coûts). Le rapport de
vérification vit sur la ligne `episodes.grounding` en base, pas sur le bucket :
le bucket est public par nécessité (les apps de podcast téléchargent l'audio
sans auth). Les runs cloud se lisent sur cloud.trigger.dev.

## Coûts (ordre de grandeur, par épisode de 10 min)

| Poste | Coût |
|---|---|
| LLM (analyse + éditorial + écriture + vérification) | ~0,15 $ |
| ElevenLabs TTS multilingual_v2 | ~0,85 $ |
| Calcul Trigger.dev | ~0,01 $ |
| **Total** | **~1 $** |

La voix domine. Toute optimisation de coût future se joue là (et jamais sur le
modèle rédacteur).

## Ce qui reste

1. **Compte Postmark** (action Louis, 5 min) : postmarkapp.com → serveur par
   défaut → Default Inbound Stream → Settings → coller l'URL de webhook
   `https://podcapp.vercel.app/ingest/email?token=<POSTMARK_INBOUND_TOKEN du .env>`,
   puis noter l'adresse `...@inbound.postmarkapp.com`. C'est l'adresse à
   laquelle transférer les newsletters.
2. **Apple Developer Program** (99 $/an) pour TestFlight et les vrais beta
   testeurs (aujourd'hui : un seul utilisateur en base, jetons émis à la main).
3. **Voix** : remplacer la voix Phase 0 par une voix plus fluide, type Jarvis
   (choix sur test d'écoute).
4. Cosmétique et robustesse listées dans CLAUDE.md (heuristique d'extraction
   sur les pages de section, fallback Playwright non nécessaire à ce jour).

## Audit final (2026-09-01)

Un audit multi-agents (5 axes : justesse API, justesse iOS, latence, français,
sécurité), chaque trouvaille contre-vérifiée par un agent adverse, a confirmé
23 défauts réels. Tous corrigés le jour même :

**Latence.** `GET /episodes` transportait les scripts complets de 50 épisodes
pour n'afficher que des titres de chapitres : la projection se fait maintenant
en SQL (réponse ~1,5 Ko au lieu de dizaines de Ko). `GET /sources` fait ses
deux requêtes en parallèle. L'app charge le détail du hero en parallèle des
sources, met en cache les articles lus, et surtout **met l'audio en cache
local** : un épisode publié étant immuable, il n'est plus re-téléchargé depuis
R2 à chaque lecture.

**Justesse.** Un index unique partiel (`episodes_one_active_per_user`) ferme
la course entre deux générations simultanées (double tap, cron vs bouton) que
la garde applicative seule ne pouvait pas fermer sans transaction. Un run
`generate-episode` re-vérifie que sa ligne est encore `queued` avant de payer
rédacteur et TTS (un run retardé ne ressuscite plus un épisode moissonné). Un
timeout d'envoi au cloud laisse l'épisode en file au lieu de le déclarer
faussement mort. Côté iOS : un item audio en échec est reconstruit au lieu
d'être rejoué en silence, l'état lecture/pause suit le player système (appel,
Siri, écouteurs débranchés), et la détection du conteneur App Group est
devenue honnête (`containerURL`, pas `UserDefaults(suiteName:)`).

**Sécurité.** L'email du compte ne figure plus dans le XML du flux (bucket
public). La console n'est plus dérivable de l'URL du flux (jeton propre dérivé
du secret API ; les anciens chemins sont écrasés par une pierre tombale). Les
sources citées par la console sont filtrées par propriétaire. Le webhook email
rejette les SPF en échec dur (le routage par expéditeur reste un risque bêta
assumé et journalisé).

**Coquilles.** Pluriels accordés ("1 chapitre", "1 autre sujet écarté"),
féminins accordés ("Vérifiée"/"Corrigée" pour une phrase), apostrophes
typographiques partout, description du flux en français, flux renommé
"Podcapp".

## Historique des jalons

- **Phase 0** (2026-08-28) : golden path manuel, 5 sources réelles → script
  vérifié à la main → épisode de 10 min. Validé à l'écoute.
- **Phase 1** (2026-08-29) : couche de connaissance (extract → analyze →
  embed → cluster), 53/54 sources, 0 % de doublons ratés.
- **Phase 2** (2026-08-31) : éditorial complet, 0 phrase non sourcée expédiée,
  note 4/5 (seuil : 3,5). **La porte qualité du projet est passée.**
- **Phase 3** (2026-08-31) : audio + RSS privé sur R2, lisible dans une app de
  podcast.
- **App iOS** (2026-08-31) : app SwiftUI 4 onglets + extension de partage +
  onboarding fidèle au design "vfinal", installée sur iPhone.
- **Phase 4** (2026-09-01) : capture live complète, génération 100 % cloud,
  webhook email, briefing automatique du matin.
