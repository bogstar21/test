// /api/checkin — a worker check-in from the PWA (browser), the web twin of the bot
// flow. The worker's phone gives GPS + camera; we store the photo in the datasource's
// photo store (Supabase Storage) and write a visit with source="pwa". Everything else
// (dashboard, export API) reads it exactly like a bot check-in.
const express = require("express");
const config  = require("../config");
const { requireAuth } = require("../auth");
const { forTenant } = require("../datasource");
const { localDateStr, visitBelongsToWorker, geofenceOk } = require("../util");

const bigJson = express.json({ limit: "12mb" }); // base64 photo payloads
function str(v) { return v == null ? "" : String(v); }

// Resolve the worker behind the current session (worker logs in by phone → session
// carries telegramId + workerRow).
async function sessionWorker(source, user) {
  const workers = await source.listWorkers();
  const byRow = user.workerRow && workers.find(w => String(w.row) === String(user.workerRow));
  const byTid = user.telegramId && workers.find(w => String(w.telegramId) === String(user.telegramId));
  return byRow || byTid || null;
}

function mountCheckinRoutes(app) {
  const r = express.Router();
  r.use(requireAuth);

  // The logged-in worker's assigned stops, each flagged if already done today.
  r.get("/points", async (req, res) => {
    try {
      const source = forTenant(config.getTenant(req));
      const worker = await sessionWorker(source, req.user || {});
      if (!worker) return res.json({ points: [] });
      const points = (await source.listPointsForWorker(worker.workerId)).filter(p => p.active);
      const today = localDateStr(null, config.TIMEZONE);
      const visits = await source.listVisits({ limit: 2000 });
      const doneToday = new Set(
        visits.filter(v => visitBelongsToWorker(v, worker)
                        && localDateStr(v.timestamp, config.TIMEZONE) === today)
              .map(v => String(v.pointId)));
      res.json({
        points: points.map(p => ({
          id: p.id, name: p.name, address: p.address,
          visitedToday: doneToday.has(String(p.id)),
        })),
      });
    } catch (e) {
      console.error("/api/checkin/points error:", e && e.message);
      res.status(500).json({ error: (e && e.message) || "server_error" });
    }
  });

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

      // A worker may only check in at their OWN assigned stop. Unassigned points are
      // allowed (a manager may not have assigned them yet); a point belonging to a
      // DIFFERENT worker is rejected.
      const worker = await sessionWorker(source, req.user || {});
      if (worker && point.workerId && String(point.workerId) !== String(worker.workerId)) {
        return res.status(403).json({ error: "not_your_point", detail: "This stop is assigned to another worker." });
      }

      // Geofence: reject a check-in too far from the point's known location (off by default;
      // set GEOFENCE_METERS). The first check-in at a point has no coords yet → always allowed.
      const fence = geofenceOk(point, lat, lng, config.GEOFENCE_METERS);
      if (!fence.ok) {
        return res.status(422).json({
          error: "too_far",
          detail: `Estás a ${fence.distance} m del punto (máximo ${config.GEOFENCE_METERS} m). Acércate para hacer el check-in.`,
          distance: fence.distance, maxMeters: config.GEOFENCE_METERS,
        });
      }

      // Optional photo → datasource photo store (Supabase Storage / in-memory).
      const photoFileIds = [];
      if (b.photo) {
        const buf = Buffer.from(String(b.photo), "base64");
        const ref = await source.uploadPhoto(buf, b.photoContentType || "image/jpeg");
        photoFileIds.push(ref);
      }

      const visitId = await source.addVisit({
        timestamp: new Date().toISOString(),
        workerId: worker ? worker.workerId : "",
        workerTelegramId: str(req.user.telegramId),
        workerName: (worker && worker.name) || req.user.name || "",
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
