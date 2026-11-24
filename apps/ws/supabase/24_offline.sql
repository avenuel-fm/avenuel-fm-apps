-- ============================================================================
-- 24 · 오프라인 임시 저장 (결정 222, docs/설계/WS_오프라인저장.md)
--  · 기기 보관분을 신호가 돌아온 뒤 다시 보내도 같은 점검·같은 측정이 두 번 들어가지 않게 (client_id)
--  · 입력한 시각(entered_at)으로 달·기한·근무일 판정 → 늦게 전송해도 입력한 달로 기록
--  · 옛 화면이 보내던 모양(client_id·entered_at 없음)도 그대로 동작
-- 올리는 법: Supabase SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 됨)
-- ============================================================================

alter table public.fire_checks add column if not exists client_id text;
create unique index if not exists fire_checks_client_id on public.fire_checks (client_id) where client_id is not null;

-- 한 번에 받을 수 있는 입력 시각: 미래 불가 · 과거 40일 이내, 아니면 서버 시각
create or replace function public.ws_entered_at(p text)
returns timestamptz language plpgsql stable set search_path = public as $$
declare t timestamptz;
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}T' then return now(); end if;
  begin t := p::timestamptz; exception when others then return now(); end;
  if t > now() or t < now() - interval '40 days' then return now(); end if;
  return t;
end $$;
revoke all on function public.ws_entered_at(text) from public, anon, authenticated;

create or replace function public.ws_check_submit(p_qr text, p_d jsonb, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  f public.fire_ext := public.ws_fe_by_qr(p_qr);
  v_state text := case when p_d->>'state' = '이상있음' then '이상있음' else '이상없음' end;
  missing text[] := '{}';
  v_at timestamptz := public.ws_entered_at(p_d->>'entered_at');
  v_cid text := nullif(btrim(coalesce(p_d->>'client_id', '')), '');
  dup public.fire_checks;
  now_k timestamp := v_at at time zone 'Asia/Seoul';
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
  at timestamptz := v_at;
begin
  if f.fe_id is null then return jsonb_build_object('ok', false, 'error', '등록되지 않았거나 삭제된 QR입니다.'); end if;
  if not public.ws_check_file(p_qr, p_files->'photo', 'jpg') then missing := missing || '압력계 사진'::text; end if;
  if not public.ws_check_file(p_qr, p_files->'memo', 'png') then missing := missing || case when v_state = '이상있음' then '이상 내용 칸' else '외관·압력 이상무 칸' end; end if;
  if not public.ws_check_file(p_qr, p_files->'name', 'png') then missing := missing || '이름 칸'::text; end if;
  if cardinality(missing) > 0 then return jsonb_build_object('ok', false, 'error', array_to_string(missing, ', ') || '이(가) 비어 있습니다.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_fc_' || f.fe_id));
  if v_cid is not null then   -- 같은 입력을 다시 보냄(응답만 못 받은 경우) → 새로 만들지 않고 그때 결과
    select * into dup from public.fire_checks where client_id = v_cid;
    if dup.check_id is not null then
      return jsonb_build_object('ok', true, 'state', dup.state, 'late', dup.late, 'checkId', dup.check_id, 'name', dup.fe_name, 'at', public.ws_kst(dup.entered_at), 'again', true);
    end if;
  end if;
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
      entered_at = at, late = v_late, client_id = v_cid, overwrite_count = overwrite_count + 1 where check_id = cid;
  else
    select coalesce(max(substring(check_id from '-(\d+)$')::int), 0) into seq from public.fire_checks where check_id like 'WS-FC-' || to_char(now_k, 'YYYYMMDD') || '-%';
    cid := 'WS-FC-' || to_char(now_k, 'YYYYMMDD') || '-' || lpad((seq + 1)::text, 3, '0');
    insert into public.fire_checks (check_id, ym, fe_id, floor, store_name, fe_name, state, photo_file_id, memo_file_id, name_file_id, entered_at, late, client_id)
    values (cid, v_ym, f.fe_id, f.floor, f.store_name, f.name, v_state, ids[1], ids[2], ids[3], at, v_late, v_cid);
  end if;
  perform public.ws_log('매장 직원(QR)', case when old.check_id is not null then '소화기 점검 다시 입력' else '소화기 점검 입력' end, cid,
                        f.name || ' · ' || v_state || case when v_late then ' · 기한 후' else '' end);
  return jsonb_build_object('ok', true, 'state', v_state, 'late', v_late, 'checkId', cid, 'name', f.name, 'at', public.ws_kst(at));
end $$;

drop function if exists public.ws_usage_save(text, text, text, jsonb);
create or replace function public.ws_usage_save(p_token text, p_kind text, p_day text, p_rows jsonb, p_at text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  v_at timestamptz := public.ws_entered_at(p_at);
  r jsonb; u text; s int; e int; o boolean; nm text; n int := 0;
begin
  if p_kind not in ('hvac', 'curtain') then return jsonb_build_object('ok', false, 'error', '종류가 맞지 않습니다'); end if;
  if d is null or d > public.ws_work_day() or d < public.ws_work_day() - 31 then return jsonb_build_object('ok', false, 'error', '최근 31일 안의 날짜만 고칠 수 있습니다'); end if;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'error', '저장할 내용이 없습니다'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    u := r->>'u';
    nm := case when p_kind = 'hvac' then (select no from public.ahu_unit where no = u and active) else (select key from public.curtain_unit where key = u and active) end;
    if nm is null then return jsonb_build_object('ok', false, 'error', '장비 ' || coalesce(u, '') || '은(는) 목록에 없습니다'); end if;
    o := coalesce((r->>'off')::boolean, false);
    s := case when o or coalesce(r->>'s', '') = '' then null else (r->>'s')::int end;
    e := case when o or coalesce(r->>'e', '') = '' then null else (r->>'e')::int end;
    if (s is null) <> (e is null) then return jsonb_build_object('ok', false, 'error', u || ': 시작과 종료를 둘 다 넣어 주세요'); end if;
    if s is not null and (s < 0 or s > 1439 or e > 1440 or s % 10 <> 0 or e % 10 <> 0) then return jsonb_build_object('ok', false, 'error', u || ': 시각이 맞지 않습니다 (10분 단위)'); end if;
    if s is not null and e <= s then return jsonb_build_object('ok', false, 'error', u || ': 종료가 시작보다 늦어야 합니다'); end if;
    insert into public.equip_usage as x (kind, log_date, unit, start_min, end_min, off, editor, updated_at)
    values (p_kind, d, u, s, e, o, me.name, v_at)
    on conflict (kind, log_date, unit) do update set start_min = excluded.start_min, end_min = excluded.end_min, off = excluded.off,
      editor = excluded.editor, updated_at = excluded.updated_at, src = 'app'
      where x.updated_at <= excluded.updated_at;   -- 더 늦게 입력된 값이 이미 있으면 건너뜀
    n := n + 1;
  end loop;
  perform public.ws_log(me.name, case when p_kind = 'hvac' then '공조기 가동시간 저장' else '에어커튼 가동시간 저장' end, d::text, n || '대');
  return public.ws_usage_data(p_kind, d);
end $$;
grant execute on function public.ws_usage_save(text, text, text, jsonb, text) to authenticated;

drop function if exists public.ws_climate_add(text, jsonb, jsonb);
create or replace function public.ws_climate_add(p_token text, p_rows jsonb, p_out jsonb, p_cid text default null, p_at text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_at timestamptz := public.ws_entered_at(p_at);
  v_cid text := nullif(btrim(coalesce(p_cid, '')), '');
  i int := 0; got int;
  r jsonb; t numeric; h numeric; ot numeric; oh numeric; n int := 0;
  num text := '^-?\d+(\.\d+)?$';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_object('ok', false, 'error', '온도·습도를 넣은 구역이 없습니다'); end if;
  if coalesce(btrim(p_out->>'t'), '') <> '' then
    if btrim(p_out->>'t') !~ num or btrim(p_out->>'t')::numeric not between -30 and 50 then return jsonb_build_object('ok', false, 'error', '실외온도는 -30 ~ 50 숫자로 넣어 주세요'); end if;
    ot := round(btrim(p_out->>'t')::numeric, 1);
  end if;
  if coalesce(btrim(p_out->>'h'), '') <> '' then
    if btrim(p_out->>'h') !~ num or btrim(p_out->>'h')::numeric not between 0 and 100 then return jsonb_build_object('ok', false, 'error', '실외습도는 0 ~ 100 숫자로 넣어 주세요'); end if;
    oh := round(btrim(p_out->>'h')::numeric);
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if not exists (select 1 from public.climate_zone where floor = r->>'floor' and zone = r->>'zone') then return jsonb_build_object('ok', false, 'error', '측정 위치가 맞지 않습니다'); end if;
    if coalesce(btrim(r->>'t'), '') !~ num or btrim(r->>'t')::numeric not between -10 and 50 then return jsonb_build_object('ok', false, 'error', (r->>'floor') || ' ' || (r->>'zone') || ' 온도는 -10 ~ 50 숫자로 넣어 주세요'); end if;
    if coalesce(btrim(r->>'h'), '') !~ num or btrim(r->>'h')::numeric not between 0 and 100 then return jsonb_build_object('ok', false, 'error', (r->>'floor') || ' ' || (r->>'zone') || ' 습도는 0 ~ 100 숫자로 넣어 주세요'); end if;
    t := round(btrim(r->>'t')::numeric, 1); h := round(btrim(r->>'h')::numeric);
    i := i + 1;
    insert into public.climate_record (id, log_date, measured_at, floor, zone, t, h, di, out_t, out_h, author)
    values (case when v_cid is null then gen_random_uuid()::text else v_cid || '-' || i end, public.ws_work_day(v_at), v_at, r->>'floor', r->>'zone', t, h, public.ws_di(t, h), ot, oh, me.name)
    on conflict (id) do nothing;   -- 같은 입력을 다시 보내면 그대로 둠
    get diagnostics got = row_count;
    n := n + got;
  end loop;
  if n > 0 then perform public.ws_log(me.name, '온습도 저장', public.ws_work_day(v_at)::text, n || '곳'); end if;
  return public.ws_climate_get(p_token);
end $$;
grant execute on function public.ws_climate_add(text, jsonb, jsonb, text, text) to authenticated;
