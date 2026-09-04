-- Three fixes surfaced by diffing against Sleeper's own points:
--
-- 1. BUG: the kicking block was gated on `fgm`/`xpm` being present, so a kicker
--    who missed everything had no made-kick keys at all and scored 0 instead of
--    negative. Guard removed -- every term coalesces to 0, so it is safe to
--    always evaluate. (Cam Little wk6, Joey Slye wk4.)
-- 2. `st_td` -- kick/punt return touchdowns -- was unscored. Worth 6, and it is
--    what produced every 6.00-point miss.
-- 3. `st_fum_rec` -- special teams fumble recovery -- was unscored.

create or replace function ff_score(p_stats jsonb, p_rules jsonb)
returns numeric language plpgsql immutable as $$
declare
  v numeric := 0; v_pa numeric; fg_short numeric;
begin
  if p_stats is null or p_rules is null then return 0; end if;

  v := v
    + coalesce((p_stats->>'pass_yd')::numeric,0)   * coalesce((p_rules->>'pass_yd')::numeric,0)
    + coalesce((p_stats->>'pass_td')::numeric,0)   * coalesce((p_rules->>'pass_td')::numeric,0)
    + coalesce((p_stats->>'pass_int')::numeric,0)  * coalesce((p_rules->>'pass_int')::numeric,0)
    + coalesce((p_stats->>'pass_2pt')::numeric,0)  * coalesce((p_rules->>'pass_2pt')::numeric,0)
    + coalesce((p_stats->>'rush_yd')::numeric,0)   * coalesce((p_rules->>'rush_yd')::numeric,0)
    + coalesce((p_stats->>'rush_td')::numeric,0)   * coalesce((p_rules->>'rush_td')::numeric,0)
    + coalesce((p_stats->>'rush_2pt')::numeric,0)  * coalesce((p_rules->>'rush_2pt')::numeric,0)
    + coalesce((p_stats->>'rec')::numeric,0)       * coalesce((p_rules->>'rec')::numeric,0)
    + coalesce((p_stats->>'rec_yd')::numeric,0)    * coalesce((p_rules->>'rec_yd')::numeric,0)
    + coalesce((p_stats->>'rec_td')::numeric,0)    * coalesce((p_rules->>'rec_td')::numeric,0)
    + coalesce((p_stats->>'rec_2pt')::numeric,0)   * coalesce((p_rules->>'rec_2pt')::numeric,0)
    + coalesce((p_stats->>'fum_lost')::numeric,0)  * coalesce((p_rules->>'fum_lost')::numeric,0)
    + coalesce((p_stats->>'st_td')::numeric,0)     * coalesce((p_rules->>'st_td')::numeric,0)
    + coalesce((p_stats->>'st_fum_rec')::numeric,0)* coalesce((p_rules->>'st_fum_rec')::numeric,0);

  -- always evaluated: a kicker with only misses still has to go negative
  fg_short := greatest(0,
      coalesce((p_stats->>'fgm')::numeric,0)
    - coalesce((p_stats->>'fgm_40_49')::numeric,0)
    - coalesce((p_stats->>'fgm_50p')::numeric,0));
  v := v
    + fg_short                                     * coalesce((p_rules->>'fg_0_39')::numeric,0)
    + coalesce((p_stats->>'fgm_40_49')::numeric,0) * coalesce((p_rules->>'fg_40_49')::numeric,0)
    + coalesce((p_stats->>'fgm_50p')::numeric,0)   * coalesce((p_rules->>'fg_50_plus')::numeric,0)
    + coalesce((p_stats->>'fgmiss')::numeric,0)    * coalesce((p_rules->>'fg_miss')::numeric,0)
    + coalesce((p_stats->>'xpm')::numeric,0)       * coalesce((p_rules->>'xp_made')::numeric,0)
    + coalesce((p_stats->>'xpmiss')::numeric,0)    * coalesce((p_rules->>'xp_miss')::numeric,0);

  if p_stats ? 'pts_allow' then
    v := v
      + coalesce((p_stats->>'sack')::numeric,0)     * coalesce((p_rules->>'dst_sack')::numeric,0)
      + coalesce((p_stats->>'int')::numeric,0)      * coalesce((p_rules->>'dst_int')::numeric,0)
      + coalesce((p_stats->>'fum_rec')::numeric,0)  * coalesce((p_rules->>'dst_fum_rec')::numeric,0)
      + coalesce((p_stats->>'safe')::numeric,0)     * coalesce((p_rules->>'dst_safety')::numeric,0)
      + coalesce((p_stats->>'def_td')::numeric,0)   * coalesce((p_rules->>'dst_td')::numeric,0)
      + coalesce((p_stats->>'blk_kick')::numeric,0) * coalesce((p_rules->>'dst_blocked_kick')::numeric,0);
    v_pa := coalesce((p_stats->>'pts_allow')::numeric, 0);
    v := v + case
      when v_pa = 0   then coalesce((p_rules->>'dst_pa_0')::numeric,0)
      when v_pa <= 6  then coalesce((p_rules->>'dst_pa_1_6')::numeric,0)
      when v_pa <= 13 then coalesce((p_rules->>'dst_pa_7_13')::numeric,0)
      when v_pa <= 20 then coalesce((p_rules->>'dst_pa_14_20')::numeric,0)
      when v_pa <= 27 then coalesce((p_rules->>'dst_pa_21_27')::numeric,0)
      when v_pa <= 34 then coalesce((p_rules->>'dst_pa_28_34')::numeric,0)
      else coalesce((p_rules->>'dst_pa_35_plus')::numeric,0)
    end;
  end if;

  return round(v, 2);
end; $$;

create or replace function ff_sleeper_default_rules() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -1, 'pass_2pt', 2,
    'rush_yd', 0.1,  'rush_td', 6, 'rush_2pt', 2,
    'rec', 1.0,      'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,  'st_td', 6, 'st_fum_rec', 1,
    'xp_made', 1, 'xp_miss', -1, 'fg_miss', -1,
    'fg_0_39', 3, 'fg_40_49', 4, 'fg_50_plus', 5,
    'dst_sack', 1, 'dst_int', 2, 'dst_fum_rec', 2, 'dst_safety', 2,
    'dst_td', 6, 'dst_blocked_kick', 2,
    'dst_pa_0', 10, 'dst_pa_1_6', 7, 'dst_pa_7_13', 4, 'dst_pa_14_20', 1,
    'dst_pa_21_27', 0, 'dst_pa_28_34', -1, 'dst_pa_35_plus', -4
  )
$$;

-- our league rules pick up the same two stats
update leagues set scoring_rules = scoring_rules
  || jsonb_build_object('st_td', 6, 'st_fum_rec', 1, 'xp_miss', 0)
where id = '11111111-1111-1111-1111-111111111111';