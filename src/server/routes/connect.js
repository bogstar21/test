// /api/v1 — the client-facing connector. This is the "connect via API" path: the
// client PUSHES their catalog (workers, points) as JSON and PULLS the visit log back.
// It is a separate credential from the platform login (X-API-Key, see requireApiKey)
// and is OFF until INTEGRATION_API_KEY is set. The connector always acts on the
// default tenant (single-company MVP).
//
//   POST /api/v1/workers  body { "workers": [{ telegramId?, name, phone, active? }] }
//   POST /api/v1/points   body { "points":  [{ id?, name, address, workerPhone? }] }
//   GET  /api/v1/visits   → { visits: [ shaped ] }   (?limit=, newest first)
//
// Points load WITHOUT coordinates on purpose — the first check-in fixes each point's
// location (see ensurePointLocation). Visits live only in our store; this is how the
// client reads them out.
const express = require("express");
const rateLimit = require("express-rate-limit");
const config  = require("../config");
const { requireApiKey } = require("../auth");
const { forTenant } = require("../datasource");

const MAX_ROWS = 5000;

// Per-tenant rate limit for the connector. The global /api limiter is keyed by IP, which
// is wrong here: many companies may integrate from the same shared server IP (one noisy
// client would throttle everyone). requireApiKey has already resolved the tenant, so we
// key by tenantId and give each company its own budget.
const connectorLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => (req.user && req.user.tenantId) || req.ip,
  message: { error: "rate_limited", detail: "Too many requests for this company. Slow down." },
});

// The tenant is resolved from the X-API-Key by requireApiKey (req.user.tenantId), so the
// connector reads/writes the company that owns the key — not a hardcoded tenant.
function ds(req) { return forTenant(config.getTenant(req)); }
function str(v) { return v == null ? "" : String(v); }
function fail(res, e) {
  console.error("/api/v1 error:", e && e.message);
  res.status(500).json({ error: (e && e.message) || "server_error" });
}

// Map an incoming worker object to the datasource appendWorkers row: [telegramId, name, phone].
function workerRow(w) {
  w = w || {};
  return [str(w.telegramId || w.telegram_id), str(w.name), str(w.phone)];
}
// Map an incoming point object to the datasource appendPoints row:
// [id, name, address, lat, lng, workerRef]. lat/lng intentionally empty — coordinates
// come from the first check-in. workerRef (phone or worker_id) links the point to its
// assigned worker; it's resolved to worker_id + worker_name inside the datasource.
function pointRow(p) {
  p = p || {};
  const workerRef = p.workerPhone || p.worker_phone || p.workerId || p.worker_id || p.worker || "";
  return [str(p.id), str(p.name), str(p.address), "", "", str(workerRef)];
}

// Shape a stored visit for external consumers. Photo URLs point back at our proxy so
// the client never needs the bot token or Supabase keys.
function shapeVisit(v, base) {
  const count = Number(v.photoCount) || 0;
  const photos = [];
  for (let i = 0; i < count; i++) {
    photos.push(`${base}/api/v1/visits/${encodeURIComponent(v.visitId)}/photo/${i}`);
  }
  return {
    visitId:   v.visitId,
    timestamp: v.timestamp,
    worker:    { workerId: v.workerId, telegramId: v.workerTelegramId, name: v.workerName },
    point:     { id: v.pointId, name: v.pointName },
    location:  { lat: v.lat, lng: v.lng, mapsLink: v.mapsLink },
    photoCount: count,
    photos,
    source:    v.source || "bot",
    note:      v.note || "",
  };
}

function mountConnectRoutes(app) {
  const r = express.Router();
  r.use(requireApiKey);       // resolves the tenant from X-API-Key first…
  r.use(connectorLimiter);    // …then throttle per that tenant

  r.post("/workers", async (req, res) => {
    try {
      const input = (req.body && req.body.workers) || [];
      if (!Array.isArray(input) || !input.length) return res.status(400).json({ error: "no_workers" });
      if (input.length > MAX_ROWS) return res.status(400).json({ error: "too_many_rows", max: MAX_ROWS });
      const written = await ds(req).appendWorkers(input.map(workerRow));
      res.json({ ok: true, written });
    } catch (e) { fail(res, e); }
  });

  r.post("/points", async (req, res) => {
    try {
      const input = (req.body && req.body.points) || [];
      if (!Array.isArray(input) || !input.length) return res.status(400).json({ error: "no_points" });
      if (input.length > MAX_ROWS) return res.status(400).json({ error: "too_many_rows", max: MAX_ROWS });
      const written = await ds(req).appendPoints(input.map(pointRow));
      res.json({ ok: true, written });
    } catch (e) { fail(res, e); }
  });

  r.get("/visits", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, MAX_ROWS);
      const base = (config.PLATFORM_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const visits = await ds(req).listVisits({ limit });
      res.json({ visits: visits.map(v => shapeVisit(v, base)) });
    } catch (e) { fail(res, e); }
  });

  // Photo proxy for connector consumers (X-API-Key). Serves both sources without ever
  // exposing the bot token or Supabase keys: PWA visits stream from Storage; bot visits
  // resolve the Telegram file_id and proxy the bytes (needs the bot running → 409 if off).
  r.get("/visits/:visitId/photo/:idx", async (req, res) => {
    try {
      const source = ds(req);
      const visits = await source.listVisits({ limit: MAX_ROWS });
      const visit = visits.find(v => String(v.visitId) === String(req.params.visitId));
      if (!visit) return res.status(404).json({ error: "visit_not_found" });

      const refs = String(visit.photoFileIds || "").split(",").map(s => s.trim()).filter(Boolean);
      const ref = refs[parseInt(req.params.idx, 10) || 0];
      if (!ref) return res.status(404).json({ error: "photo_not_found" });

      if (visit.source === "pwa") {
        const photo = await source.getPhoto(ref);
        if (!photo) return res.status(404).json({ error: "photo_not_found" });
        res.set("Content-Type", photo.contentType || "image/jpeg");
        res.set("Cache-Control", "private, max-age=3600");
        return res.send(photo.buffer);
      }

      let link;
      try {
        link = await require("../bot/manager").fileLink(ref);
      } catch (e) {
        if (e && e.code === "bot_off") return res.status(409).json({ error: "Bot is off — turn it on to load photos." });
        throw e;
      }
      const tg = await fetch(link);
      if (!tg.ok) return res.status(502).json({ error: "telegram_fetch_failed" });
      res.set("Content-Type", tg.headers.get("content-type") || "image/jpeg");
      res.set("Cache-Control", "private, max-age=3600");
      res.send(Buffer.from(await tg.arrayBuffer()));
    } catch (e) { fail(res, e); }
  });

  app.use("/api/v1", r);
}

module.exports = { mountConnectRoutes };
