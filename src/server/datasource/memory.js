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
    nextRow: 2,
    settings: {},
    photos: new Map(), // ref → { buffer, contentType } for PWA check-in photos
    workers: [
      { row: 2, telegramId: "100000001", name: "Ivan Petrenko", phone: "+380671112233", active: true },
      { row: 3, telegramId: "100000002", name: "Olena Kovalenko", phone: "+380677654321", active: true },
    ],
    points: [
      { row: 2, id: "P1", name: "Silpo Khreshchatyk", address: "Khreshchatyk St 15, Kyiv", lat: "50.4471", lng: "30.5219", geolocated: true, active: true },
      { row: 3, id: "P2", name: "ATB Podil",           address: "Verkhnii Val St 24, Kyiv", lat: "50.4655", lng: "30.5145", geolocated: true, active: true },
      { row: 4, id: "P3", name: "Novus Lukyanivka",    address: "Sichovykh Striltsiv St 103, Kyiv", lat: "", lng: "", geolocated: false, active: true },
    ],
    visits: [
      { timestamp: new Date(Date.now() - 3600e3).toISOString(), visitId: "V1", workerTelegramId: "100000001", workerName: "Ivan Petrenko", pointId: "P1", pointName: "Silpo Khreshchatyk", lat: "50.4471", lng: "30.5219", mapsLink: "https://www.google.com/maps?q=50.4471,30.5219", photoCount: 2, photoFileIds: "", source: "bot", note: "" },
      { timestamp: new Date(Date.now() - 1800e3).toISOString(), visitId: "V2", workerTelegramId: "100000002", workerName: "Olena Kovalenko", pointId: "P2", pointName: "ATB Podil", lat: "50.4655", lng: "30.5145", mapsLink: "https://www.google.com/maps?q=50.4655,30.5145", photoCount: 1, photoFileIds: "", source: "bot", note: "" },
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

  // Setup is a no-op for memory (nothing to create), but we keep the method so the
  // "Set up sheet" button in the UI still succeeds.
  async function ensureSetup() { return { created: [] }; }

  // ── Workers ──────────────────────────────────────────────────────────────────
  async function listWorkers() {
    return db.workers.map(w => ({ ...w }));
  }
  async function addWorker(f) {
    db.workers.push({
      row: takeRow(),
      telegramId: str(f.telegramId).trim(),
      name: str(f.name).trim(),
      phone: str(f.phone).trim(),
      active: f.active !== false,
    });
  }
  async function updateWorker(row, f) {
    const w = db.workers.find(x => x.row === row);
    if (!w) return;
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
      db.workers.push({ row: takeRow(), telegramId, name, phone, active: true });
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
    db.points.push({
      row: takeRow(), id,
      name: str(f.name).trim(),
      address: str(f.address).trim(),
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
  async function appendPoints(rows) {
    let n = 0;
    for (const r of rows) {
      const name = str(r[1]).trim(), address = str(r[2]).trim();
      if (!name && !address) continue;
      const lat = str(r[3]).trim(), lng = str(r[4]).trim();
      db.points.push({
        row: takeRow(),
        id: str(r[0]).trim() || newId("P"),
        name, address,
        lat, lng,
        geolocated: !!(lat && lng),
        active: true,
      });
      n++;
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
  async function linkWorkerTelegram(row, telegramId) {
    const w = db.workers.find(x => x.row === row);
    if (!w) return false;
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
    listWorkers, addWorker, updateWorker, deleteWorker, appendWorkers, findWorkerByPhone, linkWorkerTelegram,
    listPoints, addPoint, updatePoint, deletePoint, appendPoints, ensurePointLocation,
    listVisits, addVisit,
    uploadPhoto, getPhoto,
    getSetting, setSetting,
  };
}

module.exports = { makeMemorySource };
