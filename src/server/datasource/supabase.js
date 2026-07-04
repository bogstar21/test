// Supabase datasource — persistent store over Supabase (Postgres + REST API).
//
// Implements EXACTLY the same interface as datasource/memory.js and datasource/sheets.js,
// so nothing in the routes or the bot changes: flip a tenant's `source` to "supabase"
// (env DATASOURCE=supabase) and the whole platform now persists to your Supabase project.
// This is also the "connect via API" path — supabase-js talks to Supabase's REST layer.
//
// Tables (create them with supabase/schema.sql):
//   starx_workers : pk · telegram_id · name · phone · active
//   starx_points  : pk · id · name · address · lat · lng · active
//   starx_visits  : pk · timestamp · visit_id · worker_telegram_id · worker_name ·
//                   point_id · point_name · lat · lng · maps_link · photo_count ·
//                   photo_file_ids · note
//
// `pk` is a bigint identity starting at 2 — it maps to the `row` handle the routes use
// (the CRUD routes validate row >= 2, a convention inherited from the Sheets store).
const { getSupabase } = require("../supabaseClient");
const { phonesMatch } = require("../util");

const T_WORKERS  = "starx_workers";
const T_POINTS   = "starx_points";
const T_VISITS   = "starx_visits";
const T_SETTINGS = "starx_settings";
const BUCKET     = "visit-photos";
const MAX_ROWS   = 5000;

function str(v) { return v == null ? "" : String(v); }
function isActive(v) {
  if (typeof v === "boolean") return v;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "ні");
}
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function ok(error) { if (error) throw new Error(error.message || String(error)); }

function makeSupabaseSource(tenant) {
  const db = getSupabase;
  const tenantId = (tenant && tenant.id) || "default";

  // Tables are created out-of-band via supabase/schema.sql, so setup is a no-op here.
  // Kept so the "Set up" button in the UI still resolves.
  async function ensureSetup() { return { created: [] }; }

  const newWorkerId = () => newId("w");

  // Resolve a worker reference (phone OR internal worker_id) to { workerId, workerName }.
  async function resolveWorker(ref) {
    const r = str(ref).trim();
    if (!r) return { workerId: "", workerName: "" };
    const workers = await listWorkers();
    const w = workers.find(x =>
      (x.workerId && String(x.workerId) === r) || phonesMatch(x.phone, r));
    return w ? { workerId: w.workerId, workerName: w.name } : { workerId: r, workerName: "" };
  }

  // ── Workers ──────────────────────────────────────────────────────────────────
  async function listWorkers() {
    const { data, error } = await db().from(T_WORKERS).select("*").order("pk", { ascending: true });
    ok(error);
    return (data || []).map(r => ({
      row: r.pk,
      workerId: str(r.worker_id).trim(),
      telegramId: str(r.telegram_id).trim(),
      name: str(r.name).trim(),
      phone: str(r.phone).trim(),
      active: isActive(r.active),
    }));
  }
  async function addWorker(f) {
    const workerId = str(f.workerId).trim() || newWorkerId();
    const { error } = await db().from(T_WORKERS).insert({
      tenant_id: tenantId,
      worker_id: workerId,
      telegram_id: str(f.telegramId).trim(),
      name: str(f.name).trim(),
      phone: str(f.phone).trim(),
      active: f.active !== false,
    });
    ok(error);
    return { workerId, telegramId: str(f.telegramId).trim(), name: str(f.name).trim(), phone: str(f.phone).trim(), active: f.active !== false };
  }
  async function updateWorker(row, f) {
    const patch = {
      telegram_id: str(f.telegramId).trim(),
      name: str(f.name).trim(),
      phone: str(f.phone).trim(),
      active: f.active !== false,
    };
    if (str(f.workerId).trim()) patch.worker_id = str(f.workerId).trim();
    const { error } = await db().from(T_WORKERS).update(patch).eq("pk", row);
    ok(error);
  }
  async function deleteWorker(row) {
    const { error, count } = await db().from(T_WORKERS).delete({ count: "exact" }).eq("pk", row);
    ok(error);
    return count || 0;
  }
  async function appendWorkers(rows) {
    const payload = (rows || []).map(r => ({
      tenant_id: tenantId,
      worker_id: newWorkerId(),
      telegram_id: str(r[0]).trim(),
      name: str(r[1]).trim(),
      phone: str(r[2]).trim(),
      active: true,
    })).filter(r => r.telegram_id || r.name || r.phone);
    if (!payload.length) return 0;
    const { error } = await db().from(T_WORKERS).insert(payload);
    ok(error);
    return payload.length;
  }

  // Registration (holodBot-style): find a worker by phone, then link their Telegram id.
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
    const patch = { telegram_id: str(telegramId).trim() };
    // Backfill a worker_id if this row predates the column.
    const { data } = await db().from(T_WORKERS).select("worker_id").eq("pk", row).limit(1);
    if (!(data && data[0] && str(data[0].worker_id).trim())) patch.worker_id = newWorkerId();
    const { error } = await db().from(T_WORKERS).update(patch).eq("pk", row);
    ok(error);
    return true;
  }

  // ── Points ───────────────────────────────────────────────────────────────────
  async function listPoints() {
    const { data, error } = await db().from(T_POINTS).select("*").order("pk", { ascending: true });
    ok(error);
    return (data || []).map(r => ({
      row: r.pk,
      id: str(r.id).trim(),
      name: str(r.name).trim(),
      address: str(r.address).trim(),
      workerId: str(r.worker_id).trim(),
      workerName: str(r.worker_name).trim(),
      lat: str(r.lat).trim(),
      lng: str(r.lng).trim(),
      geolocated: r.geolocated === true || !!(str(r.lat).trim() && str(r.lng).trim()),
      active: isActive(r.active),
    }));
  }
  async function listPointsForWorker(workerId) {
    const wid = str(workerId).trim();
    if (!wid) return [];
    const all = await listPoints();
    return all.filter(p => String(p.workerId) === wid);
  }
  async function addPoint(f) {
    const id = str(f.id).trim() || newId("P");
    const lat = str(f.lat).trim(), lng = str(f.lng).trim();
    const w = await resolveWorker(f.workerId || f.workerPhone || f.worker);
    const { error } = await db().from(T_POINTS).insert({
      tenant_id: tenantId,
      id,
      name: str(f.name).trim(),
      address: str(f.address).trim(),
      worker_id: w.workerId, worker_name: w.workerName,
      lat, lng,
      geolocated: !!(lat && lng),
      active: f.active !== false,
    });
    ok(error);
    return id;
  }
  async function updatePoint(row, f) {
    const lat = str(f.lat).trim(), lng = str(f.lng).trim();
    const patch = {
      name: str(f.name).trim(),
      address: str(f.address).trim(),
      lat, lng,
      geolocated: !!(lat && lng),
      active: f.active !== false,
    };
    if (str(f.id).trim()) patch.id = str(f.id).trim();
    // Reassign only when a worker reference is supplied.
    const ref = f.workerId != null ? f.workerId : (f.workerPhone != null ? f.workerPhone : f.worker);
    if (ref != null && str(ref).trim() !== "") {
      const w = await resolveWorker(ref);
      patch.worker_id = w.workerId; patch.worker_name = w.workerName;
    } else if (ref != null) {
      patch.worker_id = ""; patch.worker_name = "";
    }
    const { error } = await db().from(T_POINTS).update(patch).eq("pk", row);
    ok(error);
  }
  // Clear the assignment on every point that belonged to a worker (used when a worker
  // is deleted). Returns 1 on success (Supabase doesn't return an affected-row count here).
  async function unassignPointsForWorker(workerId) {
    const wid = str(workerId).trim();
    if (!wid) return 0;
    const { error } = await db().from(T_POINTS)
      .update({ worker_id: "", worker_name: "" })
      .eq("tenant_id", tenantId).eq("worker_id", wid);
    ok(error);
    return 1;
  }

  // Set a point's coords the first time it's checked in (only if still empty).
  async function ensurePointLocation(pointId, lat, lng) {
    if (!pointId || !lat || !lng) return false;
    const { data, error } = await db().from(T_POINTS).select("pk,lat,lng").eq("id", pointId).limit(1);
    ok(error);
    const p = (data || [])[0];
    if (!p || (str(p.lat).trim() && str(p.lng).trim())) return false;
    const { error: uerr } = await db().from(T_POINTS)
      .update({ lat: str(lat), lng: str(lng), geolocated: true }).eq("pk", p.pk);
    ok(uerr);
    return true;
  }
  async function deletePoint(row) {
    const { error, count } = await db().from(T_POINTS).delete({ count: "exact" }).eq("pk", row);
    ok(error);
    return count || 0;
  }
  // Row layout: [id, name, address, lat, lng, workerRef]. workerRef (phone or worker_id)
  // resolves to the point's assigned worker.
  async function appendPoints(rows) {
    const raw = (rows || []).filter(r => str(r[1]).trim() || str(r[2]).trim());
    const payload = [];
    for (const r of raw) {
      const lat = str(r[3]).trim(), lng = str(r[4]).trim();
      const w = await resolveWorker(r[5]);
      payload.push({
        tenant_id: tenantId,
        id: str(r[0]).trim() || newId("P"),
        name: str(r[1]).trim(),
        address: str(r[2]).trim(),
        worker_id: w.workerId, worker_name: w.workerName,
        lat, lng,
        geolocated: !!(lat && lng),
        active: true,
      });
    }
    if (!payload.length) return 0;
    const { error } = await db().from(T_POINTS).insert(payload);
    ok(error);
    return payload.length;
  }

  // ── Visits ───────────────────────────────────────────────────────────────────
  async function listVisits(opts) {
    opts = opts || {};
    const limit = Math.min(opts.limit || MAX_ROWS, MAX_ROWS);
    const { data, error } = await db().from(T_VISITS)
      .select("*").order("timestamp", { ascending: false }).limit(limit);
    ok(error);
    return (data || []).map(r => ({
      timestamp: str(r.timestamp),
      visitId: str(r.visit_id),
      workerTelegramId: str(r.worker_telegram_id),
      workerName: str(r.worker_name),
      pointId: str(r.point_id),
      pointName: str(r.point_name),
      lat: str(r.lat),
      lng: str(r.lng),
      mapsLink: str(r.maps_link),
      photoCount: Number(r.photo_count) || 0,
      photoFileIds: str(r.photo_file_ids),
      source: str(r.source) || "bot",
      note: str(r.note),
    }));
  }
  async function addVisit(v) {
    const visitId = v.visitId || newId("V");
    const { error } = await db().from(T_VISITS).insert({
      tenant_id: tenantId,
      timestamp: v.timestamp || new Date().toISOString(),
      visit_id: visitId,
      worker_telegram_id: str(v.workerTelegramId),
      worker_name: str(v.workerName),
      point_id: str(v.pointId),
      point_name: str(v.pointName),
      lat: str(v.lat),
      lng: str(v.lng),
      maps_link: str(v.mapsLink),
      photo_count: Number(v.photoCount) || 0,
      photo_file_ids: Array.isArray(v.photoFileIds) ? v.photoFileIds.join(",") : str(v.photoFileIds),
      source: str(v.source) || "bot",
      note: str(v.note),
    });
    ok(error);
    return visitId;
  }

  // ── Photos (PWA uploads → Storage bucket) ──────────────────────────────────────
  async function uploadPhoto(buffer, contentType) {
    const ref = `${tenantId}/${newId("ph")}.jpg`;
    const { error } = await db().storage.from(BUCKET).upload(ref, buffer, {
      contentType: contentType || "image/jpeg", upsert: false,
    });
    ok(error);
    return ref;
  }
  async function getPhoto(ref) {
    const { data, error } = await db().storage.from(BUCKET).download(ref);
    if (error) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    return { buffer, contentType: data.type || "image/jpeg" };
  }

  // ── Settings (key/value per tenant) ────────────────────────────────────────────
  async function getSetting(key, def) {
    const { data, error } = await db().from(T_SETTINGS)
      .select("value").eq("tenant_id", tenantId).eq("key", key).limit(1);
    ok(error);
    const row = (data || [])[0];
    return row ? str(row.value) : (def == null ? "" : def);
  }
  async function setSetting(key, value) {
    const { error } = await db().from(T_SETTINGS)
      .upsert({ tenant_id: tenantId, key, value: str(value), updated_at: new Date().toISOString() },
              { onConflict: "tenant_id,key" });
    ok(error);
  }

  return {
    ensureSetup,
    listWorkers, addWorker, updateWorker, deleteWorker, appendWorkers, findWorkerByPhone, findWorkerById, linkWorkerTelegram,
    listPoints, addPoint, updatePoint, deletePoint, appendPoints, ensurePointLocation, listPointsForWorker, unassignPointsForWorker,
    listVisits, addVisit,
    uploadPhoto, getPhoto,
    getSetting, setSetting,
  };
}

module.exports = { makeSupabaseSource };
