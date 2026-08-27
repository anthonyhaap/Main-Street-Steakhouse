-- Keep clubhouse writes behind the same authenticated RPC boundary as the
-- draft, lineup, and commissioner workflows.

drop policy if exists league_messages_insert on public.league_messages;
drop policy if exists league_messages_update_own on public.league_messages;
drop policy if exists league_messages_delete_own on public.league_messages;
drop policy if exists challenges_create on public.challenges;
drop policy if exists challenges_respond on public.challenges;
revoke insert, update, delete on public.league_messages from authenticated;
revoke insert, update, delete on public.challenges from authenticated;

create or replace function public.ff_send_message(p_league_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_body text := btrim(p_body);
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member() then raise exception 'league membership required'; end if;
  if p_league_id <> '11111111-1111-1111-1111-111111111111'::uuid then raise exception 'unknown league'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then raise exception 'message must be 1 to 1000 characters'; end if;
  insert into public.league_messages(league_id,author_id,body) values(p_league_id,auth.uid(),v_body) returning id into v_id;
  return v_id;
end $$;

create or replace function public.ff_create_challenge(p_league_id uuid,p_opponent_id uuid,p_title text,p_terms text,p_stake_label text,p_proposition_type text default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.ff_is_member() then raise exception 'league membership required'; end if;
  if p_league_id <> '11111111-1111-1111-1111-111111111111'::uuid then raise exception 'unknown league'; end if;
  if p_opponent_id is null or p_opponent_id = auth.uid() then raise exception 'choose another manager'; end if;
  if not exists(select 1 from public.teams where league_id=p_league_id and owner_id=p_opponent_id) then raise exception 'opponent is not an active league manager'; end if;
  insert into public.challenges(league_id,challenger_id,opponent_id,title,terms,stake_label,proposition_type,status)
  values(p_league_id,auth.uid(),p_opponent_id,btrim(p_title),btrim(p_terms),btrim(p_stake_label),p_proposition_type,'proposed') returning id into v_id;
  return v_id;
end $$;

create or replace function public.ff_respond_challenge(p_challenge_id uuid,p_response text)
returns public.challenges language plpgsql security definer set search_path = '' as $$
declare v_result public.challenges;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_response not in ('accepted','declined') then raise exception 'response must be accepted or declined'; end if;
  update public.challenges set status=p_response,accepted_at=case when p_response='accepted' then now() else null end
  where id=p_challenge_id and opponent_id=auth.uid() and status='proposed' returning * into v_result;
  if v_result.id is null then raise exception 'challenge is unavailable or not yours'; end if;
  return v_result;
end $$;

revoke all on function public.ff_send_message(uuid,text) from public,anon;
revoke all on function public.ff_create_challenge(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.ff_respond_challenge(uuid,text) from public,anon;
grant execute on function public.ff_send_message(uuid,text) to authenticated;
grant execute on function public.ff_create_challenge(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.ff_respond_challenge(uuid,text) to authenticated;
