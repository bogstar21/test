// StarX Telegram bot — message dictionary (es / en / uk). Mirrors the platform's i18n
// approach (Spanish-authored source, translated at the edges) but the bot can't run a
// DOM MutationObserver, so every outgoing string is looked up explicitly through L().
//
// The tenant's bot language lives in a per-tenant setting ("bot_lang", default "es"),
// set from the platform's Ajustes screen. handlers.js resolves it once a user's tenant
// is known and passes `lang` into every L() call.
"use strict";

const DEFAULT_LANG = "es";
const LANGS = ["es", "en", "uk"];

const T = {
  welcome_new: {
    es: "👋 Bienvenido a *StarX*.\n\nPara registrarte, comparte tu número de teléfono con el botón de abajo y te enlazaré con tu perfil.",
    en: "👋 Welcome to *StarX*.\n\nTo register, share your phone number with the button below and I'll link you to your profile.",
    uk: "👋 Ласкаво просимо до *StarX*.\n\nЩоб зареєструватися, поділіться номером телефону кнопкою нижче — і я привʼяжу вас до вашого профілю.",
  },
  welcome_new_company: {
    es: "👋 Bienvenido a *StarX* de *{company}*.\n\nPara registrarte, comparte tu número de teléfono con el botón de abajo y te enlazaré con tu perfil.",
    en: "👋 Welcome to *{company}*'s *StarX*.\n\nTo register, share your phone number with the button below and I'll link you to your profile.",
    uk: "👋 Ласкаво просимо до *StarX* компанії *{company}*.\n\nЩоб зареєструватися, поділіться номером телефону кнопкою нижче — і я привʼяжу вас до вашого профілю.",
  },
  hello_back: {
    es: "👋 ¡Hola *{name}*!\n\nPulsa /route para ver tus paradas y empezar a hacer check-in.",
    en: "👋 Hi *{name}*!\n\nTap /route to see your stops and start checking in.",
    uk: "👋 Привіт, *{name}*!\n\nНатисніть /route, щоб побачити свої точки та почати чек-ін.",
  },
  db_error: {
    es: "⚠️ No pude conectar con la base de datos. Inténtalo de nuevo en un momento.",
    en: "⚠️ Couldn't connect to the database. Please try again in a moment.",
    uk: "⚠️ Не вдалося підключитися до бази даних. Спробуйте ще раз за хвилину.",
  },
  no_points_assigned: {
    es: "Todavía no tienes paradas asignadas. Pídele a tu responsable que te las asigne.",
    en: "You don't have any assigned stops yet. Ask your manager to assign you some.",
    uk: "У вас ще немає призначених точок. Попросіть керівника призначити вам їх.",
  },
  route_header: {
    es: "🗺 *Tus paradas* — {done}/{total} hechas hoy.{more}\nPulsa una para hacer check-in (✅ = ya hecha hoy):",
    en: "🗺 *Your stops* — {done}/{total} done today.{more}\nTap one to check in (✅ = already done today):",
    uk: "🗺 *Ваші точки* — {done}/{total} виконано сьогодні.{more}\nНатисніть, щоб зробити чек-ін (✅ = вже виконано сьогодні):",
  },
  route_more_suffix: {
    es: "\nTienes *{total}* paradas — muestro tus *{page} más usadas*. Pulsa *🔍 Buscar parada* para encontrar cualquier otra por nombre.",
    en: "\nYou have *{total}* stops — showing your *{page} most used*. Tap *🔍 Search stop* to find any other by name.",
    uk: "\nУ вас *{total}* точок — показую *{page} найчастіших*. Натисніть *🔍 Пошук точки*, щоб знайти іншу за назвою.",
  },
  route_search_results: {
    es: '🔎 *{count}* resultado(s) para "{q}"{more}:',
    en: '🔎 *{count}* result(s) for "{q}"{more}:',
    uk: '🔎 *{count}* результат(и) для "{q}"{more}:',
  },
  route_search_more: {
    es: " (mostrando {page}, afina la búsqueda)",
    en: " (showing {page}, refine your search)",
    uk: " (показано {page}, уточніть пошук)",
  },
  route_search_none: {
    es: '🔎 Nada coincide con "{q}".\nPulsa *🔍 Buscar parada* para probar otra vez.',
    en: '🔎 Nothing matches "{q}".\nTap *🔍 Search stop* to try again.',
    uk: '🔎 Нічого не знайдено за "{q}".\nНатисніть *🔍 Пошук точки*, щоб спробувати ще раз.',
  },
  route_load_error: {
    es: "⚠️ No pude cargar tu ruta. Inténtalo de nuevo en un momento.",
    en: "⚠️ Couldn't load your route. Please try again in a moment.",
    uk: "⚠️ Не вдалося завантажити маршрут. Спробуйте ще раз за хвилину.",
  },
  route_updated: {
    es: "Ruta actualizada", en: "Route refreshed", uk: "Маршрут оновлено",
  },
  search_prompt: {
    es: "🔍 Escribe parte del *nombre o dirección* de la parada:",
    en: "🔍 Type part of the stop's *name or address*:",
    uk: "🔍 Введіть частину *назви або адреси* точки:",
  },
  tap_route_again: {
    es: "Pulsa /route otra vez.", en: "Tap /route again.", uk: "Натисніть /route ще раз.",
  },
  checkin_step1: {
    es: "📍 Check-in en *{point}*.\n\n*Paso 1 de 2* — envía tu ubicación:",
    en: "📍 Check-in at *{point}*.\n\n*Step 1 of 2* — send your location:",
    uk: "📍 Чек-ін у *{point}*.\n\n*Крок 1 з 2* — надішліть свою локацію:",
  },
  geofence_too_far: {
    es: "⚠️ Estás a *{dist} m* de *{point}* (máximo {max} m).\nAcércate al punto y vuelve a enviar tu ubicación.",
    en: "⚠️ You're *{dist} m* from *{point}* (max {max} m).\nGet closer to the point and send your location again.",
    uk: "⚠️ Ви за *{dist} м* від *{point}* (максимум {max} м).\nПідійдіть ближче й надішліть локацію ще раз.",
  },
  location_received: {
    es: "✅ Ubicación recibida.\n\n📸 *Paso 2 de 2* — envía una o varias fotos y luego pulsa *✅ Terminar*.\n(Si no hace falta foto, puedes pulsar *✅ Terminar* directamente.)",
    en: "✅ Location received.\n\n📸 *Step 2 of 2* — send one or more photos, then tap *✅ Done*.\n(If no photo is needed, you can tap *✅ Done* right away.)",
    uk: "✅ Локацію отримано.\n\n📸 *Крок 2 з 2* — надішліть одне чи кілька фото, потім натисніть *✅ Готово*.\n(Якщо фото не потрібне, одразу натисніть *✅ Готово*.)",
  },
  share_own_phone_only: {
    es: "Por favor, comparte *tu propio* número de teléfono.",
    en: "Please share *your own* phone number.",
    uk: "Будь ласка, поділіться *своїм власним* номером телефону.",
  },
  already_registered: {
    es: "✅ Ya estás registrado como *{name}*. Pulsa /route.",
    en: "✅ You're already registered as *{name}*. Tap /route.",
    uk: "✅ Ви вже зареєстровані як *{name}*. Натисніть /route.",
  },
  registered_in_company: {
    es: "✅ ¡Registrado como *{name}* en *{company}*!\n\nPulsa /route para ver tus paradas y empezar a hacer check-in.",
    en: "✅ Registered as *{name}* at *{company}*!\n\nTap /route to see your stops and start checking in.",
    uk: "✅ Зареєстровано як *{name}* у *{company}*!\n\nНатисніть /route, щоб побачити свої точки та почати чек-ін.",
  },
  unknown_number: {
    es: "⚠️ Tu número no está en el sistema.\n\nPide a tu responsable que te dé de alta con *este mismo teléfono*, o que te pase el *enlace de tu empresa*, y vuelve a pulsar /start.",
    en: "⚠️ Your number isn't in the system.\n\nAsk your manager to add you with *this same phone number*, or to send you your *company's link*, then tap /start again.",
    uk: "⚠️ Вашого номера немає в системі.\n\nПопросіть керівника додати вас із *цим самим номером телефону* або надіслати вам *посилання вашої компанії*, потім знову натисніть /start.",
  },
  register_error: {
    es: "⚠️ No pude completar el registro. Inténtalo de nuevo en un momento.",
    en: "⚠️ Couldn't complete the registration. Please try again in a moment.",
    uk: "⚠️ Не вдалося завершити реєстрацію. Спробуйте ще раз за хвилину.",
  },
  photo_received: {
    es: "📸 Foto {n} recibida. Envía más o pulsa *✅ Terminar*.",
    en: "📸 Photo {n} received. Send more or tap *✅ Done*.",
    uk: "📸 Фото {n} отримано. Надішліть ще або натисніть *✅ Готово*.",
  },
  session_expired: {
    es: "⚠️ Sesión caducada. Pulsa /route otra vez.",
    en: "⚠️ Session expired. Tap /route again.",
    uk: "⚠️ Сесія закінчилася. Натисніть /route ще раз.",
  },
  photo_required: {
    es: "📸 Esta empresa exige al menos una foto. Envía una foto y luego pulsa *✅ Terminar*.",
    en: "📸 This company requires at least one photo. Send a photo, then tap *✅ Done*.",
    uk: "📸 Ця компанія вимагає щонайменше одне фото. Надішліть фото, потім натисніть *✅ Готово*.",
  },
  comment_prompt: {
    es: "📝 ¿Quieres añadir un comentario? Envía un texto o una nota de voz, o elige una opción rápida (o pulsa *✅ Terminar* para omitir):",
    en: "📝 Want to add a comment? Send text or a voice note, or pick a quick option (or tap *✅ Done* to skip):",
    uk: "📝 Бажаєте додати коментар? Надішліть текст чи голосове повідомлення або оберіть швидкий варіант (або натисніть *✅ Готово*, щоб пропустити):",
  },
  comment_step_error: {
    es: "⚠️ Algo falló. Pulsa *✅ Terminar* de nuevo.",
    en: "⚠️ Something went wrong. Tap *✅ Done* again.",
    uk: "⚠️ Щось пішло не так. Натисніть *✅ Готово* ще раз.",
  },
  checkin_saved: {
    es: "✅ *Check-in guardado* en *{point}*.\n📸 Fotos: {n}\n🆔 {id}\n\nPulsa /route para la siguiente parada.",
    en: "✅ *Check-in saved* at *{point}*.\n📸 Photos: {n}\n🆔 {id}\n\nTap /route for the next stop.",
    uk: "✅ *Чек-ін збережено* у *{point}*.\n📸 Фото: {n}\n🆔 {id}\n\nНатисніть /route для наступної точки.",
  },
  finalize_error: {
    es: "⚠️ No pude guardar el check-in. Pulsa /route otra vez.",
    en: "⚠️ Couldn't save the check-in. Tap /route again.",
    uk: "⚠️ Не вдалося зберегти чек-ін. Натисніть /route ще раз.",
  },
  cancelled: { es: "Cancelado.", en: "Cancelled.", uk: "Скасовано." },
  search_error: {
    es: "⚠️ No pude buscar. Pulsa /route.",
    en: "⚠️ Search failed. Tap /route.",
    uk: "⚠️ Пошук не вдався. Натисніть /route.",
  },
  nothing_to_finish: {
    es: "No hay nada que terminar. Pulsa /route para empezar.",
    en: "There's nothing to finish. Tap /route to start.",
    uk: "Немає що завершувати. Натисніть /route, щоб почати.",
  },

  // ── Keyboard button labels (also compared against incoming text, see handlers.js) ──
  btn_send_location:  { es: "📍 Enviar ubicación",     en: "📍 Send location",       uk: "📍 Надіслати локацію" },
  btn_cancel:         { es: "❌ Cancelar",              en: "❌ Cancel",               uk: "❌ Скасувати" },
  btn_share_phone:    { es: "📱 Compartir mi teléfono", en: "📱 Share my phone",       uk: "📱 Поділитися телефоном" },
  btn_done:           { es: "✅ Terminar",              en: "✅ Done",                 uk: "✅ Готово" },
  btn_search_stop:    { es: "🔍 Buscar parada",         en: "🔍 Search stop",          uk: "🔍 Пошук точки" },
  btn_refresh:        { es: "🔄 Actualizar",            en: "🔄 Refresh",              uk: "🔄 Оновити" },
  btn_note_delivered: { es: "📦 Entregado en recepción",en: "📦 Delivered to front desk", uk: "📦 Передано на ресепшн" },
  btn_note_absent:    { es: "🚪 Cliente no presente",   en: "🚪 Client not present",   uk: "🚪 Клієнта немає на місці" },
  btn_note_damage:    { es: "⚠️ Daños observados",      en: "⚠️ Damage observed",      uk: "⚠️ Виявлено пошкодження" },
  btn_note_skip:      { es: "⏭️ Omitir",                en: "⏭️ Skip",                 uk: "⏭️ Пропустити" },

  // ── Bot command descriptions (BotFather /setcommands menu) ─────────────────────
  cmd_start: { es: "Iniciar / registrarse", en: "Start / register", uk: "Почати / зареєструватися" },
  cmd_route: { es: "Ver mis paradas y hacer check-in", en: "See my stops and check in", uk: "Переглянути точки та зробити чек-ін" },
};

// L(lang, key, params) — look up + fill {tokens}. Falls back to Spanish, then the raw key.
function L(lang, key, params) {
  var row = T[key];
  if (!row) return key;
  var l = LANGS.indexOf(lang) === -1 ? DEFAULT_LANG : lang;
  var tpl = row[l] != null ? row[l] : row[DEFAULT_LANG];
  if (tpl == null) return key;
  if (!params) return tpl;
  return String(tpl).replace(/\{(\w+)\}/g, function (_, k) {
    return params[k] != null ? String(params[k]) : "{" + k + "}";
  });
}

module.exports = { L, DEFAULT_LANG, LANGS };
