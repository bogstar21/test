// In-memory datasource — the "connected to nothing" MVP store.
//
// Implements exactly the same interface as datasource/sheets.js, but keeps everything
// in RAM with a little seed data. No Google, no credentials, no network. Data resets
// on every restart — that's fine for the MVP: it lets the whole platform run with
// `npm install && npm start` and zero configuration.
//
// When you're ready to persist for real, flip the tenant's `source` back to "sheets"
// (or add "api"/"postgres"): nothing else in the routes or the bot changes.

const { phonesMatch } = require("../util");

function isActive(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "ні");
}
function str(v) { return v == null ? "" : String(v); }
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// One store per tenant id, so multi-tenant already works in memory too.
const _stores = new Map();

function seed() {
  // `row` mimics the spreadsheet row handle the routes use (>= 2). Rows are stable
  // per item for the life of the process.
  return {
    // Rows are a single shared handle across workers + points (mimicking a sheet row).
    // Seeded rows use 2..4, so appended items must start at 5 to avoid colliding with a
    // seeded worker/point row (a collision would make row-based lookups ambiguous).
    nextRow: 5,
    settings: {},
    photos: new Map(), // ref → { buffer, contentType } for PWA check-in photos
    workers: [
      { row: 2, workerId: "W1", telegramId: "100000001", name: "Ivan Petrenko", phone: "+380671112233", active: true },
      { row: 3, workerId: "W2", telegramId: "100000002", name: "Olena Kovalenko", phone: "+380677654321", active: true },
    ],
    points: [
      { row: 2, id: "P1", name: "Silpo Khreshchatyk", address: "Khreshchatyk St 15, Kyiv", workerId: "W1", workerName: "Ivan Petrenko",   lat: "50.4471", lng: "30.5219", geolocated: true, active: true },
      { row: 3, id: "P2", name: "ATB Podil",           address: "Verkhnii Val St 24, Kyiv", workerId: "W2", workerName: "Olena Kovalenko", lat: "50.4655", lng: "30.5145", geolocated: true, active: true },
      { row: 4, id: "P3", name: "Novus Lukyanivka",    address: "Sichovykh Striltsiv St 103, Kyiv", workerId: "W1", workerName: "Ivan Petrenko", lat: "", lng: "", geolocated: false, active: true },
    ],
    visits: [
      { timestamp: new Date(Date.now() - 3600e3).toISOString(), visitId: "V1", workerId: "W1", workerTelegramId: "100000001", workerName: "Ivan Petrenko", pointId: "P1", pointName: "Silpo Khreshchatyk", lat: "50.4471", lng: "30.5219", mapsLink: "https://www.google.com/maps?q=50.4471,30.5219", photoCount: 2, photoFileIds: "", source: "bot", note: "" },
      { timestamp: new Date(Date.now() - 1800e3).toISOString(), visitId: "V2", workerId: "W2", workerTelegramId: "100000002", workerName: "Olena Kovalenko", pointId: "P2", pointName: "ATB Podil", lat: "50.4655", lng: "30.5145", mapsLink: "https://www.google.com/maps?q=50.4655,30.5145", photoCount: 1, photoFileIds: "", source: "bot", note: "" },
    ],
  };
}

function storeFor(id) {
  if (!_stores.has(id)) _stores.set(id, seed());
  return _stores.get(id);
}

function makeMemorySource(tenantId) {
  const db = storeFor(tenantId || "default");
  const takeRow = () => db.nextRow++;
  const newWorkerId = () => newId("w");

  // Resolve a worker reference (phone OR internal worker_id) to { workerId, workerName }.
  // Used when assigning a point to a worker (manual add, import, connector). Empty ref
  // (or no match) → unassigned point.
  function resolveWorker(ref) {
    const r = str(ref).trim();
    if (!r) return { workerId: "", workerName: "" };
    const w = db.workers.find(x =>
      (x.workerId && String(x.workerId) === r) || phonesMatch(x.phone, r));
    return w ? { workerId: w.workerId, workerName: w.name } : { workerId: r, workerName: "" };
  }

  // Setup is a no-op for memory (nothing to create), but we keep the method so the
  // "Set up sheet" button in the UI still succeeds.
  async function ensureSetup() { return { created: [] }; }

  // ── Workers ──────────────────────────────────────────────────────────────────
  async function listWorkers() {
    return db.workers.map(w => ({ ...w }));
  }
  async function addWorker(f) {
    const w = {
      row: takeRow(),
      workerId: str(f.workerId).trim() || newWorkerId(),
      telegramId: str(f.telegramId).trim(),
      name: str(f.name).trim(),
      phone: str(f.phone).trim(),
      active: f.active !== false,
    };
    db.workers.push(w);
    return { ...w };
  }
  async function updateWorker(row, f) {
    const w = db.workers.find(x => x.row === row);
    if (!w) return;
    if (!w.workerId) w.workerId = newWorkerId();
    w.telegramId = str(f.telegramId).trim();
    w.name = str(f.name).trim();
    w.phone = str(f.phone).trim();
    w.active = f.active !== false;
  }
  async function deleteWorker(row) {
    const i = db.workers.findIndex(x => x.row === row);
    if (i >= 0) db.workers.splice(i, 1);
    return i >= 0 ? 1 : 0;
  }
  async function appendWorkers(rows) {
    let n = 0;
    for (const r of rows) {
      const telegramId = str(r[0]).trim(), name = str(r[1]).trim(), phone = str(r[2]).trim();
      if (!telegramId && !name && !phone) continue;
      db.workers.push({ row: takeRow(), workerId: newWorkerId(), telegramId, name, phone, active: true });
      n++;
    }
    return n;
  }

  // ── Points ───────────────────────────────────────────────────────────────────
  async function listPoints() {
    return db.points.map(p => ({ ...p }));
  }
  async function addPoint(f) {
    const id = str(f.id).trim() || newId("P");
    const lat = str(f.lat).trim(), lng = str(f.lng).trim();
    const w = resolveWorker(f.workerId || f.workerPhone || f.worker);
    db.points.push({
      row: takeRow(), id,
      name: str(f.name).trim(),
      address: str(f.address).trim(),
      workerId: w.workerId, workerName: w.workerName,
      lat, lng,
      geolocated: !!(lat && lng),
      active: f.active !== false,
    });
    return id;
  }
  async function updatePoint(row, f) {
    const p = db.points.find(x => x.row === row);
    if (!p) return;
    p.id = str(f.id).trim() || p.id;
    p.name = str(f.name).trim();
    p.address = str(f.address).trim();
    // Only reassign when a worker reference is supplied (keeps existing assignment otherwise).
    const ref = f.workerId != null ? f.workerId : (f.workerPhone != null ? f.workerPhone : f.worker);
    if (ref != null && str(ref).trim() !== "") {
      const w = resolveWorker(ref);
      p.workerId = w.workerId; p.workerName = w.workerName;
    } else if (ref != null) {
      p.workerId = ""; p.workerName = "";   // explicit empty = unassign
    }
    p.lat = str(f.lat).trim();
    p.lng = str(f.lng).trim();
    p.geolocated = !!(p.lat && p.lng);
    p.active = f.active !== false;
  }
  async function deletePoint(row) {
    const i = db.points.findIndex(x => x.row === row);
    if (i >= 0) db.points.splice(i, 1);
    return i >= 0 ? 1 : 0;
  }
  // Row layout: [id, name, address, lat, lng, workerRef]. workerRef is a phone or a
  // worker_id; it's resolved to the point's assigned worker.
  async function appendPoints(rows) {
    let n = 0;
    for (const r of rows) {
      const name = str(r[1]).trim(), address = str(r[2]).trim();
      if (!name && !address) continue;
      const lat = str(r[3]).trim(), lng = str(r[4]).trim();
      const w = resolveWorker(r[5]);
      db.points.push({
        row: takeRow(),
        id: str(r[0]).trim() || newId("P"),
        name, address,
        workerId: w.workerId, workerName: w.workerName,
        lat, lng,
        geolocated: !!(lat && lng),
        active: true,
      });
      n++;
    }
    return n;
  }

  // Points assigned to a single worker (used by bot /route and the PWA check-in list).
  async function listPointsForWorker(workerId) {
    const wid = str(workerId).trim();
    if (!wid) return [];
    return db.points.filter(p => String(p.workerId) === wid).map(p => ({ ...p }));
  }

  // Clear the assignment on every point that belonged to a worker (used when a worker
  // is deleted, so their points don't point at a ghost worker_id). Returns the count.
  async function unassignPointsForWorker(workerId) {
    const wid = str(workerId).trim();
    if (!wid) return 0;
    let n = 0;
    for (const p of db.points) {
      if (String(p.workerId) === wid) { p.workerId = ""; p.workerName = ""; n++; }
    }
    return n;
  }

  // Set a point's coords the first time it's checked in (only if still empty).
  async function ensurePointLocation(pointId, lat, lng) {
    if (!pointId || !lat || !lng) return false;
    const p = db.points.find(x => String(x.id) === String(pointId));
    if (!p || (p.lat && p.lng)) return false;
    p.lat = str(lat); p.lng = str(lng); p.geolocated = true;
    return true;
  }

  // Registration (holodBot-style): find a worker by phone, then link their Telegram id.
  async function findWorkerByPhone(phone) {
    return db.workers.find(w => phonesMatch(w.phone, phone)) || null;
  }
  async function findWorkerById(workerId) {
    const wid = str(workerId).trim();
    return db.workers.find(w => String(w.workerId) === wid) || null;
  }
  async function linkWorkerTelegram(row, telegramId) {
    const w = db.workers.find(x => x.row === row);
    if (!w) return false;
    if (!w.workerId) w.workerId = newWorkerId();
    w.telegramId = str(telegramId).trim();
    return true;
  }

  // ── Visits ───────────────────────────────────────────────────────────────────
  async function listVisits(opts) {
    opts = opts || {};
    const visits = db.visits
      .map(v => ({ ...v }))
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    return visits.slice(0, opts.limit || 5000);
  }
  async function addVisit(v) {
    const visitId = v.visitId || newId("V");
    db.visits.push({
      timestamp: v.timestamp || new Date().toISOString(),
      visitId,
      workerId: str(v.workerId),
      workerTelegramId: str(v.workerTelegramId),
      workerName: str(v.workerName),
      pointId: str(v.pointId),
      pointName: str(v.pointName),
      lat: str(v.lat),
      lng: str(v.lng),
      mapsLink: str(v.mapsLink),
      photoCount: Number(v.photoCount) || 0,
      photoFileIds: Array.isArray(v.photoFileIds) ? v.photoFileIds.join(",") : str(v.photoFileIds),
      source: str(v.source) || "bot",
      note: str(v.note),
    });
    return visitId;
  }

  // ── Photos (PWA uploads) ───────────────────────────────────────────────────────
  async function uploadPhoto(buffer, contentType) {
    const ref = newId("ph") + ".jpg";
    db.photos.set(ref, { buffer, contentType: contentType || "image/jpeg" });
    return ref;
  }
  async function getPhoto(ref) {
    return db.photos.get(ref) || null;
  }

  // ── Settings (key/value) ───────────────────────────────────────────────────────
  async function getSetting(key, def) {
    return Object.prototype.hasOwnProperty.call(db.settings, key) ? db.settings[key] : (def == null ? "" : def);
  }
  async function setSetting(key, value) { db.settings[key] = str(value); }

  return {
    ensureSetup,
    listWorkers, addWorker, updateWorker, deleteWorker, appendWorkers, findWorkerByPhone, findWorkerById, linkWorkerTelegram,
    listPoints, addPoint, updatePoint, deletePoint, appendPoints, ensurePointLocation, listPointsForWorker, unassignPointsForWorker,
    listVisits, addVisit,
    uploadPhoto, getPhoto,
    getSetting, setSetting,
  };
}

module.exports = { makeMemorySource };
