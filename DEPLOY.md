# Put Recipe Box online with Fly.io

Takes about 15 minutes the first time. You end up with an address like
`https://recipe-box-ivan.fly.dev` that works on any phone or computer.

## 1. Create a Fly.io account

Sign up at https://fly.io/app/sign-up and add a payment card (Fly.io asks for one
even for small apps). Expected cost: roughly $2–5 a month. The app goes to sleep
when nobody is using it, which keeps it cheap; the first visit after a pause takes
a few seconds to wake it.

## 2. Install the Fly.io command line tool

- **Mac:** `brew install flyctl` (or `curl -L https://fly.io/install.sh | sh`)
- **Windows (PowerShell):** `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`
- **Linux:** `curl -L https://fly.io/install.sh | sh`

Then sign in (it opens your browser):

```bash
fly auth login
```

## 3. Create the app

Unzip `recipe-app.zip`, open a terminal in that folder, and run
(pick your own name; it becomes part of the address):

```bash
fly launch --no-deploy --copy-config --name recipe-box-ivan
```

If it asks whether to set up a Postgres or Redis database, answer **no**.
The app keeps its own database on a disk.

## 4. Deploy

```bash
fly deploy --ha=false
```

`--ha=false` keeps it to one machine. That matters: the database lives on that
machine's disk. The first deploy also creates the 1 GB disk (`recipe_data`).

When it finishes:

```bash
fly open
```

Sign up in the app, then open the same address on your phone and choose
**Add to Home Screen** (iPhone) or **Install app** (Android).

## Later

- **Update after changes:** run `fly deploy` again in the folder.
- **Backups:** Fly.io snapshots the disk every day and keeps them 5 days
  (`fly volumes list`, then `fly volumes snapshots list <volume id>`).
  Each user can also download their own backup from the app's settings.
- **Logs if something looks wrong:** `fly logs`
- **Your own domain** (e.g. recipes.example.com): `fly certs add recipes.example.com`
  and follow the DNS instructions it prints.
