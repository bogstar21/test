// Platform tenant registry (multi-company). This is the SaaS backbone: it owns the list
// of companies, their login credentials, plan and billing state.
//
// Source of truth:
//   • DATASOURCE=supabase → the platform-level `starx_tenants` table (loaded into a cache
//     at boot and after every write).
//   • otherwise (memory/sheets/no DB) → a single env-configured "default" tenant, plus any
//     created at runtime (kept in memory).
//
// getTenant/defaultTenant/all/byCode are SYNCHRONOUS (they read the cache) so routes and the
// bot never had to change when tenants moved from a hardcoded array into the database.
const crypto = require("crypto");

// ── Plans & limits ──────────────────────────────────────────────────────────────
// Limits are derived from the plan in code (only the plan name is stored), so pricing can
// change without a migration. Used by the quota guard and shown in the UI.
const PLANS = {
  trial:    { label: "Prueba",   maxWorkers: 5,        maxPoints: 200 },
  basic:    { label: "Básico",   maxWorkers: 5,        maxPoints: 200 },
  pro:      { label: "Pro",      maxWorkers: 25,       maxPoints: 2000 },
  business: { label: "Business", maxWorkers: Infinity, maxPoints: Infinity },
};
function planLimits(plan) { return PLANS[plan] || PLANS.trial; }

// A tenant can write (add workers/points/visits) only while its subscription is live.
// past_due / canceled → read-only (never destructive: data is preserved, just frozen).
function canWrite(tenant) {
  if (!tenant) return false;
  var s = String(tenant.subscriptionStatus || "active");
  return s === "active" || s === "trialing";
}

// ── Password hashing (scrypt; format "scrypt$salt$hash") ──────────────────────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt$" + salt + "$" + crypto.scryptSync(String(pw), salt, 32).toString("hex");
}
function verifyPassword(tenant, pw) {
  if (!tenant || !pw) return false;
  const stored = tenant.passwordHash || "";
  if (stored.indexOf("scrypt$") === 0) {
    const parts = stored.split("$");
    const cand = crypto.scryptSync(String(pw), parts[1], 32).toString("hex");
    const a = Buffer.from(cand), b = Buffer.from(parts[2] || "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (tenant.password) { // env default keeps a plaintext password from PLATFORM_PASSWORD
    const a = Buffer.from(String(pw)), b = Buffer.from(String(tenant.password));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

// ── The env-configured default tenant (keeps zero-config dev + single-company working) ──
function envDefault() {
  return {
    id: "default",
    name: process.env.TENANT_NAME || "StarX Demo",
    code: String(process.env.TENANT_CODE || "default").toLowerCase(),
    source: process.env.DATASOURCE || "memory",
    sheetId: process.env.SHEET_ID || "",
    password: process.env.PLATFORM_PASSWORD || "admin", // plaintext, env-only
    plan: "business",
    subscriptionStatus: "active",
    trialEndsAt: null,
    stripeCustomerId: "",
    active: true,
    isDefault: true,
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────────
let _cache = [envDefault()];

function all() { return _cache; }
function defaultTenant() { return _cache.find(t => t.isDefault) || _cache[0]; }
function byId(id) { return _cache.find(t => String(t.id) === String(id)) || defaultTenant(); }
function byCode(code) {
  code = String(code || "").trim().toLowerCase();
  if (!code) return null;
  return _cache.find(t => String(t.code || "").toLowerCase() === code) || null;
}
function byEmail(email) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return null;
  return _cache.find(t => String(t.email || "").toLowerCase() === email) || null;
}
// Resolve the tenant for a request from its session (falls back to default).
function get(req) {
  const id = req && req.user && req.user.tenantId;
  return id ? byId(id) : defaultTenant();
}

// ── DB access (platform-level table, no tenant_id — it IS the tenant list) ──────────
function platformDb() {
  if ((process.env.DATASOURCE || "memory") !== "supabase") return null;
  try { return require("./supabaseClient").getSupabase(); } catch { return null; }
}
function rowToTenant(r) {
  return {
    id: String(r.id), name: String(r.name || ""), code: String(r.code || "").toLowerCase(),
    source: String(r.source || "supabase"), sheetId: String(r.sheet_id || ""),
    passwordHash: String(r.password_hash || ""),
    email: String(r.email || ""),
    resetTokenHash: String(r.reset_token_hash || ""),
    resetTokenExpires: r.reset_token_expires || null,
    plan: String(r.plan || "trial"),
    subscriptionStatus: String(r.subscription_status || "trialing"),
    trialEndsAt: r.trial_ends_at || null,
    stripeCustomerId: String(r.stripe_customer_id || ""),
    active: r.active !== false,
    createdAt: r.created_at || null,
  };
}

// Reload the cache from the DB (no-op without a platform DB). The env default is always
// kept so the operator can always log in, even before any company exists in the table.
async function reload() {
  const db = platformDb();
  if (!db) return;
  try {
    const { data, error } = await db.from("starx_tenants").select("*").eq("active", true);
    if (error) throw error;
    const byId = {};
    byId["default"] = envDefault();
    (data || []).forEach(r => { const t = rowToTenant(r); byId[t.id] = t; });
    _cache = Object.keys(byId).map(k => byId[k]);
  } catch (e) { console.error("tenants.reload:", e && e.message); }
}

function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "co";
}

// Create a company. Persists to the DB when available; otherwise lives in memory. Returns
// the new tenant (including the plaintext code so the UI can show the bot deep-link).
async function create(opts) {
  opts = opts || {};
  const code = (opts.code ? slugify(opts.code) : slugify(opts.name)) + "-" + crypto.randomBytes(2).toString("hex");
  const id = code;
  const trialDays = opts.trialDays == null ? 14 : opts.trialDays;
  const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 864e5).toISOString() : null;
  const tenant = {
    id, name: String(opts.name || "Nueva empresa"), code,
    source: opts.source || (platformDb() ? "supabase" : "memory"), sheetId: "",
    passwordHash: opts.password ? hashPassword(opts.password) : "",
    email: String(opts.email || "").trim().toLowerCase(),
    plan: opts.plan || "trial",
    subscriptionStatus: "trialing", trialEndsAt, stripeCustomerId: "", active: true,
  };
  const db = platformDb();
  if (db) {
    const { error } = await db.from("starx_tenants").insert({
      id: tenant.id, name: tenant.name, code: tenant.code, source: tenant.source,
      password_hash: tenant.passwordHash, email: tenant.email, plan: tenant.plan,
      subscription_status: tenant.subscriptionStatus, trial_ends_at: tenant.trialEndsAt, active: true,
    });
    if (error) throw new Error(error.message || String(error));
    await reload();
  } else {
    _cache = _cache.concat([tenant]);
  }
  return tenant;
}

// Patch billing/plan fields for a tenant (used by the Stripe webhook / admin). DB + cache.
async function update(id, patch) {
  const db = platformDb();
  if (db) {
    const dbPatch = {};
    if (patch.plan != null) dbPatch.plan = patch.plan;
    if (patch.subscriptionStatus != null) dbPatch.subscription_status = patch.subscriptionStatus;
    if (patch.stripeCustomerId != null) dbPatch.stripe_customer_id = patch.stripeCustomerId;
    if (patch.trialEndsAt !== undefined) dbPatch.trial_ends_at = patch.trialEndsAt;
    if (patch.passwordHash != null) dbPatch.password_hash = patch.passwordHash;
    if (patch.email != null) dbPatch.email = patch.email;
    if (patch.resetTokenHash != null) dbPatch.reset_token_hash = patch.resetTokenHash;
    if (patch.resetTokenExpires !== undefined) dbPatch.reset_token_expires = patch.resetTokenExpires;
    if (Object.keys(dbPatch).length) {
      const { error } = await db.from("starx_tenants").update(dbPatch).eq("id", id);
      if (error) throw new Error(error.message || String(error));
    }
    await reload();
  } else {
    const t = _cache.find(x => String(x.id) === String(id));
    if (t) Object.assign(t, patch);
  }
  return byId(id);
}

module.exports = {
  PLANS, planLimits, canWrite, hashPassword, verifyPassword,
  all, defaultTenant, byId, byCode, byEmail, get, reload, create, update, slugify, envDefault,
};
