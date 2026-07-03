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

const T_WORKERS = "starx_workers";
const T_POINTS  = "starx_points";
const T_VISITS  = "starx_visits";
const MAX_ROWS  = 5000;

function str(v) { return v == null ? "" : String(v); }
function isActive(v) {
  if (typeof v === "boolean") return v;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "ні");
}
function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function ok(error) { if (error) throw new Error(error.message || String(error)); }

function makeSupabaseSource(/* tenant */) {
  const db = getSupabase;

  // Tables are created out-of-band via supabase/schema.sql, so setup is a no-op here.
  // Kept so the "Set up" button in the UI still resolves.
  async function ensureSetup() { return { created: [] }; }

  // ── Workers ──────────────────────────────────────────────────────────────────
  async function listWorkers() {
    const { data, error } = await db().from(T_WORKERS).select("*").order("pk", { ascending: true });
    ok(error);
    return (data || []).map(r => ({
      row: r.pk,
      telegramId: str(r.telegram_id).trim(),
      name: str(r.name).trim(),
      phone: str(r.phone).trim(),
      active: isActive(r.active),
    }));
  }
  async function addWorker(f) {
    const { error } = await db().from(T_WORKERS).insert({
      telegram_id: str(f.telegramId).trim(),
      name: str(f.name).trim(),
      phone: str(f.phone).trim(),
      active: f.active !== false,
    });
    ok(error);
  }
  async function updateWorker(row, f) {
    const { error } = await db().from(T_WORKERS).update({
      telegram_id: str(f.telegramId).trim(),
      name: str(f.name).trim(),
      phone: str(f.phone).trim(),
      active: f.active !== false,
    }).eq("pk", row);
    ok(error);
  }
  async function deleteWorker(row) {
    const { error, count } = await db().from(T_WORKERS).delete({ count: "exact" }).eq("pk", row);
    ok(error);
    return count || 0;
  }
  async function appendWorkers(rows) {
    const payload = (rows || []).map(r => ({
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

  // ── Points ───────────────────────────────────────────────────────────────────
  async function listPoints() {
    const { data, error } = await db().from(T_POINTS).select("*").order("pk", { ascending: true });
    ok(error);
    return (data || []).map(r => ({
      row: r.pk,
      id: str(r.id).trim(),
      name: str(r.name).trim(),
      address: str(r.address).trim(),
      lat: str(r.lat).trim(),
      lng: str(r.lng).trim(),
      active: isActive(r.active),
    }));
  }
  async function addPoint(f) {
    const id = str(f.id).trim() || newId("P");
    const { error } = await db().from(T_POINTS).insert({
      id,
      name: str(f.name).trim(),
      address: str(f.address).trim(),
      lat: str(f.lat).trim(),
      lng: str(f.lng).trim(),
      active: f.active !== false,
    });
    ok(error);
    return id;
  }
  async function updatePoint(row, f) {
    const patch = {
      name: str(f.name).trim(),
      address: str(f.address).trim(),
      lat: str(f.lat).trim(),
      lng: str(f.lng).trim(),
      active: f.active !== false,
    };
    if (str(f.id).trim()) patch.id = str(f.id).trim();
    const { error } = await db().from(T_POINTS).update(patch).eq("pk", row);
    ok(error);
  }
  async function deletePoint(row) {
    const { error, count } = await db().from(T_POINTS).delete({ count: "exact" }).eq("pk", row);
    ok(error);
    return count || 0;
  }
  async function appendPoints(rows) {
    const payload = (rows || []).map(r => ({
      id: str(r[0]).trim() || newId("P"),
      name: str(r[1]).trim(),
      address: str(r[2]).trim(),
      lat: str(r[3]).trim(),
      lng: str(r[4]).trim(),
      active: true,
    })).filter(r => r.name || r.address);
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
      note: str(r.note),
    }));
  }
  async function addVisit(v) {
    const visitId = v.visitId || newId("V");
    const { error } = await db().from(T_VISITS).insert({
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
      note: str(v.note),
    });
    ok(error);
    return visitId;
  }

  return {
    ensureSetup,
    listWorkers, addWorker, updateWorker, deleteWorker, appendWorkers,
    listPoints, addPoint, updatePoint, deletePoint, appendPoints,
    listVisits, addVisit,
  };
}

module.exports = { makeSupabaseSource };
