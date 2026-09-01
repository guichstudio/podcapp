// The privacy policy, as one self-contained page served by the API.
//
// App Store Connect asks for its URL, and Beta App Review reads it, so it has to
// exist at a stable address rather than in a document somewhere. It is written
// against what the code actually does: every provider listed here is one the
// pipeline really calls (src/config.ts), and the retention section says the
// honest thing, which is that nothing is purged automatically yet.

export const PRIVACY_CONTACT = 'guich.studio@gmail.com'
export const PRIVACY_UPDATED = '1er septembre 2026'
export const PRIVACY_UPDATED_EN = '1 September 2026'

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0 auto;padding:32px 20px 72px;background:#0d0d0f;color:#e9e9ec;max-width:44rem;
font:16px/1.6 -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;
-webkit-text-size-adjust:100%}
h1{font-size:1.5rem;letter-spacing:-.02em;margin:0}
h2{font-size:1rem;letter-spacing:-.01em;margin:40px 0 12px;padding-top:20px;border-top:1px solid #23232a}
p,li{color:#c9c9d1}
.lede{color:#e9e9ec}
.sub{color:#8a8a94;font-size:.85rem;margin-top:6px}
a{color:#e9e9ec}
ul{padding-left:1.1rem;margin:12px 0}
li{margin:6px 0}
li b{color:#e9e9ec;font-weight:600}
.note{background:#141419;border:1px solid #23232a;border-radius:10px;padding:14px 16px;margin:16px 0}
.note p{margin:0;color:#c9c9d1;font-size:.92rem}
footer{margin-top:48px;color:#8a8a94;font-size:.85rem}
`

const BODY_FR = `
<h1>Politique de confidentialité</h1>
<p class="sub">Podcapp · dernière mise à jour le ${PRIVACY_UPDATED} · version bêta</p>

<p class="lede">Podcapp conserve ce que vous lui envoyez — liens, textes, newsletters
transférées — pour en faire votre briefing audio quotidien. Ce contenu est transmis à des
prestataires d’IA qui l’extraient, l’analysent, le vérifient et le lisent à voix haute. Il
n’est ni vendu, ni utilisé pour de la publicité, ni exploité pour vous profiler.</p>

<h2>Qui est responsable</h2>
<p>Louis Guichard, personne physique, France. Podcapp est un projet personnel diffusé en bêta
fermée. Pour toute question ou demande : <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>

<h2>Ce que Podcapp conserve</h2>
<ul>
<li><b>Votre adresse email</b> — elle identifie votre compte, et c’est elle qui reconnaît les
newsletters que vous transférez.</li>
<li><b>Deux jetons</b> — un pour l’application, un pour votre flux RSS privé.</li>
<li><b>Ce que vous capturez</b> — l’adresse de la page, le texte extrait, le titre, l’auteur,
l’éditeur, la date de publication, ainsi que l’analyse et le vecteur qui en sont dérivés.</li>
<li><b>Vos épisodes</b> — le plan, le script, le rapport de vérification phrase par phrase, le
coût de fabrication et le fichier audio.</li>
<li><b>Vos réglages</b> — langue, voix, durée cible.</li>
<li><b>Un journal technique</b> — refus d’un email entrant, échecs d’extraction : de quoi
comprendre pourquoi quelque chose n’a pas marché.</li>
</ul>
<p>L’application iOS n’embarque aucun outil de mesure d’audience, aucun traceur publicitaire et
aucun kit tiers. Elle ne lit ni vos contacts, ni votre position, ni votre historique de
navigation : elle ne voit que ce que vous lui partagez explicitement.</p>

<h2>Ce qui sort, et vers qui</h2>
<p>Fabriquer un épisode demande d’envoyer le contenu de vos sources à des prestataires
spécialisés. Chacun ne reçoit que ce dont il a besoin :</p>
<ul>
<li><b>Jina AI</b> — reçoit l’adresse partagée et le texte de la page, pour extraire le contenu
et calculer les vecteurs de similarité.</li>
<li><b>DeepSeek</b> — reçoit le texte des sources, puis les phrases du script, pour l’analyse, le
regroupement en sujets, le choix éditorial et la vérification.</li>
<li><b>Anthropic</b> — reçoit les faits retenus et le brouillon, pour écrire et relire le script.</li>
<li><b>ElevenLabs</b> — reçoit le script final, pour en faire une voix.</li>
<li><b>Postmark</b> — reçoit les newsletters que vous transférez, et l’adresse d’où vous les
transférez, pour la réception du courrier entrant.</li>
</ul>
<p>À l’exception de Postmark, dont c’est le métier, aucun de ces prestataires ne reçoit votre
adresse email ni vos jetons : ils ne voient que le contenu à traiter.</p>
<p>L’infrastructure elle-même repose sur Neon (base de données), Cloudflare R2 (audio, flux et
artefacts de fabrication), Vercel (l’API) et Trigger.dev (les traitements longs). Ces sociétés
sont pour l’essentiel établies aux États-Unis : vos données y sont donc transférées, sous leurs
propres engagements contractuels.</p>

<h2>Ce qui est public, et ce qui ne l’est pas</h2>
<div class="note">
<p>Votre flux RSS et vos fichiers audio sont déposés sur un espace de stockage public, parce
qu’une application de podcast doit pouvoir les télécharger sans s’authentifier. Leur adresse
contient un jeton imprévisible qui tient lieu de clé : <b>qui obtient cette adresse peut écouter
vos épisodes</b>. Ne la partagez pas. Votre adresse email n’y figure pas.</p>
</div>
<p>Le reste — vos sources, leur texte, le rapport de vérification, vos réglages — vit dans la
base de données, accessible uniquement avec votre jeton d’application.</p>

<h2>Combien de temps</h2>
<p>Tant que votre compte existe. Aucune purge automatique n’est en place à ce jour : la
suppression se fait à la demande, manuellement, sous quelques jours.</p>

<h2>Vos droits</h2>
<p>Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, leur
portabilité, ou vous opposer à leur traitement, en écrivant à
<a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>. La réponse arrive sous trente jours.
Un effacement supprime le compte, les sources, les sujets, les épisodes, l’audio et le flux : il
est définitif et rien n’en est conservé. Vous pouvez aussi saisir la CNIL.</p>

<h2>Sécurité</h2>
<p>Tout transite en HTTPS, et chaque compte a ses propres jetons. Une limite assumée de la bêta :
le transfert de newsletters reconnaît un utilisateur à son adresse d’expéditeur, qui est
falsifiable. Les messages dont l’authentification SPF échoue sont refusés, et tout refus est
journalisé.</p>

<h2>TestFlight</h2>
<p>Pendant la bêta, l’application est distribuée par TestFlight. Apple collecte de son côté des
informations d’installation et de plantage, selon sa propre politique de confidentialité, et
peut nous transmettre des rapports de plantage si vous l’autorisez.</p>

<h2>Enfants</h2>
<p>Podcapp n’est pas destiné aux personnes de moins de seize ans.</p>

<h2>Modifications</h2>
<p>Toute évolution de ce texte sera publiée ici, avec sa date. Un changement qui toucherait la
nature des données collectées vous sera annoncé par email.</p>

<footer>Podcapp — <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a></footer>
`
const BODY_EN = `
<h1>Privacy policy</h1>
<p class="sub">Podcapp · last updated ${PRIVACY_UPDATED_EN} · beta</p>

<p class="lede">Podcapp keeps what you send it — links, text, forwarded newsletters —
to turn it into your daily audio briefing. That content is passed to AI providers that
extract it, analyse it, check it and read it aloud. It is not sold, not used for
advertising, and not used to profile you.</p>

<h2>Who is responsible</h2>
<p>Louis Guichard, an individual, in France. Podcapp is a personal project in closed
beta. Any question or request: <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>

<h2>What Podcapp keeps</h2>
<ul>
<li><b>Your email address</b> — it identifies your account, and it is what recognises the
newsletters you forward.</li>
<li><b>Two tokens</b> — one for the app, one for your private RSS feed.</li>
<li><b>What you capture</b> — the page address, the extracted text, the title, author,
publisher and publication date, plus the analysis and the vector derived from them.</li>
<li><b>Your episodes</b> — the outline, the script, the sentence-by-sentence verification
report, what it cost to make, and the audio file.</li>
<li><b>Your settings</b> — language, voice, target length.</li>
<li><b>A technical log</b> — a rejected inbound email, a failed extraction: enough to
understand why something did not work.</li>
</ul>
<p>The iOS app carries no analytics, no advertising tracker and no third-party kit. It
reads neither your contacts, nor your location, nor your browsing history: it only ever
sees what you explicitly share with it.</p>

<h2>What leaves, and to whom</h2>
<p>Making an episode means sending the content of your sources to specialist providers.
Each one receives only what it needs:</p>
<ul>
<li><b>Jina AI</b> — receives the shared address and the text of the page, to extract the
content and compute similarity vectors.</li>
<li><b>DeepSeek</b> — receives the text of the sources, then the sentences of the script,
for analysis, grouping into stories, editorial selection and verification.</li>
<li><b>Anthropic</b> — receives the retained facts and the draft, to write and edit the
script.</li>
<li><b>ElevenLabs</b> — receives the final script, to turn it into a voice.</li>
<li><b>Postmark</b> — receives the newsletters you forward, and the address you forward
them from, to handle inbound mail.</li>
</ul>
<p>Postmark aside, whose job it is, none of these providers receives your email address or
your tokens: they only see the content to be processed.</p>
<p>The infrastructure itself runs on Neon (database), Cloudflare R2 (audio, feed and build
artifacts), Vercel (the API) and Trigger.dev (long-running work). These companies are
mostly established in the United States, so your data is transferred there under their own
contractual commitments.</p>

<h2>What is public, and what is not</h2>
<div class="note">
<p>Your RSS feed and your audio files sit in public storage, because a podcast app has to
download them without authenticating. Their address contains an unguessable token that
acts as the key: <b>whoever gets that address can listen to your episodes</b>. Do not share
it. Your email address does not appear in it.</p>
</div>
<p>The rest — your sources, their text, the verification report, your settings — lives in
the database, reachable only with your app token.</p>

<h2>How long</h2>
<p>As long as your account exists. There is no automatic purge today: deletion happens on
request, by hand, within a few days.</p>

<h2>Your rights</h2>
<p>You can ask for access to your data, its correction, its erasure, its portability, or
object to its processing, by writing to
<a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>. An answer comes within thirty
days. An erasure removes the account, the sources, the stories, the episodes, the audio and
the feed: it is final and nothing is kept. If you are in the EU you may also complain to
your data protection authority; in France, the CNIL.</p>

<h2>Security</h2>
<p>Everything travels over HTTPS, and every account has its own tokens. One acknowledged
limit of the beta: forwarding newsletters recognises a user by the sending address, which
can be spoofed. Messages that fail SPF authentication are refused, and every refusal is
logged.</p>

<h2>TestFlight</h2>
<p>During the beta the app is distributed through TestFlight. Apple collects install and
crash information of its own, under its own privacy policy, and may pass us crash reports
if you allow it.</p>

<h2>Children</h2>
<p>Podcapp is not intended for people under sixteen.</p>

<h2>Changes</h2>
<p>Any change to this text will be published here, with its date. A change to the nature of
the data collected will be announced to you by email.</p>

<footer>Podcapp — <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a></footer>
`


/// English by default: the product is aimed at the US market, and the French
/// page is what a French reader gets instead. Which one is served follows the
/// browser, the same way the app follows the phone.
export function privacyHtml(language: string | null | undefined): string {
  const french = wantsFrench(language)
  return `<!doctype html>
<html lang="${french ? 'fr' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${french ? 'Politique de confidentialité — Podcapp' : 'Privacy policy — Podcapp'}</title>
<meta name="theme-color" content="#0d0d0f">
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>${french ? BODY_FR : BODY_EN}</body>
</html>
`
}

/// Reads only the first, highest-priority tag of an Accept-Language header:
/// anything else would serve French to a reader who merely lists it as a
/// fallback. No header at all means English.
export function wantsFrench(header: string | null | undefined): boolean {
  const first = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('fr')
}
