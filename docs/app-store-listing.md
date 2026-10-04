# Fiche App Store — ASO

**Poussé dans App Store Connect le 2026-10-04** (API, clé `5UV866QGX3`), version 1.0 en préparation, en-US et fr-FR, relu depuis le serveur. **Mis à jour le même jour : la 1.0 sort sans les formules** (`FREEMIUM_ENFORCED` éteint, aucune borne de palier). La section PLANS est retirée, la durée dit « trois à cinq minutes, au choix » et le sous-titre 5 min, ce que l'app fait sans palier. Le jour où les formules s'allument, remettre la section (texte dans l'historique git de ce fichier) et revoir la durée. Les textes de la
fiche sont en anglais (langue principale en-US, marché visé) ; la localisation
française est en fin de fichier. Le sous-titre `Your daily audio briefing`
enregistré le 2026-09-01 (voir [testflight.md](testflight.md)) est remplacé.

Mesuré le 2026-10-04 avec Astro (store US, iPhone) : environ 300 mots-clés
suivis sous une app temporaire « Podcapp ». La **popularité** est l'échelle
d'Apple Search Ads (5 à 100, **5 est le plancher** : « trop peu de données »,
pas « zéro recherche ») ; la **difficulté** est une estimation d'Astro. Les deux
servent à comparer des termes entre eux, pas à prédire un volume.

## Règle tenue

Rien de visible ne promet ce que le produit ne fait pas. Tant que les
formules sont éteintes, l'app génère chaque matin dès 3 liens, en 3 à 5 min
au choix (5 par défaut) : le sous-titre dit 5 min. Si les paliers s'allument
(1, 8 et 12 épisodes par mois, 3 min sauf Pro), il faudra repasser le
sous-titre à 3 min et ne plus rien promettre de quotidien.

**Newsletters** : écartées tant que l'adresse d'ingestion n'existe pas
(Postmark non créé, l'app la cache). À ajouter (description + mots-clés) le
jour où elle existe.

Aucun nom de marque concurrente nulle part (Pocket, Speechify, NotebookLM,
Snipd… sont populaires mais la règle 2.3.7 les interdit dans les métadonnées).

## en-US (fiche principale)

| Champ | Valeur | Car. |
|---|---|---|
| Nom | `Podcapp: AI News Podcast` | 24/30 |
| Sous-titre | `Your 5-minute morning briefing` | 30/30 |
| Mots-clés | `stay,informed,tldr,summary,bookmark,info,listen,headlines,accurate,daily,digest,article,brief,recap` | 99/100 |
| Texte promotionnel | `Share any article or video. Get a short podcast about it, where every sentence is checked against its sources before it is recorded.` | 132/170 |

Apple combine les mots du nom, du sous-titre et du champ mots-clés entre eux :
aucun mot n'est répété d'un champ à l'autre, ce serait de la place perdue.

### Pourquoi ces mots

| Requête couverte | Pop. | Diff. | Concurrence en tête |
|---|---|---|---|
| minute | 50 | 13 | — |
| info | 36 | 19 | — |
| bookmark | 30 | 17 | apps de favoris, < 600 avis |
| morning | 28 | 11 | journaux de gratitude, < 300 avis |
| summary app | 27 | 15 | une app forte, le reste faible |
| stay informed | 24 | 5 | 0 à 24 avis |
| tldr | 24 | 5 | 1 à 83 avis |
| listen | 19 | 23 | — |
| ai news | 16 | 9 | Particle (1 236 avis), puis ≤ 6 avis |
| ai podcast | 16 | 17 | Gemini Notebook, puis Castify/Snipd ~1 000 |
| headlines | 16 | 19 | ≤ 109 avis |
| accurate | 14 | 19 | — |
| briefing | 14 | 7 | ≤ 136 avis |
| morning briefing | 5 | 5 | ≤ 55 avis, quatre clones « AI Morning Briefing » |
| ai news podcast | 5 | 7 | 0 à 155 avis |

Volontairement absents du nom malgré leur popularité : `news` (69/85),
`podcast` seul (67/77), `ai` seul (80/90), `daily` (45/81) — inaccessibles pour
une app sans avis, ils servent ici de **liants** (`ai news`, `ai podcast`,
`news podcast`, `morning briefing`, `daily digest`…).

### Description

Non indexée par Apple sur iOS : elle sert à convertir, pas à être trouvé.

```
Podcapp turns the links you saved but never got to into a short podcast you can actually finish.

Share an article or a video from any app. Podcapp reads it, groups the pieces that cover the same story, writes a briefing of a few minutes and narrates it, so you can hear it on the way to work instead of reading forty tabs you never opened.

It only ever uses what you saved. Nothing is invented, and nothing arrives from anywhere else.

WHAT IT DOES

• Save from anywhere. Share to Podcapp from Safari, YouTube, Threads or any app. Videos are transcribed.
• Your briefing is ready in the morning once you have three links, or make one right away from the links you pick.
• Three to five minutes, your choice, one chapter per story.
• Read along. Every chapter shows its text and the sources behind it, and you can open the original.
• In your language. English or French, following your phone. A source in another language is summed up in yours.
• Shelves by topic. Make a tech, finance or science episode from just those links.
• Your narrator. Pick the voice that reads your briefing.
• Listen anywhere. In the app, from the lock screen, or as a private podcast feed in the player you already use.

BUILT TO BE TRUSTED

Every factual sentence is checked against the evidence it was written from, and anything the check cannot support is rewritten or cut before the episode is narrated. The app shows you the report: how many sentences were checked, which ones were rewritten, which sources were set aside. A link the app could not read is named rather than summed up from memory.

No advertising, no tracking.

Terms: https://podcapp.fr/terms
Privacy: https://podcapp.fr/privacy
```

### Captures d'écran

Les trois premières sont les seules vues sans défiler dans les résultats de
recherche. Légendes proposées, une idée par capture, mots-clés en tête quand
c'est naturel (Apple lirait aussi le texte des captures, selon plusieurs
observateurs, non confirmé officiellement) :

1. **Your links, as a 3-minute podcast** — écran Aujourd'hui avec l'épisode
2. **Share from any app** — feuille de partage iOS avec Podcapp
3. **Every sentence checked against its sources** — panneau des sources
4. **Chapters you can skip** — lecteur avec les repères de chapitres
5. **Make an episode from one topic** — Bibliothèque, étagères

## Emplacement supplémentaire indexé aux États-Unis (optionnel)

Le store US indexe aussi la localisation **espagnol (Mexique)**. Une
localisation es-MX dont les champs restent en anglais donne 100 caractères de
mots-clés de plus pour les recherches américaines ; les utilisateurs mexicains
verraient la fiche en anglais, comme l'app. Proposition :

| Champ | Valeur | Car. |
|---|---|---|
| Nom | `Podcapp: AI News Podcast` | 24/30 |
| Sous-titre | `Your 5-minute morning briefing` | 30/30 |
| Mots-clés | `summarizer,curated,commute,aloud,read,later,saved,links,video,transcript,learn,knowledge,research` | 97/100 |

Vérifier d'abord la table « Localizations » d'App Store Connect Help : la liste
des langues indexées par pays a déjà changé.

## fr-FR

Marché secondaire (testeurs). Environ 160 termes mesurés sur le store FR, où
presque tout est au plancher de popularité. Deux pièges d'intention :
**« résumé » y veut dire CV** (top 8 = générateurs de CV) et **« bref » renvoie
à la banque BRED** — tous deux écartés malgré leur pertinence apparente.

| Requête | Pop. | Diff. | Note |
|---|---|---|---|
| actualités | 56 | 68 | quotidiens à 50–100 k avis : liant plus que cible |
| info | 53 | 70 | idem |
| information | 47 | 65 | |
| podcasts | 34 | 58 | le pluriel n'est pas garanti par la racine |
| infos | 26 | 65 | |
| voix | 24 | 48 | |
| actu | 23 | 67 | dans le nom, poids maximal |
| lecture rapide | 21 | 9 | meilleur ratio du store FR ; vrai au sens « sans lire » |
| quotidien | 20 | 55 | |
| actus | 19 | 44 | |
| briefing | 18 | 7 | concurrence quasi nulle (0 avis) |
| recap | 9 | 21 | |
| podcast ia | 5 | 40 | Gemini Notebook, puis ≤ 118 avis |

Le nom passe de « podcast IA du matin » à « actu en podcast IA » : `matin`
(5) et `du` ne rapportaient rien, `actu` (23) si, et il forme `podcast ia`,
`actu ia`, `podcast actu`.

| Champ | Valeur | Car. |
|---|---|---|
| Nom | `Podcapp : actu en podcast IA` | 28/30 |
| Sous-titre | `Votre briefing audio en 5 min` | 29/30 |
| Mots-clés | `actualités,actus,info,infos,information,journal,podcasts,voix,lecture,rapide,quotidien,recap,veille` | 99/100 |
| Description | voir ci-dessous |  |
| Texte promotionnel | `Partagez un article ou une vidéo. Recevez un court podcast, où chaque phrase est vérifiée contre ses sources avant d'être enregistrée.` | 134/170 |

Description fr-FR :

```
Podcapp transforme les liens que vous avez gardés sans jamais les lire en un court podcast que vous écouterez jusqu'au bout.

Partagez un article ou une vidéo depuis n'importe quelle app. Podcapp le lit, regroupe ce qui parle de la même histoire, écrit un briefing de quelques minutes et le raconte : vous l'écoutez sur le trajet au lieu de rouvrir quarante onglets.

Il n'utilise que ce que vous avez gardé. Rien n'est inventé, rien ne vient d'ailleurs.

CE QU'IL FAIT

• Enregistrez depuis partout. Partagez vers Podcapp depuis Safari, YouTube, Threads ou n'importe quelle app. Les vidéos sont transcrites.
• Votre briefing est prêt le matin dès que vous avez trois liens, ou créez-en un tout de suite avec les liens de votre choix.
• De trois à cinq minutes, au choix, un chapitre par sujet.
• Lisez en écoutant. Chaque chapitre montre son texte et les sources derrière, et vous pouvez ouvrir l'original.
• Dans votre langue. Français ou anglais, selon votre téléphone. Une source dans une autre langue est résumée dans la vôtre.
• Des étagères par thème. Faites un épisode tech, finance ou science avec ces seuls liens.
• Votre narrateur. Choisissez la voix qui lit votre briefing.
• Écoutez partout. Dans l'app, depuis l'écran verrouillé, ou en flux de podcast privé dans le lecteur que vous utilisez déjà.

FAIT POUR QU'ON LUI FASSE CONFIANCE

Chaque phrase factuelle est vérifiée contre les sources dont elle vient, et ce que la vérification ne confirme pas est réécrit ou coupé avant l'enregistrement. L'app vous montre le rapport : combien de phrases vérifiées, lesquelles réécrites, quelles sources écartées. Un lien illisible est nommé plutôt que résumé de mémoire.

Ni publicité, ni pistage.

Conditions : https://podcapp.fr/fr/terms
Confidentialité : https://podcapp.fr/fr/privacy
```

## Après la mise en vente

Remplacer l'app temporaire dans Astro par la vraie (`6807563809`) pour suivre
les classements réels, et revoir les mots-clés à 4 semaines : on garde ceux où
l'app entre dans le top 10, on remplace ceux où elle reste hors du top 50.
