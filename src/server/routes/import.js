// /api/import — Excel/CSV onboarding. The client uploads a file, the platform parses
// it (preview), the user maps columns in the UI, then imports rows into the sheet.
//   POST /api/import/parse   → { headers, rows }     (no write)
//   POST /api/import/points  → append mapped rows to `points`
//   POST /api/import/workers → append mapped rows to `workers`
// Mapped row order — points: [id, name, address, lat, lng, workerRef]; workers: [telegramId, name, phone].
// workerRef is a worker phone or internal worker_id, resolved to the assigned worker.
const express = require("express");
const XLSX    = require("xlsx");
const config  = require("../config");
const { requireAuth, requireRole } = require("../auth");
const { forTenant } = require("../datasource");

const MAX_IMPORT_ROWS = 5000;
const bigJson = express.json({ limit: "50mb" }); // base64 file payloads

function parseUpload(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  const headers = (grid[0] || []).map(h => String(h == null ? "" : h));
  const rows = grid.slice(1).map(r => headers.map((_, i) => String(r[i] == null ? "" : r[i])));
  return { headers, rows };
}

function mountImportRoutes(app) {
  const r = express.Router();
  r.use(requireAuth, requireRole("admin"));

  r.post("/parse", bigJson, (req, res) => {
    try {
      const b64 = (req.body && req.body.data) || "";
      if (!b64) return res.status(400).json({ error: "no_file" });
      const { headers, rows } = parseUpload(Buffer.from(b64, "base64"));
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `Too many rows (${rows.length}). Max ${MAX_IMPORT_ROWS}.` });
      res.json({ headers, rows, count: rows.length });
    } catch (e) {
      console.error("/api/import/parse error:", e.message);
      res.status(400).json({ error: "Could not read file: " + e.message });
    }
  });

  r.post("/points", bigJson, async (req, res) => {
    try {
      const rows = (req.body && req.body.rows) || [];
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "no_rows" });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: "too_many_rows" });
      const written = await forTenant(config.getTenant(req)).appendPoints(rows);
      res.json({ ok: true, written });
    } catch (e) {
      console.error("/api/import/points error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  r.post("/workers", bigJson, async (req, res) => {
    try {
      const rows = (req.body && req.body.rows) || [];
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "no_rows" });
      if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: "too_many_rows" });
      const written = await forTenant(config.getTenant(req)).appendWorkers(rows);
      res.json({ ok: true, written });
    } catch (e) {
      console.error("/api/import/workers error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.use("/api/import", r);
}

module.exports = { mountImportRoutes };
