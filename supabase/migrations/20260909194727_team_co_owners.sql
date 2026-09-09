-- ============================================================================
-- Co-owners: two people at one seat.
--
-- A team has had exactly one person behind it since the first migration —
-- teams.owner_id, one uuid — and every "is this your team" question in the
-- database has been some spelling of `owner_id = auth.uid()`. Leagues are not
-- run that way. Brothers share a team, a father drafts with his son, a manager
-- travelling the week of the draft hands a friend the queue. Until now the only
-- way to do any of that was to share a password, which is the one thing the
-- invite link was built to make unnecessary.
--
-- So a team keeps its owner and gains co-owners. The owner is still the
-- manager: the name on the standings, the address the commissioner's invite
-- went to, the one who hands seats out. A co-owner holds the same seat — sets
-- the lineup, drafts, claims waivers, trades, talks in the house, edits the
-- crest. The difference between the two is who may invite whom, and nothing
-- else.
--
-- Three pieces:
--
--   1. `team_co_owners` — who sits where. One seat per person per league, so
--      nobody co-owns two teams in the same league or co-owns one while owning
--      another. The unique index says so; ff_claim_invite refuses in English
--      before the index has to.
--
--   2. `co_owner_invites` — the token flow of 20260905154627, one table over.
--      The owner or the commissioner records an address, a link goes to it
--      carrying a single-use secret, and whoever holds the secret takes the
--      seat. ff_invite_preview and ff_claim_invite serve both kinds of link,
--      so /join is the same screen for a co-owner as for a manager.
--
--   3. Every ownership check learns the second answer. That is the bulk of
--      this file, done two ways. The helpers everything leans on —
--      ff_is_member, ff_owns_team, ff_link_me — are rewritten by hand. The
--      twenty functions that asked inline are rewritten in place; see "the
--      rewrite" below for why, and for what proves it did what it says.
-- ============================================================================


-- ---------------------------------------------------------------- the seats --

create table if not exists public.team_co_owners (
  team_id    uuid not null references public.teams(id)   on delete cascade,
  user_id    uuid not null references auth.users(id)     on delete cascade,
  -- Denormalised from the team so "one seat per league" can be an index
  -- rather than a trigger. ff_claim_invite copies it from the team row.
  league_id  uuid not null references public.leagues(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (league_id, user_id)
);
create index if not exists team_co_owners_user_idx on public.team_co_owners (user_id);

comment on table public.team_co_owners is
  'A second (or third) person behind a team, with the owner''s standing on every screen except this one. One seat per person per league.';

create table if not exists public.co_owner_invites (
  id         uuid primary key default gen_random_uuid(),
  -- The secret in the link. Never read back by a client: ff_team_seats lists
  -- invites by id and address, and the token leaves the database only inside
  -- the mail the API route sends.
  token      uuid not null unique default gen_random_uuid(),
  team_id    uuid not null references public.teams(id)   on delete cascade,
  league_id  uuid not null references public.leagues(id) on delete cascade,
  email      text not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null
);
create index if not exists co_owner_invites_team_idx on public.co_owner_invites (team_id) where claimed_at is null;

comment on column public.co_owner_invites.token is
  'Single-use secret in this invite''s link. A claimed invite keeps its row, with claimed_at set, so a spent link is refused rather than unknown.';

alter table public.team_co_owners   enable row level security;
alter table public.co_owner_invites enable row level security;

-- Who co-owns what is league-public, like the teams table it hangs off.
drop policy if exists team_co_owners_read on public.team_co_owners;
create policy team_co_owners_read on public.team_co_owners
  for select to authenticated using (public.ff_is_member(league_id));

-- Invites are addresses and secrets. Nothing reads them but ff_team_seats,
-- which is SECURITY DEFINER and hands back the address to the owner and the
-- commissioner only — so the table has no read grant at all.
-- See 20260906135048: `revoke all from public, anon` is not enough here.
revoke all on table public.team_co_owners, public.co_owner_invites
  from public, anon, authenticated;
grant select on table public.team_co_owners to authenticated;

-- The edit panel watches the seats the way every screen watches its tables:
-- a change is a signal to refetch, never the data.
do $$ begin alter publication supabase_realtime add table public.team_co_owners;
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------- the helper --

-- The team this person sits at in this league, as owner or co-owner; null for
-- nobody. Every rewritten check below is a comparison against this. Null in,
-- null out: a house post has no author, and `t.id = null` joins nothing, which
-- is what `t.owner_id = null` did before.
--
-- Plain SQL and not SECURITY DEFINER on purpose. It is called from inside the
-- SECURITY DEFINER functions, which already run as the owner, and never from a
-- policy — ff_owns_team and ff_is_member spell their own queries out.
create or replace function public.ff_seat_team(p_league_id uuid, p_user_id uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select id      from teams          where league_id = p_league_id and owner_id = p_user_id limit 1),
    (select team_id from team_co_owners where league_id = p_league_id and user_id  = p_user_id limit 1))
$$;

comment on function public.ff_seat_team(uuid, uuid) is
  'The team this user holds a seat at in this league — owned first, co-owned second — or null. The one place "is this my team" is answered.';

revoke execute on function public.ff_seat_team(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.ff_seat_team(uuid, uuid) to service_role;


-- ---------------------------------------------- the helpers, by hand --

-- Membership, both spellings. A co-owner is a member of the league his seat
-- is in; the zero-argument form stays the vague question it always was (see
-- 20260908134237 for which three tables that is right for).
create or replace function public.ff_is_member(p_league_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams          where league_id = p_league_id and owner_id        = auth.uid())
      or exists (select 1 from team_co_owners where league_id = p_league_id and user_id         = auth.uid())
      or exists (select 1 from leagues        where id        = p_league_id and commissioner_id = auth.uid())
$$;

create or replace function public.ff_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams          where owner_id        = auth.uid())
      or exists (select 1 from team_co_owners where user_id         = auth.uid())
      or exists (select 1 from leagues        where commissioner_id = auth.uid())
$$;

-- Ownership, which the storage policies and the waiver, trade and roster
-- functions all ask through. A co-owner owns the team for every one of them:
-- his crest goes in the team's folder, his pending claims are his to see.
create or replace function public.ff_owns_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null
     and auth.uid() is not null
     and (exists (select 1 from teams          where id      = p_team_id and owner_id = auth.uid())
       or exists (select 1 from team_co_owners where team_id = p_team_id and user_id  = auth.uid()))
$$;

-- What the session loads: the caller's team. An owned team first, because the
-- one-seat rule is per league and a person may own in one league and co-own in
-- another; within a league there is only ever one answer.
create or replace function public.ff_link_me()
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype;
begin
  if auth.uid() is null then return null; end if;
  select t.* into v from teams t
   where t.owner_id = auth.uid()
      or exists (select 1 from team_co_owners c where c.team_id = t.id and c.user_id = auth.uid())
   order by (t.owner_id = auth.uid()) desc nulls last
   limit 1;
  if found then return v; end if;
  return null;
end $$;

-- The manager's edit, now the co-owner's too. Same rule as ff_link_me for
-- which team that is.
create or replace function public.ff_update_my_team(
  p_name      text default null,
  p_logo_path text default null
)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype;
begin
  select t.* into v from teams t
   where t.owner_id = auth.uid()
      or exists (select 1 from team_co_owners c where c.team_id = t.id and c.user_id = auth.uid())
   order by (t.owner_id = auth.uid()) desc nulls last
   limit 1;
  if not found then raise exception 'you do not own a team in this league'; end if;

  if p_name is not null then
    if length(trim(p_name)) < 2  then raise exception 'a team name needs at least two characters'; end if;
    if length(trim(p_name)) > 40 then raise exception 'a team name is at most 40 characters'; end if;
  end if;

  -- The key has to live in this team's own folder. The storage policy already
  -- says the same thing about the upload; this says it about the column, so a
  -- crest can never point at a file its team does not own.
  if nullif(trim(coalesce(p_logo_path, '')), '') is not null
     and public.ff_crest_team(p_logo_path) is distinct from v.id then
    raise exception 'that crest does not belong to your team';
  end if;

  -- null leaves a field alone; an empty string clears the crest.
  update teams
     set name      = coalesce(nullif(trim(p_name), ''), name),
         logo_path = case when p_logo_path is null then logo_path
                          else nullif(trim(p_logo_path), '') end
   where id = v.id
  returning * into v;

  return v;
end $$;

-- A manager's private board is his co-owner's too. The policy on draft_queue
-- was the one ownership check written into a policy rather than a function.
drop policy if exists draft_queue_read on public.draft_queue;
create policy draft_queue_read on public.draft_queue
  for select to authenticated
  using (
    public.ff_owns_team(team_id)
    or exists (select 1 from public.teams t join public.leagues l on l.id = t.league_id
                where t.id = draft_queue.team_id and l.commissioner_id = auth.uid())
  );


-- ------------------------------------------------------------- the invites --

-- Issue a co-owner's link. The owner of the team or the commissioner; a
-- co-owner may not seat further co-owners — the seat is the owner's to share,
-- not to sublet. Re-inviting an address retires the earlier link for it, the
-- way ff_mint_invite does, so there is one live way in per address.
create or replace function public.ff_invite_co_owner(p_team_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_team  teams%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv   co_owner_invites%rowtype;
  v_league_name text;
begin
  if v_uid is null then raise exception 'sign in first'; end if;

  select * into v_team from teams where id = p_team_id;
  if not found then raise exception 'team not found'; end if;

  if v_team.owner_id is distinct from v_uid
     and not exists (select 1 from leagues where id = v_team.league_id and commissioner_id = v_uid) then
    raise exception 'only the team''s manager or the commissioner can invite a co-owner';
  end if;

  if v_team.owner_id is null then
    raise exception 'the team needs a manager before it can have a co-owner';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address';
  end if;
  if v_email = lower(coalesce(v_team.owner_email, '')) then
    raise exception 'that is the manager''s own address';
  end if;

  -- Four people at one seat is a committee, not a team.
  if (select count(*) from team_co_owners where team_id = p_team_id) >= 3 then
    raise exception 'a team can have at most three co-owners';
  end if;

  delete from co_owner_invites
   where team_id = p_team_id and claimed_at is null and lower(email) = v_email;

  insert into co_owner_invites (team_id, league_id, email, invited_by)
  values (p_team_id, v_team.league_id, v_email, v_uid)
  returning * into v_inv;

  select name into v_league_name from leagues where id = v_team.league_id;

  -- The token goes back to the API route, which puts it in the mail and
  -- nowhere else. Everything else here is for the subject line.
  return jsonb_build_object(
    'token',   v_inv.token,
    'email',   v_inv.email,
    'team',    v_team.name,
    'league',  v_league_name,
    'manager', v_team.manager_name);
end $$;

-- Withdraw a link that has not been used. Same people as may issue one.
create or replace function public.ff_cancel_co_owner_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_inv co_owner_invites%rowtype;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  select * into v_inv from co_owner_invites where id = p_invite_id and claimed_at is null;
  if not found then return false; end if;

  if not exists (select 1 from teams where id = v_inv.team_id and owner_id = v_uid)
     and not exists (select 1 from leagues where id = v_inv.league_id and commissioner_id = v_uid) then
    raise exception 'only the team''s manager or the commissioner can withdraw an invite';
  end if;

  delete from co_owner_invites where id = p_invite_id;
  return true;
end $$;

-- Take a co-owner off a team. The owner and the commissioner may remove
-- anyone; a co-owner may remove himself, which is how somebody leaves.
create or replace function public.ff_remove_co_owner(p_team_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_league uuid; v_n integer;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  select league_id into v_league from teams where id = p_team_id;
  if v_league is null then raise exception 'team not found'; end if;

  if p_user_id is distinct from v_uid
     and not exists (select 1 from teams where id = p_team_id and owner_id = v_uid)
     and not exists (select 1 from leagues where id = v_league and commissioner_id = v_uid) then
    raise exception 'only the team''s manager or the commissioner can remove a co-owner';
  end if;

  delete from team_co_owners where team_id = p_team_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Who is at the seat, for the edit panel and the commissioner's list. The
-- addresses on outstanding invites go only to the people who may issue them.
create or replace function public.ff_team_seats(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team teams%rowtype;
  v_manage boolean;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  select * into v_team from teams where id = p_team_id;
  if not found then raise exception 'team not found'; end if;
  if not public.ff_is_member(v_team.league_id) then raise exception 'not a member of this league'; end if;

  v_manage := v_team.owner_id = v_uid
           or exists (select 1 from leagues where id = v_team.league_id and commissioner_id = v_uid);

  return jsonb_build_object(
    'team_id',    v_team.id,
    'team',       v_team.name,
    'can_manage', v_manage,
    'mine',       public.ff_seat_team(v_team.league_id, v_uid) = v_team.id,
    'owner', case when v_team.owner_id is null then null else jsonb_build_object(
      'user_id', v_team.owner_id,
      'name',    coalesce(v_team.manager_name,
                          (select display_name from profiles where id = v_team.owner_id)),
      'me',      v_team.owner_id = v_uid) end,
    'co_owners', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',   c.user_id,
               'name',      coalesce(p.display_name, 'A co-owner'),
               'joined_at', c.joined_at,
               'me',        c.user_id = v_uid)
             order by c.joined_at)
        from team_co_owners c left join profiles p on p.id = c.user_id
       where c.team_id = v_team.id), '[]'::jsonb),
    'invites', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'created_at', i.created_at)
                       order by i.created_at)
        from co_owner_invites i
       where i.team_id = v_team.id and i.claimed_at is null), '[]'::jsonb)
      else '[]'::jsonb end);
end $$;

-- What /join may say before anybody has signed in, for either kind of link.
-- `role` tells the screen which sentence to print. A wrong, spent or
-- superseded token of either kind returns null, identically.
create or replace function public.ff_invite_preview(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('team', t.name, 'league', l.name, 'manager', t.manager_name, 'role', 'manager')
    from teams t join leagues l on l.id = t.league_id
   where t.invite_token = p_token and t.owner_id is null
  union all
  select jsonb_build_object('team', t.name, 'league', l.name, 'manager', t.manager_name, 'role', 'co_owner')
    from co_owner_invites i
    join teams t on t.id = i.team_id
    join leagues l on l.id = t.league_id
   where i.token = p_token and i.claimed_at is null and t.owner_id is not null
  limit 1
$$;

-- Claim either kind of link. The manager's path is unchanged from
-- 20260905154627; the co-owner's is the same shape one table over.
create or replace function public.ff_claim_invite(p_token uuid)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype; v_inv co_owner_invites%rowtype; v_seat uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  -- ------------------------------------------------------- a co-owner's link --
  -- Looked up spent or not: a claimed row is what makes a retried submit from
  -- /join a no-op rather than "not valid any more".
  select * into v_inv from co_owner_invites where token = p_token;
  if found then
    -- Already at this seat is not an error: /join retries the claim.
    if exists (select 1 from team_co_owners where team_id = v_inv.team_id and user_id = auth.uid())
       or exists (select 1 from teams where id = v_inv.team_id and owner_id = auth.uid()) then
      select * into v from teams where id = v_inv.team_id;
      return v;
    end if;
    if v_inv.claimed_at is not null then
      raise exception 'that invite link is not valid any more — ask for a new one';
    end if;

    -- One seat per league, in English before the index says it in SQLSTATE.
    v_seat := public.ff_seat_team(v_inv.league_id, auth.uid());
    if v_seat is not null then
      raise exception 'you already hold a seat in this league — a person runs one team';
    end if;

    -- The token and the unclaimed state are checked in the same statement, so
    -- two people opening the same link race for one update.
    update co_owner_invites set claimed_at = now(), claimed_by = auth.uid()
     where id = v_inv.id and claimed_at is null
    returning * into v_inv;
    if not found then
      raise exception 'that invite link is not valid any more — ask for a new one';
    end if;

    insert into team_co_owners (team_id, user_id, league_id, invited_by)
    values (v_inv.team_id, auth.uid(), v_inv.league_id, v_inv.invited_by);

    select * into v from teams where id = v_inv.team_id;
    return v;
  end if;

  -- -------------------------------------------------------- a manager's link --
  -- Already holding a team is not an error: /join runs this straight after
  -- sign-up, and a retried submit must not look like a failure.
  select * into v from teams where owner_id = auth.uid() limit 1;
  if found then return v; end if;

  -- The token and the unclaimed state are checked in the same statement, so two
  -- people opening the same link race for one update rather than both winning.
  update teams set owner_id = auth.uid(), invite_token = null
   where invite_token = p_token and owner_id is null
  returning * into v;

  if not found then
    raise exception 'that invite link is not valid any more — ask your commissioner to send a new one';
  end if;
  return v;
end $$;


-- ----------------------------------------------------- the push, to everyone --
-- A trade offer or a settled claim used to reach the owner's phone. Now it
-- reaches every phone at the seat.

create or replace function public.ff_on_trade_proposed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid; v_from text; v_in integer; v_out integer;
begin
  select name into v_from from teams where id = new.proposer_team_id;
  select count(*) into v_in  from trade_items where trade_id = new.id and to_team_id = new.receiver_team_id;
  select count(*) into v_out from trade_items where trade_id = new.id and from_team_id = new.receiver_team_id;

  for v_to in
    select owner_id from teams where id = new.receiver_team_id and owner_id is not null
    union
    select user_id from team_co_owners where team_id = new.receiver_team_id
  loop
    perform ff_notify(v_to, 'trade', coalesce(v_from, 'Somebody') || ' sent you an offer',
      case
        when v_in > 0 and v_out > 0 then v_in || ' for ' || v_out || '. Tap to look at it.'
        when v_in > 0               then 'Offering you ' || v_in || ', asking for nothing.'
        when v_out > 0              then 'Asking for ' || v_out || ' of yours.'
        else 'Tap to look at it.'
      end, '/trades');
  end loop;
  return null;
end $$;

create or replace function public.ff_on_trade_answered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid; v_other text;
begin
  if new.status not in ('accepted','declined') then return null; end if;

  select name into v_other from teams where id = new.receiver_team_id;

  for v_to in
    select owner_id from teams where id = new.proposer_team_id and owner_id is not null
    union
    select user_id from team_co_owners where team_id = new.proposer_team_id
  loop
    perform ff_notify(v_to, 'trade',
      coalesce(v_other, 'Somebody') || ' ' || new.status || ' your offer',
      case when new.status = 'accepted'
           then 'The players have moved. Tap to see the deal.'
           else 'No deal this time.' end, '/trades');
  end loop;
  return null;
end $$;

create or replace function public.ff_on_waiver_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid; v_player text;
begin
  if new.status not in ('won','lost','invalid') then return null; end if;

  select full_name into v_player from players where id = new.add_player_id;

  for v_to in
    select owner_id from teams where id = new.team_id and owner_id is not null
    union
    select user_id from team_co_owners where team_id = new.team_id
  loop
    perform ff_notify(v_to, 'waiver',
      case new.status
        when 'won'  then 'You got ' || coalesce(v_player, 'your claim')
        when 'lost' then 'You missed ' || coalesce(v_player, 'your claim')
        else 'Your claim on ' || coalesce(v_player, 'a player') || ' did not stand'
      end,
      coalesce(new.outcome, 'Waivers have settled.'), '/waivers');
  end loop;
  return null;
end $$;


-- --------------------------------------------------------------- the rewrite --
-- Twenty functions ask "is this my team" inline rather than through a
-- helper, in one of three spellings:
--
--   league_id = X and owner_id = v_uid              a guard, or a "my team" lookup
--   t.owner_id = lm.author_id and t.league_id = X   which team wrote this line
--   t.owner_id = auth.uid() or l.commissioner_id    your team, or any if commissioner
--
-- Between them that is ninety-odd kilobytes of function bodies — ff_briefing
-- alone is eighteen — and every one would have to be copied here verbatim to
-- change one line of it. That is the copy in which the change gets made and a
-- different line is quietly lost, and nothing notices until a manager does.
--
-- So each function is read back out of the catalogue with pg_get_functiondef,
-- the three spellings are replaced with ff_seat_team, and the result is
-- executed. It is strict both ways. A listed function that carries none of the
-- spellings stops the migration: the list has drifted from the schema. One
-- that still mentions owner_id afterwards stops it too: a fourth spelling
-- exists that this does not know. And the whole schema is scanned at the end,
-- so a function this list forgot is found rather than left behind.
--
-- A later migration that redefines any of these from an older copy of its
-- body would put the old check back and lock co-owners out of one screen.
-- supabase/tests/co_owners.sql scans for exactly that on every replay.
do $rewrite$
declare
  r      record;
  v_src  text;
  v_new  text;
  v_done text[] := '{}';
  v_left text;
  v_expected text[] := array[
    'ff_briefing', 'ff_clubhouse_feed', 'ff_create_poll', 'ff_history',
    'ff_house_feed', 'ff_league_pulse', 'ff_matchup_thread', 'ff_pick_for_my_team',
    'ff_playoff_outlook', 'ff_react', 'ff_rivalries_for_week', 'ff_rivalry',
    'ff_scoreboard', 'ff_send_matchup_message', 'ff_set_auto_draft',
    'ff_set_lineup', 'ff_set_queue', 'ff_team_hub', 'ff_vote', 'ff_week_recap'
  ];
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_expected)
     order by p.proname
  loop
    v_src := pg_get_functiondef(r.oid);

    -- "my team", whether as a guard or a lookup
    v_new := regexp_replace(v_src,
      'league_id = (p_league_id|v_league|v_mu\.league_id|v_team\.league_id) and owner_id = (v_uid|auth\.uid\(\))',
      'id = public.ff_seat_team(\1, \2)', 'g');
    -- "which team wrote this"
    v_new := regexp_replace(v_new,
      't\.owner_id = (lm\.author_id|ae\.actor_id|pl\.author_id) and t\.league_id = (p_league_id|v_mu\.league_id)',
      't.id = public.ff_seat_team(\2, \1)', 'g');
    -- "your team, or any of them if you are the commissioner"
    v_new := regexp_replace(v_new,
      't\.owner_id = auth\.uid\(\) or l\.commissioner_id = auth\.uid\(\)',
      't.id = public.ff_seat_team(t.league_id, auth.uid()) or l.commissioner_id = auth.uid()', 'g');

    if v_new = v_src then
      raise exception 'co-owners: % carries no ownership check this migration recognises — the list has drifted from the schema', r.proname;
    end if;
    -- The commissioner's list (ff_league_pulse) still reads owner_id to say
    -- who has joined, which is the owner specifically; so the check is for
    -- the three spellings, not for the column.
    if v_new ~ '(owner_id\s*=\s*(v_uid|auth\.uid\(\))|t\.owner_id\s*=\s*(lm\.author_id|ae\.actor_id|pl\.author_id))' then
      raise exception 'co-owners: % still decides ownership by owner_id after the rewrite — a spelling this migration does not know', r.proname;
    end if;

    execute v_new;
    v_done := v_done || r.proname;
  end loop;

  -- Every name on the list was found. A function renamed or dropped since this
  -- was written would otherwise be skipped in silence.
  select string_agg(e, ', ') into v_left
    from unnest(v_expected) e where e <> all (v_done);
  if v_left is not null then
    raise exception 'co-owners: expected to rewrite % and could not find it', v_left;
  end if;

  -- And nothing outside it still asks the old way. The functions that may
  -- mention owner_id are the ones that mean the owner specifically: the
  -- invite flow, the commissioner's own list, the challenge ledger between two
  -- people, and the helpers this file just wrote.
  select string_agg(p.proname, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '(owner_id\s*=\s*(v_uid|auth\.uid\(\))|t\.owner_id\s*=\s*(lm\.author_id|ae\.actor_id|pl\.author_id))'
     and p.proname not in ('ff_is_member', 'ff_owns_team', 'ff_link_me', 'ff_update_my_team',
                           'ff_claim_invite', 'ff_seat_team', 'ff_invite_co_owner',
                           'ff_cancel_co_owner_invite', 'ff_remove_co_owner', 'ff_team_seats');
  if v_left is not null then
    raise exception 'co-owners: % still decide(s) ownership by owner_id alone', v_left;
  end if;
end $rewrite$;


-- --------------------------------------------------------------- the grants --
-- See 20260905144124 and supabase/tests/grants.sql: a new function is granted
-- to authenticated the instant it exists, so what should not be reachable is
-- named here. All four below are manager-facing and check the caller inside.
revoke execute on function public.ff_invite_co_owner(uuid, text)     from public, anon;
revoke execute on function public.ff_cancel_co_owner_invite(uuid)    from public, anon;
revoke execute on function public.ff_remove_co_owner(uuid, uuid)     from public, anon;
revoke execute on function public.ff_team_seats(uuid)                from public, anon;
grant  execute on function public.ff_invite_co_owner(uuid, text)     to authenticated, service_role;
grant  execute on function public.ff_cancel_co_owner_invite(uuid)    to authenticated, service_role;
grant  execute on function public.ff_remove_co_owner(uuid, uuid)     to authenticated, service_role;
grant  execute on function public.ff_team_seats(uuid)                to authenticated, service_role;

-- The trigger bodies were re-created above; the default privilege would hand
-- them back to authenticated (20260906011030 took them away).
revoke execute on function public.ff_on_trade_proposed()  from public, anon, authenticated;
revoke execute on function public.ff_on_trade_answered()  from public, anon, authenticated;
revoke execute on function public.ff_on_waiver_settled()  from public, anon, authenticated;

-- ff_invite_preview keeps its anon grant: nobody is signed in when a link is
-- opened, and now that is true of a co-owner's link as well.
