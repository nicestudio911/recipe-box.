// Error alerts: when something breaks on the server or in someone's browser, email the owner.
// Turns on when email is set up (see mail.js) and ALERT_EMAIL is set, e.g. ALERT_EMAIL=you@example.com.
// Errors are always written to the server log (`fly logs`) either way.
// To avoid flooding your inbox: the same error is emailed at most once per hour, and at most 20 emails a day.

export function createAlerts({ mailer, to = process.env.ALERT_EMAIL, appUrl = process.env.APP_URL || '', now = Date.now } = {}) {
  const enabled = !!(mailer?.enabled && to);
  const lastSent = new Map(); // error signature -> time
  const skipped = new Map(); // error signature -> how many were not emailed
  let day = '', sentToday = 0;

  async function report(kind, err, context = {}) {
    const message = String(err?.message || err || 'Unknown error').slice(0, 500);
    const stack = String(err?.stack || '').split('\n').slice(0, 12).join('\n');
    console.error(`[${kind}] ${message}`, Object.keys(context).length ? JSON.stringify(context).slice(0, 500) : '', stack ? `\n${stack}` : '');
    if (!enabled) return false;

    const t = now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== day) { day = today; sentToday = 0; }
    const sig = `${kind}|${message.replace(/\d+/g, '#').slice(0, 160)}`;
    if (t - (lastSent.get(sig) || 0) < 3600_000 || sentToday >= 20) { skipped.set(sig, (skipped.get(sig) || 0) + 1); return false; }
    const suppressed = skipped.get(sig) || 0; skipped.delete(sig);
    lastSent.set(sig, t); sentToday++;
    if (lastSent.size > 500) { lastSent.clear(); skipped.clear(); }

    const lines = [
      `Kind: ${kind}`, `Time: ${new Date(t).toISOString()}`, `Message: ${message}`,
      ...Object.entries(context).map(([k, v]) => `${k}: ${String(v).slice(0, 300)}`),
      suppressed ? `(${suppressed} similar alerts were skipped to avoid flooding your inbox)` : '',
      stack ? `\n${stack}` : '', '', appUrl ? `App: ${appUrl}` : '', 'Full logs: run "fly logs" or open the Fly.io dashboard.',
    ].filter(l => l !== '');
    const text = lines.join('\n');
    try {
      await mailer.send({ to, subject: `⚠️ Recipe Box: ${kind} error: ${message.slice(0, 80)}`, text, html: `<pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>` });
      return true;
    } catch (e) {
      console.error('Could not send the alert email:', e.message);
      return false;
    }
  }
  return { enabled, report };
}
