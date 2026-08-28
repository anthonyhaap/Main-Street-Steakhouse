-- External settlement assistant. The platform records consent, results and
-- confirmations, but never stores credentials, holds funds or initiates transfers.

alter table public.profiles
  add column if not exists settlement_provider text,
  add column if not exists settlement_handle text,
  add column if not exists settlement_opt_in_at timestamptz;

alter table public.profiles drop constraint if exists profiles_settlement_provider_check;
alter table public.profiles add constraint profiles_settlement_provider_check
  check (settlement_provider is null or settlement_provider in ('venmo','other'));
alter table public.profiles drop constraint if exists profiles_settlement_handle_check;
alter table public.profiles add constraint profiles_settlement_handle_check
  check (settlement_handle is null or settlement_handle ~ '^[A-Za-z0-9_-]{1,64}$');

alter table public.challenges
  add column if not exists stake_amount_cents integer,
  add column if not exists matchup_id uuid references public.matchups(id) on delete set null,
  add column if not exists settlement_due_at timestamptz,
  add column if not exists payment_marked_at timestamptz,
  add column if not exists payment_marked_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_reference text,
  add column if not exists receipt_confirmed_at timestamptz,
  add column if not exists receipt_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_reason text;

alter table public.challenges drop constraint if exists challenges_stake_amount_check;
alter table public.challenges add constraint challenges_stake_amount_check
  check (stake_amount_cents is null or stake_amount_cents between 100 and 50000);
alter table public.challenges drop constraint if exists challenges_payment_reference_check;
alter table public.challenges add constraint challenges_payment_reference_check
  check (payment_reference is null or char_length(payment_reference) <= 160);
alter table public.challenges drop constraint if exists challenges_dispute_reason_check;
alter table public.challenges add constraint challenges_dispute_reason_check
  check (dispute_reason is null or char_length(dispute_reason) between 3 and 500);
alter table public.challenges drop constraint if exists challenges_status_check;
alter table public.challenges add constraint challenges_status_check check (status in
  ('proposed','accepted','declined','expired','locked','awaiting_result','resolved','payment_pending','disputed','settled','voided'));

create index if not exists challenges_matchup_status_idx on public.challenges(matchup_id,status)
  where matchup_id is not null;
create index if not exists challenges_settlement_due_idx on public.challenges(settlement_due_at)
  where status in ('resolved','payment_pending');

create or replace function public.ff_guard_challenge_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.title <> old.title or new.terms <> old.terms or new.stake_label <> old.stake_label
     or new.proposition_type <> old.proposition_type or new.challenger_id <> old.challenger_id
     or new.opponent_id <> old.opponent_id or new.league_id <> old.league_id
     or new.stake_amount_cents is distinct from old.stake_amount_cents
     or new.matchup_id is distinct from old.matchup_id then
    raise exception 'challenge terms cannot change after proposal';
  end if;
  if old.status = 'proposed' and new.status not in ('accepted','declined','expired') then
    raise exception 'invalid challenge transition';
  elsif old.status = 'accepted' and new.status not in ('resolved','voided') then
    raise exception 'invalid challenge transition';
  elsif old.status = 'resolved' and new.status not in ('payment_pending','disputed','settled','voided') then
    raise exception 'invalid challenge transition';
  elsif old.status = 'payment_pending' and new.status not in ('settled','disputed') then
    raise exception 'invalid challenge transition';
  elsif old.status = 'disputed' and new.status not in ('resolved','settled','voided') then
    raise exception 'invalid challenge transition';
  elsif old.status in ('declined','expired','settled','voided') and new.status <> old.status then
    raise exception 'challenge is final';
  end if;
  if new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
    new.locked_at := coalesce(new.locked_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.ff_save_settlement_profile(p_display_name text,p_provider text,p_handle text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_result public.profiles; v_handle text := regexp_replace(btrim(p_handle),'^@','','g');
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member() then raise exception 'league membership required'; end if;
  if p_provider not in ('venmo','other') then raise exception 'unsupported provider'; end if;
  if v_handle !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid payment handle'; end if;
  insert into public.profiles(id,display_name,settlement_provider,settlement_handle,settlement_opt_in_at)
  values(auth.uid(),left(btrim(p_display_name),60),p_provider,v_handle,now())
  on conflict(id) do update set display_name=excluded.display_name,settlement_provider=excluded.settlement_provider,
    settlement_handle=excluded.settlement_handle,settlement_opt_in_at=now(),updated_at=now()
  returning * into v_result;
  return v_result;
end $$;

drop function if exists public.ff_create_challenge(uuid,uuid,text,text,text,text);
create function public.ff_create_challenge(
  p_league_id uuid,p_opponent_id uuid,p_title text,p_terms text,p_stake_label text,
  p_proposition_type text default 'custom',p_stake_amount_cents integer default null,p_matchup_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member() then raise exception 'league membership required'; end if;
  if p_league_id <> '11111111-1111-1111-1111-111111111111'::uuid then raise exception 'unknown league'; end if;
  if p_opponent_id is null or p_opponent_id = auth.uid() then raise exception 'choose another manager'; end if;
  if p_stake_amount_cents is not null and p_stake_amount_cents not between 100 and 50000 then raise exception 'amount must be between $1 and $500'; end if;
  if not exists(select 1 from public.teams where league_id=p_league_id and owner_id=p_opponent_id) then raise exception 'opponent is not an active league manager'; end if;
  if p_proposition_type = 'weekly_matchup_winner' and not exists(
    select 1 from public.matchups m join public.teams h on h.id=m.home_team_id join public.teams a on a.id=m.away_team_id
    where m.id=p_matchup_id and m.league_id=p_league_id and auth.uid() in (h.owner_id,a.owner_id) and p_opponent_id in (h.owner_id,a.owner_id)
  ) then raise exception 'choose a matchup shared by both managers'; end if;
  insert into public.challenges(league_id,challenger_id,opponent_id,title,terms,stake_label,proposition_type,status,stake_amount_cents,matchup_id)
  values(p_league_id,auth.uid(),p_opponent_id,btrim(p_title),btrim(p_terms),btrim(p_stake_label),p_proposition_type,'proposed',p_stake_amount_cents,p_matchup_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ff_respond_challenge(p_challenge_id uuid,p_response text)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_response not in ('accepted','declined') then raise exception 'response must be accepted or declined'; end if;
  if p_response='accepted' and exists(select 1 from public.challenges where id=p_challenge_id and stake_amount_cents is not null)
     and (select count(*) from public.profiles p where p.id in (
       select challenger_id from public.challenges where id=p_challenge_id union select opponent_id from public.challenges where id=p_challenge_id
     ) and p.settlement_opt_in_at is not null and p.settlement_handle is not null) <> 2 then
    raise exception 'both managers must save an external settlement handle before accepting';
  end if;
  update public.challenges set status=p_response where id=p_challenge_id and opponent_id=auth.uid() and status='proposed' returning * into v_result;
  if v_result.id is null then raise exception 'challenge is unavailable or not yours'; end if;
  return v_result;
end $$;

create or replace function public.ff_resolve_challenge(p_challenge_id uuid,p_winner_id uuid,p_evidence text)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  perform public.ff_assert_commissioner((select league_id from public.challenges where id=p_challenge_id));
  update public.challenges set status=case when stake_amount_cents is null then 'settled' else 'resolved' end,
    winner_id=p_winner_id,resolved_at=now(),settlement_due_at=case when stake_amount_cents is null then null else now()+interval '7 days' end,
    resolution_evidence=jsonb_build_object('source','commissioner','note',left(btrim(p_evidence),500))
  where id=p_challenge_id and status in ('accepted','disputed') and p_winner_id in (challenger_id,opponent_id) returning * into v_result;
  if v_result.id is null then raise exception 'challenge cannot be resolved'; end if;
  return v_result;
end $$;

create or replace function public.ff_mark_challenge_paid(p_challenge_id uuid,p_reference text default null)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  update public.challenges set status='payment_pending',payment_marked_at=now(),payment_marked_by=auth.uid(),payment_reference=nullif(left(btrim(p_reference),160),'')
  where id=p_challenge_id and status='resolved' and auth.uid() in (challenger_id,opponent_id) and auth.uid()<>winner_id returning * into v_result;
  if v_result.id is null then raise exception 'only the losing manager can mark this paid'; end if;
  return v_result;
end $$;

create or replace function public.ff_confirm_challenge_received(p_challenge_id uuid)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  update public.challenges set status='settled',receipt_confirmed_at=now(),receipt_confirmed_by=auth.uid()
  where id=p_challenge_id and status='payment_pending' and winner_id=auth.uid() returning * into v_result;
  if v_result.id is null then raise exception 'only the winning manager can confirm receipt'; end if;
  return v_result;
end $$;

create or replace function public.ff_dispute_challenge(p_challenge_id uuid,p_reason text)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  if char_length(btrim(p_reason)) not between 3 and 500 then raise exception 'add a short dispute reason'; end if;
  update public.challenges set status='disputed',disputed_at=now(),dispute_reason=btrim(p_reason)
  where id=p_challenge_id and status in ('resolved','payment_pending') and auth.uid() in (challenger_id,opponent_id) returning * into v_result;
  if v_result.id is null then raise exception 'challenge cannot be disputed'; end if;
  return v_result;
end $$;

create or replace function public.ff_resolve_matchup_challenges()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with ready as (
    select c.id,m.home_points,m.away_points,h.owner_id home_owner,a.owner_id away_owner
    from public.challenges c join public.matchups m on m.id=c.matchup_id
    join public.teams h on h.id=m.home_team_id join public.teams a on a.id=m.away_team_id
    join public.nfl_weeks w on w.week=m.week and w.season=(select season from public.leagues where id=c.league_id)
    where c.status='accepted' and c.proposition_type='weekly_matchup_winner' and now()>w.last_kick+interval '6 hours'
  )
  update public.challenges c set status=case when r.home_points=r.away_points then 'voided' when c.stake_amount_cents is null then 'settled' else 'resolved' end,
    winner_id=case when r.home_points>r.away_points then r.home_owner when r.away_points>r.home_points then r.away_owner end,
    resolved_at=now(),settlement_due_at=case when c.stake_amount_cents is null or r.home_points=r.away_points then null else now()+interval '7 days' end,
    resolution_evidence=jsonb_build_object('source','official_matchup','home_points',r.home_points,'away_points',r.away_points)
  from ready r where c.id=r.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.ff_save_settlement_profile(text,text,text) from public,anon;
revoke all on function public.ff_create_challenge(uuid,uuid,text,text,text,text,integer,uuid) from public,anon;
revoke all on function public.ff_resolve_challenge(uuid,uuid,text) from public,anon;
revoke all on function public.ff_mark_challenge_paid(uuid,text) from public,anon;
revoke all on function public.ff_confirm_challenge_received(uuid) from public,anon;
revoke all on function public.ff_dispute_challenge(uuid,text) from public,anon;
revoke all on function public.ff_resolve_matchup_challenges() from public,anon,authenticated;
grant execute on function public.ff_save_settlement_profile(text,text,text) to authenticated;
grant execute on function public.ff_create_challenge(uuid,uuid,text,text,text,text,integer,uuid) to authenticated;
grant execute on function public.ff_resolve_challenge(uuid,uuid,text) to authenticated;
grant execute on function public.ff_mark_challenge_paid(uuid,text) to authenticated;
grant execute on function public.ff_confirm_challenge_received(uuid) to authenticated;
grant execute on function public.ff_dispute_challenge(uuid,text) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname='resolve-matchup-challenges';
select cron.schedule('resolve-matchup-challenges','*/5 * * * *','select public.ff_resolve_matchup_challenges()');
