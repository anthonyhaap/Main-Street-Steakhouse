-- NFL teams keyed by ESPN abbreviation (ingest comes from ESPN, so ESPN wins).
-- nflverse differs on two: it says LA for the Rams and WAS for Washington.
insert into nfl_teams (id, name) values
 ('ARI','Arizona Cardinals'),('ATL','Atlanta Falcons'),('BAL','Baltimore Ravens'),
 ('BUF','Buffalo Bills'),('CAR','Carolina Panthers'),('CHI','Chicago Bears'),
 ('CIN','Cincinnati Bengals'),('CLE','Cleveland Browns'),('DAL','Dallas Cowboys'),
 ('DEN','Denver Broncos'),('DET','Detroit Lions'),('GB','Green Bay Packers'),
 ('HOU','Houston Texans'),('IND','Indianapolis Colts'),('JAX','Jacksonville Jaguars'),
 ('KC','Kansas City Chiefs'),('LV','Las Vegas Raiders'),('LAC','Los Angeles Chargers'),
 ('LAR','Los Angeles Rams'),('MIA','Miami Dolphins'),('MIN','Minnesota Vikings'),
 ('NE','New England Patriots'),('NO','New Orleans Saints'),('NYG','New York Giants'),
 ('NYJ','New York Jets'),('PHI','Philadelphia Eagles'),('PIT','Pittsburgh Steelers'),
 ('SF','San Francisco 49ers'),('SEA','Seattle Seahawks'),('TB','Tampa Bay Buccaneers'),
 ('TEN','Tennessee Titans'),('WSH','Washington Commanders')
on conflict (id) do update set name = excluded.name;

-- Team defenses are draftable, but they are not people and never appear in a
-- box score as an athlete. They exist as pseudo-players keyed 'DST-<abbr>';
-- their stats get derived from team-level game data at scoring time.
insert into players (gsis_id, full_name, position, nfl_team, status)
select 'DST-' || id, name || ' D/ST', 'DST', id, 'ACT' from nfl_teams
on conflict (gsis_id) do update set full_name = excluded.full_name, nfl_team = excluded.nfl_team;

insert into player_id_map (player_id, source, source_id)
select p.id, 'espn_team', p.nfl_team from players p where p.position = 'DST'
on conflict (source, source_id) do update set player_id = excluded.player_id;

-- Full PPR, standard 9-starter roster.
update leagues set
  scoring_rules = jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -2, 'pass_2pt', 2,
    'rush_yd', 0.1,  'rush_td', 6, 'rush_2pt', 2,
    'rec', 1.0,      'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,
    'xp_made', 1, 'fg_miss', 0,
    'fg_0_39', 3, 'fg_40_49', 4, 'fg_50_plus', 5,
    'dst_sack', 1, 'dst_int', 2, 'dst_fum_rec', 2, 'dst_safety', 2,
    'dst_td', 6, 'dst_blocked_kick', 2,
    'dst_pa_0', 10, 'dst_pa_1_6', 7, 'dst_pa_7_13', 4, 'dst_pa_14_20', 1,
    'dst_pa_21_27', 0, 'dst_pa_28_34', -1, 'dst_pa_35_plus', -4
  ),
  roster_slots = '["QB","RB","RB","WR","WR","TE","FLEX","K","DST","BN","BN","BN","BN","BN","BN"]'::jsonb
where id = '11111111-1111-1111-1111-111111111111';

update drafts set rounds = 15 where league_id = '11111111-1111-1111-1111-111111111111';

select (select count(*) from nfl_teams) as nfl_teams,
       (select count(*) from players where position='DST') as dsts,
       (select count(*) from players) as total_players,
       (select jsonb_array_length(roster_slots) from leagues limit 1) as roster_size;