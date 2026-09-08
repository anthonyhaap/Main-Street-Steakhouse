# The store apps

Two shells around the one site. Neither bundles a page of the league: both
load `https://steakhouse.football` live, so a deploy to Vercel is a deploy to
every phone and no store build is ever a stale copy of a Sunday.

| | what it is | how it is built | who it is for |
|---|---|---|---|
| `android/` | a Trusted Web Activity: Chrome, full screen, address bar hidden | GitHub Actions (`.github/workflows/android.yml`) | Google Play, closed testing track |
| `ios/` | a Capacitor app: a web view with Apple push and universal links | Xcode on a Mac | TestFlight |

The site meets them halfway. `/.well-known/assetlinks.json` and
`/.well-known/apple-app-site-association` vouch for each app so league links
open in it; `NativeBridge` (mounted in the root layout) handles what the frame
hands the page; and the notifications card, inside the iPhone app, registers
an Apple device token instead of a Web Push endpoint. The drain posts to Apple
for those rows through `src/lib/apns.ts`. Nothing changes for a browser.

## Environment variables, on Vercel

| variable | for | value |
|---|---|---|
| `ANDROID_CERT_FINGERPRINTS` | assetlinks.json | SHA-256 of the **app signing** certificate, colon-separated hex. Comma-separate several. |
| `APPLE_TEAM_ID` | apple-app-site-association | the ten-character team id on the developer account |
| `APNS_TEAM_ID` | push to iPhones | the same team id |
| `APNS_KEY_ID` | push to iPhones | the id of the APNs key made under Certificates, Identifiers & Profiles › Keys |
| `APNS_PRIVATE_KEY` | push to iPhones | the contents of that `.p8` file, `\n` for newlines if it has to be one line |
| `APNS_ENVIRONMENT` | push to iPhones | `production` (TestFlight and the store — the default) or `sandbox` (a build Xcode put on a phone) |

Each is optional and each degrades honestly: no fingerprints means the
Android app shows Chrome's address bar, no team id means league links open in
Safari, no APNs key means iPhone rows in the outbox fail with a message that
says which variable is missing while browsers still get theirs.

## Android: Google Play

Once, to set up:

1. A Play Console developer account (one-time fee) and a new app named
   Steakhouse with the package name `football.steakhouse.app`. Accept Play
   App Signing when it is offered: Google holds the key that signs what
   managers install, and the key below only signs the upload.
2. An upload key. On any machine with a JDK:

   ```sh
   keytool -genkeypair -v -keystore upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

   Keep `upload.jks` and both passwords somewhere that is not this
   repository (`*.jks` is ignored here on purpose).
3. Four repository secrets, under Settings › Secrets and variables › Actions:
   `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`),
   `ANDROID_KEY_PASSWORD`.
4. Run the **android** workflow from the Actions tab. Download
   `steakhouse-android`; `app-release.aab` inside it is what the Play Console
   takes. The workflow stamps its run number as the version code, so every
   run is uploadable.
5. Upload the bundle to a **closed testing** track and add the managers'
   Google account emails as testers. For a private league this is the whole
   distribution: a closed track never needs a public listing, and the
   managers install from the opt-in link the console gives you.
6. In the Play Console, under Test and release › Setup › App signing, copy
   the SHA-256 fingerprint of the **app signing key certificate** — not the
   upload key — into `ANDROID_CERT_FINGERPRINTS` on Vercel and redeploy.
   Chrome checks the file when the app first opens; until it matches, the app
   works but shows an address bar.

To ship a change to the shell itself (a new icon, a new shortcut): merge it,
run the workflow, upload the bundle. Changes to the league need none of that.

The project has no Java of its own. The launcher, the web-view fallback and
the notification delegate all come from `android-browser-helper` as they are,
and the manifest is the whole configuration. Web Push keeps working exactly
as on the home screen, because it is still Chrome underneath.

## iPhone: TestFlight

Needs a Mac with Xcode and an Apple Developer Program membership (yearly).

Once, to set up:

1. In App Store Connect, a new app with bundle id `football.steakhouse.app`.
2. An APNs key: Certificates, Identifiers & Profiles › Keys › add, tick Apple
   Push Notifications service. Download the `.p8` (Apple only offers it once)
   and note the key id. Put its contents, the key id and the team id into the
   three `APNS_*` variables on Vercel, and the team id into `APPLE_TEAM_ID`.
3. On the Mac:

   ```sh
   cd native/ios
   npm install
   npx cap sync ios
   npx cap open ios
   ```

   Dependencies come through Swift Package Manager, so there is no CocoaPods
   to install. In Xcode, select the App target › Signing & Capabilities and
   choose the team. Push Notifications and Associated Domains are already in
   `App.entitlements`; automatic signing adds them to the App ID.
4. Product › Archive, then Distribute App › TestFlight & App Store. Xcode
   swaps the push entitlement to production on the way out.
5. In App Store Connect › TestFlight, add the managers as **internal
   testers** (up to a hundred, no review) or as an external group (a short
   review the first time). Each gets an email, installs TestFlight, and taps.

For the next build: bump the version and build number on the App target's
General tab, archive, distribute. TestFlight builds expire after ninety days,
so plan on one before the season and one at the trade deadline.

What the shell does that Safari cannot: notifications, through Apple (the
card under My team asks the first time, as it does in a browser); league
links tapped in Messages open in the app once `APPLE_TEAM_ID` is set, which
is what keeps a sign-in link's session in the app rather than in Safari; and
pull to refresh, because a web view has no refresh of its own.

A build Xcode installs directly on a phone talks to Apple's sandbox push
service. To see a notification on such a build, set `APNS_ENVIRONMENT` to
`sandbox` on a preview deployment; leave production alone.

## What is not here

- **App Store review.** Apple's guideline 4.2 rejects apps that are "just a
  website", and this one is. TestFlight sidesteps review for internal
  testers, which is enough for twelve managers. A public listing would want
  something the site cannot do — and there is nothing the league needs that
  the site cannot do.
- **Offline.** Both apps show the "kitchen's closed" page with no signal,
  the same as the site. Every screen reads live scores, live claims and live
  offers; a cached one would be a confident lie.
- **A built iOS app in CI.** Archiving needs a Mac and a signing identity,
  and a macOS runner costs money the league does not need to spend for two
  builds a season.
