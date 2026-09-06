-- ============================================================================
-- Polls: a question the whole house answers.
--
-- Reactions made the feed answerable without typing. A poll is the other half:
-- a question somebody deliberately asks, with the league's answer attached to
-- it for ever. "Who wins the Chase trade" is the argument a league has anyway,
-- and having it in one place with a tally beats having it four times in a group
-- chat nobody can search.
--
-- Three decisions worth defending, because they are what make this a poll
-- rather than a form:
--
-- ONE VOTE, CHANGEABLE. The primary key is (poll_id, user_id), so voting again
-- moves your vote rather than adding one. Multi-select was tempting and is
-- wrong: a poll where everybody can pick everything measures nothing.
--
-- THE SPLIT IS HIDDEN UNTIL YOU ANSWER. A poll that shows you the running score
-- before you vote measures conformity, not opinion — the first three answers
-- decide the rest. So the counts come back NULL until you have voted or the
-- poll has closed. The TOTAL is always visible, because "nine have voted" is
-- pressure to join in without being pressure to agree.
--
-- NO NAMES, EVER. `poll_votes` records who voted for what — it has to, to let
-- you change your mind — but nothing reads it back per person, and there is no
-- function that will. In a league of twelve, "who voted for that" is exactly
-- the thing that stops people voting honestly.
--
-- A poll is a third kind of feed item, so ff_house_feed gains a `poll` source
-- and `reactions` learns to key on it. That keeps the House one column: the
-- question, the argument about it, and the trade that started it, in order.
-- ============================================================================

create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  author_id  uuid references auth.users(id) on delete set null,
  question   text not null check (char_length(btrim(question)) between 1 and 140),
  -- Optional. A poll with no deadline stays open, which is right for "who is
  -- winning the league" and wrong for "should we move the draft" — the asker
  -- knows which he is asking.
  closes_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists polls_league_idx on public.polls (league_id, created_at desc);

create table if not exists public.poll_options (
  id      uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label   text not null check (char_length(btrim(label)) between 1 and 80),
  seq     integer not null default 0,
  unique (poll_id, seq)
);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id, seq);

create table if not exists public.poll_votes (
  poll_id   uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  voted_at  timestamptz not null default now(),
  -- One per person per poll. Changing your mind is an update, not a second vote.
  primary key (poll_id, user_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);

comment on table public.poll_votes is
  'One row per manager per poll. Records which option, so a vote can be changed — never read back per person, deliberately.';

alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated using (public.ff_is_member());

drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options
  for select to authenticated using (public.ff_is_member());

-- Your own vote and nobody else's. The tallies come from ff_poll_for, which is
-- SECURITY DEFINER and returns counts rather than rows — so this policy being
-- narrow costs the feature nothing and is what keeps the ballot secret.
drop policy if exists poll_votes_own on public.poll_votes;
create policy poll_votes_own on public.poll_votes
  for select to authenticated using (user_id = auth.uid());

-- Writes go through the functions below, which is where the checks live. See
-- 20260906135048: `revoke all from public, anon` is not enough on this project,
-- so authenticated is named explicitly.
revoke all on table public.polls, public.poll_options, public.poll_votes
  from public, anon, authenticated;
grant select on table public.polls, public.poll_options, public.poll_votes
  to authenticated;

-- ------------------------------------------------------------- asking one --

create or replace function public.ff_create_poll(
  p_league_id uuid,
  p_question  text,
  p_options   text[],
  p_closes_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_clean text[];
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- Blanks removed before counting, so " " does not pass for an option.
  select array_agg(o) into v_clean
    from (select distinct btrim(o) as o from unnest(coalesce(p_options,'{}')) o
           where btrim(o) <> '') s;

  if coalesce(array_length(v_clean, 1), 0) < 2 then
    raise exception 'a poll needs at least two answers';
  end if;
  if array_length(v_clean, 1) > 6 then
    raise exception 'six answers is the most a poll can carry';
  end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'ask something'; end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception 'that deadline has already passed';
  end if;

  insert into polls (league_id, author_id, question, closes_at)
  values (p_league_id, v_uid, btrim(p_question), p_closes_at)
  returning id into v_id;

  insert into poll_options (poll_id, label, seq)
  select v_id, o, i from unnest(v_clean) with ordinality as t(o, i);

  return v_id;
end $$;

-- -------------------------------------------------------------- answering --

create or replace function public.ff_vote(p_poll_id uuid, p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_league uuid; v_closes timestamptz;
begin
  if v_uid is null then raise exception 'sign in first'; end if;

  select league_id, closes_at into v_league, v_closes from polls where id = p_poll_id;
  if v_league is null then raise exception 'no such poll'; end if;

  if not exists (select 1 from teams where league_id = v_league and owner_id = v_uid)
     and (select commissioner_id from leagues where id = v_league) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  if v_closes is not null and v_closes <= now() then
    raise exception 'that poll has closed';
  end if;

  -- The option must belong to the poll being answered. Without this a manager
  -- could vote for an option from a different poll and land a row that every
  -- tally would then have to defend itself against.
  if not exists (select 1 from poll_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'that answer is not on this poll';
  end if;

  insert into poll_votes (poll_id, option_id, user_id)
  values (p_poll_id, p_option_id, v_uid)
  on conflict (poll_id, user_id) do update
    set option_id = excluded.option_id, voted_at = now();

  return ff_poll_for(p_poll_id);
end $$;

-- ------------------------------------------------------------- reading one --

-- The poll as the person looking at it may see it: always the question, the
-- answers and how many have voted; the SPLIT only once he has voted himself or
-- the thing has closed.
create or replace function public.ff_poll_for(p_poll_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (select * from polls where id = p_poll_id),
  mine as (select option_id from poll_votes where poll_id = p_poll_id and user_id = auth.uid()),
  total as (select count(*)::int as n from poll_votes where poll_id = p_poll_id),
  shown as (
    select (select option_id from mine) is not null
        or (select closes_at from p) <= now() as ok
  )
  select jsonb_build_object(
    'poll_id', p.id,
    'question', p.question,
    'closes_at', p.closes_at,
    'closed', p.closes_at is not null and p.closes_at <= now(),
    'votes', (select n from total),
    'my_option', (select option_id from mine),
    -- Null rather than zero when the split is withheld: zero is a number, and a
    -- reader would take it for one.
    'revealed', (select ok from shown),
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'option_id', o.id, 'label', o.label,
               'count', case when (select ok from shown)
                             then (select count(*) from poll_votes v where v.option_id = o.id)
                             else null end,
               'mine', o.id = (select option_id from mine)
             ) order by o.seq), '[]'::jsonb)
        from poll_options o where o.poll_id = p.id))
    from p
$$;

revoke execute on function public.ff_create_poll(uuid,text,text[],timestamptz) from public, anon;
revoke execute on function public.ff_vote(uuid,uuid)                           from public, anon;
revoke execute on function public.ff_poll_for(uuid)                            from public, anon;
grant execute on function public.ff_create_poll(uuid,text,text[],timestamptz) to authenticated, service_role;
grant execute on function public.ff_vote(uuid,uuid)                            to authenticated, service_role;
grant execute on function public.ff_poll_for(uuid)                             to authenticated, service_role;

-- ------------------------------------------------- a poll is a feed item --

-- Reactions key on (source, target_id); a poll is now a third source, so the
-- constraint has to admit it or the House would carry an item nobody can react
-- to, which reads as a bug rather than a rule.
alter table public.reactions drop constraint if exists reactions_source_check;
alter table public.reactions add constraint reactions_source_check
  check (source in ('message','event','poll'));

-- And ff_react has to admit it as well. Widening the constraint alone left the
-- function rejecting 'poll' as "no such feed" — two guards on the same rule,
-- and moving one is how they drift apart. polls.sql now presses a reaction onto
-- a poll for exactly this reason.
create or replace function public.ff_react(
  p_league_id uuid,
  p_source    text,
  p_target_id uuid,
  p_emoji     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_n integer; v_on boolean; v_ok boolean;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_source not in ('message','event','poll') then raise exception 'no such feed'; end if;

  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  -- The target must exist, in this league, in the stream it says it is in.
  v_ok := case p_source
    when 'message' then exists (select 1 from league_messages  where id = p_target_id and league_id = p_league_id)
    when 'event'   then exists (select 1 from activity_events where id = p_target_id and league_id = p_league_id)
    when 'poll'    then exists (select 1 from polls           where id = p_target_id and league_id = p_league_id)
  end;
  if not v_ok then raise exception 'no such line in this league'; end if;

  delete from reactions
   where source = p_source and target_id = p_target_id
     and user_id = v_uid and emoji = p_emoji;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    insert into reactions (league_id, source, target_id, user_id, emoji)
    values (p_league_id, p_source, p_target_id, v_uid, p_emoji);
    v_on := true;
  else
    v_on := false;
  end if;

  return jsonb_build_object('on', v_on, 'emoji', p_emoji,
    'count', (select count(*) from reactions
               where source = p_source and target_id = p_target_id and emoji = p_emoji));
end $$;

-- Re-declared to merge a third stream. Everything else is 20260906131812.
create or replace function public.ff_house_feed(
  p_league_id uuid,
  p_before    timestamptz default null,
  p_limit     integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_team  uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_rows  jsonb;
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and (select commissioner_id from leagues where id = p_league_id) is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  select id into v_team from teams
   where league_id = p_league_id and owner_id = v_uid limit 1;

  with said as (
    select lm.id, lm.created_at as at, 'message'::text as source, lm.kind,
           lm.body, null::text as detail,
           case when lm.kind = 'house' then 'The House'
                else coalesce(t.manager_name, t.name, 'League manager') end as author,
           t.id as author_team_id,
           coalesce(lm.author_id = v_uid, false) as mine,
           lm.matchup_id, null::text as source_type, null::uuid as source_id
      from league_messages lm
      left join teams t on t.owner_id = lm.author_id and t.league_id = p_league_id
     where lm.league_id = p_league_id
       and (p_before is null or lm.created_at < p_before)
  ),
  did as (
    select ae.id, ae.created_at as at, 'event'::text as source, ae.event_type as kind,
           ae.headline as body, ae.detail,
           t.name as author, t.id as author_team_id,
           coalesce(ae.actor_id = v_uid, false) as mine,
           null::uuid as matchup_id, ae.source_type, ae.source_id
      from activity_events ae
      left join teams t on t.owner_id = ae.actor_id and t.league_id = p_league_id
     where ae.league_id = p_league_id
       and (p_before is null or ae.created_at < p_before)
  ),
  asked as (
    select pl.id, pl.created_at as at, 'poll'::text as source, 'poll'::text as kind,
           pl.question as body, null::text as detail,
           coalesce(t.manager_name, t.name, 'League manager') as author,
           t.id as author_team_id,
           coalesce(pl.author_id = v_uid, false) as mine,
           null::uuid as matchup_id, null::text as source_type, null::uuid as source_id
      from polls pl
      left join teams t on t.owner_id = pl.author_id and t.league_id = p_league_id
     where pl.league_id = p_league_id
       and (p_before is null or pl.created_at < p_before)
  ),
  merged as (
    select * from said
    union all select * from did
    union all select * from asked
    order by at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'at', m.at, 'source', m.source, 'kind', m.kind,
           'body', m.body, 'detail', m.detail,
           'author', m.author, 'author_team_id', m.author_team_id, 'mine', m.mine,
           'source_type', m.source_type, 'source_id', m.source_id,
           'reactions', ff_reactions_for(m.source, m.id),
           'poll', case when m.source = 'poll' then ff_poll_for(m.id) else null end,
           'matchup', case when m.matchup_id is null then null else (
             select jsonb_build_object(
                      'id', mu.id, 'week', mu.week,
                      'home', th.name, 'away', ta.name,
                      'mine', v_team is not null and v_team in (mu.home_team_id, mu.away_team_id))
               from matchups mu
               join teams th on th.id = mu.home_team_id
               join teams ta on ta.id = mu.away_team_id
              where mu.id = m.matchup_id) end
         ) order by m.at desc), '[]'::jsonb)
    into v_rows from merged m;

  return jsonb_build_object(
    'items', v_rows,
    'next_before', case when jsonb_array_length(v_rows) < v_limit then null
                        else (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'at') end,
    'now', now());
end $fn$;

-- ------------------------------------------------------------ polls, live --
do $$ begin alter publication supabase_realtime add table public.polls;
  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.poll_votes;
  exception when duplicate_object then null; end $$;
