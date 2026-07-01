// /api/points — list + CRUD over the `points` tab (the stops to visit).
// Read is open to any logged-in user; writes require the admin role.
const express = require("express");
const config  = require("../config");
const { requireAuth, requireRole } = require("../auth");
const { forTenant } = require("../datasource");

function clean(v) { return (v == null ? "" : String(v)).trim().slice(0, 300); }
function ds(req)  { return forTenant(config.getTenant(req)); }
function fail(res, e) { console.error("/api/points error:", e && e.message); res.status(500).json({ error: (e && e.message) || "server_error" }); }

function sanitize(b) {
  b = b || {};
  return {
    id:      clean(b.id),
    name:    clean(b.name),
    address: clean(b.address),
    lat:     clean(b.lat),
    lng:     clean(b.lng),
    active:  !(b.active === false || b.active === "0" || b.active === "false"),
  };
}

function mountPointRoutes(app) {
  const r = express.Router();
  r.use(requireAuth);

  r.get("/", async (req, res) => {
    try { res.json({ points: await ds(req).listPoints() }); } catch (e) { fail(res, e); }
  });

  r.post("/", requireRole("admin"), async (req, res) => {
    const f = sanitize(req.body);
    if (!f.name && !f.address) return res.status(400).json({ error: "Name or address required." });
    try { const id = await ds(req).addPoint(f); res.json({ ok: true, id }); } catch (e) { fail(res, e); }
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

  app.use("/api/points", r);
}

module.exports = { mountPointRoutes };
