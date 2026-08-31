# Briefing, iOS

A one-screen app whose real content is its share extension: share a link from any
app, it reaches `POST /ingest` and joins the next episode. The Apple Shortcut does
the same thing without any of this; the app exists for the tap that is one tap
shorter and for a failure you can actually read.

## What you need

- **Xcode** (free, Mac App Store, about 15 GB). Command Line Tools alone cannot
  build an iOS app.
- To run it on your own iPhone: nothing more. A free Apple ID signs the build for
  7 days, after which Xcode re-signs it in one click.
- **TestFlight specifically needs the Apple Developer Program, 99 USD per year.**
  Nothing else here does.

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

## First build

1. Select the **Podcapp** target, **Signing & Capabilities**, and pick your team.
   Xcode fills in the signing identity.
2. Do the same for the **ShareExtension** target.
3. Both targets already declare the App Group `group.com.louisguichard.podcapp`
   in their entitlements. Xcode registers it with your team the first time you
   build; if it complains, remove and re-add the App Groups capability so it can
   create it. **The extension reads your token from that group: without it the
   share sheet always fails with "Ajoutez votre jeton".**
4. Run on your device, paste the API token, tap **Enregistrer et tester**. That
   writes one real source, which is the only honest way to prove the token works.
5. Share any page from Safari, choose **Briefing**.

## TestFlight

Only if you have the paid program:

1. Create the app record in App Store Connect with bundle id
   `com.louisguichard.podcapp`.
2. In Xcode: **Product > Archive**, then **Distribute App > TestFlight**.
3. Internal testers (yourself) get it in minutes. External testers go through
   Beta App Review.

## What it deliberately does not do

No playback, no episode list. Episodes belong in a podcast app, which already
does offline downloads, speed control and lock-screen playback better than this
ever would. The RSS feed is what you subscribe to.

[XcodeGen]: https://github.com/yonaskolb/XcodeGen
