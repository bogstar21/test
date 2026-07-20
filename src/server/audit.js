// Best-effort audit log of state-changing platform actions. Writes to the platform-level
// `starx_audit` table when DATASOURCE=supabase; a no-op otherwise (memory/sheets dev).
// Never throws and never blocks the request — auditing must not break a real action.
function log(entry) {
  if ((process.env.DATASOURCE || "memory") !== "supabase") return;
  try {
    const { getSupabase } = require("./supabaseClient");
    getSupabase().from("starx_audit").insert({
      tenant_id: String((entry && entry.tenantId) || ""),
      actor:     String((entry && entry.actor) || ""),
      role:      String((entry && entry.role) || ""),
      action:    String((entry && entry.action) || ""),
      ip:        String((entry && entry.ip) || ""),
    }).then(function () {}, function () {}); // fire-and-forget; swallow errors
  } catch (e) { /* datasource unavailable — skip */ }
}

module.exports = { log };
