-- StarX — Supabase schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Creates the StarX tables (workers, points, visits), a key/value settings table, and
-- the Storage bucket for PWA check-in photos. The `pk` identity starts at 2 because the
-- CRUD routes validate the row handle as `>= 2` (a convention inherited from the original
-- Google Sheets store, where row 1 is the header).
--
-- The server connects with the service_role key and bypasses RLS, so no policies are
-- required for the MVP. If you later expose these tables to the anon key, add RLS.
--
-- ⚠️  If you see an error like:
--       "Could not find the 'worker_id' column of 'starx_points' in the schema cache"
--     your database was created with an OLDER version of this file (before that column
--     existed) OR PostgREST's schema cache is stale. FIX: just re-run this whole file.
--     The `alter table ... add column if not exists` statements below add any missing
--     columns, and the final `notify pgrst, 'reload schema'` refreshes the cache.

-- ── Tenants (companies) — the platform-level registry (NO tenant_id; it IS the list) ──
-- Multi-company SaaS: each row is a company with its own login, plan and billing state.
-- The env-configured "default" tenant always exists in the app even if this table is empty.
create table if not exists public.starx_tenants (
  id                  text primary key,
  name                text not null default '',
  code                text unique,                 -- bot deep-link / PWA company code
  source              text default 'supabase',
  sheet_id            text default '',
  password_hash       text default '',             -- scrypt$salt$hash (never plaintext)
  plan                text default 'trial',        -- trial | basic | pro | business
  subscription_status text default 'trialing',     -- trialing | active | past_due | canceled
  trial_ends_at       timestamptz,
  stripe_customer_id  text default '',
  active              boolean default true,
  created_at          timestamptz default now()
);
create index if not exists idx_starx_tenants_code on public.starx_tenants (code);

-- ── Workers ────────────────────────────────────────────────────────────────────
create table if not exists public.starx_workers (
  pk           bigint generated always as identity (start with 2) primary key,
  tenant_id    text default 'default',      -- ready for multi-company; single tenant for now
  worker_id    text default '',             -- stable internal id (auto) that points reference
  telegram_id  text default '',
  name         text default '',
  phone        text default '',
  active       boolean default true,
  created_at   timestamptz default now()
);
alter table public.starx_workers add column if not exists tenant_id text default 'default';
alter table public.starx_workers add column if not exists worker_id text default '';

-- ── Points ─────────────────────────────────────────────────────────────────────
-- Points are loaded WITHOUT coordinates. The first check-in geolocates the point:
-- lat/lng get filled and `geolocated` flips to true.
create table if not exists public.starx_points (
  pk          bigint generated always as identity (start with 2) primary key,
  tenant_id   text default 'default',
  id          text default '',            -- business id (e.g. "P1"), used to match the client's system
  name        text default '',
  address     text default '',
  worker_id   text default '',            -- the ONE worker this point is assigned to (1:1)
  worker_name text default '',            -- denormalized for display
  lat         text default '',
  lng         text default '',
  geolocated  boolean default false,      -- true once the first check-in set the coords
  active      boolean default true,
  created_at  timestamptz default now()
);
alter table public.starx_points add column if not exists tenant_id   text default 'default';
alter table public.starx_points add column if not exists geolocated  boolean default false;
alter table public.starx_points add column if not exists worker_id   text default '';
alter table public.starx_points add column if not exists worker_name text default '';

-- ── Visits (check-ins) ───────────────────────────────────────────────────────────
-- photo_file_ids holds a comma-separated list. From the bot they are Telegram file_ids;
-- from the PWA they are Storage object paths (bucket "visit-photos"). `source` says which.
create table if not exists public.starx_visits (
  pk                  bigint generated always as identity (start with 2) primary key,
  tenant_id           text default 'default',
  timestamp           timestamptz default now(),
  visit_id            text default '',
  worker_id           text default '',   -- stable worker id (attribution key; see worker_telegram_id fallback)
  worker_telegram_id  text default '',
  worker_name         text default '',
  point_id            text default '',
  point_name          text default '',
  lat                 text default '',
  lng                 text default '',
  maps_link           text default '',
  photo_count         integer default 0,
  photo_file_ids      text default '',
  source              text default 'bot',  -- 'bot' | 'pwa'
  note                text default ''
);
alter table public.starx_visits add column if not exists tenant_id text default 'default';
alter table public.starx_visits add column if not exists source    text default 'bot';
alter table public.starx_visits add column if not exists worker_id text default '';

-- ── Settings (key/value per tenant) ──────────────────────────────────────────────
-- Small flags the platform toggles at runtime, e.g. pwa_enabled = "true".
create table if not exists public.starx_settings (
  tenant_id  text default 'default',
  key        text not null,
  value      text default '',
  updated_at timestamptz default now(),
  primary key (tenant_id, key)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────────
create index if not exists idx_starx_visits_timestamp on public.starx_visits (timestamp desc);
create index if not exists idx_starx_visits_tenant     on public.starx_visits (tenant_id);
create index if not exists idx_starx_visits_worker     on public.starx_visits (worker_id);
create index if not exists idx_starx_workers_telegram  on public.starx_workers (telegram_id);
create index if not exists idx_starx_workers_phone     on public.starx_workers (phone);
create index if not exists idx_starx_workers_tenant    on public.starx_workers (tenant_id);
create index if not exists idx_starx_workers_wid       on public.starx_workers (worker_id);
create index if not exists idx_starx_points_tenant     on public.starx_points (tenant_id);
create index if not exists idx_starx_points_worker     on public.starx_points (worker_id);

-- ── Storage bucket for PWA check-in photos ────────────────────────────────────────
-- The bot keeps using Telegram file_ids (served via the /api photo proxy); the PWA has
-- no Telegram, so its photos are uploaded here. Public read so the dashboard can show
-- thumbnails directly; writes happen server-side with the service_role key.
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', true)
on conflict (id) do nothing;

-- ── Row Level Security (defense in depth) ──────────────────────────────────────────
-- The server connects with the service_role key, which BYPASSES RLS — so enabling RLS
-- with no policies changes nothing for the app, but denies the anon/public key any access.
-- This means an accidentally-leaked anon key (or a future direct-from-browser call) cannot
-- read another company's data. App-level tenant_id filtering (datasource/supabase.js) stays
-- the primary boundary; this is the second wall.
alter table public.starx_tenants  enable row level security;
alter table public.starx_workers  enable row level security;
alter table public.starx_points   enable row level security;
alter table public.starx_visits   enable row level security;
alter table public.starx_settings enable row level security;

-- ── Reload PostgREST's schema cache ────────────────────────────────────────────────
-- PostgREST caches the table/column list and can serve a stale copy right after columns
-- are added, surfacing "Could not find the '<col>' column ... in the schema cache". This
-- forces an immediate reload, so re-running this file is a complete, self-contained fix.
notify pgrst, 'reload schema';
