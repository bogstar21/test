// Shared Supabase client (service role — server-side only, bypasses RLS).
// Lazily initialised on first use, so simply requiring this module never throws:
// the MVP boots with the in-memory store and only touches Supabase when a tenant's
// `source` is "supabase". Mirrors the lazy pattern of sheets.js.
//
// Required env:
//   SUPABASE_URL          e.g. https://xxxxxxxx.supabase.co
//   SUPABASE_SERVICE_KEY  the "service_role" secret key (NOT the anon key)
const { createClient } = require("@supabase/supabase-js");

let _cached = null;

function getSupabase() {
  if (_cached) return _cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY.");
  }
  _cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _cached;
}

module.exports = { getSupabase };
