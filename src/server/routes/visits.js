// /api/visits — the check-in log (read-only here; the bot writes them).
// /api/stats  — aggregates for the dashboard (totals, today, per-worker, per-point,
//               and recent visits with coordinates for the map).
const express = require("express");
const config  = require("../config");
const { requireAuth } = require("../auth");
const { forTenant } = require("../datasource");
const { localDateStr } = require("../util");
const { renderVisitPdf } = require("../pdf");

function ds(req) { return forTenant(config.getTenant(req)); }
function fail(res, e) { console.error("/api/visits error:", e && e.message); res.status(500).json({ error: (e && e.message) || "server_error" }); }

function tally(obj, key) { if (!key) return; obj[key] = (obj[key] || 0) + 1; }

function mountVisitRoutes(app) {
  const r = express.Router();
  r.use(requireAuth);

  // Raw list (newest first), capped.
  r.get("/visits", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
      res.json({ visits: await ds(req).listVisits({ limit }) });
    } catch (e) { fail(res, e); }
  });

  // Serve a single check-in photo. The bot stored Telegram file_ids on the visit; we
  // resolve one to a URL and PROXY the bytes so the bot token never reaches the browser.
  // Needs the bot to be running (that's who holds the token) — returns 409 if it's off.
  r.get("/visits/:visitId/photo/:idx", async (req, res) => {
    try {
      const source = ds(req);
      const visits = await source.listVisits({ limit: 5000 });
      const visit = visits.find(v => String(v.visitId) === String(req.params.visitId));
      if (!visit) return res.status(404).json({ error: "visit_not_found" });

      const ids = String(visit.photoFileIds || "").split(",").map(s => s.trim()).filter(Boolean);
      const fileId = ids[parseInt(req.params.idx, 10) || 0];
      if (!fileId) return res.status(404).json({ error: "photo_not_found" });

      // PWA photos live in the datasource photo store (Supabase Storage), not Telegram.
      if (visit.source === "pwa") {
        const photo = await source.getPhoto(fileId);
        if (!photo) return res.status(404).json({ error: "photo_not_found" });
        res.set("Content-Type", photo.contentType || "image/jpeg");
        res.set("Cache-Control", "private, max-age=3600");
        return res.send(photo.buffer);
      }

      let link;
      try {
        link = await require("../bot/manager").fileLink(fileId);
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

  // Play back a voice-note comment left via the bot's optional commentary step (see
  // bot/handlers.js): the note stores "🎙️voice:<telegram file_id>" instead of text, and
  // this proxies the audio bytes the same way the photo endpoint proxies Telegram photos.
  const VOICE_PREFIX = "🎙️voice:";
  r.get("/visits/:visitId/voice", async (req, res) => {
    try {
      const visits = await ds(req).listVisits({ limit: 5000 });
      const visit = visits.find(v => String(v.visitId) === String(req.params.visitId));
      if (!visit) return res.status(404).json({ error: "visit_not_found" });
      const note = String(visit.note || "");
      if (!note.startsWith(VOICE_PREFIX)) return res.status(404).json({ error: "no_voice_note" });
      const fileId = note.slice(VOICE_PREFIX.length);
      let link;
      try { link = await require("../bot/manager").fileLink(fileId); }
      catch (e) {
        if (e && e.code === "bot_off") return res.status(409).json({ error: "Bot is off — turn it on to load voice notes." });
        throw e;
      }
      const tg = await fetch(link);
      if (!tg.ok) return res.status(502).json({ error: "telegram_fetch_failed" });
      res.set("Content-Type", tg.headers.get("content-type") || "audio/ogg");
      res.set("Cache-Control", "private, max-age=3600");
      res.send(Buffer.from(await tg.arrayBuffer()));
    } catch (e) { fail(res, e); }
  });

  // Albarán / proof-of-visit PDF for one check-in — tenant-branded via the pdf-settings
  // saved from the PDF Settings tab (see routes/platform.js).
  r.get("/visits/:visitId/pdf", async (req, res) => {
    try {
      const tenant = config.getTenant(req);
      const source = ds(req);
      const [visits, points] = await Promise.all([
        source.listVisits({ limit: 5000 }), source.listPoints(),
      ]);
      const visit = visits.find(v => String(v.visitId) === String(req.params.visitId));
      if (!visit) return res.status(404).json({ error: "visit_not_found" });
      const point = points.find(p => String(p.id) === String(visit.pointId)) || null;
      const pdfSettings = {};
      const fields = ["pdfCompanyName", "pdfTaxId", "pdfAddress", "pdfLogoUrl", "pdfDocTitle", "pdfFootnote"];
      const keys = { pdfCompanyName: "pdf_company_name", pdfTaxId: "pdf_tax_id", pdfAddress: "pdf_address", pdfLogoUrl: "pdf_logo_url", pdfDocTitle: "pdf_doc_title", pdfFootnote: "pdf_footnote" };
      for (const f of fields) pdfSettings[f] = String(await source.getSetting(keys[f], "") || "");
      const baseUrl = (config.PLATFORM_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      await renderVisitPdf(res, { visit, point, tenant, pdfSettings, source, baseUrl });
    } catch (e) { fail(res, e); }
  });

  // Dashboard aggregates. Reads points + workers + visits in one go so the dashboard
  // needs a single request.
  r.get("/stats", async (req, res) => {
    try {
      const source = ds(req);
      const [points, workers, visits] = await Promise.all([
        source.listPoints(), source.listWorkers(), source.listVisits({ limit: 5000 }),
      ]);
      const today = localDateStr(null, config.TIMEZONE);
      const byWorker = {}, byPoint = {};
      let todayCount = 0;
      for (const v of visits) {
        if (localDateStr(v.timestamp, config.TIMEZONE) === today) todayCount++;
        tally(byWorker, v.workerName || v.workerTelegramId);
        tally(byPoint, v.pointName || v.pointId);
      }

      // Daily coverage per worker: of the active points assigned to each worker, how
      // many were checked in today (X of Y), and which remain pending.
      const activePoints = points.filter(p => p.active);
      const pointsUnassigned = activePoints.filter(p => !p.workerId).length;

      // Resolve a visit to its owner's stable workerId. New visits carry workerId; older
      // ones only a telegramId, so map telegramId → workerId as a fallback.
      const tidToWid = {};
      for (const w of workers) if (w.telegramId) tidToWid[String(w.telegramId)] = String(w.workerId);
      const ownerWid = v =>
        String(v.workerId || "").trim() || tidToWid[String(v.workerTelegramId || "")] || "";

      const doneTodayByWid = {}; // workerId → Set(pointId)
      for (const v of visits) {
        if (localDateStr(v.timestamp, config.TIMEZONE) !== today) continue;
        const wid = ownerWid(v);
        if (!wid) continue;
        (doneTodayByWid[wid] || (doneTodayByWid[wid] = new Set())).add(String(v.pointId));
      }
      const coverage = workers.map(w => {
        const assigned = activePoints.filter(p => String(p.workerId) === String(w.workerId));
        const done = doneTodayByWid[String(w.workerId)] || new Set();
        const pending = assigned.filter(p => !done.has(String(p.id)));
        return {
          workerId: w.workerId,
          workerName: w.name,
          active: w.active,
          assigned: assigned.length,
          visitedToday: assigned.length - pending.length,
          pending: pending.map(p => ({ id: p.id, name: p.name || p.address || p.id })),
        };
      });

      res.json({
        totals: {
          visits: visits.length,
          today: todayCount,
          points: points.length,
          pointsActive: activePoints.length,
          pointsUnassigned,
          workers: workers.length,
          workersActive: workers.filter(w => w.active).length,
        },
        byWorker, byPoint,
        coverage,
        recent: visits.slice(0, 200),
      });
    } catch (e) { fail(res, e); }
  });

  app.use("/api", r);
}

module.exports = { mountVisitRoutes };
