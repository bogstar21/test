// Central config: paths, the multi-company "tenant" seam, and auth settings.
// Everything env-driven so nothing secret is committed.
const path   = require("path");
const crypto = require("crypto");

// This file is <root>/src/server/config.js → project root is two levels up.
const ROOT_DIR   = path.join(__dirname, "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const PORT = process.env.PORT || 3000;
const PLATFORM_URL = process.env.PLATFORM_URL || "";

// ─── Tenants (one company = one login + one datasource) ────────────────────────
// Each tenant has its OWN password and its OWN data. `source` selects the datasource
// implementation (see src/server/datasource/index.js): "sheets" now; "api" later.
// Adding a company = adding an entry here. Nothing is hardcoded in the routes.
const TENANTS = [
  {
    id:       "default",
    name:     process.env.TENANT_NAME || "StarX Demo",
    source:   "sheets",
    sheetId:  process.env.SHEET_ID || "",
    password: process.env.PLATFORM_PASSWORD || "",
  },
  // Example second tenant — uncomment and set env to enable:
  // {
  //   id: "acme", name: "ACME Logistics", source: "sheets",
  //   sheetId: process.env.ACME_SHEET_ID || "", password: process.env.ACME_PASSWORD || "",
  // },
];

// Resolve the tenant for a request from its session (set at login). Falls back to
// the default tenant when there is no session.
function getTenant(req) {
  const id = req && req.user && req.user.tenantId;
  return TENANTS.find(t => t.id === id) || TENANTS[0];
}

// The default tenant — used by the bot (single-tenant MVP) and as a fallback.
function defaultTenant() { return TENANTS[0]; }

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

module.exports = {
  ROOT_DIR, PUBLIC_DIR, PORT, PLATFORM_URL,
  getTenant, defaultTenant, TENANTS,
  SESSION_SECRET, SESSION_COOKIE, SESSION_TTL_MS, SESSION_TTL_DAYS, PLATFORM_PASSWORD,
  TRUSTED_IPS, isTrustedIp,
};
