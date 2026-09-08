-- ============================================================================
-- "A member" of what, exactly.
--
-- ff_is_member() asks whether you own a team ANYWHERE, or commission a league
-- ANYWHERE. Twenty-seven row-level policies are built on it, and every one of
-- them reads as "members of this league may see this row" while actually
-- meaning "anybody who has a seat at any table in this database may see this
-- row". With one league those are the same sentence, which is why this has
-- never done any harm. The day a second league exists — a test league, a
-- second season kept side by side, somebody's dynasty spin-off — they come
-- apart silently, and the failure is a stranger reading a private clubhouse
-- rather than an error anybody would notice.
--
-- So the function gets an argument, and every policy passes the league of the
-- row it is protecting. Tables that carry league_id pass it directly; the rest
-- reach it through the row they hang off — a roster through its team, a trade
-- item through its trade, a poll option through its poll.
--
-- The zero-argument version stays, because three tables genuinely are not
-- league-scoped: profiles is the directory, and nfl_news and nfl_injuries are
-- the same league-agnostic wire for everybody. There "are you in any league at
-- all" is the question actually being asked.
--
-- Nothing here changes what anybody can see today. With one league in the
-- database every one of these policies admits exactly the rows it admitted
-- before, which is what supabase/tests/two_leagues.sql is for: it builds the
-- second league this migration is written against and proves the isolation
-- that could not be tested until now.
-- ============================================================================

-- The league-scoped question. Same shape as the original, one league deep.
create or replace function public.ff_is_member(p_league_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams   where league_id = p_league_id and owner_id        = auth.uid())
      or exists (select 1 from leagues where id        = p_league_id and commissioner_id = auth.uid())
$$;

comment on function public.ff_is_member(uuid) is
  'Does the caller hold a seat in THIS league — a team in it, or its commissioner''s chair. The zero-argument version asks the same question of every league at once, and is only correct for tables that are not league-scoped.';

revoke execute on function public.ff_is_member(uuid) from public, anon;
grant execute on function public.ff_is_member(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Tables that carry league_id: pass it straight through.
--
-- Written as a loop rather than sixteen near-identical statements, because
-- sixteen hand-copied policies is sixteen chances to paste the wrong table
-- name into the wrong policy and not notice.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'activity_events', 'challenges', 'drafts', 'historical_standings',
    'league_history', 'league_messages', 'league_recaps',
    'league_scoring_rules', 'matchups', 'polls', 'reactions', 'teams',
    'transactions', 'waiver_runs'
  ] loop
    -- The policies were not named to one convention, so they are found by what
    -- they do rather than by what they are called. `strict` is the point: none
    -- means this migration has drifted from the schema, and more than one means
    -- a second unscoped policy would be left behind still admitting the rows
    -- the first one just stopped admitting.
    select policyname into strict p from pg_policies
     where schemaname = 'public' and tablename = t and cmd = 'SELECT'
       and coalesce(qual, '') like '%ff_is_member()%';

    execute format('drop policy %I on public.%I', p, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.ff_is_member(league_id))',
      p, t);
  end loop;
exception
  when no_data_found then
    raise exception 'no unscoped read policy found on a table this migration expects to fix';
  when too_many_rows then
    raise exception 'more than one unscoped read policy on a table; rewriting only one would leave the league open';
end $$;


-- ---------------------------------------------------------------------------
-- The ones with a second condition, rewritten by hand so the condition
-- survives. A blind waiver and an unaccepted trade stay hidden; that is the
-- whole point of those clauses and a loop would have flattened them.
-- ---------------------------------------------------------------------------

drop policy waiver_claims_read on public.waiver_claims;
create policy waiver_claims_read on public.waiver_claims
  for select to authenticated
  using (
    public.ff_is_member(league_id)
    and (status <> 'pending' or public.ff_owns_team(team_id))
  );

drop policy trades_read on public.trades;
create policy trades_read on public.trades
  for select to authenticated
  using (
    public.ff_is_member(league_id)
    and (status <> 'proposed'
         or public.ff_owns_team(proposer_team_id)
         or public.ff_owns_team(receiver_team_id))
  );


-- ---------------------------------------------------------------------------
-- The league itself is the row: its own id is the league.
-- ---------------------------------------------------------------------------
drop policy leagues_read on public.leagues;
create policy leagues_read on public.leagues
  for select to authenticated using (public.ff_is_member(id));


-- ---------------------------------------------------------------------------
-- Tables with no league_id of their own, reaching it through their parent.
-- ---------------------------------------------------------------------------

drop policy draft_picks_read on public.draft_picks;
create policy draft_picks_read on public.draft_picks
  for select to authenticated
  using (exists (select 1 from public.drafts d
                  where d.id = draft_picks.draft_id and public.ff_is_member(d.league_id)));

drop policy rosters_read on public.rosters;
create policy rosters_read on public.rosters
  for select to authenticated
  using (exists (select 1 from public.teams t
                  where t.id = rosters.team_id and public.ff_is_member(t.league_id)));

drop policy trade_block_read on public.trade_block;
create policy trade_block_read on public.trade_block
  for select to authenticated
  using (exists (select 1 from public.teams t
                  where t.id = trade_block.team_id and public.ff_is_member(t.league_id)));

drop policy transaction_items_read on public.transaction_items;
create policy transaction_items_read on public.transaction_items
  for select to authenticated
  using (exists (select 1 from public.transactions x
                  where x.id = transaction_items.transaction_id and public.ff_is_member(x.league_id)));

drop policy poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options
  for select to authenticated
  using (exists (select 1 from public.polls p
                  where p.id = poll_options.poll_id and public.ff_is_member(p.league_id)));

drop policy challenge_events_read on public.challenge_events;
create policy challenge_events_read on public.challenge_events
  for select to authenticated
  using (exists (select 1 from public.challenges c
                  where c.id = challenge_events.challenge_id and public.ff_is_member(c.league_id)));

-- Keeps the proposed-trade rule as well as gaining the league.
drop policy trade_items_read on public.trade_items;
create policy trade_items_read on public.trade_items
  for select to authenticated
  using (exists (select 1 from public.trades t
                  where t.id = trade_items.trade_id
                    and public.ff_is_member(t.league_id)
                    and (t.status <> 'proposed'
                         or public.ff_owns_team(t.proposer_team_id)
                         or public.ff_owns_team(t.receiver_team_id))));


-- ---------------------------------------------------------------------------
-- One write path still asked the vague question.
--
-- ff_send_matchup_message already re-checked the matchup's own league after
-- the vague guard, and ff_create_challenge refuses any league id but the
-- league's own, so both were already safe. This one leant on the pair of
-- checks together; now the first one does the work.
-- ---------------------------------------------------------------------------
create or replace function public.ff_send_message(p_league_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_body text := btrim(p_body);
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member(p_league_id) then raise exception 'not a member of this league'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then raise exception 'message must be 1 to 1000 characters'; end if;
  insert into public.league_messages(league_id,author_id,body) values(p_league_id,auth.uid(),v_body) returning id into v_id;
  return v_id;
end $$;


-- ---------------------------------------------------------------------------
-- Nineteen SELECT grants to anon, every one of them dead.
--
-- Eleven were already refused by their own policy — anon has no auth.uid(), so
-- ff_is_member() is false and not a row comes back. The other eight are the
-- NFL reference tables, whose policies say `using (true)`: players, teams,
-- games, ADP, projections, season projections, stat lines and the id map were
-- genuinely readable by anybody holding the publishable key, which is in every
-- copy of the JavaScript.
--
-- Nothing signed-out reads a table. The share card goes out through
-- ff_share_card and the invite screen through ff_invite_preview and
-- ff_claim_invite, all SECURITY DEFINER, none of which needs the caller to
-- hold a grant. So the grants go, both the dead ones and the live ones: a
-- grant that nothing uses is a grant that will be used by accident.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    -- refused by policy already; the grant was noise
    'draft_picks', 'draft_queue', 'drafts', 'league_history', 'league_scoring_rules',
    'leagues', 'matchups', 'nfl_injuries', 'nfl_news', 'rosters', 'teams',
    -- genuinely world-readable until now
    'nfl_games', 'nfl_teams', 'player_adp', 'player_id_map', 'player_projections',
    'player_season_projections', 'player_stat_lines', 'players'
  ] loop
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;
