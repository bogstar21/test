// Small shared helpers used across datasources and the bot.

// Reduce a phone to comparable digits. Handles +380..., 00380..., spaces, dashes, etc.
function normalizePhone(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

// Tolerant match: exact digits, or one is the other's last-9 suffix (national vs +country).
function phonesMatch(a, b) {
  a = normalizePhone(a);
  b = normalizePhone(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const tail = s => s.slice(-9);
  return tail(a) === tail(b) && tail(a).length === 9;
}

// Local calendar date (YYYY-MM-DD) for a timestamp in a given timezone. "Today" and the
// daily-coverage window must follow the COMPANY's clock, not UTC — otherwise the day rolls
// over at 01:00/02:00 local and evening check-ins count for the wrong day. `ts` may be an
// ISO string, a Date, or empty (= now). Falls back to UTC if the timezone is invalid.
function localDateStr(ts, tz) {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d.getTime())) return "";
  try {
    // en-CA renders as YYYY-MM-DD, which sorts and compares correctly.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// Does a visit belong to this worker? Prefer the STABLE workerId; fall back to the Telegram
// id only for visits written before workerId was stored. Keying on telegramId alone breaks
// attribution for PWA-only workers (no Telegram → empty id → everyone shares one bucket).
function visitBelongsToWorker(visit, worker) {
  if (!visit || !worker) return false;
  const vWid = String(visit.workerId || "").trim();
  if (vWid) return vWid === String(worker.workerId || "").trim();
  const vTid = String(visit.workerTelegramId || "").trim();
  return !!vTid && vTid === String(worker.telegramId || "").trim();
}

// Great-circle distance in metres between two lat/lng pairs (Haversine).
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius (m)
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Geofence gate for a check-in. Returns { ok, distance? }.
// - Disabled (meters <= 0) → always ok.
// - A point with NO stored coordinates yet (first check-in) → ok; that visit sets them.
// - Otherwise ok only if the check-in is within `meters` of the point's coordinates.
function geofenceOk(point, lat, lng, meters) {
  if (!meters || meters <= 0) return { ok: true };
  if (!point || !point.geolocated) return { ok: true };
  const pLat = parseFloat(point.lat), pLng = parseFloat(point.lng);
  const cLat = parseFloat(lat),       cLng = parseFloat(lng);
  if (![pLat, pLng, cLat, cLng].every(Number.isFinite)) return { ok: true };
  const dist = haversineMeters(pLat, pLng, cLat, cLng);
  return { ok: dist <= meters, distance: Math.round(dist) };
}

module.exports = {
  normalizePhone, phonesMatch,
  localDateStr, visitBelongsToWorker, haversineMeters, geofenceOk,
};
