-- StarX — Supabase schema.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
--
-- Creates the three StarX tables (workers, points, visits). The `pk` identity starts
-- at 2 because the CRUD routes validate the row handle as `>= 2` (a convention
-- inherited from the original Google Sheets store, where row 1 is the header).
--
-- The server connects with the service_role key and bypasses RLS, so no policies are
-- required for the MVP. If you later expose these tables to the anon key, add RLS.

create table if not exists public.starx_workers (
  pk           bigint generated always as identity (start with 2) primary key,
  telegram_id  text default '',
  name         text default '',
  phone        text default '',
  active        boolean default true,
  created_at   timestamptz default now()
);

create table if not exists public.starx_points (
  pk         bigint generated always as identity (start with 2) primary key,
  id         text default '',            -- business id (e.g. "P1")
  name       text default '',
  address    text default '',
  lat        text default '',
  lng        text default '',
  active     boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.starx_visits (
  pk                  bigint generated always as identity (start with 2) primary key,
  timestamp           timestamptz default now(),
  visit_id            text default '',
  worker_telegram_id  text default '',
  worker_name         text default '',
  point_id            text default '',
  point_name          text default '',
  lat                 text default '',
  lng                 text default '',
  maps_link           text default '',
  photo_count         integer default 0,
  photo_file_ids      text default '',
  note                text default ''
);

-- Helpful indexes for the dashboard/bot lookups.
create index if not exists idx_starx_visits_timestamp on public.starx_visits (timestamp desc);
create index if not exists idx_starx_workers_telegram on public.starx_workers (telegram_id);
