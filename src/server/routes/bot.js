// /api/bot — control the Telegram bot from the web platform (admin only).
//   GET  /api/bot/status → { running, username, startedAt }
//   POST /api/bot/start  → start polling with the server's TELEGRAM_TOKEN
//   POST /api/bot/stop   → stop polling
//
// ONE shared bot for the whole platform: the token lives ONLY in the server env
// (TELEGRAM_TOKEN), never in the UI and never in the browser. The web app just flips
// it on/off. If the token isn't configured, /start returns 503.
//
// The bot manager is required lazily so the server still boots (and unit-tests run)
// even if node-telegram-bot-api isn't reachable.
const express = require("express");
const { requireAuth, requireRole } = require("../auth");

function manager() { return require("../bot/manager"); }

function mountBotRoutes(app) {
  const r = express.Router();
  r.use(requireAuth, requireRole("admin"));

  r.get("/status", (_req, res) => {
    try { res.json({ ...manager().status(), configured: !!(process.env.TELEGRAM_TOKEN || "") }); }
    catch (e) { res.status(500).json({ error: (e && e.message) || "server_error" }); }
  });

  r.post("/start", async (_req, res) => {
    const token = process.env.TELEGRAM_TOKEN || "";
    if (!token) return res.status(503).json({ error: "Bot not configured. Set TELEGRAM_TOKEN in the server env, then redeploy." });
    try {
      const s = await manager().start(token);
      res.json({ ok: true, ...s });
    } catch (e) {
      const msg = e && e.code === "invalid_token"
        ? "The configured TELEGRAM_TOKEN was rejected by Telegram. Check the env var."
        : (e && e.message) || "Could not start the bot.";
      console.error("/api/bot/start error:", e && e.message);
      res.status(400).json({ error: msg });
    }
  });

  r.post("/stop", async (_req, res) => {
    try { const s = await manager().stop(); res.json({ ok: true, ...s }); }
    catch (e) { res.status(500).json({ error: (e && e.message) || "server_error" }); }
  });

  app.use("/api/bot", r);
}

module.exports = { mountBotRoutes };
