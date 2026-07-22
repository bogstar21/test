// /api/points — list + CRUD over the `points` tab (the stops to visit).
// Read is open to any logged-in user; writes require the admin role.
const express = require("express");
const config  = require("../config");
const { requireAuth, requireRole, requireActiveSubscription, quotaError } = require("../auth");
const { forTenant } = require("../datasource");

function clean(v) { return (v == null ? "" : String(v)).trim().slice(0, 300); }
function ds(req)  { return forTenant(config.getTenant(req)); }
function fail(res, e) { console.error("/api/points error:", e && e.message); res.status(500).json({ error: (e && e.message) || "server_error" }); }

function sanitize(b) {
  b = b || {};
  const s = {
    id:      clean(b.id),
    name:    clean(b.name),
    address: clean(b.address),
    lat:     clean(b.lat),
    lng:     clean(b.lng),
    active:  !(b.active === false || b.active === "0" || b.active === "false"),
  };
  // Worker assignment (1:1). The UI sends the worker's internal id in `workerId`;
  // a phone reference is also accepted. Only include the key when the caller sent it
  // so updatePoint can tell "leave assignment as-is" from "unassign" (empty string).
  if (b.workerId != null)    s.workerId    = clean(b.workerId);
  if (b.workerPhone != null) s.workerPhone = clean(b.workerPhone);
  return s;
}

function mountPointRoutes(app) {
  const r = express.Router();
  r.use(requireAuth);

  r.get("/", async (req, res) => {
    try { res.json({ points: await ds(req).listPoints() }); } catch (e) { fail(res, e); }
  });

  r.post("/", requireRole("admin"), requireActiveSubscription, async (req, res) => {
    const f = sanitize(req.body);
    if (!f.name && !f.address) return res.status(400).json({ error: "Name or address required." });
    try {
      const q = await quotaError(req, "points", 1);
      if (q) return res.status(402).json({ error: "quota_exceeded", detail: q });
      const id = await ds(req).addPoint(f);
      res.json({ ok: true, id });
    } catch (e) { fail(res, e); }
  });

  // Bulk (re)assign several points to one worker in a single call. Body:
  //   { rows: [<row>, ...], workerId: "<id>" }   (workerId "" = unassign)
  r.post("/assign", requireRole("admin"), async (req, res) => {
    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const workerId = clean(body.workerId); // "" → unassign
    if (!rows.length) return res.status(400).json({ error: "no_rows" });
    try {
      const source = ds(req);
      const all = await source.listPoints();
      let updated = 0;
      for (const row of rows) {
        const p = all.find(x => String(x.row) === String(row));
        if (!p) continue;
        await source.updatePoint(p.row, { id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, active: p.active, workerId });
        updated++;
      }
      res.json({ ok: true, updated });
    } catch (e) { fail(res, e); }
  });

  r.put("/:row", requireRole("admin"), async (req, res) => {
    const row = parseInt(req.params.row, 10);
    if (!(row >= 2)) return res.status(400).json({ error: "bad_row" });
    try { await ds(req).updatePoint(row, sanitize(req.body)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  r.delete("/:row", requireRole("admin"), async (req, res) => {
    const row = parseInt(req.params.row, 10);
    if (!(row >= 2)) return res.status(400).json({ error: "bad_row" });
    try { await ds(req).deletePoint(row); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  // Delete several points in one call. Body: { ids: [<row>, ...] } (row numbers, same
  // handle used everywhere else in this API — DELETE /:row, POST /assign).
  r.post("/bulk-delete", requireRole("admin"), async (req, res) => {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids : (Array.isArray(body.rows) ? body.rows : []);
    if (!ids.length) return res.status(400).json({ error: "no_rows" });
    try {
      const source = ds(req);
      let deleted = 0;
      for (const id of ids) {
        const row = parseInt(id, 10);
        if (!(row >= 2)) continue;
        deleted += (await source.deletePoint(row)) || 0;
      }
      res.json({ ok: true, deleted });
    } catch (e) { fail(res, e); }
  });

  app.use("/api/points", r);
}

module.exports = { mountPointRoutes };
