// Transactional email — zero-dependency (talks to the Resend REST API with fetch, no SDK).
// Entirely OPTIONAL: without RESEND_API_KEY the module logs the email to the console
// instead of sending it, so password reset / welcome emails still "work" in dev.
//
// Env:
//   RESEND_API_KEY   re_…              (https://resend.com/api-keys)
//   EMAIL_FROM       "StarX <noreply@yourdomain.com>"  (must be a verified Resend domain)
function enabled() { return !!process.env.RESEND_API_KEY; }

async function send({ to, subject, html, text }) {
  if (!to || !subject) throw new Error("email_missing_fields");
  if (!enabled()) {
    // Dev fallback: no provider configured — log instead of failing the request that
    // triggered the email (signup, forgot-password), so those flows still work locally.
    console.log(`✉️  [email disabled] To: ${to}\nSubject: ${subject}\n${text || html}`);
    return { ok: true, dev: true };
  }
  const from = process.env.EMAIL_FROM || "StarX <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html: html || text, text: text || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.message) || ("resend_http_" + res.status));
  return { ok: true, id: data.id };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Templates (plain, minimal — no external assets, kept short) ────────────────────
async function sendWelcome(toEmail, companyName, code) {
  const subject = "Bienvenido a StarX";
  const html = `<p>Hola,</p><p>Tu empresa <b>${escapeHtml(companyName)}</b> ya está creada en StarX.</p>` +
    `<p>Tu código de empresa (lo necesitas para iniciar sesión): <b>${escapeHtml(code)}</b></p>` +
    `<p>Guárdalo en un lugar seguro.</p>`;
  return send({ to: toEmail, subject, html, text: `Tu empresa ${companyName} está creada. Código: ${code}` });
}

async function sendPasswordReset(toEmail, resetUrl) {
  const subject = "Restablecer tu contraseña de StarX";
  const html = `<p>Hemos recibido una solicitud para restablecer tu contraseña.</p>` +
    `<p><a href="${resetUrl}">Restablecer contraseña</a> (el enlace caduca en 1 hora)</p>` +
    `<p>Si no lo has pedido tú, ignora este correo.</p>`;
  return send({ to: toEmail, subject, html, text: `Restablece tu contraseña: ${resetUrl} (caduca en 1 hora)` });
}

module.exports = { enabled, send, sendWelcome, sendPasswordReset };
