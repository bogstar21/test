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
                │   ├── sheets.js   ✅ now  (Google Sheets)            │
                │   ├── (excel = import INTO sheets)  ✅ now           │
                │   └── api.js      ⏳ later (client REST API)         │
                └─────────────────────────────────────────────────────┘
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

| Tab       | Columns                                                                              |
|-----------|--------------------------------------------------------------------------------------|
| `workers` | telegramId · name · phone · active                                                   |
| `points`  | id · name · address · lat · lng · active                                             |
| `visits`  | timestamp · visitId · workerTelegramId · workerName · pointId · pointName · lat · lng · mapsLink · photoCount · photoFileIds · note |

`Route` (ordered points per worker per day) is intentionally **deferred** — for the
MVP a worker simply sees all active points. Add a `routes` tab when a client needs it.

---

## 3. Phases (ship each before starting the next)

### Phase 1 — MVP (this scaffold)
- One tenant. Data in one Google Sheet (`workers`, `points`, `visits`).
- **Bot:** `/route` lists points → worker checks in (GPS + photos) → Visit row written.
- **Platform:** login, dashboard (stats + map), CRUD for points & workers, visits table.
- **Onboarding:** Excel/CSV import of points & workers into the sheet.

### Phase 2 — Multi-tenant
- Multiple companies, each its own password + sheet (the `TENANTS` seam already exists).
- Per-tenant bot routing (one bot, workers keyed by tenant) or one bot per tenant.

### Phase 3 — Bring-your-own data
- `datasource/api.js`: read points/workers and push visits to a client's REST API.
- Tenant config gains `source: "api" | "sheets"`; routes/bot stay unchanged (seam).

### Phase 4 — Scale the store
- Move from Sheets → Postgres when a tenant exceeds ~5k visits or needs concurrency.
- Same datasource interface → add `datasource/postgres.js`, flip the tenant flag.

### Phase 5 — Delivery upgrades
- PWA "worker app" (installable) as an alternative to Telegram.
- Geofence on check-in (reject if > N m from the point), offline queue, native app.

---

## 4. Tech stack (same as holodBot — proven, minimal)

- **Node + Express** server (helmet, rate-limit, signed-cookie sessions).
- **Telegram** (`node-telegram-bot-api`, long-polling) for the worker app.
- **Google Sheets** (`googleapis`, service account) as the first datastore.
- **SheetJS** (`xlsx`) for Excel/CSV import.
- **Vanilla JS PWA** for the platform (Leaflet for the map). No build step.
- **Railway** for deploy (git push → redeploy). Own service, own env, own sheet.

---

## 5. What stays out (so it doesn't creep)

Orders/XO lifecycle, equipment, serial numbers, fines, 1C export, approval chains —
none of it. StarX answers exactly one question: **who went where, when, with proof.**
