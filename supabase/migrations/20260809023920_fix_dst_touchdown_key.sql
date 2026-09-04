-- The DST miss was a wrong key, not unpublished magic.
--
-- Sleeper carries BOTH `def_td` and `def_st_td`. `def_st_td` is the real one --
-- defensive plus special-teams touchdowns -- and `def_td` is almost never
-- populated. Separately, `fum_rec_ez_tds` (fumble recovered in the end zone)
-- is its own key and is not folded into either.
--
-- Note `td` on a DST line is touchdowns ALLOWED, not scored. Using it would
-- have inverted the sign on the most valuable defensive play in fantasy.
create or replace function ff_score(p_stats jsonb, p_rules jsonb)
returns numeric language plpgsql immutable as $$
declare
  v numeric := 0; v_pa numeric; fg_short numeric; v_dst_td numeric;
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

  if p_stats ? 'pts_allow' then
    -- def_st_td is the populated one; def_td is the legacy fallback.
    v_dst_td := coalesce(nullif(p_stats->>'def_st_td','')::numeric,
                         nullif(p_stats->>'def_td','')::numeric, 0)
              + coalesce(nullif(p_stats->>'fum_rec_ez_tds','')::numeric, 0);
    v := v
      + coalesce((p_stats->>'sack')::numeric,0)     * coalesce((p_rules->>'dst_sack')::numeric,0)
      + coalesce((p_stats->>'int')::numeric,0)      * coalesce((p_rules->>'dst_int')::numeric,0)
      + coalesce((p_stats->>'fum_rec')::numeric,0)  * coalesce((p_rules->>'dst_fum_rec')::numeric,0)
      + coalesce((p_stats->>'safe')::numeric,0)     * coalesce((p_rules->>'dst_safety')::numeric,0)
      + v_dst_td                                    * coalesce((p_rules->>'dst_td')::numeric,0)
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