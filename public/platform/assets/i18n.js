/* StarX i18n — runtime translation for the whole platform (ES source → EN / UK).
 *
 * Strategy: the app is authored in Spanish. This layer translates by SOURCE STRING:
 *  - a MutationObserver watches the DOM, so anything app.js renders (tables, toasts,
 *    modals, empty states…) is translated automatically — no per-string wiring needed;
 *  - elements with data-i18n="key" get their innerHTML replaced (for rich text with <b>);
 *  - LF.t(es) translates transient strings (confirm dialogs, interpolated toasts).
 * Language is persisted in localStorage("starx-lang"), shared with the landing page.
 */
(function () {
  "use strict";

  // ── Dictionary: Spanish source → { en, uk } ──────────────────────────────────
  var T = {
    // Nav / shell
    "Menú": ["Menu", "Меню"],
    "Plataforma": ["Platform", "Платформа"],
    "Herramientas": ["Tools", "Інструменти"],
    "Panel": ["Dashboard", "Панель"],
    "Puntos": ["Points", "Точки"],
    "Trabajadores": ["Workers", "Працівники"],
    "Visitas": ["Visits", "Візити"],
    "Estadísticas": ["Statistics", "Статистика"],
    "Bot de Telegram": ["Telegram bot", "Telegram-бот"],
    "Importar y configurar": ["Import & setup", "Імпорт і налаштування"],
    "Check-ins de campo con GPS y fotos.": ["Field check-ins with GPS and photos.", "Польові чек-іни з GPS і фото."],
    "Salir": ["Log out", "Вийти"],
    // Dashboard
    "Actividad de campo: quién fue a dónde, cuándo y con prueba.": ["Field activity: who went where, when, and with proof.", "Польова активність: хто, куди, коли й з доказом."],
    "Check-ins totales": ["Total check-ins", "Усього чек-інів"],
    "desde el inicio": ["since the start", "від початку"],
    "Hoy": ["Today", "Сьогодні"],
    "check-ins de hoy": ["today's check-ins", "чек-іни за сьогодні"],
    "Puntos activos": ["Active points", "Активні точки"],
    "paradas a visitar": ["stops to visit", "точки для відвідування"],
    "Trabajadores activos": ["Active workers", "Активні працівники"],
    "personal de campo": ["field staff", "польовий персонал"],
    "Todos los trabajadores": ["All workers", "Усі працівники"],
    "Todas las fuentes": ["All sources", "Усі джерела"],
    "App (PWA)": ["App (PWA)", "Додаток (PWA)"],
    "Desde": ["From", "Від"],
    "Hasta": ["To", "До"],
    "Limpiar": ["Clear", "Очистити"],
    "Limpiar fechas": ["Clear dates", "Очистити дати"],
    "Visitas por día": ["Visits per day", "Візити за день"],
    "Sin datos aún": ["No data yet", "Ще немає даних"],
    "Sin datos": ["No data", "Немає даних"],
    "Check-ins por fuente": ["Check-ins by source", "Чек-іни за джерелом"],
    "Check-ins por día de la semana": ["Check-ins by weekday", "Чек-іни за днями тижня"],
    "Check-ins por hora del día": ["Check-ins by hour of day", "Чек-іни за годинами дня"],
    "Top trabajadores": ["Top workers", "Топ працівників"],
    "Puntos más visitados": ["Most-visited points", "Найвідвідуваніші точки"],
    "Últimos check-ins en el mapa": ["Latest check-ins on the map", "Останні чек-іни на карті"],
    "Estado del sistema": ["System status", "Стан системи"],
    "Comprobando…": ["Checking…", "Перевірка…"],
    "Fuente de datos": ["Data source", "Джерело даних"],
    "Conectada": ["Connected", "Підключено"],
    "Aplicación web": ["Web app", "Вебдодаток"],
    "En línea": ["Online", "Онлайн"],
    // Points
    "Las paradas que tus trabajadores deben visitar.": ["The stops your workers must visit.", "Точки, які мають відвідати ваші працівники."],
    "Añadir punto": ["Add point", "Додати точку"],
    "Buscar por nombre o dirección…": ["Search by name or address…", "Пошук за назвою або адресою…"],
    "— Sin asignar —": ["— Unassigned —", "— Не призначено —"],
    "Asignar seleccionados": ["Assign selected", "Призначити вибрані"],
    "Cargando…": ["Loading…", "Завантаження…"],
    "Aún no hay puntos. Añade uno o importa desde Excel.": ["No points yet. Add one or import from Excel.", "Ще немає точок. Додайте або імпортуйте з Excel."],
    "Ningún punto coincide con el filtro.": ["No point matches the filter.", "Жодна точка не відповідає фільтру."],
    "Nombre": ["Name", "Назва"],
    "Dirección": ["Address", "Адреса"],
    "Trabajador": ["Worker", "Працівник"],
    "Trabajador asignado": ["Assigned worker", "Призначений працівник"],
    "Actividad": ["Activity", "Активність"],
    "Geo": ["Geo", "Гео"],
    "Estado": ["Status", "Статус"],
    "Acciones": ["Actions", "Дії"],
    "Editar": ["Edit", "Редагувати"],
    "Borrar": ["Delete", "Видалити"],
    "sí": ["yes", "так"],
    "pendiente": ["pending", "очікує"],
    "— sin asignar —": ["— unassigned —", "— не призначено —"],
    "sin visitas": ["no visits", "немає візитів"],
    "activo": ["active", "активний"],
    "inactivo": ["inactive", "неактивний"],
    "Latitud": ["Latitude", "Широта"],
    "Longitud": ["Longitude", "Довгота"],
    "Activo": ["Active", "Активний"],
    "Inactivo": ["Inactive", "Неактивний"],
    "ID interno (automático)": ["Internal ID (auto)", "Внутрішній ID (авто)"],
    "ID interno": ["Internal ID", "Внутрішній ID"],
    "ID de Telegram": ["Telegram ID", "Telegram ID"],
    "Teléfono": ["Phone", "Телефон"],
    "solo números": ["digits only", "лише цифри"],
    "Editar punto": ["Edit point", "Редагувати точку"],
    "Editar trabajador": ["Edit worker", "Редагувати працівника"],
    "Añadir trabajador": ["Add worker", "Додати працівника"],
    "Guardar": ["Save", "Зберегти"],
    "Cancelar": ["Cancel", "Скасувати"],
    "Editar": ["Edit", "Редагувати"],
    // Workers
    "Buscar por nombre, teléfono o ID…": ["Search by name, phone or ID…", "Пошук за іменем, телефоном або ID…"],
    "Aún no hay trabajadores. Añade uno o importa desde Excel.": ["No workers yet. Add one or import from Excel.", "Ще немає працівників. Додайте або імпортуйте з Excel."],
    "Ningún trabajador coincide con la búsqueda.": ["No worker matches the search.", "Жоден працівник не відповідає пошуку."],
    "Añadir": ["Add", "Додати"],
    "Descartar": ["Dismiss", "Відхилити"],
    // Visits
    "Registro de check-ins con GPS y fotos. Escritos por el bot en tiempo real.": ["Check-in log with GPS and photos. Written by the bot in real time.", "Журнал чек-інів з GPS і фото. Записує бот у реальному часі."],
    "Descargar CSV": ["Download CSV", "Завантажити CSV"],
    "Actualizar": ["Refresh", "Оновити"],
    "Buscar por trabajador, punto o nota…": ["Search by worker, point or note…", "Пошук за працівником, точкою або нотаткою…"],
    "Aún no hay check-ins.": ["No check-ins yet.", "Ще немає чек-інів."],
    "Ningún check-in coincide con el filtro.": ["No check-in matches the filter.", "Жоден чек-ін не відповідає фільтру."],
    "Hora": ["Time", "Час"],
    "Punto": ["Point", "Точка"],
    "Ubicación": ["Location", "Локація"],
    "Fotos": ["Photos", "Фото"],
    "Nota": ["Note", "Нотатка"],
    // Stats
    "Rendimiento del equipo y de cada trabajador, por periodo.": ["Team and per-worker performance, by period.", "Показники команди та кожного працівника за період."],
    "Empresa": ["Company", "Компанія"],
    "Personal": ["Personal", "Особистий"],
    "Elige un trabajador…": ["Choose a worker…", "Оберіть працівника…"],
    "Últimos 7 días": ["Last 7 days", "Останні 7 днів"],
    "Últimos 30 días": ["Last 30 days", "Останні 30 днів"],
    "Últimos 90 días": ["Last 90 days", "Останні 90 днів"],
    "Todo el histórico": ["All time", "Уся історія"],
    "Check-ins": ["Check-ins", "Чек-іни"],
    "Días activos": ["Active days", "Активні дні"],
    "Media por día activo": ["Avg per active day", "Середнє за активний день"],
    "Puntos cubiertos": ["Points covered", "Охоплені точки"],
    "Puntos distintos": ["Distinct points", "Різні точки"],
    "en el periodo": ["in the period", "за період"],
    "con al menos 1 check-in": ["with at least 1 check-in", "щонайменше 1 чек-ін"],
    "check-ins": ["check-ins", "чек-іни"],
    "visitados al menos una vez": ["visited at least once", "відвідані принаймні раз"],
    "paradas diferentes visitadas": ["distinct stops visited", "різні відвідані точки"],
    "de": ["of", "з"],
    "activos": ["active", "активних"],
    "Mostrando": ["Showing", "Показано"],
    "Filtrado:": ["Filtered:", "Відфільтровано:"],
    "check-ins recientes": ["recent check-ins", "останніх чек-інів"],
    "Los KPIs de arriba son totales globales.": ["The KPIs above are global totals.", "Показники вгорі — загальні підсумки."],
    "elige un trabajador": ["choose a worker", "оберіть працівника"],
    "Actividad en el periodo": ["Activity in the period", "Активність за період"],
    "Actividad de la empresa": ["Company activity", "Активність компанії"],
    "Cobertura de sus puntos asignados": ["Coverage of their assigned points", "Покриття призначених точок"],
    "Sus puntos más visitados": ["Their most-visited points", "Їхні найвідвідуваніші точки"],
    "Últimos check-ins": ["Latest check-ins", "Останні чек-іни"],
    "Elige un trabajador arriba.": ["Choose a worker above.", "Оберіть працівника вгорі."],
    "No tiene puntos asignados.": ["No assigned points.", "Немає призначених точок."],
    "Sin check-ins en este periodo.": ["No check-ins in this period.", "Немає чек-інів за цей період."],
    "Sin check-ins en este periodo": ["No check-ins in this period", "Немає чек-інів за цей період"],
    "Sin check-ins en este rango": ["No check-ins in this range", "Немає чек-інів у цьому діапазоні"],
    "puntos sin visitar en el periodo": ["points not visited in the period", "точки без візитів за період"],
    "trabajadores sin actividad": ["workers with no activity", "працівники без активності"],
    "puntos sin geolocalizar": ["points without geolocation", "точки без геолокації"],
    "puntos sin asignar": ["unassigned points", "непризначені точки"],
    // Bot page
    "Tus trabajadores hacen check-in desde el chat que ya usan. Cero instalación.": ["Your workers check in from the chat they already use. Zero install.", "Ваші працівники відмічаються в чаті, яким уже користуються. Нуль встановлення."],
    "Estado del bot": ["Bot status", "Стан бота"],
    "Encender bot": ["Turn on bot", "Увімкнути бота"],
    "Apagar bot": ["Turn off bot", "Вимкнути бота"],
    "Cómo registran tus trabajadores": ["How your workers register", "Як реєструються ваші працівники"],
    "Enlace de alta para tus trabajadores": ["Sign-up link for your workers", "Посилання для реєстрації працівників"],
    "Copiar": ["Copy", "Копіювати"],
    // Import / billing
    "Trae tus datos: sube puntos o trabajadores desde Excel/CSV, o prepara tu Google Sheet.": ["Bring your data: upload points or workers from Excel/CSV, or set up your Google Sheet.", "Додайте дані: завантажте точки чи працівників з Excel/CSV або підготуйте Google Sheet."],
    "Tu suscripción": ["Your subscription", "Ваша підписка"],
    "Importar desde Excel / CSV": ["Import from Excel / CSV", "Імпорт з Excel / CSV"],
    "¿Qué vas a importar?": ["What are you importing?", "Що імпортуєте?"],
    "Puntos (paradas a visitar)": ["Points (stops to visit)", "Точки (для відвідування)"],
    "Trabajadores (personal de campo)": ["Workers (field staff)", "Працівники (польовий персонал)"],
    "Importar filas": ["Import rows", "Імпортувати рядки"],
    "¿Cómo preparar tu Excel?": ["How to prepare your Excel?", "Як підготувати Excel?"],
    "obligatorio": ["required", "обовʼязково"],
    "opcional": ["optional", "необовʼязково"],
    "App de check-in (PWA)": ["Check-in app (PWA)", "Додаток чек-іну (PWA)"],
    "Activar PWA": ["Enable PWA", "Увімкнути PWA"],
    "Desactivar PWA": ["Disable PWA", "Вимкнути PWA"],
    "Conexión por API (conector)": ["API connection (connector)", "Підключення через API (конектор)"],
    "Regenerar clave": ["Regenerate key", "Згенерувати новий ключ"],
    "Preparar un Google Sheet": ["Set up a Google Sheet", "Підготувати Google Sheet"],
    "Configurar hoja": ["Set up sheet", "Налаштувати таблицю"],
    // Check-in (worker PWA)
    "Hacer check-in": ["Check in", "Зробити чек-ін"],
    "Elige tu parada, comparte tu ubicación y añade una foto.": ["Pick your stop, share your location and add a photo.", "Оберіть точку, поділіться локацією й додайте фото."],
    "Parada": ["Stop", "Точка"],
    "Cargando paradas…": ["Loading stops…", "Завантаження точок…"],
    "Usar mi ubicación": ["Use my location", "Використати мою локацію"],
    "Aún no capturada.": ["Not captured yet.", "Ще не отримано."],
    "Foto (opcional)": ["Photo (optional)", "Фото (необовʼязково)"],
    "Nota (opcional)": ["Note (optional)", "Нотатка (необовʼязково)"],
    "Comentario breve": ["Short comment", "Короткий коментар"],
    "Enviar check-in": ["Send check-in", "Надіслати чек-ін"],
    "No hay paradas asignadas": ["No assigned stops", "Немає призначених точок"],
    // Common toasts / confirms
    "Guardado": ["Saved", "Збережено"],
    "Borrado": ["Deleted", "Видалено"],
    "Punto añadido": ["Point added", "Точку додано"],
    "Trabajador añadido": ["Worker added", "Працівника додано"],
    "¿Borrar este punto?": ["Delete this point?", "Видалити цю точку?"],
    "¿Borrar este trabajador?": ["Delete this worker?", "Видалити цього працівника?"],
    "Bot encendido": ["Bot turned on", "Бота увімкнено"],
    "Bot apagado": ["Bot turned off", "Бота вимкнено"],
    "¿Apagar el bot? Los trabajadores no podrán hacer check-in hasta que vuelva a encenderse.": ["Turn off the bot? Workers won't be able to check in until it's back on.", "Вимкнути бота? Працівники не зможуть відмічатися, доки його не ввімкнуть знову."],
    "PWA activada": ["PWA enabled", "PWA увімкнено"],
    "PWA desactivada": ["PWA disabled", "PWA вимкнено"],
    "Clave copiada": ["Key copied", "Ключ скопійовано"],
    "Clave regenerada": ["Key regenerated", "Ключ згенеровано"],
    "Check-in enviado": ["Check-in sent", "Чек-ін надіслано"],
    "Elige una parada.": ["Pick a stop.", "Оберіть точку."],
    "Captura tu ubicación primero.": ["Capture your location first.", "Спершу отримайте локацію."],
    "Obteniendo ubicación…": ["Getting location…", "Отримання локації…"],
    "No se pudo obtener la ubicación. Permite el acceso e inténtalo de nuevo.": ["Couldn't get the location. Allow access and try again.", "Не вдалося отримати локацію. Дозвольте доступ і спробуйте ще раз."],
    "Este dispositivo no permite geolocalización.": ["This device doesn't support geolocation.", "Цей пристрій не підтримує геолокацію."],
    "Sin conexión: guardado. Se enviará al recuperar señal.": ["Offline: saved. It will send when the signal returns.", "Без зʼєднання: збережено. Надішлеться, коли відновиться сигнал."],
    "¿Regenerar la clave? La anterior dejará de funcionar de inmediato.": ["Regenerate the key? The old one stops working immediately.", "Згенерувати новий ключ? Старий одразу перестане працювати."],
    "¿Crear las pestañas workers / points / visits en tu hoja conectada?": ["Create the workers / points / visits tabs in your connected sheet?", "Створити вкладки workers / points / visits у підключеній таблиці?"],
    "La hoja ya está lista": ["The sheet is already set up", "Таблиця вже готова"],
    "Selecciona al menos un punto.": ["Select at least one point.", "Виберіть принаймні одну точку."],
    // Login / signup
    "Plataforma de check-in de campo": ["Field check-in platform", "Платформа польових чек-інів"],
    "Gestor": ["Manager", "Керівник"],
    "Crear empresa": ["Create company", "Створити компанію"],
    "Contraseña incorrecta. Inténtalo de nuevo.": ["Wrong password. Try again.", "Невірний пароль. Спробуйте ще раз."],
    "Contraseña": ["Password", "Пароль"],
    "Iniciar sesión": ["Log in", "Увійти"],
    "Nombre de tu empresa": ["Your company name", "Назва вашої компанії"],
    "Mi Logística S.L.": ["My Logistics Ltd.", "ТОВ «Моя логістика»"],
    "Contraseña de gestor": ["Manager password", "Пароль керівника"],
    "mínimo 6 caracteres": ["at least 6 characters", "щонайменше 6 символів"],
    "Crear empresa y empezar prueba": ["Create company & start trial", "Створити компанію й почати пробний період"],
    "14 días de prueba gratis, sin tarjeta.": ["14-day free trial, no card.", "14 днів безкоштовно, без картки."],
    "Tu número de teléfono": ["Your phone number", "Ваш номер телефону"],
    "Código de empresa": ["Company code", "Код компанії"],
    "(opcional)": ["(optional)", "(необовʼязково)"],
    "solo si te lo pidieron": ["only if you were asked", "лише якщо просили"],
    "Entrar": ["Enter", "Увійти"]
  };

  // ── Rich-text keys (element innerHTML via data-i18n) ──────────────────────────
  var HTML = {
    "points.help": [
      'Para asignar un trabajador: marca una o varias casillas y usa <b>Asignar seleccionados</b>, o pulsa <b>Editar</b> en un punto y elige el trabajador.',
      'To assign a worker: tick one or more boxes and use <b>Assign selected</b>, or click <b>Edit</b> on a point and choose the worker.',
      'Щоб призначити працівника: позначте одну чи кілька галочок і натисніть <b>Призначити вибрані</b>, або натисніть <b>Редагувати</b> на точці й оберіть працівника.'
    ],
    "workers.lead": [
      'Tu personal de campo. Cárgalos con su <b>teléfono</b>; se enlazan solos al compartir su número en el bot.',
      'Your field staff. Load them with their <b>phone</b>; they link themselves by sharing their number in the bot.',
      'Ваш польовий персонал. Додайте їх за <b>телефоном</b>; вони привʼяжуться самі, поділившись номером у боті.'
    ]
  };

  var LANGS = { es: 0, en: 1, uk: 2 };
  var lang = "es";
  try {
    var saved = localStorage.getItem("starx-lang");
    var nav = (navigator.language || "es").slice(0, 2);
    lang = saved || (LANGS[nav] != null ? nav : "es");
  } catch (e) {}

  function t(es) {
    if (lang === "es" || es == null) return es;
    var key = String(es).trim();
    var row = T[key];
    if (!row) return es;
    var val = row[LANGS[lang] - 1]; // en=index0, uk=index1 within the pair
    return val == null ? es : String(es).replace(key, val);
  }

  // Cache the original ES text on each node so we can re-translate on language switch.
  function translateTextNode(n) {
    var orig = n.__lfes != null ? n.__lfes : (n.__lfes = n.nodeValue);
    var target = lang === "es" ? orig : t(orig);
    if (n.nodeValue !== target) n.nodeValue = target;
  }
  function translateAttr(el, attr) {
    var v = el.getAttribute(attr);
    if (v == null) return;
    var key = "__lf_" + attr;
    var orig = el[key] != null ? el[key] : (el[key] = v);
    var target = lang === "es" ? orig : t(orig);
    if (el.getAttribute(attr) !== target) el.setAttribute(attr, target);
  }
  function translateEl(el) {
    if (el.hasAttribute && el.hasAttribute("data-i18n")) {
      var k = el.getAttribute("data-i18n"), row = HTML[k];
      if (row) {
        if (el.__lfhtml == null) el.__lfhtml = row[0];
        el.innerHTML = lang === "es" ? row[0] : (row[LANGS[lang]] || row[0]);
        return; // children handled
      }
    }
    if (el.placeholder != null && el.getAttribute("placeholder")) translateAttr(el, "placeholder");
  }
  function walk(root) {
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    var tag = root.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "PRE") return;
    translateEl(root);
    if (root.getAttribute && root.getAttribute("data-i18n") && HTML[root.getAttribute("data-i18n")]) return;
    for (var n = root.firstChild; n; n = n.nextSibling) walk(n);
  }

  var observer = null, applying = false;
  function apply() {
    applying = true;
    try { walk(document.body); } finally { applying = false; }
  }
  function setLang(l) {
    if (!(l in LANGS)) return;
    lang = l;
    try { localStorage.setItem("starx-lang", l); } catch (e) {}
    document.documentElement.lang = l;
    document.querySelectorAll("[data-lang-btn]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang-btn") === l);
    });
    apply();
    // Let the app re-render the current view so strings built in JS (LF.t + interpolation)
    // pick up the new language too.
    try { window.dispatchEvent(new CustomEvent("lf-lang", { detail: l })); } catch (e) {}
  }

  function start() {
    document.documentElement.lang = lang;
    apply();
    // Watch for anything app.js renders and translate the added nodes.
    observer = new MutationObserver(function (muts) {
      if (applying) return;
      applying = true;
      try {
        muts.forEach(function (m) {
          if (m.type === "childList") m.addedNodes.forEach(function (n) { walk(n); });
          else if (m.type === "characterData") translateTextNode(m.target);
        });
      } finally { applying = false; }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    // Wire any language switcher present.
    var box = document.getElementById("lang-switch");
    if (box) box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lang-btn]"); if (b) setLang(b.getAttribute("data-lang-btn"));
    });
    document.querySelectorAll("[data-lang-btn]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang-btn") === lang);
    });
  }

  window.LF = window.LF || {};
  window.LF.t = t;
  window.LF.setLang = setLang;
  window.LF.lang = function () { return lang; };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
