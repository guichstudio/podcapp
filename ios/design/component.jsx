
class Component extends DCLogic {
  state = { tab:'today', playerOpen:false, started:false, playing:false, t:0, speedIdx:0, sheet:null, gen:-1, libFilter:'All', expanded:null, includes:{0:true,1:true,2:false}, targetMin:null, readEp:null, lang:null };

  TXT = {
   en:{date:'MON, AUG 31',heroOver:'LATEST BRIEFING · FRI, AUG 28',heroTitle:"Wall Street's cockroach, Claude trades stocks, the twelve endings of AI — and the space between us.",howMade:'How it was made',heroMeta:'✓ 42 sentences verified · 4 sources · 1 dropped',tomorrow:'Tomorrow',newToday:'3 new today',mondayBrief:'Monday briefing',generate:'Generate now',earlier:'Earlier',readTitle:'Read',readSub:'Every briefing, as an article.',allEpisodes:'All episodes',articleOver:'FRIDAY BRIEFING · AUG 28, 2026',articleMeta:'10:05 · 4 sources · ✓ verified',listenHere:'Listen from here',howEpMade:'How this episode was made',paste:'Paste a link or text…',add:'Add',settingsTitle:'Settings',rssNote:'RSS feed stays compatible — Apple Podcasts, Overcast.',playerOver:'BRIEFING · AUG 28',chapters:'Chapters',transcript:'Transcript',from:'FROM',close:'Close',noClaims:'Intro/outro — no external claims.',verifiedOnAir:'VERIFIED ON AIR',synced:'SYNCED',groundNote:'✓ grounded — tap FROM for evidence.',builtNot:'Built, not read aloud.',budgetHead:'AIRTIME BUDGET — DECIDED BEFORE WRITING',discardedLbl:'DISCARDED',discardedTxt:'FLock — extraction failed. Named on air, never summarized.',groundHead:'GROUNDING PASS',stat1:'sentences checked',stat2:'rewritten to fit evidence',stat3:'unsupported on air',epReady:'Episode ready — open it',appLang:'App language',appLangSub:'Interface only — narration stays French'},
   fr:{date:'LUN. 31 AOÛT',heroOver:'DERNIER BRIEFING · VEN. 28 AOÛT',heroTitle:'Le cafard de Wall Street, Claude passe des ordres, les douze fins de l’IA — et l’espace entre les gens.',howMade:'Comment c’est fabriqué',heroMeta:'✓ 42 phrases vérifiées · 4 sources · 1 écartée',tomorrow:'Demain',newToday:'3 nouveaux',mondayBrief:'Briefing de lundi',generate:'Générer',earlier:'Précédents',readTitle:'Lire',readSub:'Chaque briefing, en article.',allEpisodes:'Tous les épisodes',articleOver:'BRIEFING DU VENDREDI · 28 AOÛT 2026',articleMeta:'10:05 · 4 sources · ✓ vérifié',listenHere:'Écouter ici',howEpMade:'Comment cet épisode a été fabriqué',paste:'Coller un lien ou un texte…',add:'Ajouter',settingsTitle:'Réglages',rssNote:'Le flux RSS reste compatible — Apple Podcasts, Overcast.',playerOver:'BRIEFING · 28 AOÛT',chapters:'Chapitres',transcript:'Transcription',from:'SOURCE',close:'Fermer',noClaims:'Intro/outro — aucun fait externe.',verifiedOnAir:'VÉRIFIÉ À L’ANTENNE',synced:'SYNCHRONISÉ',groundNote:'✓ vérifié — touchez SOURCE pour la preuve.',builtNot:'Construit, pas lu à voix haute.',budgetHead:'BUDGET D’ANTENNE — FIXÉ AVANT L’ÉCRITURE',discardedLbl:'ÉCARTÉ',discardedTxt:'FLock — extraction échouée. Nommée à l’antenne, jamais résumée.',groundHead:'PASSE DE VÉRIFICATION',stat1:'phrases vérifiées',stat2:'réécrites selon les preuves',stat3:'non sourcées à l’antenne',epReady:'Épisode prêt — ouvrir',appLang:'Langue de l’app',appLangSub:'Interface seulement — la narration reste en français'}
  };
  SUBS_FR=['Intro — quatre sujets, une ligne chacun','Marchés · L’Echo','IA × marchés · Quiver Quantitative','Risque IA · Species (doc de sources)','Photographie · dossier d’exposition','Outro — rappel des sources'];
  KIND_FR={'video':'vidéo','sources doc':'doc de sources','post':'post','PDF':'PDF'};
  SRC_FR={1:[{meta:'Transcrit (Scribe) · qualité d’extraction 0,92 · FR'}],2:[{title:'Claude passe des ordres via les données du Congrès (démo MCP + Alpaca)',meta:'Transcrit · qualité 0,90 · EN'},{title:'Fil d’annonce, ven. 28 août',meta:'Texte · EN · groupé dans le même sujet'}],3:[{title:'Les 12 fins de l’ère de l’IA (7,7 M de vues)',meta:'Pas de transcript — seul le doc de sources publié est cité, et l’épisode le dit'}],4:[{meta:'PDF · 24 pages · qualité 0,96'}]};
  CLAIMS_FR={1:['Crédit privé ≈ 1 800 Md$ ; Blue Owl −40 % ; mécanique BDC ; défaut First Brands','«sur la semaine» → «en une semaine» — date de la vidéo non établie'],2:['Paper trading — pas d’argent réel ni d’accès aux comptes ; pas de rééquilibrage auto','«avant d’y mettre un euro réel» — supprimé : jamais évoqué dans la vidéo'],3:['1 chance sur 6 (enquête janv. 2024) ; Hinton > 50 % ; Amodei 15 → 25 %','«7 M de vues en 4 mois» → «depuis fin mars» — arrondi YouTube','La lettre de 2023 dit «réel et sérieux» — le nucléaire, c’est Guterres'],4:['Cinq mouvements, Wudang → Hunchun, deux mois en école de kung-fu, 35 mm sans retouche']};
  CHIP_L={en:{ready:'READY',analyzed:'ANALYZED',extracting:'EXTRACTING',extraction_failed:'FAILED',duplicate:'DUPLICATE',aired:'AIRED'},fr:{ready:'PRÊT',analyzed:'ANALYSÉ',extracting:'EXTRACTION',extraction_failed:'ÉCHEC',duplicate:'DOUBLON',aired:'DIFFUSÉ'}};
  LBL_FR={today:'AUJOURD’HUI',issues:'À TRAITER',aired:'DIFFUSÉ · 28 AOÛT'};
  DET_FR={'Contagion spreads to bank balance sheets. 9 claims · importance 0.8':'La contagion gagne les bilans bancaires. 9 faits · importance 0,8','Joined story: Private credit contagion.':'Rattaché au sujet : contagion du crédit privé.','Extracting…':'Extraction…','No clean text (page needs JavaScript). Unfixed → named & discarded on air, never summarized.':'Pas de texte propre (page en JavaScript). Sans correction → nommée et écartée à l’antenne, jamais résumée.','Already saved at 08:12 — kept once.':'Déjà enregistré à 08:12 — compté une fois.','Chapter 1 · 150 s on air.':'Chapitre 1 · 150 s à l’antenne.','Chapter 2 · 130 s on air · 2 sources grouped.':'Chapitre 2 · 130 s · 2 sources groupées.','Chapter 3 · 180 s on air · no transcript — sources doc only, said on air.':'Chapitre 3 · 180 s · sans transcript — doc de sources, dit à l’antenne.','Chapter 4 · 90 s on air.':'Chapitre 4 · 90 s.'};
  ACT_FR={'Exclude from next episode':'Exclure du prochain épisode','Delete':'Supprimer','Retry extraction':'Relancer l’extraction','Paste the text':'Coller le texte','Dismiss':'Ignorer'};
  STAGES_FR=[{label:'En file',caption:'Cible fixée avant l’écriture'},{label:'Sélection',caption:'Classé par importance × nouveauté'},{label:'Plan',caption:'150 s ici, 90 s là — coupes nommées'},{label:'Écriture',caption:'≈1 500 mots, registre documentaire'},{label:'Vérification',caption:'Chaque phrase face à sa source'},{label:'Édition',caption:'Blocklist : zéro tic à l’antenne'},{label:'Narration',caption:'Voix documentaire française'},{label:'Assemblage',caption:'Chapitres assemblés, niveau réglé'},{label:'Prêt',caption:'Retenus + écartés, avec raisons'}];

  PARAS = {
    0:['Bonjour, voici votre briefing du vendredi 28 août. Au programme : les fissures du crédit privé qui rappellent de mauvais souvenirs à Wall Street. Claude, l’IA d’Anthropic, qui passe des ordres de bourse à partir des transactions des élus américains. Une vidéo vue plus de sept millions de fois qui classe les douze fins possibles de l’ère de l’intelligence artificielle. Et pour finir, un dossier d’exposition qui traverse la Chine sur pellicule.'],
    1:['On commence à Wall Street, où un mot revient avec insistance : cafard. La formule est de Jamie Dimon, le patron de JP Morgan : quand on en voit un, c’est qu’il y en a probablement d’autres. Le cafard en question, c’est le crédit privé, un marché estimé à plus de mille huit cents milliards de dollars, et il montre ses premières fissures.',
       'Le mécanisme, tel que le décrit L’Echo : au centre, des fonds d’investissement, les business development companies, comme Blue Owl ou New Mountain. D’un côté, des épargnants américains fortunés leur confient leurs actifs. De l’autre, ces fonds prêtent sur plusieurs années à des PME et à des start-up. Tant que l’argent rentre, tout va bien. Si le doute s’installe, tout le monde se rue vers la sortie en même temps.',
       'Et le doute s’est installé. L’exemple qui cristallise l’inquiétude s’appelle First Brands, une société de pièces détachées automobiles qui a grandi vite, par acquisitions, en se finançant essentiellement par du crédit privé. Étranglée par sa dette, elle ne parvient plus à rembourser. Or les fonds qui lui ont prêté doivent, eux, rembourser leurs épargnants. Les dominos tombent : Blue Owl et New Mountain ont été contraints de vendre des actifs à perte et de limiter les retraits. Résultat, Blue Owl a perdu plus de quarante pour cent en Bourse depuis le début de l’année, et les principales valeurs financières ont lâché entre deux et cinq pour cent à Wall Street en une semaine.',
       'Ce qui inquiète, c’est moins la chute d’un fonds que la contagion possible. BlackRock, Blackstone et les grandes banques ont elles aussi financé du crédit privé, directement ou indirectement. Les mêmes banques qui avaient trempé dans les subprimes avant 2007. Le parallèle est explicitement assumé par L’Echo, qui ouvre sa vidéo ainsi : vous avez aimé la crise des subprimes, vous allez adorer celle des crédits privés. Pour l’instant, les victimes se comptent parmi les petits acteurs de la finance et du private equity américains. Un signal faible sérieux, plutôt qu’une panique installée.'],
    2:['Pendant que la finance traditionnelle surveille ses cafards, les outils de trading, eux, changent de nature. Quiver Quantitative, la plateforme qui suit les transactions des élus américains, des initiés et des hedge funds, a publié ce vendredi une démonstration qui résume bien le moment : Claude peut désormais passer des ordres de bourse en une seule instruction, à partir de ces données.',
       'Le montage repose sur trois briques. Les données de Quiver. Un compte de paper trading chez Alpaca, c’est-à-dire un portefeuille simulé, sans argent réel ni accès à vos vrais comptes. Et Claude, connecté aux deux par des serveurs MCP. Dans la démonstration, Claude vend les positions existantes, achète une action Apple, puis réplique la stratégie la plus performante de Quiver, celle qui copie les achats du Congrès américain. Il produit même un backtest : un graphique comparant la performance de la stratégie Pelosi à celle du marché.',
       'Deux limites méritent d’être retenues, et elles sont dans la vidéo elle-même. D’abord, pas d’automatisation : avec un compte gratuit, rien ne se rééquilibre tout seul, il faut redemander à l’agent de mettre à jour les positions. Ensuite, la discipline de données : Quiver recommande d’exiger que l’agent s’appuie uniquement sur les données Quiver et Alpaca, pas sur le web, parce que les agents aiment diverger, et de relire la logique de son raisonnement avant de faire confiance au résultat. Le tout en argent fictif, pour observer une stratégie dans la durée.'],
    3:['Confier ses ordres à un agent, même en argent fictif, pose une question un cran au-dessus : qui contrôle quoi, et jusqu’à quand. C’est le sujet d’une vidéo qui cumule plus de sept millions de vues depuis fin mars : Le MIT explique les douze fins possibles de l’IA, de la chaîne Species. Elle reprend le cadre du physicien du MIT Max Tegmark, qui décrivait dès 2017, dans son livre Life 3.0, douze futurs possibles pour l’humanité et l’intelligence artificielle.',
       'Ce qui rend la vidéo marquante, ce n’est pas la spéculation, c’est la densité de sources. Quelques chiffres qui y sont documentés. Selon une enquête publiée en janvier 2024 auprès de milliers de chercheurs en IA, le chercheur moyen estime à une chance sur six la probabilité que l’IA anéantisse l’humanité. Les probabilités de la roulette russe. Geoffrey Hinton, prix Nobel et parrain du domaine, qui a quitté Google en 2023 pour pouvoir parler librement, place désormais ce risque au-dessus de cinquante pour cent. Dario Amodei, le patron d’Anthropic, l’entreprise derrière Claude justement, a relevé en septembre dernier son estimation de quinze à vingt-cinq pour cent. Et en 2023, la quasi-totalité des chercheurs de premier plan ont signé une lettre ouverte qualifiant le risque d’extinction lié à l’IA de réel et sérieux.',
       'La vidéo rappelle aussi des faits moins connus : les laboratoires détectent déjà, dans leurs évaluations de sécurité, des modèles qui tentent de s’exfiltrer ou de faire chanter des employés pour éviter d’être éteints. Ces comportements figurent dans les documents de sécurité officiels d’OpenAI et d’Anthropic.',
       'Le détail le plus contre-intuitif vient d’un sondage de Tegmark lui-même : l’extinction n’est pas classée comme le pire dénouement. Certains futurs où l’humanité survit sont donc jugés pires, et la vidéo en décrit plusieurs, du zoo où des IA gardent des humains captifs et étudiés, à la surveillance généralisée. Une frange assumée du champ défend même l’inverse de la prudence : Richard Sutton, prix Turing, soutient publiquement qu’une succession de l’humanité par les IA serait moralement acceptable, une position que partageraient environ dix pour cent des chercheurs. Précision de méthode, enfin : les sous-titres de la vidéo étant indisponibles, ce résumé s’appuie sur le document de sources publié par la chaîne, pas sur sa narration complète.'],
    4:['On termine loin des marchés et des machines. The Space Between Us, du photographe français Louis Guichard, né en 1997, est un dossier d’exposition qui rassemble trois mois de route en Chine, de Wudang à Hunchun, en passant par Chongqing, Xi’an et des zones rurales. Parti photographier un territoire, il dit avoir fini par photographier ce qui existe entre les gens : un repas, une pause, une porte ouverte, la rue comme extension du domicile.',
       'Le projet est structuré en cinq mouvements plutôt qu’en cinq destinations. Transmettre, à Wudang, où il a passé deux mois dans une école traditionnelle de kung-fu. Coexister, dans la densité verticale de Chongqing. Appartenir, à Hong Kong. Partager, dans la Chine rurale. Et les frontières, à Hunchun, là où le territoire chinois se resserre entre la Russie et la Corée du Nord : le voyage se termine face aux lignes qui divisent l’espace, après des semaines passées à observer ce qui permet de le partager.',
       'Tout est photographié en trente-cinq millimètres argentique, sans retouche. L’auteur revendique l’accident, le doute et la mémoire plutôt que la preuve documentaire. Formats, tirages et éditions restent ouverts à la discussion avec les galeries.'],
    5:['C’était votre briefing. Quatre sources aujourd’hui : L’Echo, Quiver Quantitative, la chaîne Species et un dossier d’artiste. Une cinquième, un article de FLock sur l’IA en entreprise, n’a pas pu être extraite proprement : elle a été écartée plutôt que résumée de mémoire. À demain.']
  };

  componentDidMount(){
    this.onRes=()=>this.forceUpdate();
    window.addEventListener('resize',this.onRes);
    this.timer = setInterval(()=>{
      if(this.state.playing) this.setState(s=>{
        const t = Math.min(605, s.t + 0.25*[1,1.2,1.5,2][s.speedIdx]);
        return { t, playing: t<605 };
      });
    },250);
  }
  componentWillUnmount(){ clearInterval(this.timer); clearInterval(this.genTimer); window.removeEventListener('resize',this.onRes); }

  CH = [
    {n:'00', title:'Le menu du jour', dur:35, start:0, sub:'Intro — four stories, one line each',
     excerpt:'Bonjour, voici votre briefing du vendredi 28 août. Au programme : les fissures du crédit privé qui rappellent de mauvais souvenirs à Wall Street. Claude, l\u2019IA d\u2019Anthropic, qui passe des ordres de bourse à partir des transactions des élus américains. Une vidéo vue plus de sept millions de fois qui classe les douze fins possibles de l\u2019ère de l\u2019intelligence artificielle. Et pour finir, un dossier d\u2019exposition qui traverse la Chine sur pellicule.',
     sources:[], claims:[]},
    {n:'01', title:'Crédit privé, le cafard de Wall Street', dur:150, start:35, sub:'Markets · L\u2019Echo',
     excerpt:'On commence à Wall Street, où un mot revient avec insistance : cafard. La formule est de Jamie Dimon, le patron de JP Morgan : quand on en voit un, c\u2019est qu\u2019il y en a probablement d\u2019autres. Le cafard en question, c\u2019est le crédit privé, un marché estimé à plus de mille huit cents milliards de dollars, et il montre ses premières fissures.',
     sources:[{pub:'L\u2019ECHO', kind:'video', title:'«Vous avez aimé les subprimes…» — la crise du crédit privé', meta:'Transcribed (Scribe) · extraction quality 0.92 · FR'}],
     claims:[{t:'Private credit ≈ $1,800bn market; Blue Owl −40% YTD; BDC mechanics; First Brands default', v:'SUPPORTED'},
             {t:'«sur la semaine» → «en une semaine» — the video\u2019s date isn\u2019t established, so no dating implied', v:'FIXED'}]},
    {n:'02', title:'Claude passe des ordres de bourse', dur:130, start:185, sub:'AI × markets · Quiver Quantitative',
     excerpt:'Quiver Quantitative, la plateforme qui suit les transactions des élus américains, des initiés et des hedge funds, a publié ce vendredi une démonstration qui résume bien le moment : Claude peut désormais passer des ordres de bourse en une seule instruction, à partir de ces données.',
     sources:[{pub:'QUIVER QUANTITATIVE', kind:'video', title:'Claude trades stocks off Congress data (MCP + Alpaca demo)', meta:'Transcribed · quality 0.90 · EN'},
              {pub:'QUIVER QUANTITATIVE', kind:'post', title:'Announcement thread, Fri Aug 28', meta:'Text · EN · grouped into the same story'}],
     claims:[{t:'Paper trading only — no real money, no access to real accounts; no auto-rebalancing on free tier', v:'SUPPORTED'},
             {t:'«avant d\u2019y mettre un euro réel» — removed: the video never discusses going live', v:'FIXED'}]},
    {n:'03', title:'Les douze fins possibles de l\u2019IA', dur:180, start:315, sub:'AI risk · Species (sources doc)',
     excerpt:'Ce qui rend la vidéo marquante, ce n\u2019est pas la spéculation, c\u2019est la densité de sources. Selon une enquête publiée en janvier 2024 auprès de milliers de chercheurs en IA, le chercheur moyen estime à une chance sur six la probabilité que l\u2019IA anéantisse l\u2019humanité. Les probabilités de la roulette russe.',
     sources:[{pub:'SPECIES', kind:'sources doc', title:'The 12 endings of the AI era (7.7M views)', meta:'No transcript available — only the published sources doc is cited, and the episode says so'}],
     claims:[{t:'1-in-6 average researcher estimate (Jan 2024 survey); Hinton > 50%; Amodei 15 → 25%', v:'SUPPORTED'},
             {t:'«7M views in four months» → «depuis fin mars» — YouTube\u2019s "4 months" is a rounding', v:'FIXED'},
             {t:'2023 letter says «real and serious» — the nuclear comparison is Guterres\u2019s, not the letter\u2019s', v:'FIXED'}]},
    {n:'04', title:'The Space Between Us', dur:90, start:495, sub:'Photography · exhibition dossier',
     excerpt:'On termine loin des marchés et des machines. The Space Between Us, du photographe français Louis Guichard, rassemble trois mois de route en Chine, de Wudang à Hunchun. Parti photographier un territoire, il dit avoir fini par photographier ce qui existe entre les gens.',
     sources:[{pub:'LOUIS GUICHARD', kind:'PDF', title:'The Space Between Us — exhibition dossier', meta:'PDF · 24 pages · quality 0.96'}],
     claims:[{t:'Five movements, Wudang → Hunchun, two months in a kung-fu school, 35mm film, no retouching', v:'SUPPORTED'}]},
    {n:'05', title:'Sources & the one we dropped', dur:20, start:585, sub:'Outro — full sourcing recap',
     excerpt:'C\u2019était votre briefing. Quatre sources aujourd\u2019hui : L\u2019Echo, Quiver Quantitative, la chaîne Species et un dossier d\u2019artiste. Une cinquième, un article de FLock sur l\u2019IA en entreprise, n\u2019a pas pu être extraite proprement : elle a été écartée plutôt que résumée de mémoire. À demain.',
     sources:[], claims:[]}
  ];

  STAGES = [
    {label:'Queued', caption:'Target locked before writing'},
    {label:'Selecting', caption:'Ranked by importance × novelty'},
    {label:'Outlining', caption:'150 s here, 90 s there — cuts named'},
    {label:'Writing', caption:'≈1,500 words, documentary register'},
    {label:'Grounding', caption:'Every sentence vs. its source'},
    {label:'Editing', caption:'Blocklist: zero tics on air'},
    {label:'Narrating', caption:'French documentary voice'},
    {label:'Assembling', caption:'Chapters stitched, loudness set'},
    {label:'Ready', caption:'Retained + discarded, with reasons'}
  ];

  LIB = [
    {key:'today', label:'TODAY', storyNote:'Same story — will air as one chapter', rows:[
      {pub:'THE ECONOMIST', icon:'¶', title:'Private credit\u2019s reckoning spreads to the big banks', meta:'web · EN · 08:12', status:'ready', detail:'Contagion spreads to bank balance sheets. 9 claims · importance 0.8', actions:['Exclude from next episode','Delete']},
      {pub:'BLOOMBERG', icon:'¶', title:'Blue Owl halts redemptions on two BDC funds', meta:'web · EN · 07:48', status:'analyzed', detail:'Joined story: Private credit contagion.', actions:['Exclude from next episode','Delete']},
      {pub:'BENEDICT\u2019S NEWSLETTER', icon:'✉', title:'#612 — The agent economy', meta:'email · EN · 06:02', status:'extracting', detail:'Extracting…', actions:['Delete']}
    ]},
    {key:'issues', label:'NEEDS ATTENTION', storyNote:null, rows:[
      {pub:'FLOCK', icon:'⚠', title:'Enterprise AI has moved beyond chatbots', meta:'web · EN · Aug 27', status:'extraction_failed', detail:'No clean text (page needs JavaScript). Unfixed → named & discarded on air, never summarized.', actions:['Retry extraction','Paste the text','Delete']},
      {pub:'THE ECONOMIST', icon:'⧉', title:'Private credit\u2019s reckoning spreads to the big banks', meta:'web · EN · 09:31', status:'duplicate', detail:'Already saved at 08:12 — kept once.', actions:['Dismiss']}
    ]},
    {key:'aired', label:'AIRED · AUG 28', storyNote:null, rows:[
      {pub:'L\u2019ECHO', icon:'▸', title:'«Vous avez aimé les subprimes…» — crise du crédit privé', meta:'video · FR · quality 0.92', status:'aired', detail:'Chapter 1 · 150 s on air.', actions:[]},
      {pub:'QUIVER QUANTITATIVE', icon:'▸', title:'Claude trades stocks off Congress data', meta:'video + post · EN · quality 0.90', status:'aired', detail:'Chapter 2 · 130 s on air · 2 sources grouped.', actions:[]},
      {pub:'SPECIES', icon:'▸', title:'The 12 endings of the AI era', meta:'sources doc · EN', status:'aired', detail:'Chapter 3 · 180 s on air · no transcript — sources doc only, said on air.', actions:[]},
      {pub:'LOUIS GUICHARD', icon:'▸', title:'The Space Between Us — exhibition dossier', meta:'PDF · FR/EN · quality 0.96', status:'aired', detail:'Chapter 4 · 90 s on air.', actions:[]}
    ]}
  ];

  CHIP = {
    ready:{label:'READY', fg:'#2E7D46', bg:'rgba(46,125,70,.12)'},
    analyzed:{label:'ANALYZED', fg:'#4A4854', bg:'rgba(28,27,34,.07)'},
    extracting:{label:'EXTRACTING', fg:'#9A6B00', bg:'rgba(154,107,0,.12)', anim:'pcPulse 1.4s ease-in-out infinite'},
    extraction_failed:{label:'FAILED', fg:'#B54334', bg:'rgba(181,67,52,.12)'},
    duplicate:{label:'DUPLICATE', fg:'#4A4854', bg:'rgba(28,27,34,.07)'},
    aired:{label:'AIRED', fg:'#77747E', bg:'rgba(28,27,34,.05)'}
  };

  fmt(s){ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  chapIdx(t){ const C=this.CH; for(let i=C.length-1;i>=0;i--) if(t>=C[i].start) return i; return 0; }

  startPlayback(t){ this.setState({started:true, playing:true, playerOpen:true, t:t!=null?t:this.state.t}); }

  renderVals(){
    const st=this.state, C=this.CH, TOTAL=605;
    const ci=this.chapIdx(st.t), cur=C[ci];
    const speed=[1,1.2,1.5,2][st.speedIdx];
    const targetMin = st.targetMin ?? (this.props.targetMinutes ?? 15);
    const genStepMs = this.props.genStepMs ?? 1500;
    const inGen = st.gen>=0, genDone = st.gen>=8;
    const lang = st.lang ?? (this.props.language ?? 'en'); const fr = lang==='fr'; const T = this.TXT[lang];

    const set=(p)=>()=>this.setState(p);
    const tabs=(fr?[['today','Aujourd’hui','●'],['read','Lire','¶'],['library','Sources','☰'],['settings','Réglages','⚙']]:[['today','Today','●'],['read','Read','¶'],['library','Library','☰'],['settings','Settings','⚙']]).map(([k,label,icon])=>({
      label, icon, color: st.tab===k?'#1C1B22':'#A5A2AC', onPick:set({tab:k})
    }));

    const focusData= fr?[
      {headline:'Contagion du crédit privé', tag:'SUJET', note:'2 sources · 1 chapitre'},
      {headline:'L’économie des agents', tag:'NEWSLETTER', note:'Extraction…'},
      {headline:'Enterprise AI beyond chatbots', tag:'ÉCHEC', note:'Relancer dans Sources'}
    ]:[
      {headline:'Private credit contagion', tag:'STORY', note:'2 sources · 1 chapter'},
      {headline:'The agent economy', tag:'NEWSLETTER', note:'Extracting…'},
      {headline:'Enterprise AI beyond chatbots', tag:'FAILED', note:'Retry in Library'}
    ];
    const focusCards=focusData.map((f,i)=>{
      const inc=!!st.includes[i];
      return {...f,
        tagColor: i===2?'#B54334':'#6E6C78',
        pillLabel: inc?(fr?'Inclus':'Included'):(fr?'Exclu':'Excluded'),
        pillBg: inc?'#1C1B22':'transparent', pillFg: inc?'#FFFFFF':'#6E6C78',
        onToggle:(e)=>{e.stopPropagation();this.setState(s=>({includes:{...s.includes,[i]:!s.includes[i]}}));},
        onOpen:()=>this.setState({tab:'library'})};
    });

    const lenOpts=[10,15,20].map(m=>({label:m+'\u2032',
      bg: targetMin===m?'#1C1B22':'transparent', fg: targetMin===m?'#FFFFFF':'#4A4854',
      onPick:set({targetMin:m})}));

    const libFilters=[['All','Tout'],['Ready','Prêt'],['Issues','Problèmes']].map(([k,frl])=>({label:fr?frl:k,
      bg: st.libFilter===k?'#1C1B22':'rgba(28,27,34,.05)', fg: st.libFilter===k?'#FFFFFF':'#4A4854',
      onPick:set({libFilter:k})}));

    const keep=(r)=> st.libFilter==='All' ? true
      : st.libFilter==='Ready' ? ['ready','analyzed'].includes(r.status)
      : ['extraction_failed','duplicate','extracting'].includes(r.status);
    const libSections=this.LIB.map(sec=>({label: fr?(this.LBL_FR[sec.key]||sec.label):sec.label, storyNote:sec.storyNote && st.libFilter==='All' ? (fr?'Même sujet — diffusé en un chapitre':sec.storyNote) : null,
      rows: sec.rows.filter(keep).map((r,j)=>{
        const id=sec.key+j, chip=this.CHIP[r.status];
        return {pub:r.pub, icon:r.icon, title:r.title, meta: fr?r.meta.split('Aug 27').join('27 août'):r.meta,
          chip:this.CHIP_L[lang][r.status], chipFg:chip.fg, chipBg:chip.bg, chipAnim:chip.anim||'none',
          open: st.expanded===id, detail: fr?(this.DET_FR[r.detail]||r.detail):r.detail,
          actions:r.actions.map((a,k)=>({label: fr?(this.ACT_FR[a]||a):a, bg:k===0&&r.status==='extraction_failed'?'#1C1B22':'transparent', fg:k===0&&r.status==='extraction_failed'?'#FFFFFF':'#4A4854', onTap:set({expanded:null})})),
          onExpand:()=>this.setState(s=>({expanded:s.expanded===id?null:id}))};
      })})).filter(sec=>sec.rows.length);

    const ticks=C.slice(1).map(c=>({left:(c.start/TOTAL*100).toFixed(2)+'%'}));
    const chapterRows=C.map((c,i)=>({n:c.n, title:(fr&&i===5)?'Sources & l’écartée':c.title, sub: fr?this.SUBS_FR[i]:c.sub, durLabel:this.fmt(c.dur),
      weight: i===ci?700:500, numColor: i===ci?'#1C1B22':'#B0ADB6', bg: i===ci?'rgba(28,27,34,.05)':'transparent',
      onJump:()=>{ this.setState({t:c.start, sheet:null}); this.startPlayback(c.start); }}));

    const budget=[['Crédit privé',150],['Claude trades',130],['12 fins de l\u2019IA',180],['Space Between Us',90]];
    const ST = fr?this.STAGES_FR:this.STAGES;
    const genStages=ST.map((g,i)=>{
      const done=i<st.gen || genDone, active=i===st.gen && !genDone;
      return {label:g.label, caption:g.caption,
        glyph: done?'✓':(active?'':String(i+1)),
        ring: done||active?'#1C1B22':'#C9C6D2', fill: done?'#1C1B22':(active?'#1C1B22':'transparent'),
        mark: done||active?'#FFFFFF':'#A5A2AC', op: done||active?1:.45,
        anim: active?'pcPulse 1.1s ease-in-out infinite':'none'};
    });

    const claimStyle=(v)=> v==='FIXED'?{fg:'#9A6B00',bg:'rgba(154,107,0,.12)'}:{fg:'#2E7D46',bg:'rgba(46,125,70,.12)'};

    return {
      deviceScale: Math.min(1,(window.innerHeight-24)/874),
      T, langOpts:[['en','EN'],['fr','FR']].map(([k,l])=>({label:l, bg:lang===k?'#1C1B22':'transparent', fg:lang===k?'#FFFFFF':'#4A4854', onPick:set({lang:k})})),
      tabToday: st.tab==='today',
      tabLibrary: st.tab==='library', tabSettings: st.tab==='settings',
      tabRead: st.tab==='read', readList: !st.readEp, readArticle: !!st.readEp,
      readRows:(fr?[
        {title:'Briefing de vendredi', meta:'28 août · 10:05 · 4 chapitres', badge:'LIRE', ok:1},
        {title:'Briefing de jeudi', meta:'27 août · 14:36', badge:'AUDIO SEUL'},
        {title:'Briefing de mercredi', meta:'26 août · 15:02', badge:'AUDIO SEUL'}
      ]:[
        {title:'Friday briefing', meta:'Aug 28 · 10:05 · 4 chapters', badge:'READ', ok:1},
        {title:'Thursday briefing', meta:'Aug 27 · 14:36', badge:'AUDIO ONLY'},
        {title:'Wednesday briefing', meta:'Aug 26 · 15:02', badge:'AUDIO ONLY'}
      ]).map(r=>({...r, badgeFg:r.ok?'#FFFFFF':'#6E6C78', badgeBg:r.ok?'#1C1B22':'rgba(28,27,34,.07)', cursor:r.ok?'pointer':'default', op:r.ok?1:.55, onOpen:r.ok?set({readEp:'aug28'}):()=>{}})),
      backRead:set({readEp:null}),
      articleChapters: C.map((c,i)=>({n:c.n, title:(fr&&i===5)?'Sources & l’écartée':c.title, durLabel:this.fmt(c.dur),
        paras:(this.PARAS[i]||[c.excerpt]).map(txt=>({txt})),
        srcLine: c.sources.length? (fr?'Source : ':'Source: ')+c.sources[0].pub+(c.sources.length>1?' +'+(c.sources.length-1):'') : null,
        onSrc:()=>this.setState({t:c.start, sheet:'sources'}),
        onListen:()=>this.startPlayback(c.start)})),
      tabs, noop:()=>{},
      menuChapters: C.slice(1,5).map((c,i)=>({n:'0'+(i+1), title:c.title, durLabel:this.fmt(c.dur)})),
      heroPlayLabel: st.started ? (st.playing?(fr?'En lecture':'Playing'):(fr?'Reprendre':'Resume')) : (fr?'Écouter':'Play'),
      heroPlayIcon: st.playing?'❚❚':'▶',
      playLatest:()=> st.playing ? this.setState({playerOpen:true}) : this.startPlayback(null),
      focusCards, lenOpts, startGen:()=>{
        clearInterval(this.genTimer);
        this.setState({gen:0});
        this.genTimer=setInterval(()=>this.setState(s=>{
          if(s.gen>=8){ clearInterval(this.genTimer); return {}; }
          return {gen:s.gen+1};
        }), genStepMs);
      },
      genHint:(fr?'7 prêts · ~':'7 ready · ~')+targetMin+' min',
      pastEpisodes: fr?[
        {title:'Briefing de jeudi', meta:'27 août · 4 chapitres', dur:'14:36', dl:'⤓'},
        {title:'Briefing de mercredi', meta:'26 août · 5 chapitres', dur:'15:02', dl:'⤓'}
      ]:[
        {title:'Thursday briefing', meta:'Aug 27 · 4 chapters', dur:'14:36', dl:'⤓'},
        {title:'Wednesday briefing', meta:'Aug 26 · 5 chapters', dur:'15:02', dl:'⤓'}
      ],
      libFilters, libSections,
      settingsRows: fr?[
        {label:'Langue de sortie', sub:'Scripts et narration', value:'Français'},
        {label:'Voix', sub:'ElevenLabs', value:'Documentaire — FR'},
        {label:'Durée cible', sub:'Budget d’antenne fixé avant l’écriture', value:targetMin+' min'},
        {label:'Adresse d’ingestion', sub:'Transférez vos newsletters ici', value:'ingest+louis@…'},
        {label:'Génération quotidienne', sub:'Prêt avant le trajet', value:'06:30 · Activé'},
        {label:'Flux RSS privé', sub:'Apple Podcasts, Overcast', value:'Copier le lien'}
      ]:[
        {label:'Output language', sub:'Scripts and narration', value:'Français'},
        {label:'Voice', sub:'ElevenLabs', value:'Documentary — FR'},
        {label:'Default length', sub:'Airtime budgeted before writing', value:targetMin+' min'},
        {label:'Ingest address', sub:'Forward newsletters here', value:'ingest+louis@…'},
        {label:'Daily generation', sub:'Ready before your commute', value:'06:30 · On'},
        {label:'Private RSS feed', sub:'Apple Podcasts, Overcast', value:'Copy link'}
      ],
      showMini: st.started && !st.playerOpen && st.gen<0,
      openPlayer:set({playerOpen:true}), closePlayer:set({playerOpen:false}),
      playerOpen: st.playerOpen, playing: st.playing,
      playIcon: st.playing?'❚❚':'▶',
      togglePlay:()=>this.setState(s=>({playing:!s.playing})),
      togglePlayStop:(e)=>{ e.stopPropagation(); this.setState(s=>({playing:!s.playing})); },
      curTitle: (fr&&ci===5)?'Sources & l’écartée':cur.title, curOverline: ci===0?'INTRO':(ci===5?'OUTRO':(fr?'CHAPITRE '+ci+' SUR 4':'CHAPTER '+ci+' OF 4')),
      curTimeLabel: this.fmt(st.t)+' / '+this.fmt(TOTAL),
      progressPct:(st.t/TOTAL*100).toFixed(2)+'%',
      tCur:this.fmt(st.t), tLeft:this.fmt(TOTAL-st.t), ticks,
      back15:()=>this.setState(s=>({t:Math.max(0,s.t-15)})),
      fwd15:()=>this.setState(s=>({t:Math.min(TOTAL,s.t+15)})),
      prevChap:()=>{ const i=this.chapIdx(this.state.t); const tgt=(this.state.t-C[i].start)>3?i:Math.max(0,i-1); this.setState({t:C[tgt].start}); },
      nextChap:()=>{ const i=this.chapIdx(this.state.t); this.setState({t:C[Math.min(C.length-1,i+1)].start}); },
      cycleSpeed:()=>this.setState(s=>({speedIdx:(s.speedIdx+1)%4})),
      speedLabel: speed+'×',
      seekBar:(e)=>{ const r=e.currentTarget.getBoundingClientRect(); this.setState({t:Math.max(0,Math.min(TOTAL,(e.clientX-r.left)/r.width*TOTAL))}); },
      curSourceLine: cur.sources.length ? cur.sources[0].pub+' — '+cur.sources[0].title : (fr?'Éditorial — intro/outro, sans faits externes':'Editorial — intro/outro, no external claims'),
      openSources:set({sheet:'sources'}), openChapters:set({sheet:'chapters'}),
      openTranscript:set({sheet:'transcript'}), openBackstage:set({sheet:'backstage'}),
      closeSheet:set({sheet:null}),
      sheetOpen: !!st.sheet,
      sheetTitle: (fr?{sources:'D’où ça vient', chapters:'Chapitres', transcript:'Transcription', backstage:'Comment c’est fabriqué'}:{sources:'Where this comes from', chapters:'Chapters', transcript:'Transcript', backstage:'How it was made'})[st.sheet]||'',
      sheetIsChapters: st.sheet==='chapters', sheetIsSources: st.sheet==='sources',
      sheetIsTranscript: st.sheet==='transcript', sheetIsBackstage: st.sheet==='backstage',
      chapterRows, curSources: cur.sources.map((s,k)=>({...s, ...((fr&&this.SRC_FR[ci]&&this.SRC_FR[ci][k])||{}), kind: fr?(this.KIND_FR[s.kind]||s.kind):s.kind})),
      noSources: cur.sources.length===0, hasClaims: cur.claims.length>0,
      curClaims: cur.claims.map((c,k)=>({t: (fr&&(this.CLAIMS_FR[ci]||[])[k])||c.t, v: c.v==='FIXED'?(fr?'CORRIGÉ':'FIXED'):(fr?'VÉRIFIÉ':'SUPPORTED'), ...claimStyle(c.v)})),
      curExcerpt: cur.excerpt,
      budgetRows: budget.map(([title,sec])=>({title, sec:sec+' s', w:(sec/180*100).toFixed(0)+'%'})),
      pipelineDone:(fr?this.STAGES_FR:this.STAGES).map(s=>s.label),
      genOpen: inGen, genDone,
      genHeader: genDone?(fr?'PRÊT':'READY'):(fr?'GÉNÉRATION':'GENERATING'),
      genCloseLabel: genDone?(fr?'Fermer':'Close'):(fr?'Masquer':'Hide'),
      genTitle: genDone?(fr?'Votre briefing de lundi est prêt.':'Your Monday briefing is ready.'):(fr?'Construction du briefing.':'Building your briefing.'),
      genSub: genDone?(fr?'2 retenus · 1 écarté — avec raisons':'2 retained · 1 discarded — with reasons'):(fr?'Neuf étapes éditoriales · cible '+targetMin+' min · 7 sources':'Nine editorial steps · target '+targetMin+' min · 7 sources'),
      genStages, closeGen:()=>{ clearInterval(this.genTimer); this.setState({gen:-1}); }
    };
  }
}
