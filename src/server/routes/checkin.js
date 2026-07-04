// /api/checkin — a worker check-in from the PWA (browser), the web twin of the bot
// flow. The worker's phone gives GPS + camera; we store the photo in the datasource's
// photo store (Supabase Storage) and write a visit with source="pwa". Everything else
// (dashboard, export API) reads it exactly like a bot check-in.
const express = require("express");
const config  = require("../config");
const { requireAuth } = require("../auth");
const { forTenant } = require("../datasource");

const bigJson = express.json({ limit: "12mb" }); // base64 photo payloads
function str(v) { return v == null ? "" : String(v); }

function mountCheckinRoutes(app) {
  const r = express.Router();
  r.use(requireAuth);

  r.post("/", bigJson, async (req, res) => {
    try {
      const b = req.body || {};
      const pointId = str(b.pointId).trim();
      const lat = str(b.lat).trim(), lng = str(b.lng).trim();
      if (!pointId) return res.status(400).json({ error: "no_point" });
      if (!lat || !lng) return res.status(400).json({ error: "no_location", detail: "Location is required." });

      const source = forTenant(config.getTenant(req));
      const point = (await source.listPoints()).find(p => String(p.id) === pointId);
      if (!point) return res.status(404).json({ error: "point_not_found" });

      // Optional photo → datasource photo store (Supabase Storage / in-memory).
      const photoFileIds = [];
      if (b.photo) {
        const buf = Buffer.from(String(b.photo), "base64");
        const ref = await source.uploadPhoto(buf, b.photoContentType || "image/jpeg");
        photoFileIds.push(ref);
      }

      const visitId = await source.addVisit({
        timestamp: new Date().toISOString(),
        workerTelegramId: str(req.user.telegramId),
        workerName: req.user.name || "",
        pointId, pointName: point.name || point.address || point.id,
        lat, lng, mapsLink: `https://www.google.com/maps?q=${lat},${lng}`,
        photoCount: photoFileIds.length,
        photoFileIds,
        source: "pwa",
        note: str(b.note).slice(0, 500),
      });

      try { await source.ensurePointLocation(pointId, lat, lng); }
      catch (e) { console.error("ensurePointLocation error:", e.message); }

      res.json({ ok: true, visitId });
    } catch (e) {
      console.error("/api/checkin error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

  app.use("/api/checkin", r);
}

module.exports = { mountCheckinRoutes };
