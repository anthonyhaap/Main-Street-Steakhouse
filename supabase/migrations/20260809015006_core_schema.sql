create extension if not exists pgcrypto;

create table nfl_teams (
  id          text primary key,
  name        text not null,
  espn_id     text unique
);

create table players (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  first_name  text,
  last_name   text,
  position    text not null,
  nfl_team    text references nfl_teams(id),
  status      text default 'ACT',
  bye_week    int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index players_position_idx on players (position);
create index players_name_idx on players (lower(full_name));

create table player_id_map (
  player_id   uuid not null references players(id) on delete cascade,
  source      text not null,
  source_id   text not null,
  primary key (source, source_id)
);
create index player_id_map_player_idx on player_id_map (player_id);

create table player_adp (
  player_id     uuid not null references players(id) on delete cascade,
  format        text not null,
  teams         int  not null,
  season        int  not null,
  adp           numeric,
  overall_rank  int,
  snapshot_at   timestamptz not null default now(),
  primary key (player_id, format, teams, season)
);

create table leagues (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  season          int  not null default 2026,
  commissioner_id uuid references auth.users(id),
  team_count      int  not null default 12,
  scoring_rules   jsonb not null default '{}'::jsonb,
  roster_slots    jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  name        text not null,
  owner_id    uuid references auth.users(id),
  draft_slot  int,
  created_at  timestamptz not null default now(),
  unique (league_id, draft_slot)
);
create index teams_league_idx on teams (league_id);

create type draft_status as enum ('setup', 'active', 'paused', 'complete');

create table drafts (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  status        draft_status not null default 'setup',
  type          text not null default 'snake',
  rounds        int  not null default 16,
  pick_seconds  int  not null default 90,
  current_pick  int  not null default 1,
  pick_deadline timestamptz,
  remaining_ms  int,
  started_at    timestamptz,
  completed_at  timestamptz,
  unique (league_id)
);

create table draft_picks (
  id           uuid primary key default gen_random_uuid(),
  draft_id     uuid not null references drafts(id) on delete cascade,
  pick_number  int  not null,
  round        int  not null,
  team_id      uuid not null references teams(id),
  player_id    uuid not null references players(id),
  is_autopick  boolean not null default false,
  made_by      uuid references auth.users(id),
  made_at      timestamptz not null default now(),
  unique (draft_id, pick_number),
  unique (draft_id, player_id)
);
create index draft_picks_draft_idx on draft_picks (draft_id, pick_number);

create table rosters (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  player_id  uuid not null references players(id),
  week       int  not null,
  slot       text not null,
  locked_at  timestamptz,
  unique (team_id, week, player_id)
);
create index rosters_team_week_idx on rosters (team_id, week);

create table matchups (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  week          int  not null,
  home_team_id  uuid not null references teams(id),
  away_team_id  uuid not null references teams(id),
  home_points   numeric not null default 0,
  away_points   numeric not null default 0,
  unique (league_id, week, home_team_id)
);

create table nfl_games (
  id             uuid primary key default gen_random_uuid(),
  espn_event_id  text unique not null,
  season         int  not null,
  season_type    int  not null,
  week           int  not null,
  home_team      text references nfl_teams(id),
  away_team      text references nfl_teams(id),
  kickoff_at     timestamptz,
  status         text,
  status_detail  text,
  updated_at     timestamptz not null default now()
);
create index nfl_games_week_idx on nfl_games (season, season_type, week);

create table player_stat_lines (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references players(id),
  game_id      uuid not null references nfl_games(id) on delete cascade,
  season       int  not null,
  season_type  int  not null,
  week         int  not null,
  stats        jsonb not null default '{}'::jsonb,
  revision     int  not null default 1,
  updated_at   timestamptz not null default now(),
  unique (player_id, game_id)
);
create index stat_lines_week_idx on player_stat_lines (season, season_type, week);

create table ingest_log (
  id         bigserial primary key,
  source     text not null,
  event      text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index ingest_log_created_idx on ingest_log (created_at desc);