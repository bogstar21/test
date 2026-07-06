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

  app.get("/platform", requireAuth, (_req, res) =>
    res.sendFile(path.join(config.PUBLIC_DIR, "platform", "index.html")));

  const r = express.Router();
  r.use(requireAuth);

  r.get("/me", (req, res) => res.json({
    name: req.user.name, company: req.user.company,
    tenantId: req.user.tenantId, role: req.user.role,
  }));

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
      const key = await ensureConnectorKey(source, isAdmin);
      res.json({
        pwaEnabled,
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
      const pwaEnabled = String(await source.getSetting("pwa_enabled", "0")) === "1";
      const key = String((await source.getSetting(CONNECTOR_KEY_SETTING, "")) || "");
      res.json({ ok: true, pwaEnabled, connectorEnabled: !!key || !!(process.env.INTEGRATION_API_KEY || "") });
    } catch (e) {
      console.error("/api/settings error:", e && e.message);
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
