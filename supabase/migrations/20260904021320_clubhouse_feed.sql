-- ============================================================================
-- The room, on the front page.
--
-- Tonight's Table answers three questions in the first second — who am I
-- playing, am I winning, what do I do now — off one server-rendered call. The
-- clubhouse is not one of those three. It is the thing that makes a manager
-- open the app a fourth time on a Tuesday, and it belongs on the front page,
-- but not ahead of the card.
--
-- So this is a second call rather than four hundred more lines inside
-- `ff_briefing`. Three reasons, in order of weight:
--
--   1. It is a secondary feed. It should arrive after the card, not with it.
--   2. It refetches on `league_messages` alone. Folding it into the briefing
--      would re-run the head-to-head history and the playoff seeding every
--      time somebody typed a sentence.
--   3. Restating a four-hundred-line function to add a footnote to it is how
--      a working function gets broken.
--
-- What it returns: the thread on my own table this week, and the last few
-- lines said anywhere in the league. A line said on a matchup card carries
-- the game it was said about, so the front page can caption it and link back.
--
-- Ledger refresh:
--   select version, name from supabase_migrations.schema_migrations order by version;
-- ============================================================================

create or replace function public.ff_clubhouse_feed(p_league_id uuid, p_limit integer default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_league leagues%rowtype;
  v_team   teams%rowtype;
  v_mu     matchups%rowtype;
  v_week   integer;
  v_limit  integer := least(greatest(coalesce(p_limit, 4), 1), 20);
begin
  if v_uid is null then raise exception 'sign in required'; end if;

  select * into v_league from leagues where id = p_league_id;
  if not found then raise exception 'league not found'; end if;

  if not exists (select 1 from teams where league_id = p_league_id and owner_id = v_uid)
     and v_league.commissioner_id is distinct from v_uid then
    raise exception 'not a member of this league';
  end if;

  v_week := greatest(1, public.ff_current_week());

  select * into v_team from teams where league_id = p_league_id and owner_id = v_uid limit 1;

  if v_team.id is not null then
    select * into v_mu from matchups m
     where m.league_id = p_league_id and m.week = v_week
       and v_team.id in (m.home_team_id, m.away_team_id);
  end if;

  return jsonb_build_object(
    -- My own table's thread, so the front page can say "three about your
    -- table" without opening the scoreboard.
    'mine', case when v_mu.id is null then null else jsonb_build_object(
      'matchup_id', v_mu.id,
      'week', v_mu.week,
      'count', (select count(*) from league_messages lm where lm.matchup_id = v_mu.id),
      'last', (select jsonb_build_object(
                        'body', lm.body, 'created_at', lm.created_at,
                        'author', coalesce(t.manager_name, t.name, 'League manager'),
                        'mine', (lm.author_id = v_uid))
                 from league_messages lm
                 left join teams t on t.owner_id = lm.author_id and t.league_id = p_league_id
                where lm.matchup_id = v_mu.id
                order by lm.created_at desc limit 1)
    ) end,

    -- The last few lines anywhere: the room and the tables, one feed.
    'recent', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc)
        from (
          select jsonb_build_object(
                   'id', lm.id, 'body', lm.body, 'created_at', lm.created_at,
                   'author', coalesce(t.manager_name, t.name, 'League manager'),
                   'mine', (lm.author_id = v_uid),
                   'matchup_id', lm.matchup_id,
                   'about', case when lm.matchup_id is null then null else (
                     select jsonb_build_object(
                              'week', m2.week, 'home', th2.name, 'away', ta2.name,
                              'mine', (v_team.id is not null
                                       and v_team.id in (m2.home_team_id, m2.away_team_id)))
                       from matchups m2
                       join teams th2 on th2.id = m2.home_team_id
                       join teams ta2 on ta2.id = m2.away_team_id
                      where m2.id = lm.matchup_id) end
                 ) as x
            from league_messages lm
            left join teams t on t.owner_id = lm.author_id and t.league_id = p_league_id
           where lm.league_id = p_league_id
           order by lm.created_at desc
           limit v_limit
        ) q
    ), '[]'::jsonb),

    'count_7d', (select count(*) from league_messages lm
                  where lm.league_id = p_league_id
                    and lm.created_at > now() - interval '7 days'),
    'now', now()
  );
end;
$fn$;

revoke all on function public.ff_clubhouse_feed(uuid, integer) from public, anon;
grant execute on function public.ff_clubhouse_feed(uuid, integer) to authenticated;

comment on function public.ff_clubhouse_feed(uuid, integer) is
  'Members only. The clubhouse for the front page: my own table''s thread this week, the last few lines said anywhere in the league, and the week''s volume. A line said on a matchup card carries the game it was said about.';
