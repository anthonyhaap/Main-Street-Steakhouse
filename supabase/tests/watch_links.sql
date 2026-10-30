-- ============================================================================
-- Watch links: a spectator reads the league, never the chat, and writes nothing.
--
-- Four things are asserted. That a link is the commissioner's to mint and
-- revoke, and only an anonymous session can redeem one. That a spectator reads
-- what a manager reads, through the RLS policies and through the SECURITY
-- DEFINER readers 20261030140000 rewrote in place. That manager chat is hidden
-- from him by both routes. And that nothing he does writes a row, whichever
-- door he tries — which is only true while every table in `public` carries the
-- guard, so that is scanned for too, and a table added without it fails here.
--
-- Run by scripts/replay-migrations.sh --test. Rolled back at the end.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

do $$
declare
  v_league uuid;
  v_team uuid;
  v_commish uuid; v_manager uuid; v_watcher uuid; v_drifter uuid;
  v_token text; v_token2 text; v_link uuid;
  v_watcher_claims text; v_drifter_claims text;
  v_j jsonb; v_err text; v_left text; v_n integer;
  v_checks integer := 0;
begin
  -- ----------------------------------------------------------- the fixture --
  insert into auth.users (email) values ('commish@example.test') returning id into v_commish;
  insert into auth.users (email) values ('manager@example.test') returning id into v_manager;
  insert into auth.users (email) values (null) returning id into v_watcher;
  insert into auth.users (email) values (null) returning id into v_drifter;
  v_watcher_claims := json_build_object('sub', v_watcher, 'is_anonymous', true)::text;
  v_drifter_claims := json_build_object('sub', v_drifter, 'is_anonymous', true)::text;

  insert into leagues (name, season, commissioner_id, roster_slots, settings)
  values ('Watch Test', 2026, v_commish, '["QB","RB","WR","TE","FLEX","K","DEF"]'::jsonb, '{}'::jsonb)
  returning id into v_league;
  insert into teams (league_id, name, manager_name, owner_id)
  values (v_league, 'The Regulars', 'Owen', v_manager) returning id into v_team;

  -- Written with no session, which is the service role: the guard lets it by.
  insert into league_messages (league_id, author_id, body, kind)
  values (v_league, v_manager, 'secret trash talk', 'manager');
  insert into league_messages (league_id, author_id, body, kind)
  values (v_league, v_commish, 'Draft is Sunday', 'announcement');
  v_checks := v_checks + 1;

  -- ------------------------------------------------------ minting a link --
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  begin
    perform ff_create_watch_link(v_league, 'mine', 7);
    raise exception 'a manager minted a watch link';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager minted a watch link' then raise; end if;
  end;
  begin
    perform ff_watch_links(v_league);
    raise exception 'a manager listed the watch links';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager listed the watch links' then raise; end if;
  end;
  v_checks := v_checks + 2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  v_token := ff_create_watch_link(v_league, 'For Dad', 7);
  if v_token !~ '^[0-9a-f]{64}$' then raise exception 'the token is not 64 hex characters: %', v_token; end if;
  if exists (select 1 from watch_links where token_hash = v_token) then
    raise exception 'the token was stored in the clear';
  end if;
  v_j := ff_watch_links(v_league);
  if jsonb_array_length(v_j) <> 1 or (v_j->0->>'label') <> 'For Dad' or not (v_j->0->>'live')::boolean then
    raise exception 'the commissioner''s list is wrong: %', v_j;
  end if;
  v_link := (v_j->0->>'id')::uuid;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------ redeeming one --
  if not ff_watch_link_live(v_token) then raise exception 'a fresh link reads as dead'; end if;
  if ff_watch_link_live('nope') then raise exception 'a made-up token reads as live'; end if;
  v_checks := v_checks + 2;

  -- A manager who taps the link keeps his seat.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  begin
    perform ff_redeem_watch_link(v_token);
    raise exception 'a manager became a spectator';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager became a spectator' then raise; end if;
  end;
  if exists (select 1 from league_spectators where user_id = v_manager) then
    raise exception 'the manager was written into league_spectators';
  end if;
  v_checks := v_checks + 2;

  -- A wrong token lets nobody in.
  perform set_config('request.jwt.claims', v_drifter_claims, true);
  begin
    perform ff_redeem_watch_link(repeat('0', 64));
    raise exception 'a made-up token was redeemed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a made-up token was redeemed' then raise; end if;
  end;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims', v_watcher_claims, true);
  if ff_redeem_watch_link(v_token) <> v_league then raise exception 'redeeming returned the wrong league'; end if;
  -- Twice is fine: the same visitor tapping the link again.
  perform ff_redeem_watch_link(v_token);
  if (select last_used_at from watch_links where id = v_link) is null then
    raise exception 'redeeming did not record when the link was used';
  end if;
  v_checks := v_checks + 2;

  -- ------------------------------------------------- a spectator reads --
  if not ff_is_member(v_league) or not ff_is_member() then
    raise exception 'a spectator is not a member';
  end if;
  v_checks := v_checks + 1;

  -- Each reader the migration opened, called as the spectator. A refusal is
  -- the failure; whatever they return for an empty week is not under test.
  perform ff_briefing(v_league);
  perform ff_clubhouse_feed(v_league, 5);
  perform ff_history(v_league);
  perform ff_playoff_outlook(v_league);
  perform ff_rivalries_for_week(v_league, 1);
  perform ff_rivalry(v_league, 'Owen', 'Owen');
  perform ff_scoreboard(v_league, 1);
  perform ff_team_hub(v_team, 1);
  perform ff_week_recap(v_league, 1);
  perform ff_sunday(v_league, 1);
  perform ff_sunday_recap(v_league, 1);
  v_checks := v_checks + 11;

  set local role authenticated;
  if (select count(*) from teams where league_id = v_league) <> 1 then
    raise exception 'a spectator cannot read the teams table';
  end if;
  reset role;
  v_checks := v_checks + 1;

  -- -------------------------------------------- but not the chat, by any door --
  set local role authenticated;
  if exists (select 1 from league_messages where kind = 'manager') then
    raise exception 'a spectator read manager chat through RLS';
  end if;
  if not exists (select 1 from league_messages where kind = 'announcement') then
    raise exception 'a spectator lost the announcements along with the chat';
  end if;
  reset role;
  v_checks := v_checks + 2;

  v_j := ff_league_feed(v_league, null, 40);
  if v_j::text not like '%Draft is Sunday%' then raise exception 'the League Feed lost its announcement'; end if;
  if v_j::text like '%secret trash talk%' then raise exception 'the League Feed quoted chat to a spectator'; end if;
  if ff_clubhouse_feed(v_league, 5)::text like '%secret trash talk%' then
    raise exception 'the clubhouse card quoted chat to a spectator';
  end if;
  v_checks := v_checks + 3;

  begin
    perform ff_chat_feed(v_league, null, 40);
    raise exception 'a spectator opened the chat';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a spectator opened the chat' then raise; end if;
  end;
  v_checks := v_checks + 1;

  -- ---------------------------------------------- and writes nothing at all --
  begin
    perform ff_send_message(v_league, 'let me in', null, null);
    raise exception 'a spectator posted through the RPC';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a spectator posted through the RPC' then raise; end if;
    if v_err not like '%view-only%' then raise exception 'wrong refusal for ff_send_message: %', v_err; end if;
  end;
  begin
    perform ff_set_lineup(v_team, 1, '{}'::jsonb);
    raise exception 'a spectator set a lineup';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a spectator set a lineup' then raise; end if;
  end;
  -- profiles is the one table the API roles may write straight to (its own
  -- row, by policy), so it is where the guard itself is proved rather than a
  -- missing grant.
  begin
    set local role authenticated;
    insert into profiles (id, display_name) values (v_watcher, 'Lurker');
    raise exception 'a spectator wrote himself a profile';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a spectator wrote himself a profile' then raise; end if;
    if v_err not like '%view-only%' then raise exception 'wrong refusal for a direct insert: %', v_err; end if;
  end;
  reset role;
  if (select count(*) from league_messages where league_id = v_league) <> 2 then
    raise exception 'a spectator write landed';
  end if;
  v_checks := v_checks + 4;

  -- ------------------------------------- an anonymous session with no link --
  perform set_config('request.jwt.claims', v_drifter_claims, true);
  if ff_is_member(v_league) then raise exception 'an anonymous session with no link is a member'; end if;
  begin
    set local role authenticated;
    insert into profiles (id, display_name) values (v_drifter, 'Drifter');
    raise exception 'an anonymous session wrote a row';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an anonymous session wrote a row' then raise; end if;
  end;
  reset role;
  v_checks := v_checks + 2;

  -- ------------------------------------------- managers are untouched --
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  perform ff_send_message(v_league, 'still talking', null, null);
  set local role authenticated;
  if (select count(*) from league_messages where kind = 'manager') <> 2 then
    raise exception 'a manager no longer reads the chat';
  end if;
  reset role;
  if ff_clubhouse_feed(v_league, 5)::text not like '%still talking%' then
    raise exception 'the clubhouse card stopped quoting chat to managers';
  end if;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------- expiry --
  update watch_links set expires_at = now() - interval '1 minute' where id = v_link;
  perform set_config('request.jwt.claims', v_watcher_claims, true);
  if ff_is_member(v_league) then raise exception 'an expired link still reads the league'; end if;
  begin
    perform ff_scoreboard(v_league, 1);
    raise exception 'an expired spectator read the scoreboard';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an expired spectator read the scoreboard' then raise; end if;
  end;
  begin
    perform ff_redeem_watch_link(v_token);
    raise exception 'an expired link was redeemed';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'an expired link was redeemed' then raise; end if;
  end;
  update watch_links set expires_at = null where id = v_link;
  v_checks := v_checks + 3;

  -- ------------------------------------------------------- revoking --
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  begin
    perform ff_revoke_watch_link(v_link);
    raise exception 'a manager revoked a watch link';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a manager revoked a watch link' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  perform ff_revoke_watch_link(v_link);
  if exists (select 1 from league_spectators where link_id = v_link) then
    raise exception 'revoking left its spectators in';
  end if;
  if ff_watch_link_live(v_token) then raise exception 'a revoked link reads as live'; end if;
  perform set_config('request.jwt.claims', v_watcher_claims, true);
  if ff_is_member(v_league) then raise exception 'a revoked spectator is still a member'; end if;
  v_checks := v_checks + 4;

  -- A link with no expiry is allowed; nonsense lengths are not.
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish)::text, true);
  v_token2 := ff_create_watch_link(v_league, null, null);
  if (select expires_at from watch_links where token_hash = encode(sha256(convert_to(v_token2, 'UTF8')), 'hex')) is not null then
    raise exception 'a link with no length was given an expiry';
  end if;
  begin
    perform ff_create_watch_link(v_league, null, 0);
    raise exception 'a zero-day link was minted';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'a zero-day link was minted' then raise; end if;
  end;
  v_checks := v_checks + 2;

  -- ------------------------------------------------ the guard is everywhere --
  select string_agg(c.relname, ', ' order by c.relname) into v_left
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in ('watch_links', 'league_spectators')
     and not exists (select 1 from pg_trigger t
                      where t.tgrelid = c.oid and t.tgname = 'ff_read_only_guard' and t.tgenabled <> 'D');
  if v_left is not null then
    raise exception 'table(s) with no read-only guard, so a watch link can write to them: %', v_left;
  end if;
  v_checks := v_checks + 1;

  -- And the readers that quote chat still filter it. A later migration that
  -- restates one of these from an older body would put the raw table back.
  select string_agg(p.proname, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('ff_clubhouse_feed', 'ff_league_feed', 'ff_scoreboard', 'ff_sunday', 'ff_sunday_recap')
     and p.prosrc ~ 'from league_messages [a-z]+\M';
  if v_left is not null then
    raise exception '% read(s) league_messages directly again — a spectator would see the chat', v_left;
  end if;
  v_checks := v_checks + 1;

  raise notice 'watch links: % checks passed', v_checks;
end $$;

rollback;
