// Password login + a stateless signed-cookie session.
//
// Why a signed cookie: Railway's filesystem is ephemeral, so a server-side session
// store would drop everyone on restart. An HMAC-signed cookie needs no storage.
// The signing key is config.SESSION_SECRET (auto-generated if not set in env).
const crypto = require("crypto");
const config = require("./config");

// ─── Signed session cookie ─────────────────────────────────────────────────────
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac  = crypto.createHmac("sha256", config.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verifySession(token) {
  if (!token || !config.SESSION_SECRET) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", config.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { return null; }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}

function setSessionCookie(res, user) {
  const payload = {
    email:    user.email,
    name:     user.name || "",
    role:     user.role || "admin",
    tenantId: user.tenantId || "",
    company:  user.company || "",
    // Worker sessions (PWA) carry the datasource row + telegramId so a web check-in
    // is attributed to the same worker record the bot links by phone.
    workerRow:  user.workerRow || "",
    telegramId: user.telegramId || "",
    exp:      Date.now() + config.SESSION_TTL_MS,
  };
  res.cookie(config.SESSION_COOKIE, signSession(payload), {
    httpOnly: true,
    // false for local HTTP (the MVP default). Set COOKIE_SECURE=true behind HTTPS.
    secure:   config.COOKIE_SECURE,
    sameSite: "lax",
    maxAge:   config.SESSION_TTL_MS,
  });
}

// ─── Middleware ────────────────────────────────────────────────────────────────
function trustedIpUser() {
  const t = config.defaultTenant() || {};
  return { email: "ip-trusted", name: "Admin (IP)", role: "admin", tenantId: t.id || "", company: t.name || "", viaIp: true };
}

// Only allow internal, single-leading-slash redirect targets (blocks open redirects).
function safeNext(n) {
  n = String(n || "");
  return /^\/(?!\/)/.test(n) ? n : "";
}

// Non-gating: attach req.user from a valid cookie (or trusted IP) if present.
function attachUser(req, res, next) {
  if (!req.user) {
    const user = verifySession(req.cookies && req.cookies[config.SESSION_COOKIE]);
    if (user) {
      req.user = user;
      // Sliding expiration: re-issue past the halfway mark so an active admin stays in.
      if (user.exp && (user.exp - Date.now()) < config.SESSION_TTL_MS / 2) setSessionCookie(res, user);
    } else if (config.isTrustedIp(req)) {
      req.user = trustedIpUser();
    }
  }
  next();
}

function requireAuth(req, res, next) {
  const user = req.user
    || verifySession(req.cookies && req.cookies[config.SESSION_COOKIE])
    || (config.isTrustedIp(req) ? trustedIpUser() : null);
  if (!user) {
    const target = req.originalUrl || req.path;
    if (target.startsWith("/api/")) return res.status(401).json({ error: "unauthorized" });
    return res.redirect("/platform/login?next=" + encodeURIComponent(target));
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

// Block writes when the company's subscription is not live (past_due / canceled). Reads
// still work — data is never destroyed, just frozen until they pay. 402 = Payment Required.
function requireActiveSubscription(req, res, next) {
  const tenant = config.getTenant(req);
  if (config.tenants.canWrite(tenant)) return next();
  return res.status(402).json({
    error: "subscription_inactive",
    detail: "Tu suscripción no está activa. Reactívala para volver a registrar datos (tus datos siguen intactos).",
  });
}

// Enforce a plan's row limits before adding rows. `kind` is "workers" or "points"; `adding`
// is how many new rows. Reads current count via the tenant datasource. Returns an error
// string if the limit would be exceeded, else null.
async function quotaError(req, kind, adding) {
  const tenant = config.getTenant(req);
  const limits = config.tenants.planLimits(tenant.plan);
  const max = kind === "points" ? limits.maxPoints : limits.maxWorkers;
  if (!isFinite(max)) return null;
  try {
    const source = require("./datasource").forTenant(tenant);
    const current = (kind === "points" ? await source.listPoints() : await source.listWorkers()).length;
    if (current + (adding || 1) > max) {
      return `Tu plan (${limits.label}) permite hasta ${max} ${kind === "points" ? "puntos" : "trabajadores"}. Mejora el plan para añadir más.`;
    }
  } catch (e) { /* if we can't count, don't block */ }
  return null;
}

// ─── API-key gate (for the client-facing connector at /api/v1) ───────────────────
// Separate credential from the platform login. Each company manages its OWN connector
// key entirely from the platform UI (self-service — no backend access needed); the key
// is stored per-tenant as the `connector_api_key` setting. The presented key identifies
// which company the request belongs to, and the connector then acts on that company's
// data. INTEGRATION_API_KEY, if set, is an optional legacy key for the default tenant.
// The key is read from the `X-API-Key` header, or `?key=` for quick manual tests.
const CONNECTOR_KEY_SETTING = "connector_api_key";
function generateApiKey() { return "sk_" + crypto.randomBytes(24).toString("hex"); }

// A tenant's stored connector key ("" if none / datasource unavailable).
async function tenantConnectorKey(tenant) {
  try {
    const source = require("./datasource").forTenant(tenant);
    return String((await source.getSetting(CONNECTOR_KEY_SETTING, "")) || "");
  } catch { return ""; }
}

// Resolve which tenant a presented key belongs to (null if it matches none). This is
// what makes each company's key scope the connector to that company's own data.
async function resolveApiKeyTenant(sent) {
  if (!sent) return null;
  const envKey = process.env.INTEGRATION_API_KEY || "";
  if (envKey && safeEqual(sent, envKey)) return config.defaultTenant();
  for (const t of config.allTenants()) {
    const k = await tenantConnectorKey(t);
    if (k && safeEqual(sent, k)) return t;
  }
  return null;
}

async function requireApiKey(req, res, next) {
  try {
    const sent = req.get("x-api-key") || req.query.key || "";
    if (!sent) return res.status(401).json({ error: "bad_api_key", detail: "Missing X-API-Key header." });
    const tenant = await resolveApiKeyTenant(sent);
    if (!tenant) return res.status(401).json({ error: "bad_api_key" });
    // The key identifies the company → the connector acts on that tenant's data.
    req.user = req.user || { role: "api", tenantId: tenant.id, company: tenant.name, viaApi: true };
    next();
  } catch (e) {
    console.error("requireApiKey error:", e && e.message);
    res.status(500).json({ error: "server_error" });
  }
}

// ─── Password login (per-tenant) ───────────────────────────────────────────────
function passwordConfigured() { return config.allTenants().some(t => t.password || t.passwordHash); }

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Resolve the company to log into. With a company code we check ONLY that tenant's
// password. Without a code we check ONLY the env/default tenant (single-company,
// self-hosted). We must NOT scan every tenant by password: two companies could share a
// password and a user would land in the wrong account (cross-tenant login).
function matchTenant(code, pw) {
  if (!pw) return null;
  code = String(code || "").trim().toLowerCase();
  if (code) {
    const t = config.tenants.byCode(code);
    return (t && config.tenants.verifyPassword(t, pw)) ? t : null;
  }
  const d = config.defaultTenant();
  return (d && config.tenants.verifyPassword(d, pw)) ? d : null;
}

function mountAuthRoutes(app) {
  app.post("/auth/login", (req, res) => {
    if (!passwordConfigured()) return res.status(503).type("html").send(notConfiguredPage());
    const pw     = (req.body && req.body.password) || "";
    const code   = (req.body && req.body.code) || "";
    const tenant = matchTenant(code, pw);
    const next_  = safeNext(req.query.next || (req.body && req.body.next));
    if (!tenant) return res.redirect("/platform/login?e=1" + (next_ ? "&next=" + encodeURIComponent(next_) : ""));
    setSessionCookie(res, {
      email: "admin", name: "Admin",
      role: "admin", tenantId: tenant.id, company: tenant.name,
    });
    res.redirect(next_ || "/platform");
  });

  // Worker login for the PWA: phone-only (workers have no password — they're identified
  // by the phone their manager preloaded, same key the bot links by). Gated by the
  // tenant's `pwa_enabled` setting so a company can turn the PWA on/off from the UI.
  app.post("/auth/worker", async (req, res) => {
    const phone = (req.body && req.body.phone) || "";
    const code  = (req.body && req.body.code)  || "";
    if (!phone) return res.status(400).json({ error: "no_phone" });
    try {
      const { forTenant } = require("./datasource");
      // Resolve the worker's company: by explicit company code if given, else search every
      // company's roster by phone (managers preload the phone in their own tenant).
      let tenant = null, worker = null;
      if (code) {
        tenant = config.tenants.byCode(code);
        if (!tenant) return res.status(404).json({ error: "no_company", detail: "Código de empresa no encontrado." });
        worker = await forTenant(tenant).findWorkerByPhone(phone);
      } else {
        for (const t of config.allTenants()) {
          try {
            const w = await forTenant(t).findWorkerByPhone(phone);
            if (w) { tenant = t; worker = w; break; }
          } catch (e) { /* skip */ }
        }
      }
      if (!tenant || !worker || !worker.active) {
        return res.status(401).json({ error: "not_found", detail: "Teléfono no encontrado. Pide a tu responsable que te dé de alta (o usa el código de tu empresa)." });
      }
      const enabled = String(await forTenant(tenant).getSetting("pwa_enabled", "0")) === "1";
      if (!enabled) return res.status(403).json({ error: "pwa_disabled", detail: "La app de check-in está apagada. Pide a tu responsable que la active." });

      setSessionCookie(res, {
        email: "worker", name: worker.name || "Worker", role: "worker",
        tenantId: tenant.id, company: tenant.name,
        workerRow: worker.row, telegramId: worker.telegramId,
      });
      res.json({ ok: true, name: worker.name || "Worker", company: tenant.name });
    } catch (e) {
      console.error("/auth/worker error:", e && e.message);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Self-service company signup: create a tenant on a 14-day trial and log the owner in.
  // Requires an email (account recovery + contact — see /auth/forgot) and explicit
  // acceptance of the Terms/Privacy Policy before any data is collected.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  app.post("/auth/signup", async (req, res) => {
    const name = String((req.body && req.body.company) || "").trim();
    const password = String((req.body && req.body.password) || "");
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    const acceptedTerms = !!(req.body && req.body.acceptedTerms);
    if (!name || password.length < 6) {
      return res.status(400).json({ error: "bad_input", detail: "Indica el nombre de la empresa y una contraseña de al menos 6 caracteres." });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "bad_email", detail: "Indica un correo electrónico válido — lo necesitas para recuperar tu cuenta." });
    }
    if (!acceptedTerms) {
      return res.status(400).json({ error: "terms_required", detail: "Debes aceptar los Términos de Servicio y la Política de Privacidad." });
    }
    if (config.tenants.byEmail(email)) {
      return res.status(409).json({ error: "email_taken", detail: "Ya existe una empresa registrada con ese correo." });
    }
    try {
      const tenant = await config.tenants.create({ name, password, email, plan: "trial", trialDays: 14 });
      setSessionCookie(res, { email: "admin", name: "Admin", role: "admin", tenantId: tenant.id, company: tenant.name });
      require("./email").sendWelcome(email, tenant.name, tenant.code).catch(e => console.error("welcome email:", e && e.message));
      res.json({ ok: true, code: tenant.code, company: tenant.name });
    } catch (e) {
      console.error("/auth/signup error:", e && e.message);
      res.status(500).json({ error: "server_error", detail: e && e.message });
    }
  });

  // Forgot password: email a one-time reset link. Always responds the same way whether
  // or not the email matches an account, so this can't be used to enumerate customers.
  app.post("/auth/forgot", async (req, res) => {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    const generic = { ok: true, detail: "Si ese correo existe en nuestro sistema, te hemos enviado un enlace para restablecer la contraseña." };
    if (!email || !EMAIL_RE.test(email)) return res.json(generic);
    try {
      const tenant = config.tenants.byEmail(email);
      if (tenant && !tenant.isDefault) {
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
        await config.tenants.update(tenant.id, { resetTokenHash: tokenHash, resetTokenExpires: expires });
        const base = (config.PLATFORM_URL || (req.protocol + "://" + req.get("host"))).replace(/\/+$/, "");
        const resetUrl = `${base}/platform/reset?token=${token}`;
        require("./email").sendPasswordReset(email, resetUrl).catch(e => console.error("reset email:", e && e.message));
      }
      res.json(generic);
    } catch (e) {
      console.error("/auth/forgot error:", e && e.message);
      res.json(generic); // never leak server errors here either
    }
  });

  // Complete a password reset: the raw token from the emailed link must hash-match a
  // tenant's stored (unexpired) reset_token_hash. Single-use — cleared on success.
  app.post("/auth/reset", async (req, res) => {
    const token = String((req.body && req.body.token) || "");
    const password = String((req.body && req.body.password) || "");
    if (!token) return res.status(400).json({ error: "no_token" });
    if (password.length < 6) return res.status(400).json({ error: "weak_password", detail: "La nueva contraseña debe tener al menos 6 caracteres." });
    try {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const tenant = config.allTenants().find(t => t.resetTokenHash && safeEqual(t.resetTokenHash, tokenHash));
      if (!tenant || !tenant.resetTokenExpires || Date.now() > Date.parse(tenant.resetTokenExpires)) {
        return res.status(400).json({ error: "invalid_or_expired", detail: "El enlace no es válido o ha caducado. Pide uno nuevo." });
      }
      await config.tenants.update(tenant.id, { passwordHash: config.tenants.hashPassword(password), resetTokenHash: "", resetTokenExpires: null });
      res.json({ ok: true });
    } catch (e) {
      console.error("/auth/reset error:", e && e.message);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/auth/logout", (req, res) => {
    res.clearCookie(config.SESSION_COOKIE);
    res.redirect("/platform/login");
  });
}

// ─── Tiny inline "not configured" page (no external assets) ─────────────────────
function notConfiguredPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>StarX — setup</title>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#000;color:#ededed}' +
    '.box{max-width:440px;padding:32px;background:#0a0a0a;border:1px solid rgba(255,255,255,.1);border-radius:14px;text-align:center}' +
    'code{background:#161616;padding:2px 6px;border-radius:5px}</style></head><body><div class="box">' +
    '<h2>Login not configured yet</h2>' +
    '<p>Set the <code>PLATFORM_PASSWORD</code> environment variable in Railway, then redeploy.</p>' +
    '</div></body></html>';
}

module.exports = { mountAuthRoutes, attachUser, requireAuth, requireRole, requireApiKey, requireActiveSubscription, quotaError, setSessionCookie, verifySession, generateApiKey, CONNECTOR_KEY_SETTING };
