// Platform shell + small session/setup endpoints.
//   GET  /platform        → the SPA (gated)
//   GET  /platform/login  → login page (public)
//   GET  /api/me          → who am I / which company (gated)
//   POST /api/setup       → create missing tabs in the tenant's sheet (admin)
const path    = require("path");
const express = require("express");
const config  = require("../config");
const { requireAuth, requireRole } = require("../auth");
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

  // Platform settings for the manager UI. connectorEnabled is derived from the server
  // env (the API key itself is never echoed back); pwaEnabled is a per-tenant setting.
  r.get("/settings", async (req, res) => {
    try {
      const source = forTenant(config.getTenant(req));
      const pwaEnabled = String(await source.getSetting("pwa_enabled", "0")) === "1";
      res.json({ pwaEnabled, connectorEnabled: !!(process.env.INTEGRATION_API_KEY || "") });
    } catch (e) {
      console.error("/api/settings error:", e && e.message);
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
      res.json({ ok: true, pwaEnabled, connectorEnabled: !!(process.env.INTEGRATION_API_KEY || "") });
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
