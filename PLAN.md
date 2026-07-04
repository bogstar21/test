# StarX — Scalable Plan

A logistics **check-in** platform. Field workers run a route and check in at each
stop with **GPS + photos**. Managers manage the database and watch statistics on a
web platform. Clients bring their own data via **Excel import, Google Sheets, or an API**.

Separate from holodBot. Reuses holodBot's proven spine (server, auth, Telegram
check-in, PWA shell) but strips the entire cooler/equipment domain.

---

## 1. Architecture

```
                ┌─────────────────────────────────────────┐
   Worker  ───► │  Telegram bot  (bot.js)                  │
  (phone)       │   /route → pick stop → GPS → photos      │ ──┐
                └─────────────────────────────────────────┘   │  writes Visit
                                                               ▼
                ┌─────────────────────────────────────────────────────┐
                │  DATASOURCE SEAM   (src/server/datasource/index.js)  │
                │   forTenant(tenant) → impl                           │
                │   ├── memory.js   ✅ default (zero-config MVP)       │
                │   ├── supabase.js ✅ persistent (Postgres + Storage) │
                │   ├── sheets.js   ✅ Google Sheets                   │
                │   └── (excel/csv import + /api/v1 connector) ✅      │
                └─────────────────────────────────────────────────────┘

   Client  ───► POST /api/v1/workers · /api/v1/points   (push, X-API-Key)
   (API)   ◄─── GET  /api/v1/visits                     (pull)

   Worker  ───► PWA check-in  (public/platform, role=worker, login by phone)
                                                               ▲
                ┌─────────────────────────────────────────┐   │  reads/writes
   Manager ───► │  Web platform  (public/platform, SPA)    │ ──┘
  (browser)     │   Dashboard · Points · Workers · Visits  │
                │   · Import · Map · Stats                 │
                └─────────────────────────────────────────┘
```

**The one design decision that makes it scalable:** every route and the bot talk to
a single **datasource interface**, never to Google directly. Swapping Sheets for a
client's API later = add one file (`datasource/api.js`) and switch on `tenant.source`.
Nothing else changes.

---

## 2. Data model (4 entities — Sheets tabs now, tables later)

| Tab / table | Columns                                                                            |
|-----------|--------------------------------------------------------------------------------------|
| `workers` | telegramId · name · phone · active                                                   |
| `points`  | id · name · address · lat · lng · **geolocated** · active                            |
| `visits`  | timestamp · visitId · workerTelegramId · workerName · pointId · pointName · lat · lng · mapsLink · photoCount · photoFileIds · **source** · note |
| `settings`| tenant_id · key · value   (e.g. `pwa_enabled`)                                       |

All tables carry a `tenant_id` (default `default`) — the multi-tenant seam is ready
but inactive. Points load **without** coordinates; `geolocated` flips to true on the
first check-in. `source` marks each visit as `bot` or `pwa`.

`Route` (ordered points per worker per day) is intentionally **deferred** — for the
MVP a worker simply sees all active points. Add a `routes` tab when a client needs it.

---

## 3. Phases (ship each before starting the next)

### Phase 1 — MVP ✅ (built)
- Single company. Datasource: `memory` (default) / `supabase` (persistent) / `sheets`.
- **Bot (one shared):** `/start` → register by phone → `/route` → check in (GPS + photos).
  Token lives in server env only; the web app toggles the bot on/off.
- **Worker PWA:** login by phone, browser GPS + photo → `/api/checkin` (source=`pwa`).
  Manager enables/disables it from the UI (`pwa_enabled` setting).
- **Points without coordinates:** first check-in fixes each point's location.
- **Connector API** (`/api/v1`, `X-API-Key`): client pushes workers/points, pulls visits.
- **Platform:** login, dashboard (stats + map), CRUD, visits table, Excel/CSV import.

### Phase 2 — Multi-tenant (seam ready, inactive)
- Every table already carries `tenant_id`; `TENANTS[]` + `getTenant(req)` exist.
- Activate multiple companies, each its own password + datasource + connector key.

### Phase 3 — Scale / integrations
- Add `datasource/postgres.js` or a direct client REST `datasource/api.js` behind the
  same interface — routes and bot stay unchanged (seam).

### Phase 4 — Delivery upgrades
- Geofence on check-in (reject if > N m from the point), offline queue, native app.

---

## 4. Tech stack (same as holodBot — proven, minimal)

- **Node + Express** server (helmet, rate-limit, signed-cookie sessions).
- **Telegram** (`node-telegram-bot-api`, long-polling) — one shared worker bot.
- **Supabase** (Postgres + REST + Storage) as the persistent datastore; `memory` for
  zero-config dev; Google Sheets (`googleapis`) still supported via the seam.
- **SheetJS** (`xlsx`) for Excel/CSV import.
- **Vanilla JS PWA** for both the manager platform and the worker check-in (Leaflet
  for the map). No build step.
- **Railway** for deploy (git push → redeploy). Own service, own env.

---

## 5. What stays out (so it doesn't creep)

Orders/XO lifecycle, equipment, serial numbers, fines, 1C export, approval chains —
none of it. StarX answers exactly one question: **who went where, when, with proof.**
