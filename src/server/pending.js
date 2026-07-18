// "Pending contacts" — people who opened the bot and shared a phone that is NOT in the
// system. Since the bot no longer auto-creates workers (registration is roster-controlled),
// this is how a manager sees who tried, so they can add them with one click.
//
// Stored per-tenant as a JSON array in the settings key `pending_contacts` (newest first,
// capped). Uses the datasource settings seam, so it works on memory/supabase/sheets alike.
const { phonesMatch } = require("./util");

const KEY = "pending_contacts";
const MAX = 30;

async function list(source) {
  try { return JSON.parse((await source.getSetting(KEY, "[]")) || "[]") || []; }
  catch { return []; }
}

// Record a failed registration attempt (deduped by phone). No-op without a phone.
async function add(source, phone, name) {
  phone = String(phone || "").trim();
  if (!phone) return;
  const items = await list(source);
  if (items.some(i => phonesMatch(i.phone, phone))) return;
  items.unshift({ phone, name: String(name || "").trim(), at: new Date().toISOString() });
  await source.setSetting(KEY, JSON.stringify(items.slice(0, MAX)));
}

// Drop a phone from the pending list (called when it's dismissed or the worker is added).
async function remove(source, phone) {
  const items = (await list(source)).filter(i => !phonesMatch(i.phone, phone));
  await source.setSetting(KEY, JSON.stringify(items));
}

module.exports = { list, add, remove, KEY };
