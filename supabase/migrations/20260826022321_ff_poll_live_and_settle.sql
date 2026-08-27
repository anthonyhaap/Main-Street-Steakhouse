-- The `live-stats` pg_cron job has been calling ff_poll_live() since it was
-- created, but the function never existed. Every run errored. Create it, plus a
-- daily settle job for post-game stat corrections.
-- (Applied to project ojhjrxolrsppircyrcff on 2026-08-26.)

create or replace function public.ff_poll_live()
returns jsonb language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_season int; v_week int; v_lines int; v_unmapped int;
  v_league uuid; v_updated int := 0;
begin
  select g.season, g.week into v_season, v_week
  from nfl_games g
  where g.season_type = 2
    and g.kickoff_at between now() - interval '6 hours' and now() + interval '15 minutes'
  group by g.season, g.week
  order by count(*) desc, g.week
  limit 1;

  if v_week is null then
    return jsonb_build_object('polled', false, 'reason', 'no games in live window');
  end if;

  begin
    select lines, unmapped into v_lines, v_unmapped
    from ff_load_sleeper_stats(v_season, v_week, 'regular');
  exception when others then
    insert into ingest_log (source, event, detail)
    values ('sleeper', 'live_poll_failed',
            jsonb_build_object('season', v_season, 'week', v_week, 'error', sqlerrm));
    return jsonb_build_object('polled', false, 'error', sqlerrm);
  end;

  for v_league in select id from leagues loop
    v_updated := v_updated + coalesce(ff_recompute_week(v_league, v_week), 0);
  end loop;

  insert into ingest_log (source, event, detail)
  values ('sleeper', 'live_poll',
          jsonb_build_object('season', v_season, 'week', v_week, 'lines', v_lines,
                             'unmapped', v_unmapped, 'matchups', v_updated));

  return jsonb_build_object('polled', true, 'season', v_season, 'week', v_week,
                            'lines', v_lines, 'matchups', v_updated);
end;
$fn$;

create or replace function public.ff_settle_recent_weeks()
returns jsonb language plpgsql security definer set search_path = public, extensions as $fn$
declare
  r record; v_lines int; v_unmapped int; v_league uuid; v_done jsonb := '[]'::jsonb;
begin
  for r in
    select g.season, g.week from nfl_games g
    where g.season_type = 2
      and g.kickoff_at between now() - interval '10 days' and now()
    group by g.season, g.week order by g.week
  loop
    begin
      select lines, unmapped into v_lines, v_unmapped
      from ff_load_sleeper_stats(r.season, r.week, 'regular');
      for v_league in select id from leagues loop
        perform ff_recompute_week(v_league, r.week);
      end loop;
      v_done := v_done || jsonb_build_object('week', r.week, 'lines', v_lines);
    exception when others then
      insert into ingest_log (source, event, detail)
      values ('sleeper', 'settle_failed',
              jsonb_build_object('season', r.season, 'week', r.week, 'error', sqlerrm));
    end;
  end loop;
  insert into ingest_log (source, event, detail) values ('sleeper','settled', jsonb_build_object('weeks', v_done));
  return v_done;
end;
$fn$;

revoke all on function public.ff_poll_live() from public, anon, authenticated;
revoke all on function public.ff_settle_recent_weeks() from public, anon, authenticated;

select cron.schedule('stats-settle', '17 9 * * *', 'select public.ff_settle_recent_weeks()');
