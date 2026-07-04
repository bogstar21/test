# StarX — Logistics Check-in Platform

A simple, multi-tenant platform for **field check-ins**. A worker runs a route,
checks in at each stop with **GPS + photos**, and a manager watches it live on a
web dashboard with stats and a map.

This is a **separate project** from holodBot. holodBot stays exactly as it is.
StarX reuses holodBot's proven check-in spine but strips away everything
specific to the cooler/equipment business.

---

## The one core loop

```
Worker opens bot/app  →  sees their route (list of points)
        →  arrives at a stop  →  checks in (GPS auto + photo)
        →  manager sees it live: list + map + stats
```

Everything else is optional polish around this single loop.

---

## Reuse from holodBot (don't rebuild)

| Piece                         | Source in holodBot           |
|-------------------------------|------------------------------|
| Telegram check-in flow (GPS + photo) | `bot.js`              |
| Express server + session auth | `src/server`                 |
| Web platform (PWA shell)      | `public/platform`            |
| Statistics dashboard          | `public/statistics.html`     |
| Google Sheets as first datastore | Apps Script / Sheets API  |

## Strip out (the cooler-business domain layer)

- Orders / XO lifecycle (Запит → Схвалення → СН → Логістика)
- Equipment & serial numbers
- Fines (`Status_Fines`)
- 1C export
- Supervisor approval chains

What's left is just: **who** went **where**, **when**, with **proof** (GPS + photo).

---

## Minimal data model (4 entities)

| Entity   | Fields                                                        |
|----------|---------------------------------------------------------------|
| Tenant   | id, name, datasource                                          |
| Worker   | id, tenant, name, telegram_id                                 |
| Point    | id, tenant, name, address, lat, lng                           |
| Visit    | id, tenant, worker, point, timestamp, lat, lng, photo(s), note |

*Later (not MVP):* `Route` = ordered list of points per worker per day.

First datastore = Google Sheets (one tab per entity). Move to Postgres only
after the model is validated with a real client.

---

## How a client onboards (phased — start at Phase 1)

1. **Excel import** → paste points + workers into a Google Sheet
2. **Connect their own Google Sheet**
3. **Connect an API**

## How workers receive their route (phased — start at Phase 1)

1. **Telegram bot** (already built in holodBot)
2. **PWA** (installable web app)
3. **Native app**

---

## MVP — the smallest thing that ships

- One tenant; points + workers loaded from a Google Sheet.
- Telegram bot: `/route` lists points → check-in captures GPS + photo → writes a Visit row.
- Dashboard: list + map of visits, basic stats (visits today, per worker, per point).

**Explicitly NOT in MVP:** multi-tenant activation (the seam is ready but single
company for now), native app, geofencing, offline queue.

---

## Run the MVP (connected to nothing — zero config)

This MVP runs entirely **in memory**: no Telegram, no Google Sheets, no env vars.
Data is seeded on boot and resets on restart — perfect for trying the platform.

```bash
npm install
npm start
# → open http://localhost:3000  (login password: admin)
```

That's it. Add/edit/delete points & workers, import an Excel/CSV, browse the seeded
visits and map — all against the in-memory store.

```bash
npm test    # boots the app in-memory and exercises the core flows (no network)
```

## What's built (MVP feature set)

- **One shared Telegram bot** for the whole platform. The token lives only in the
  server env (`TELEGRAM_TOKEN`); the web app just turns it on/off (Bot tab) — no
  token ever reaches the browser.
- **Worker registration by phone** (holodBot-style): a worker is preloaded with a
  phone, opens the bot, taps `/start`, shares their contact, and their `telegram_id`
  is linked automatically.
- **Points load without coordinates.** The **first check-in** fixes each point's
  location. The Points table shows a *Geo* column (`sí` / `pendiente`).
- **Two ways to check in** — the Telegram bot *or* the **worker PWA** (web app).
  Workers log into the PWA by phone; the manager turns the PWA on/off from the UI.
- **Client connector API** (`/api/v1`, `X-API-Key`) — the client pushes their
  catalog and pulls the visit log. OFF until `INTEGRATION_API_KEY` is set.
- **Data import** from Excel/CSV with a column-mapping step.

### Connector API (examples)

`POST /api/v1/workers`
```json
{ "workers": [ { "name": "Ivan Petrenko", "phone": "+380671112233" } ] }
```

`POST /api/v1/points`  (no lat/lng — filled on first check-in)
```json
{ "points": [ { "id": "P1", "name": "Silpo", "address": "Khreshchatyk St 15" } ] }
```

`GET /api/v1/visits?limit=500`
```bash
curl -H "X-API-Key: YOUR_KEY" https://YOUR-DOMAIN/api/v1/visits?limit=500
```

### Excel / CSV structure

Any headers work (you map columns on import). Recommended:

```
# points
id,name,address
P1,Silpo Khreshchatyk,Khreshchatyk St 15

# workers
name,phone
Ivan Petrenko,+380671112233
```

### Environment (all optional — MVP runs with none)

The datasource is behind a seam (`src/server/datasource/`), so switching stores is a
one-line change — nothing in the routes or the bot changes:

| Env var            | Purpose                                                        |
|--------------------|----------------------------------------------------------------|
| `DATASOURCE`       | `memory` (default) → `supabase` (persistent + API) or `sheets` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Needed when `DATASOURCE=supabase`         |
| `PLATFORM_PASSWORD`| Web login password (default `admin` — **change in production**)|
| `COOKIE_SECURE`    | `true` when deployed behind HTTPS (e.g. Railway)               |
| `TELEGRAM_TOKEN`   | The one shared check-in bot; the web app toggles it on/off     |
| `INTEGRATION_API_KEY` | Enables the client connector at `/api/v1` (off until set)   |
| `GOOGLE_CREDENTIALS` / `SHEET_ID` | Needed only when `DATASOURCE=sheets`            |

## Setup (separate everything — holodBot untouched)

- Its own folder: `starx/`
- Its own git repo + GitHub remote
- Its own Railway deploy
- Its own Google Sheet

## Known concerns for later (not MVP blockers)

- **GPS spoofing** → add geofence check (visit must be within N metres of point).
- **No signal in the field** → offline queue, sync when back online.
- **Worker-location privacy** → only capture location at check-in, not continuously.
