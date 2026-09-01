# Podcapp, iOS

The app is four tabs — Aujourd'hui, Lire, Sources, Réglages — over the same API
the cloud pipeline writes to, plus a share extension: share a link from any app
and it reaches `POST /ingest` and joins the next episode. Playback streams the
published mp3 from R2, caches it locally (a published episode is immutable) and
survives tab changes through the mini player.

## What you need

| For | You need |
|---|---|
| Building and running in the simulator | Xcode (Mac App Store). Command Line Tools alone cannot build an iOS app |
| Running on your own iPhone | Nothing more: a free Apple ID signs the build for 7 days, then re-install to renew |
| **Uploading to TestFlight** | **Apple Developer Program, 99 USD/year — plus Xcode 26+, which needs macOS 15.6+** |

## Opening it

```
open ios/Podcapp.xcodeproj
```

The project is generated from `project.yml` by [XcodeGen]. Edit the yaml and
regenerate rather than reshaping targets by hand in Xcode, otherwise the two
descriptions drift apart:

```
xcodegen generate --spec ios/project.yml
```

Use **XcodeGen 2.42.x** (the binary lives in `/tmp/xcodegen/v242/` after a
`curl` of the GitHub release, and `/tmp` is wiped on reboot). From 2.44 it
writes project format 77, which Xcode 15.4 cannot open at all. Once this Mac
runs Xcode 26 — required for any TestFlight upload — any version will do.

`project.yml` also generates both `Info.plist` files: editing them by hand looks
like it works until the next `xcodegen generate` silently reverts it. Version
strings, fonts and the export-compliance key all live in the yaml.

## Installing on a device

Bump `CURRENT_PROJECT_VERSION` in `project.yml` first: the number shows next to
the logo in onboarding (`b17`), and it is the only reliable way to know which
build is actually running. Then uninstall the old copy and:

```
xcodebuild -project Podcapp.xcodeproj -scheme Podcapp -sdk iphoneos \
  -configuration Debug -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=V7BMDJS5C7 build
xcrun devicectl device install app --device <UDID> <path to the .app>
```

Two one-time device prerequisites: Developer Mode (Settings > Privacy &
Security, only appears after a first install attempt) and trusting the
certificate (Settings > General > VPN & Device Management).

Both targets declare the App Group `group.com.louisguichard.podcapp`. The
extension reads your token from that container: without it the share sheet
always fails with "Ajoutez votre jeton". `Config.sharesStorageWithExtension`
says whether the two can see the same storage.

## TestFlight

### 1. The upgrade chain (do this in order, nothing else works before it)

1. **macOS 15.6 or later.** Xcode 26 refuses to install below it, and 26.5+
   wants macOS Tahoe 26.2. Free, but it is an OS upgrade — plan an hour.
2. **Xcode 26 or later.** Since 2026-04-28 App Store Connect rejects any upload
   not built with the iOS 26 SDK. `testflight.sh` checks this before archiving
   so the rejection does not arrive after a ten-minute build.
3. **Apple Developer Program**, 99 USD/year, at developer.apple.com/programs.
   Individual enrolment is usually validated within a day or two.
4. **Update the team id.** The program creates a NEW team: `DEVELOPMENT_TEAM`
   in `project.yml` still holds `V7BMDJS5C7`, the free personal team. Replace it
   with the program team id (App Store Connect > Membership) and regenerate.

### 2. One-time setup in App Store Connect

- Register the two bundle ids under the new team — `com.louisguichard.podcapp`
  and `com.louisguichard.podcapp.share` — and the App Group
  `group.com.louisguichard.podcapp`, then add the group to both ids.
- Create the app record with bundle id `com.louisguichard.podcapp`.
- Users and Access > Integrations > App Store Connect API: create a key with
  the **App Manager** role, download the `.p8` **once** (Apple never shows it
  again), and note the key id and issuer id.

### 3. Upload

```
TEAM_ID=XXXXXXXXXX \
ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
ASC_KEY_PATH=~/private_keys/AuthKey_XXXXXXXXXX.p8 \
./testflight.sh
```

It archives in Release, exports with automatic signing and uploads. It does not
touch the build number (`manageAppVersionAndBuildNumber` is false), so a rejected
duplicate means: bump `CURRENT_PROJECT_VERSION` and re-run.

### 4. Testers

**Internal** (up to 100 people, all on your App Store Connect team): available
within minutes of processing, no review.

**External** (up to 10,000, invited by email or public link): goes through Beta
App Review. The text to paste into every App Store Connect form — beta
description, review notes, privacy questionnaire — is in
[docs/testflight.md](../docs/testflight.md). What it comes down to:

- a beta app description and a feedback email — both required before you can
  invite anyone external;
- **a demo account**, because the app is useless without a token: put a working
  API token and the base URL in the Beta App Review notes, or the reviewer sees
  the onboarding and nothing else;
- the privacy policy URL, `https://podcapp.vercel.app/privacy` — served by the
  API from `src/legal/privacy.ts` and linked at the bottom of the Réglages
  screen, since App Review 5.1.1 wants it reachable from inside the app too. It
  goes live with the next `vercel deploy --prod`.

The bundle already carries what Apple checks automatically: a `PrivacyInfo.xcprivacy`
in each target declaring the `UserDefaults` access reasons (`1C8F.1` for the App
Group, `CA92.1` for the fallback) and what the app sends to its own server, plus
`ITSAppUsesNonExemptEncryption=false` so no upload stops to ask about encryption.
The App Store Connect privacy questionnaire must say the same thing: user content
and an account identifier, linked to the user, used only for app functionality,
never for tracking.

## What it deliberately does not do

No sign-in with Apple or Google: the onboarding's last screen asks for the API
token in that slot, because token exchange needs endpoints that do not exist.
Per-sentence grounding is shown in the app; everything else about a run stays in
`episodes/<id>/run/` on R2.

[XcodeGen]: https://github.com/yonaskolb/XcodeGen
