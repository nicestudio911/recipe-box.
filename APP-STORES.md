# Recipe Box in Google Play and the App Store

Recipe Box is a PWA (an installable web app), so the store versions are thin wrappers
around the website. Every change you push still goes live everywhere at once, with no
store update needed. The app already has what the stores look for: icons (including
"maskable" ones for Android), offline mode, a privacy policy, terms, in-app account
deletion, and data export.

**Before you start:** consider a domain of your own (e.g. `recipebox.bg`, about €10/year).
The store apps are tied to the web address, and moving away from
`recipe-box-ivan.fly.dev` later means publishing new store apps. Fly.io can serve a
custom domain for free (**Fly.io dashboard → your app → Certificates**). Remember to
update `APP_URL` in `fly.toml` and the Google sign-in redirect URI too.

---

## Google Play (do this first: cheaper and simpler)

**Costs:** $25 once. **Time:** about an hour of work, then Google's review.

1. **Developer account.** Sign up at https://play.google.com/console ($25, ID check).
   New *personal* accounts must run a closed test with at least 12 testers for 14 days
   before the app can go public. Friends and family with Android phones are enough.
2. **Build the Android package.** Go to https://www.pwabuilder.com, enter your app's
   address, then **Package for stores → Android → Generate**. Choose a package ID you
   will keep forever, such as `bg.recipebox.app`. Download the zip. It contains:
   - an `.aab` file (what you upload to Google Play)
   - a **signing key** and its password. Back it up somewhere safe. You need it for
     every future update of the Android app.
   - `assetlinks.json`
3. **Let the app open full screen.** Open the `assetlinks.json` from the zip and copy
   the `sha256_cert_fingerprints` value. In Fly.io → your app → **Secrets**, add:
   - `ANDROID_PACKAGE` = your package ID (e.g. `bg.recipebox.app`)
   - `ANDROID_CERT_SHA256` = the fingerprint
   After the first upload, Play Console shows a second fingerprint under
   **Test and release → App integrity → App signing**. Add it too, separated by a comma.
   Check: `https://<your address>/.well-known/assetlinks.json` should show both.
   Without this, the app shows a browser address bar at the top.
4. **Create the app in Play Console** and fill in:
   - **Store listing:** name, short and full description (in English and Bulgarian),
     the 512×512 icon (`public/icons/icon-512.png`), a 1024×500 feature graphic, and at
     least 2 phone screenshots.
   - **Privacy policy:** `https://<your address>/privacy.html`
   - **App access:** "All functionality is available without special access" is wrong,
     because you need an account. Give Google a test login (create one for them).
   - **Data safety** (answers for this app):
     - Collects: email address, name (optional), photos (only the ones the user adds),
       "other user-generated content" (recipes, lists). All are for app functionality
       and account management, none are shared for advertising, none are optional except name and photos.
     - Data is encrypted in transit: **yes**. Users can request deletion: **yes**
       (in the app, Settings → Delete account). Deletion URL: your privacy page.
   - **Content rating** questionnaire (no violence etc. → "Everyone").
   - **Target audience:** 16+ (matches the terms).
5. Upload the `.aab` to **Closed testing**, add your testers, and after 14 days apply
   for production.

## Apple App Store (optional, more effort)

**Costs:** $99 per year. **Needs:** a Mac with Xcode.

1. Join the Apple Developer Program: https://developer.apple.com/programs/
2. On https://www.pwabuilder.com choose **Package for stores → iOS**. You get an Xcode
   project. Open it on the Mac, set your team, and upload through **Product → Archive**.
3. In App Store Connect fill in the listing, privacy "nutrition labels" (same answers as
   Google's data safety), and a test login for the reviewer.

Things to know about Apple's review:
- Apple rejects apps that are "just a website" (guideline 4.2). Recipe Box has real
  app features (camera import, offline mode, timers, sharing), which helps, but approval
  isn't guaranteed.
- If the iOS app shows "Continue with Google", Apple requires an equivalent private
  login such as **Sign in with Apple** (guideline 4.8). Either add Sign in with Apple
  first (ask me), or hide the Google button inside the iOS app.
- iPhone users can already install the web app without the store: Safari → Share →
  **Add to Home Screen**.
