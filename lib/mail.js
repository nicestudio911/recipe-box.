// Sends account emails (verification, password reset) through an email API.
// Set ONE of these on the server:
//   BREVO_API_KEY   - https://www.brevo.com (free plan: 300 emails/day, no own domain needed)
//   RESEND_API_KEY  - https://resend.com    (free plan: 3,000 emails/month, needs your own domain)
// and MAIL_FROM, e.g. "Recipe Box <you@example.com>" (an address the provider has verified).
// With neither key set, email features are switched off and the app hides them.

function parseFrom(from) {
  const m = String(from || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'Recipe Box', email: m[2] } : { name: 'Recipe Box', email: String(from || '').trim() };
}

export function createMailer(env = process.env) {
  const from = parseFrom(env.MAIL_FROM);
  if (env.BREVO_API_KEY && from.email) {
    return {
      enabled: true,
      async send({ to, subject, text, html }) {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender: from, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Brevo answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      },
    };
  }
  if (env.RESEND_API_KEY && from.email) {
    return {
      enabled: true,
      async send({ to, subject, text, html }) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, text, html }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      },
    };
  }
  return { enabled: false, async send() { throw new Error('Email is not set up'); } };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout(title, intro, button, link, outro) {
  const html = `<!doctype html><html><body style="margin:0;background:#fbf7f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#2a211c">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:700;margin-bottom:24px">🍲 Recipe Box</div>
    <h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>
    <p style="line-height:1.5">${intro}</p>
    <p style="margin:28px 0"><a href="${esc(link)}" style="background:#c2532d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${esc(button)}</a></p>
    <p style="font-size:13px;color:#7a6d64;line-height:1.5">${outro}<br><br>${esc(link)}</p>
  </div></body></html>`;
  return html;
}

export function verificationEmail(link) {
  return {
    subject: 'Confirm your email for Recipe Box / Потвърдете имейла си',
    text: `Welcome to Recipe Box! Confirm your email address by opening this link:\n${link}\n\nДобре дошли в Recipe Box! Потвърдете имейла си чрез връзката по-горе.\n\nIf you didn't create an account, you can ignore this email.`,
    html: layout('Confirm your email', 'Welcome to Recipe Box! Tap the button to confirm this is your email address.<br><br>Добре дошли! Натиснете бутона, за да потвърдите имейла си.',
      'Confirm email / Потвърди', link, "If you didn't create an account, you can ignore this email. The link works for 7 days."),
  };
}

export function resetEmail(link) {
  return {
    subject: 'Reset your Recipe Box password / Нова парола',
    text: `Someone asked to reset the password for your Recipe Box account. Choose a new password here (the link works for 1 hour):\n${link}\n\nПолучихме заявка за нова парола. Изберете нова парола чрез връзката по-горе (валидна 1 час).\n\nIf this wasn't you, ignore this email. Your password stays the same.`,
    html: layout('Reset your password', 'Someone asked to reset the password for your Recipe Box account. Tap the button to choose a new one.<br><br>Получихме заявка за нова парола. Натиснете бутона, за да изберете нова.',
      'Choose a new password / Нова парола', link, "The link works for 1 hour. If this wasn't you, ignore this email and your password stays the same."),
  };
}
