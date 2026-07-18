// Central config: paths, the multi-company "tenant" seam, and auth settings.
// Everything env-driven so nothing secret is committed.
const path    = require("path");
const crypto  = require("crypto");
const tenants = require("./tenants");

// This file is <root>/src/server/config.js → project root is two levels up.
const ROOT_DIR   = path.join(__dirname, "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const PORT = process.env.PORT || 3000;
const PLATFORM_URL = process.env.PLATFORM_URL || "";

// Company timezone for "today" / daily-coverage math (IANA name, e.g. "Europe/Madrid",
// "Europe/Kyiv"). Defaults to Europe/Madrid; override with the TIMEZONE env var. Server
// clocks run in UTC (e.g. on Railway), so this is what makes the day boundary correct.
const TIMEZONE = process.env.TIMEZONE || "Europe/Madrid";

// Geofence radius in metres for check-ins. 0 (default) = disabled. When > 0, a check-in
// is rejected if it's farther than this from the point's known coordinates. The FIRST
// check-in at a point (no coords yet) is always accepted — it sets the location.
const GEOFENCE_METERS = parseInt(process.env.GEOFENCE_METERS || "0", 10) || 0;

// ─── Tenants (one company = one login + one datasource) ────────────────────────
// Tenants now live in the platform registry (src/server/tenants.js): the env-configured
// default plus any companies stored in the `starx_tenants` table. These delegate to it but
// keep a SYNCHRONOUS signature so routes/bot stay unchanged.
function getTenant(req)   { return tenants.get(req); }
function defaultTenant()  { return tenants.defaultTenant(); }
function allTenants()     { return tenants.all(); }

// ─── Auth ──────────────────────────────────────────────────────────────────────
// Cookie-signing key. Auto-generated if not set, so the platform boots with zero env.
// A generated key changes on each restart → sessions reset; set SESSION_SECRET in env
// to keep sessions across restarts.
const SESSION_SECRET   = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE   = "starx_session";
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || "30", 10);
const SESSION_TTL_MS   = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

// Trusted-IP bypass: requests from these exact IPs are treated as an authenticated
// admin (default tenant) WITHOUT a login. Comma-separated, exact match. Empty = off.
const TRUSTED_IPS = (process.env.TRUSTED_IPS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
function isTrustedIp(req) {
  if (!TRUSTED_IPS.length || !req) return false;
  const ip = String(req.ip || "").replace(/^::ffff:/, "");
  return TRUSTED_IPS.includes(ip);
}

const PLATFORM_PASSWORD = process.env.PLATFORM_PASSWORD || "";

// Secure cookies require HTTPS. Off by default so the MVP works on http://localhost;
// set COOKIE_SECURE=true when deploying behind HTTPS (e.g. Railway).
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

module.exports = {
  ROOT_DIR, PUBLIC_DIR, PORT, PLATFORM_URL, TIMEZONE, GEOFENCE_METERS,
  getTenant, defaultTenant, allTenants, tenants,
  SESSION_SECRET, SESSION_COOKIE, SESSION_TTL_MS, SESSION_TTL_DAYS, PLATFORM_PASSWORD,
  TRUSTED_IPS, isTrustedIp, COOKIE_SECURE,
};
