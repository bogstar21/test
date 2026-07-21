// Structured logging + error monitoring — zero-dependency. Every log line is one JSON
// object (timestamp, level, message, context) so it's greppable/parseable in any log
// viewer (Railway, Papertrail, etc.) without needing a vendor SDK.
//
// Optional alerting: if ERROR_WEBHOOK_URL is set (a Slack/Discord "incoming webhook" or
// any endpoint that accepts { text }), every error() call also POSTs a summary there —
// so you find out about a production crash before a customer tells you.
// In-memory ring buffer of recent entries so the operator analytics page can stream a
// live log without a vendor. Each entry gets a monotonic `id` so the client can poll
// incrementally (?after=<id>). This is per-process (one Railway instance) — fine for an
// operator's live tail; the console/JSON output is still the source of truth for history.
const BUFFER = [];
const MAX_BUFFER = 500;
let _seq = 0;
function record(entry) {
  entry.id = ++_seq;
  BUFFER.push(entry);
  if (BUFFER.length > MAX_BUFFER) BUFFER.shift();
}
// Entries with id greater than `afterId` (0 → the whole buffer). Newest last.
function recent(afterId) {
  afterId = Number(afterId) || 0;
  return afterId ? BUFFER.filter(e => e.id > afterId) : BUFFER.slice();
}

// Best-effort persistence to a platform-level `starx_logs` table (supabase only), so the
// operator page shows real HISTORY that survives restarts — not just this process's tail.
// Fire-and-forget; a logging failure must never affect the request that produced it, and
// info-level noise is skipped to keep the table (and cost) small.
function persist(entry) {
  if ((process.env.DATASOURCE || "memory") !== "supabase") return;
  if (entry.level === "info") return;
  try {
    require("./supabaseClient").getSupabase().from("starx_logs").insert({
      ts: entry.ts, level: entry.level, message: String(entry.message || "").slice(0, 1000),
      meta: entry.meta ? JSON.stringify(entry.meta).slice(0, 4000) : null,
    }).then(() => {}, () => {});
  } catch (e) { /* datasource unavailable — buffer still has it */ }
}

function line(level, message, meta) {
  const entry = { ts: new Date().toISOString(), level, message };
  if (meta && Object.keys(meta).length) entry.meta = meta;
  const s = JSON.stringify(entry);
  if (level === "error") console.error(s); else if (level === "warn") console.warn(s); else console.log(s);
  record(entry);
  persist(entry);
  return entry;
}

// History for the operator page: persisted rows (newest first) when a platform DB exists,
// otherwise this process's in-memory buffer. `opts`: { limit, level }.
async function history(opts) {
  opts = opts || {};
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000);
  const level = opts.level && ["info", "warn", "error"].includes(opts.level) ? opts.level : "";
  if ((process.env.DATASOURCE || "memory") === "supabase") {
    try {
      let q = require("./supabaseClient").getSupabase().from("starx_logs")
        .select("*").order("ts", { ascending: false }).limit(limit);
      if (level) q = q.eq("level", level);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.pk, ts: r.ts, level: r.level, message: r.message,
        meta: r.meta ? safeParse(r.meta) : undefined,
      }));
    } catch (e) { /* fall through to buffer */ }
  }
  let rows = BUFFER.slice().reverse();
  if (level) rows = rows.filter(e => e.level === level);
  return rows.slice(0, limit);
}
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return s; } }

function alert(entry) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const text = `🚨 StarX error: ${entry.message}` + (entry.meta ? "\n```" + JSON.stringify(entry.meta, null, 2).slice(0, 1500) + "```" : "");
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
    .catch(() => {}); // never let alerting itself crash or block anything
}

function info(message, meta) { return line("info", message, meta); }
function warn(message, meta) { return line("warn", message, meta); }
function error(message, err, meta) {
  const m = Object.assign({}, meta, err ? { error: err.message, stack: (err.stack || "").split("\n").slice(0, 6).join("\n") } : {});
  const entry = line("error", message, m);
  alert(entry);
  return entry;
}

module.exports = { info, warn, error, recent, history };
