# TestFlight — ce qu'App Store Connect demande

Le runbook technique (chaîne de mise à niveau, signature, upload) est dans
[ios/README.md](../ios/README.md). Ce fichier-ci ne contient que le contenu à
coller dans les formulaires, prêt à l'emploi.

**La langue principale de la fiche est l'anglais** (comme le site et l'app par
défaut depuis le 2026-09-01) : tous les textes ci-dessous sont donc en anglais.
Une localisation française pourra être ajoutée plus tard sur la même fiche.

## Déjà fait dans App Store Connect (2026-09-01)

Fiche créée, **app id `6807563809`**. Sont enregistrés : sous-titre, catégorie
News, droits sur le contenu tiers (« oui, je possède les droits »),
classification par âge **13+**, étiquette de confidentialité **publiée** (les
deux types du manifeste), et côté TestFlight la description bêta, l'e-mail de
retour, l'URL marketing `https://podcapp.fr` et l'URL de confidentialité.

Restent : le bloc contact de vérification (bloqué sur le numéro de téléphone,
voir plus bas), le compte de démonstration, et l'upload du build.

## Identifiant d'équipe

`V7BMDJS5C7`, déjà en place dans `ios/project.yml`. **Rien à changer** :
l'adhésion au Developer Program a conservé l'identifiant de l'équipe
personnelle (vérifié sur un export App Store). Si un jour Membership details
affiche un autre Team ID, le remplacer puis `xcodegen generate --spec project.yml`.

## Fiche app (Nouvelle app)

| Champ | Valeur |
|---|---|
| Plateformes | **iOS seul** — pas de macOS : la cible est iPhone seul (`TARGETED_DEVICE_FAMILY: "1"`), une plateforme macOS resterait vide. Ajoutable plus tard. |
| Nom | `Podcapp` — s'il est refusé pour cause de doublon sur l'App Store, prendre « Podcapp Briefing » |
| Langue principale | **Anglais (États-Unis)** |
| Identifiant de lot | `com.louisguichard.podcapp` |
| UGS (SKU) | `podcapp` — interne, invisible des utilisateurs, non modifiable ensuite |
| Accès utilisateur | Accès complet |

## Informations App Store

| Champ | Valeur |
|---|---|
| Sous-titre | `Your daily audio briefing` (25 car., limite 30) |
| Catégorie | News |
| Politique de confidentialité | https://podcapp.vercel.app/privacy |

## TestFlight → Test Information

**Email de retour :** guich.studio@gmail.com

**Description bêta :**

> Podcapp turns what you saved but never read — articles, videos, newsletters —
> into an audio briefing of five minutes or less, in your language, every
> morning. Share a link from any app and it joins the next episode. The app
> follows your phone's language: English or French, for the interface and for
> the episode itself.
>
> What sets Podcapp apart from an automatic summary: every sentence is checked
> against its sources before it is recorded. The app shows you the report —
> how many sentences were checked, which ones were rewritten to match the
> evidence, and which cited sources were set aside rather than reconstructed
> from memory. That is the part to test: share three or four links, listen to
> the next episode, open the sources panel, and tell us whether you would have
> flagged a sentence we let through.

## Beta App Review — le bloc contact est tout-ou-rien

Dans TestFlight > Test Information, « Personne à contacter » (Prénom, Nom,
**Numéro de téléphone**, E-mail) et « Remarques destinées à l'équipe de
vérification » s'enregistrent ensemble : un seul champ vide et App Store
Connect rejette les cinq d'un bloc, avec le message trompeur « Impossible
d'enregistrer le champ X car un autre champ n'est pas valide ». Le téléphone
est le champ qu'on oublie.

## Beta App Review — informations de connexion

L'app ne montre rien sans jeton : **sans compte de démonstration, la revue
échoue**. Cocher « Connexion requise » et remplir :

| Champ | Valeur |
|---|---|
| Nom d'utilisateur | `beta-review@podcapp.fr` |
| Mot de passe | le jeton d'API du compte (**pas dans ce dépôt** : le jeton est une clé d'accès. Il est déjà collé dans App Store Connect ; s'il faut le retrouver, il vit sur la ligne `users.api_token` du compte en base) |

Le compte existe (créé le 2026-09-01, id `ca02f27c-06fa-4ab7-a1e4-6c6c000786cf`),
réglé en **anglais**, voix Eric, cible 5 min, peuplé de six sources anglaises
tirées du jeu d'eval et d'un épisode publié — un compte vide donne un écran vide
au relecteur. Pour en refaire un :

```
pnpm inspect create-user <email>          # imprime le jeton UNE fois
curl -X PUT $API/me -H "Authorization: Bearer $T" \
     -d '{"language":"en","target_minutes":5}'
curl -X POST $API/ingest ... x6           # >= 4 sources derriere des stories ouvertes
curl -X POST $API/episodes
```

**Notes de revue** (en anglais) :

> Podcapp is an audio briefing app, currently a closed beta. The interface and
> the episodes follow the phone's language (English or French).
>
> The last onboarding screen asks for an API token instead of Sign in with
> Apple, because token exchange endpoints do not exist yet. Tap through the
> intro screens, then paste the token provided in the password field above.
> The app then shows a published episode you can play.
>
> All content comes from links the account holder saved; nothing is generated
> without user-submitted sources.

## App Privacy (le questionnaire)

Il doit dire exactement ce que déclarent les `PrivacyInfo.xcprivacy` du bundle,
sinon Apple relève la contradiction :

| Donnée | Réponse |
|---|---|
| User Content → Other User Content | collectée, **liée** à l'utilisateur, **pas** de suivi, finalité : fonctionnement de l'app |
| Identifiers → User ID | collectée, **liée** à l'utilisateur, **pas** de suivi, finalité : fonctionnement de l'app |
| Tout le reste | non collecté |
| Suivi publicitaire | non |

**Conformité à l'export** : rien à répondre. `ITSAppUsesNonExemptEncryption` est
à `false` dans le bundle, la question ne sera pas posée.

## Clé API pour l'upload

App Store Connect → Users and Access → Integrations → App Store Connect API.
Le premier passage demande de cliquer **Demander l'accès** : tant que l'accès
n'est pas accordé, aucune clé ne peut être générée. Puis **Générer une clé
API**, rôle **App Manager**, télécharger le `.p8` (une seule fois, Apple ne le
redonne pas), noter le Key ID ; l'Issuer ID s'affiche en haut de la liste.

**Le rôle d'une clé est définitif, et App Manager ne suffit pas.** Il permet
de téléverser, pas de laisser la signature dans le cloud fabriquer ce qu'il
faut pour signer. L'export échoue en deux temps, et le second message
n'apparaît qu'une fois le premier réglé :

```
error: exportArchive Cloud signing permission error
error: exportArchive No signing certificate "iOS Distribution" found
```
puis, une fois le certificat créé :
```
error: exportArchive Provisioning profile "iOS Team Store Provisioning Profile:
com.louisguichard.podcapp" doesn't include signing certificate
"Apple Distribution: louis guichard (V7BMDJS5C7)"
```

(l'archive, elle, réussit à chaque fois — c'est toujours l'export qui bloque).
Ne pas chercher du côté des contrats Apple : le contrat applications gratuites
peut être actif et l'erreur rester la même.

**Ce qu'il faut réellement : une clé en rôle Admin.** Créer le certificat à la
main dans Xcode (Réglages → Comptes → l'équipe → Manage Certificates… → + →
Apple Distribution) règle la première erreur mais pas la seconde : régénérer
les profils de provisionnement passe aussi par la signature dans le cloud.
Deux façons d'en finir :

- une seconde clé en rôle **Admin** — c'est ce qui a marché le 2026-09-02 ;
  **la supprimer juste après l'upload**, elle n'expire jamais ;
- ou distribuer depuis l'Organizer de Xcode (Product → Archive → Distribute
  App), qui signe avec le compte Admin connecté et régénère les profils seul.

Vérifier le certificat avec `security find-identity -v -p codesigning` : il
doit y avoir une identité `Apple Distribution` à côté d'`Apple Development`.

Puis, depuis `ios/` :

```
TEAM_ID=V7BMDJS5C7 \
ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/private_keys/AuthKey_….p8 \
./testflight.sh
```
