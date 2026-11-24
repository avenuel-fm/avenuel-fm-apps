-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-4 묶음: 소화기 (QR 관리 · 점검 현황 · QR 점검 입력) DB 함수
-- 기준: apps/ws/src/Code.gs v0.9.14 feList · feAdd · feDelete · labelSave · feStatus · feDetail · checkInit · checkSubmit
-- 실행: 01 ~ 04 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.12
--
--  · QR 점검 입력은 매장 직원이 기기 등록 없이 QR만 찍어 씀 (사용자 11-14 「QR 입력만 예외」)
--    → ws_check_init · ws_check_submit 두 함수만 비로그인(anon)도 부를 수 있음. 둘 다 진짜 QR 고유번호(쓰는 중인 소화기)가 있어야 함.
--    → 사진·손글씨도 비로그인이 올릴 수 있게 하되, 경로가 'fire/{쓰는 중인 QR}/YYYY-MM/{무작위}.jpg|png' 일 때만 (8장 정책)
--  · 다른 표·함수는 그대로 로그인 기기만
-- ============================================================================

-- QR 라벨 인쇄 표시 (결정 228): 아직 인쇄하지 않은 것에 「미인쇄」를 보여 주려고. 열을 처음 만들 때 지금까지 등록한 것은 이미 인쇄한 것으로 봄
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fire_ext' and column_name = 'printed_at') then
    alter table public.fire_ext add column printed_at timestamptz;
    update public.fire_ext set printed_at = coalesce(created_at, now()) where printed_at is null;
  end if;
end $$;

-- 설정 숫자 (없거나 틀리면 기본값)
create or replace function public.ws_set_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select case when btrim(value) ~ '^\d+(\.\d+)?$' then btrim(value)::numeric end from public.settings where key = p_key), p_default);
$$;

create or replace function public.ws_set_text(p_key text, p_value text)
returns void language sql security definer set search_path = public as $$
  insert into public.settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
$$;

-- 한국 시각 글자 'YYYY-MM-DD HH:MM:SS' (시트 판 입력일시와 같은 모양)
create or replace function public.ws_kst(p timestamptz)
returns text language sql immutable set search_path = public as $$
  select coalesce(to_char(p at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'), '');
$$;

-- 드라이브 파일 이름에 쓸 수 있게 (Code.gs safeName_)
create or replace function public.ws_safe_name(p text)
returns text language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\s\\/:*?"<>|_#%&{}$!''@+`=.,;\[\]()~^]+', '-', 'g'), '-+', '-', 'g'), '-'), 30);
$$;

-- QR 고유번호 모양 — 12자리(v0.2.2~)와 예전 32자리
create or replace function public.ws_is_qr(p text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p, '') ~ '^([a-f0-9]{32}|[2-9a-km-np-z]{12})$';
$$;

-- 쓰는 중인 소화기 (QR로)
create or replace function public.ws_fe_by_qr(p_qr text)
returns public.fire_ext language sql stable security definer set search_path = public as $$
  select * from public.fire_ext where public.ws_is_qr(p_qr) and qr_token = p_qr and active limit 1;
$$;

-- 층 순서
create or replace function public.ws_floor_no(p text)
returns int language sql immutable set search_path = public as $$
  select coalesce(array_position(array['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F'], p), 99);   -- 층 B3~10F (결정 228)
$$;

-- ---------------------------------------------------------------------------
-- QR 관리 (Code.gs feList · feAdd · feDelete · labelSave)
-- ---------------------------------------------------------------------------
create or replace function public.ws_fe_list_()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', fe_id, 'floor', floor, 'store', store_name, 'no', coalesce(case when no ~ '^\d+$' then no::int end, 0),
                         'name', name, 'token', qr_token, 'created', public.ws_kst(created_at), 'printed', printed_at is not null)
                       order by public.ws_floor_no(floor), store_name collate "C", coalesce(case when no ~ '^\d+$' then no::int end, 0))
                       from public.fire_ext where active), '[]'::jsonb),
    'execUrl', coalesce(regexp_replace(nullif(btrim(public.ws_setting('바로가기주소')), ''), '[?#].*$', ''), ''),   -- 비면 화면 통로가 지금 주소로
    'label', jsonb_build_object('w', public.ws_set_num('라벨가로mm', 50), 'h', public.ws_set_num('라벨세로mm', 50), 'dpi', public.ws_set_num('프린터dpi', 203)));
$$;

create or replace function public.ws_fe_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return public.ws_fe_list_();
end $$;

create or replace function public.ws_fe_add(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_floor text := coalesce(p_d->>'floor', '');
  v_store text := public.ws_clean(p_d->>'store', 30);
  n int;
  max_no int;
  seq int;
  day_key text := to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD');
  tok text;
  added text[] := '{}';
  b bytea;
begin
  -- Code.gs: Number(count) || 1 을 1~20 으로
  n := least(greatest(coalesce(nullif(case when coalesce(p_d->>'count', '') ~ '^\s*\d+(\.\d+)?\s*$' then floor((p_d->>'count')::numeric)::int end, 0), 1), 1), 20);
  if not (v_floor = any (array['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F'])) then return jsonb_build_object('ok', false, 'error', '층을 골라 주세요.'); end if;
  if v_store = '' then return jsonb_build_object('ok', false, 'error', '위치를 적어 주세요.'); end if;   -- 칸 이름은 「위치」 (전: 매장명, 결정 228). 열 이름 store_name 은 그대로
  perform pg_advisory_xact_lock(hashtext('ws_fe'));
  select coalesce(max(case when no ~ '^\d+$' then no::int end), 0) into max_no from public.fire_ext where store_name = v_store;
  select coalesce(max(substring(fe_id from '-(\d+)$')::int), 0) into seq from public.fire_ext where fe_id like 'WS-FE-' || day_key || '-%';
  for i in 1..n loop
    loop   -- 12자리 고유번호 (Code.gs shortToken_ 와 같은 글자 32개)
      b := gen_random_bytes(12);
      tok := (select string_agg(substr('23456789abcdefghijkmnpqrstuvwxyz', (get_byte(b, k) & 31) + 1, 1), '' order by k) from generate_series(0, 11) k);
      exit when not exists (select 1 from public.fire_ext where qr_token = tok);
    end loop;
    insert into public.fire_ext (fe_id, floor, store_name, store_id, no, name, qr_token, active, created_at, created_by)
    values ('WS-FE-' || day_key || '-' || lpad((seq + i)::text, 3, '0'), v_floor, v_store, '', (max_no + i)::text, v_store || '-소화기' || (max_no + i), tok, true, clock_timestamp(), me.name);
    added := added || (v_store || '-소화기' || (max_no + i));
  end loop;
  perform public.ws_log(me.name, '소화기 등록', '', v_floor || ' · ' || array_to_string(added, ', '));
  return public.ws_fe_list_() || jsonb_build_object('added', to_jsonb(added));
end $$;

create or replace function public.ws_fe_delete(p_token text, p_ids jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  ids text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end));
  names text[];
begin
  if cardinality(ids) = 0 then return jsonb_build_object('ok', false, 'error', '지울 소화기를 골라 주세요.'); end if;
  with u as (update public.fire_ext set active = false, deleted_at = clock_timestamp() where fe_id = any(ids) and active returning name)
  select coalesce(array_agg(name), '{}') into names from u;
  perform public.ws_log(me.name, '소화기 삭제', '', array_to_string(names, ', '));
  return public.ws_fe_list_() || jsonb_build_object('count', cardinality(names));
end $$;

create or replace function public.ws_label_save(p_token text, p_w numeric, p_h numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  w numeric := round(coalesce(p_w, 0), 1);
  h numeric := round(coalesce(p_h, 0), 1);
  ow numeric := public.ws_set_num('라벨가로mm', 50);
  oh numeric := public.ws_set_num('라벨세로mm', 50);
  lbl jsonb;
begin
  if not (w between 15 and 100 and h between 15 and 100) then return jsonb_build_object('ok', false, 'error', '라벨 크기는 15~100mm 사이로 넣어 주세요.'); end if;
  if w <> ow or h <> oh then
    perform public.ws_set_text('라벨가로mm', trim_scale(w)::text);
    perform public.ws_set_text('라벨세로mm', trim_scale(h)::text);
    perform public.ws_log(me.name, 'QR 라벨 크기', '', trim_scale(ow) || '×' || trim_scale(oh) || ' → ' || trim_scale(w) || '×' || trim_scale(h) || 'mm');
  end if;
  lbl := public.ws_fe_list_()->'label';
  return jsonb_build_object('ok', true, 'label', lbl);
end $$;

-- ---------------------------------------------------------------------------
-- 점검 현황 (Code.gs feStatus · buildStatus_ · monthList_ · feDetail)
-- ---------------------------------------------------------------------------
create or replace function public.ws_fe_status_(p_ym text)
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
  -- 지운 소화기는 지운 달 앞(지난달까지)에서만 보임 — 지운 달부터는 점검 기록이 있어도 안 보임 (결정 250)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.fe_id, 'floor', f.floor, 'store', f.store_name, 'name', f.name, 'no', coalesce(case when f.no ~ '^\d+$' then f.no::int end, 0),
      'state', case when c.check_id is not null then case when c.state = '이상있음' then 'bad' else 'ok' end
                    when p_ym > cur_ym then 'wait' when p_ym = cur_ym and v_day <= w_end then 'wait' else 'miss' end,
      'checkId', coalesce(c.check_id, ''), 'at', public.ws_kst(c.entered_at), 'late', coalesce(c.late, false))
    order by public.ws_floor_no(f.floor), f.store_name collate "C", coalesce(case when f.no ~ '^\d+$' then f.no::int end, 0)), '[]'::jsonb) into items
  from public.fire_ext f
  left join lateral (select * from public.fire_checks x where x.fe_id = f.fe_id and x.ym = p_ym and not x.deleted order by x.entered_at desc limit 1) c on true
  where coalesce(f.created_at, '-infinity') < m_next
    and (f.active or (f.deleted_at >= m_start and f.deleted_at >= m_next));
  select least(cur_ym, coalesce(min(to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM')), cur_ym)) into first_ym from public.fire_ext;
  return jsonb_build_object('ok', true, 'ym', p_ym, 'curYm', cur_ym, 'day', v_day, 'window', jsonb_build_object('start', w_start, 'end', w_end),
    'isCurrent', p_ym = cur_ym, 'items', items,
    'counts', (select jsonb_build_object('ok', count(*) filter (where e->>'state' = 'ok'), 'bad', count(*) filter (where e->>'state' = 'bad'),
                 'wait', count(*) filter (where e->>'state' = 'wait'), 'miss', count(*) filter (where e->>'state' = 'miss'), 'total', count(*))
               from jsonb_array_elements(items) e),
    'months', (select jsonb_agg(to_char(m, 'YYYY-MM') order by m) from generate_series((first_ym || '-01')::date, (cur_ym || '-01')::date, interval '1 month') m));
end $$;

create or replace function public.ws_fe_status(p_token text, p_ym text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return public.ws_fe_status_(case when coalesce(p_ym, '') ~ '^\d{4}-(0[1-9]|1[0-2])$' then p_ym else to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') end);
end $$;

create or replace function public.ws_fe_detail(p_token text, p_check_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.fire_checks;
begin
  perform public.ws_auth(p_token);
  select * into c from public.fire_checks where check_id = p_check_id and not deleted;
  if c.check_id is null then return jsonb_build_object('ok', false, 'error', '입력 내용을 찾지 못했습니다.'); end if;
  return jsonb_build_object('ok', true, 'name', c.fe_name, 'floor', c.floor, 'ym', c.ym, 'state', c.state, 'at', public.ws_kst(c.entered_at), 'late', c.late,
    'photo', public.ws_file_url(c.photo_file_id), 'signA', public.ws_file_url(c.memo_file_id), 'signB', public.ws_file_url(c.name_file_id));
end $$;

-- ---------------------------------------------------------------------------
-- QR 점검 입력 — 비로그인도 부름 (Code.gs checkInit · checkSubmit)
-- ---------------------------------------------------------------------------
create or replace function public.ws_check_init(p_qr text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f public.fire_ext := public.ws_fe_by_qr(p_qr);
  now_k timestamp := now() at time zone 'Asia/Seoul';
  v_ym text := to_char(now_k, 'YYYY-MM');
  v_day int := extract(day from now_k)::int;
  w_start int := public.ws_set_num('점검시작일', 1)::int;
  w_end int := public.ws_set_num('점검마감일', 5)::int;
begin
  if f.fe_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않았거나 삭제된 QR입니다. 시설팀에 알려 주세요.'); end if;
  return jsonb_build_object('ok', true, 'fe', jsonb_build_object('name', f.name, 'floor', f.floor, 'store', f.store_name),
    'ym', v_ym, 'monthLabel', extract(year from now_k)::int || '년 ' || extract(month from now_k)::int || '월',
    'window', jsonb_build_object('start', w_start, 'end', w_end), 'day', v_day, 'late', v_day > w_end, 'early', v_day < w_start,
    'exists', exists (select 1 from public.fire_checks where fe_id = f.fe_id and ym = v_ym and not deleted),
    'photo', jsonb_build_object('w', public.ws_set_num('사진긴변px', 640), 'q', public.ws_set_num('사진품질', 0.6)));
end $$;

-- 화면이 올린 점검 파일 확인: 'fire/{QR}/YYYY-MM/{무작위}.{ext}' + 우리 버킷 공개 주소
create or replace function public.ws_check_file(p_qr text, p_file jsonb, p_ext text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_file->>'path', '') ~ ('^fire/' || p_qr || '/\d{4}-\d{2}/[a-z0-9]+\.' || p_ext || '$')
     and coalesce(p_file->>'url', '') like '%/object/public/ws-files/' || (p_file->>'path');
$$;

create or replace function public.ws_check_submit(p_qr text, p_d jsonb, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  f public.fire_ext := public.ws_fe_by_qr(p_qr);
  v_state text := case when p_d->>'state' = '이상있음' then '이상있음' else '이상없음' end;
  missing text[] := '{}';
  now_k timestamp := now() at time zone 'Asia/Seoul';
  v_ym text := to_char(now_k, 'YYYY-MM');
  v_late boolean := extract(day from now_k)::int > public.ws_set_num('점검마감일', 5);
  old public.fire_checks;
  base text;
  folder text := '소화기점검/' || to_char(now_k, 'YYYY-MM');
  ids uuid[] := '{}';
  k text;
  fid uuid;
  cid text;
  seq int;
  at timestamptz := clock_timestamp();
begin
  if f.fe_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않았거나 삭제된 QR입니다.'); end if;
  if not public.ws_check_file(p_qr, p_files->'photo', 'jpg') then missing := missing || '압력계 사진'::text; end if;
  if not public.ws_check_file(p_qr, p_files->'memo', 'png') then missing := missing || case when v_state = '이상있음' then '이상 내용 칸' else '외관·압력 이상무 칸' end; end if;
  if not public.ws_check_file(p_qr, p_files->'name', 'png') then missing := missing || '이름 칸'::text; end if;
  if cardinality(missing) > 0 then return jsonb_build_object('ok', false, 'error', array_to_string(missing, ', ') || '이(가) 비어 있습니다.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_fc_' || f.fe_id));
  select * into old from public.fire_checks where fe_id = f.fe_id and ym = v_ym and not deleted order by entered_at desc limit 1;
  if old.check_id is not null and coalesce(p_d->>'overwrite', '') not in ('true', '1') then
    return jsonb_build_object('ok', false, 'exists', true, 'error', '이번 달 입력이 이미 있습니다.');
  end if;
  base := to_char(now_k, 'YYYY-MM-DD') || '_소화기점검-' || public.ws_safe_name(f.name);
  foreach k in array array['photo', 'memo', 'name'] loop
    insert into public.files (kind, file_url, storage_path, mime, file_name, drive_folder, created_by)
    values ('fire_' || k, p_files->k->>'url', p_files->k->>'path', case when k = 'photo' then 'image/jpeg' else 'image/png' end,
            base || case k when 'photo' then '_001.jpg' when 'memo' then '_002.png' else '_003.png' end, folder, '매장 직원(QR)')
    returning id into fid;
    ids := ids || fid;
  end loop;
  if old.check_id is not null then
    cid := old.check_id;
    update public.fire_checks set state = v_state, floor = f.floor, store_name = f.store_name, fe_name = f.name, photo_file_id = ids[1], memo_file_id = ids[2], name_file_id = ids[3],
      entered_at = at, late = v_late, overwrite_count = overwrite_count + 1 where check_id = cid;
  else
    select coalesce(max(substring(check_id from '-(\d+)$')::int), 0) into seq from public.fire_checks where check_id like 'WS-FC-' || to_char(now_k, 'YYYYMMDD') || '-%';
    cid := 'WS-FC-' || to_char(now_k, 'YYYYMMDD') || '-' || lpad((seq + 1)::text, 3, '0');
    insert into public.fire_checks (check_id, ym, fe_id, floor, store_name, fe_name, state, photo_file_id, memo_file_id, name_file_id, entered_at, late)
    values (cid, v_ym, f.fe_id, f.floor, f.store_name, f.name, v_state, ids[1], ids[2], ids[3], at, v_late);
  end if;
  perform public.ws_log('매장 직원(QR)', case when old.check_id is not null then '소화기 점검 다시 입력' else '소화기 점검 입력' end, cid,
                        f.name || ' · ' || v_state || case when v_late then ' · 기한 후' else '' end);
  return jsonb_build_object('ok', true, 'state', v_state, 'late', v_late, 'checkId', cid, 'name', f.name, 'at', public.ws_kst(at));
end $$;

-- ---------------------------------------------------------------------------
-- 8장 더하기: QR 점검 파일은 비로그인도 올릴 수 있음 — 'fire/{쓰는 중인 QR}/YYYY-MM/{영문·숫자}.jpg|png' 만
-- ---------------------------------------------------------------------------
create or replace function public.ws_qr_upload_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_name, '') ~ '^fire/[a-z0-9]{12,32}/\d{4}-\d{2}/[a-z0-9]+\.(jpg|png)$'
     and (public.ws_fe_by_qr(split_part(p_name, '/', 2))).fe_id is not null;
$$;
drop policy if exists "ws-files QR 점검 올리기" on storage.objects;
create policy "ws-files QR 점검 올리기" on storage.objects for insert to anon
  with check (bucket_id = 'ws-files' and public.ws_qr_upload_ok(name));

-- ---------------------------------------------------------------------------
-- 권한: 도우미는 막음. 로그인 기기 6개, QR 점검 2개(+올리기 확인)는 비로그인도
-- ---------------------------------------------------------------------------
revoke all on function public.ws_set_num(text, numeric), public.ws_set_text(text, text), public.ws_kst(timestamptz), public.ws_safe_name(text),
  public.ws_is_qr(text), public.ws_fe_by_qr(text), public.ws_floor_no(text), public.ws_fe_list_(), public.ws_fe_list(text), public.ws_fe_add(text, jsonb),
  public.ws_fe_delete(text, jsonb), public.ws_label_save(text, numeric, numeric), public.ws_fe_status_(text), public.ws_fe_status(text, text),
  public.ws_fe_detail(text, text), public.ws_check_init(text), public.ws_check_file(text, jsonb, text), public.ws_check_submit(text, jsonb, jsonb),
  public.ws_qr_upload_ok(text)
  from public, anon, authenticated;
grant execute on function public.ws_fe_list(text), public.ws_fe_add(text, jsonb), public.ws_fe_delete(text, jsonb), public.ws_label_save(text, numeric, numeric),
  public.ws_fe_status(text, text), public.ws_fe_detail(text, text) to authenticated;
grant execute on function public.ws_check_init(text), public.ws_check_submit(text, jsonb, jsonb), public.ws_qr_upload_ok(text) to anon, authenticated;
