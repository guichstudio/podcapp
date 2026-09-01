# TestFlight — ce qu'App Store Connect demande

Le runbook technique (chaîne de mise à niveau, signature, upload) est dans
[ios/README.md](../ios/README.md). Ce fichier-ci ne contient que le contenu à
coller dans les formulaires, prêt à l'emploi.

## À reporter dans le dépôt

`ios/project.yml` porte encore `DEVELOPMENT_TEAM: V7BMDJS5C7`, l'équipe
personnelle gratuite. L'adhésion au programme crée une **autre** équipe :
l'identifiant se lit sur developer.apple.com/account → Membership details →
Team ID (dix caractères). Le remplacer, puis `xcodegen generate --spec project.yml`.

## Fiche app

| Champ | Valeur |
|---|---|
| Nom | Podcapp — s'il est déjà pris sur l'App Store, App Store Connect le refusera à la création : prévoir « Podcapp Briefing » |
| Sous-titre | Votre radio quotidienne |
| Bundle id | `com.louisguichard.podcapp` |
| Langue principale | Français |
| Catégorie | Actualités |
| Politique de confidentialité | https://podcapp.vercel.app/privacy |

## TestFlight → Test Information

**Email de retour :** guich.studio@gmail.com

**Description bêta :**

> Podcapp transforme ce que vous n'avez pas eu le temps de lire — articles,
> vidéos, newsletters — en un briefing audio de cinq minutes au plus, dans
> votre langue, chaque matin. Vous partagez un lien depuis n'importe quelle app, il
> rejoint le prochain épisode.
>
> Ce qui distingue Podcapp d'un résumé automatique : chaque phrase est vérifiée
> contre ses sources avant d'être enregistrée. L'app vous montre le rapport —
> phrases vérifiées, phrases corrigées, phrases coupées, sources écartées et
> pourquoi. Testez surtout ça : partagez trois ou quatre liens, écoutez
> l'épisode du lendemain, et dites-nous si vous auriez signalé une phrase que
> nous avons laissée passer.

## Beta App Review — informations de connexion

L'app ne montre rien sans jeton : **sans compte de démonstration, la revue
échoue**. Cocher « Connexion requise » et remplir :

| Champ | Valeur |
|---|---|
| Nom d'utilisateur | (laisser l'adresse du compte de test) |
| Mot de passe | le jeton d'API du compte de test |

Créer ce compte avant la soumission, avec quelques sources déjà traitées et au
moins un épisode publié — un compte vide donne un écran vide au relecteur :

```
pnpm inspect create-user beta-review@podcapp.test
```

**Notes de revue** (en anglais, le relecteur ne lit pas forcément le français) :

> Podcapp is a French-language audio briefing app, currently a closed beta.
>
> The last onboarding screen asks for an API token instead of Sign in with
> Apple, because token exchange endpoints do not exist yet. Tap through the
> five intro screens, then paste the token provided in the password field
> above. The app then shows a published episode you can play.
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
