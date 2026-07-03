// /api/bot — control the Telegram bot from the web platform (admin only).
//   GET  /api/bot/status → { running, username, startedAt }
//   POST /api/bot/start  { token } → validate token + start polling live
//   POST /api/bot/stop   → stop polling
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
    try { res.json(manager().status()); }
    catch (e) { res.status(500).json({ error: (e && e.message) || "server_error" }); }
  });

  r.post("/start", async (req, res) => {
    const token = (req.body && req.body.token) || "";
    if (!token) return res.status(400).json({ error: "Paste your BotFather token first." });
    try {
      const s = await manager().start(token);
      res.json({ ok: true, ...s });
    } catch (e) {
      const msg = e && e.code === "invalid_token"
        ? "That token was rejected by Telegram. Check you copied it correctly from @BotFather."
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
