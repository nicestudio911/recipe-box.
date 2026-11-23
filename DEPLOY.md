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

## Deploying by hand (optional)

With the Fly.io command line tool installed (https://fly.io/docs/flyctl/install/):

```bash
fly auth login
fly deploy --ha=false
```

`--ha=false` keeps it to one machine, which matters because the database lives on
that machine's disk.
