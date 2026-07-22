// StarX check-in flow — the Telegram handlers, decoupled from how the bot is started.
//
// This module knows nothing about tokens or polling. It takes a live `bot` instance
// and wires the whole worker flow onto it:
//
//   /route  → tap a stop  → send location  → send photos → "✅ Terminar"
//   → a Visit is written via the shared datasource (the platform shows it live).
//
// Because it talks only to the datasource seam (forTenant), a check-in from the bot
// and the stats on the web dashboard always read/write the same store.
//
// Multi-language: every outgoing string goes through L(lang, key, params) (see ./i18n.js).
// The tenant sets its bot language from the platform (Ajustes → "Idioma del bot", stored
// as the `bot_lang` setting, default "es"); it's resolved once a user's tenant is known
// and cached on their per-user state so we don't re-fetch it on every turn.
const config = require("../config");
const { forTenant } = require("../datasource");
const { localDateStr, visitBelongsToWorker, geofenceOk } = require("../util");
const { L } = require("./i18n");

// Attach every handler to a ready TelegramBot instance. Called by the bot manager
// right after it creates the bot (see src/server/bot/manager.js).
function attachHandlers(bot) {
  // ── In-memory per-user state ─────────────────────────────────────────────
  // Each Telegram user is resolved to a COMPANY (tenant). One shared bot serves them all.
  const states = new Map();
  const getState   = id => states.get(id) || { step: "idle" };
  const setState   = (id, s) => states.set(id, { ...getState(id), ...s });
  const clearState = id => states.delete(id);

  // Datasource for the tenant currently attached to this user's state (null if unresolved).
  function srcOf(userId) {
    const st = getState(userId);
    const t = st.tenantId ? config.tenants.byId(st.tenantId) : null;
    return t ? forTenant(t) : null;
  }

  // This user's bot language: cached on their state once resolved from the tenant's
  // `bot_lang` setting. Unregistered users (no tenant yet) get the default (Spanish),
  // UNLESS a tenant is passed explicitly (e.g. resolved from a /start deep-link code
  // before the worker's phone is even confirmed).
  async function langOf(userId, tenantHint) {
    const st = getState(userId);
    if (st.lang) return st.lang;
    let lang = L.DEFAULT_LANG || "es";
    const t = tenantHint || (st.tenantId ? config.tenants.byId(st.tenantId) : null);
    if (t) {
      try { lang = String(await forTenant(t).getSetting("bot_lang", "es")) || "es"; }
      catch (e) { /* fall back to default */ }
    }
    setState(userId, { lang });
    return lang;
  }
  // Force-refresh the cached lang once we've just learned which tenant this user
  // belongs to (registration / first resolution), so this turn's remaining messages
  // are already in the right language instead of lagging one round-trip behind.
  async function setTenantAndLang(userId, tenant) {
    setState(userId, { tenantId: tenant.id, lang: undefined });
    return langOf(userId, tenant);
  }

  // Find which company a Telegram id belongs to (already-registered worker). Searches every
  // tenant's roster; caches the tenant (and its bot language) on the user's state so later
  // steps skip the scan.
  async function resolveByTelegram(userId) {
    for (const t of config.allTenants()) {
      try {
        const w = (await forTenant(t).listWorkers())
          .find(x => String(x.telegramId) === String(userId) && x.active);
        if (w) { await setTenantAndLang(userId, t); return { tenant: t, worker: w }; }
      } catch (e) { /* skip a tenant whose datasource is unavailable */ }
    }
    return null;
  }
  // Find which company a phone belongs to (for first-time linking by shared contact).
  async function resolveByPhone(phone) {
    for (const t of config.allTenants()) {
      try {
        const w = await forTenant(t).findWorkerByPhone(phone);
        if (w) return { tenant: t, worker: w };
      } catch (e) { /* skip */ }
    }
    return null;
  }

  // ── Keyboards (built per-language: button labels are user-facing text) ───────────
  // Reply keyboards carry a Cancel option during the flow so a worker is never stuck.
  const locationKb = lang => ({ keyboard: [[{ text: L(lang, "btn_send_location"), request_location: true }], [{ text: L(lang, "btn_cancel") }]], resize_keyboard: true, one_time_keyboard: true });
  const contactKb   = lang => ({ keyboard: [[{ text: L(lang, "btn_share_phone"), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
  const doneKb      = lang => ({ keyboard: [[{ text: L(lang, "btn_done") }, { text: L(lang, "btn_cancel") }]], resize_keyboard: true });
  const removeKb    = { remove_keyboard: true }; // no text on this one — language-independent

  // Optional post-photo commentary step: quick-pick presets (inline buttons) or the
  // worker just types (or sends a voice note for) their own comment. `skip` writes no note.
  function notePreset(lang, key) {
    if (key === "delivered") return L(lang, "btn_note_delivered");
    if (key === "absent")    return L(lang, "btn_note_absent");
    if (key === "damage")    return L(lang, "btn_note_damage");
    return ""; // skip
  }
  const noteKb = lang => ({
    inline_keyboard: [
      [{ text: L(lang, "btn_note_delivered"), callback_data: "note:delivered" }],
      [{ text: L(lang, "btn_note_absent"), callback_data: "note:absent" }],
      [{ text: L(lang, "btn_note_damage"), callback_data: "note:damage" }],
      [{ text: L(lang, "btn_note_skip"), callback_data: "note:skip" }],
    ],
  });

  // Resolve the worker behind a Telegram id (across all companies) and remember the tenant.
  async function findWorker(telegramId) {
    const res = await resolveByTelegram(telegramId);
    return res ? res.worker : null;
  }

  // This worker's check-in history in one pass: which stops are done TODAY (to mark them
  // ✅) and how many times each stop has been visited all-time (to surface the most-used
  // stops first). Attributed by the stable workerId (telegramId as fallback for older
  // visits); "today" follows the company timezone.
  async function workerVisitStats(userId, worker) {
    const today = localDateStr(null, config.TIMEZONE);
    const src = srcOf(userId);
    const visits = src ? await src.listVisits({ limit: 2000 }) : [];
    const visitedToday = new Set();
    const usage = {}; // pointId → all-time count for this worker
    for (const v of visits) {
      if (!visitBelongsToWorker(v, worker)) continue;
      const pid = String(v.pointId);
      usage[pid] = (usage[pid] || 0) + 1;
      if (localDateStr(v.timestamp, config.TIMEZONE) === today) visitedToday.add(pid);
    }
    return { visitedToday, usage };
  }

  // Prompt an unregistered user to share their phone so we can link them by phone.
  async function askForContact(chatId, userId, company) {
    const lang = await langOf(userId);
    const text = company ? L(lang, "welcome_new_company", { company: esc(company) }) : L(lang, "welcome_new");
    return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: contactKb(lang) });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/([_*\[\]()`])/g, "\\$1"); }

  // ── /start [código-empresa] ──────────────────────────────────────────────────
  // A deep-link (t.me/<bot>?start=<code>) tells us which company a NEW worker belongs to.
  bot.onText(/^\/start(?:\s+(\S+))?/, async (msg, match) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const code = match && match[1] ? String(match[1]).trim() : "";
    try {
      const worker = await findWorker(userId);
      if (worker) {
        const lang = await langOf(userId);
        return bot.sendMessage(msg.chat.id,
          L(lang, "hello_back", { name: esc(worker.name || "") || (lang === "en" ? "friend" : lang === "uk" ? "друже" : "compañero") }),
          { parse_mode: "Markdown" });
      }
      // Not registered yet. If they arrived via a company deep-link, remember that company
      // (and its bot language) so their shared contact is linked to the right roster.
      if (code) {
        const t = config.tenants.byCode(code);
        if (t) {
          setState(userId, { regTenantId: t.id });
          return askForContact(msg.chat.id, userId, t.name);
        }
      }
      return askForContact(msg.chat.id, userId);
    } catch (e) {
      const lang = await langOf(userId);
      bot.sendMessage(msg.chat.id, L(lang, "db_error"));
      console.error("/start error:", e.message);
    }
  });

  // How many stop buttons to show at once before asking the worker to search instead.
  // Kept small on purpose: the worker sees their most-used stops first, and searches for
  // the rest.
  const ROUTE_PAGE = 5;
  function pointMatches(p, q) {
    if (!q) return true;
    const hay = (String(p.name || "") + " " + String(p.address || "") + " " + String(p.id || "")).toLowerCase();
    return hay.indexOf(q.toLowerCase()) !== -1;
  }

  // Build + send the route as inline buttons. Shared by /route, the refresh button, and
  // the search flow. `query` (optional) filters the stops by name/address so a worker
  // with many points types a few letters instead of scrolling dozens of buttons.
  async function sendRoute(chatId, userId, query) {
    const worker = await findWorker(userId);
    if (!worker) return askForContact(chatId, userId);
    const src = srcOf(userId);
    if (!src) return askForContact(chatId, userId);
    const lang = await langOf(userId);

    let points = (await src.listPointsForWorker(worker.workerId)).filter(p => p.active);
    if (!points.length) return bot.sendMessage(chatId, L(lang, "no_points_assigned"));

    const { visitedToday: visited, usage } = await workerVisitStats(userId, worker);
    // Most-used stops first so the 5 shown by default are the ones this worker visits most
    // (stable order for ties). Search still spans the whole list.
    points = points.slice().sort((a, b) => (usage[String(b.id)] || 0) - (usage[String(a.id)] || 0));

    // routeMap stays the FULL (sorted) list so ci:i callbacks keep pointing at the right stop.
    setState(userId, { step: "route", worker, routeMap: points });
    const doneCount = points.filter(p => visited.has(String(p.id))).length;

    const q = String(query || "").trim();
    // Keep each point's index in routeMap so filtered buttons still resolve.
    const matches = points.map((p, i) => ({ p, i })).filter(x => pointMatches(x.p, q));
    const shown = matches.slice(0, ROUTE_PAGE);

    const buttons = shown.map(({ p, i }) => {
      const done = visited.has(String(p.id));
      return [{ text: `${done ? "✅" : "📍"} ${p.name || p.address || p.id}`, callback_data: `ci:${i}` }];
    });
    buttons.push([{ text: L(lang, "btn_search_stop"), callback_data: "route:search" }, { text: L(lang, "btn_refresh"), callback_data: "route:refresh" }]);

    let header;
    if (q) {
      const more = matches.length > ROUTE_PAGE ? L(lang, "route_search_more", { page: ROUTE_PAGE }) : "";
      header = matches.length
        ? L(lang, "route_search_results", { count: matches.length, q: esc(q), more })
        : L(lang, "route_search_none", { q: esc(q) });
    } else {
      const more = points.length > ROUTE_PAGE ? L(lang, "route_more_suffix", { total: points.length, page: ROUTE_PAGE }) : "";
      header = L(lang, "route_header", { done: doneCount, total: points.length, more });
    }
    return bot.sendMessage(chatId, header, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // ── /route — list active points as buttons ──────────────────────────────────
  bot.onText(/^\/route/, async (msg) => {
    if (msg.chat.type !== "private") return;
    try { await sendRoute(msg.chat.id, msg.from.id); }
    catch (e) {
      const lang = await langOf(msg.from.id);
      bot.sendMessage(msg.chat.id, L(lang, "route_load_error"));
      console.error("/route error:", e.message);
    }
  });

  // Writes the Visit (whatever comment text, or "" to skip) and resets the worker's state.
  // Shared by the quick-pick inline buttons, a typed comment, and a voice-note comment.
  async function finalizeVisit(chatId, userId, note) {
    const st = getState(userId);
    const lang = await langOf(userId);
    try {
      const worker = st.worker || await findWorker(userId);
      const src = srcOf(userId);
      if (!src) { clearState(userId); return bot.sendMessage(chatId, L(lang, "session_expired"), { reply_markup: removeKb }); }
      const visitId = await src.addVisit({
        timestamp: new Date().toISOString(),
        workerId: worker ? worker.workerId : "",
        workerTelegramId: String(userId),
        workerName: worker ? worker.name : "",
        pointId: st.pointId, pointName: st.pointName,
        lat: st.lat, lng: st.lng, mapsLink: st.mapsLink,
        photoCount: (st.photos || []).length,
        photoFileIds: st.photos || [],
        source: "bot",
        note: String(note || "").slice(0, 500),
      });
      // First check-in fixes the point's coordinates (only if still empty).
      try { await src.ensurePointLocation(st.pointId, st.lat, st.lng); }
      catch (e) { console.error("ensurePointLocation error:", e.message); }
      clearState(userId);
      bot.sendMessage(chatId,
        L(lang, "checkin_saved", { point: esc(st.pointName), n: (st.photos || []).length, id: esc(visitId) }),
        { parse_mode: "Markdown", reply_markup: removeKb });
    } catch (e) {
      console.error("finalize error:", e.message);
      bot.sendMessage(chatId, L(lang, "finalize_error"), { reply_markup: removeKb });
    }
  }

  // ── Inline buttons: tap a stop (ci:i), refresh the route (route:refresh), or pick a
  // quick-comment preset after photos (note:*) ─────────────────────────────────
  bot.on("callback_query", async (q) => {
    const [action, idx] = (q.data || "").split(":");
    const userId = q.from.id;
    const lang = await langOf(userId);

    if (action === "route" && idx === "refresh") {
      await bot.answerCallbackQuery(q.id, { text: L(lang, "route_updated") }).catch(() => {});
      try { await sendRoute(q.message.chat.id, userId); } catch (e) { console.error("route refresh error:", e.message); }
      return;
    }
    if (action === "route" && idx === "search") {
      setState(userId, { step: "searching" });
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return bot.sendMessage(q.message.chat.id, L(lang, "search_prompt"), { parse_mode: "Markdown" });
    }
    if (action === "note") {
      await bot.answerCallbackQuery(q.id).catch(() => {});
      if (getState(userId).step !== "waiting_comment") return;
      return finalizeVisit(q.message.chat.id, userId, notePreset(lang, idx));
    }
    if (action !== "ci") return bot.answerCallbackQuery(q.id).catch(() => {});

    const st = getState(userId);
    const point = (st.routeMap || [])[parseInt(idx, 10)];
    if (!point) {
      await bot.answerCallbackQuery(q.id, { text: L(lang, "tap_route_again"), show_alert: true }).catch(() => {});
      return;
    }
    setState(userId, {
      step: "waiting_location",
      pointId: point.id, pointName: point.name || point.address || point.id,
      // Snapshot the point's known coords so we can geofence the check-in at the end.
      pointLat: point.lat, pointLng: point.lng, pointGeolocated: point.geolocated,
      photos: [],
    });
    await bot.answerCallbackQuery(q.id).catch(() => {});
    bot.sendMessage(q.message.chat.id,
      L(lang, "checkin_step1", { point: esc(point.name || point.address || point.id) }),
      { parse_mode: "Markdown", reply_markup: locationKb(lang) });
  });

  // ── Location ─────────────────────────────────────────────────────────────────
  bot.on("location", async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const st = getState(userId);
    if (st.step !== "waiting_location") return;
    const lang = await langOf(userId);
    const { latitude, longitude } = msg.location;

    // Geofence: if the point already has coords and a radius is configured, the worker
    // must be within it. First check-in (no coords yet) is always accepted.
    const fence = geofenceOk(
      { lat: st.pointLat, lng: st.pointLng, geolocated: st.pointGeolocated },
      latitude, longitude, config.GEOFENCE_METERS);
    if (!fence.ok) {
      return bot.sendMessage(msg.chat.id,
        L(lang, "geofence_too_far", { dist: fence.distance, point: esc(st.pointName), max: config.GEOFENCE_METERS }),
        { parse_mode: "Markdown", reply_markup: locationKb(lang) });
    }
    setState(userId, {
      step: "waiting_photos",
      lat: latitude, lng: longitude,
      mapsLink: `https://www.google.com/maps?q=${latitude},${longitude}`,
      photos: [],
    });
    bot.sendMessage(msg.chat.id, L(lang, "location_received"), { parse_mode: "Markdown", reply_markup: doneKb(lang) });
  });

  // ── Contact → register by phone ──────────────────────────────────────────────
  bot.on("contact", async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const lang = await langOf(userId);
    // Only trust the user's OWN shared contact (Telegram sets user_id on it).
    if (msg.contact.user_id && String(msg.contact.user_id) !== String(userId)) {
      return bot.sendMessage(msg.chat.id, L(lang, "share_own_phone_only"), { parse_mode: "Markdown", reply_markup: contactKb(lang) });
    }
    try {
      const already = await findWorker(userId);
      if (already) return bot.sendMessage(msg.chat.id, L(lang, "already_registered", { name: esc(already.name) }), { parse_mode: "Markdown", reply_markup: removeKb });

      // Which company does this phone belong to? Prefer the deep-link company they arrived
      // through; otherwise search every roster by phone (the manager preloaded it somewhere).
      const st = getState(userId);
      let hit = null;
      if (st.regTenantId) {
        const t = config.tenants.byId(st.regTenantId);
        const w = t ? await forTenant(t).findWorkerByPhone(msg.contact.phone_number) : null;
        if (w) hit = { tenant: t, worker: w };
      }
      if (!hit) hit = await resolveByPhone(msg.contact.phone_number);

      if (hit) {
        // Known worker → link this Telegram account to their profile, in THEIR company.
        await forTenant(hit.tenant).linkWorkerTelegram(hit.worker.row, userId);
        const hitLang = await setTenantAndLang(userId, hit.tenant);
        return bot.sendMessage(msg.chat.id,
          L(hitLang, "registered_in_company", { name: esc(hit.worker.name || ""), company: esc(hit.tenant.name) }),
          { parse_mode: "Markdown", reply_markup: removeKb });
      }

      // Unknown number → NOT allowed in (roster-controlled; no self-onboarding). Record the
      // attempt against the deep-link company if we know it, so its manager can add them.
      const attemptName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ").trim()
        || (msg.from.username ? "@" + msg.from.username : "");
      const regT = st.regTenantId ? config.tenants.byId(st.regTenantId) : null;
      if (regT) { try { await require("../pending").add(forTenant(regT), msg.contact.phone_number, attemptName); } catch (e) {} }
      bot.sendMessage(msg.chat.id, L(lang, "unknown_number"), { parse_mode: "Markdown", reply_markup: removeKb });
    } catch (e) {
      console.error("contact/register error:", e.message);
      bot.sendMessage(msg.chat.id, L(lang, "register_error"), { reply_markup: removeKb });
    }
  });

  // ── Photos ───────────────────────────────────────────────────────────────────
  bot.on("photo", async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const st = getState(userId);
    if (st.step !== "waiting_photos") return;
    const lang = await langOf(userId);
    const photos = st.photos || [];
    photos.push(msg.photo[msg.photo.length - 1].file_id);
    setState(userId, { photos });
    bot.sendMessage(msg.chat.id, L(lang, "photo_received", { n: photos.length }), { parse_mode: "Markdown", reply_markup: doneKb(lang) });
  });

  // ── Voice-note comment (only meaningful during the optional comment step) ────
  // We don't transcribe (no speech-to-text service wired in) — the note stores a
  // reference to the Telegram voice file so it can be played back from the platform
  // (see GET /api/visits/:id/voice in routes/visits.js), same proxy pattern as photos.
  bot.on("voice", (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    if (getState(userId).step !== "waiting_comment") return;
    finalizeVisit(msg.chat.id, userId, "🎙️voice:" + msg.voice.file_id);
  });

  // ── Done / Cancel (plain text from the reply keyboard) + typed comment ───────
  bot.on("message", async (msg) => {
    if (msg.chat.type !== "private") return;
    if (msg.location || msg.photo || msg.contact || msg.voice) return;
    const text = (msg.text || "").trim();
    if (text.startsWith("/")) return; // commands handled by onText
    const userId = msg.from.id;
    const st = getState(userId);
    const lang = await langOf(userId);
    const BTN_DONE = L(lang, "btn_done"), BTN_CANCEL = L(lang, "btn_cancel");

    if (text === BTN_CANCEL) {
      clearState(userId);
      return bot.sendMessage(msg.chat.id, L(lang, "cancelled"), { reply_markup: removeKb });
    }

    // Worker typed a search query after tapping "🔍 Buscar parada" → show matching stops.
    if (st.step === "searching") {
      try { await sendRoute(msg.chat.id, userId, text); }
      catch (e) { console.error("route search error:", e.message); bot.sendMessage(msg.chat.id, L(lang, "search_error")); }
      return;
    }

    // Optional commentary step: pressing "Terminar" here (or anything typed) either skips
    // or IS the comment — the quick-pick presets arrive as callback_query, handled above.
    if (st.step === "waiting_comment") {
      if (text === BTN_DONE || !text) return finalizeVisit(msg.chat.id, userId, "");
      return finalizeVisit(msg.chat.id, userId, text);
    }

    if (text === BTN_DONE) {
      if (st.step !== "waiting_photos") return bot.sendMessage(msg.chat.id, L(lang, "nothing_to_finish"), { reply_markup: removeKb });
      try {
        const src = srcOf(userId);
        if (!src) return bot.sendMessage(msg.chat.id, L(lang, "session_expired"), { reply_markup: removeKb });
        // A.2 — Photo may be required per company.
        if (!(st.photos || []).length && String(await src.getSetting("photo_required", "0")) === "1") {
          return bot.sendMessage(msg.chat.id, L(lang, "photo_required"), { parse_mode: "Markdown", reply_markup: doneKb(lang) });
        }
        const worker = st.worker || await findWorker(userId);
        setState(userId, { step: "waiting_comment", worker });
        bot.sendMessage(msg.chat.id, L(lang, "comment_prompt"), { parse_mode: "Markdown", reply_markup: noteKb(lang) });
      } catch (e) {
        console.error("comment-step error:", e.message);
        bot.sendMessage(msg.chat.id, L(lang, "comment_step_error"), { parse_mode: "Markdown", reply_markup: doneKb(lang) });
      }
    }
  });

  // Command menu descriptions are set once at bot startup in a single language (Telegram
  // doesn't support per-user localized command lists here); Spanish/English/Ukrainian
  // workers all still get fully localized conversation messages once they interact.
  bot.setMyCommands([
    { command: "start", description: L("es", "cmd_start") },
    { command: "route", description: L("es", "cmd_route") },
  ]).catch(() => {});

  bot.on("polling_error", (e) => console.error("polling_error:", e.message));
}

module.exports = { attachHandlers };
