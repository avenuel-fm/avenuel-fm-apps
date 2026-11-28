-- ============================================================================
-- 28_map_saves.sql — 지도 기록 달력 「저장」 · 저장 차수 보기 · 「이 차수로 되돌리기」 (업무지원 결정 382, docs/설계/WS_지도.md 53장)
-- 실행: Supabase SQL Editor 에 이 파일 전체를 붙여 넣고 Run (여러 번 돌려도 안전). 13_map.sql · 22_map_restore.sql 이 먼저 있어야 합니다.
--  · 저장(ws_map_mark): 지금 시각을 차수로 남김 (도면을 고칠 수 있는 사람). 그날 안에서도 그 시각까지의 모습이 지워지지 않게
--    기록 정리(ws_map_hist_put)가 마지막 저장 시각 앞의 기록은 건드리지 않음 (되돌리기와 같은 방식)
--  · 되돌리기(ws_map_restore): p_day 가 날짜면 지금처럼 그날 끝 모습, 시각(차수)이면 그 시각 모습. 소장·부소장·파트장
--  · 기록 목록(ws_map_days): 저장 차수 목록(saves)과 되돌린 차수 시각(toTime)을 더 알려 줌
-- ============================================================================
create table if not exists public.map_save (
  at       timestamptz primary key default clock_timestamp(),
  building text not null default '',     -- '' = 에비뉴엘, 'dept' · 'castle'
  editor   text
);
alter table public.map_save enable row level security;
revoke all on public.map_save from anon, authenticated;
alter table public.map_restore add column if not exists to_at timestamptz;   -- 차수로 되돌렸을 때 그 시각

-- 같은 날 고친 칸은 마지막 것만 남기되, 마지막 되돌리기·저장 시각 앞의 기록은 그대로 둠
create or replace function public.ws_map_hist_put(p_k text, p_v text, p_editor text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.map_hist h where h.k = p_k and h.day = (clock_timestamp() at time zone 'Asia/Seoul')::date
     and h.at > greatest(coalesce((select max(r.at) from public.map_restore r), '-infinity'::timestamptz),
                         coalesce((select max(s.at) from public.map_save s), '-infinity'::timestamptz));
  insert into public.map_hist (k, v, editor) values (p_k, p_v, p_editor);
end $$;

create or replace function public.ws_map_iso(p timestamptz)
returns text language sql immutable set search_path = public as $$
  select to_char(p at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+09:00';
$$;

-- 저장: 지금 모습을 차수로 남김
create or replace function public.ws_map_mark(p_token text, p_building text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); b text := coalesce(p_building, ''); t timestamptz; n int;
begin
  if not public.ws_map_can_edit(me.role) then return jsonb_build_object('ok', false, 'error', '지도는 소장·부소장·파트장·옵저버만 저장할 수 있습니다'); end if;
  if b not in ('', 'dept', 'castle') then return jsonb_build_object('ok', false, 'error', '건물이 맞지 않습니다'); end if;
  insert into public.map_save (building, editor) values (b, me.name) returning at into t;
  select count(*) into n from public.map_save where building = b and (at at time zone 'Asia/Seoul')::date = (t at time zone 'Asia/Seoul')::date;
  return jsonb_build_object('ok', true, 'at', public.ws_map_iso(t), 'n', n);
end $$;

-- 기록이 있는 날 + 되돌리기 기록 + 저장 차수
create or replace function public.ws_map_days(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return jsonb_build_object('ok', true,
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'keys', keys, 'by', coalesce(eds, '[]'::jsonb)) order by day), '[]'::jsonb)
             from (select day, jsonb_agg(distinct k) keys,
                          jsonb_agg(distinct editor) filter (where editor is not null and k not like 'lotte\_base\_svg\_%') eds
                   from public.map_hist group by day) d),
    'restores', (select coalesce(jsonb_agg(jsonb_build_object('day', (at at time zone 'Asia/Seoul')::date, 'to', to_day, 'by', editor,
                   'before', public.ws_map_iso(at - interval '1 microsecond'),
                   'time', to_char(at at time zone 'Asia/Seoul', 'HH24:MI'),
                   'toTime', case when to_at is null then '' else to_char(to_at at time zone 'Asia/Seoul', 'HH24:MI') end) order by at), '[]'::jsonb) from public.map_restore),
    'saves', (select coalesce(jsonb_agg(jsonb_build_object('at', public.ws_map_iso(at), 'day', (at at time zone 'Asia/Seoul')::date,
                   'time', to_char(at at time zone 'Asia/Seoul', 'HH24:MI'), 'by', editor, 'building', building) order by at), '[]'::jsonb) from public.map_save));
end $$;

-- 되돌리기: 날짜(그날 끝) 또는 시각(저장 차수). 지금 모습은 기록에 그대로 남음 (되돌리기 전 보기)
create or replace function public.ws_map_restore(p_token text, p_day text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date; t timestamptz; st jsonb; r record; n int := 0;
begin
  if not public.ws_map_can_restore(me.role) then return jsonb_build_object('ok', false, 'error', '되돌리기는 소장·부소장·파트장만 할 수 있습니다'); end if;
  if coalesce(p_day, '') ~ '^\d{4}-\d{2}-\d{2}$' then
    d := public.ws_date(p_day);
    if d is null or d >= (now() at time zone 'Asia/Seoul')::date then return jsonb_build_object('ok', false, 'error', '지난 날짜만 되돌릴 수 있습니다'); end if;
    st := public.ws_map_state(public.ws_map_end(d::text));
  else
    begin t := p_day::timestamptz; exception when others then t := null; end;
    if t is null or t >= now() or coalesce(p_day, '') !~ '^\d{4}-\d{2}-\d{2}T' then return jsonb_build_object('ok', false, 'error', '되돌릴 차수가 맞지 않습니다'); end if;
    d := (t at time zone 'Asia/Seoul')::date;
    st := public.ws_map_state(t);
  end if;
  perform pg_advisory_xact_lock(hashtext('map_restore'));
  insert into public.map_restore (to_day, to_at, editor) values (d, t, me.name);
  for r in select k, v from public.map_kv loop                     -- 그때 없던 칸 지움
    if not st ? r.k then
      delete from public.map_kv where k = r.k;
      perform public.ws_map_hist_put(r.k, null, me.name); n := n + 1;
    end if;
  end loop;
  for r in select key k, value v from jsonb_each_text(st) where key not like 'lotte\_base\_svg\_%' loop
    if (select v from public.map_kv where k = r.k) is distinct from r.v then
      insert into public.map_kv (k, v, editor, updated_at) values (r.k, r.v, me.name, clock_timestamp())
      on conflict (k) do update set v = excluded.v, editor = excluded.editor, updated_at = excluded.updated_at;
      perform public.ws_map_hist_put(r.k, r.v, me.name); n := n + 1;
    end if;
  end loop;
  perform public.ws_log(me.name, '지도 되돌리기', coalesce(public.ws_map_iso(t), d::text), n || '칸');
  return jsonb_build_object('ok', true, 'n', n);
end $$;

revoke all on function public.ws_map_hist_put(text, text, text), public.ws_map_iso(timestamptz), public.ws_map_mark(text, text),
  public.ws_map_days(text), public.ws_map_restore(text, text) from public, anon, authenticated;
grant execute on function public.ws_map_mark(text, text), public.ws_map_days(text), public.ws_map_restore(text, text) to authenticated;
