-- 업무지원 · 소화전·공기호흡기 점검 (결정 224) — 소화기 점검(05_fire.sql)과 같은 틀
-- 05_fire.sql · 06_eh.sql 다음에 SQL Editor 에 통째로 붙여 넣고 Run (두 번 돌려도 안전)
-- 설계: docs/설계/WS_소화전공기호흡기.md
--
--  · 장비 표 fire_equip (소화전 hyd · 공기호흡기 air): 층 + 위치를 직접 적고 대수만큼 등록 — 이름 「위치-소화전1」 (소화기 「위치-소화기1」과 같은 규칙, 결정 228). 지도 고유번호에는 걸지 않음
--  · 점검 표 fire_equip_checks: 월 1회, 소화기와 같은 입력 기간(점검시작일~점검마감일) · 기한 후 표시 · 한 장비 한 달 1건
--  · 점검 항목 (사진 필수, 정상/이상 + 이상 내용 한 줄):
--      소화전      외관 · 누수 여부 · 청소 상태
--      공기호흡기  충전량(압력계 사진) · 압력조절기(압력계 사진) · 외관(전체 사진)
--  · 점검자 = 로그인한 직원 이름 (QR 입력 페이지 eq.html 이 로그인 정보를 이어받음). 손글씨 서명은 없음
--  · 로그인 안 한 사람은 ws_eq_pub 만 부를 수 있음 = 지난 12개월 표 (사진 없음, 점검자 이름은 가림)
--  · 표는 함수로만 읽고 씀 (표 권한은 로그인 사용자에게도 주지 않음, 21_equip_hours.sql 과 같은 방식)

create table if not exists public.fire_equip (
  eq_id      text primary key,                  -- WS-EQ-YYYYMMDD-###
  kind       text not null check (kind in ('hyd', 'air')),
  floor      text,
  place      text,                              -- 직접 적은 위치 (예: 동측 계단 앞)
  name       text,                              -- 「3F 동측 계단 앞 소화전」
  qr_token   text unique,                       -- 12자리 고유번호 (QR ?eq=)
  active     boolean not null default true,
  created_at timestamptz,
  created_by text,
  deleted_at timestamptz
);

-- v2 (결정 228): 번호 + 라벨 인쇄 표시 열. 두 번째 실행부터는 이미 있으면 그대로
alter table public.fire_equip add column if not exists no int;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fire_equip' and column_name = 'printed_at') then
    alter table public.fire_equip add column printed_at timestamptz;
    update public.fire_equip set printed_at = coalesce(created_at, now()) where printed_at is null;   -- 지금까지 등록한 것은 이미 인쇄한 것으로
  end if;
end $$;

create table if not exists public.fire_equip_checks (
  check_id        text primary key,             -- WS-EC-YYYYMMDD-###
  ym              text not null,
  eq_id           text references public.fire_equip(eq_id),
  kind            text,
  floor           text,
  eq_name         text,
  state           text,                         -- 이상없음 / 이상있음
  items           jsonb not null default '[]'::jsonb,   -- [{k, bad, memo, photo(files.id)}] 항목 순서대로
  checker         text,                         -- 로그인한 직원 이름
  entered_at      timestamptz,
  late            boolean not null default false,
  overwrite_count int not null default 0,
  deleted         boolean not null default false
);
create index if not exists fire_equip_checks_ym on public.fire_equip_checks (ym) where not deleted;
create index if not exists fire_equip_checks_eq on public.fire_equip_checks (eq_id, ym) where not deleted;

alter table public.fire_equip enable row level security;
alter table public.fire_equip_checks enable row level security;
revoke all on public.fire_equip, public.fire_equip_checks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 도우미
-- ---------------------------------------------------------------------------
create or replace function public.ws_eq_kind_name(p_kind text)
returns text language sql immutable set search_path = public as $$
  select case p_kind when 'hyd' then '소화전' else '공기호흡기' end;
$$;

-- 점검 항목 — 화면(입력·현황·QR 표)이 이 하나를 같이 씀. gauge = 압력계 사진(원 안내선)
create or replace function public.ws_eq_spec(p_kind text)
returns jsonb language sql immutable set search_path = public as $$
  select case p_kind
    when 'hyd' then '[{"k":"ext","label":"외관","ok":"정상","bad":"이상","hint":"사진 찍기"},
                      {"k":"leak","label":"누수 여부","ok":"누수 없음","bad":"누수 있음","hint":"사진 찍기"},
                      {"k":"clean","label":"청소 상태","ok":"양호","bad":"불량","hint":"사진 찍기"}]'::jsonb
    else '[{"k":"charge","label":"충전량","ok":"정상","bad":"이상","gauge":true,"hint":"압력계 사진 찍기"},
            {"k":"reg","label":"압력조절기","ok":"정상","bad":"이상","gauge":true,"hint":"압력계 사진 찍기"},
            {"k":"ext","label":"외관","ok":"정상","bad":"이상","hint":"전체 사진 찍기"}]'::jsonb
  end;
$$;

create or replace function public.ws_eq_by_qr(p_qr text)
returns public.fire_equip language sql stable security definer set search_path = public as $$
  select * from public.fire_equip where public.ws_is_qr(p_qr) and qr_token = p_qr and active limit 1;
$$;

-- 이름 가리기: 홍길동 → 홍*동, 남궁민수 → 남**수, 두 글자 → 홍*
create or replace function public.ws_mask_name(p text)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p, '') = '' then ''
              when char_length(p) = 1 then p
              when char_length(p) = 2 then left(p, 1) || '*'
              else left(p, 1) || repeat('*', char_length(p) - 2) || right(p, 1) end;
$$;

-- 옛 이름 「3F 동측 계단 앞 소화전」(번호 없음) → 「동측 계단 앞-소화전1」 (v2 규칙). 한 번만 바뀜, 점검 기록의 이름도 현재 이름으로 맞춤
with n as (select eq_id, row_number() over (partition by kind, place order by created_at, eq_id) rn from public.fire_equip where no is null)
update public.fire_equip e set no = n.rn, name = e.place || '-' || public.ws_eq_kind_name(e.kind) || n.rn from n where e.eq_id = n.eq_id;
update public.fire_equip_checks c set eq_name = e.name from public.fire_equip e where c.eq_id = e.eq_id and c.eq_name is distinct from e.name;

-- ---------------------------------------------------------------------------
-- 장비 등록·삭제·목록 (QR 관리 · 소화전/공기호흡기 탭)
-- ---------------------------------------------------------------------------
create or replace function public.ws_eq_list_(p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'kind', p_kind,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', eq_id, 'floor', floor, 'place', place, 'no', coalesce(no, 0), 'name', name, 'token', qr_token,
                         'created', public.ws_kst(created_at), 'printed', printed_at is not null)
                       order by public.ws_floor_no(floor), place collate "C", coalesce(no, 0), eq_id)
                       from public.fire_equip where active and kind = p_kind), '[]'::jsonb),
    'execUrl', coalesce(regexp_replace(nullif(btrim(public.ws_setting('바로가기주소')), ''), '[?#].*$', ''), ''),
    'label', jsonb_build_object('w', public.ws_set_num('라벨가로mm', 50), 'h', public.ws_set_num('라벨세로mm', 50), 'dpi', public.ws_set_num('프린터dpi', 203)));
$$;

create or replace function public.ws_eq_list(p_token text, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return public.ws_eq_list_(case when p_kind = 'air' then 'air' else 'hyd' end);
end $$;

create or replace function public.ws_eq_add(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_kind text := coalesce(p_d->>'kind', '');
  v_floor text := coalesce(p_d->>'floor', '');
  v_place text := public.ws_clean(p_d->>'place', 30);
  n int;
  max_no int;
  seq int;
  day_key text := to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD');
  tok text;
  b bytea;
  v_name text;
  added text[] := '{}';
begin
  if v_kind not in ('hyd', 'air') then return jsonb_build_object('ok', false, 'error', '종류를 골라 주세요.'); end if;
  if not (v_floor = any (array['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F'])) then return jsonb_build_object('ok', false, 'error', '층을 골라 주세요.'); end if;
  if v_place = '' then return jsonb_build_object('ok', false, 'error', '위치를 적어 주세요. (예: 동측 계단 앞)'); end if;
  -- 대수 1~20 (소화기와 같음)
  n := least(greatest(coalesce(nullif(case when coalesce(p_d->>'count', '') ~ '^\s*\d+(\.\d+)?\s*$' then floor((p_d->>'count')::numeric)::int end, 0), 1), 1), 20);
  perform pg_advisory_xact_lock(hashtext('ws_eq'));
  select coalesce(max(no), 0) into max_no from public.fire_equip where kind = v_kind and place = v_place;   -- 번호는 지운 것까지 세어 이어서 (겹침 없음)
  select coalesce(max(substring(eq_id from '-(\d+)$')::int), 0) into seq from public.fire_equip where eq_id like 'WS-EQ-' || day_key || '-%';
  for i in 1..n loop
    loop   -- 12자리 고유번호 (소화기·전열필증 고유번호와도 겹치지 않게)
      b := gen_random_bytes(12);
      tok := (select string_agg(substr('23456789abcdefghijkmnpqrstuvwxyz', (get_byte(b, k) & 31) + 1, 1), '' order by k) from generate_series(0, 11) k);
      exit when not exists (select 1 from public.fire_equip where qr_token = tok) and not exists (select 1 from public.fire_ext where qr_token = tok)
            and not exists (select 1 from public.eh_devices where qr_token = tok);
    end loop;
    v_name := v_place || '-' || public.ws_eq_kind_name(v_kind) || (max_no + i);
    insert into public.fire_equip (eq_id, kind, floor, place, no, name, qr_token, active, created_at, created_by)
    values ('WS-EQ-' || day_key || '-' || lpad((seq + i)::text, 3, '0'), v_kind, v_floor, v_place, max_no + i, v_name, tok, true, clock_timestamp(), me.name);
    added := added || v_name;
  end loop;
  perform public.ws_log(me.name, public.ws_eq_kind_name(v_kind) || ' 등록', '', v_floor || ' · ' || array_to_string(added, ', '));
  return public.ws_eq_list_(v_kind) || jsonb_build_object('added', to_jsonb(added));
end $$;

create or replace function public.ws_eq_delete(p_token text, p_ids jsonb, p_kind text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  ids text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end));
  v_kind text := case when p_kind = 'air' then 'air' else 'hyd' end;
  names text[];
begin
  if cardinality(ids) = 0 then return jsonb_build_object('ok', false, 'error', '지울 것을 골라 주세요.'); end if;
  with u as (update public.fire_equip set active = false, deleted_at = clock_timestamp() where eq_id = any(ids) and active and kind = v_kind returning name)
  select coalesce(array_agg(name), '{}') into names from u;
  perform public.ws_log(me.name, public.ws_eq_kind_name(v_kind) || ' 삭제', '', array_to_string(names, ', '));
  return public.ws_eq_list_(v_kind) || jsonb_build_object('count', cardinality(names));
end $$;

-- ---------------------------------------------------------------------------
-- ③ 층별 점검 현황 (소화기 ws_fe_status_ 와 같은 규칙, 두 종류를 한 번에)
-- ---------------------------------------------------------------------------
create or replace function public.ws_eq_status_(p_ym text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  now_k timestamp := now() at time zone 'Asia/Seoul';
  cur_ym text := to_char(now_k, 'YYYY-MM');
  v_day int := extract(day from now_k)::int;
  w_start int := public.ws_set_num('점검시작일', 1)::int;
  w_end int := public.ws_set_num('점검마감일', 5)::int;
  m_start timestamptz := (p_ym || '-01')::timestamp at time zone 'Asia/Seoul';
  m_next timestamptz := ((p_ym || '-01')::date + interval '1 month')::timestamp at time zone 'Asia/Seoul';
  items jsonb;
  first_ym text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.eq_id, 'kind', e.kind, 'floor', e.floor, 'place', e.place, 'name', e.name, 'token', e.qr_token,
      'state', case when c.check_id is not null then case when c.state = '이상있음' then 'bad' else 'ok' end
                    when p_ym > cur_ym then 'wait' when p_ym = cur_ym and v_day <= w_end then 'wait' else 'miss' end,
      'checkId', coalesce(c.check_id, ''), 'at', public.ws_kst(c.entered_at), 'late', coalesce(c.late, false), 'by', coalesce(c.checker, ''))
    order by public.ws_floor_no(e.floor), e.kind desc, e.place collate "C", coalesce(e.no, 0), e.eq_id), '[]'::jsonb) into items
  from public.fire_equip e
  left join lateral (select * from public.fire_equip_checks x where x.eq_id = e.eq_id and x.ym = p_ym and not x.deleted order by x.entered_at desc limit 1) c on true
  where coalesce(e.created_at, '-infinity') < m_next
    and (e.active or (e.deleted_at >= m_start and e.deleted_at >= m_next));
  select least(cur_ym, coalesce(min(to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM')), cur_ym)) into first_ym from public.fire_equip;
  return jsonb_build_object('ok', true, 'ym', p_ym, 'curYm', cur_ym, 'day', v_day, 'window', jsonb_build_object('start', w_start, 'end', w_end),
    'isCurrent', p_ym = cur_ym, 'items', items,
    'counts', (select jsonb_build_object('ok', count(*) filter (where e->>'state' = 'ok'), 'bad', count(*) filter (where e->>'state' = 'bad'),
                 'wait', count(*) filter (where e->>'state' = 'wait'), 'miss', count(*) filter (where e->>'state' = 'miss'), 'total', count(*))
               from jsonb_array_elements(items) e),
    'months', (select jsonb_agg(to_char(m, 'YYYY-MM') order by m) from generate_series((first_ym || '-01')::date, (cur_ym || '-01')::date, interval '1 month') m));
end $$;

create or replace function public.ws_eq_status(p_token text, p_ym text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return public.ws_eq_status_(case when coalesce(p_ym, '') ~ '^\d{4}-(0[1-9]|1[0-2])$' then p_ym else to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') end);
end $$;

-- 입력 내용 (사진 포함)
create or replace function public.ws_eq_detail(p_token text, p_check_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.fire_equip_checks;
begin
  perform public.ws_auth(p_token);
  select * into c from public.fire_equip_checks where check_id = p_check_id and not deleted;
  if c.check_id is null then return jsonb_build_object('ok', false, 'error', '입력 내용을 찾지 못했습니다.'); end if;
  return jsonb_build_object('ok', true, 'name', c.eq_name, 'floor', c.floor, 'kind', c.kind, 'kindName', public.ws_eq_kind_name(c.kind), 'ym', c.ym,
    'state', c.state, 'at', public.ws_kst(c.entered_at), 'late', c.late, 'by', coalesce(c.checker, ''),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('k', t.i->>'k', 'label', x.sp->>'label', 'bad', coalesce((t.i->>'bad')::boolean, false),
                'text', case when coalesce((t.i->>'bad')::boolean, false) then x.sp->>'bad' else x.sp->>'ok' end,
                'memo', coalesce(t.i->>'memo', ''), 'photo', public.ws_file_url(nullif(t.i->>'photo', '')::uuid)) order by t.n), '[]'::jsonb)
              from jsonb_array_elements(c.items) with ordinality t(i, n)
              left join lateral (select s as sp from jsonb_array_elements(public.ws_eq_spec(c.kind)) s where s->>'k' = t.i->>'k' limit 1) x on true));
end $$;

-- ---------------------------------------------------------------------------
-- QR로 열림 (eq.html)
--  · ws_eq_open : 로그인한 직원 → 입력 화면에 필요한 값 (점검자 = 내 이름)
--  · ws_eq_pub  : 로그인 안 함 → 지난 12개월 표 (사진 없음, 점검자 이름 가림)
-- ---------------------------------------------------------------------------
create or replace function public.ws_eq_open(p_token text, p_qr text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  e public.fire_equip := public.ws_eq_by_qr(p_qr);
  now_k timestamp := now() at time zone 'Asia/Seoul';
  v_ym text := to_char(now_k, 'YYYY-MM');
  v_day int := extract(day from now_k)::int;
  w_start int := public.ws_set_num('점검시작일', 1)::int;
  w_end int := public.ws_set_num('점검마감일', 5)::int;
begin
  if e.eq_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않았거나 삭제된 QR입니다. 시설팀에 알려 주세요.'); end if;
  return jsonb_build_object('ok', true, 'me', me.name,
    'eq', jsonb_build_object('id', e.eq_id, 'kind', e.kind, 'kindName', public.ws_eq_kind_name(e.kind), 'name', e.name, 'floor', e.floor, 'place', e.place),
    'spec', public.ws_eq_spec(e.kind),
    'ym', v_ym, 'monthLabel', extract(year from now_k)::int || '년 ' || extract(month from now_k)::int || '월',
    'window', jsonb_build_object('start', w_start, 'end', w_end), 'day', v_day, 'late', v_day > w_end, 'early', v_day < w_start,
    'exists', exists (select 1 from public.fire_equip_checks where eq_id = e.eq_id and ym = v_ym and not deleted),
    'photo', jsonb_build_object('w', public.ws_set_num('사진긴변px', 640), 'q', public.ws_set_num('사진품질', 0.6)));
end $$;

create or replace function public.ws_eq_pub(p_qr text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.fire_equip := public.ws_eq_by_qr(p_qr);
  now_k timestamp := now() at time zone 'Asia/Seoul';
  cur_ym text := to_char(now_k, 'YYYY-MM');
  v_day int := extract(day from now_k)::int;
  w_end int := public.ws_set_num('점검마감일', 5)::int;
  first_ym text;
begin
  if e.eq_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않았거나 삭제된 QR입니다. 시설팀에 알려 주세요.'); end if;
  first_ym := to_char(coalesce(e.created_at, now()) at time zone 'Asia/Seoul', 'YYYY-MM');
  return jsonb_build_object('ok', true,
    'eq', jsonb_build_object('kind', e.kind, 'kindName', public.ws_eq_kind_name(e.kind), 'name', e.name, 'floor', e.floor),
    'spec', public.ws_eq_spec(e.kind), 'ym', cur_ym,
    'rows', (select coalesce(jsonb_agg(r order by r->>'ym' desc), '[]'::jsonb) from (
      select jsonb_build_object('ym', m.ym,
        'state', case when c.check_id is not null then case when c.state = '이상있음' then 'bad' else 'ok' end
                      when m.ym = cur_ym and v_day <= w_end then 'wait' else 'miss' end,
        'day', case when c.check_id is null then '' else to_char(c.entered_at at time zone 'Asia/Seoul', 'MM-DD') end,
        'late', coalesce(c.late, false), 'by', public.ws_mask_name(c.checker),
        'items', coalesce((select jsonb_agg(jsonb_build_object('k', i->>'k', 'bad', coalesce((i->>'bad')::boolean, false), 'memo', coalesce(i->>'memo', '')))
                           from jsonb_array_elements(c.items) i), '[]'::jsonb)) r
      from (select to_char(date_trunc('month', now_k) - make_interval(months => n), 'YYYY-MM') ym from generate_series(0, 11) n) m
      left join lateral (select * from public.fire_equip_checks x where x.eq_id = e.eq_id and x.ym = m.ym and not x.deleted order by x.entered_at desc limit 1) c on true
      where m.ym >= first_ym) q));
end $$;

-- 화면이 올린 사진 확인: 'equip/{QR}/YYYY-MM/{무작위}.jpg' + 우리 버킷 공개 주소
create or replace function public.ws_eq_file(p_qr text, p_file jsonb)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_file->>'path', '') ~ ('^equip/' || p_qr || '/\d{4}-\d{2}/[a-z0-9]+\.jpg$')
     and coalesce(p_file->>'url', '') like '%/object/public/ws-files/' || (p_file->>'path');
$$;

create or replace function public.ws_eq_submit(p_token text, p_qr text, p_d jsonb, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  e public.fire_equip := public.ws_eq_by_qr(p_qr);
  v_spec jsonb;
  s jsonb;
  k text;
  missing text[] := '{}';
  its jsonb := '[]'::jsonb;
  any_bad boolean := false;
  v_bad boolean;
  v_memo text;
  v_state text;
  now_k timestamp := now() at time zone 'Asia/Seoul';
  v_ym text := to_char(now_k, 'YYYY-MM');
  v_late boolean := extract(day from now_k)::int > public.ws_set_num('점검마감일', 5);
  old public.fire_equip_checks;
  base text;
  folder text;
  fid uuid;
  cid text;
  seq int;
  at timestamptz := clock_timestamp();
begin
  if e.eq_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않았거나 삭제된 QR입니다.'); end if;
  v_spec := public.ws_eq_spec(e.kind);
  for s in select value from jsonb_array_elements(v_spec) loop
    if not public.ws_eq_file(p_qr, p_files->(s->>'k')) then missing := missing || (s->>'label'); end if;
  end loop;
  if cardinality(missing) > 0 then return jsonb_build_object('ok', false, 'error', array_to_string(missing, ', ') || ' 사진이 비어 있습니다.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_ec_' || e.eq_id));
  select * into old from public.fire_equip_checks where eq_id = e.eq_id and ym = v_ym and not deleted order by entered_at desc limit 1;
  if old.check_id is not null and coalesce(p_d->>'overwrite', '') not in ('true', '1') then
    return jsonb_build_object('ok', false, 'exists', true, 'error', '이번 달 입력이 이미 있습니다.');
  end if;
  base := to_char(now_k, 'YYYY-MM-DD') || '_' || public.ws_eq_kind_name(e.kind) || '점검-' || public.ws_safe_name(e.name);
  folder := public.ws_eq_kind_name(e.kind) || '점검/' || to_char(now_k, 'YYYY-MM');
  for s in select value from jsonb_array_elements(v_spec) loop
    k := s->>'k';
    v_bad := coalesce(p_d->'items'->k->>'bad', '') in ('true', '1');
    v_memo := case when v_bad then public.ws_clean(p_d->'items'->k->>'memo', 60) else '' end;
    any_bad := any_bad or v_bad;
    insert into public.files (kind, file_url, storage_path, mime, file_name, drive_folder, created_by)
    values ('equip_' || k, p_files->k->>'url', p_files->k->>'path', 'image/jpeg', base || '_' || k || '.jpg', folder, me.name)
    returning id into fid;
    its := its || jsonb_build_array(jsonb_build_object('k', k, 'bad', v_bad, 'memo', v_memo, 'photo', fid));
  end loop;
  v_state := case when any_bad then '이상있음' else '이상없음' end;
  if old.check_id is not null then
    cid := old.check_id;
    update public.fire_equip_checks set state = v_state, kind = e.kind, floor = e.floor, eq_name = e.name, items = its, checker = me.name,
      entered_at = at, late = v_late, overwrite_count = overwrite_count + 1 where check_id = cid;
  else
    select coalesce(max(substring(check_id from '-(\d+)$')::int), 0) into seq from public.fire_equip_checks where check_id like 'WS-EC-' || to_char(now_k, 'YYYYMMDD') || '-%';
    cid := 'WS-EC-' || to_char(now_k, 'YYYYMMDD') || '-' || lpad((seq + 1)::text, 3, '0');
    insert into public.fire_equip_checks (check_id, ym, eq_id, kind, floor, eq_name, state, items, checker, entered_at, late)
    values (cid, v_ym, e.eq_id, e.kind, e.floor, e.name, v_state, its, me.name, at, v_late);
  end if;
  perform public.ws_log(me.name, case when old.check_id is not null then public.ws_eq_kind_name(e.kind) || ' 점검 다시 입력' else public.ws_eq_kind_name(e.kind) || ' 점검 입력' end, cid,
                        e.name || ' · ' || v_state || case when v_late then ' · 기한 후' else '' end);
  return jsonb_build_object('ok', true, 'state', v_state, 'late', v_late, 'checkId', cid, 'name', e.name, 'by', me.name, 'at', public.ws_kst(at));
end $$;

-- ---------------------------------------------------------------------------
-- QR 관리 v2 (결정 228): 위치 이름 고치기(QR은 그대로) · 라벨 인쇄 표시 — 소화기(fe)·소화전(hyd)·공기호흡기(air) 공통
-- ---------------------------------------------------------------------------
create or replace function public.ws_qr_rename(p_token text, p_kind text, p_floor text, p_old text, p_new text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_kind text := coalesce(p_kind, '');
  v_new text := public.ws_clean(p_new, 30);
  n int := 0;
begin
  if v_kind not in ('fe', 'hyd', 'air') then return jsonb_build_object('ok', false, 'error', '종류를 골라 주세요.'); end if;
  if v_new = '' then return jsonb_build_object('ok', false, 'error', '위치를 적어 주세요.'); end if;
  perform pg_advisory_xact_lock(hashtext(case when v_kind = 'fe' then 'ws_fe' else 'ws_eq' end));
  if v_kind = 'fe' then
    if v_new <> p_old and exists (select 1 from public.fire_ext where active and store_name = v_new) then
      return jsonb_build_object('ok', false, 'error', '같은 이름의 위치가 이미 있습니다. 다른 이름으로 해 주세요.');
    end if;
    with u as (update public.fire_ext set store_name = v_new, name = v_new || '-소화기' || no where active and floor = p_floor and store_name = p_old returning fe_id)
    select count(*) into n from u;
    if n = 0 then return jsonb_build_object('ok', false, 'error', '고칠 것을 찾지 못했습니다. 화면을 새로 고쳐 주세요.'); end if;
    update public.fire_checks c set store_name = f.store_name, fe_name = f.name from public.fire_ext f where c.fe_id = f.fe_id and f.floor = p_floor and f.store_name = v_new;
    perform public.ws_log(me.name, '소화기 위치 이름 고침', '', p_floor || ' · ' || p_old || ' → ' || v_new);
    return public.ws_fe_list_() || jsonb_build_object('count', n);
  end if;
  if v_new <> p_old and exists (select 1 from public.fire_equip where active and kind = v_kind and place = v_new) then
    return jsonb_build_object('ok', false, 'error', '같은 이름의 위치가 이미 있습니다. 다른 이름으로 해 주세요.');
  end if;
  with u as (update public.fire_equip set place = v_new, name = v_new || '-' || public.ws_eq_kind_name(v_kind) || coalesce(no, 0)
             where active and kind = v_kind and floor = p_floor and place = p_old returning eq_id)
  select count(*) into n from u;
  if n = 0 then return jsonb_build_object('ok', false, 'error', '고칠 것을 찾지 못했습니다. 화면을 새로 고쳐 주세요.'); end if;
  update public.fire_equip_checks c set eq_name = e.name from public.fire_equip e where c.eq_id = e.eq_id and e.kind = v_kind and e.floor = p_floor and e.place = v_new;
  perform public.ws_log(me.name, public.ws_eq_kind_name(v_kind) || ' 위치 이름 고침', '', p_floor || ' · ' || p_old || ' → ' || v_new);
  return public.ws_eq_list_(v_kind) || jsonb_build_object('count', n);
end $$;

-- 라벨을 인쇄했다고 표시 (처음 한 번만 기록, 화면의 「미인쇄」 딱지가 사라짐)
create or replace function public.ws_qr_printed(p_token text, p_kind text, p_ids jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_kind text := coalesce(p_kind, '');
  ids text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end));
begin
  if v_kind not in ('fe', 'hyd', 'air') then return jsonb_build_object('ok', false, 'error', '종류를 골라 주세요.'); end if;
  if v_kind = 'fe' then
    update public.fire_ext set printed_at = clock_timestamp() where fe_id = any(ids) and active and printed_at is null;
    return public.ws_fe_list_();
  end if;
  update public.fire_equip set printed_at = clock_timestamp() where eq_id = any(ids) and active and kind = v_kind and printed_at is null;
  return public.ws_eq_list_(v_kind);
end $$;

-- ---------------------------------------------------------------------------
-- 권한: 도우미는 막음 · 로그인 기기용 · 로그인 안 한 QR 표(ws_eq_pub)만 비로그인도
-- ---------------------------------------------------------------------------
revoke all on function public.ws_eq_kind_name(text), public.ws_eq_spec(text), public.ws_eq_by_qr(text), public.ws_mask_name(text), public.ws_eq_list_(text),
  public.ws_eq_list(text, text), public.ws_eq_add(text, jsonb), public.ws_eq_delete(text, jsonb, text), public.ws_eq_status_(text), public.ws_eq_status(text, text),
  public.ws_eq_detail(text, text), public.ws_eq_open(text, text), public.ws_eq_pub(text), public.ws_eq_file(text, jsonb), public.ws_eq_submit(text, text, jsonb, jsonb),
  public.ws_qr_rename(text, text, text, text, text), public.ws_qr_printed(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ws_eq_list(text, text), public.ws_eq_add(text, jsonb), public.ws_eq_delete(text, jsonb, text), public.ws_eq_status(text, text),
  public.ws_eq_detail(text, text), public.ws_eq_open(text, text), public.ws_eq_submit(text, text, jsonb, jsonb),
  public.ws_qr_rename(text, text, text, text, text), public.ws_qr_printed(text, text, jsonb) to authenticated;
grant execute on function public.ws_eq_pub(text) to anon, authenticated;
