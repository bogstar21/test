// Google Sheets datasource. ALL sheet structure + I/O for the three StarX entities
// (workers, points, visits) lives here, behind a small interface. The routes and the
// bot never touch Google directly — they call this. That's the seam that lets us add
// datasource/api.js or datasource/postgres.js later without changing anything else.
//
// Tabs & columns (row 1 = header):
//   workers : telegramId | name | phone | active
//   points  : id | name | address | lat | lng | active
//   visits  : timestamp | visitId | workerTelegramId | workerName | pointId |
//             pointName | lat | lng | mapsLink | photoCount | photoFileIds | note
const { getSheetsClient } = require("../sheets");
const { phonesMatch } = require("../util");

// In-process settings for the sheets datasource (not persisted — Supabase is the
// recommended store when you need durable settings and PWA photos).
const _settings = new Map();

const TABS = {
  workers: { name: "workers", headers: ["telegramId", "name", "phone", "active", "workerId"] },
  points:  { name: "points",  headers: ["id", "name", "address", "lat", "lng", "active", "workerId", "workerName"] },
  visits:  { name: "visits",  headers: ["timestamp", "visitId", "workerTelegramId", "workerName", "pointId", "pointName", "lat", "lng", "mapsLink", "photoCount", "photoFileIds", "note", "workerId"] },
};

const MAX_ROWS = 5000;

function isActive(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "ні");
}
function str(v) { return v == null ? "" : String(v); }

// One datasource bound to a single spreadsheet. `forTenant` (in index.js) creates one.
function newWorkerId() { return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function makeSheetsSource(sheetId) {
  if (!sheetId) throw new Error("sheets datasource: missing sheetId");
  const api = getSheetsClient;

  // Resolve a worker reference (phone OR worker_id) to { workerId, workerName }.
  async function resolveWorker(ref) {
    const r = str(ref).trim();
    if (!r) return { workerId: "", workerName: "" };
    const workers = await listWorkers();
    const w = workers.find(x => (x.workerId && String(x.workerId) === r) || phonesMatch(x.phone, r));
    return w ? { workerId: w.workerId, workerName: w.name } : { workerId: r, workerName: "" };
  }

  async function readRows(tab) {
    const sheets = api();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab });
    const values = res.data.values || [];
    return values.slice(1); // drop header
  }

  // Next free row in a tab, computed from real contents (avoids values.append quirks).
  async function nextEmptyRow(tab) {
    const sheets = api();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:A` });
    const rows = res.data.values || [];
    let last = 1; // row 1 = header
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] || []).some(c => c != null && String(c).trim() !== "")) last = i + 1;
    }
    return last + 1;
  }

  async function tabGid(tab) {
    const sheets = api();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties(sheetId,title)" });
    const found = (meta.data.sheets || []).find(s => s.properties.title === tab);
    if (!found) throw new Error(`tab_not_found:${tab}`);
    return found.properties.sheetId;
  }

  async function deleteRows(tab, rows) {
    const uniqueDesc = Array.from(new Set(rows.filter(r => r >= 2))).sort((a, b) => b - a);
    if (!uniqueDesc.length) return 0;
    const sheets = api();
    const gid = await tabGid(tab);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      resource: { requests: uniqueDesc.map(row => ({ deleteDimension: { range: {
        sheetId: gid, dimension: "ROWS", startIndex: row - 1, endIndex: row,
      } } })) },
    });
    return uniqueDesc.length;
  }

  async function writeRange(range, values) {
    await api().spreadsheets.values.update({
      spreadsheetId: sheetId, range, valueInputOption: "RAW", resource: { values },
    });
  }

  async function appendBlock(tab, rows) {
    if (!rows.length) return 0;
    const start = await nextEmptyRow(tab);
    await writeRange(`${tab}!A${start}`, rows);
    return rows.length;
  }

  // ── Setup: create any missing tabs with their header row (one-click onboarding) ──
  async function ensureSetup() {
    const sheets = api();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties(title)" });
    const have = new Set((meta.data.sheets || []).map(s => s.properties.title));
    const toAdd = Object.values(TABS).filter(t => !have.has(t.name));
    if (toAdd.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: { requests: toAdd.map(t => ({ addSheet: { properties: { title: t.name } } })) },
      });
    }
    // (Re)write header rows so columns are always correct.
    for (const t of Object.values(TABS)) {
      await writeRange(`${t.name}!A1`, [t.headers]);
    }
    return { created: toAdd.map(t => t.name) };
  }

  // ── Workers ────────────────────────────────────────────────────────────────
  async function listWorkers() {
    const rows = await readRows(TABS.workers.name);
    return rows.map((r, i) => ({
      row: i + 2,
      telegramId: str(r[0]).trim(),
      name: str(r[1]).trim(),
      phone: str(r[2]).trim(),
      active: isActive(r[3]),
      workerId: str(r[4]).trim(),
    })).filter(w => w.telegramId || w.name || w.phone);
  }
  // Bidirectional phone auto-sync: when a point is loaded before its worker exists, the
  // unresolved phone reference is stored directly in the point's workerId column (see
  // resolveWorker's fallback). Once that worker shows up, re-resolve any point still
  // holding that phone.
  async function relinkPointsForNewWorker(phone, workerId) {
    if (!phone) return 0;
    const points = await listPoints();
    let n = 0;
    for (const p of points) {
      if (p.workerId && p.workerId !== workerId && phonesMatch(p.workerId, phone)) {
        await updatePoint(p.row, { id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, active: p.active, workerId });
        n++;
      }
    }
    return n;
  }

  async function addWorker(f) {
    const row = await nextEmptyRow(TABS.workers.name);
    const workerId = str(f.workerId).trim() || newWorkerId();
    const phone = str(f.phone).trim();
    await writeRange(`${TABS.workers.name}!A${row}`, [[str(f.telegramId).trim(), str(f.name).trim(), phone, f.active === false ? "0" : "1", workerId]]);
    if (phone) await relinkPointsForNewWorker(phone, workerId);
    return { workerId, telegramId: str(f.telegramId).trim(), name: str(f.name).trim(), phone, active: f.active !== false, row };
  }
  async function updateWorker(row, f) {
    const workerId = str(f.workerId).trim() || newWorkerId();
    await writeRange(`${TABS.workers.name}!A${row}:E${row}`, [[str(f.telegramId).trim(), str(f.name).trim(), str(f.phone).trim(), f.active === false ? "0" : "1", workerId]]);
  }
  async function deleteWorker(row) { return deleteRows(TABS.workers.name, [row]); }
  async function appendWorkers(rows) {
    const prepared = rows.map(r => [str(r[0]).trim(), str(r[1]).trim(), str(r[2]).trim(), "1", newWorkerId()]).filter(r => r[0] || r[1] || r[2]);
    const written = await appendBlock(TABS.workers.name, prepared);
    for (const r of prepared) {
      const phone = r[2], workerId = r[4];
      if (phone) await relinkPointsForNewWorker(phone, workerId);
    }
    return written;
  }
  async function findWorkerByPhone(phone) {
    const workers = await listWorkers();
    return workers.find(w => phonesMatch(w.phone, phone)) || null;
  }
  async function findWorkerById(workerId) {
    const workers = await listWorkers();
    const wid = str(workerId).trim();
    return workers.find(w => String(w.workerId) === wid) || null;
  }
  async function linkWorkerTelegram(row, telegramId) {
    await writeRange(`${TABS.workers.name}!A${row}`, [[str(telegramId).trim()]]);
    // Backfill a worker_id if this row predates the column.
    const cur = (await listWorkers()).find(w => w.row === row);
    if (cur && !cur.workerId) await writeRange(`${TABS.workers.name}!E${row}`, [[newWorkerId()]]);
    return true;
  }

  // ── Points ─────────────────────────────────────────────────────────────────
  async function listPoints() {
    const rows = await readRows(TABS.points.name);
    return rows.map((r, i) => ({
      row: i + 2,
      id: str(r[0]).trim(),
      name: str(r[1]).trim(),
      address: str(r[2]).trim(),
      lat: str(r[3]).trim(),
      lng: str(r[4]).trim(),
      geolocated: !!(str(r[3]).trim() && str(r[4]).trim()),
      active: isActive(r[5]),
      workerId: str(r[6]).trim(),
      workerName: str(r[7]).trim(),
    })).filter(p => p.id || p.name || p.address);
  }
  async function listPointsForWorker(workerId) {
    const wid = str(workerId).trim();
    if (!wid) return [];
    return (await listPoints()).filter(p => String(p.workerId) === wid);
  }
  // Clear the assignment on every point that belonged to a worker (used when a worker
  // is deleted). Returns the count of points unassigned.
  async function unassignPointsForWorker(workerId) {
    const wid = str(workerId).trim();
    if (!wid) return 0;
    const pts = (await listPoints()).filter(p => String(p.workerId) === wid);
    for (const p of pts) {
      await updatePoint(p.row, { id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, active: p.active, workerId: "" });
    }
    return pts.length;
  }
  async function ensurePointLocation(pointId, lat, lng) {
    if (!pointId || !lat || !lng) return false;
    const points = await listPoints();
    const p = points.find(x => String(x.id) === String(pointId));
    if (!p || (p.lat && p.lng)) return false;
    await updatePoint(p.row, { id: p.id, name: p.name, address: p.address, lat, lng, active: p.active, workerId: p.workerId });
    return true;
  }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  async function addPoint(f) {
    const row = await nextEmptyRow(TABS.points.name);
    const id = str(f.id).trim() || newId("P");
    const w = await resolveWorker(f.workerId || f.workerPhone || f.worker);
    await writeRange(`${TABS.points.name}!A${row}`, [[id, str(f.name).trim(), str(f.address).trim(), str(f.lat).trim(), str(f.lng).trim(), f.active === false ? "0" : "1", w.workerId, w.workerName]]);
    return id;
  }
  async function updatePoint(row, f) {
    const w = await resolveWorker(f.workerId || f.workerPhone || f.worker);
    await writeRange(`${TABS.points.name}!A${row}:H${row}`, [[str(f.id).trim(), str(f.name).trim(), str(f.address).trim(), str(f.lat).trim(), str(f.lng).trim(), f.active === false ? "0" : "1", w.workerId, w.workerName]]);
  }
  async function deletePoint(row) { return deleteRows(TABS.points.name, [row]); }
  async function appendPoints(rows) {
    const raw = rows.filter(r => str(r[1]).trim() || str(r[2]).trim());
    const prepared = [];
    for (const r of raw) {
      const w = await resolveWorker(r[5]);
      prepared.push([str(r[0]).trim() || newId("P"), str(r[1]).trim(), str(r[2]).trim(), str(r[3]).trim(), str(r[4]).trim(), "1", w.workerId, w.workerName]);
    }
    return appendBlock(TABS.points.name, prepared);
  }

  // ── Visits ─────────────────────────────────────────────────────────────────
  async function listVisits(opts) {
    opts = opts || {};
    const rows = await readRows(TABS.visits.name);
    const visits = rows.map(r => ({
      timestamp: str(r[0]),
      visitId: str(r[1]),
      workerTelegramId: str(r[2]),
      workerName: str(r[3]),
      pointId: str(r[4]),
      pointName: str(r[5]),
      lat: str(r[6]),
      lng: str(r[7]),
      mapsLink: str(r[8]),
      photoCount: parseInt(r[9], 10) || 0,
      photoFileIds: str(r[10]),
      note: str(r[11]),
      workerId: str(r[12]),
      source: "bot",
    })).filter(v => v.timestamp || v.visitId);
    visits.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)); // newest first
    const cap = opts.limit || MAX_ROWS;
    return visits.slice(0, cap);
  }

  // Append one check-in. Called by the bot.
  async function addVisit(v) {
    const row = [
      v.timestamp || new Date().toISOString(),
      v.visitId || newId("V"),
      str(v.workerTelegramId),
      str(v.workerName),
      str(v.pointId),
      str(v.pointName),
      str(v.lat),
      str(v.lng),
      str(v.mapsLink),
      String(v.photoCount || 0),
      Array.isArray(v.photoFileIds) ? v.photoFileIds.join(",") : str(v.photoFileIds),
      str(v.note),
      str(v.workerId),
    ];
    await appendBlock(TABS.visits.name, [row]);
    return row[1]; // visitId
  }

  // PWA photo storage isn't available on the Sheets datasource — use Supabase for that.
  async function uploadPhoto() { throw new Error("PWA photo upload needs the Supabase datasource."); }
  async function getPhoto() { return null; }

  // Settings live in-process for the sheets fallback (not durable across restarts).
  async function getSetting(key, def) { return _settings.has(key) ? _settings.get(key) : (def == null ? "" : def); }
  async function setSetting(key, value) { _settings.set(key, str(value)); }

  return {
    ensureSetup,
    listWorkers, addWorker, updateWorker, deleteWorker, appendWorkers, findWorkerByPhone, findWorkerById, linkWorkerTelegram,
    listPoints, addPoint, updatePoint, deletePoint, appendPoints, ensurePointLocation, listPointsForWorker, unassignPointsForWorker,
    listVisits, addVisit,
    uploadPhoto, getPhoto,
    getSetting, setSetting,
  };
}

module.exports = { makeSheetsSource, TABS };
