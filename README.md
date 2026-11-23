# Recipe Box

A recipe app for phone and web, from one codebase (an installable web app).

- **Create and save recipes**: title, photo, servings, times, ingredients, steps, tags, notes.
- **Import from a photo**: take a picture with the camera or upload one or more photos of a cookbook page or a handwritten card. Text recognition runs on the device (English and Bulgarian), then the text is split into title, ingredients and steps for you to check.
- **Import from a link**: paste a recipe page address. Works with most recipe sites (schema.org data), with a fallback for simpler pages. On Android you can also use Share → Recipe Box from the browser once installed.
- **Paste text**: paste a recipe from a message or document.
- Search, tags, favourites, ½×/2×/3× quantity scaling, tick off ingredients and steps, cooking mode (bigger text, screen stays on), share, backup and restore.
- **Accounts**: anyone can sign up with email and password. Each person's recipes are stored on the server and show up on every device they log in on. A copy stays on the device so recipes still open offline. Recipes saved by version 1 (device only) are offered for upload at first login.
- Account settings: log out, download/restore a backup, delete account (removes all their data).

## Run it

Needs Node.js 22.5 or newer (uses the built-in SQLite).

```bash
npm install
npm start          # http://localhost:3000
npm test           # parser and API tests
```

### Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for the SQLite database (`recipes.db`). Put it on a persistent disk and back it up. |
| `TRUST_PROXY` | off | Set to `1` behind a host's https proxy (Fly.io, Render, Railway, nginx) so secure cookies and rate limits use the real client address |
| `ALLOW_LOCAL_URLS` | off | Testing only: lets link import open private network addresses |

### Deploy

The app is one small Node process plus a SQLite file, so it needs a host with a **persistent disk**:

```bash
docker build -t recipe-box .
docker run -p 3000:3000 -v recipe-data:/data recipe-box
```

For Fly.io, follow [DEPLOY.md](DEPLOY.md) (`fly.toml` is included). The Dockerfile also works on Render (with a disk at `/data`), Railway (with a volume) or any VPS. The host must give it an https address: phone camera capture, installing to the home screen and secure login cookies all need https.

Then open the address on a phone and choose "Add to Home Screen" (iPhone) or "Install app" (Android).

### Security notes

Passwords are hashed with scrypt; sessions are random tokens in HttpOnly, SameSite cookies (Secure on https), stored hashed. Writes must be same-origin JSON (CSRF protection). Sign-up/log-in, saves and link imports are rate limited, link import requires login and refuses private network addresses, recipe fields are size-limited, and pages are served with a strict Content-Security-Policy.

Not yet included: password reset by email (needs an email provider), email verification, and a privacy policy / terms page, which a public app should have before launch.

## How it fits together

- `server.js` + `lib/app.js`: Node server with no framework. Serves the app, the accounts and recipes API (`/api/signup`, `/api/login`, `/api/recipes`…), and `/api/import?url=…`, which fetches a recipe page server side (browsers can't because of CORS), handles old Bulgarian `windows-1251` pages, and blocks private network addresses.
- `lib/store.js`: SQLite tables for users, sessions and recipes; password hashing; input cleaning.
- `lib/extract.js`: turns a page into a recipe (JSON-LD → microdata → headings heuristic).
- `public/js/parse-text.js`: turns OCR or pasted text into a recipe (English and Bulgarian section names and units).
- `public/js/app.js`, `db.js`: the app UI, the API client and the offline copy.
- Text recognition is [tesseract.js](https://github.com/naptha/tesseract.js), served from `node_modules` (no CDN).
