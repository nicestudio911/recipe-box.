// Accounts, sessions and recipes in SQLite (built into Node 22+, no extra packages).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 60;
const sha256 = s => createHash('sha256').update(s).digest('hex');

export function openStore(dataDir) {
  let file = ':memory:';
  if (dataDir !== ':memory:') { mkdirSync(dataDir, { recursive: true }); file = join(dataDir, 'recipes.db'); }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, id));
    CREATE INDEX IF NOT EXISTS recipes_by_user ON recipes(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, expires_at INTEGER NOT NULL);
  `);
  // Added in v0.3: existing databases get the column on start
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'email_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  }

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, name, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    setVerified: db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    insertEmailToken: db.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)'),
    deleteEmailTokens: db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?'),
    emailToken: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?'),
    purgeEmailTokens: db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?'),
    sessionUser: db.prepare(`SELECT u.id, u.email, u.name, u.email_verified FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    listRecipes: db.prepare('SELECT data FROM recipes WHERE user_id = ? ORDER BY updated_at DESC'),
    getRecipe: db.prepare('SELECT data FROM recipes WHERE user_id = ? AND id = ?'),
    upsertRecipe: db.prepare(`INSERT INTO recipes (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
                              ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
    deleteRecipe: db.prepare('DELETE FROM recipes WHERE user_id = ? AND id = ?'),
    countRecipes: db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?'),
  };

  async function hashPassword(pw) {
    const salt = randomBytes(16);
    const key = await scryptAsync(pw, salt, 64);
    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
  }
  async function checkPassword(pw, stored) {
    const [, salt, key] = stored.split('$');
    const want = Buffer.from(key, 'base64');
    const got = await scryptAsync(pw, Buffer.from(salt, 'base64'), want.length);
    return timingSafeEqual(want, got);
  }

  function newSession(userId) {
    const token = randomBytes(32).toString('base64url');
    q.insertSession.run(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
    return token;
  }

  const publicUser = u => (u ? { id: u.id, email: u.email, name: u.name, emailVerified: !!u.email_verified } : null);
  const fail = (msg, status) => Object.assign(new Error(msg), { status });
  const TOKEN_TTL = { verify: 7 * 864e5, reset: 3600e3 };

  return {
    sessionMaxAge: SESSION_DAYS * 86400,

    async signUp({ email, password, name = '' }) {
      email = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw Object.assign(new Error('Please enter a valid email address'), { status: 400 });
      if (String(password || '').length < 8) throw Object.assign(new Error('The password needs at least 8 characters'), { status: 400 });
      if (q.userByEmail.get(email)) throw Object.assign(new Error('An account with this email already exists. Try logging in.'), { status: 409 });
      const id = randomUUID();
      q.insertUser.run(id, email, String(name).trim().slice(0, 80), await hashPassword(String(password)), Date.now());
      return { user: publicUser(q.userById.get(id)), token: newSession(id) };
    },

    async logIn({ email, password }) {
      const u = q.userByEmail.get(String(email || '').trim().toLowerCase());
      // Same answer whether the email exists or not
      const ok = u ? await checkPassword(String(password || ''), u.pass_hash) : (await hashPassword('x'), false);
      if (!ok) throw Object.assign(new Error('Wrong email or password'), { status: 401 });
      return { user: publicUser(u), token: newSession(u.id) };
    },

    userForToken(token) {
      if (!token) return null;
      return publicUser(q.sessionUser.get(sha256(token), Date.now()));
    },

    async changePassword(userId, currentToken, { current, password }) {
      const u = q.userById.get(userId);
      if (!u || !(await checkPassword(String(current || ''), u.pass_hash))) throw fail('Your current password is not right', 401);
      if (String(password || '').length < 8) throw fail('The new password needs at least 8 characters', 400);
      q.setPassword.run(await hashPassword(String(password)), userId);
      q.deleteOtherSessions.run(userId, sha256(currentToken)); // log out other devices
    },

    // One-time links sent by email. Returns the raw token (only its hash is stored).
    createEmailToken(userId, purpose) {
      q.deleteEmailTokens.run(userId, purpose);
      const token = randomBytes(32).toString('base64url');
      q.insertEmailToken.run(sha256(token), userId, purpose, Date.now() + TOKEN_TTL[purpose]);
      return token;
    },
    userByEmail: email => publicUser(q.userByEmail.get(String(email || '').trim().toLowerCase())),

    verifyEmail(token) {
      const t = q.emailToken.get(sha256(String(token || '')), 'verify', Date.now());
      if (!t) throw fail('This link has expired or was already used. Send a new one from the app settings.', 400);
      q.setVerified.run(t.user_id);
      q.deleteEmailTokens.run(t.user_id, 'verify');
      return publicUser(q.userById.get(t.user_id));
    },

    async resetPassword(token, password) {
      const t = q.emailToken.get(sha256(String(token || '')), 'reset', Date.now());
      if (!t) throw fail('This reset link has expired or was already used. Ask for a new one.', 400);
      if (String(password || '').length < 8) throw fail('The password needs at least 8 characters', 400);
      q.setPassword.run(await hashPassword(String(password)), t.user_id);
      q.setVerified.run(t.user_id); // they proved they own the email
      q.deleteEmailTokens.run(t.user_id, 'reset');
      q.deleteUserSessions.run(t.user_id); // log out everywhere
      return { user: publicUser(q.userById.get(t.user_id)), token: newSession(t.user_id) };
    },
    logOut(token) { if (token) q.deleteSession.run(sha256(token)); },
    accountInfo(userId) {
      const u = q.userById.get(userId);
      return u ? { email: u.email, name: u.name, emailVerified: !!u.email_verified, createdAt: u.created_at } : null;
    },
    deleteAccount(userId) { q.deleteUser.run(userId); },
    purge() { q.purgeSessions.run(Date.now()); q.purgeEmailTokens.run(Date.now()); },

    listRecipes: userId => q.listRecipes.all(userId).map(r => JSON.parse(r.data)),
    getRecipe: (userId, id) => { const r = q.getRecipe.get(userId, id); return r ? JSON.parse(r.data) : null; },
    countRecipes: userId => q.countRecipes.get(userId).n,
    saveRecipe(userId, recipe) {
      const now = Date.now();
      const existing = this.getRecipe(userId, recipe.id);
      const rec = { ...recipe, createdAt: existing?.createdAt || recipe.createdAt || now, updatedAt: now };
      q.upsertRecipe.run(rec.id, userId, JSON.stringify(rec), rec.createdAt, now);
      return rec;
    },
    deleteRecipe: (userId, id) => q.deleteRecipe.run(userId, id).changes > 0,
    close: () => db.close(),
  };
}

// Keep only the fields the app uses, with sane sizes
export function cleanRecipe(input, id) {
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = v => (Number.isFinite(+v) && +v > 0 && v !== null && v !== '' ? Math.min(Math.round(+v), 100000) : null);
  const list = (v, maxItems, maxLen) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, maxItems).map(x => x.slice(0, maxLen)) : []);
  const image = str(input.image, 3_000_000);
  return {
    id,
    title: str(input.title, 200).trim() || 'Untitled recipe',
    description: str(input.description, 2000),
    image: /^(data:image\/(jpeg|png|webp);base64,|https?:\/\/)/.test(image) ? image : '',
    servings: str(input.servings, 50),
    prepTime: num(input.prepTime), cookTime: num(input.cookTime), totalTime: num(input.totalTime),
    ingredients: list(input.ingredients, 300, 500),
    steps: list(input.steps, 300, 4000),
    tags: list(input.tags, 30, 40),
    notes: str(input.notes, 10000),
    sourceUrl: /^https?:\/\//.test(input.sourceUrl || '') ? str(input.sourceUrl, 2000) : '',
    favorite: !!input.favorite,
    createdAt: num(input.createdAt) || undefined,
  };
}
