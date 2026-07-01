// /api/visits — the check-in log (read-only here; the bot writes them).
// /api/stats  — aggregates for the dashboard (totals, today, per-worker, per-point,
//               and recent visits with coordinates for the map).
const express = require("express");
const config  = require("../config");
const { requireAuth } = require("../auth");
const { forTenant } = require("../datasource");

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

  // Dashboard aggregates. Reads points + workers + visits in one go so the dashboard
  // needs a single request.
  r.get("/stats", async (req, res) => {
    try {
      const source = ds(req);
      const [points, workers, visits] = await Promise.all([
        source.listPoints(), source.listWorkers(), source.listVisits({ limit: 5000 }),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const byWorker = {}, byPoint = {};
      let todayCount = 0;
      for (const v of visits) {
        if ((v.timestamp || "").slice(0, 10) === today) todayCount++;
        tally(byWorker, v.workerName || v.workerTelegramId);
        tally(byPoint, v.pointName || v.pointId);
      }
      res.json({
        totals: {
          visits: visits.length,
          today: todayCount,
          points: points.length,
          pointsActive: points.filter(p => p.active).length,
          workers: workers.length,
          workersActive: workers.filter(w => w.active).length,
        },
        byWorker, byPoint,
        recent: visits.slice(0, 200),
      });
    } catch (e) { fail(res, e); }
  });

  app.use("/api", r);
}

module.exports = { mountVisitRoutes };
