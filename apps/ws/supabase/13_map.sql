-- ============================================================================
-- 업무지원(WS) 지도 — 도면 앱(fm/map) 자료 (결정 130 · 기록 132 · 동시 편집·권한 134)
-- 실행: 12 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_지도.md
--
--  · map_kv    = 도면 앱이 브라우저에 두던 저장 칸을 그대로 한 줄씩 (이름 = 옛 localStorage 이름, 값 = 글자)
--                매장·기능실(specs·deleted·renamed·custom·vacant), 구역, 심벌, 설비 연결선, 축척, 고친 도면 그림
--  · map_floor = 층 도면 그림 주소. 공개 코드(fm/map)·이 저장소에 두지 않고 로그인한 사람에게만 넘김
--  · map_hist  = 날짜별 기록 (결정 132). 저장할 때마다 같은 칸·같은 날은 마지막 것만 남김 (되돌리기 전 기록은 남김)
--                업체 바탕 도면(lotte_base_svg_*)도 그림이 바뀌었을 때만 여기 보관 → 업체가 그림을 바꿔도 옛 모습을 불러옴
--  · map_restore = 소장의 「이 날로 되돌리기」 기록
--  · 화면은 PIN 로그인 표(ws_auth)가 있어야 읽음. 고치기는 파트장 이상(소장·부소장·파트장·관리자), 되돌리기는 소장만 (결정 134)
--  · 같은 칸을 그사이 다른 사람이 고쳤으면 저장하지 않고 알림 (ver 비교, 결정 134)
-- ============================================================================
create table if not exists public.map_kv (
  k          text primary key,
  v          text not null,
  editor     text,
  updated_at timestamptz not null default now()
);
create table if not exists public.map_floor (
  building text not null,
  code     text not null,
  svg_url  text not null,
  primary key (building, code)
);
create table if not exists public.map_hist (
  id     bigserial primary key,
  k      text not null,
  v      text,                                  -- null = 그날 지움
  sha    text,                                  -- 업체 바탕 도면만: 같은 그림이면 다시 안 넣음
  editor text,
  at     timestamptz not null default clock_timestamp(),
  day    date not null default (clock_timestamp() at time zone 'Asia/Seoul')::date
);
create index if not exists map_hist_k_at on public.map_hist (k, at desc);
create index if not exists map_hist_day on public.map_hist (day);
create table if not exists public.map_restore (
  at     timestamptz primary key default clock_timestamp(),
  to_day date not null,
  editor text
);
alter table public.map_kv enable row level security;
alter table public.map_floor enable row level security;
alter table public.map_hist enable row level security;
alter table public.map_restore enable row level security;
revoke all on public.map_kv, public.map_floor, public.map_hist, public.map_restore from anon, authenticated;

-- 층 주소 26개는 공개 저장소에 두지 않음 → 처음 한 번 따로 넣음 (WS_지도.md 3장). 업체가 주소를 바꾸면 이 표만 고침

-- 기록 시작 (한 번만): 지금 모습을 「어제까지의 모습」으로 — 오늘 고쳐도 고치기 전 모습이 남게
insert into public.map_hist (k, v, editor, at, day)
select k, v, editor, (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '1 second',
       (now() at time zone 'Asia/Seoul')::date - 1
from public.map_kv where not exists (select 1 from public.map_hist);

create or replace function public.ws_map_can_edit(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_role in ('소장', '부소장', '파트장', '관리자'), false);
$$;

-- 기록 한 줄: 같은 칸·같은 날은 마지막 것만 (마지막 되돌리기 뒤에 쓴 줄만 지움 → 되돌리기 전 모습은 남음)
create or replace function public.ws_map_hist_put(p_k text, p_v text, p_editor text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  delete from public.map_hist h where h.k = p_k and h.day = (clock_timestamp() at time zone 'Asia/Seoul')::date
     and h.at > coalesce((select max(r.at) from public.map_restore r), '-infinity'::timestamptz);
  insert into public.map_hist (k, v, editor) values (p_k, p_v, p_editor);
end $$;

-- 처음 열 때 한 번: 모든 저장 칸(+ 칸마다 ver) · 층 도면 주소 · 보관한 업체 도면의 sha · 고칠 수 있나
create or replace function public.ws_map_load(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  return jsonb_build_object('ok', true, 'canEdit', public.ws_map_can_edit(me.role), 'isBoss', me.role = '소장',
    'kv', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from public.map_kv),
    'vers', (select coalesce(jsonb_object_agg(k, public.ws_ver(updated_at)), '{}'::jsonb) from public.map_kv),
    'urls', (select coalesce(jsonb_object_agg(building, f), '{}'::jsonb)
             from (select building, jsonb_object_agg(code, svg_url) f from public.map_floor group by building) x),
    'bases', (select coalesce(jsonb_object_agg(k, sha), '{}'::jsonb)
              from (select distinct on (k) k, sha from public.map_hist where k like 'lotte\_base\_svg\_%' order by k, at desc) b));
end $$;

-- 칸 하나 저장. p_v = null 이면 지움. p_ver = 화면이 마지막으로 본 판 ('' = 없던 칸)
drop function if exists public.ws_map_save(text, text, text);
create or replace function public.ws_map_save(p_token text, p_k text, p_v text, p_ver text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  cur public.map_kv;
  nv text;
begin
  if not public.ws_map_can_edit(me.role) then return jsonb_build_object('ok', false, 'error', '지도는 파트장 이상만 고칠 수 있습니다'); end if;
  if coalesce(p_k, '') !~ '^lotte_[A-Za-z0-9_]+$' or p_k like 'lotte\_base\_svg\_%' or length(p_k) > 80 then
    return jsonb_build_object('ok', false, 'error', '저장 칸 이름이 맞지 않습니다');
  end if;
  if length(p_v) > 5000000 then return jsonb_build_object('ok', false, 'error', '도면이 너무 큽니다 (5MB 넘음)'); end if;
  perform pg_advisory_xact_lock(hashtext('map_' || p_k));
  select * into cur from public.map_kv where k = p_k;
  if public.ws_ver(cur.updated_at) <> coalesce(p_ver, '') then
    return jsonb_build_object('ok', false, 'conflict', true, 'by', coalesce(cur.editor, ''),
      'error', '그사이 ' || coalesce(nullif(cur.editor, ''), '다른 사람') || '님이 이 층을 고쳤습니다. 새로 불러옵니다.');
  end if;
  if p_v is null then
    delete from public.map_kv where k = p_k;
    nv := '';
  else
    insert into public.map_kv (k, v, editor, updated_at) values (p_k, p_v, me.name, clock_timestamp())
    on conflict (k) do update set v = excluded.v, editor = excluded.editor, updated_at = excluded.updated_at
    returning public.ws_ver(updated_at) into nv;
  end if;
  perform public.ws_map_hist_put(p_k, p_v, me.name);
  return jsonb_build_object('ok', true, 'ver', nv);
end $$;

-- 업체 바탕 도면 보관 (층을 연 사람 누구나, 그림이 바뀌었을 때만)
create or replace function public.ws_map_base(p_token text, p_k text, p_v text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); h text;
begin
  if coalesce(p_k, '') !~ '^lotte_base_svg_[A-Za-z0-9_]+$' or coalesce(p_v, '') = '' or length(p_v) > 5000000 then
    return jsonb_build_object('ok', false, 'error', '바탕 도면이 맞지 않습니다');
  end if;
  h := encode(extensions.digest(p_v, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext('map_' || p_k));
  if (select sha from public.map_hist where k = p_k order by at desc limit 1) is not distinct from h then
    return jsonb_build_object('ok', true, 'sha', h, 'same', true);
  end if;
  insert into public.map_hist (k, v, sha, editor) values (p_k, p_v, h, me.name);
  return jsonb_build_object('ok', true, 'sha', h);
end $$;

-- 기록이 있는 날: 날마다 바뀐 칸 이름 · 고친 사람, 되돌리기 기록
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
                   'before', to_char((at - interval '1 microsecond') at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+09:00',
                   'time', to_char(at at time zone 'Asia/Seoul', 'HH24:MI')) order by at), '[]'::jsonb) from public.map_restore));
end $$;

-- 그때 모습: p_at = 'YYYY-MM-DD'(그날 끝) 또는 시각. 업체 바탕 도면 포함
create or replace function public.ws_map_state(p_at timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select distinct on (k) k, v from public.map_hist where at <= p_at order by k, at desc) s where v is not null;
$$;
create or replace function public.ws_map_end(p_at text)
returns timestamptz language sql stable set search_path = public as $$
  select case when p_at ~ '^\d{4}-\d{2}-\d{2}$' then ((p_at::date + 1)::timestamp at time zone 'Asia/Seoul') - interval '1 microsecond'
              else p_at::timestamptz end;
$$;
create or replace function public.ws_map_at(p_token text, p_at text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  if coalesce(p_at, '') !~ '^\d{4}-\d{2}-\d{2}' then return jsonb_build_object('ok', false, 'error', '날짜가 맞지 않습니다'); end if;
  return jsonb_build_object('ok', true, 'kv', public.ws_map_state(public.ws_map_end(p_at)));
end $$;

-- 이 날로 되돌리기 (소장만). 지금 모습은 기록에 그대로 남음 (되돌리기 전 보기)
create or replace function public.ws_map_restore(p_token text, p_day text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  st jsonb; r record; n int := 0;
begin
  if me.role is distinct from '소장' then return jsonb_build_object('ok', false, 'error', '되돌리기는 소장만 할 수 있습니다'); end if;
  if d is null or d >= (now() at time zone 'Asia/Seoul')::date then return jsonb_build_object('ok', false, 'error', '지난 날짜만 되돌릴 수 있습니다'); end if;
  perform pg_advisory_xact_lock(hashtext('map_restore'));
  st := public.ws_map_state(public.ws_map_end(d::text));
  insert into public.map_restore (to_day, editor) values (d, me.name);
  for r in select k, v from public.map_kv loop                     -- 그날 없던 칸 지움
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
  perform public.ws_log(me.name, '지도 되돌리기', d::text, n || '칸');
  return jsonb_build_object('ok', true, 'n', n);
end $$;

revoke all on function public.ws_map_can_edit(text), public.ws_map_hist_put(text, text, text), public.ws_map_state(timestamptz), public.ws_map_end(text),
  public.ws_map_load(text), public.ws_map_save(text, text, text, text), public.ws_map_base(text, text, text),
  public.ws_map_days(text), public.ws_map_at(text, text), public.ws_map_restore(text, text) from public, anon, authenticated;
grant execute on function public.ws_map_load(text), public.ws_map_save(text, text, text, text), public.ws_map_base(text, text, text),
  public.ws_map_days(text), public.ws_map_at(text, text), public.ws_map_restore(text, text) to authenticated;
