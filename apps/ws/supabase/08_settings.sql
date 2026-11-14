-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-6 묶음: 환경설정 (직원 관리 · 알림 시간 · 위험성 목록) DB 함수
-- 기준: apps/ws/src/Code.gs v0.9.14 adminStaff · adminSetToast · adminStaffSave · adminStaffPin · adminStaffRemove (결정 102)
-- 실행: 07 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.14
--
--  · 모두 소장만 (Code.gs bossOnly_)
--  · 시트로 하던 일(직원 등록·PIN 바꾸기·위험성 목록 고치기)을 앱 환경설정에서 함 (사용자 결정 11-14)
--  · PIN을 바꾸거나 직원을 지우면 그 직원이 쓰던 기기 표를 바로 지움 (다시 로그인)
-- ============================================================================

create or replace function public.ws_boss(p_token text)
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  if me.role <> '소장' then raise exception '환경설정은 소장만 쓸 수 있습니다.'; end if;
  return me;
end $$;

create or replace function public.ws_staff_out()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', name, 'part', coalesce(part, ''), 'role', role) order by staff_id), '[]'::jsonb)
  from public.staff where active;
$$;

create or replace function public.ws_toast_sec()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select v from (select case when btrim(value) ~ '^\d+(\.\d+)?$' then btrim(value)::numeric end v from public.settings where key = '알림표시초') x
                   where v between 0.5 and 10), 2.6);
$$;

-- PIN 겹침: 다른 사용 중 직원이 같은 PIN이면 true
create or replace function public.ws_pin_taken(p_pin text, p_except text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.staff where active and staff_id is distinct from p_except
                   and pin_hash = encode(extensions.digest(coalesce(pin_salt, '') || p_pin, 'sha256'), 'hex'));
$$;

create or replace function public.ws_admin_staff(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_boss(p_token);
  return jsonb_build_object('ok', true, 'staff', public.ws_staff_out(), 'toastSec', public.ws_toast_sec());
end $$;

create or replace function public.ws_admin_set_toast(p_token text, p_sec numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_boss(p_token);
begin
  if not coalesce(p_sec between 0.5 and 10, false) then return jsonb_build_object('ok', false, 'error', '0.5~10초 사이로 골라 주세요.'); end if;
  perform public.ws_set_text('알림표시초', trim_scale(p_sec)::text);
  perform public.ws_log(me.name, '알림 표시 시간', '', trim_scale(p_sec) || '초');
  return jsonb_build_object('ok', true, 'toastSec', p_sec);
end $$;

-- 직원 추가(staff_id 없음, PIN 필요) · 편집(이름·파트·역할). 내 역할은 못 바꿈
create or replace function public.ws_admin_staff_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  me public.staff := public.ws_boss(p_token);
  v_id text := btrim(coalesce(p_d->>'staff_id', ''));
  v_name text := btrim(coalesce(p_d->>'name', ''));
  v_part text := btrim(coalesce(p_d->>'part', ''));
  v_role text := btrim(coalesce(p_d->>'role', ''));
  v_pin text := btrim(coalesce(p_d->>'pin', ''));
  roles text[] := array['소장', '부소장', '파트장', '직원', '관리자'];
  salt text;
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('ws_staff'));
  if v_id = '' then   -- Code.gs addStaff_
    if v_part = '' then v_part := '전방파트'; end if;
    if v_role = '' then v_role := '직원'; end if;
    if v_name = '' then return jsonb_build_object('ok', false, 'error', '이름을 넣어 주세요.'); end if;
    if v_pin !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'error', 'PIN은 숫자 4자리입니다.'); end if;
    if not v_role = any(roles) then return jsonb_build_object('ok', false, 'error', '역할은 ' || array_to_string(roles, ' / ') || ' 중 하나입니다.'); end if;
    if public.ws_pin_taken(v_pin, null) then return jsonb_build_object('ok', false, 'error', '이 PIN은 다른 직원이 쓰고 있습니다. 휴대폰 번호 앞 4자리(010 다음)를 넣어 주세요.'); end if;
    select coalesce(max(substring(staff_id from '^S(\d+)$')::int), 0) + 1 into n from public.staff;
    v_id := 'S' || lpad(n::text, 3, '0');
    salt := encode(gen_random_bytes(8), 'hex');
    insert into public.staff (staff_id, name, part, role, pin_hash, pin_salt, active, updated_at)
    values (v_id, v_name, v_part, v_role, encode(digest(salt || v_pin, 'sha256'), 'hex'), salt, true, now());
    perform public.ws_log(me.name, '직원 등록', v_id, v_name || ' · ' || v_role);
    return jsonb_build_object('ok', true, 'staff', public.ws_staff_out());
  end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'error', '이름을 넣어 주세요.'); end if;
  if v_part = '' then return jsonb_build_object('ok', false, 'error', '파트를 넣어 주세요.'); end if;
  if v_id = me.staff_id then v_role := me.role; end if;   -- 내 역할은 못 바꿈 (환경설정을 잃지 않게)
  if not v_role = any(roles) then return jsonb_build_object('ok', false, 'error', '역할은 ' || array_to_string(roles, ' / ') || ' 중 하나입니다.'); end if;
  update public.staff set name = left(v_name, 30), part = left(v_part, 30), role = v_role, updated_at = now() where staff_id = v_id and active;
  if not found then return jsonb_build_object('ok', false, 'error', '사용 중인 직원 ' || v_id || '을(를) 찾지 못했습니다.'); end if;
  perform public.ws_log(me.name, '직원 편집', v_id, v_name || ' · ' || v_part || ' · ' || v_role);
  return jsonb_build_object('ok', true, 'staff', public.ws_staff_out());
end $$;

create or replace function public.ws_admin_staff_pin(p_token text, p_staff_id text, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  me public.staff := public.ws_boss(p_token);
  v_pin text := btrim(coalesce(p_pin, ''));
  salt text := encode(gen_random_bytes(8), 'hex');
  v_name text;
begin
  if v_pin !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'error', 'PIN은 숫자 4자리입니다.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_staff'));
  if not exists (select 1 from public.staff where staff_id = p_staff_id and active) then
    return jsonb_build_object('ok', false, 'error', '사용 중인 직원 ' || coalesce(p_staff_id, '') || '을(를) 찾지 못했습니다.');
  end if;
  if public.ws_pin_taken(v_pin, p_staff_id) then return jsonb_build_object('ok', false, 'error', '이 PIN은 다른 직원이 쓰고 있습니다. 휴대폰 번호 앞 4자리(010 다음)를 넣어 주세요.'); end if;
  update public.staff set pin_hash = encode(digest(salt || v_pin, 'sha256'), 'hex'), pin_salt = salt, updated_at = now() where staff_id = p_staff_id returning name into v_name;
  delete from public.ws_sessions where staff_id = p_staff_id;   -- 그 직원 기기는 다시 로그인 (내 PIN이면 화면도 로그아웃함)
  perform public.ws_log(me.name, '직원 PIN 바꿈', p_staff_id, v_name);
  return jsonb_build_object('ok', true, 'staff_id', p_staff_id, 'name', v_name);
end $$;

create or replace function public.ws_admin_staff_remove(p_token text, p_staff_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_boss(p_token);
  s public.staff;
begin
  if p_staff_id = me.staff_id then return jsonb_build_object('ok', false, 'error', '내 계정은 지울 수 없습니다.'); end if;
  update public.staff set active = false, updated_at = now() where staff_id = p_staff_id and active returning * into s;
  if s.staff_id is null then return jsonb_build_object('ok', false, 'error', '사용 중인 직원 ' || coalesce(p_staff_id, '') || '을(를) 찾지 못했습니다.'); end if;
  delete from public.ws_sessions where staff_id = p_staff_id;
  perform public.ws_log(me.name, '직원 삭제', p_staff_id, s.name || ' · ' || s.role);
  return jsonb_build_object('ok', true, 'staff', public.ws_staff_out());
end $$;

-- ---------------------------------------------------------------------------
-- 위험성 목록 (TBM이 낱말로 고르는 표) — 시트 「위험성목록」 탭 편집을 대신함
--   한 줄 = { words: '낱말, 낱말', risk, kind, p(1~3), s(1~3), fixes: [{t, on}] (최대 4) }
-- ---------------------------------------------------------------------------
create or replace function public.ws_risk_rows_()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('words', coalesce(r.words, ''), 'risk', r.risk, 'kind', coalesce(r.kind, ''),
    'p', case when r.likelihood between 1 and 3 then r.likelihood else 1 end, 's', case when r.severity between 1 and 3 then r.severity else 1 end,
    'fixes', (select coalesce(jsonb_agg(jsonb_build_object('t', regexp_replace(btrim(f), '^✓\s*', ''), 'on', btrim(f) ~ '^✓') order by i), '[]'::jsonb)
              from unnest(array[r.fix1, r.fix2, r.fix3, r.fix4]) with ordinality u(f, i) where btrim(coalesce(f, '')) <> '')) order by r.seq), '[]'::jsonb)
  from public.risk_list r where r.active and coalesce(r.risk, '') <> '';
$$;

create or replace function public.ws_risk_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_boss(p_token);
  return jsonb_build_object('ok', true, 'rows', public.ws_risk_rows_());
end $$;

-- 목록 전체를 받아 순서대로 다시 씀 (빈 위험요인 줄은 버림, 최대 200줄)
create or replace function public.ws_risk_save(p_token text, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_boss(p_token);
  n int := case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else -1 end;
  k int;
begin
  if n < 1 or n > 200 then return jsonb_build_object('ok', false, 'error', '위험성 목록은 1~200줄로 해 주세요.'); end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where public.ws_clean(e->>'risk', 100) <> '' and public.ws_clean(e->>'words', 200) = '') then
    return jsonb_build_object('ok', false, 'error', '낱말이 빈 줄이 있습니다. TBM 작업에서 찾을 낱말을 넣어 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_risk'));
  delete from public.risk_list;
  insert into public.risk_list (seq, words, risk, kind, likelihood, severity, fix1, fix2, fix3, fix4, active)
  select row_number() over (order by o), public.ws_clean(e->>'words', 200), public.ws_clean(e->>'risk', 100), public.ws_clean(e->>'kind', 30),
    case when e->>'p' ~ '^[1-3]$' then (e->>'p')::int else 1 end, case when e->>'s' ~ '^[1-3]$' then (e->>'s')::int else 1 end,
    public.ws_risk_fix(e->'fixes', 1), public.ws_risk_fix(e->'fixes', 2), public.ws_risk_fix(e->'fixes', 3), public.ws_risk_fix(e->'fixes', 4), true
  from jsonb_array_elements(p_rows) with ordinality a(e, o) where public.ws_clean(e->>'risk', 100) <> '';
  get diagnostics k = row_count;
  if k = 0 then raise exception '위험요인이 있는 줄이 하나도 없습니다.'; end if;   -- 지운 것을 되돌림
  perform public.ws_log(me.name, '위험성 목록', '', k || '줄');
  return jsonb_build_object('ok', true, 'rows', public.ws_risk_rows_());
end $$;

-- 개선조치 i번째: 빈 칸 버리고 앞으로 당김, ✓ = 미리 체크 (시트와 같은 모양)
create or replace function public.ws_risk_fix(p_fixes jsonb, p_i int)
returns text language sql immutable set search_path = public as $$
  select case when f->>'on' = 'true' then '✓ ' else '' end || public.ws_clean(f->>'t', 100)
  from (select e f, row_number() over (order by o) i from jsonb_array_elements(case when jsonb_typeof(p_fixes) = 'array' then p_fixes else '[]'::jsonb end) with ordinality a(e, o)
        where public.ws_clean(e->>'t', 100) <> '') x where i = p_i;
$$;

-- ---------------------------------------------------------------------------
-- 권한: 도우미는 막음. 로그인 기기 7개 (안에서 소장만)
-- ---------------------------------------------------------------------------
revoke all on function public.ws_boss(text), public.ws_staff_out(), public.ws_toast_sec(), public.ws_pin_taken(text, text), public.ws_admin_staff(text),
  public.ws_admin_set_toast(text, numeric), public.ws_admin_staff_save(text, jsonb), public.ws_admin_staff_pin(text, text, text), public.ws_admin_staff_remove(text, text),
  public.ws_risk_rows_(), public.ws_risk_get(text), public.ws_risk_save(text, jsonb), public.ws_risk_fix(jsonb, int)
  from public, anon, authenticated;
grant execute on function public.ws_admin_staff(text), public.ws_admin_set_toast(text, numeric), public.ws_admin_staff_save(text, jsonb),
  public.ws_admin_staff_pin(text, text, text), public.ws_admin_staff_remove(text, text), public.ws_risk_get(text), public.ws_risk_save(text, jsonb) to authenticated;
