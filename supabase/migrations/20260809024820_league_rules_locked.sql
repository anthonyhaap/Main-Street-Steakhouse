alter table leagues add column if not exists settings jsonb not null default '{}'::jsonb;

update leagues set settings = jsonb_build_object(
  'waiver_type',        'rolling_priority',
  'waiver_run_day',     'wednesday',
  'playoff_teams',      6,
  'playoff_weeks',      jsonb_build_array(15,16,17),
  'playoff_byes',       2,
  'regular_season_weeks', 14,
  'keepers',            false,
  'trade_deadline_week', 12,
  'dst_forced_fumbles', false
)
where id = '11111111-1111-1111-1111-111111111111';

-- Forced fumbles explicitly excluded: standard scoring counts only fumbles the
-- defense actually recovers. Our engine is exact against Sleeper's reference
-- number under this rule.
update leagues set scoring_rules = scoring_rules - 'dst_forced_fumble'
where id = '11111111-1111-1111-1111-111111111111';

select settings, jsonb_array_length(roster_slots) as roster_size from leagues;