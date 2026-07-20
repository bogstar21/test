// Platform + API server (Express). Started from bot.js so the Telegram bot and the
// web platform share one process and one Railway service. Decoupled from the bot: it
// receives what it needs via `deps`, so it can be unit-tested without a Telegram token.
const path         = require("path");
const express      = require("express");
const cookieParser = require("cookie-parser");
const helmet       = require("helmet");
const rateLimit    = require("express-rate-limit");
const config       = require("./config");
const logger       = require("./logger");
const { mountAuthRoutes, attachUser } = require("./auth");
const { mountPublicRoutes }   = require("./routes/public");
const { mountPlatformRoutes } = require("./routes/platform");
const { mountPointRoutes }    = require("./routes/points");
const { mountWorkerRoutes }   = require("./routes/workers");
const { mountVisitRoutes }    = require("./routes/visits");
const { mountImportRoutes }   = require("./routes/import");
const { mountConnectRoutes }  = require("./routes/connect");
const { mountCheckinRoutes }  = require("./routes/checkin");
const { mountBillingRoutes }  = require("./routes/billing");
const { mountBotRoutes }      = require("./routes/bot");
const { mountAdminRoutes }    = require("./routes/admin");

function createApp(deps = {}) {
  const app = express();
  app.set("trust proxy", 1);   // Railway terminates TLS in front of us
  app.disable("x-powered-by");

  // CSP off: the platform loads Leaflet from a CDN + inline JS. The rest of helmet's
  // defaults (HSTS, nosniff, frame guard, referrer policy) are kept.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // Body parsing. Small 2 MB JSON for most routes; the import endpoints declare their
  // own 50 MB parser for base64 uploads, so skip the global parser on those paths.
  const smallJson = express.json({ limit: "2mb" });
  // Skip the global JSON parser on: base64 upload endpoints AND the Stripe webhook (which
  // needs the RAW body to verify its signature — see routes/billing.js).
  const RAW_PATHS = /^\/api\/(?:import\/(?:parse|points|workers)|checkin|billing\/webhook)$/;
  app.use((req, res, next) => (RAW_PATHS.test(req.path) ? next() : smallJson(req, res, next)));
  app.use(express.urlencoded({ extended: false })); // login form posts
  app.use(cookieParser());
  app.use(attachUser);

  // CSRF defense + audit for the session-authenticated API. Skips the connector (/api/v1,
  // its own X-API-Key credential, no cookies) and the Stripe webhook (signed separately).
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/v1") || req.path === "/billing/webhook") return next();
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

    // Cross-site POST/PUT/DELETE: browsers always send Origin on these. If present it must
    // match our host; a mismatch is a forged cross-site request → reject.
    const origin = req.get("origin") || req.get("referer") || "";
    if (origin) {
      let host = "";
      try { host = new URL(origin).host; } catch (e) { host = "x"; }
      if (host !== req.get("host")) return res.status(403).json({ error: "bad_origin" });
    }

    // Record the action once the response is known to have succeeded.
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 400 && req.user) {
        require("./audit").log({
          tenantId: req.user.tenantId,
          actor: req.user.email || req.user.role,
          role: req.user.role,
          action: method + " " + String(req.originalUrl || req.url).split("?")[0],
          ip: req.ip,
        });
      }
    });
    next();
  });

  // Rate limiting (trust proxy = 1, so req.ip is the real client).
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many login attempts. Try again later." } });
  const apiLimiter   = rateLimit({ windowMs: 5 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
  // Signup mints a company (trial) — keep it tight so nobody can mass-create tenants.
  const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many signups from this network. Try again later." } });
  app.use("/auth/login", loginLimiter);
  app.use("/auth/signup", signupLimiter);
  app.use("/auth/worker", loginLimiter);
  app.use("/api", apiLimiter);

  // Static assets (CSS/JS/icons) — revalidate each load so a deploy never serves stale.
  app.use("/platform/assets", express.static(path.join(config.PUBLIC_DIR, "platform", "assets"), { maxAge: 0 }));

  // Connector first: it has its OWN credential (X-API-Key). It must be mounted before
  // any router that attaches requireAuth at the "/api" mount point, because router-level
  // middleware runs for every path under its mount — otherwise /api/v1/* would hit a
  // session gate and 401 before ever reaching the API-key check.
  mountConnectRoutes(app);      // /api/v1/* (client-facing connector, X-API-Key)

  mountAuthRoutes(app);         // /auth/login, /auth/logout
  mountPlatformRoutes(app);     // /platform, /platform/login, /api/me, /api/setup
  mountPointRoutes(app);        // /api/points   CRUD
  mountWorkerRoutes(app);       // /api/workers  CRUD
  mountVisitRoutes(app);        // /api/visits, /api/stats
  mountImportRoutes(app);       // /api/import/*
  mountCheckinRoutes(app);      // /api/checkin (worker PWA)
  mountBillingRoutes(app);      // /api/billing/* (Stripe subscription — optional)
  mountBotRoutes(app);          // /api/bot/status, /start, /stop
  // Unlisted operator tool — never linked from the landing/app nav, own password gate
  // (PLATFORM_PASSWORD only, not a company session). Reachable only by typing the URL.
  mountAdminRoutes(app);        // /admin/analytics
  mountPublicRoutes(app, deps); // /health, /

  app.use((_req, res) => res.status(404).type("text/plain").send("Not found"));

  // Catch-all error handler (4-arg signature is how Express recognises it). Anything a
  // route forgot to try/catch lands here instead of crashing the process or leaking a
  // stack trace to the client.
  app.use((err, req, res, _next) => {
    logger.error("unhandled request error", err, { method: req.method, path: req.path });
    if (res.headersSent) return;
    res.status(500).json({ error: "server_error" });
  });

  return app;
}

// Last line of defense: log (and optionally alert) instead of a silent crash / restart
// loop with no trace of what happened. Node still exits after an uncaughtException per
// its own semantics — we just make sure it's logged first.
process.on("uncaughtException", err => { logger.error("uncaughtException", err); });
process.on("unhandledRejection", reason => { logger.error("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason))); });

function startServer(deps = {}) {
  const app = createApp(deps);
  // Load companies from the platform registry (starx_tenants) into the in-memory cache
  // before serving. No-op without a platform DB (memory/sheets keep the env default).
  require("./tenants").reload().catch(e => console.error("tenants.reload:", e && e.message));
  app.listen(config.PORT, () => {
    console.log(`🌐 StarX platform on :${config.PORT}`);
    if (!config.PLATFORM_PASSWORD) console.log("⚠️  PLATFORM_PASSWORD not set — set it in Railway to enable login.");
    if (!process.env.SESSION_SECRET) console.log("⚠️  SESSION_SECRET not set — sessions reset on every restart. Set it in Railway.");

    // Optional: auto-start the bot on boot if a token is in the env. Otherwise the
    // bot is started on demand from the web app's Bot tab (POST /api/bot/start).
    const token = process.env.TELEGRAM_TOKEN || "";
    if (token) {
      require("./bot/manager").start(token)
        .then(s => console.log(`🤖 Bot auto-started from TELEGRAM_TOKEN (@${s.username}).`))
        .catch(e => console.error("Bot auto-start failed:", e && e.message));
    } else {
      console.log("ℹ️  No TELEGRAM_TOKEN — start the bot anytime from the web app (Bot tab).");
    }
  });
  return app;
}

// Allow `npm run server` to boot the platform standalone (no bot).
if (require.main === module) startServer();

module.exports = { createApp, startServer };
