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
const config = require("../config");
const { forTenant } = require("../datasource");
const { localDateStr, visitBelongsToWorker, geofenceOk } = require("../util");

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

  // Find which company a Telegram id belongs to (already-registered worker). Searches every
  // tenant's roster; caches the tenant on the user's state so later steps skip the scan.
  async function resolveByTelegram(userId) {
    for (const t of config.allTenants()) {
      try {
        const w = (await forTenant(t).listWorkers())
          .find(x => String(x.telegramId) === String(userId) && x.active);
        if (w) { setState(userId, { tenantId: t.id }); return { tenant: t, worker: w }; }
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

  // ── Keyboards ────────────────────────────────────────────────────────────
  // Reply keyboards carry a Cancel option during the flow so a worker is never stuck.
  const locationKb = { keyboard: [[{ text: "📍 Enviar ubicación", request_location: true }], [{ text: "❌ Cancelar" }]], resize_keyboard: true, one_time_keyboard: true };
  const contactKb   = { keyboard: [[{ text: "📱 Compartir mi teléfono", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const doneKb      = { keyboard: [[{ text: "✅ Terminar" }, { text: "❌ Cancelar" }]], resize_keyboard: true };
  const removeKb    = { remove_keyboard: true };
  // Button labels reused in message handlers (keep in one place so they can't drift).
  const BTN_DONE = "✅ Terminar", BTN_CANCEL = "❌ Cancelar";

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
  function askForContact(chatId, company) {
    const who = company ? ` de *${esc(company)}*` : "";
    return bot.sendMessage(chatId,
      `👋 Bienvenido a *StarX*${who}.\n\nPara registrarte, comparte tu número de teléfono con el botón de abajo y te enlazaré con tu perfil.`,
      { parse_mode: "Markdown", reply_markup: contactKb });
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
        return bot.sendMessage(msg.chat.id,
          `👋 ¡Hola *${esc(worker.name || "compañero")}*!\n\nPulsa /route para ver tus paradas y empezar a hacer check-in.`,
          { parse_mode: "Markdown" });
      }
      // Not registered yet. If they arrived via a company deep-link, remember that company
      // so their shared contact is linked to the right roster.
      if (code) {
        const t = config.tenants.byCode(code);
        if (t) { setState(userId, { regTenantId: t.id }); return askForContact(msg.chat.id, t.name); }
      }
      return askForContact(msg.chat.id);
    } catch (e) {
      bot.sendMessage(msg.chat.id, "⚠️ No pude conectar con la base de datos. Inténtalo de nuevo en un momento.");
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
    if (!worker) return askForContact(chatId);
    const src = srcOf(userId);
    if (!src) return askForContact(chatId);

    let points = (await src.listPointsForWorker(worker.workerId)).filter(p => p.active);
    if (!points.length) return bot.sendMessage(chatId, "Todavía no tienes paradas asignadas. Pídele a tu responsable que te las asigne.");

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
    buttons.push([{ text: "🔍 Buscar parada", callback_data: "route:search" }, { text: "🔄 Actualizar", callback_data: "route:refresh" }]);

    let header;
    if (q) {
      header = matches.length
        ? `🔎 *${matches.length}* resultado(s) para "${esc(q)}"${matches.length > ROUTE_PAGE ? ` (mostrando ${ROUTE_PAGE}, afina la búsqueda)` : ""}:`
        : `🔎 Nada coincide con "${esc(q)}".\nPulsa *🔍 Buscar parada* para probar otra vez.`;
    } else {
      const more = points.length > ROUTE_PAGE
        ? `\nTienes *${points.length}* paradas — muestro tus *${ROUTE_PAGE} más usadas*. Pulsa *🔍 Buscar parada* para encontrar cualquier otra por nombre.`
        : "";
      header = `🗺 *Tus paradas* — ${doneCount}/${points.length} hechas hoy.${more}\nPulsa una para hacer check-in (✅ = ya hecha hoy):`;
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
    catch (e) { bot.sendMessage(msg.chat.id, "⚠️ No pude cargar tu ruta. Inténtalo de nuevo en un momento."); console.error("/route error:", e.message); }
  });

  // ── Inline buttons: tap a stop (ci:i) or refresh the route (route:refresh) ────
  bot.on("callback_query", async (q) => {
    const [action, idx] = (q.data || "").split(":");
    const userId = q.from.id;

    if (action === "route" && idx === "refresh") {
      await bot.answerCallbackQuery(q.id, { text: "Ruta actualizada" }).catch(() => {});
      try { await sendRoute(q.message.chat.id, userId); } catch (e) { console.error("route refresh error:", e.message); }
      return;
    }
    if (action === "route" && idx === "search") {
      setState(userId, { step: "searching" });
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return bot.sendMessage(q.message.chat.id, "🔍 Escribe parte del *nombre o dirección* de la parada:", { parse_mode: "Markdown" });
    }
    if (action !== "ci") return bot.answerCallbackQuery(q.id).catch(() => {});

    const st = getState(userId);
    const point = (st.routeMap || [])[parseInt(idx, 10)];
    if (!point) {
      await bot.answerCallbackQuery(q.id, { text: "Pulsa /route otra vez.", show_alert: true }).catch(() => {});
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
      `📍 Check-in en *${esc(point.name || point.address || point.id)}*.\n\n*Paso 1 de 2* — envía tu ubicación:`,
      { parse_mode: "Markdown", reply_markup: locationKb });
  });

  // ── Location ─────────────────────────────────────────────────────────────────
  bot.on("location", (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const st = getState(userId);
    if (st.step !== "waiting_location") return;
    const { latitude, longitude } = msg.location;

    // Geofence: if the point already has coords and a radius is configured, the worker
    // must be within it. First check-in (no coords yet) is always accepted.
    const fence = geofenceOk(
      { lat: st.pointLat, lng: st.pointLng, geolocated: st.pointGeolocated },
      latitude, longitude, config.GEOFENCE_METERS);
    if (!fence.ok) {
      return bot.sendMessage(msg.chat.id,
        `⚠️ Estás a *${fence.distance} m* de *${esc(st.pointName)}* (máximo ${config.GEOFENCE_METERS} m).\nAcércate al punto y vuelve a enviar tu ubicación.`,
        { parse_mode: "Markdown", reply_markup: locationKb });
    }
    setState(userId, {
      step: "waiting_photos",
      lat: latitude, lng: longitude,
      mapsLink: `https://www.google.com/maps?q=${latitude},${longitude}`,
      photos: [],
    });
    bot.sendMessage(msg.chat.id,
      "✅ Ubicación recibida.\n\n📸 *Paso 2 de 2* — envía una o varias fotos y luego pulsa *✅ Terminar*.\n(Si no hace falta foto, puedes pulsar *✅ Terminar* directamente.)",
      { parse_mode: "Markdown", reply_markup: doneKb });
  });

  // ── Contact → register by phone ──────────────────────────────────────────────
  bot.on("contact", async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    // Only trust the user's OWN shared contact (Telegram sets user_id on it).
    if (msg.contact.user_id && String(msg.contact.user_id) !== String(userId)) {
      return bot.sendMessage(msg.chat.id, "Por favor, comparte *tu propio* número de teléfono.", { parse_mode: "Markdown", reply_markup: contactKb });
    }
    try {
      const already = await findWorker(userId);
      if (already) return bot.sendMessage(msg.chat.id, `✅ Ya estás registrado como *${esc(already.name)}*. Pulsa /route.`, { parse_mode: "Markdown", reply_markup: removeKb });

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
        setState(userId, { tenantId: hit.tenant.id });
        return bot.sendMessage(msg.chat.id,
          `✅ ¡Registrado como *${esc(hit.worker.name || "trabajador")}* en *${esc(hit.tenant.name)}*!\n\nPulsa /route para ver tus paradas y empezar a hacer check-in.`,
          { parse_mode: "Markdown", reply_markup: removeKb });
      }

      // Unknown number → NOT allowed in (roster-controlled; no self-onboarding). Record the
      // attempt against the deep-link company if we know it, so its manager can add them.
      const attemptName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ").trim()
        || (msg.from.username ? "@" + msg.from.username : "");
      const regT = st.regTenantId ? config.tenants.byId(st.regTenantId) : null;
      if (regT) { try { await require("../pending").add(forTenant(regT), msg.contact.phone_number, attemptName); } catch (e) {} }
      bot.sendMessage(msg.chat.id,
        "⚠️ Tu número no está en el sistema.\n\nPide a tu responsable que te dé de alta con *este mismo teléfono*, o que te pase el *enlace de tu empresa*, y vuelve a pulsar /start.",
        { parse_mode: "Markdown", reply_markup: removeKb });
    } catch (e) {
      console.error("contact/register error:", e.message);
      bot.sendMessage(msg.chat.id, "⚠️ No pude completar el registro. Inténtalo de nuevo en un momento.", { reply_markup: removeKb });
    }
  });

  // ── Photos ───────────────────────────────────────────────────────────────────
  bot.on("photo", (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    const st = getState(userId);
    if (st.step !== "waiting_photos") return;
    const photos = st.photos || [];
    photos.push(msg.photo[msg.photo.length - 1].file_id);
    setState(userId, { photos });
    bot.sendMessage(msg.chat.id, `📸 Foto ${photos.length} recibida. Envía más o pulsa *✅ Terminar*.`, { parse_mode: "Markdown", reply_markup: doneKb });
  });

  // ── Done / Cancel (plain text from the reply keyboard) ───────────────────────
  bot.on("message", async (msg) => {
    if (msg.chat.type !== "private") return;
    if (msg.location || msg.photo || msg.contact) return;
    const text = (msg.text || "").trim();
    if (text.startsWith("/")) return; // commands handled by onText
    const userId = msg.from.id;
    const st = getState(userId);

    if (text === BTN_CANCEL) {
      clearState(userId);
      return bot.sendMessage(msg.chat.id, "Cancelado.", { reply_markup: removeKb });
    }

    // Worker typed a search query after tapping "🔍 Buscar parada" → show matching stops.
    if (st.step === "searching") {
      try { await sendRoute(msg.chat.id, userId, text); }
      catch (e) { console.error("route search error:", e.message); bot.sendMessage(msg.chat.id, "⚠️ No pude buscar. Pulsa /route."); }
      return;
    }

    if (text === BTN_DONE) {
      if (st.step !== "waiting_photos") return bot.sendMessage(msg.chat.id, "No hay nada que terminar. Pulsa /route para empezar.", { reply_markup: removeKb });
      try {
        const worker = st.worker || await findWorker(userId);
        const src = srcOf(userId);
        if (!src) return bot.sendMessage(msg.chat.id, "⚠️ Sesión caducada. Pulsa /route otra vez.", { reply_markup: removeKb });
        // A.2 — Photo may be required per company.
        if (!(st.photos || []).length && String(await src.getSetting("photo_required", "0")) === "1") {
          return bot.sendMessage(msg.chat.id, "📸 Esta empresa exige al menos una foto. Envía una foto y luego pulsa *✅ Terminar*.", { parse_mode: "Markdown", reply_markup: doneKb });
        }
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
          note: "",
        });
        // First check-in fixes the point's coordinates (only if still empty).
        try { await src.ensurePointLocation(st.pointId, st.lat, st.lng); }
        catch (e) { console.error("ensurePointLocation error:", e.message); }
        clearState(userId);
        bot.sendMessage(msg.chat.id,
          `✅ *Check-in guardado* en *${esc(st.pointName)}*.\n📸 Fotos: ${(st.photos || []).length}\n🆔 ${esc(visitId)}\n\nPulsa /route para la siguiente parada.`,
          { parse_mode: "Markdown", reply_markup: removeKb });
      } catch (e) {
        console.error("finalize error:", e.message);
        bot.sendMessage(msg.chat.id, "⚠️ No pude guardar el check-in. Pulsa *✅ Terminar* de nuevo.", { parse_mode: "Markdown", reply_markup: doneKb });
      }
    }
  });

  bot.setMyCommands([
    { command: "start", description: "Iniciar / registrarse" },
    { command: "route", description: "Ver mis paradas y hacer check-in" },
  ]).catch(() => {});

  bot.on("polling_error", (e) => console.error("polling_error:", e.message));
}

module.exports = { attachHandlers };
