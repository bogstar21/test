// /admin/analytics — platform-wide analytics across EVERY company (not a single tenant's
// dashboard). Deliberately separate from the multi-tenant session system: it has its own
// signed cookie, its own password check (PLATFORM_PASSWORD only — never a company's
// password), and is never linked from the landing page or the app nav. Reachable only by
// typing the URL directly. If PLATFORM_PASSWORD isn't set, the whole thing is disabled.
const path    = require("path");
const crypto  = require("crypto");
const config  = require("../config");
const { forTenant } = require("../datasource");

const COOKIE = "starx_superadmin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — this is an operator tool, not a user session

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", config.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", config.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}
function requireSuperAdmin(req, res, next) {
  const ok = verify(req.cookies && req.cookies[COOKIE]);
  if (!ok) return res.status(401).json({ error: "unauthorized" });
  next();
}

function mountAdminRoutes(app) {
  // Never index this in search engines; it's unlisted, not secret-by-obscurity alone.
  app.use("/admin/analytics", (_req, res, next) => { res.set("X-Robots-Tag", "noindex, nofollow"); next(); });

  // The shell HTML is public (it renders no data — just a password prompt or, once the
  // signed cookie is present, calls the gated JSON endpoint below).
  app.get("/admin/analytics", (_req, res) =>
    res.sendFile(path.join(config.PUBLIC_DIR, "admin", "analytics.html")));

  // The global JSON body parser (mounted in index.js) already covers this path — it's
  // not one of the RAW_PATHS exclusions — so req.body is parsed by the time we get here.
  app.post("/admin/analytics/login", (req, res) => {
    if (!config.PLATFORM_PASSWORD) return res.status(503).json({ error: "not_configured", detail: "PLATFORM_PASSWORD is not set on the server." });
    const pw = String((req.body && req.body.password) || "");
    if (!pw || !safeEqual(pw, config.PLATFORM_PASSWORD)) return res.status(401).json({ error: "bad_password" });
    res.cookie(COOKIE, sign({ ok: true, exp: Date.now() + TTL_MS }), {
      httpOnly: true, secure: config.COOKIE_SECURE, sameSite: "lax", maxAge: TTL_MS,
    });
    res.json({ ok: true });
  });

  app.post("/admin/analytics/logout", (_req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

  // Platform-wide numbers: every company's worker/point/visit counts, rolled up. Best
  // effort per tenant — one company's datasource hiccup doesn't blow up the whole page.
  app.get("/admin/analytics/data", requireSuperAdmin, async (_req, res) => {
    try {
      const tenants = config.allTenants();
      const rows = await Promise.all(tenants.map(async t => {
        try {
          const source = forTenant(t);
          const [workers, points, visits] = await Promise.all([
            source.listWorkers(), source.listPoints(), source.listVisits({ limit: 100000 }),
          ]);
          const today = new Date().toISOString().slice(0, 10);
          return {
            id: t.id, name: t.name, code: t.code, plan: t.plan,
            status: t.subscriptionStatus, isDefault: !!t.isDefault,
            createdAt: t.createdAt || null,
            workers: workers.length, workersActive: workers.filter(w => w.active).length,
            points: points.length, pointsActive: points.filter(p => p.active).length,
            visits: visits.length,
            visitsToday: visits.filter(v => String(v.timestamp || "").slice(0, 10) === today).length,
          };
        } catch (e) {
          return { id: t.id, name: t.name, error: e && e.message };
        }
      }));

      const totals = rows.reduce((acc, r) => ({
        companies: acc.companies + 1,
        workers: acc.workers + (r.workers || 0),
        points: acc.points + (r.points || 0),
        visits: acc.visits + (r.visits || 0),
        visitsToday: acc.visitsToday + (r.visitsToday || 0),
      }), { companies: 0, workers: 0, points: 0, visits: 0, visitsToday: 0 });

      const byStatus = {};
      rows.forEach(r => { const s = r.status || "unknown"; byStatus[s] = (byStatus[s] || 0) + 1; });

      res.json({ generatedAt: new Date().toISOString(), totals, byStatus, companies: rows });
    } catch (e) {
      console.error("/admin/analytics/data error:", e && e.message);
      res.status(500).json({ error: "server_error" });
    }
  });
}

module.exports = { mountAdminRoutes };
