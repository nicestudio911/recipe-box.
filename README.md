# Recipe Box

A recipe app for phone and web, from one codebase (an installable web app).

- **Create and save recipes**: title, photo, servings, times, ingredients, steps, tags, notes.
- **Import from a photo**: take a picture with the camera or upload one or more photos of a cookbook page or a handwritten card. Text recognition runs on the device (English and Bulgarian), then the text is split into title, ingredients and steps for you to check.
- **Import from a link**: paste a recipe page address. Works with most recipe sites (schema.org data), with a fallback for simpler pages. On Android you can also use Share → Recipe Box from the browser once installed.
- **Paste text**: paste a recipe from a message or document.
- Search, tags, favourites, ½×/2×/3× quantity scaling, tick off ingredients and steps, cooking mode (bigger text, screen stays on), share, backup and restore.
- Works offline after the first visit. Recipes are stored on the device (IndexedDB).

## Run it

Needs Node.js 18 or newer.

```bash
npm install
npm start          # http://localhost:3000
npm test           # parser tests
```

To use it on your phone, deploy it to any Node host (Render, Railway, Fly.io, a VPS) so it has an https address, open it in the phone's browser, and choose "Add to Home Screen" / "Install app". Camera capture and installing need https (localhost is fine for testing on a computer).

## How it fits together

- `server.js`: zero-dependency Node server. Serves the app and `/api/import?url=…`, which fetches a recipe page server side (browsers can't because of CORS), handles old Bulgarian `windows-1251` pages, and blocks private network addresses.
- `lib/extract.js`: turns a page into a recipe (JSON-LD → microdata → headings heuristic).
- `public/js/parse-text.js`: turns OCR or pasted text into a recipe (English and Bulgarian section names and units).
- `public/js/app.js`, `db.js`: the app UI and on-device storage.
- Text recognition is [tesseract.js](https://github.com/naptha/tesseract.js), served from `node_modules` (no CDN).
