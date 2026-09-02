-- ============================================================================
-- A manager's own team: his name for it, and his crest on it.
--
-- Until now a team's name was the commissioner's to type, on the invite screen,
-- and every seal in the league was a two-letter monogram drawn from it. Both
-- were fine for setting a league up and wrong once the managers arrive: the
-- first thing somebody does with a team is name it something stupid and put a
-- picture on it, and having to text the commissioner to do that is the sort of
-- friction that keeps a league on the group chat.
--
-- Three pieces:
--
--   1. `teams.logo_path` — an object key inside a new public bucket, never a
--      URL. The browser builds the URL from a key it can prove is ours. A URL
--      column would be a stored redirect anyone with an account could point
--      anywhere, and it would print that destination on every screen in the
--      league.
--
--   2. The `team-logos` bucket, public to read and writable only inside the
--      folder named for a team you own. The path IS the authorization: an
--      object at `<team_id>/<file>` is writable by that team's owner and
--      nobody else, which is checked in the storage policy rather than trusted
--      from the client.
--
--   3. `ff_update_my_team` — the manager's counterpart to the commissioner's
--      `ff_update_team`. It takes no team id at all: it acts on the team the
--      caller owns, so there is nothing to spoof. The commissioner's function
--      keeps its own job (draft slots, manager names, any team in the league).
-- ============================================================================

-- --------------------------------------------------------------- the column --

alter table public.teams add column if not exists logo_path text;

comment on column public.teams.logo_path is
  'Object key inside the public team-logos bucket, always "<team_id>/<file>". A key rather than a URL, so nothing user-supplied is ever stored as something the app will link to.';

-- ---------------------------------------------------------------- helpers --

-- Does the caller own this team? Security definer because the storage policies
-- below run as `authenticated`, which cannot see teams it does not belong to.
create or replace function public.ff_owns_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null
     and auth.uid() is not null
     and exists (select 1 from teams where id = p_team_id and owner_id = auth.uid())
$$;

-- The team an object key belongs to: its first path segment, as a uuid. Null
-- for anything that is not one — a key at the bucket root, a name someone made
-- up — which `ff_owns_team` then refuses.
create or replace function public.ff_crest_team(p_key text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(coalesce(p_key, ''), '/', 1)::uuid;
exception when others then
  return null;
end $$;

grant execute on function public.ff_owns_team(uuid)  to authenticated;
grant execute on function public.ff_crest_team(text) to authenticated;

-- --------------------------------------------------------------- the bucket --

-- 2 MB and images only. The browser downscales to 512px before it uploads, so
-- the ceiling is there for what gets past that, not for the normal case.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-logos', 'team-logos', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- Public to read: a crest is drawn on the standings, the draft clock and the
-- top bar, and a signed URL per seal per render would buy nothing — the bucket
-- holds team logos, which every member sees anyway.
drop policy if exists "team crests are readable by anyone" on storage.objects;
create policy "team crests are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'team-logos');

drop policy if exists "a manager uploads his own crest" on storage.objects;
create policy "a manager uploads his own crest"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos' and public.ff_owns_team(public.ff_crest_team(name)));

drop policy if exists "a manager replaces his own crest" on storage.objects;
create policy "a manager replaces his own crest"
  on storage.objects for update to authenticated
  using      (bucket_id = 'team-logos' and public.ff_owns_team(public.ff_crest_team(name)))
  with check (bucket_id = 'team-logos' and public.ff_owns_team(public.ff_crest_team(name)));

-- The browser deletes the crest it just replaced, so the bucket holds one file
-- per team rather than every picture anybody ever tried.
drop policy if exists "a manager deletes his own crest" on storage.objects;
create policy "a manager deletes his own crest"
  on storage.objects for delete to authenticated
  using (bucket_id = 'team-logos' and public.ff_owns_team(public.ff_crest_team(name)));

-- ------------------------------------------------------- the manager's edit --

create or replace function public.ff_update_my_team(
  p_name      text default null,
  p_logo_path text default null
)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare v teams%rowtype;
begin
  select * into v from teams where owner_id = auth.uid() limit 1;
  if not found then raise exception 'you do not own a team in this league'; end if;

  if p_name is not null then
    if length(trim(p_name)) < 2  then raise exception 'a team name needs at least two characters'; end if;
    if length(trim(p_name)) > 40 then raise exception 'a team name is at most 40 characters'; end if;
  end if;

  -- The key has to live in this team's own folder. The storage policy already
  -- says the same thing about the upload; this says it about the column, so a
  -- crest can never point at a file its team does not own.
  if nullif(trim(coalesce(p_logo_path, '')), '') is not null
     and public.ff_crest_team(p_logo_path) is distinct from v.id then
    raise exception 'that crest does not belong to your team';
  end if;

  -- null leaves a field alone; an empty string clears the crest.
  update teams
     set name      = coalesce(nullif(trim(p_name), ''), name),
         logo_path = case when p_logo_path is null then logo_path
                          else nullif(trim(p_logo_path), '') end
   where id = v.id
  returning * into v;

  return v;
end $$;

grant execute on function public.ff_update_my_team(text, text) to authenticated;
