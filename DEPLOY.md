# Put Recipe Box online with Fly.io

Every change that lands on the `main` branch of the GitHub repository is tested
and then deployed to Fly.io automatically (`.github/workflows/deploy.yml`).
You only do the setup below once. No command line needed.

## One-time setup (about 10 minutes)

1. **Fly.io account.** Sign up at https://fly.io/app/sign-up and add a payment card.
   Expected cost: roughly $2–5 a month. The app sleeps when nobody uses it, which
   keeps it cheap; the first visit after a pause takes a few seconds.

2. **Fly.io token.** In the Fly.io dashboard open **Tokens**
   (https://fly.io/dashboard/personal/tokens), create an **organization** token for
   your personal organization, and copy it. It is shown only once.

3. **Give the token to GitHub.** In the GitHub repository open
   **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `FLY_API_TOKEN`. Value: the token. Save.

4. **First deploy.** Open the repository's **Actions** tab, pick
   **Test and deploy**, and press **Run workflow** (or just push any change to `main`).
   The first run creates the app and its 1 GB database disk, then deploys.
   It takes a few minutes.

Your app is then at **https://recipe-box-ivan.fly.dev**. To use another name,
change `app = "…"` in `fly.toml` before the first deploy (it must be unique on Fly.io).

On your phone, open the address and choose **Add to Home Screen** (iPhone) or
**Install app** (Android).

## After that

- **Changes go live by themselves** when they are merged into `main`, as long as the
  tests pass. If the tests fail, nothing is deployed and the live app stays as it was.
- **See what happened:** the repository's **Actions** tab shows each test and deploy.
- **Backups:** Fly.io snapshots the database disk every day and keeps them 5 days
  (dashboard → your app → Volumes). Each user can also download their own backup in
  the app's settings.
- **Your own domain** (e.g. recipes.example.com): dashboard → your app →
  Certificates, then follow the DNS instructions.

## Turn on emails (verification and password reset)

Change password works without this. Email verification and "Forgot password?"
stay hidden in the app until an email service is connected. The easiest is Brevo
(free: 300 emails a day, no own domain needed):

1. Sign up at https://www.brevo.com.
2. **Senders & IP → Senders**: add and confirm the address emails should come from.
3. **SMTP & API → API keys**: create a key and copy it.
4. In the Fly.io dashboard open your app → **Secrets**, and add:
   - `BREVO_API_KEY` = the key
   - `MAIL_FROM` = `Recipe Box <the address from step 2>`

Fly.io restarts the app with the new secrets, and the email features appear.
(Resend works too: set `RESEND_API_KEY` instead. It needs your own domain.)

## Turn on AI for social media imports

1. Create an account at https://console.anthropic.com, add a payment method, and
   create an API key (**API keys → Create key**).
2. Fly.io dashboard → your app → **Secrets** → add `ANTHROPIC_API_KEY` = the key.
3. Optional, to test imports from GitHub: add the same key as a repository secret
   `ANTHROPIC_API_KEY`, then run **Actions → Try link imports** with some links.

Each social media import then costs roughly 2–4 US cents. Without the key, social
imports still work for captions that are written as a clear list.

## Turn on error alerts

Once emails work (see above), add one more secret in Fly.io → your app → **Secrets**:

- `ALERT_EMAIL` = the address that should get an email when something breaks

You then get an email when the server hits an error, when an AI import fails, or
when the app crashes in someone's browser. The same error is emailed at most once
an hour and at most 20 emails a day. Errors are always visible in the Fly.io
dashboard → your app → **Logs**, even without this.

## Turn on backups

Every change to the database is copied within seconds to a private storage bucket
(Tigris, built into Fly.io, free up to 5 GB), using Litestream. If the disk is ever
lost, the app restores the latest copy by itself when it starts.

Easiest: on GitHub open **Actions → Turn on backups → Run workflow**. It creates the
bucket and restarts the app. The log line `Backups: on` means it worked.

If that fails because the Fly.io token can't create storage, do it once by hand with
the Fly.io command line tool:

```bash
fly storage create --app recipe-box-ivan --name recipe-box-ivan-backups
fly deploy --ha=false
```

To restore an older state by hand: `fly ssh console`, then
`litestream restore -config /app/litestream.yml -timestamp 2026-11-20T10:00:00Z -o /data/restored.db /data/recipes.db`.

## Turn on "Sign in with Google"

1. Open https://console.cloud.google.com, create a project (e.g. "Recipe Box").
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app
   name, your support email, and add the links to your privacy policy
   (`https://recipe-box-ivan.fly.dev/privacy.html`) and terms (`/terms.html`). Publish it.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `https://recipe-box-ivan.fly.dev/api/auth/google/callback`
4. Copy the **Client ID** and **Client secret** into Fly.io → your app → **Secrets** as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The "Continue with Google" button then appears on the login page. Someone who already
has an account with the same email lands in that same account.

## Deploying by hand (optional)

With the Fly.io command line tool installed (https://fly.io/docs/flyctl/install/):

```bash
fly auth login
fly deploy --ha=false
```

`--ha=false` keeps it to one machine, which matters because the database lives on
that machine's disk.
