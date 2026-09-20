-- ============================================================================
-- Weekly awards: the Special's own facts, as cards in the League Feed.
--
-- ff_week_recap already works out the high score, the low score, the widest
-- margin, the closest game, the bench mistake and the week's best player,
-- every week — but they only ever surface bundled into one prose message,
-- which reads once and then scrolls away like anything else the house wrote.
-- The League Feed already renders activity_events as its own kind of line,
-- with its own icon, sitting next to the trades and settlements it is a
-- record of; a trade gets that treatment and the week's best score does not,
-- for no better reason than the recap having been built first.
--
-- So ff_publish_recap now also posts one activity_events row per award it has
-- a fact for, right alongside the prose recap it already writes. `award`
-- joins the event_type list the same way `transaction` did in
-- 20260905022429: the existing kinds are untouched, and this reads
-- ff_league_feed's `did` CTE for free — no change to the split that
-- 20260919040000 made between Chat and the League Feed.
--
-- Idempotency rides on the recap row's own lock — awards are posted only in
-- the branch where the insert into league_recaps actually happened, so a
-- second call, like the message, is a no-op rather than a second set of
-- cards.
--
-- No new push here. The recap already buzzes every manager about his own week
-- with ff_recap_notify; a card that says "the league's widest margin was 31
-- points" is worth finding in the League Feed, not worth a phone going off
-- about, same call reactions.sql made about reactions themselves.
-- ============================================================================

-- ------------------------------------------------------------- the kind --

alter table public.activity_events drop constraint if exists activity_events_event_type_check;
alter table public.activity_events add  constraint activity_events_event_type_check
  check (event_type in ('announcement','deadline','draft','trade','waiver',
                        'score','record','challenge','system','transaction','award'));

-- ---------------------------------------------------------------- publish --
-- Restated from 20260917014302 with one addition after the post: an award
-- card per fact the week actually has, posted only when the recap row was
-- freshly claimed this call.

create or replace function public.ff_publish_recap(p_league_id uuid, p_week integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_facts  jsonb;
  v_body   text;
  v_msg    uuid;
  v_rows   integer;
  v_sent   integer := 0;
  v_awards integer := 0;
  v_hi     jsonb;
  v_lo     jsonb;
  v_blow   jsonb;
  v_nail   jsonb;
  v_bench  jsonb;
  v_top    jsonb;
  -- Every row this call writes gets its own tick off this clock, one
  -- millisecond apart, rather than sharing transaction-stable now() with
  -- everything else this function inserts. ff_league_feed pages strictly by
  -- created_at (`< p_before`), and a page boundary landing inside a batch
  -- that all shares one instant would drop whichever rows fell on the far
  -- side of it — permanently, since a strict "<" never reconsiders a
  -- timestamp once a page has moved past it.
  v_clock  timestamptz := now();
begin
  perform public.ff_assert_commissioner(p_league_id);

  if exists (select 1 from league_recaps where league_id = p_league_id and week = p_week) then
    return (select jsonb_build_object('week', week, 'posted', false, 'reason', 'already written',
                                      'message_id', message_id, 'body', body)
              from league_recaps where league_id = p_league_id and week = p_week);
  end if;

  v_facts := public.ff_week_recap(p_league_id, p_week);
  v_body  := public.ff_recap_body(v_facts);

  if v_body is null then
    return jsonb_build_object('week', p_week, 'posted', false, 'reason', 'nothing played');
  end if;

  insert into league_recaps(league_id, week, facts, body)
  values (p_league_id, p_week, v_facts, v_body)
  on conflict (league_id, week) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return (select jsonb_build_object('week', week, 'posted', false, 'reason', 'already written',
                                      'message_id', message_id, 'body', body)
              from league_recaps where league_id = p_league_id and week = p_week);
  end if;

  insert into league_messages(league_id, author_id, kind, body, created_at)
  values (p_league_id, null, 'house', v_body, v_clock)
  returning id into v_msg;

  update league_recaps set message_id = v_msg
   where league_id = p_league_id and week = p_week;

  -- One card per fact the week has, same thresholds ff_recap_body uses so a
  -- fact too small to earn a line in the prose does not earn a card either.
  begin
    v_hi    := v_facts->'high';
    v_lo    := v_facts->'low';
    v_blow  := v_facts->'blowout';
    v_nail  := v_facts->'nailbiter';
    v_bench := v_facts->'bench';
    v_top   := v_facts->'top_player';

    if v_hi is not null and v_hi <> 'null'::jsonb then
      v_clock := v_clock + interval '1 millisecond';
      insert into activity_events (league_id, event_type, headline, detail, source_type, source_id, created_at)
      values (p_league_id, 'award',
        left(format('%s put up the week''s best score', v_hi->>'who'), 140),
        left(format('%s points · Week %s', to_char((v_hi->>'points')::numeric, 'FM999990.0'), p_week), 1000),
        'recap', v_msg, v_clock);
      v_awards := v_awards + 1;
    end if;

    if v_lo is not null and v_lo <> 'null'::jsonb
       and coalesce((v_facts->>'games')::int, 0) >= 3 then
      v_clock := v_clock + interval '1 millisecond';
      insert into activity_events (league_id, event_type, headline, detail, source_type, source_id, created_at)
      values (p_league_id, 'award',
        left(format('%s had the week''s low score', v_lo->>'who'), 140),
        left(format('%s points · Week %s', to_char((v_lo->>'points')::numeric, 'FM999990.0'), p_week), 1000),
        'recap', v_msg, v_clock);
      v_awards := v_awards + 1;
    end if;

    if v_blow is not null and v_blow <> 'null'::jsonb
       and (v_blow->>'margin')::numeric >= 25 then
      v_clock := v_clock + interval '1 millisecond';
      insert into activity_events (league_id, event_type, headline, detail, source_type, source_id, created_at)
      values (p_league_id, 'award',
        left(format('%s blew out %s', v_blow->>'winner', v_blow->>'loser'), 140),
        left(format('By %s · Week %s', to_char((v_blow->>'margin')::numeric, 'FM999990.0'), p_week), 1000),
        'recap', v_msg, v_clock);
      v_awards := v_awards + 1;
    end if;

    if v_nail is not null and v_nail <> 'null'::jsonb
       and (v_nail->>'margin')::numeric <= 5
       and (v_blow is null or v_blow = 'null'::jsonb
            or (v_nail->>'winner') is distinct from (v_blow->>'winner')) then
      v_clock := v_clock + interval '1 millisecond';
      insert into activity_events (league_id, event_type, headline, detail, source_type, source_id, created_at)
      values (p_league_id, 'award',
        left(format('%s escaped %s', v_nail->>'winner', v_nail->>'loser'), 140),
        left(format('By %s · Week %s', to_char((v_nail->>'margin')::numeric, 'FM999990.0'), p_week), 1000),
        'recap', v_msg, v_clock);
      v_awards := v_awards + 1;
    end if;

    if v_bench is not null and v_bench <> 'null'::jsonb then
      v_clock := v_clock + interval '1 millisecond';
      insert into activity_events (league_id, event_type, headline, detail, source_type, source_id, created_at)
      values (p_league_id, 'award',
        left(format('%s left %s on the bench', v_bench->>'who', v_bench->>'full_name'), 140),
        left(format('%s unused points · Week %s', to_char((v_bench->>'points')::numeric, 'FM999990.0'), p_week), 1000),
        'recap', v_msg, v_clock);
      v_awards := v_awards + 1;
    end if;

    if v_top is not null and v_top <> 'null'::jsonb then
      v_clock := v_clock + interval '1 millisecond';
      insert into activity_events (league_id, event_type, headline, detail, source_type, source_id, created_at)
      values (p_league_id, 'award',
        left(format('Player of the week: %s', v_top->>'full_name'), 140),
        left(format('%s for %s · Week %s', to_char((v_top->>'points')::numeric, 'FM999990.0'), v_top->>'who', p_week), 1000),
        'recap', v_msg, v_clock);
      v_awards := v_awards + 1;
    end if;
  exception when others then
    -- Same rule ff_recap_notify already follows just below: a bad award card
    -- can never un-post the Special itself. The two failures this used to
    -- catch — a headline or detail over its length limit — can no longer
    -- happen, now that both are truncated before the insert; what is left is
    -- a genuine backstop for anything else unexpected.
    raise notice 'award cards for week % not posted: %', p_week, sqlerrm;
  end;

  begin
    v_sent := public.ff_recap_notify(p_league_id, p_week);
  exception when others then
    raise notice 'recap lines for week % not sent: %', p_week, sqlerrm;
  end;

  return jsonb_build_object('week', p_week, 'posted', true, 'message_id', v_msg, 'body', v_body,
                             'notified', v_sent, 'awards', v_awards);
end;
$fn$;

revoke execute on function public.ff_publish_recap(uuid, integer) from public, anon;
grant execute on function public.ff_publish_recap(uuid, integer)  to authenticated, service_role;
