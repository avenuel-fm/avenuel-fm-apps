-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-3 묶음: 출근현황 DB 함수
-- 기준: apps/ws/src/Code.gs v0.9.14 attGet · attPut · attFix · attHoliday (WS_출근현황, 결정 88·92)
-- 실행: 01 · 02 · 03 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.11
--
--  · 그날 값 순서: 그날 고친 값 > 엑셀 값 > 기본 휴일 > 출근 — 02의 ws_at_value 를 그대로 씀 (로그인 나누기와 같은 셈)
--  · 같은 달 엑셀을 다시 올리면 예전 줄은 deleted 표시, 새 줄은 순서 번호를 이어서 (기록이 남음)
--  · 엑셀 원본은 화면이 버킷 roster_xlsx/ 에 올리고 주소만 넘김 (3MB 넘으면 원본 없이 표만)
-- ============================================================================

-- 엑셀 「근무인원합계」와 같은 셈: 출근(빈칸)·9-7·반차·검진 = 주간
create or replace function public.ws_at_is_day(v text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(v, '') in ('', '9-7') or coalesce(v, '') ~ '^[AP](반|검진)$|^[전후]반$';
$$;

-- 소장·부소장·총무: 직원 역할 또는 그 달 엑셀 직책(이름으로). p_rows 를 주면 그 줄들(처음 올리는 엑셀)로 봄
create or replace function public.ws_at_boss(me public.staff, p_ym text, p_rows jsonb default null)
returns boolean language sql stable security definer set search_path = public as $$
  select me.role in ('소장', '부소장')
      or case when p_rows is null
              then exists (select 1 from public.roster where ym = p_ym and not deleted and name = me.name and role in ('소장', '부소장', '총무'))
              else exists (select 1 from jsonb_array_elements(p_rows) e where e->>'name' = me.name and e->>'role' in ('소장', '부소장', '총무')) end;
$$;

-- 그날 고치기: 대표 3명 + 그날이나 전날 야간 근무자 (야간은 아침 8시 30분에 끝나 다음 날 아침 게시판도 그 사람이 맞춤)
create or replace function public.ws_at_can_fix(me public.staff, p_date date)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  mine public.roster;
  pr public.roster;
begin
  if public.ws_at_boss(me, to_char(p_date, 'YYYY-MM')) then return true; end if;
  select * into mine from public.roster where ym = to_char(p_date, 'YYYY-MM') and name = me.name and not deleted order by seq limit 1;
  if mine.ym is null then return false; end if;
  if public.ws_at_value(mine.name, mine.days, p_date) = '야' then return true; end if;
  select * into pr from public.roster where ym = to_char(p_date - 1, 'YYYY-MM') and name = me.name and not deleted order by seq limit 1;
  return pr.ym is not null and public.ws_at_value(pr.name, pr.days, p_date - 1) = '야';
end $$;

-- 그날 출근현황 + 그 달 날짜별 주간 인원(달력) + 권한 (Code.gs attGet)
create or replace function public.ws_att_data(me public.staff, p_date text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d date := case when coalesce(p_date, '') = '' then public.ws_work_day() else public.ws_date(p_date) end;
  v_ym text;
  n int;
  first_ public.roster;
begin
  if d is null then return jsonb_build_object('ok', false, 'error', '날짜 형식이 맞지 않습니다'); end if;
  v_ym := to_char(d, 'YYYY-MM');
  select count(*) into n from public.roster where ym = v_ym and not deleted;
  select * into first_ from public.roster where ym = v_ym and not deleted order by seq limit 1;
  return jsonb_build_object(
    'ok', true, 'date', d, 'today', public.ws_work_day(),
    'months', coalesce((select jsonb_agg(ym order by ym) from (select distinct ym from public.roster where not deleted) m), '[]'::jsonb),
    'ju', case when n = 0 then '[]'::jsonb else (
      select jsonb_agg((select count(*) from public.roster r where r.ym = v_ym and not r.deleted and coalesce(r.name, '') <> ''
                          and public.ws_at_is_day(public.ws_at_value(r.name, r.days, x::date))) order by x)
      from generate_series(date_trunc('month', d), date_trunc('month', d) + interval '1 month - 1 day', interval '1 day') x) end,
    'upBy', coalesce(first_.uploaded_by, ''),
    'upAt', coalesce(to_char(first_.uploaded_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'), ''),
    'canFix', n > 0 and public.ws_at_can_fix(me, d), 'canBoss', public.ws_at_boss(me, v_ym),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'sec', coalesce(r.section, ''), 'role', coalesce(r.role, ''), 'name', coalesce(r.name, ''),
        'v', case when coalesce(r.name, '') <> '' then public.ws_at_value(r.name, r.days, d) else '' end,
        'raw', coalesce(r.days ->> (extract(day from d)::int - 1), ''),
        'fix', (select case when c.new_value <> '(되돌림)' then jsonb_build_object('by', coalesce(c.changed_by, ''),
                       'at', to_char(c.changed_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')) end
                from public.roster_changes c where c.day = d and c.name = r.name and not c.deleted and coalesce(r.name, '') <> ''
                order by c.changed_at desc, c.id desc limit 1),
        'hol', case when coalesce(r.name, '') <> '' then coalesce((select weekday from public.default_holidays h where h.name = r.name), '') else '' end
      ) order by r.seq) from public.roster r where r.ym = v_ym and not r.deleted), '[]'::jsonb));
end $$;

create or replace function public.ws_att_get(p_token text, p_date text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return public.ws_att_data(public.ws_auth(p_token), p_date);
end $$;

-- 엑셀 한 달 저장 (화면에서 읽은 줄). 같은 달 예전 줄은 deleted. 고친 값·기본 휴일은 그대로 (Code.gs attPut)
create or replace function public.ws_att_put(p_token text, p_ym text, p_rows jsonb, p_file jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  last_day int;
  clean jsonb;
  has_cur boolean;
  base int;
  fid uuid;
  at timestamptz := clock_timestamp();
begin
  if coalesce(p_ym, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then return jsonb_build_object('ok', false, 'error', '몇 년 몇 월인지 읽지 못했습니다'); end if;
  last_day := extract(day from (p_ym || '-01')::date + interval '1 month - 1 day')::int;
  select coalesce(jsonb_agg(x order by i), '[]'::jsonb) into clean from (
    select jsonb_build_object('sec', public.ws_clean(e->>'sec', 20), 'role', public.ws_clean(e->>'role', 20), 'name', public.ws_clean(e->>'name', 20),
             'days', (select coalesce(jsonb_agg(public.ws_clean(v, 10) order by k), '[]'::jsonb)
                      from jsonb_array_elements_text(case when jsonb_typeof(e->'days') = 'array' then e->'days' else '[]'::jsonb end) with ordinality u(v, k) where k <= last_day)) x, i
    from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) with ordinality t(e, i)) z
  where x->>'role' <> '' or x->>'name' <> '';
  if jsonb_array_length(clean) = 0 or jsonb_array_length(clean) > 80 then return jsonb_build_object('ok', false, 'error', '직원 줄을 읽지 못했습니다 (엑셀 모양 확인)'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_at_' || p_ym));
  has_cur := exists (select 1 from public.roster where ym = p_ym and not deleted);
  -- 처음 올릴 때는 그 엑셀의 소장·부소장·총무만, 이미 있으면 지금 달의 대표만
  if not public.ws_at_boss(me, p_ym, case when has_cur then null else clean end) then
    return jsonb_build_object('ok', false, 'error', '엑셀은 소장·부소장·총무만 올릴 수 있습니다');
  end if;
  if p_file is not null and jsonb_typeof(p_file) = 'object' then
    fid := public.ws_add_file('roster_xlsx', p_file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                              p_ym || '_근무스케줄.xlsx', '서류작업/출근현황', me.name);
  end if;
  select coalesce(max(seq), 0) into base from public.roster where ym = p_ym;
  update public.roster set deleted = true where ym = p_ym and not deleted;
  insert into public.roster (ym, seq, section, role, name, days, xlsx_file_id, uploaded_by, uploaded_at)
  select p_ym, base + i, e->>'sec', e->>'role', e->>'name', e->'days', fid, me.name, at from jsonb_array_elements(clean) with ordinality t(e, i);
  perform public.ws_log(me.name, '근무표 올림', p_ym, jsonb_array_length(clean) || '줄' || case when fid is not null then ' · 원본 ' || fid else '' end);
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(clean));
end $$;

-- 그날 상태 고치기 — '(되돌림)'이면 엑셀 값으로 (Code.gs attFix)
create or replace function public.ws_att_fix(p_token text, p_date text, p_name text, p_value text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_date);
  p public.roster;
begin
  if d is null then return jsonb_build_object('ok', false, 'error', '날짜 형식이 맞지 않습니다'); end if;
  if not (coalesce(p_value, '-') = any (array['', '9-7', '휴', '연', '법', '야', '비', '병가', 'A반', 'P반', 'A검진', 'P검진', '(되돌림)'])) then
    return jsonb_build_object('ok', false, 'error', '고를 수 없는 상태입니다');
  end if;
  select * into p from public.roster where ym = to_char(d, 'YYYY-MM') and not deleted and coalesce(name, '') <> '' and name = p_name order by seq limit 1;
  if p.ym is null then return jsonb_build_object('ok', false, 'error', '그 달 근무표에 없는 이름입니다'); end if;
  if not public.ws_at_can_fix(me, d) then return jsonb_build_object('ok', false, 'error', '소장·부소장·총무·그날 야간 근무자만 고칠 수 있습니다'); end if;
  insert into public.roster_changes (day, name, old_value, new_value, changed_by, changed_at)
  values (d, p_name, public.ws_at_value(p.name, p.days, d), p_value, me.name, clock_timestamp());
  perform public.ws_log(me.name, '출근현황 고침', d::text, p_name || ' → ' || coalesce(nullif(p_value, ''), '출근'));
  return public.ws_att_data(me, p_date);
end $$;

-- 기본 휴일 (요일 여러 개) — 소장·부소장·총무 (Code.gs attHoliday)
create or replace function public.ws_att_holiday(p_token text, p_name text, p_days jsonb, p_date text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_ym text := coalesce(to_char(public.ws_date(p_date), 'YYYY-MM'), left(coalesce(nullif(p_date, ''), public.ws_work_day()::text), 7));
  list text;
begin
  if not public.ws_at_boss(me, v_ym) then return jsonb_build_object('ok', false, 'error', '기본 휴일은 소장·부소장·총무만 정할 수 있습니다'); end if;
  if not exists (select 1 from public.roster where ym = v_ym and not deleted and coalesce(name, '') <> '' and name = p_name) then
    return jsonb_build_object('ok', false, 'error', '그 달 근무표에 없는 이름입니다');
  end if;
  select coalesce(string_agg(w, ',' order by array_position(array['일', '월', '화', '수', '목', '금', '토'], w)), '') into list
  from (select distinct w from jsonb_array_elements_text(case when jsonb_typeof(p_days) = 'array' then p_days else '[]'::jsonb end) w
        where w = any (array['일', '월', '화', '수', '목', '금', '토'])) z;
  insert into public.default_holidays (name, weekday, changed_by, changed_at) values (p_name, list, me.name, clock_timestamp())
  on conflict (name) do update set weekday = excluded.weekday, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  perform public.ws_log(me.name, '기본 휴일', p_name, coalesce(nullif(list, ''), '없음'));
  return public.ws_att_data(me, coalesce(p_date, ''));
end $$;

-- 권한: 도우미는 막고, 화면이 부르는 4개만 로그인 기기(authenticated)에
revoke all on function public.ws_at_is_day(text), public.ws_at_boss(public.staff, text, jsonb), public.ws_at_can_fix(public.staff, date),
  public.ws_att_data(public.staff, text), public.ws_att_get(text, text), public.ws_att_put(text, text, jsonb, jsonb),
  public.ws_att_fix(text, text, text, text), public.ws_att_holiday(text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.ws_att_get(text, text), public.ws_att_put(text, text, jsonb, jsonb),
  public.ws_att_fix(text, text, text, text), public.ws_att_holiday(text, text, jsonb, text) to authenticated;
