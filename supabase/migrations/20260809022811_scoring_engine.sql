-- Pure scoring function: (stat line, rules) -> points. No side effects, no
-- state, so any week can be recomputed at any time -- which is what makes
-- Tuesday's stat corrections survivable.
--
-- Stat keys are Sleeper's vocabulary. Rule keys are ours.
create or replace function ff_score(p_stats jsonb, p_rules jsonb)
returns numeric language plpgsql immutable as $$
declare
  v numeric := 0;
  v_pa numeric;
  fg_short numeric;
begin
  if p_stats is null or p_rules is null then return 0; end if;

  -- passing / rushing / receiving
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
    + coalesce((p_stats->>'fum_lost')::numeric,0)  * coalesce((p_rules->>'fum_lost')::numeric,0);

  -- kicking. fgm_50p already contains fgm_50_59 + fgm_60p, so derive the short
  -- bucket by subtraction rather than summing overlapping buckets.
  if p_stats ? 'fgm' or p_stats ? 'xpm' then
    fg_short := greatest(0,
        coalesce((p_stats->>'fgm')::numeric,0)
      - coalesce((p_stats->>'fgm_40_49')::numeric,0)
      - coalesce((p_stats->>'fgm_50p')::numeric,0));
    v := v
      + fg_short                                        * coalesce((p_rules->>'fg_0_39')::numeric,0)
      + coalesce((p_stats->>'fgm_40_49')::numeric,0)    * coalesce((p_rules->>'fg_40_49')::numeric,0)
      + coalesce((p_stats->>'fgm_50p')::numeric,0)      * coalesce((p_rules->>'fg_50_plus')::numeric,0)
      + coalesce((p_stats->>'fgmiss')::numeric,0)       * coalesce((p_rules->>'fg_miss')::numeric,0)
      + coalesce((p_stats->>'xpm')::numeric,0)          * coalesce((p_rules->>'xp_made')::numeric,0)
      + coalesce((p_stats->>'xpmiss')::numeric,0)       * coalesce((p_rules->>'xp_miss')::numeric,0);
  end if;

  -- team defense. Presence of pts_allow is what identifies a DST line.
  if p_stats ? 'pts_allow' then
    v := v
      + coalesce((p_stats->>'sack')::numeric,0)     * coalesce((p_rules->>'dst_sack')::numeric,0)
      + coalesce((p_stats->>'int')::numeric,0)      * coalesce((p_rules->>'dst_int')::numeric,0)
      + coalesce((p_stats->>'fum_rec')::numeric,0)  * coalesce((p_rules->>'dst_fum_rec')::numeric,0)
      + coalesce((p_stats->>'safe')::numeric,0)     * coalesce((p_rules->>'dst_safety')::numeric,0)
      + coalesce((p_stats->>'def_td')::numeric,0)   * coalesce((p_rules->>'dst_td')::numeric,0)
      + coalesce((p_stats->>'blk_kick')::numeric,0) * coalesce((p_rules->>'dst_blocked_kick')::numeric,0);

    -- Bracket derived from the number, not from Sleeper's flag keys, so a
    -- missing flag can never silently zero a defense.
    v_pa := coalesce((p_stats->>'pts_allow')::numeric, 0);
    v := v + case
      when v_pa = 0  then coalesce((p_rules->>'dst_pa_0')::numeric,0)
      when v_pa <= 6 then coalesce((p_rules->>'dst_pa_1_6')::numeric,0)
      when v_pa <= 13 then coalesce((p_rules->>'dst_pa_7_13')::numeric,0)
      when v_pa <= 20 then coalesce((p_rules->>'dst_pa_14_20')::numeric,0)
      when v_pa <= 27 then coalesce((p_rules->>'dst_pa_21_27')::numeric,0)
      when v_pa <= 34 then coalesce((p_rules->>'dst_pa_28_34')::numeric,0)
      else coalesce((p_rules->>'dst_pa_35_plus')::numeric,0)
    end;
  end if;

  return round(v, 2);
end; $$;

-- Sleeper's own default PPR ruleset, kept purely as a test oracle: scoring a
-- stat line with THIS should reproduce Sleeper's pts_ppr to the cent. Any drift
-- means the engine is broken, independent of whatever our league rules say.
create or replace function ff_sleeper_default_rules() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -1, 'pass_2pt', 2,
    'rush_yd', 0.1,  'rush_td', 6, 'rush_2pt', 2,
    'rec', 1.0,      'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,
    'xp_made', 1, 'xp_miss', -1, 'fg_miss', -1,
    'fg_0_39', 3, 'fg_40_49', 4, 'fg_50_plus', 5,
    'dst_sack', 1, 'dst_int', 2, 'dst_fum_rec', 2, 'dst_safety', 2,
    'dst_td', 6, 'dst_blocked_kick', 2,
    'dst_pa_0', 10, 'dst_pa_1_6', 7, 'dst_pa_7_13', 4, 'dst_pa_14_20', 1,
    'dst_pa_21_27', 0, 'dst_pa_28_34', -1, 'dst_pa_35_plus', -4
  )
$$;