// /api/workers — list + CRUD over the `workers` tab (the field staff who check in).
// telegramId is how the bot recognises a worker. Read is open to any logged-in user;
// writes require admin.
const express = require("express");
const config  = require("../config");
const { requireAuth, requireRole } = require("../auth");
const { forTenant } = require("../datasource");

function clean(v) { return (v == null ? "" : String(v)).trim().slice(0, 300); }
function ds(req)  { return forTenant(config.getTenant(req)); }
function fail(res, e) { console.error("/api/workers error:", e && e.message); res.status(500).json({ error: (e && e.message) || "server_error" }); }

function sanitize(b) {
  b = b || {};
  return {
    telegramId: clean(b.telegramId),
    name:       clean(b.name),
    phone:      clean(b.phone),
    active:     !(b.active === false || b.active === "0" || b.active === "false"),
  };
}

function validate(f) {
  if (f.telegramId && !/^\d+$/.test(f.telegramId)) return "Telegram ID must be digits only.";
  return null;
}

function mountWorkerRoutes(app) {
  const r = express.Router();
  r.use(requireAuth);

  r.get("/", async (req, res) => {
    try { res.json({ workers: await ds(req).listWorkers() }); } catch (e) { fail(res, e); }
  });

  r.post("/", requireRole("admin"), async (req, res) => {
    const f = sanitize(req.body);
    const v = validate(f);
    if (v) return res.status(400).json({ error: v });
    if (!f.name && !f.telegramId && !f.phone) return res.status(400).json({ error: "Name, Telegram ID or phone required." });
    try { await ds(req).addWorker(f); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  r.put("/:row", requireRole("admin"), async (req, res) => {
    const row = parseInt(req.params.row, 10);
    if (!(row >= 2)) return res.status(400).json({ error: "bad_row" });
    const f = sanitize(req.body);
    const v = validate(f);
    if (v) return res.status(400).json({ error: v });
    try { await ds(req).updateWorker(row, f); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  r.delete("/:row", requireRole("admin"), async (req, res) => {
    const row = parseInt(req.params.row, 10);
    if (!(row >= 2)) return res.status(400).json({ error: "bad_row" });
    try {
      const source = ds(req);
      // Before removing the worker, clear the assignment on their points so none end up
      // pointing at a worker that no longer exists (which would hide them from every route).
      const worker = (await source.listWorkers()).find(w => String(w.row) === String(row));
      await source.deleteWorker(row);
      let unassigned = 0;
      if (worker && worker.workerId) unassigned = await source.unassignPointsForWorker(worker.workerId);
      res.json({ ok: true, unassigned });
    } catch (e) { fail(res, e); }
  });

  app.use("/api/workers", r);
}

module.exports = { mountWorkerRoutes };
