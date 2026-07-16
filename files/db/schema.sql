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

-- Última vez que vimos online a cada enemigo en BattleMetrics
-- (milisegundos desde epoch). Si tu tabla "enemies" ya existía,
-- esta línea añade la columna sin tocar ningún dato.
alter table enemies add column if not exists last_seen bigint;

-- Vínculo de cada servidor de la app con su servidor en
-- BattleMetrics (el número que sale en la URL, p. ej.
-- battlemetrics.com/servers/rust/1234567 → "1234567").
-- Se rellena desde la propia pestaña Enemigos de la app.
create table if not exists server_settings (
  server_id    text primary key,
  bm_server_id text not null default ''
);

-- Equipos enemigos: además del nombre guardamos cuántos son y en
-- qué cuadrante del mapa viven (ej. "K13"). Los enemigos se siguen
-- vinculando a su equipo por el nombre (columna "team" de enemies).
create table if not exists enemy_teams (
  id        bigint generated always as identity primary key,
  server_id text not null,
  name      text not null,
  size      int,
  quadrant  text default '',
  ts        bigint not null
);

-- Evita dos equipos con el mismo nombre en el mismo servidor
-- (ignorando mayúsculas/minúsculas).
create unique index if not exists enemy_teams_server_name_idx
  on enemy_teams (server_id, lower(name));

-- ============================================================
-- BASES — repositorio de diseños de base
-- ============================================================
-- Cada base guarda su vídeo de YouTube, etiquetas (tamaño de
-- equipo, bunker) y coste de construcción en piedra y metal.
create table if not exists bases (
  id          bigint generated always as identity primary key,
  name        text not null,
  youtube_url text default '',
  team_size   text not null default '' check (team_size in ('', 'trio', 'zerg')),
  bunker      boolean not null default false,
  cost_stone  int,
  cost_metal  int,
  notes       text default '',
  created_by  text,
  ts          bigint not null
);

-- Votación en bananas 🍌: cada miembro puntúa cada base de 1 a 5.
-- Un voto por persona y base (si vuelve a votar, se actualiza).
create table if not exists base_votes (
  id       bigint generated always as identity primary key,
  base_id  bigint not null references bases(id) on delete cascade,
  username text not null references users(username) on delete cascade,
  bananas  int not null check (bananas between 1 and 5),
  ts       bigint not null
);

create unique index if not exists base_votes_base_user_idx
  on base_votes (base_id, username);

-- Hoja de servicio: cada vez que se usa una base en un wipe se
-- apunta cuánto aguantó y cómo acabó. Los finales que no son
-- "sobrevivio" alimentan el Cementerio de Bases. 💀
create table if not exists base_usages (
  id            bigint generated always as identity primary key,
  base_id       bigint not null references bases(id) on delete cascade,
  wipe_label    text not null,
  server_id     text default '',
  days_survived int,
  outcome       text not null check (outcome in ('sobrevivio', 'raid_offline', 'raid_online', 'decay', 'abandonada')),
  notes         text default '',
  created_by    text,
  ts            bigint not null
);

create index if not exists base_usages_base_idx on base_usages (base_id);

-- Draft del wipe: se proponen varias bases del repositorio y la
-- Zerg vota cuál se construye. Solo puede haber un draft abierto
-- a la vez; al cerrarlo queda registrada la ganadora.
create table if not exists base_drafts (
  id             bigint generated always as identity primary key,
  wipe_label     text not null,
  status         text not null default 'abierto' check (status in ('abierto', 'cerrado')),
  winner_base_id bigint,
  created_by     text,
  ts             bigint not null
);

create table if not exists base_draft_candidates (
  id       bigint generated always as identity primary key,
  draft_id bigint not null references base_drafts(id) on delete cascade,
  base_id  bigint not null references bases(id) on delete cascade
);

create unique index if not exists base_draft_candidates_idx
  on base_draft_candidates (draft_id, base_id);

-- Un voto por persona y draft (si vuelve a votar, se actualiza).
create table if not exists base_draft_votes (
  id       bigint generated always as identity primary key,
  draft_id bigint not null references base_drafts(id) on delete cascade,
  base_id  bigint not null,
  username text not null references users(username) on delete cascade,
  ts       bigint not null
);

create unique index if not exists base_draft_votes_idx
  on base_draft_votes (draft_id, username);

-- ============================================================
-- TEMÁTICA DEL WIPE 🎭
-- ============================================================
-- Una palabra (sustantivo) por wipe, compartida por toda la Zerg:
-- la primera persona que pulsa el botón la genera y queda guardada;
-- solo Gru puede volver a tirar. A partir de ella todos adaptan
-- sus perfiles para ese wipe.
create table if not exists wipe_themes (
  wipe_id      text primary key,
  word         text not null,
  generated_by text,
  ts           bigint not null
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
alter table server_settings enable row level security;
alter table enemy_teams  enable row level security;
alter table bases        enable row level security;
alter table base_votes   enable row level security;
alter table base_usages  enable row level security;
alter table base_drafts  enable row level security;
alter table base_draft_candidates enable row level security;
alter table base_draft_votes      enable row level security;
alter table wipe_themes  enable row level security;
