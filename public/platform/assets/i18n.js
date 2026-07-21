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
    "Entrar": ["Enter", "Увійти"],
    // Ajustes / Conexiones (post-reorg)
    "Ajustes": ["Settings", "Налаштування"],
    "Conexiones": ["Connections", "Підключення"],
    "Tu cuenta, permisos y cómo tus trabajadores hacen check-in.": ["Your account, permissions, and how your workers check in.", "Ваш акаунт, дозволи та як ваші працівники відмічаються."],
    "Cómo entran y salen tus datos: sube un Excel/CSV, o conecta tu propio sistema por API.": ["How your data flows in and out: upload an Excel/CSV, or connect your own system via API.", "Як дані потрапляють у систему й назовні: завантажте Excel/CSV або підключіть власну систему через API."],
    "Guía de bienvenida": ["Welcome guide", "Вітальний гід"],
    "Repasa los primeros pasos para dejar StarX listo: importar datos, añadir trabajadores y activar el check-in.": ["Revisit the first steps to get StarX ready: import data, add workers, and turn on check-in.", "Перегляньте перші кроки для налаштування StarX: імпорт даних, додавання працівників і увімкнення чек-іну."],
    "Ver guía de bienvenida": ["View welcome guide", "Переглянути вітальний гід"],
    "Cuenta y permisos": ["Account & permissions", "Акаунт і дозволи"],
    "Contraseña actual": ["Current password", "Поточний пароль"],
    "Nueva contraseña": ["New password", "Новий пароль"],
    "Repite la nueva contraseña": ["Repeat the new password", "Повторіть новий пароль"],
    "Cambiar contraseña": ["Change password", "Змінити пароль"],
    "Reglas de check-in": ["Check-in rules", "Правила чек-іну"],
    "Exige una foto en cada check-in (bot y app). Si está activo, no se acepta un check-in sin foto.": ["Require a photo on every check-in (bot and app). When on, a check-in without a photo is rejected.", "Вимагати фото при кожному чек-іні (бот і застосунок). Якщо увімкнено, чек-ін без фото не приймається."],
    "Foto obligatoria": ["Photo required", "Фото обовʼязкове"],
    "Hacer obligatoria": ["Make required", "Зробити обовʼязковим"],
    "Hacer opcional": ["Make optional", "Зробити необовʼязковим"],
    "Otras integraciones": ["Other integrations", "Інші інтеграції"],
    "Configurar Google Sheet": ["Set up Google Sheet", "Налаштувати Google Sheet"],
    "Google Sheets": ["Google Sheets", "Google Sheets"],
    "Webhooks — próximamente": ["Webhooks — coming soon", "Вебхуки — скоро"],
    "Zapier — próximamente": ["Zapier — coming soon", "Zapier — скоро"],
    // Worker personal view (check-in page)
    "Esta semana": ["This week", "Цього тижня"],
    "últimos 7 días": ["last 7 days", "останні 7 днів"],
    "Total": ["Total", "Усього"],
    "desde siempre": ["all time", "за весь час"],
    "Racha": ["Streak", "Серія"],
    "días seguidos activo": ["consecutive active days", "поспіль активних днів"],
    "Tus paradas asignadas": ["Your assigned stops", "Ваші призначені точки"],
    "Tus últimos check-ins": ["Your recent check-ins", "Ваші останні чек-іни"],
    "Aún no tienes paradas asignadas.": ["You don't have any assigned stops yet.", "У вас ще немає призначених точок."],
    "Aún no tienes check-ins.": ["You don't have any check-ins yet.", "У вас ще немає чек-інів."],
    "hecho hoy": ["done today", "зроблено сьогодні"],
    "Sin visitas todavía": ["No visits yet", "Ще немає візитів"],
    // Weekday / chart labels (SVG bar charts)
    "Lun": ["Mon", "Пн"], "Mar": ["Tue", "Вт"], "Mié": ["Wed", "Ср"], "Jue": ["Thu", "Чт"],
    "Vie": ["Fri", "Пт"], "Sáb": ["Sat", "Сб"], "Dom": ["Sun", "Нд"],
    "Lunes": ["Monday", "Понеділок"], "Martes": ["Tuesday", "Вівторок"], "Miércoles": ["Wednesday", "Середа"],
    "Jueves": ["Thursday", "Четвер"], "Viernes": ["Friday", "П'ятниця"], "Sábado": ["Saturday", "Субота"], "Domingo": ["Sunday", "Неділя"],
    // Interpolated templates — used via LF.tf(template, params). {tokens} are left intact
    // by the dictionary lookup and filled in afterwards, so grammar stays correct per language.
    "{n} seleccionado": ["{n} selected", "{n} вибрано"],
    "{n} seleccionados": ["{n} selected", "{n} вибрано"],
    "{n} sin asignar": ["{n} unassigned", "{n} не призначено"],
    "{n} puntos asignados": ["{n} points assigned", "{n} точок призначено"],
    "{n} puntos sin asignar": ["{n} points unassigned", "{n} точок не призначено"],
    "Descargando {n} visitas": ["Downloading {n} visits", "Завантаження {n} візитів"],
    "Analizadas {n} filas": ["Analyzed {n} rows", "Проаналізовано {n} рядків"],
    "Importadas {n} filas": ["Imported {n} rows", "Імпортовано {n} рядків"],
    "Creadas: {list}": ["Created: {list}", "Створено: {list}"],
    "Bot @{u} en línea": ["Bot @{u} online", "Бот @{u} онлайн"],
    "Ubicación capturada ({lat}, {lng}).": ["Location captured ({lat}, {lng}).", "Локацію отримано ({lat}, {lng})."],
    "{n} check-in(s) pendientes enviados": ["{n} pending check-in(s) sent", "Надіслано {n} відкладених чек-інів"],
    "Última visita: {t}": ["Last visit: {t}", "Останній візит: {t}"],
    "Hola, {name}. Elige tu parada, comparte tu ubicación y añade una foto.": [
      "Hi, {name}. Pick your stop, share your location and add a photo.",
      "Привіт, {name}. Оберіть точку, поділіться локацією й додайте фото."],
    "Hola. Elige tu parada, comparte tu ubicación y añade una foto.": [
      "Hi. Pick your stop, share your location and add a photo.",
      "Привіт. Оберіть точку, поділіться локацією й додайте фото."],
    "Prueba gratuita — {n} día(s) restantes.": ["Free trial — {n} day(s) left.", "Безкоштовний період — залишилось {n} дн."],
    "Pago pendiente — actualiza tu tarjeta en {n} día(s) o la cuenta pasará a solo-lectura.": [
      "Payment due — update your card within {n} day(s) or the account goes read-only.",
      "Очікується оплата — оновіть картку протягом {n} дн., інакше акаунт стане лише для читання."],
    "sin Telegram": ["no Telegram", "без Telegram"],
    "nunca": ["never", "ніколи"],
    "— hecho hoy": [" — done today", " — зроблено сьогодні"],
    "No hay paradas asignadas": ["No assigned stops", "Немає призначених точок"],

    // ── Login / signup: forgot-password, back-link, email, terms checkbox ──────────
    "¿Olvidaste tu contraseña?": ["Forgot your password?", "Забули пароль?"],
    "← Volver a la web": ["← Back to the website", "← Назад на сайт"],
    "← Volver a iniciar sesión": ["← Back to sign in", "← Назад до входу"],
    "(vacío si es instalación propia)": ["(empty for a self-hosted install)", "(порожньо для власної інсталяції)"],
    "Tu correo electrónico": ["Your email address", "Ваша електронна пошта"],
    "Enviar enlace de recuperación": ["Send recovery link", "Надіслати посилання для відновлення"],
    "Indica tu correo electrónico (lo necesitas para recuperar tu cuenta).": [
      "Enter your email (you'll need it to recover your account).", "Вкажіть вашу пошту (вона потрібна для відновлення акаунта)."],
    "Debes aceptar los Términos de Servicio y la Política de Privacidad.": [
      "You must accept the Terms of Service and Privacy Policy.", "Ви маєте прийняти Умови надання послуг і Політику конфіденційності."],
    "Nombre de empresa y contraseña (mín. 6).": ["Company name and password (min. 6).", "Назва компанії та пароль (мін. 6)."],
    "Error de red. Inténtalo de nuevo.": ["Network error. Try again.", "Помилка мережі. Спробуйте ще раз."],
    "Si ese correo existe en nuestro sistema, te hemos enviado un enlace para restablecer la contraseña.": [
      "If that email exists in our system, we've sent a link to reset the password.",
      "Якщо ця пошта є в нашій системі, ми надіслали посилання для скидання пароля."],
    "Acepto los ": ["I accept the ", "Я приймаю "],
    " y la ": [" and the ", " і "],
    "Términos de Servicio": ["Terms of Service", "Умови надання послуг"],
    "Política de Privacidad": ["Privacy Policy", "Політику конфіденційності"],

    // ── Conexiones (Import/API view) — remaining fragments ──────────────────────────
    "Puntos (las paradas a visitar)": ["Points (stops to visit)", "Точки (для відвідування)"],
    "Trabajadores (tu personal de campo)": ["Workers (your field staff)", "Працівники (ваш польовий персонал)"],
    "Sube un archivo ": ["Upload a file ", "Завантажте файл "],
    " con tus puntos o trabajadores. Te dejamos asignar cada columna antes de importar.": [
      " with your points or workers. You'll map each column before importing.",
      " із вашими точками чи працівниками. Ви призначите кожну колонку перед імпортом."],
    "Si añades el ": ["If you add the ", "Якщо ви додасте "],
    "teléfono del trabajador": ["worker's phone", "телефон працівника"],
    ", la parada queda asignada a esa persona automáticamente. Las coordenadas se rellenan solas en el primer check-in.": [
      ", the stop is assigned to that person automatically. Coordinates fill in on the first check-in.",
      ", точка призначається цій людині автоматично. Координати заповнюються самі під час першого чек-іну."],
    "El ": ["The ", ""],
    "teléfono": ["phone", "телефон"],
    " es la clave: cuando el trabajador comparte su número en el bot, se enlaza con esta ficha. Escríbelo con prefijo de país (ej. ": [
      " is the key: when the worker shares their number in the bot, it links to this record. Write it with the country prefix (e.g. ",
      " — ключ: коли працівник ділиться номером у боті, він привʼязується до цього запису. Пишіть із кодом країни (напр. "],
    "Teléfono del trabajador": ["Worker's phone", "Телефон працівника"],
    "El cliente empuja su catálogo y lee las visitas por API. Se autentica con la cabecera ": [
      "The client pushes their catalog and reads visits via API. It authenticates with the header ",
      "Клієнт надсилає свій каталог і читає візити через API. Автентифікація за заголовком "],
    ". Estado: ": [". Status: ", ". Статус: "],
    "Tu clave de API (": ["Your API key (", "Ваш API-ключ ("],
    "Generando tu clave…": ["Generating your key…", "Генеруємо ваш ключ…"],
    "Esta es la clave única de tu empresa. Entrégasela a quien integre tu sistema. Si la regeneras, la anterior deja de funcionar de inmediato.": [
      "This is your company's unique key. Give it to whoever integrates your system. If you regenerate it, the old one stops working immediately.",
      "Це унікальний ключ вашої компанії. Передайте його тому, хто інтегрує вашу систему. Якщо перегенеруєте, старий одразу перестане працювати."],
    "Cargar trabajadores — ": ["Load workers — ", "Завантажити працівників — "],
    "Cargar puntos (sin coordenadas) — ": ["Load points (no coordinates) — ", "Завантажити точки (без координат) — "],
    " (opcional) enlaza el punto con su trabajador asignado. Las coordenadas se rellenan solas en el ": [
      " (optional) links the point to its assigned worker. Coordinates fill in on the ",
      " (необовʼязково) звʼязує точку з призначеним працівником. Координати заповнюються під час "],
    "primer check-in": ["first check-in", "першого чек-іну"],
    " de cada punto.": [" of each point.", " кожної точки."],
    "Leer visitas — ": ["Read visits — ", "Читати візити — "],
    "Crea las pestañas ": ["Create the ", "Створіть вкладки "],
    " (con cabeceras) en tu hoja conectada. Se puede ejecutar de nuevo sin riesgo — nunca borra datos.": [
      " tabs (with headers) in your connected sheet. Safe to run again — never deletes data.",
      " (із заголовками) у підключеній таблиці. Безпечно запускати знову — дані ніколи не видаляються."],

    // ── Ajustes — remaining fragments ────────────────────────────────────────────
    "Empresa:": ["Company:", "Компанія:"],
    "La contraseña de esta instalación se define con la variable ": [
      "This installation's password is set via the ", "Пароль цієї інсталяції задається змінною "],
    " del servidor.": [" on the server.", " на сервері."],
    "Tus datos": ["Your data", "Ваші дані"],
    "Exportar todos mis datos": ["Export all my data", "Експортувати всі мої дані"],
    "Descarga un archivo con todos tus puntos, trabajadores y visitas — por si necesitas una copia o quieres migrar de plataforma.": [
      "Download a file with all your points, workers, and visits — in case you need a copy or want to switch platforms.",
      "Завантажте файл з усіма вашими точками, працівниками та візитами — про всяк випадок або для переходу на іншу платформу."],
    "StarX usa ": ["StarX uses ", "StarX використовує "],
    "un único bot compartido": ["a single shared bot", "єдиного спільного бота"],
    ", ya configurado por la plataforma — tú solo lo enciendes o apagas aquí, no hay tokens que gestionar.": [
      ", already configured by the platform — you just turn it on or off here, no tokens to manage.",
      ", вже налаштованого платформою — ви лише вмикаєте чи вимикаєте його тут, без токенів для керування."],
    "Carga a tus trabajadores con su ": ["Load your workers with their ", "Завантажте своїх працівників за "],
    " (en ": [" (in ", " (у "],
    " o por importación/API).": [" or via import/API).", " або через імпорт/API)."],
    "El trabajador abre el bot y pulsa ": ["The worker opens the bot and taps ", "Працівник відкриває бота і натискає "],
    " (o usa el enlace de abajo).": [" (or uses the link below).", " (або використовує посилання нижче)."],
    "Comparte su número de teléfono y queda enlazado a ": [
      "They share their phone number and get linked to ", "Ділиться номером телефону й привʼязується до "],
    "tu empresa": ["your company", "вашої компанії"],
    " automáticamente.": [" automatically.", " автоматично."],
    "Pulsa ": ["Taps ", "Натискає "],
    ", elige una parada y hace su check-in con ubicación y foto.": [
      ", picks a stop, and checks in with location and photo.", ", обирає точку і робить чек-ін з локацією та фото."],
    "Enlace de alta para tus trabajadores": ["Sign-up link for your workers", "Посилання для реєстрації працівників"],
    "Se genera al conectar el bot…": ["Generated once the bot connects…", "Генерується після підключення бота…"],
    "Compártelo por WhatsApp/Telegram. Quien lo abra se registrará en ": [
      "Share it via WhatsApp/Telegram. Whoever opens it will register in ",
      "Поділіться через WhatsApp/Telegram. Той, хто відкриє, зареєструється в "],
    " (código ": [" (code ", " (код "],
    "Si el botón ": ["If the ", "Якщо кнопка "],
    " aparece deshabilitado, el operador de la plataforma aún no ha configurado el token del bot en el servidor.": [
      " button is disabled, the platform operator hasn't configured the bot token on the server yet.",
      " неактивна, оператор платформи ще не налаштував токен бота на сервері."],
    "Permite que tus trabajadores hagan check-in desde el navegador (además del bot). Entran en la pantalla de login con su ": [
      "Lets your workers check in from the browser (in addition to the bot). They log in with their ",
      "Дозволяє вашим працівникам відмічатися з браузера (окрім бота). Вони входять за "],
    " (el mismo que cargaste).": [" (the same one you loaded).", " (тим самим, що ви завантажили)."],
    "Activa — los trabajadores pueden entrar por teléfono.": [
      "On — workers can log in by phone.", "Увімкнено — працівники можуть входити за телефоном."],
    "Desactivada.": ["Off.", "Вимкнено."],
    "Exige una ": ["Requires a ", "Вимагає "],
    "foto": ["photo", "фото"],
    " en cada check-in (bot y app). Si está activo, no se acepta un check-in sin foto.": [
      " on every check-in (bot and app). When on, a check-in without a photo is rejected.",
      " при кожному чек-іні (бот і застосунок). Якщо увімкнено, чек-ін без фото не приймається."],
    "Obligatoria — no se acepta un check-in sin foto.": ["Required — a check-in without a photo is rejected.", "Обовʼязково — чек-ін без фото не приймається."],
    "Opcional — el trabajador puede fichar sin foto.": ["Optional — the worker can check in without a photo.", "Необовʼязково — працівник може відмітитися без фото."],
    "desactivado": ["disabled", "вимкнено"],
    "El conector acepta peticiones con la clave de abajo (cabecera X-API-Key).": [
      "The connector accepts requests with the key below (X-API-Key header).",
      "Конектор приймає запити з ключем нижче (заголовок X-API-Key)."],
    "activa": ["active", "активна"],
    "prueba": ["trial", "пробний"],
    "pago pendiente": ["payment due", "очікується оплата"],
    "cancelada": ["canceled", "скасовано"],
    "El cobro no está configurado en este servidor (modo autoalojado).": [
      "Billing isn't configured on this server (self-hosted mode).", "Оплата не налаштована на цьому сервері (режим самостійного розміщення)."],
    "Prueba": ["Trial", "Пробний"],
    "Básico": ["Basic", "Базовий"],

    // ── Points table ──────────────────────────────────────────────────────────────
    "Actividad": ["Activity", "Активність"],
    "visita": ["visit", "візит"],
    "visitas": ["visits", "візити"],
    "última {d}": ["last {d}", "останній {d}"],

    // ── Workers table ─────────────────────────────────────────────────────────────
    "Paradas (hoy)": ["Stops (today)", "Точки (сьогодні)"],
    "Último check-in": ["Last check-in", "Останній чек-ін"],

    // ── Visits table ──────────────────────────────────────────────────────────────
    "Ver": ["View", "Переглянути"],
    "mapa ↗": ["map ↗", "карта ↗"],

    // ── Stats: attention cards ────────────────────────────────────────────────────
    "Todo en orden": ["All good", "Усе гаразд"],

    // ── Bot status (dynamic HTML via LF.tf) ──────────────────────────────────────
    "el bot": ["the bot", "бота"],
    "abrir {u}": ["open {u}", "відкрити {u}"],
    "El bot {b} está en línea recibiendo check-ins.": [
      "The bot {b} is online receiving check-ins.", "Бот {b} онлайн і приймає чек-іни."],

    // ── Billing detail (dynamic via LF.tf) ───────────────────────────────────────
    "Límites: {w} trabajadores · {p} puntos.": ["Limits: {w} workers · {p} points.", "Ліміти: {w} працівників · {p} точок."]
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

  // Translate-and-format: look up an ES template (which contains {tokens}), then fill the
  // tokens. Lets interpolated strings ("Analizadas {n} filas") translate with correct
  // grammar instead of concatenating already-Spanish fragments. Falls back to the ES
  // template if the key isn't in the dictionary.
  function tf(esTemplate, params) {
    params = params || {};
    var translated = t(esTemplate);
    return String(translated).replace(/\{(\w+)\}/g, function (_, k) {
      return params[k] != null ? String(params[k]) : "{" + k + "}";
    });
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
  window.LF.tf = tf;
  window.LF.setLang = setLang;
  window.LF.lang = function () { return lang; };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
