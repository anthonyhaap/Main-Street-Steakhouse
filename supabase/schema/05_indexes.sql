-- Non-constraint indexes, extracted live. (No user triggers exist.)

CREATE INDEX draft_picks_draft_idx ON public.draft_picks USING btree (draft_id, pick_number);
CREATE INDEX draft_queue_team_idx ON public.draft_queue USING btree (team_id, rank);
CREATE INDEX ingest_log_created_idx ON public.ingest_log USING btree (created_at DESC);
CREATE INDEX nfl_games_week_idx ON public.nfl_games USING btree (season, season_type, week);
CREATE INDEX player_id_map_player_idx ON public.player_id_map USING btree (player_id);
CREATE INDEX players_gsis_idx ON public.players USING btree (gsis_id);
CREATE INDEX players_name_idx ON public.players USING btree (lower(full_name));
CREATE INDEX players_position_idx ON public.players USING btree ("position");
CREATE INDEX players_sleeper_idx ON public.players USING btree (sleeper_id);
CREATE INDEX rosters_team_week_idx ON public.rosters USING btree (team_id, week);
CREATE INDEX stat_lines_week_idx ON public.player_stat_lines USING btree (season, season_type, week);
CREATE INDEX teams_league_idx ON public.teams USING btree (league_id);
CREATE UNIQUE INDEX teams_owner_email_idx ON public.teams USING btree (league_id, lower(owner_email))
  WHERE (owner_email IS NOT NULL);
