-- ============================================================
-- VINICUS Y AMIGOS — esquema de base de datos (Supabase / Postgres)
-- ============================================================
-- Cómo usarlo:
-- 1. Entra en tu proyecto de Supabase → apartado "SQL Editor".
-- 2. Pega TODO este archivo y dale a "Run".
-- 3. Ya está: las tablas quedan creadas y listas para que el
--    servidor Node las use a través de la API REST de Supabase.
-- ============================================================

create table if not exists users (
  username    text primary key,
  alias       text not null,
  role        text not null default 'Minion menaje',
  steam_id    text default '',
  email       text,
  avatar      text,
  salt        text not null,
  hash        text not null
);

-- Si tu tabla "users" ya existía de antes (proyecto ya desplegado),
-- la línea de arriba no la toca. Ejecuta esta también (es segura,
-- no hace nada si la columna ya existe) para añadir el email sin
-- perder ningún dato:
alter table users add column if not exists email text;

-- Evita que dos miembros vinculen el mismo email de Google (ignora
-- mayúsculas/minúsculas y a los que todavía no tienen email puesto).
create unique index if not exists users_email_unique_idx
  on users (lower(email))
  where email is not null and email <> '';

create table if not exists board_notes (
  id       bigint generated always as identity primary key,
  username text not null references users(username) on delete cascade,
  text     text not null,
  ts       bigint not null
);

create table if not exists hall_images (
  id        bigint generated always as identity primary key,
  username  text not null references users(username) on delete cascade,
  data_url  text not null,
  ts        bigint not null
);

create table if not exists wipe_signups (
  wipe_id text primary key,
  trios   text[] not null default '{}',
  main    text[] not null default '{}'
);

create table if not exists raid_list (
  id             bigint generated always as identity primary key,
  structure_id   text not null,
  explosive_key  text not null,
  qty            int  not null default 1
);

-- Amonestaciones y méritos: puntos por wipe. Las faltas (leve = 1,
-- grave = 2) degradan el rango al llegar a 10 puntos; los méritos
-- (mérito = 1, hazaña = 2) lo ascienden al llegar a 10. Las faltas
-- se pueden apelar una vez; Gru decide si acepta o rechaza.
create table if not exists wipe_points (
  id            bigint generated always as identity primary key,
  wipe_id       text not null,
  username      text not null references users(username) on delete cascade,
  kind          text not null check (kind in ('falta', 'merito')),
  weight        int  not null default 1 check (weight in (1, 2)),
  reported_by   text,
  appeal_status text check (appeal_status in ('pendiente', 'rechazada')),
  appeal_text   text,
  ts            bigint not null
);

create index if not exists wipe_points_wipe_user_idx on wipe_points (wipe_id, username);

create table if not exists enemies (
  id         bigint generated always as identity primary key,
  server_id  text not null,
  name       text not null,
  steam_id   text default '',
  team       text default '',
  ts         bigint not null
);

-- Row Level Security: la app solo habla con Supabase desde el
-- backend Node usando la service_role key, que se salta RLS por
-- diseño. Aun así dejamos RLS activada y sin políticas públicas,
-- para que nadie pueda leer/escribir estas tablas directamente
-- con la clave "anon" (pública) si alguna vez se filtra.
alter table users        enable row level security;
alter table board_notes  enable row level security;
alter table hall_images  enable row level security;
alter table wipe_signups enable row level security;
alter table wipe_points  enable row level security;
alter table raid_list    enable row level security;
alter table enemies      enable row level security;
