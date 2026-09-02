// Les conditions d'utilisation, servies a une adresse stable comme la
// politique de confidentialite.
//
// Elles existent pour trois raisons concretes, pas par formalisme. App Review
// verifie qu'une app qui laisse creer un compte dit a quelles conditions.
// L'app produit un texte lu a voix haute a partir d'articles tiers, ce qui
// demande de dire clairement qui possede quoi. Et les briefings couvrent
// regulierement les marches : un texte genere par machine sur la finance sans
// avertissement explicite est une cause de rejet nommee, et surtout un risque
// pour le lecteur qui le prendrait pour un conseil.

import { legalPage, wantsFrench } from './layout.js'

export const TERMS_CONTACT = 'guich.studio@gmail.com'
export const TERMS_UPDATED = '2 septembre 2026'
export const TERMS_UPDATED_EN = '2 September 2026'

const BODY_FR = `
<h1>Conditions d’utilisation</h1>
<p class="sub">Podcapp · dernière mise à jour le ${TERMS_UPDATED} · version bêta</p>

<p class="lede">Podcapp transforme les liens que vous lui envoyez en un briefing audio
quotidien. En utilisant l’app, vous acceptez ce qui suit. C’est écrit pour être lu, pas
pour être contourné : si un point vous semble injuste ou obscur, écrivez à
<a href="mailto:${TERMS_CONTACT}">${TERMS_CONTACT}</a>.</p>

<h2>1. Ce que fait le service</h2>
<p>Vous enregistrez des liens, des textes ou des newsletters. Le service en extrait le
contenu, sélectionne ce qui mérite d’être raconté, écrit un script, le vérifie contre les
sources, et le lit à voix haute. Le résultat vous est livré dans l’app et sur un flux
audio privé.</p>

<h2>2. C’est une bêta</h2>
<p>Le service est en développement. Il peut être interrompu, changer de comportement, ou
perdre des données. Aucune disponibilité n’est garantie et aucun engagement de niveau de
service n’est pris. N’en faites pas votre unique dépôt pour quoi que ce soit
d’important.</p>

<h2>3. Votre contenu vous appartient</h2>
<p>Ce que vous envoyez reste à vous. Vous accordez à Podcapp le droit de le stocker, de le
traiter et de le transmettre aux prestataires listés dans la
<a href="/privacy">politique de confidentialité</a>, dans le seul but de fabriquer vos
épisodes. Ce droit s’éteint quand vous supprimez votre compte.</p>

<h2>4. Ce que vous garantissez en envoyant un lien</h2>
<p>Vous devez avoir le droit d’accéder au contenu que vous sauvegardez et de le soumettre
à un traitement automatisé. N’envoyez pas de contenu illégal, ni de contenu dont l’accès
vous est interdit.</p>

<h2>5. Le contenu des tiers reste aux tiers</h2>
<p>Les articles, vidéos et newsletters que vous sauvegardez appartiennent à leurs auteurs
et éditeurs. Podcapp les cite, les résume et en conserve de courts extraits pour prouver
ce qu’il affirme. Vos épisodes sont destinés à votre usage personnel : ils ne sont ni à
rediffuser publiquement, ni à revendre.</p>

<h2>6. Un briefing n’est pas un conseil</h2>
<div class="note">
<p>Les épisodes sont écrits par des modèles de langage. Chaque phrase vérifiable est
contrôlée contre ses sources avant l’enregistrement, et l’app vous montre ce contrôle —
mais cette vérification réduit les erreurs, elle ne les élimine pas. Une source peut
elle-même se tromper.</p>
</div>
<p>En particulier, rien dans un épisode ne constitue un conseil en investissement,
financier, juridique, fiscal ou médical, et rien n’est adapté à votre situation. Les
briefings couvrent régulièrement les marchés et l’économie : traitez-les comme un résumé
de ce que vous avez vous-même choisi de lire, jamais comme une recommandation. Vérifiez
auprès des sources citées, et consultez un professionnel avant toute décision.</p>

<h2>7. Votre compte</h2>
<p>Vous vous connectez avec Sign in with Apple. Vous êtes responsable de l’accès à votre
appareil et à votre compte Apple. Les Réglages de l’app listent les appareils connectés et
permettent d’en révoquer un à tout moment.</p>

<h2>8. Suppression</h2>
<p>Vous pouvez supprimer votre compte depuis les Réglages de l’app. La suppression efface
vos sources, vos épisodes, les fichiers audio et le flux privé. Elle est définitive et
sans retour possible.</p>

<h2>9. Ce que nous pouvons faire</h2>
<p>Un compte peut être suspendu ou fermé s’il sert à enfreindre ces conditions ou la loi.
Dans la mesure permise par le droit applicable, le service est fourni « en l’état » et la
responsabilité est limitée à ce que la loi n’autorise pas à exclure.</p>

<h2>10. Droit applicable et contact</h2>
<p>Ces conditions sont régies par le droit français. Pour toute question :
<a href="mailto:${TERMS_CONTACT}">${TERMS_CONTACT}</a>.</p>

<footer>Podcapp · <a href="/privacy">Politique de confidentialité</a></footer>
`

const BODY_EN = `
<h1>Terms of Use</h1>
<p class="sub">Podcapp · last updated ${TERMS_UPDATED_EN} · beta</p>

<p class="lede">Podcapp turns the links you save into a daily audio briefing. By using the
app you agree to what follows. It is written to be read, not to be got around: if
something here seems unfair or unclear, write to
<a href="mailto:${TERMS_CONTACT}">${TERMS_CONTACT}</a>.</p>

<h2>1. What the service does</h2>
<p>You save links, text or newsletters. The service extracts the content, selects what is
worth telling, writes a script, checks it against the sources, and reads it aloud. The
result reaches you in the app and on a private audio feed.</p>

<h2>2. This is a beta</h2>
<p>The service is under development. It may be interrupted, change how it behaves, or lose
data. No availability is guaranteed and no service level is promised. Do not make it your
only copy of anything that matters.</p>

<h2>3. Your content stays yours</h2>
<p>What you send remains yours. You grant Podcapp the right to store it, process it and
pass it to the providers listed in the <a href="/privacy">privacy policy</a>, for the sole
purpose of building your episodes. That right ends when you delete your account.</p>

<h2>4. What you warrant when you save a link</h2>
<p>You must have the right to access the content you save and to submit it for automated
processing. Do not send unlawful content, or content you are not allowed to access.</p>

<h2>5. Third-party content stays with third parties</h2>
<p>The articles, videos and newsletters you save belong to their authors and publishers.
Podcapp cites them, summarises them, and keeps short extracts to evidence what it says.
Your episodes are for your personal use: they are not to be broadcast publicly or
resold.</p>

<h2>6. A briefing is not advice</h2>
<div class="note">
<p>Episodes are written by language models. Every checkable sentence is verified against
its sources before recording, and the app shows you that check — but verification reduces
errors, it does not remove them. A source can be wrong on its own.</p>
</div>
<p>In particular, nothing in an episode is investment, financial, legal, tax or medical
advice, and nothing is tailored to your situation. Briefings regularly cover markets and
the economy: treat them as a summary of what you chose to read, never as a recommendation.
Check against the sources cited, and consult a professional before acting.</p>

<h2>7. Your account</h2>
<p>You sign in with Sign in with Apple. You are responsible for access to your device and
your Apple account. The app's Settings list your signed-in devices and let you revoke any
of them at any time.</p>

<h2>8. Deletion</h2>
<p>You can delete your account from the app's Settings. Deletion erases your sources, your
episodes, the audio files and the private feed. It is permanent and cannot be undone.</p>

<h2>9. What we may do</h2>
<p>An account may be suspended or closed if it is used to break these terms or the law. To
the extent permitted by applicable law, the service is provided "as is" and liability is
limited to what the law does not allow to be excluded.</p>

<h2>10. Governing law and contact</h2>
<p>These terms are governed by French law. Any question:
<a href="mailto:${TERMS_CONTACT}">${TERMS_CONTACT}</a>.</p>

<footer>Podcapp · <a href="/privacy">Privacy policy</a></footer>
`

/// Anglais par defaut, francais si le navigateur le demande : meme regle que la
/// politique de confidentialite et que l'app, qui suit la langue du telephone.
export function termsHtml(language: string | null | undefined): string {
  const french = wantsFrench(language)
  return legalPage({
    french,
    title: french ? 'Conditions d’utilisation — Podcapp' : 'Terms of Use — Podcapp',
    body: french ? BODY_FR : BODY_EN,
  })
}
