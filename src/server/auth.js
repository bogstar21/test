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
    exp:      Date.now() + config.SESSION_TTL_MS,
  };
  res.cookie(config.SESSION_COOKIE, signSession(payload), {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    maxAge:   config.SESSION_TTL_MS,
  });
}

// ─── Middleware ────────────────────────────────────────────────────────────────
function trustedIpUser() {
  const t = config.TENANTS[0] || {};
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

// ─── Password login (per-tenant) ───────────────────────────────────────────────
function passwordConfigured() { return config.TENANTS.some(t => t.password); }

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function matchTenant(pw) {
  if (!pw) return null;
  for (const t of config.TENANTS) {
    if (t.password && safeEqual(pw, t.password)) return t;
  }
  return null;
}

function mountAuthRoutes(app) {
  app.post("/auth/login", (req, res) => {
    if (!passwordConfigured()) return res.status(503).type("html").send(notConfiguredPage());
    const pw     = (req.body && req.body.password) || "";
    const tenant = matchTenant(pw);
    const next_  = safeNext(req.query.next || (req.body && req.body.next));
    if (!tenant) return res.redirect("/platform/login?e=1" + (next_ ? "&next=" + encodeURIComponent(next_) : ""));
    setSessionCookie(res, {
      email: "admin", name: "Admin",
      role: "admin", tenantId: tenant.id, company: tenant.name,
    });
    res.redirect(next_ || "/platform");
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

module.exports = { mountAuthRoutes, attachUser, requireAuth, requireRole, setSessionCookie, verifySession };
