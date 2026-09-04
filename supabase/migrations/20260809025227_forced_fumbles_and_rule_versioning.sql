-- 1. Forced fumbles now score.
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

-- 2. Versioned scoring rules. A mid-season change must not silently rewrite who
--    won in week 3, so every ruleset carries the week it takes effect from and
--    past weeks keep the rules they were played under.
create table league_scoring_rules (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null references leagues(id) on delete cascade,
  effective_from_week int  not null check (effective_from_week between 1 and 18),
  rules               jsonb not null,
  note                text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  unique (league_id, effective_from_week)
);
alter table league_scoring_rules enable row level security;
create policy league_scoring_rules_read on league_scoring_rules
  for select to authenticated using (true);

-- seed week 1 from the current rules, plus forced fumbles
insert into league_scoring_rules (league_id, effective_from_week, rules, note)
select id, 1, scoring_rules || '{"dst_forced_fumble": 1}'::jsonb, 'initial ruleset'
from leagues;

update leagues
   set scoring_rules = scoring_rules || '{"dst_forced_fumble": 1}'::jsonb,
       settings      = settings      || '{"dst_forced_fumbles": true}'::jsonb;

-- The ruleset in force for a given week.
create or replace function ff_rules_for_week(p_league_id uuid, p_week int)
returns jsonb language sql stable security definer set search_path = public as $$
  select rules from league_scoring_rules
  where league_id = p_league_id and effective_from_week <= p_week
  order by effective_from_week desc limit 1
$$;

-- Score a stat line under whatever rules applied that week.
create or replace function ff_score_week(p_league_id uuid, p_week int, p_stats jsonb)
returns numeric language sql stable security definer set search_path = public as $$
  select ff_score(p_stats, ff_rules_for_week(p_league_id, p_week))
$$;