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

**Explicitly NOT in MVP:** multi-datasource, API ingestion, native app,
geofencing, offline queue.

---

## Setup (separate everything — holodBot untouched)

- Its own folder: `starx/`
- Its own git repo + GitHub remote
- Its own Railway deploy
- Its own Google Sheet

## Known concerns for later (not MVP blockers)

- **GPS spoofing** → add geofence check (visit must be within N metres of point).
- **No signal in the field** → offline queue, sync when back online.
- **Worker-location privacy** → only capture location at check-in, not continuously.
