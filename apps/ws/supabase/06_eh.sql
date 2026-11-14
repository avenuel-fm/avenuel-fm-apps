-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-5 묶음 (1): 전열필증 DB 함수
-- 기준: apps/ws/src/Code.gs v0.9.14 ehList · ehStoreSave · ehStoreDelete · ehSave · ehDelete · ehPrinted · ehView_ · ehImport
-- 실행: 01 ~ 05 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.13
--
--  · 필증에 붙은 QR(?eh=)은 지금처럼 로그인 없이 필증 내용을 봄 → ws_eh_view 하나만 비로그인(anon)도 부름 (읽기만)
--  · 엑셀 가져오기는 화면 통로(ws-api.js)가 엑셀을 나눠 읽고(Code.gs ehParse_ 와 같은 규칙) 매장·기기 목록만 넘김
-- ============================================================================

create or replace function public.ws_eh_floors()
returns text[] language sql immutable set search_path = public as $$
  select array['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '팝업'];
$$;

-- 관리번호 '1F-12-3' → 앞부분 '1F-12', 순번 3
create or replace function public.ws_eh_seq(p text)
returns int language sql immutable set search_path = public as $$
  select coalesce((regexp_match(coalesce(p, ''), '^(B[1-3]|[1-6]F|팝업)-(\d+)-(\d+)$'))[3]::int, 0);
$$;

create or replace function public.ws_eh_item(d public.eh_devices)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', d.eh_id, 'no', coalesce(d.mgmt_no, ''), 'name', coalesce(d.device_name, ''), 'w', coalesce(trim_scale(d.watts)::text, ''),
    'maker', coalesce(d.maker, ''), 'm1', coalesce(d.owner_main, ''), 'm2', coalesce(d.owner_sub, ''), 'date', coalesce(d.approved_on::text, ''),
    'printed', public.ws_kst(d.printed_at), 'token', d.qr_token);
$$;

-- 층 하나 + 모든 층 개수 + 검색용 매장 이름 (Code.gs ehOut_)
create or replace function public.ws_eh_out(p_floor text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f text := case when p_floor = any(public.ws_eh_floors()) then p_floor else '1F' end;
begin
  return jsonb_build_object('ok', true, 'floor', f,
    'floors', (select jsonb_agg(jsonb_build_object('code', fl,
                 'stores', (select count(*) from public.eh_stores s where s.active and s.floor = fl),
                 'items', (select count(*) from public.eh_devices d join public.eh_stores s on s.es_id = d.es_id where d.active and s.active and s.floor = fl)) order by o)
               from unnest(public.ws_eh_floors()) with ordinality u(fl, o)),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.es_id, 'no', coalesce(case when s.store_no ~ '^\d+$' then s.store_no::int end, 0), 'name', s.store_name,
                 'items', coalesce((select jsonb_agg(public.ws_eh_item(d) order by regexp_replace(d.mgmt_no, '-\d+$', '') collate "C", public.ws_eh_seq(d.mgmt_no))
                                    from public.eh_devices d where d.es_id = s.es_id and d.active), '[]'::jsonb))
               order by coalesce(case when s.store_no ~ '^\d+$' then s.store_no::int end, 0))
               from public.eh_stores s where s.active and s.floor = f), '[]'::jsonb),
    'names', coalesce((select jsonb_agg(jsonb_build_array(floor, store_name, es_id) order by es_id) from public.eh_stores where active), '[]'::jsonb),
    'empty', not exists (select 1 from public.eh_devices),
    'execUrl', coalesce(regexp_replace(nullif(btrim(public.ws_setting('바로가기주소')), ''), '[?#].*$', ''), ''),   -- 비면 화면 통로가 지금 주소로
    'dpi', public.ws_set_num('프린터dpi', 203));
end $$;

create or replace function public.ws_eh_list(p_token text, p_floor text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return public.ws_eh_out(p_floor);
end $$;

-- 그날 번호 'WS-{kind}-YYYYMMDD-###' 다음 것
create or replace function public.ws_next_id(p_kind text, p_ids text[])
returns text language sql stable set search_path = public as $$
  select 'WS-' || p_kind || '-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' ||
         lpad((coalesce(max(substring(x from '-(\d+)$')::int), 0) + 1)::text, 3, '0')
  from unnest(p_ids) x where x like 'WS-' || p_kind || '-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-%';
$$;

-- 12자리 QR 고유번호 (소화기·전열 둘 다 안 겹치게)
create or replace function public.ws_new_qr()
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare b bytea; tok text;
begin
  loop
    b := gen_random_bytes(12);
    tok := (select string_agg(substr('23456789abcdefghijkmnpqrstuvwxyz', (get_byte(b, k) & 31) + 1, 1), '' order by k) from generate_series(0, 11) k);
    exit when not exists (select 1 from public.eh_devices where qr_token = tok) and not exists (select 1 from public.fire_ext where qr_token = tok);
  end loop;
  return tok;
end $$;

-- 매장 추가·이름 바꾸기. 매장번호 = 그 층에서 쓴 가장 큰 번호 + 1 (지운 매장·기기 번호도 셈)
create or replace function public.ws_eh_store_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_name text := public.ws_clean(p_d->>'name', 30);
  v_id text := coalesce(p_d->>'id', '');
  cur public.eh_stores;
  f text;
  n int;
begin
  if v_name = '' then return jsonb_build_object('ok', false, 'error', '매장명을 넣어 주세요.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_eh'));
  if v_id <> '' then
    select * into cur from public.eh_stores where es_id = v_id and active;
    if cur.es_id is null then return jsonb_build_object('ok', false, 'error', '매장을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  end if;
  f := coalesce(cur.floor, p_d->>'floor', '');
  if not f = any(public.ws_eh_floors()) then return jsonb_build_object('ok', false, 'error', '층을 골라 주세요.'); end if;
  if exists (select 1 from public.eh_stores where active and floor = f and store_name = v_name and es_id is distinct from cur.es_id) then
    return jsonb_build_object('ok', false, 'error', f || '에 「' || v_name || '」 매장이 이미 있습니다.');
  end if;
  if cur.es_id is not null then
    if cur.store_name = v_name then return public.ws_eh_out(f); end if;
    update public.eh_stores set store_name = v_name where es_id = cur.es_id;
    update public.eh_devices set store_name = v_name where es_id = cur.es_id;
    perform public.ws_log(me.name, '전열 매장 이름', cur.es_id, f || ' · ' || v_name);
  else
    select greatest(
      (select coalesce(max(case when store_no ~ '^\d+$' then store_no::int end), 0) from public.eh_stores where floor = f),
      (select coalesce(max((regexp_match(mgmt_no, '^(B[1-3]|[1-6]F|팝업)-(\d+)-(\d+)$'))[2]::int), 0) from public.eh_devices where floor = f)) + 1 into n;
    v_id := public.ws_next_id('ES', array(select es_id from public.eh_stores));
    insert into public.eh_stores (es_id, floor, store_no, store_name, active, created_at, created_by) values (v_id, f, n::text, v_name, true, clock_timestamp(), me.name);
    perform public.ws_log(me.name, '전열 매장 추가', v_id, f || ' · ' || v_name || ' (' || n || ')');
  end if;
  return public.ws_eh_out(f);
end $$;

create or replace function public.ws_eh_store_delete(p_token text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  s public.eh_stores;
  n int;
  t timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('ws_eh'));
  update public.eh_stores set active = false, deleted_at = t where es_id = p_id and active returning * into s;
  if s.es_id is null then return jsonb_build_object('ok', false, 'error', '매장을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  with u as (update public.eh_devices set active = false, deleted_at = t where es_id = p_id and active returning 1) select count(*) into n from u;
  perform public.ws_log(me.name, '전열 매장 삭제', p_id, s.floor || ' · ' || s.store_name || ' · 기기 ' || n || '대');
  return public.ws_eh_out(s.floor) || jsonb_build_object('count', n);
end $$;

-- 기기 추가(관리번호·QR 자동)·편집
create or replace function public.ws_eh_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_name text := public.ws_clean(p_d->>'name', 40);
  v_maker text := public.ws_clean(p_d->>'maker', 40);
  v_m1 text := public.ws_clean(p_d->>'m1', 30);
  v_m2 text := public.ws_clean(p_d->>'m2', 30);
  v_w text := regexp_replace(coalesce(p_d->>'w', ''), '[,\sWw]', '', 'g');
  v_date date := public.ws_date(p_d->>'date');
  r public.eh_devices;
  s public.eh_stores;
  head text;
  seq int;
  v_id text;
  v_no text;
begin
  if v_name = '' then return jsonb_build_object('ok', false, 'error', '기기명을 넣어 주세요.'); end if;
  if v_w !~ '^\d{1,5}(\.\d)?$' or v_w::numeric <= 0 then return jsonb_build_object('ok', false, 'error', '용량은 W 숫자로 넣어 주세요 (예: 1500).'); end if;
  if v_m1 = '' then return jsonb_build_object('ok', false, 'error', '책임자(정)를 넣어 주세요.'); end if;
  if v_date is null then return jsonb_build_object('ok', false, 'error', '승인일자를 골라 주세요.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_eh'));
  if coalesce(p_d->>'id', '') <> '' then
    select * into r from public.eh_devices where eh_id = p_d->>'id' and active;
    if r.eh_id is null then return jsonb_build_object('ok', false, 'error', '기기를 찾지 못했습니다. 새로고침해 주세요.'); end if;
    if (r.device_name, r.maker, r.owner_main, r.owner_sub, r.watts, r.approved_on) is not distinct from (v_name, v_maker, v_m1, v_m2, v_w::numeric, v_date) then
      return public.ws_eh_out(r.floor);
    end if;
    -- 필증에 찍힌 값(책임자정·승인일자·용량)이 바뀌면 다시 인쇄해야 하므로 「미출력」으로
    update public.eh_devices set device_name = v_name, maker = v_maker, owner_main = v_m1, owner_sub = v_m2, watts = v_w::numeric, approved_on = v_date,
      printed_at = case when (owner_main, approved_on, watts) is distinct from (v_m1, v_date, v_w::numeric) then null else printed_at end,
      updated_at = clock_timestamp()
    where eh_id = r.eh_id;
    perform public.ws_log(me.name, '전열기기 편집', r.eh_id, r.mgmt_no || ' · ' || v_name);
    return public.ws_eh_out(r.floor) || jsonb_build_object('saved', r.mgmt_no);
  end if;
  select * into s from public.eh_stores where es_id = p_d->>'esId' and active;
  if s.es_id is null then return jsonb_build_object('ok', false, 'error', '매장을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  head := s.floor || '-' || s.store_no || '-';
  select coalesce(max(public.ws_eh_seq(mgmt_no)), 0) into seq from public.eh_devices where starts_with(mgmt_no, head);
  v_id := public.ws_next_id('EH', array(select eh_id from public.eh_devices));
  v_no := head || (seq + 1);
  insert into public.eh_devices (eh_id, es_id, floor, store_name, mgmt_no, device_name, watts, maker, owner_main, owner_sub, approved_on, qr_token, active, created_at, created_by)
  values (v_id, s.es_id, s.floor, s.store_name, v_no, v_name, v_w::numeric, v_maker, v_m1, v_m2, v_date, public.ws_new_qr(), true, clock_timestamp(), me.name);
  perform public.ws_log(me.name, '전열기기 추가', v_id, v_no || ' · ' || v_name);
  return public.ws_eh_out(s.floor) || jsonb_build_object('saved', v_no);
end $$;

-- 고른 기기: 지우기(붙은 QR은 「삭제된 필증」) · 인쇄함 표시
create or replace function public.ws_eh_bulk_(p_token text, p_ids jsonb, p_floor text, p_del boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  ids text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end));
  nos text[];
  t timestamptz := clock_timestamp();
begin
  if cardinality(ids) = 0 then return jsonb_build_object('ok', false, 'error', '기기를 골라 주세요.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_eh'));
  with u as (update public.eh_devices set active = case when p_del then false else active end, deleted_at = case when p_del then t else deleted_at end,
                                         printed_at = case when p_del then printed_at else t end
             where eh_id = any(ids) and active returning mgmt_no)
  select coalesce(array_agg(mgmt_no), '{}') into nos from u;
  perform public.ws_log(me.name, case when p_del then '전열필증 삭제' else '전열필증 출력' end, '',
                        cardinality(nos) || '대 · ' || array_to_string(nos[1:30], ', ') || case when cardinality(nos) > 30 then ' …' else '' end);
  return public.ws_eh_out(p_floor) || jsonb_build_object('count', cardinality(nos));
end $$;

create or replace function public.ws_eh_delete(p_token text, p_ids jsonb, p_floor text)
returns jsonb language sql volatile security definer set search_path = public as $$ select public.ws_eh_bulk_(p_token, p_ids, p_floor, true); $$;

create or replace function public.ws_eh_printed(p_token text, p_ids jsonb, p_floor text)
returns jsonb language sql volatile security definer set search_path = public as $$ select public.ws_eh_bulk_(p_token, p_ids, p_floor, false); $$;

-- 필증 QR 보기 — 로그인 없음, 읽기만 (Code.gs ehView_)
create or replace function public.ws_eh_view(p_qr text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.eh_devices;
begin
  if not public.ws_is_qr(p_qr) then return jsonb_build_object('ok', false, 'error', '필증 QR 주소가 올바르지 않습니다.'); end if;
  select * into d from public.eh_devices where qr_token = p_qr;
  if d.eh_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않은 필증입니다. 시설팀에 알려 주세요.'); end if;
  if not d.active then return jsonb_build_object('ok', false, 'error', '삭제된 필증입니다. 시설팀에 알려 주세요.', 'no', d.mgmt_no); end if;
  return jsonb_build_object('ok', true, 'item', (public.ws_eh_item(d) - 'token' - 'printed') || jsonb_build_object('floor', d.floor, 'store', d.store_name));
end $$;

-- 엑셀 「전열기 관리대장」 가져오기 (처음 한 번). p_data = { stores: [{floor, no, name}], items: [{floor, store(매장 순번), no, name, w, maker, m1, m2, date, gone}] }
create or replace function public.ws_eh_import(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  st jsonb := case when jsonb_typeof(p_data->'stores') = 'array' then p_data->'stores' else '[]'::jsonb end;
  it jsonb := case when jsonb_typeof(p_data->'items') = 'array' then p_data->'items' else '[]'::jsonb end;
  day_key text := to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD');
  t timestamptz := clock_timestamp();
  x jsonb;
  i int := 0;
  sid text;
  gone boolean;
begin
  if jsonb_array_length(it) = 0 then return jsonb_build_object('ok', false, 'error', '전열기기를 찾지 못했습니다. 「2026년 전열기 관리대장」 엑셀이 맞는지 확인해 주세요.'); end if;
  if jsonb_array_length(st) > 2000 or jsonb_array_length(it) > 10000 then return jsonb_build_object('ok', false, 'error', '엑셀이 너무 큽니다.'); end if;
  if exists (select 1 from jsonb_array_elements(st) s where not (s->>'floor' = any(public.ws_eh_floors())) or coalesce(s->>'no', '') !~ '^\d{1,4}$' or public.ws_clean(s->>'name', 30) = '')
     or exists (select 1 from jsonb_array_elements(it) e where coalesce(e->>'store', '') !~ '^\d+$' or (e->>'store')::int >= jsonb_array_length(st)
                  or coalesce(e->>'no', '') !~ '^(B[1-3]|[1-6]F|팝업)-\d+-\d+$')
     or (select count(distinct e->>'no') from jsonb_array_elements(it) e) <> jsonb_array_length(it) then
    return jsonb_build_object('ok', false, 'error', '엑셀 내용이 올바르지 않습니다. 다시 골라 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_eh'));
  if exists (select 1 from public.eh_devices) or exists (select 1 from public.eh_stores) then
    return jsonb_build_object('ok', false, 'error', '이미 전열기기가 들어 있어 가져오지 않습니다 (처음 한 번만).');
  end if;
  insert into public.eh_stores (es_id, floor, store_no, store_name, active, created_at, created_by)
  select 'WS-ES-' || day_key || '-' || lpad(o::text, 3, '0'), s->>'floor', s->>'no', public.ws_clean(s->>'name', 30), true, t, me.name
  from jsonb_array_elements(st) with ordinality a(s, o);
  for x in select * from jsonb_array_elements(it) loop
    i := i + 1;
    sid := 'WS-ES-' || day_key || '-' || lpad(((x->>'store')::int + 1)::text, 3, '0');
    gone := coalesce(x->>'gone', '') in ('true', '1');
    insert into public.eh_devices (eh_id, es_id, floor, store_name, mgmt_no, device_name, watts, maker, owner_main, owner_sub, approved_on, qr_token, active, created_at, created_by, deleted_at)
    select 'WS-EH-' || day_key || '-' || lpad(i::text, 3, '0'), sid, s.floor, s.store_name, x->>'no', coalesce(nullif(public.ws_clean(x->>'name', 40), ''), '(이름 없음)'),
      case when coalesce(x->>'w', '') ~ '^\d+(\.\d+)?$' then (x->>'w')::numeric end, public.ws_clean(x->>'maker', 40), public.ws_clean(x->>'m1', 30), public.ws_clean(x->>'m2', 30),
      public.ws_date(x->>'date'), public.ws_new_qr(), not gone, t, '엑셀 가져오기', case when gone then t end
    from public.eh_stores s where s.es_id = sid;
  end loop;
  perform public.ws_log(me.name, '전열 관리대장 가져오기', '', '매장 ' || jsonb_array_length(st) || '곳 · 기기 ' || jsonb_array_length(it) || '대');
  return public.ws_eh_out('1F');
end $$;

-- ---------------------------------------------------------------------------
-- 권한: 도우미는 막음. 로그인 기기 7개, 필증 보기 1개는 비로그인도
-- ---------------------------------------------------------------------------
revoke all on function public.ws_eh_floors(), public.ws_eh_seq(text), public.ws_eh_item(public.eh_devices), public.ws_eh_out(text), public.ws_eh_list(text, text),
  public.ws_next_id(text, text[]), public.ws_new_qr(), public.ws_eh_store_save(text, jsonb), public.ws_eh_store_delete(text, text), public.ws_eh_save(text, jsonb),
  public.ws_eh_bulk_(text, jsonb, text, boolean), public.ws_eh_delete(text, jsonb, text), public.ws_eh_printed(text, jsonb, text), public.ws_eh_view(text),
  public.ws_eh_import(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ws_eh_list(text, text), public.ws_eh_store_save(text, jsonb), public.ws_eh_store_delete(text, text), public.ws_eh_save(text, jsonb),
  public.ws_eh_delete(text, jsonb, text), public.ws_eh_printed(text, jsonb, text), public.ws_eh_import(text, jsonb) to authenticated;
grant execute on function public.ws_eh_view(text) to anon, authenticated;
