-- SCORING BUG (found by validating ff_score against Sleeper's own pts_ppr).
--
-- ff_score gated the entire team-defense block on `p_stats ? 'pts_allow'`.
-- On a SHUTOUT, Sleeper omits `pts_allow` altogether and sends `pts_allow_0: 1`
-- instead. So a defense that pitched a shutout scored ZERO: its sacks,
-- interceptions, defensive touchdowns and the 10-point shutout bonus were all
-- silently discarded. The best defensive weeks of the season were exactly the
-- ones being thrown away.
--
-- Verified against 2025 data before/after:
--   Carolina  wk3  Sleeper 23.0  ->  was 0.00, now 23.00
--   Houston   wk4  Sleeper 14.0  ->  was 0.00, now 14.00
--   Kansas City wk7 Sleeper 13.0 ->  was 0.00, now 13.00
-- Skill positions are unaffected (TE avg delta 0.0000, WR 0.0023, RB 0.0017).
--
-- Fix: gate on any DST-only stat key (confirmed to appear on zero QB/RB/WR/TE/K
-- lines across 3,900 stat lines), and read the points-allowed tier from
-- Sleeper's tier flags whenever the raw `pts_allow` value is absent.
--
-- See migration body applied to project ojhjrxolrsppircyrcff on 2026-08-26.
-- (Full function source is in the database; reproduced by `\sf public.ff_score`.)

create or replace function public.ff_score(p_stats jsonb, p_rules jsonb)
returns numeric language plpgsql immutable as $fn$
declare
  v numeric := 0; v_pa numeric; fg_short numeric; v_dst_td numeric; v_pa_bonus numeric;
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

  if p_stats ?| array['pts_allow','pts_allow_0','sack','int','fum_rec','def_td','safe','blk_kick'] then
    v_dst_td := coalesce(nullif(p_stats->>'def_st_td','')::numeric,
                         nullif(p_stats->>'def_td','')::numeric, 0)
              + coalesce(nullif(p_stats->>'fum_rec_ez_tds','')::numeric, 0);
    v := v
      + coalesce((p_stats->>'sack')::numeric,0)     * coalesce((p_rules->>'dst_sack')::numeric,0)
      + coalesce((p_stats->>'int')::numeric,0)      * coalesce((p_rules->>'dst_int')::numeric,0)
      + coalesce((p_stats->>'fum_rec')::numeric,0)  * coalesce((p_rules->>'dst_fum_rec')::numeric,0)
      + coalesce((p_stats->>'ff')::numeric,0)       * coalesce((p_rules->>'dst_forced_fumble')::numeric,0)
      + coalesce((p_stats->>'safe')::numeric,0)     * coalesce((p_rules->>'dst_safety')::numeric,0)
      + v_dst_td                                    * coalesce((p_rules->>'dst_td')::numeric,0)
      + coalesce((p_stats->>'blk_kick')::numeric,0) * coalesce((p_rules->>'dst_blocked_kick')::numeric,0);

    if p_stats ? 'pts_allow' then
      v_pa := coalesce((p_stats->>'pts_allow')::numeric, 0);
      v_pa_bonus := case
        when v_pa = 0   then coalesce((p_rules->>'dst_pa_0')::numeric,0)
        when v_pa <= 6  then coalesce((p_rules->>'dst_pa_1_6')::numeric,0)
        when v_pa <= 13 then coalesce((p_rules->>'dst_pa_7_13')::numeric,0)
        when v_pa <= 20 then coalesce((p_rules->>'dst_pa_14_20')::numeric,0)
        when v_pa <= 27 then coalesce((p_rules->>'dst_pa_21_27')::numeric,0)
        when v_pa <= 34 then coalesce((p_rules->>'dst_pa_28_34')::numeric,0)
        else coalesce((p_rules->>'dst_pa_35_plus')::numeric,0)
      end;
    else
      v_pa_bonus :=
          coalesce((p_stats->>'pts_allow_0')::numeric,0)     * coalesce((p_rules->>'dst_pa_0')::numeric,0)
        + coalesce((p_stats->>'pts_allow_1_6')::numeric,0)   * coalesce((p_rules->>'dst_pa_1_6')::numeric,0)
        + coalesce((p_stats->>'pts_allow_7_13')::numeric,0)  * coalesce((p_rules->>'dst_pa_7_13')::numeric,0)
        + coalesce((p_stats->>'pts_allow_14_20')::numeric,0) * coalesce((p_rules->>'dst_pa_14_20')::numeric,0)
        + coalesce((p_stats->>'pts_allow_21_27')::numeric,0) * coalesce((p_rules->>'dst_pa_21_27')::numeric,0)
        + coalesce((p_stats->>'pts_allow_28_34')::numeric,0) * coalesce((p_rules->>'dst_pa_28_34')::numeric,0)
        + coalesce((p_stats->>'pts_allow_35p')::numeric,0)   * coalesce((p_rules->>'dst_pa_35_plus')::numeric,0);
    end if;

    v := v + coalesce(v_pa_bonus, 0);
  end if;

  return round(v, 2);
end;
$fn$;
