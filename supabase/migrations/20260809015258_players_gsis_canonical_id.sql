-- gsis_id is the NFL's canonical player id. Make it the natural key on players
-- so seeding is idempotent and the crosswalk only has to carry the other
-- platforms' ids.
alter table players add column gsis_id text unique;
create index players_gsis_idx on players (gsis_id);