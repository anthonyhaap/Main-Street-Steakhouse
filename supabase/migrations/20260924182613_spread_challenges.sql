-- ============================================================================
-- Against the spread.
--
-- The challenge desk could only settle one thing by itself: your own fantasy
-- matchup, against the one manager you play that week. Everything else went
-- to the commissioner. But the bet a table of managers actually argues about
-- on a Sunday is an NFL game and its line — "I'll take the Chiefs minus three"
-- — and any two of them can have it, whoever they play in fantasy.
--
-- THE LINE COMES FROM ESPN, AND IS YOURS TO MOVE. The scoreboard payload
-- ff_load_nfl_week already reads carries a consensus line on each game
-- (`odds[0].details`, "KC -3.5"). It lands on nfl_games as `home_spread` —
-- one number, the home side's, so there is no "which team is that" to get
-- wrong later. It is only the default: the challenger may shade it, and the
-- line that counts is the one on the challenge, copied at proposal and frozen
-- by the guard like the rest of the terms. The opponent sees it before
-- accepting.
--
-- ONE SIDE EACH. The challenger picks a team and a line; the opponent has the
-- other team at the opposite line. Nobody has to write terms — the title and
-- terms are written here from the game, so a spread bet reads the same on
-- every card and every push.
--
-- THE GAME'S KICKOFF LOCKS IT. A bet cannot be proposed or accepted once its
-- game has started, checked against nfl_games server-side the same way
-- ff_make_pick checks a pick'em pick. A proposal nobody answered by kickoff
-- expires.
--
-- THE FINAL DECIDES IT. When ESPN says Final, the challenger's margin plus
-- their line is the answer: above zero the challenger wins, below zero the opponent does,
-- exactly zero is a push and the bet is voided, the way a sportsbook refunds
-- one. Overtime counts. A game that never reaches Final (postponed, cancelled)
-- stays open for the commissioner's ruling, as any undecidable bet does.
-- ============================================================================

-- ------------------------------------------------------------- the line --

alter table public.nfl_games
  add column if not exists home_spread numeric(4,1);

comment on column public.nfl_games.home_spread is
  'The home side''s point spread from ESPN''s consensus line: -3.5 means the home team is favoured by 3.5. Null when ESPN has none. Kept once the game kicks off, so the closing line stays readable after ESPN drops it.';

-- ESPN writes the line as "<favourite> <number>" in its own abbreviations:
-- "KC -3.5", or "EVEN" for a pick'em. Read against the same competitors
-- object, so the abbreviation is compared to ESPN's own spelling and never to
-- ours (WSH/WAS, LA/LAR). Anything that does not parse is no line at all.
create or replace function public.ff_espn_home_spread(p_competition jsonb)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare v_details text; v_home text; v_away text; v_fav text; v_line numeric;
begin
  v_details := btrim(p_competition->'odds'->0->>'details');
  if v_details is null or v_details = '' then return null; end if;
  if upper(v_details) in ('EVEN', 'PK', 'PICK', 'PICKEM', 'PICK''EM') then return 0; end if;
  if v_details !~ '^[A-Za-z]{2,4} [-+]?[0-9]{1,2}(\.[05])?$' then return null; end if;

  v_fav  := upper(split_part(v_details, ' ', 1));
  v_line := split_part(v_details, ' ', 2)::numeric;
  select upper(c->'team'->>'abbreviation') into v_home
    from jsonb_array_elements(coalesce(p_competition->'competitors', '[]'::jsonb)) c where c->>'homeAway' = 'home';
  select upper(c->'team'->>'abbreviation') into v_away
    from jsonb_array_elements(coalesce(p_competition->'competitors', '[]'::jsonb)) c where c->>'homeAway' = 'away';

  if v_fav = v_home then return v_line;
  elsif v_fav = v_away then return -v_line;
  end if;
  return null;
end $$;

-- The same body as 20260917025200 with the line added to the one upsert.
create or replace function public.ff_load_nfl_week(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_body text; v_n integer := 0;
begin
  select content into v_body from extensions.http_get(format(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=%s&seasontype=2&week=%s',
    p_season, p_week));
  if v_body is null then return 0; end if;

  insert into nfl_games (espn_event_id, season, season_type, week, home_team, away_team,
                         kickoff_at, status, status_detail, home_score, away_score, home_spread, updated_at)
  select e->>'id', p_season, 2, p_week,
         ht.abbr, at.abbr,
         (e->>'date')::timestamptz,
         e->'competitions'->0->'status'->'type'->>'state',
         e->'competitions'->0->'status'->'type'->>'shortDetail',
         (select c->>'score' from jsonb_array_elements(e->'competitions'->0->'competitors') c
           where c->>'homeAway' = 'home')::integer,
         (select c->>'score' from jsonb_array_elements(e->'competitions'->0->'competitors') c
           where c->>'homeAway' = 'away')::integer,
         public.ff_espn_home_spread(e->'competitions'->0),
         now()
  from jsonb_array_elements((v_body::jsonb)->'events') e
  cross join lateral (
    select coalesce(t.espn_id, t.id) as espn, t.id as abbr from nfl_teams t
    where coalesce(t.espn_id, t.id) = (
      select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
      where c->>'homeAway' = 'home')) ht
  cross join lateral (
    select t.id as abbr from nfl_teams t
    where coalesce(t.espn_id, t.id) = (
      select c->'team'->>'abbreviation' from jsonb_array_elements(e->'competitions'->0->'competitors') c
      where c->>'homeAway' = 'away')) at
  on conflict (espn_event_id) do update
    set kickoff_at = excluded.kickoff_at, status = excluded.status,
        status_detail = excluded.status_detail, home_score = excluded.home_score,
        away_score = excluded.away_score,
        -- Moves while the game is ahead. Once ESPN says it is on, what ESPN
        -- sends is a live line, so the closing line stays.
        home_spread = case when excluded.status = 'pre'
                           then coalesce(excluded.home_spread, nfl_games.home_spread)
                           else coalesce(nfl_games.home_spread, excluded.home_spread) end,
        updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.ff_load_nfl_week(integer, integer) from public, anon, authenticated;

-- ------------------------------------------------------------- the bet --

alter table public.challenges
  add column if not exists nfl_game_id uuid references public.nfl_games(id),
  add column if not exists spread_team text references public.nfl_teams(id),
  add column if not exists spread_line numeric(4,1);

comment on column public.challenges.spread_team is
  'For an nfl_spread bet, the challenger''s side. The opponent has the other team in nfl_game_id.';
comment on column public.challenges.spread_line is
  'For an nfl_spread bet, the challenger''s line on spread_team: -3.5 gives 3.5 points, +3.5 gets them. The opponent has the opposite.';

alter table public.challenges drop constraint if exists challenges_proposition_type_check;
alter table public.challenges add constraint challenges_proposition_type_check
  check (proposition_type in ('weekly_matchup_winner','higher_player_points','season_finish','custom','nfl_spread'));

alter table public.challenges drop constraint if exists challenges_spread_shape_check;
alter table public.challenges add constraint challenges_spread_shape_check check (
  (proposition_type = 'nfl_spread') = (nfl_game_id is not null and spread_team is not null and spread_line is not null)
  and (spread_line is null or (abs(spread_line) <= 50 and spread_line * 2 = trunc(spread_line * 2))));

create index if not exists challenges_nfl_game_status_idx on public.challenges(nfl_game_id, status)
  where nfl_game_id is not null;

-- "KC -3.5", "BUF +3", "KC PK".
create or replace function public.ff_spread_text(p_team text, p_line numeric)
returns text
language sql
immutable
as $$
  select p_team || ' ' || case when p_line = 0 then 'PK'
                               when p_line > 0 then '+' || trim_scale(p_line)::text
                               else trim_scale(p_line)::text end
$$;

create or replace function public.ff_create_spread_challenge(
  p_league_id uuid, p_opponent_id uuid, p_game_id uuid, p_team text, p_line numeric,
  p_stake_amount_cents integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_game  public.nfl_games%rowtype;
  v_other text;
  v_title text;
  v_terms text;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'league membership required'; end if;
  if p_opponent_id is null or p_opponent_id = v_uid then raise exception 'choose another manager'; end if;
  if not exists (select 1 from public.teams where league_id = p_league_id and owner_id = p_opponent_id) then
    raise exception 'opponent is not an active league manager';
  end if;
  if p_stake_amount_cents is not null and p_stake_amount_cents not between 100 and 50000 then
    raise exception 'amount must be between $1 and $500';
  end if;

  select * into v_game from public.nfl_games where id = p_game_id;
  if not found then raise exception 'no such game'; end if;
  if v_game.kickoff_at is null or v_game.kickoff_at <= now() or v_game.status is distinct from 'pre' then
    raise exception 'that game has kicked off — no more bets on it';
  end if;
  if p_team is null or p_team not in (v_game.home_team, v_game.away_team) then
    raise exception 'that team is not in this game';
  end if;
  if p_line is null or abs(p_line) > 50 or p_line * 2 <> trunc(p_line * 2) then
    raise exception 'the line must be a whole or half point, no more than 50';
  end if;

  v_other := case when p_team = v_game.home_team then v_game.away_team else v_game.home_team end;
  v_title := public.ff_spread_text(p_team, p_line)
          || case when p_team = v_game.home_team then ' vs ' else ' at ' end || v_other;
  v_terms := format(
    '%s takes %s. %s takes %s. Week %s, decided by the final score, overtime included. '
    'Landing exactly on the number is a push: the bet is off and nothing is owed.',
    public.ff_challenge_who(p_league_id, v_uid), public.ff_spread_text(p_team, p_line),
    public.ff_challenge_who(p_league_id, p_opponent_id), public.ff_spread_text(v_other, -p_line),
    v_game.week);

  insert into public.challenges (league_id, challenger_id, opponent_id, title, terms, stake_label,
                                 proposition_type, status, stake_amount_cents,
                                 nfl_game_id, spread_team, spread_line)
  values (p_league_id, v_uid, p_opponent_id, v_title, v_terms,
          case when p_stake_amount_cents is null then 'Bragging rights' else 'External settlement' end,
          'nfl_spread', 'proposed', p_stake_amount_cents, p_game_id, p_team, p_line)
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------ the guard --
-- As 20260917014122, with the game, side and line frozen with the terms.

create or replace function public.ff_guard_challenge_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.title <> old.title or new.terms <> old.terms or new.stake_label <> old.stake_label
     or new.proposition_type <> old.proposition_type or new.challenger_id <> old.challenger_id
     or new.opponent_id <> old.opponent_id or new.league_id <> old.league_id
     or new.stake_amount_cents is distinct from old.stake_amount_cents
     or new.matchup_id is distinct from old.matchup_id
     or new.nfl_game_id is distinct from old.nfl_game_id
     or new.spread_team is distinct from old.spread_team
     or new.spread_line is distinct from old.spread_line then
    raise exception 'challenge terms cannot change after proposal';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'proposed' and new.status not in ('accepted','declined','expired') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'accepted' and new.status not in ('resolved','settled','voided') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'resolved' and new.status not in ('payment_pending','disputed','settled','voided') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'payment_pending' and new.status not in ('settled','disputed') then
      raise exception 'invalid challenge transition';
    elsif old.status = 'disputed' and new.status not in ('resolved','settled','voided') then
      raise exception 'invalid challenge transition';
    elsif old.status in ('declined','expired','settled','voided') then
      raise exception 'challenge is final';
    end if;
  end if;
  if new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
    new.locked_at := coalesce(new.locked_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------- the answer --
-- As 20260827033240, and a spread bet cannot be taken once its game is on:
-- accepting at halftime is betting on a score you can already see.

create or replace function public.ff_respond_challenge(p_challenge_id uuid,p_response text)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_response not in ('accepted','declined') then raise exception 'response must be accepted or declined'; end if;
  if p_response='accepted' and exists(
       select 1 from public.challenges c join public.nfl_games g on g.id = c.nfl_game_id
        where c.id = p_challenge_id and c.proposition_type = 'nfl_spread'
          and (g.kickoff_at is null or g.kickoff_at <= now() or g.status is distinct from 'pre')) then
    raise exception 'that game has kicked off — the bet can no longer be taken';
  end if;
  if p_response='accepted' and exists(select 1 from public.challenges where id=p_challenge_id and stake_amount_cents is not null)
     and (select count(*) from public.profiles p where p.id in (
       select challenger_id from public.challenges where id=p_challenge_id union select opponent_id from public.challenges where id=p_challenge_id
     ) and p.settlement_opt_in_at is not null and p.settlement_handle is not null) <> 2 then
    raise exception 'both managers must save an external settlement handle before accepting';
  end if;
  update public.challenges set status=p_response where id=p_challenge_id and opponent_id=auth.uid() and status='proposed' returning * into v_result;
  if v_result.id is null then raise exception 'challenge is unavailable or not yours'; end if;
  return v_result;
end $$;

-- --------------------------------------------------------- the resolver --

create or replace function public.ff_resolve_spread_challenges()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_expired integer; v_decided integer;
begin
  -- Nobody answered before kickoff.
  update public.challenges c
     set status = 'expired'
    from public.nfl_games g
   where g.id = c.nfl_game_id and c.proposition_type = 'nfl_spread' and c.status = 'proposed'
     and (g.kickoff_at <= now() or g.status is distinct from 'pre');
  get diagnostics v_expired = row_count;

  -- Final. `cover` is the challenger's margin plus their line.
  with ready as (
    select c.id, g.home_team, g.away_team, g.home_score, g.away_score,
           (case when c.spread_team = g.home_team then g.home_score - g.away_score
                 else g.away_score - g.home_score end) + c.spread_line as cover
      from public.challenges c
      join public.nfl_games g on g.id = c.nfl_game_id
     where c.status = 'accepted' and c.proposition_type = 'nfl_spread'
       and g.status = 'post' and g.status_detail ilike 'final%'
       and g.home_score is not null and g.away_score is not null
  )
  update public.challenges c
     set status = case when r.cover = 0 then 'voided'
                       when c.stake_amount_cents is null then 'settled'
                       else 'resolved' end,
         winner_id = case when r.cover > 0 then c.challenger_id
                          when r.cover < 0 then c.opponent_id end,
         resolved_at = now(),
         settlement_due_at = case when c.stake_amount_cents is null or r.cover = 0
                                  then null else now() + interval '7 days' end,
         resolution_evidence = jsonb_build_object('source', 'nfl_final',
                                 'home_team', r.home_team, 'home_score', r.home_score,
                                 'away_team', r.away_team, 'away_score', r.away_score,
                                 'spread_team', c.spread_team, 'spread_line', c.spread_line)
    from ready r where c.id = r.id;
  get diagnostics v_decided = row_count;

  return v_expired + v_decided;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'resolve-spread-challenges';
select cron.schedule('resolve-spread-challenges', '*/5 * * * *', 'select public.ff_resolve_spread_challenges()');

-- ------------------------------------------------------------- the grants --
revoke execute on function public.ff_espn_home_spread(jsonb)                                   from public, anon, authenticated;
revoke execute on function public.ff_spread_text(text, numeric)                                from public, anon;
revoke execute on function public.ff_create_spread_challenge(uuid, uuid, uuid, text, numeric, integer) from public, anon;
revoke execute on function public.ff_resolve_spread_challenges()                               from public, anon, authenticated;

grant execute on function public.ff_espn_home_spread(jsonb)                                    to service_role;
grant execute on function public.ff_spread_text(text, numeric)                                 to authenticated, service_role;
grant execute on function public.ff_create_spread_challenge(uuid, uuid, uuid, text, numeric, integer) to authenticated, service_role;
grant execute on function public.ff_resolve_spread_challenges()                                to service_role;
