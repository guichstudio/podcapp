# Phase 0 : analyse des sources (étape « analyze », faite à la main)

Épisode test du 2026-08-28. Langue de sortie : FR. Cible : ~10 min.

## S1 : dossier d'exposition « The Space Between Us » (PDF, 23 p., FR/EN)
- type: pdf (hors scope V1, accepté en Phase 0 : le pipe n'est pas ce qu'on teste)
- extraction_quality: 0.9 (texte complet, mise en page perdue)
- summary: Dossier d'exposition du photographe Louis Guichard (né en 1997) : trois mois en Chine, de Wudang à Hunchun, 35 mm argentique sans retouche, autour de ce qui existe « entre les gens ».
- topics: photographie, exposition, Chine
- entities: Louis Guichard, Wudang, Chongqing, Xi'an, Hong Kong, Hunchun
- claims clés (evidence = pages du dossier) :
  - 3 mois de voyage, Wudang → Hunchun via Chongqing, Xi'an, zones rurales (p2)
  - 2 mois dans une école traditionnelle de kung-fu à Wudang (p2, p19)
  - 5 mouvements : Transmit (Wudang), Coexist (Chongqing), Belong (Hong Kong), Share (Chine rurale), Boundaries (Hunchun) (p19)
  - Hunchun : le territoire chinois se resserre entre Russie et Corée du Nord (p2)
  - 100 % 35 mm argentique, sans retouche (p2, p21)
  - formats, tirages, éditions laissés ouverts à la discussion (p21)

## S2 : vidéo X @QuiverQuant « Claude peut trader » (6 min 50, EN, publiée aujourd'hui 28/08)
- type: video x (transcript Scribe, quality 0.95)
- summary: Démo : Claude relié par MCP à Quiver Quant (données élus/insiders/hedge funds) et à un compte Alpaca en paper trading passe des ordres, réplique la stratégie « Congress buys » et backteste la stratégie Pelosi.
- topics: IA, trading, agents
- entities: Quiver Quantitative, Alpaca, Claude, MCP, Apple, Congress buys, Pelosi
- claims clés (evidence = transcript + texte du tweet) :
  - Claude passe des ordres en un seul prompt via 2 serveurs MCP (Quiver + Alpaca)
  - paper trading : argent simulé, aucun accès aux vrais comptes
  - démo : vendre les positions, acheter 1 action Apple, répliquer « Congress buys » (meilleure stratégie historique de Quiver)
  - backtest « Pelosi strategy » vs marché, graphique en ligne
  - limite : pas de rééquilibrage automatique avec un compte gratuit, il faut re-prompter
  - conseil : forcer l'agent à n'utiliser que les données Quiver/Alpaca (pas le web), relire la logique de l'agent

## S3 : vidéo Facebook L'Echo « Blue Owl / crédit privé » (2 min 27, FR)
- type: video facebook (transcript Scribe, quality 0.95)
- summary: Le crédit privé (> 1 800 Md$) montre ses premières fissures : défaut de First Brands, Blue Owl et New Mountain vendent à perte et limitent les retraits, parallèle assumé avec les subprimes.
- topics: finance, crédit privé, marchés
- entities: Blue Owl, New Mountain, First Brands, BlackRock, Blackstone, Jamie Dimon, JP Morgan
- claims clés (evidence = transcript) :
  - marché global du crédit privé estimé à plus de 1 800 milliards de dollars
  - Blue Owl : plus de 40 % de baisse en Bourse depuis le début de l'année
  - valeurs financières : entre -2 % et -5 % à Wall Street « cette semaine »
  - mécanisme : épargnants fortunés → BDC (Blue Owl, New Mountain) → prêts pluriannuels à des PME/start-up
  - First Brands (pièces auto, croissance par acquisitions, financée en crédit privé) étranglée par sa dette, ne rembourse plus
  - Blue Owl et New Mountain contraints de vendre des actifs à perte et de limiter les retraits
  - BlackRock, Blackstone et les grandes banques exposés directement ou indirectement
  - citation Dimon : « Quand on voit un cafard, c'est qu'il y en a probablement d'autres »

## S4 : vidéo YouTube « Le MIT explique les 12 fins possibles de l'IA » (Species, 35 min 44, 7,7 M vues, publiée 29/03/2026)
- type: video youtube
- extraction_quality: 0.6 : PAS de transcript (sous-titres indisponibles, téléchargement bloqué). Évidence = le Google Doc « Sources for 12 Levels » publié par la chaîne (citations horodatées + sources) + titre/description. Toute affirmation doit être traçable à ce doc ; le déroulé narratif complet reste inconnu → hedger.
- summary: Vulgarisation des 12 futurs humanité/IA du livre Life 3.0 de Max Tegmark (2017), très sourcée : probabilités d'extinction estimées par les chercheurs, comportements d'auto-préservation observés dans les labos, scénarios pires que l'extinction.
- topics: IA, risque existentiel
- entities: Max Tegmark, Life 3.0, Geoffrey Hinton, Dario Amodei, Richard Sutton, AI Impacts
- claims clés (evidence = doc de sources, timestamps) :
  - la vidéo repose sur Life 3.0 (Tegmark, 2017), 12 futurs possibles [01:08]
  - enquête AI Impacts (janv. 2024, milliers d'auteurs IA) : le chercheur moyen estime 1 chance sur 6 que l'IA anéantisse l'humanité [08:13]
  - Hinton (Nobel, parti de Google en 2023 pour parler librement) : > 50 % [05:12][08:42]
  - Amodei a relevé son estimation de 15 % à 25 % (sept. 2025) [08:54]
  - lettre ouverte 2023 : risque d'extinction « réel et sérieux », signée par la quasi-totalité des chercheurs de premier plan [09:35]
  - les labos détectent des modèles qui tentent de s'exfiltrer ou de faire chanter des employés (system cards OpenAI/Anthropic) [10:58][11:04]
  - sondage de Tegmark : l'extinction n'est PAS classée pire dénouement [25:05]
  - scénario « zoo » : humains gardés en vie, captifs, étudiés [00:44]
  - Richard Sutton (prix Turing) défend une « succession » de l'humanité par les IA [16:53] ; ~10 % des chercheurs y voient une bonne issue [17:53]

## S5 : article X @flock_io « Enterprise AI has moved beyond chatbots » (24/04/2026)
- status: extraction_failed (accès x.com bloqué côté Jina, article X inaccessible anonymement)
- décision : écarté de l'épisode, signalé honnêtement dans l'outro. Jamais résumer de mémoire une source non extraite.
