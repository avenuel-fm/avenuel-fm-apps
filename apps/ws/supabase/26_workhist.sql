-- ============================================================================
-- 업무지원(WS) 서류작업 › 주간/야간 작업내역 — docs/설계/WS_주야간작업내역.md, 결정 240
-- 실행: 25_risk.sql 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전). 15_menu.sql 도 먼저 다시 Run (메뉴 키 docs.work)
--  · 주간작업(dw_day): 일자 · 파트(전기방재/기계건축) · 작업자 · 작업위치(버튼) · 작업내용 · 작업 전/후 사진 각 4장까지 · 사용자재(이름·수량·단위) · 비고
--  · 야간작업(dw_night): 일자 · 업체명(직접) · 작업위치 · 작업내용 · 현장 사진 · 방염서류 사진 · 각서 사진(모두 장수 제한 느슨) · 기타사항
--  · 식당가 점검(rest): 매장마다 매장명 + 사진(1 가스누설경보기 · 2 주방전경 필수, 10장까지) · 20곳까지 (11-27 추가 — 이 파일을 다시 Run)
--  · 사진 파일은 화면이 버킷 dw_photo/ 에 먼저 올리고 주소·경로만 넘김 (방염서류·각서는 글자가 읽히게 덜 줄여서)
--  · 종합업무일지 연동: 아래 ws_log_tbm 을 다시 정의 — 그 근무일 주간작업의 작업위치+작업내용이 해당 파트 금일작업 줄에 먼저 들어옴
--    (03_docs.sql 을 다시 Run 하면 이 연동이 풀리니, 그 뒤에는 이 파일도 다시 Run)
--  · 보기·쓰기·고치기·지우기: 전 직원 (지운 것은 숨김 처리만, 파일은 그대로)
-- ============================================================================
create table if not exists public.dw_day (
  wd_id      text primary key,                 -- WS-WD-YYYYMMDD-###
  work_day   date not null,
  parts      text[] not null default '{}',     -- '전기방재' · '기계건축' (둘 다 가능)
  workers    text not null default '',
  floor      text not null default '',
  content    text not null default '',
  mats       jsonb not null default '[]'::jsonb,   -- [{n, q, u}]
  note       text not null default '',
  before_ids uuid[] not null default '{}',
  after_ids  uuid[] not null default '{}',
  saved_by   text,
  saved_at   timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted    boolean not null default false
);
create index if not exists dw_day_day on public.dw_day (work_day desc, saved_at) where not deleted;
alter table public.dw_day enable row level security;   -- 정책 없음 = 표를 직접 못 읽음 (함수로만)

create table if not exists public.dw_night (
  wn_id      text primary key,                 -- WS-WN-YYYYMMDD-###
  work_day   date not null,
  company    text not null default '',
  floor      text not null default '',
  content    text not null default '',
  note       text not null default '',
  photo_ids  uuid[] not null default '{}',     -- 현장 사진
  fire_ids   uuid[] not null default '{}',     -- 방염서류
  pledge_ids uuid[] not null default '{}',     -- 각서
  saved_by   text,
  saved_at   timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted    boolean not null default false
);
create index if not exists dw_night_day on public.dw_night (work_day desc, saved_at) where not deleted;
alter table public.dw_night add column if not exists rest jsonb not null default '[]'::jsonb;   -- 식당가 점검 [{name, ids:[uuid]}]
alter table public.dw_night enable row level security;

-- 파일 id 목록 → [{id, src}] (저장한 순서 그대로)
create or replace function public.ws_dw_files(p uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'src', public.ws_file_url(u.id)) order by u.o), '[]'::jsonb)
  from unnest(coalesce(p, '{}'::uuid[])) with ordinality u(id, o);
$$;

-- 사진 칸 하나 저장: 화면이 준 목록 [{id}(이미 있는 것) | {file:{url,path}}(새것)] 순서대로. 이미 있는 것은 이 칸의 것만 인정. 넘치면 뒤는 버림
create or replace function public.ws_dw_pics(p_old uuid[], p_list jsonb, p_max int, p_kind text, p_name text, p_folder text, p_who text)
returns uuid[] language plpgsql volatile security definer set search_path = public as $$
declare
  e jsonb; res uuid[] := '{}'::uuid[]; id text;
begin
  if jsonb_typeof(p_list) is distinct from 'array' then return coalesce(p_old, '{}'::uuid[]); end if;   -- 안 보내면 그대로
  for e in select x from jsonb_array_elements(p_list) x loop
    exit when cardinality(res) >= p_max;
    id := e->>'id';
    if e ? 'file' then
      res := res || public.ws_add_file(p_kind, e->'file', 'image/jpeg', p_name || '_' || lpad((cardinality(res) + 1)::text, 3, '0') || '.jpg', p_folder, p_who);
    elsif coalesce(id, '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and id::uuid = any(coalesce(p_old, '{}'::uuid[])) and not (id::uuid = any(res)) then
      res := res || id::uuid;
    end if;
  end loop;
  return res;
end $$;

create or replace function public.ws_dw_out(r public.dw_day)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.wd_id, 'day', r.work_day::text, 'parts', to_jsonb(r.parts), 'workers', r.workers, 'floor', r.floor, 'content', r.content,
    'mats', r.mats, 'note', r.note, 'before', public.ws_dw_files(r.before_ids), 'after', public.ws_dw_files(r.after_ids),
    'by', coalesce(r.saved_by, ''), 'at', to_char(r.updated_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
$$;

create or replace function public.ws_dn_out(r public.dw_night)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.wn_id, 'day', r.work_day::text, 'co', r.company, 'floor', r.floor, 'content', r.content, 'note', r.note,
    'photos', public.ws_dw_files(r.photo_ids), 'fire', public.ws_dw_files(r.fire_ids), 'pledge', public.ws_dw_files(r.pledge_ids),
    'rest', coalesce((select jsonb_agg(jsonb_build_object('name', e->>'name', 'pics', public.ws_dw_files(array(select jsonb_array_elements_text(e->'ids'))::uuid[])) order by o)
                      from jsonb_array_elements(r.rest) with ordinality x(e, o)), '[]'::jsonb),
    'by', coalesce(r.saved_by, ''), 'at', to_char(r.updated_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
$$;

-- ── 주간작업 ───────────────────────────────────────────────────────────────
-- 목록: 검색어(일자·작업위치·작업내용·작업자 글자) · 날짜 범위. 둘 다 없으면 최근 60일. 최대 200건
create or replace function public.ws_dw_list(p_token text, p_q text, p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  q text := lower(btrim(coalesce(p_q, '')));
  f date := public.ws_date(p_from);
  t date := public.ws_date(p_to);
begin
  perform public.ws_menu_guard(me.role, 'docs.work');
  if q = '' and f is null and t is null then f := public.ws_work_day() - 60; end if;
  return jsonb_build_object('ok', true, 'floors', to_jsonb(public.ws_rw_floors()),
    'list', coalesce((select jsonb_agg(public.ws_dw_out(x) order by x.work_day desc, x.saved_at) from (
        select * from public.dw_day p
        where not p.deleted and (f is null or p.work_day >= f) and (t is null or p.work_day <= t)
          and (q = '' or p.work_day::text like '%' || q || '%' or to_char(p.work_day, 'MM-DD') like '%' || q || '%' or lower(p.floor) like '%' || q || '%'
               or lower(p.content) like '%' || q || '%' or lower(p.workers) like '%' || q || '%')
        order by p.work_day desc, p.saved_at limit 200) x), '[]'::jsonb));
end $$;

-- 저장 (새로 / 고치기). p_d = { id(고칠 때), day, parts[], workers, floor, content, mats[{n,q,u}], note, before[], after[] }
create or replace function public.ws_dw_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := coalesce(public.ws_date(p_d->>'day'), public.ws_work_day());
  v_id text := nullif(p_d->>'id', '');
  v_parts text[];
  fl text := coalesce(p_d->>'floor', '');
  ct text := public.ws_clean(p_d->>'content', 300);
  v_mats jsonb;
  b uuid[]; a uuid[]; nt text;
  r public.dw_day;
  base text;
  folder text;
begin
  perform public.ws_menu_guard(me.role, 'docs.work');
  if d is null or d < public.ws_work_day() - 3650 or d > public.ws_work_day() + 1 then return jsonb_build_object('ok', false, 'error', '일자가 올바르지 않습니다.'); end if;
  v_parts := array(select x from unnest(array['전기방재', '기계건축']) x
                 where x in (select jsonb_array_elements_text(case when jsonb_typeof(p_d->'parts') = 'array' then p_d->'parts' else '[]'::jsonb end)));
  if cardinality(v_parts) = 0 then return jsonb_build_object('ok', false, 'error', '파트를 하나 이상 골라 주세요.'); end if;
  if ct = '' then return jsonb_build_object('ok', false, 'error', '작업내용을 입력해 주세요.'); end if;
  if fl <> '' and not fl = any(public.ws_rw_floors()) then fl := ''; end if;
  if jsonb_array_length(case when jsonb_typeof(p_d->'before') = 'array' then p_d->'before' else '[]'::jsonb end) > 4
     or jsonb_array_length(case when jsonb_typeof(p_d->'after') = 'array' then p_d->'after' else '[]'::jsonb end) > 4 then
    return jsonb_build_object('ok', false, 'error', '작업 전·후 사진은 각각 4장까지입니다.');
  end if;
  v_mats := coalesce((select jsonb_agg(m order by o) from (
      select jsonb_build_object('n', public.ws_clean(e->>'n', 30), 'q', public.ws_clean(e->>'q', 10), 'u', public.ws_clean(e->>'u', 10)) m, o
      from jsonb_array_elements(case when jsonb_typeof(p_d->'mats') = 'array' then p_d->'mats' else '[]'::jsonb end) with ordinality u(e, o)
      where public.ws_clean(e->>'n', 30) <> '' limit 20) z), '[]'::jsonb);
  perform pg_advisory_xact_lock(hashtext('ws_dw'));
  if v_id is not null then
    select * into r from public.dw_day where wd_id = v_id and not deleted;
    if r.wd_id is null then return jsonb_build_object('ok', false, 'error', '작업을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  else
    r.wd_id := public.ws_next_id('WD', array(select wd_id from public.dw_day));
  end if;
  base := d || '_주간작업';
  folder := '서류작업/주간작업/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM');
  b := public.ws_dw_pics(r.before_ids, p_d->'before', 4, 'dw_photo', base || '_작업전', folder, me.name);
  a := public.ws_dw_pics(r.after_ids, p_d->'after', 4, 'dw_photo', base || '_작업후', folder, me.name);
  nt := left(btrim(regexp_replace(coalesce(p_d->>'note', ''), '[-<>]', '', 'g')), 300);
  if v_id is null then
    insert into public.dw_day (wd_id, work_day, parts, workers, floor, content, mats, note, before_ids, after_ids, saved_by)
    values (r.wd_id, d, v_parts, public.ws_clean(p_d->>'workers', 60), fl, ct, v_mats, nt, b, a, me.name) returning * into r;
  else
    update public.dw_day set work_day = d, parts = v_parts, workers = public.ws_clean(p_d->>'workers', 60), floor = fl, content = ct, mats = v_mats, note = nt,
      before_ids = b, after_ids = a, updated_at = clock_timestamp() where wd_id = v_id returning * into r;
  end if;
  perform public.ws_log(me.name, case when v_id is null then '주간작업 저장' else '주간작업 수정' end, r.wd_id, d || ' · ' || left(ct, 30));
  return jsonb_build_object('ok', true, 'item', public.ws_dw_out(r));
end $$;

create or replace function public.ws_dw_delete(p_token text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.dw_day;
begin
  perform public.ws_menu_guard(me.role, 'docs.work');
  update public.dw_day set deleted = true, updated_at = clock_timestamp() where wd_id = p_id and not deleted returning * into r;
  if r.wd_id is null then return jsonb_build_object('ok', false, 'error', '작업을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  perform public.ws_log(me.name, '주간작업 삭제', p_id, r.work_day || ' · ' || left(r.content, 30));
  return jsonb_build_object('ok', true);
end $$;

-- ── 야간작업 ───────────────────────────────────────────────────────────────
-- 목록: 검색어(일자·층·업체명·작업내용 글자). 비면 최근 60일. 최대 200건
create or replace function public.ws_dn_list(p_token text, p_q text, p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  q text := lower(btrim(coalesce(p_q, '')));
  f date := public.ws_date(p_from);
  t date := public.ws_date(p_to);
begin
  perform public.ws_menu_guard(me.role, 'docs.work');
  if q = '' and f is null and t is null then f := public.ws_work_day() - 60; end if;
  return jsonb_build_object('ok', true, 'floors', to_jsonb(public.ws_rw_floors()),
    'list', coalesce((select jsonb_agg(public.ws_dn_out(x) order by x.work_day desc, x.saved_at) from (
        select * from public.dw_night p
        where not p.deleted and (f is null or p.work_day >= f) and (t is null or p.work_day <= t)
          and (q = '' or p.work_day::text like '%' || q || '%' or to_char(p.work_day, 'MM-DD') like '%' || q || '%' or lower(p.floor) like '%' || q || '%'
               or lower(p.company) like '%' || q || '%' or lower(p.content) like '%' || q || '%')
        order by p.work_day desc, p.saved_at limit 200) x), '[]'::jsonb));
end $$;

-- 저장 (새로 / 고치기). p_d = { id, day, co, floor, content, note, photos[], fire[], pledge[], rest[{name, pics[]}] } — 사진 칸마다 40장까지 · 식당가 매장 20곳 × 10장
create or replace function public.ws_dn_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := coalesce(public.ws_date(p_d->>'day'), public.ws_work_day());
  v_id text := nullif(p_d->>'id', '');
  fl text := coalesce(p_d->>'floor', '');
  ct text := public.ws_clean(p_d->>'content', 300);
  co text := public.ws_clean(p_d->>'co', 30);
  k text; nt text;
  pa uuid[]; fa uuid[]; la uuid[];
  e jsonb; nm text; ra uuid[]; old_r uuid[]; v_rest jsonb := '[]'::jsonb;
  r public.dw_night;
  base text;
  folder text;
begin
  perform public.ws_menu_guard(me.role, 'docs.work');
  if d is null or d < public.ws_work_day() - 3650 or d > public.ws_work_day() + 1 then return jsonb_build_object('ok', false, 'error', '일자가 올바르지 않습니다.'); end if;
  if co = '' then return jsonb_build_object('ok', false, 'error', '업체명을 입력해 주세요.'); end if;
  if ct = '' then return jsonb_build_object('ok', false, 'error', '작업내용을 입력해 주세요.'); end if;
  if fl <> '' and not fl = any(public.ws_rw_floors()) then fl := ''; end if;
  foreach k in array array['photos', 'fire', 'pledge'] loop
    if jsonb_array_length(case when jsonb_typeof(p_d->k) = 'array' then p_d->k else '[]'::jsonb end) > 40 then
      return jsonb_build_object('ok', false, 'error', '사진은 한 칸에 40장까지 넣을 수 있습니다.');
    end if;
  end loop;
  if jsonb_typeof(p_d->'rest') = 'array' and jsonb_array_length(p_d->'rest') > 20 then return jsonb_build_object('ok', false, 'error', '식당가 점검은 20곳까지입니다.'); end if;
  for e in select x from jsonb_array_elements(case when jsonb_typeof(p_d->'rest') = 'array' then p_d->'rest' else '[]'::jsonb end) x loop
    if public.ws_clean(e->>'name', 30) = '' then return jsonb_build_object('ok', false, 'error', '식당가 점검: 매장명을 넣어 주세요.'); end if;
    if jsonb_typeof(e->'pics') is distinct from 'array' or jsonb_array_length(e->'pics') < 2 or jsonb_array_length(e->'pics') > 10 then
      return jsonb_build_object('ok', false, 'error', '식당가 점검: 매장마다 사진 2~10장(가스누설경보기·주방전경 포함)을 넣어 주세요.');
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('ws_dn'));
  if v_id is not null then
    select * into r from public.dw_night where wn_id = v_id and not deleted;
    if r.wn_id is null then return jsonb_build_object('ok', false, 'error', '작업을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  else
    r.wn_id := public.ws_next_id('WN', array(select wn_id from public.dw_night));
  end if;
  base := d || '_야간작업-' || coalesce(nullif(public.ws_safe_name(co), ''), '업체미입력');
  folder := '서류작업/야간작업/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM');
  pa := public.ws_dw_pics(r.photo_ids, p_d->'photos', 40, 'dw_photo', base || '_현장', folder, me.name);
  fa := public.ws_dw_pics(r.fire_ids, p_d->'fire', 40, 'dw_photo', base || '_방염서류', folder, me.name);
  la := public.ws_dw_pics(r.pledge_ids, p_d->'pledge', 40, 'dw_photo', base || '_각서', folder, me.name);
  if jsonb_typeof(p_d->'rest') = 'array' then   -- 안 보내면(옛 화면) 그대로 둠
    old_r := array(select jsonb_array_elements_text(x->'ids')::uuid from jsonb_array_elements(coalesce(r.rest, '[]'::jsonb)) x);
    for e in select x from jsonb_array_elements(p_d->'rest') x loop
      nm := public.ws_clean(e->>'name', 30);
      ra := public.ws_dw_pics(old_r, e->'pics', 10, 'dw_photo', base || '_식당가-' || coalesce(nullif(public.ws_safe_name(nm), ''), '매장'), folder, me.name);
      v_rest := v_rest || jsonb_build_array(jsonb_build_object('name', nm, 'ids', to_jsonb(ra)));
    end loop;
  else
    v_rest := coalesce(r.rest, '[]'::jsonb);
  end if;
  nt := left(btrim(regexp_replace(coalesce(p_d->>'note', ''), '[-<>]', '', 'g')), 300);
  if v_id is null then
    insert into public.dw_night (wn_id, work_day, company, floor, content, note, photo_ids, fire_ids, pledge_ids, rest, saved_by)
    values (r.wn_id, d, co, fl, ct, nt, pa, fa, la, v_rest, me.name) returning * into r;
  else
    update public.dw_night set work_day = d, company = co, floor = fl, content = ct, note = nt, photo_ids = pa, fire_ids = fa, pledge_ids = la, rest = v_rest,
      updated_at = clock_timestamp() where wn_id = v_id returning * into r;
  end if;
  perform public.ws_log(me.name, case when v_id is null then '야간작업 저장' else '야간작업 수정' end, r.wn_id, d || ' · ' || co);
  return jsonb_build_object('ok', true, 'item', public.ws_dn_out(r));
end $$;

create or replace function public.ws_dn_delete(p_token text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.dw_night;
begin
  perform public.ws_menu_guard(me.role, 'docs.work');
  update public.dw_night set deleted = true, updated_at = clock_timestamp() where wn_id = p_id and not deleted returning * into r;
  if r.wn_id is null then return jsonb_build_object('ok', false, 'error', '작업을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  perform public.ws_log(me.name, '야간작업 삭제', p_id, r.work_day || ' · ' || r.company);
  return jsonb_build_object('ok', true);
end $$;

-- ── 종합업무일지 연동: 그 근무일 주간작업(작업위치+작업내용)이 해당 파트 금일작업 줄 맨 앞에, 같은 글은 한 번만. 파트마다 15줄까지. 명일 작업 일정·TBM 표는 안 가져옴 (사용자 11-25, 결정 268) ──
create or replace function public.ws_log_tbm(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select 0 o, (extract(epoch from d.saved_at) * 1000000)::bigint i, p dept,
           public.ws_clean(concat_ws(' ', nullif(btrim(d.floor), ''), d.content), 100) t
    from public.dw_day d, unnest(d.parts) p where d.work_day = p_day and not d.deleted
  ), u as (select distinct on (dept, t) dept, t, o, i from l where dept is not null and t <> '' order by dept, t, o, i
  ), n as (select dept, t, row_number() over (partition by dept order by o, i) k from u)
  select jsonb_build_object(
    '전기방재', coalesce((select jsonb_agg(t order by k) from n where dept = '전기방재' and k <= 15), '[]'::jsonb),
    '기계건축', coalesce((select jsonb_agg(t order by k) from n where dept = '기계건축' and k <= 15), '[]'::jsonb));
$$;

-- 권한: 도우미는 막음. 로그인 기기만 8개
revoke all on function public.ws_dw_files(uuid[]), public.ws_dw_pics(uuid[], jsonb, int, text, text, text, text), public.ws_dw_out(public.dw_day), public.ws_dn_out(public.dw_night),
  public.ws_dw_list(text, text, text, text), public.ws_dw_save(text, jsonb), public.ws_dw_delete(text, text),
  public.ws_dn_list(text, text, text, text), public.ws_dn_save(text, jsonb), public.ws_dn_delete(text, text) from public, anon, authenticated;
grant execute on function public.ws_dw_list(text, text, text, text), public.ws_dw_save(text, jsonb), public.ws_dw_delete(text, text),
  public.ws_dn_list(text, text, text, text), public.ws_dn_save(text, jsonb), public.ws_dn_delete(text, text) to authenticated;
