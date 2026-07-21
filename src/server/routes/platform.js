// Platform shell + small session/setup endpoints.
//   GET  /platform        → the SPA (gated)
//   GET  /platform/login  → login page (public)
//   GET  /api/me          → who am I / which company (gated)
//   POST /api/setup       → create missing tabs in the tenant's sheet (admin)
const path    = require("path");
const express = require("express");
const config  = require("../config");
const { requireAuth, requireRole, generateApiKey, CONNECTOR_KEY_SETTING } = require("../auth");
const { forTenant } = require("../datasource");

function mountPlatformRoutes(app) {
  app.get("/platform/login", (_req, res) =>
    res.sendFile(path.join(config.PUBLIC_DIR, "platform", "login.html")));

  app.get("/platform/signup", (_req, res) =>
    res.sendFile(path.join(config.PUBLIC_DIR, "platform", "signup.html")));

  app.get("/platform/reset", (_req, res) =>
    res.sendFile(path.join(config.PUBLIC_DIR, "platform", "reset.html")));

  app.get("/platform", requireAuth, (_req, res) =>
    res.sendFile(path.join(config.PUBLIC_DIR, "platform", "index.html")));

  const r = express.Router();
  r.use(requireAuth);

  r.get("/me", (req, res) => {
    const t = config.getTenant(req);
    res.json({
      name: req.user.name, company: req.user.company,
      tenantId: req.user.tenantId, role: req.user.role,
      code: t && t.code || "",
      // The env-configured "default" tenant's password lives in PLATFORM_PASSWORD, not the
      // DB — the Settings UI uses this to hide/lock the change-password form for it.
      isDefaultTenant: !!(t && t.isDefault),
    });
  });

  // A tenant always has a usable connector key. Auto-provision one for an admin the first
  // time they look, so the connector is self-service with zero backend access. Returns "".
  async function ensureConnectorKey(source, isAdmin) {
    let key = String((await source.getSetting(CONNECTOR_KEY_SETTING, "")) || "");
    if (!key && isAdmin) { key = generateApiKey(); await source.setSetting(CONNECTOR_KEY_SETTING, key); }
    return key;
  }

  // Platform settings for the manager UI. pwaEnabled is a per-tenant setting. Each company
  // has its own connector key (auto-created on first view); it's echoed back ONLY to an
  // admin — their own session — so they can hand it to their integration.
  r.get("/settings", async (req, res) => {
    try {
      const source = forTenant(config.getTenant(req));
      const isAdmin = req.user.role === "admin";
      const pwaEnabled = String(await source.getSetting("pwa_enabled", "0")) === "1";
      const photoRequired = String(await source.getSetting("photo_required", "0")) === "1";
      const onboardingSeen = String(await source.getSetting("onboarding_seen", "0")) === "1";
      const key = await ensureConnectorKey(source, isAdmin);
      res.json({
        pwaEnabled,
        photoRequired,
        onboardingSeen,
        connectorEnabled: !!key || !!(process.env.INTEGRATION_API_KEY || ""),
        connectorKey:     isAdmin ? key : "",
      });
    } catch (e) {
      console.error("/api/settings error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  // Rotate the connector API key. The new key is returned; the previous one stops working
  // immediately, since only the stored value is accepted from then on.
  r.post("/connector/key", requireRole("admin"), async (req, res) => {
    try {
      const source = forTenant(config.getTenant(req));
      const key = generateApiKey();
      await source.setSetting(CONNECTOR_KEY_SETTING, key);
      res.json({ ok: true, connectorKey: key, connectorEnabled: true });
    } catch (e) {
      console.error("/api/connector/key error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  r.post("/settings", requireRole("admin"), async (req, res) => {
    try {
      const source = forTenant(config.getTenant(req));
      if (typeof (req.body && req.body.pwaEnabled) !== "undefined") {
        await source.setSetting("pwa_enabled", req.body.pwaEnabled ? "1" : "0");
      }
      if (typeof (req.body && req.body.photoRequired) !== "undefined") {
        await source.setSetting("photo_required", req.body.photoRequired ? "1" : "0");
      }
      if (typeof (req.body && req.body.onboardingSeen) !== "undefined") {
        await source.setSetting("onboarding_seen", req.body.onboardingSeen ? "1" : "0");
      }
      const pwaEnabled = String(await source.getSetting("pwa_enabled", "0")) === "1";
      const photoRequired = String(await source.getSetting("photo_required", "0")) === "1";
      const onboardingSeen = String(await source.getSetting("onboarding_seen", "0")) === "1";
      const key = String((await source.getSetting(CONNECTOR_KEY_SETTING, "")) || "");
      res.json({ ok: true, pwaEnabled, photoRequired, onboardingSeen, connectorEnabled: !!key || !!(process.env.INTEGRATION_API_KEY || "") });
    } catch (e) {
      console.error("/api/settings error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  // Admin changes their own company's login password. The env-configured "default" tenant
  // has no DB row of its own — its password is PLATFORM_PASSWORD — so it's rejected here
  // with a clear explanation instead of silently doing nothing (reload() would re-derive
  // it from env on the next boot anyway).
  r.post("/account/password", requireRole("admin"), async (req, res) => {
    try {
      const tenant = config.getTenant(req);
      if (tenant.isDefault) {
        return res.status(400).json({ error: "default_tenant", detail: "La contraseña de esta instalación se define con la variable PLATFORM_PASSWORD del servidor." });
      }
      const cur  = String((req.body && req.body.currentPassword) || "");
      const next = String((req.body && req.body.newPassword) || "");
      if (!config.tenants.verifyPassword(tenant, cur)) {
        return res.status(401).json({ error: "bad_password", detail: "La contraseña actual no es correcta." });
      }
      if (next.length < 6) {
        return res.status(400).json({ error: "weak_password", detail: "La nueva contraseña debe tener al menos 6 caracteres." });
      }
      await config.tenants.update(tenant.id, { passwordHash: config.tenants.hashPassword(next) });
      res.json({ ok: true });
    } catch (e) {
      console.error("/api/account/password error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  // Full data export: every point, worker, and visit the company owns, as one JSON file.
  // Lets a company leave (or just back up) without being held hostage to the platform —
  // same data an admin can already see in the UI, just all of it in one download.
  r.get("/export", requireRole("admin"), async (req, res) => {
    try {
      const tenant = config.getTenant(req);
      const source = forTenant(tenant);
      const [points, workers, visits] = await Promise.all([
        source.listPoints(), source.listWorkers(), source.listVisits({ limit: 100000 }),
      ]);
      const out = { exportedAt: new Date().toISOString(), company: tenant.name, points, workers, visits };
      const filename = `starx-export-${tenant.code || tenant.id}-${new Date().toISOString().slice(0, 10)}.json`;
      res.set("Content-Type", "application/json");
      res.set("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(JSON.stringify(out, null, 2));
    } catch (e) {
      console.error("/api/export error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  // One-click onboarding: make sure the sheet has the workers/points/visits tabs.
  r.post("/setup", requireRole("admin"), async (req, res) => {
    try {
      const out = await forTenant(config.getTenant(req)).ensureSetup();
      res.json({ ok: true, ...out });
    } catch (e) {
      console.error("/api/setup error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  app.use("/api", r);
}

module.exports = { mountPlatformRoutes };
