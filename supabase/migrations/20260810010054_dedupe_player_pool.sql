-- The pool held 2,115 rows for ~1,063 humans: the nflverse load created rows
-- keyed on gsis_id, then the Sleeper canonical load created NEW rows for anyone
-- Sleeper didn't publish a gsis_id for (only ~17% of them). Result: 850
-- duplicated name+position groups. Every star showed twice in the draft pool and
-- half the ADP hung off rows that can never receive a stat line.
--
-- Merge into the Sleeper-backed row -- the only one that can actually score.
-- Orphans with no Sleeper counterpart (retired / not rostered in 2026) are left
-- alone: they carry historical stat lines and the pool view now hides them.

create temp table _merge on commit drop as
with keepers as (
  select distinct on (ff_norm_name(full_name), position)
         ff_norm_name(full_name) as nname, position, id as keeper_id
  from players where sleeper_id is not null
  order by ff_norm_name(full_name), position, id
)
select p.id as orphan_id, k.keeper_id, p.gsis_id as orphan_gsis
from players p
join keepers k on k.nname = ff_norm_name(p.full_name) and k.position = p.position
where p.sleeper_id is null;

with one_per_keeper as (
  select distinct on (keeper_id) keeper_id, orphan_gsis
  from _merge where orphan_gsis is not null order by keeper_id, orphan_gsis
)
update players k set gsis_id = o.orphan_gsis
from one_per_keeper o
where k.id = o.keeper_id and k.gsis_id is null
  and not exists (select 1 from players x where x.gsis_id = o.orphan_gsis);

delete from player_id_map pm using _merge m
where pm.player_id = m.orphan_id
  and exists (select 1 from player_id_map k
              where k.player_id = m.keeper_id and k.source = pm.source);
update player_id_map pm set player_id = m.keeper_id
from _merge m where pm.player_id = m.orphan_id;

delete from player_stat_lines sl using _merge m
where sl.player_id = m.orphan_id
  and exists (select 1 from player_stat_lines k
              where k.player_id = m.keeper_id and k.season = sl.season
                and k.season_type = sl.season_type and k.week = sl.week and k.source = sl.source);
update player_stat_lines sl set player_id = m.keeper_id
from _merge m where sl.player_id = m.orphan_id;

delete from player_adp a using _merge m
where a.player_id = m.orphan_id
  and exists (select 1 from player_adp k
              where k.player_id = m.keeper_id and k.format = a.format
                and k.teams = a.teams and k.season = a.season);
update player_adp a set player_id = m.keeper_id
from _merge m where a.player_id = m.orphan_id;

delete from players p using _merge m where p.id = m.orphan_id;

-- Invariant so this cannot recur: you cannot draft a player we have no way to
-- score. The pool is Sleeper-backed by construction.
drop view if exists draft_pool;
create view draft_pool as
select p.id, p.full_name, p.position, p.nfl_team, p.status,
       a.adp, a.overall_rank
from players p
left join player_adp a
  on a.player_id = p.id and a.season = 2026 and a.format = 'ppr' and a.teams = 12
where p.status = 'ACT' and p.sleeper_id is not null;