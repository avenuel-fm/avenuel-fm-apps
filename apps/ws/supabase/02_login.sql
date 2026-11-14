-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-1: 로그인 · 서명 · 메인 (DB 함수)   【01_schema_rls.sql 다음에 실행】
-- 지금 Code.gs 의 login · signToday · bootstrap · loginMode_ · pinFailAll_ 을 그대로 옮김.
--  · 기기 등록(공용 계정 Supabase 로그인)은 화면이 하고, 사람 구분은 지금처럼 PIN + 근무일 첫 서명 (결정 56·60, 사용자 11-14)
--  · 「기기 표」(token)는 지금과 같은 모양 'staff_id.만료ms.무작위' — 화면 코드(tokenAlive)를 그대로 쓰려고. 진짜 확인은 ws_sessions 표
--  · 근무일 경계 오전 6시(한국), 표 만료도 다음 오전 6시
--  · 여러 번 돌려도 안전 (create or replace / if not exists)
-- ============================================================================

-- 기기 표 · PIN 잠금 기록 — 화면에서 직접 못 봄(정책 없음), 아래 함수 안에서만
create table if not exists public.ws_sessions (
  token      text primary key,
  staff_id   text not null references public.staff(staff_id) on delete cascade,
  expires_at timestamptz not null,
  device     text,
  created_at timestamptz not null default now()
);
create table if not exists public.ws_pin_guard (
  key        text primary key,              -- 'dev:<기기번호>' 또는 'all'
  n          int not null default 0,        -- 틀린 횟수 (창 안)
  n_until    timestamptz,                   -- 횟수를 세는 창이 끝나는 때
  lock_until timestamptz,                   -- 잠금이 풀리는 때
  locks      int not null default 0,        -- 6시간 안 잠금 횟수 (all만)
  locks_until timestamptz
);
alter table public.ws_sessions  enable row level security;
alter table public.ws_pin_guard enable row level security;
revoke all on public.ws_sessions, public.ws_pin_guard from anon, authenticated;

-- 같은 근무일에 한 사람 서명은 한 줄만 (두 기기에서 동시에 서명해도)
create unique index if not exists signs_one_per_day on public.signs (work_day, staff_id) where not deleted;

-- ---------------------------------------------------------------------------
-- 시간 도우미
-- ---------------------------------------------------------------------------
create or replace function public.ws_work_day(p_now timestamptz default now())
returns date language sql immutable set search_path = public as $$
  select ((p_now at time zone 'Asia/Seoul') - interval '6 hours')::date;
$$;

create or replace function public.ws_next_work_start(p_now timestamptz default now())
returns timestamptz language sql immutable set search_path = public as $$
  select ((public.ws_work_day(p_now) + 1)::timestamp + interval '6 hours') at time zone 'Asia/Seoul';
$$;

create or replace function public.ws_setting(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key;
$$;

create or replace function public.ws_log(p_who text, p_what text, p_id text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.change_log (who, what, target_id, detail) values (p_who, p_what, p_id, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- 출근현황으로 로그인 나누기 (결정 92) — Code.gs atValue_ · loginMode_
--   주간 출근 = 'sign'(PIN + 서명) / 야·A반·A검진·연·법·병가·전반 = 'pin'(PIN만) / 휴·비 = 'block'
--   전날 야간 근무자는 다음 날 오전 9시까지 PIN만. 소장·부소장·총무는 막지 않음(쉬는 날은 PIN만).
--   근무표가 없거나 이름이 없으면 'sign'
-- ---------------------------------------------------------------------------
create or replace function public.ws_at_value(p_name text, p_days jsonb, p_date date)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  fix text;
  raw text;
  hol text;
begin
  -- 그날 고친 값: 마지막 줄 (되돌림이면 없음)
  select new_value into fix from public.roster_changes
   where day = p_date and name = p_name and not deleted
   order by changed_at desc, id desc limit 1;
  if fix is not null then
    if fix = '(되돌림)' then fix := null; else return fix; end if;
  end if;
  raw := coalesce(p_days ->> (extract(day from p_date)::int - 1), '');
  if raw <> '' then return raw; end if;
  select weekday into hol from public.default_holidays where name = p_name;
  if (array['일','월','화','수','목','금','토'])[extract(dow from p_date)::int + 1] = any (string_to_array(coalesce(hol, ''), ',')) then
    return '휴';
  end if;
  return '';
end $$;

create or replace function public.ws_login_mode(p_staff_id text, p_now timestamptz default now())
returns text language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff;
  d date := public.ws_work_day(p_now);
  early boolean := extract(hour from (p_now at time zone 'Asia/Seoul')) < 9;
  v_ym text := to_char(d, 'YYYY-MM');
  mine public.roster;
  prev_row public.roster;
  v text;
begin
  select * into me from public.staff where staff_id = p_staff_id;
  select * into mine from public.roster where ym = v_ym and name = me.name and not deleted order by seq limit 1;
  if not found then return 'sign'; end if;
  v := public.ws_at_value(mine.name, mine.days, d);
  if v = any (array['야','A반','A검진','연','법','병가','전반']) then return 'pin'; end if;
  if not (v = any (array['휴','비'])) then return 'sign'; end if;
  if early then
    select * into prev_row from public.roster where ym = to_char(d - 1, 'YYYY-MM') and name = me.name and not deleted order by seq limit 1;
    if found and public.ws_at_value(prev_row.name, prev_row.days, d - 1) = '야' then return 'pin'; end if;
  end if;
  if me.role in ('소장','부소장')
     or exists (select 1 from public.roster where ym = v_ym and name = me.name and role in ('소장','부소장','총무') and not deleted) then
    return 'pin';
  end if;
  return 'block';
exception when others then
  return 'sign';   -- 근무표가 이상해도 예전 방식으로
end $$;

-- ---------------------------------------------------------------------------
-- 기기 표 확인 — 틀리거나 만료면 'LOGIN' (화면은 이 글자를 보고 PIN 화면으로)
-- ---------------------------------------------------------------------------
create or replace function public.ws_auth(p_token text)
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me public.staff;
begin
  select s.* into me from public.ws_sessions t join public.staff s using (staff_id)
   where t.token = p_token and t.expires_at > now() and s.active;
  if not found then raise exception 'LOGIN'; end if;
  return me;
end $$;

-- 서명 저장 (화면이 ws-files 버킷에 PNG를 올린 뒤 주소·경로를 넘김). 같은 날 이미 있으면 그 줄
create or replace function public.ws_save_sign(me public.staff, p_url text, p_path text, p_via text, p_now timestamptz)
returns public.signs language plpgsql security definer set search_path = public as $$
declare
  d date := public.ws_work_day(p_now);
  row_ public.signs;
  fid uuid;
  seq int;
begin
  if coalesce(p_url, '') = '' or coalesce(p_path, '') !~ '^sign/' then raise exception '서명이 비어 있습니다. 다시 써 주세요.'; end if;
  select * into row_ from public.signs where work_day = d and staff_id = me.staff_id and not deleted;
  if found then return row_; end if;
  insert into public.files (kind, file_url, storage_path, mime, file_name, drive_folder, created_by)
  values ('sign', p_url, p_path, 'image/png', d || '_서명-' || me.name || '.png', '서류작업/서명/' || to_char(d, 'YYYY-MM'), me.name)
  returning id into fid;
  perform pg_advisory_xact_lock(hashtext('ws_sign_' || d));
  select coalesce(max(substring(sign_id from '-(\d+)$')::int), 0) + 1 into seq from public.signs where work_day = d;
  insert into public.signs (sign_id, work_day, staff_id, name, part, sign_file_id, signed_at, via)
  values ('WS-SG-' || to_char(d, 'YYYYMMDD') || '-' || lpad(seq::text, 3, '0'), d, me.staff_id, me.name, me.part, fid, p_now, p_via)
  on conflict do nothing
  returning * into row_;
  if row_.sign_id is null then   -- 동시에 다른 기기가 먼저 저장
    select * into row_ from public.signs where work_day = d and staff_id = me.staff_id and not deleted;
  end if;
  return row_;
end $$;

-- ---------------------------------------------------------------------------
-- 로그인 (Code.gs login): PIN 잠금 → PIN 맞춤 → 출근현황 → 서명 → 기기 표
--   기기마다 5번 틀리면 5분, 기기와 상관없이 10분 안 30번 틀리면 모두 10분(6시간 안 3번째부터 1시간) (결정 74·80)
-- ---------------------------------------------------------------------------
create or replace function public.ws_login(p_pin text, p_device text, p_sign_url text default null, p_sign_path text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  t timestamptz := now();
  dev text := 'dev:' || left(coalesce(nullif(p_device, ''), 'none'), 64);
  g public.ws_pin_guard;
  a public.ws_pin_guard;
  me public.staff;
  mode text;
  sg public.signs;
  tok text;
  n int;
  sec int;
begin
  select * into g from public.ws_pin_guard where key = dev;
  if g.lock_until > t then return jsonb_build_object('ok', false, 'error', '5번 틀려서 이 기기는 5분 동안 입력할 수 없습니다.'); end if;
  select * into a from public.ws_pin_guard where key = 'all';
  if a.lock_until > t then
    return jsonb_build_object('ok', false, 'error', 'PIN이 여러 번 틀려 ' || greatest(1, ceil(extract(epoch from a.lock_until - t) / 60))::int || '분 동안 모든 로그인을 막았습니다. 잠시 뒤 다시 해 주세요.');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'error', 'PIN 4자리를 넣어 주세요.'); end if;

  select * into me from public.staff s
   where s.active and s.pin_hash = encode(extensions.digest(coalesce(s.pin_salt, '') || p_pin, 'sha256'), 'hex') limit 1;

  if not found then
    -- 전체: 10분 창
    insert into public.ws_pin_guard as x (key, n, n_until) values ('all', 1, t + interval '10 minutes')
    on conflict (key) do update set
      n = case when x.n_until > t then x.n + 1 else 1 end,
      n_until = case when x.n_until > t then x.n_until else t + interval '10 minutes' end
    returning x.n into n;
    if n >= 30 then
      select * into a from public.ws_pin_guard where key = 'all';
      a.locks := case when a.locks_until > t then a.locks + 1 else 1 end;
      sec := case when a.locks >= 3 then 3600 else 600 end;
      update public.ws_pin_guard set n = 0, n_until = null, lock_until = t + make_interval(secs => sec),
        locks = a.locks, locks_until = t + interval '6 hours' where key = 'all';
      perform public.ws_log('보안', 'PIN 전체 잠금', '', '10분 안에 ' || n || '번 틀림 · ' || (sec / 60) || '분 잠금 (6시간 안 ' || a.locks || '번째)');
    end if;
    -- 기기: 5분 창
    insert into public.ws_pin_guard as x (key, n, n_until) values (dev, 1, t + interval '5 minutes')
    on conflict (key) do update set
      n = case when x.n_until > t then x.n + 1 else 1 end,
      n_until = case when x.n_until > t then x.n_until else t + interval '5 minutes' end
    returning x.n into n;
    if n >= 5 then
      update public.ws_pin_guard set n = 0, n_until = null, lock_until = t + interval '5 minutes' where key = dev;
      return jsonb_build_object('ok', false, 'error', '5번 틀려서 이 기기는 5분 동안 입력할 수 없습니다.');
    end if;
    return jsonb_build_object('ok', false, 'error', 'PIN이 맞지 않습니다. (' || n || '/5)');
  end if;

  delete from public.ws_pin_guard where key = dev;
  mode := public.ws_login_mode(me.staff_id, t);
  if mode = 'block' then
    perform public.ws_log(me.name, '휴일 접속 막음', me.staff_id, public.ws_work_day(t)::text);
    return jsonb_build_object('ok', false, 'blocked', true, 'error',
      '휴일 접속 불가 — 오늘은 출근현황에 휴무(휴·비)로 되어 있습니다. 출근하셨으면 소장·부소장·총무에게 출근현황을 고쳐 달라고 해 주세요.');
  end if;
  select * into sg from public.signs where work_day = public.ws_work_day(t) and staff_id = me.staff_id and not deleted;
  if not found and mode = 'sign' then
    if p_sign_url is null then
      return jsonb_build_object('ok', false, 'needSign', true, 'name', me.name, 'part', me.part, 'day', public.ws_work_day(t));
    end if;
    sg := public.ws_save_sign(me, p_sign_url, p_sign_path, 'PIN', t);
  end if;
  tok := me.staff_id || '.' || (extract(epoch from public.ws_next_work_start(t)) * 1000)::bigint || '.' || encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.ws_sessions (token, staff_id, expires_at, device) values (tok, me.staff_id, public.ws_next_work_start(t), left(p_device, 64));
  delete from public.ws_sessions where expires_at < t - interval '1 day';   -- 지난 표 정리
  perform public.ws_log(me.name, '로그인', me.staff_id, case when sg.sign_id is not null then '서명 ' || sg.sign_id else '' end);
  return jsonb_build_object('ok', true, 'token', tok,
    'user', jsonb_build_object('staff_id', me.staff_id, 'name', me.name, 'part', me.part, 'role', me.role));
end $$;

-- 기기 표는 있는데 오늘 서명이 없을 때 (Code.gs signToday)
create or replace function public.ws_sign_today(p_token text, p_sign_url text, p_sign_path text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); sg public.signs;
begin
  if exists (select 1 from public.signs where work_day = public.ws_work_day(now()) and staff_id = me.staff_id and not deleted) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  sg := public.ws_save_sign(me, p_sign_url, p_sign_path, '기기 표', now());
  perform public.ws_log(me.name, '오늘 서명', me.staff_id, sg.sign_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ws_logout(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.ws_sessions where token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- 메인 「소화기 n / n대」 (Code.gs buildStatus_ · countStates_ 를 이번 달만)
-- ---------------------------------------------------------------------------
create or replace function public.ws_fire_summary(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k timestamp := p_now at time zone 'Asia/Seoul';
  v_ym text := to_char(k, 'YYYY-MM');
  m_start timestamptz := (date_trunc('month', k)) at time zone 'Asia/Seoul';
  m_end timestamptz := (date_trunc('month', k) + interval '1 month') at time zone 'Asia/Seoul';
  w_start int := coalesce(nullif(public.ws_setting('점검시작일'), '')::int, 1);
  w_end int := coalesce(nullif(public.ws_setting('점검마감일'), '')::int, 5);
  d int := extract(day from k)::int;
  c jsonb;
begin
  with ck as (
    select distinct on (fe_id) fe_id, state from public.fire_checks where ym = v_ym and not deleted order by fe_id, entered_at desc
  ), fe as (
    select f.fe_id, ck.state, (ck.fe_id is not null) as has_check
      from public.fire_ext f left join ck using (fe_id)
     where (f.created_at is null or f.created_at < m_end)
       and (f.active
            or not (f.deleted_at < m_start)
               and not (f.deleted_at < m_end and ck.fe_id is null))
  ), st as (
    select case when has_check then (case when state = '이상있음' then 'bad' else 'ok' end)
                when d <= w_end then 'wait' else 'miss' end as s from fe
  )
  select jsonb_build_object('ok', count(*) filter (where s = 'ok'), 'bad', count(*) filter (where s = 'bad'),
                            'wait', count(*) filter (where s = 'wait'), 'miss', count(*) filter (where s = 'miss'), 'total', count(*))
    into c from st;
  return jsonb_build_object('counts', c, 'window', jsonb_build_object('start', w_start, 'end', w_end), 'day', d, 'ym', v_ym);
end $$;

-- 메인 (Code.gs bootstrap)
create or replace function public.ws_bootstrap(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_work_day(now());
  mode text := public.ws_login_mode(me.staff_id, now());
  ts numeric := nullif(public.ws_setting('알림표시초'), '')::numeric;
begin
  if mode = 'block' then raise exception 'LOGIN'; end if;   -- 그날 휴무로 바뀌었으면 기기 표도 막음
  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object('staff_id', me.staff_id, 'name', me.name, 'part', me.part, 'role', me.role),
    'toastSec', case when ts between 0.5 and 10 then ts else 2.6 end,
    'needSign', mode = 'sign' and not exists (select 1 from public.signs where work_day = d and staff_id = me.staff_id and not deleted),
    'docs', jsonb_build_object('day', d, 'signs', (select count(*) from public.signs where work_day = d and not deleted)),
    'fire', public.ws_fire_summary(now()));
end $$;

-- ---------------------------------------------------------------------------
-- 권한: 로그인한 기기(authenticated)만 부를 수 있음. 도우미 함수는 화면에서 못 부름
-- ---------------------------------------------------------------------------
revoke all on function public.ws_work_day(timestamptz), public.ws_next_work_start(timestamptz), public.ws_setting(text),
  public.ws_log(text, text, text, text), public.ws_at_value(text, jsonb, date), public.ws_login_mode(text, timestamptz),
  public.ws_auth(text), public.ws_save_sign(public.staff, text, text, text, timestamptz), public.ws_fire_summary(timestamptz),
  public.ws_login(text, text, text, text), public.ws_sign_today(text, text, text), public.ws_logout(text), public.ws_bootstrap(text)
  from public, anon, authenticated;
grant execute on function public.ws_login(text, text, text, text), public.ws_sign_today(text, text, text),
  public.ws_logout(text), public.ws_bootstrap(text) to authenticated;

-- 01에서 만든 pin_login 은 ws_login 으로 바뀌어 쓰지 않음
drop function if exists public.pin_login(text);
