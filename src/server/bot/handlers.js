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
  // Single-tenant MVP: the bot serves the default tenant's data.
  function source() { return forTenant(config.defaultTenant()); }

  // ── In-memory per-user state ─────────────────────────────────────────────
  const states = new Map();
  const getState   = id => states.get(id) || { step: "idle" };
  const setState   = (id, s) => states.set(id, { ...getState(id), ...s });
  const clearState = id => states.delete(id);

  // ── Keyboards ────────────────────────────────────────────────────────────
  // Reply keyboards carry a Cancel option during the flow so a worker is never stuck.
  const locationKb = { keyboard: [[{ text: "📍 Enviar ubicación", request_location: true }], [{ text: "❌ Cancelar" }]], resize_keyboard: true, one_time_keyboard: true };
  const contactKb   = { keyboard: [[{ text: "📱 Compartir mi teléfono", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const doneKb      = { keyboard: [[{ text: "✅ Terminar" }, { text: "❌ Cancelar" }]], resize_keyboard: true };
  const removeKb    = { remove_keyboard: true };
  // Button labels reused in message handlers (keep in one place so they can't drift).
  const BTN_DONE = "✅ Terminar", BTN_CANCEL = "❌ Cancelar";

  async function findWorker(telegramId) {
    const workers = await source().listWorkers();
    return workers.find(w => String(w.telegramId) === String(telegramId) && w.active) || null;
  }

  // Point ids this worker already checked in at today (to mark them ✅ in /route).
  // Attributed by the stable workerId (telegramId as fallback for older visits), and
  // "today" follows the company timezone.
  async function visitedTodayIds(worker) {
    const today = localDateStr(null, config.TIMEZONE);
    const visits = await source().listVisits({ limit: 2000 });
    const set = new Set();
    for (const v of visits) {
      if (visitBelongsToWorker(v, worker) && localDateStr(v.timestamp, config.TIMEZONE) === today) {
        set.add(String(v.pointId));
      }
    }
    return set;
  }

  // Prompt an unregistered user to share their phone so we can link them by phone
  // (holodBot-style registration): worker is precargado with a phone, sharing the
  // Telegram contact links their telegram_id to that row.
  function askForContact(chatId) {
    return bot.sendMessage(chatId,
      "👋 Bienvenido a *StarX*.\n\nPara registrarte, comparte tu número de teléfono con el botón de abajo y te enlazaré con tu perfil.",
      { parse_mode: "Markdown", reply_markup: contactKb });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/([_*\[\]()`])/g, "\\$1"); }

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/start/, async (msg) => {
    if (msg.chat.type !== "private") return;
    const userId = msg.from.id;
    try {
      const worker = await findWorker(userId);
      if (!worker) return askForContact(msg.chat.id);
      bot.sendMessage(msg.chat.id,
        `👋 ¡Hola *${esc(worker.name || "compañero")}*!\n\nPulsa /route para ver tus paradas y empezar a hacer check-in.`,
        { parse_mode: "Markdown" });
    } catch (e) {
      bot.sendMessage(msg.chat.id, "⚠️ No pude conectar con la base de datos. Inténtalo de nuevo en un momento.");
      console.error("/start error:", e.message);
    }
  });

  // How many stop buttons to show at once before asking the worker to search instead.
  const ROUTE_PAGE = 12;
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

    const points = (await source().listPointsForWorker(worker.workerId)).filter(p => p.active);
    if (!points.length) return bot.sendMessage(chatId, "Todavía no tienes paradas asignadas. Pídele a tu responsable que te las asigne.");

    const visited = await visitedTodayIds(worker);
    // routeMap stays the FULL list so ci:i callbacks keep pointing at the right stop.
    setState(userId, { step: "route", worker, routeMap: points });
    const doneCount = points.filter(p => visited.has(String(p.id))).length;

    const q = String(query || "").trim();
    // Keep each point's original index in routeMap so filtered buttons still resolve.
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
        ? `\nTienes *${points.length}* paradas — pulsa *🔍 Buscar parada* para encontrar una por nombre.`
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

      const worker = await source().findWorkerByPhone(msg.contact.phone_number);
      if (worker) {
        // Known worker → just link this Telegram account to their profile.
        await source().linkWorkerTelegram(worker.row, userId);
        return bot.sendMessage(msg.chat.id,
          `✅ ¡Registrado como *${esc(worker.name || "trabajador")}*!\n\nPulsa /route para ver tus paradas y empezar a hacer check-in.`,
          { parse_mode: "Markdown", reply_markup: removeKb });
      }

      // Unknown number → auto-create a new worker (self-onboarding).
      const displayName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ").trim()
        || (msg.from.username ? "@" + msg.from.username : "Nuevo trabajador");
      await source().addWorker({
        name: displayName,
        phone: msg.contact.phone_number,
        telegramId: String(userId),
        active: true,
      });
      bot.sendMessage(msg.chat.id,
        `✅ ¡Bienvenido, *${esc(displayName)}*! Ya estás registrado.\n\nTu responsable te asignará las paradas — después pulsa /route para empezar a hacer check-in.`,
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
        const visitId = await source().addVisit({
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
        try { await source().ensurePointLocation(st.pointId, st.lat, st.lng); }
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
