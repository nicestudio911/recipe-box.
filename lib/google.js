// "Sign in with Google" (OAuth 2.0 / OpenID Connect, authorization code flow).
// Turns on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (see DEPLOY.md, "Sign in with Google").
import { randomBytes } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function createGoogleAuth(env = process.env, { fetchFn = fetch } = {}) {
  const clientId = env.GOOGLE_CLIENT_ID, clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return {
    // Where to send the browser, plus the random state we must get back
    start(redirectUri) {
      const state = randomBytes(18).toString('base64url');
      const url = `${AUTH_URL}?${new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: 'openid email profile', state, prompt: 'select_account',
      })}`;
      return { url, state };
    },

    // Swap the code for the person's Google identity
    async finish(code, redirectUri) {
      const res = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id_token) throw new Error(`Google answered ${res.status}: ${data.error || 'no id_token'}`);
      // The token comes straight from Google over HTTPS, so its claims can be read without
      // checking the signature (Google's OpenID Connect docs, "Obtain user information from the ID token").
      const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8'));
      if (claims.aud !== clientId) throw new Error('Google token is for another app');
      if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Google token has the wrong issuer');
      if (claims.exp * 1000 < Date.now()) throw new Error('Google token expired');
      if (!claims.email || claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Google account email is not verified');
      return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: String(claims.name || '').slice(0, 80) };
    },
  };
}
