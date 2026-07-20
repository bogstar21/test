# StarX — Launch Plan

Field check-in platform: companies bring their points + workers; workers check in with
GPS + photo from a Telegram bot or the PWA; managers watch it live and pull the data out.
Multi-tenant, self-serve signup, Stripe billing.

This plan is organised in three tracks. Each idea is scoped small enough to ship on its
own. Rough priority within each track is top-to-bottom.

---

## 1. Security

1. **Postgres RLS as defense-in-depth.** Today isolation is enforced in the app layer
   (`tenant_id` filters). Add Row-Level Security policies on `starx_workers/points/visits/
   settings` keyed on `tenant_id` so a query bug can never leak across companies. The
   service-role key bypasses RLS, so pair it with a per-request tenant claim.
2. **Real accounts on signup.** Signup is company-name + password only. Add an email,
   verification link, and a password-reset flow. Without email there's no account recovery
   and no way to contact a paying customer.
3. **CSRF protection on state-changing requests.** Sessions are `sameSite=lax` cookies;
   the login/import forms POST directly. Add a CSRF token (or require `fetch` + custom
   header on all mutations) so a third-party page can't act as a logged-in manager.
4. **Private photo storage.** The `visit-photos` bucket is public-read. Switch to a private
   bucket with short-lived signed URLs minted per request, so check-in photos aren't
   guessable/enumerable outside the platform.
5. **Webhook + audit hardening.** Add a timestamp tolerance + idempotency key to the Stripe
   webhook (replay protection), and an admin audit log (who deleted/edited what, when) —
   both are table-stakes when money and multi-user data are involved.

## 2. Design

1. **First-run onboarding wizard.** After signup, walk the manager through: import points →
   add/importar workers → assign → generate API key / turn on bot or PWA. Right now they
   land on an empty dashboard and have to discover each tab.
2. **Worker PWA polish ("today's route").** Big single-tap check-in, stops sorted
   nearest-first (GPS already captured), a clear "done today" state, and offline-friendly
   affordances. This is the screen used most, in the field, one-handed.
3. **Empty states + loading skeletons.** Every table/chart should have a helpful empty state
   ("No points yet — import a file or add one") and skeletons instead of "Cargando…". Makes
   the product feel finished on day one when there's no data.
4. **Design-token cleanup + dark-mode QA.** The palette now lives in CSS variables; finish
   the job by removing the remaining hardcoded hexes (charts, login/landing) and doing a
   full light/dark contrast + focus-state pass (accessibility).
5. **Consistent brand system.** One documented logo (the cube+arrow), favicon set, and a
   small component reference so future screens stay on-brand.

## 3. Functionality

1. **Routes / ordering (the deferred feature).** A daily, ordered sequence of stops per
   worker — the single most-requested logistics capability and a natural upsell tier.
2. **Geofence enforcement (per-company toggle).** Optionally reject a check-in if it's more
   than N metres from the point. Turns "proof of GPS" into "proof of presence" — a real
   selling point for auditing.
3. **Notifications.** Telegram daily "here's your route" push to workers, and manager alerts
   for missed/pending stops at end of day. Drives daily engagement without opening the app.
4. **Reporting & scheduled exports.** Per-worker productivity, coverage over time, and a
   scheduled email/CSV digest. Managers want the summary, not just the raw log.
5. **Roles beyond admin.** A read-only supervisor and a dispatcher role (assign, no billing).
   Bigger companies won't share one admin password — and it complements the code+password
   login already in place.
