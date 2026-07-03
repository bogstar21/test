// Datasource seam. Routes and the bot call forTenant(tenant) and get back an object
// with the same methods regardless of where the data actually lives. Today the only
// implementation is Google Sheets; tomorrow a tenant with source:"api" gets a REST
// implementation here and NOTHING else in the codebase changes. That indirection is
// the whole point — it keeps the scaling path (Sheets → API → Postgres) cheap.
const { makeMemorySource } = require("./memory");

// Tiny cache so we don't rebuild the same bound source on every request.
const _cache = new Map();

function forTenant(tenant) {
  if (!tenant) throw new Error("forTenant: no tenant");
  const source = tenant.source || "memory";
  const key = `${source}:${tenant.sheetId || tenant.id}`;
  if (_cache.has(key)) return _cache.get(key);

  let impl;
  switch (source) {
    case "memory":
      impl = makeMemorySource(tenant.id);
      break;
    case "sheets":
      // Loaded lazily so the MVP never requires googleapis/credentials.
      impl = require("./sheets").makeSheetsSource(tenant.sheetId);
      break;
    case "supabase":
      // Persistent store over Supabase (Postgres + REST API). Loaded lazily so the
      // MVP never requires @supabase/supabase-js or credentials until it's used.
      impl = require("./supabase").makeSupabaseSource(tenant);
      break;
    // case "api":   impl = makeApiSource(tenant);      break;   // Phase 3
    // case "postgres": impl = makePgSource(tenant);    break;   // Phase 4
    default:
      throw new Error(`unknown datasource: ${source}`);
  }
  _cache.set(key, impl);
  return impl;
}

module.exports = { forTenant };
