-- ============================================================================
-- 업무지원(WS) → Supabase 이관 1단계: 표(테이블) 만들기 + 보안(RLS) + PIN 로그인 + 파일 버킷   【초안 · 아직 실행하지 않음】
-- 기준: apps/ws/src/Code.gs v0.9.14 의 SHEETS·LOG_COLS (시트 탭 18개 → 표 19개)
-- 실행: Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 돌려도 안전하게 IF NOT EXISTS 사용.
-- 설계 설명: docs/설계/WS_Supabase이관.md
--
-- 원칙
--  · 파일(사진·서명·PDF·엑셀)은 모두 files 표 한 곳에 모음 → 각 업무 표는 files.id 만 가리킴.
--    주 1회 드라이브 이관 스크립트는 files 표 하나만 보면 됨 (file_url · is_archived).
--  · 시트는 모든 값을 글자로 저장했지만(결정 54) DB는 날짜·숫자·참/거짓을 제 형식으로. 옮기는 스크립트가 바꿔 넣음.
--  · 지우기는 지금처럼 「삭제여부」 표시(deleted = true)로 — 실제로 지우지 않음.
--  · 비로그인(anon)은 아무것도 못 함. 로그인한 사용자(authenticated)만 읽기·쓰기.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 파일 (사진·서명·PDF·엑셀) — 이관 스크립트가 보는 유일한 표
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                 -- 'sign' 'fire_photo' 'fire_memo' 'fire_name' 'tbm_meet' 'tbm_chant' 'tbm_pdf' 'cs_photo' 'cs_pdf' 'log_night' 'log_pdf' 'roster_xlsx'
  file_url      text,                          -- Supabase Storage 경로(이관 전) 또는 구글 드라이브 주소(이관 후)
  storage_path  text,                          -- 버킷 안 경로 (이관 뒤 지울 원본). 이관 끝나면 null
  mime          text,
  file_name     text,                          -- 드라이브에 저장할 이름 (예: 2026-11-13_TBM.pdf, 결정: 사진 이름 규칙)
  drive_folder  text,                          -- 드라이브 폴더 경로 (예: 서류작업/TBM/2026/2026-11)
  drive_id      text,
  size_bytes    bigint,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists files_to_archive on public.files (created_at) where is_archived = false and file_url is not null;

-- ---------------------------------------------------------------------------
-- 1. 설정 · 직원 · 변경기록
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key   text primary key,
  value text,
  note  text
);

create table if not exists public.staff (
  staff_id     text primary key,               -- S001 …
  name         text not null,
  part         text,                           -- 파트명 (전방파트·기건파트 …)
  role         text not null check (role in ('소장','부소장','파트장','직원','관리자')),
  auth_user_id uuid unique references auth.users(id) on delete set null,   -- (쓰지 않을 수 있음: 공용 계정 + PIN 방식)
  pin_hash     text,                           -- PIN 로그인 (결정 11-14). 화면에는 안 보이고 pin_login() 안에서만 씀
  pin_salt     text,
  active       boolean not null default true,  -- 사용여부
  updated_at   timestamptz not null default now()
);

create table if not exists public.change_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  who       text,
  what      text,
  target_id text,
  detail    text
);

-- ---------------------------------------------------------------------------
-- 2. 서명 (근무일 첫 로그인 서명, 결정 56·60)
-- ---------------------------------------------------------------------------
create table if not exists public.signs (
  sign_id      text primary key,
  work_day     date not null,                  -- 근무일 (오전 6시 경계)
  staff_id     text references public.staff(staff_id),
  name         text,
  part         text,
  sign_file_id uuid references public.files(id),
  signed_at    timestamptz not null,
  via          text,                           -- 들어온길
  tbm_used     boolean not null default false,
  deleted      boolean not null default false
);
create index if not exists signs_day on public.signs (work_day) where not deleted;

-- ---------------------------------------------------------------------------
-- 3. 서류작업: 명일 작업 · TBM · 위험성 목록 · 종합업무일지
-- ---------------------------------------------------------------------------
create table if not exists public.next_work (
  work_date date not null,                     -- 일자
  seq       int  not null,                     -- 순번
  dept      text,
  place     text,
  work      text,
  note      text,
  edited_by text,
  edited_at timestamptz,
  primary key (work_date, seq)
);

create table if not exists public.tbm (
  tbm_id        text primary key,              -- WS-TB-YYYYMMDD-001
  work_day      date not null unique,
  author_id     text,
  author_name   text,
  meet_file_id  uuid references public.files(id),
  chant_file_id uuid references public.files(id),
  works         jsonb not null default '[]',   -- 작업표
  checks        jsonb not null default '{}',   -- 체크칸
  sign_count    int not null default 0,
  pdf_file_id   uuid references public.files(id),
  pdf_at        timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted       boolean not null default false
);

create table if not exists public.risk_list (
  seq        int primary key,
  words      text,                             -- 낱말 (쉼표로)
  risk       text,
  kind       text,                             -- 재해형태
  likelihood int,
  severity   int,
  fix1 text, fix2 text, fix3 text, fix4 text,
  active     boolean not null default true
);

-- 종합업무일지: 지금은 따로 떨어진 스프레드시트 「일지」 탭 (LOG_COLS)
create table if not exists public.daily_log (
  log_date        date primary key,            -- 일자
  business_hours  numeric,                     -- 영업시간
  weather         text,
  t_min           numeric,
  t_max           numeric,
  wind_max        numeric,
  pm              numeric,                     -- 미세먼지
  pm_grade        text,
  weather_source  text,
  -- 검침 (LOG_METERS)
  m_city_water    numeric,                     -- 시수
  m_grey_water    numeric,                     -- 중수
  m_food_water    numeric,                     -- 식당시수
  m_food_hot      numeric,                     -- 식당온수
  m_food_gas      numeric,                     -- 식당가스
  m_food_panel    numeric,                     -- 식당분전반
  m_dish_panel    numeric,                     -- 식기세척분전반
  m_shop_panel    numeric,                     -- 매점분전반
  m_hot_supply    numeric,                     -- 급탕
  m_hot_return    numeric,                     -- 환탕
  m_hot_tank      numeric,                     -- 급탕탱크
  electricity     numeric,                     -- 전기
  work_elec       jsonb not null default '[]', -- 작업_전기방재
  work_mech       jsonb not null default '[]', -- 작업_기계건축
  night_file_id   uuid references public.files(id),
  pdf_file_id     uuid references public.files(id),
  pdf_at          timestamptz,
  author          text,
  editor          text,
  updated_at      timestamptz,
  deleted         boolean not null default false,
  note            text                         -- 비고 (화면에서 뺐지만 옛 값 보관, 결정 120)
);

-- ---------------------------------------------------------------------------
-- 4. 출근현황: 근무표 · 근무변경 · 기본휴일
-- ---------------------------------------------------------------------------
create table if not exists public.roster (
  ym          text not null,                   -- 월 'YYYY-MM'
  seq         int  not null,
  section     text,                            -- 구역
  role        text,                            -- 직책
  name        text,
  days        jsonb not null default '[]',     -- 일별
  xlsx_file_id uuid references public.files(id),
  uploaded_by text,
  uploaded_at timestamptz,
  deleted     boolean not null default false,
  primary key (ym, seq)
);

create table if not exists public.roster_changes (
  id         bigint generated always as identity primary key,
  day        date not null,
  name       text not null,
  old_value  text,
  new_value  text,
  changed_by text,
  changed_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.default_holidays (
  name       text primary key,
  weekday    text,
  changed_by text,
  changed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 5. 점검: 소화기 · 전열필증 · 공사장 점검
-- ---------------------------------------------------------------------------
create table if not exists public.fire_ext (
  fe_id      text primary key,
  floor      text,
  store_name text,
  store_id   text,
  no         text,
  name       text,
  qr_token   text unique,                      -- 12자리 고유번호 (QR ?fe=)
  active     boolean not null default true,
  created_at timestamptz,
  created_by text,
  deleted_at timestamptz
);

create table if not exists public.fire_checks (
  check_id        text primary key,
  ym              text not null,               -- 연월
  fe_id           text references public.fire_ext(fe_id),
  floor           text,
  store_name      text,
  fe_name         text,
  state           text,
  photo_file_id   uuid references public.files(id),
  memo_file_id    uuid references public.files(id),   -- 문구 손글씨
  name_file_id    uuid references public.files(id),   -- 이름 손글씨
  entered_at      timestamptz,
  late            boolean not null default false,     -- 기한후입력
  overwrite_count int not null default 0,
  deleted         boolean not null default false
);
create index if not exists fire_checks_ym on public.fire_checks (ym) where not deleted;

create table if not exists public.eh_stores (
  es_id      text primary key,
  floor      text,
  store_no   text,
  store_name text,
  active     boolean not null default true,
  created_at timestamptz,
  created_by text,
  deleted_at timestamptz
);

create table if not exists public.eh_devices (
  eh_id        text primary key,
  es_id        text references public.eh_stores(es_id),
  floor        text,
  store_name   text,
  mgmt_no      text,                           -- 관리번호
  device_name  text,
  watts        numeric,                        -- 용량W
  maker        text,
  owner_main   text,                           -- 책임자정
  owner_sub    text,                           -- 책임자부
  approved_on  date,                           -- 승인일자
  qr_token     text unique,
  printed_at   timestamptz,
  active       boolean not null default true,
  created_at   timestamptz,
  created_by   text,
  updated_at   timestamptz,
  deleted_at   timestamptz
);

create table if not exists public.cs_sites (
  cs_id      text primary key,
  name       text not null,                    -- 현장명
  work       text,                             -- 공사내용
  company    text,                             -- 업체
  active     boolean not null default true,
  created_at timestamptz,
  created_by text,
  ended_at   timestamptz
);

create table if not exists public.cs_items (
  seq        int primary key,
  item       text not null,
  descr      text,
  active     boolean not null default true,
  in_check   boolean not null default false,   -- 점검사용 (결정 112)
  changed_by text,
  changed_at timestamptz
);

create table if not exists public.cs_checks (
  ck_id        text primary key,
  check_day    date not null,                  -- 점검일
  cs_id        text references public.cs_sites(cs_id),
  site_name    text,
  work         text,
  company      text,
  checker_id   text,
  checker      text,
  checked_at   timestamptz,
  items        jsonb not null default '[]',    -- 항목 (항목별 결과·사진 — 사진은 files.id 를 담음)
  n_good       int, n_bad int, n_na int,       -- 양호·미흡·해당없음 개수
  photo_seq    int not null default 0,         -- 사진번호 (마지막으로 쓴 사진 순번, 파일 이름 _001 … 용)
  pdf_file_id  uuid references public.files(id),
  pdf_at       timestamptz,
  updated_at   timestamptz,
  edited_by    text,
  deleted      boolean not null default false,
  round        int not null default 1          -- 회차 (1 오후점검, 2 퇴실점검, 결정 112)
);
create index if not exists cs_checks_day on public.cs_checks (check_day) where not deleted;

-- ============================================================================
-- 6. 보안(RLS): 비로그인 차단, 로그인한 사용자만 모든 작업
--    · auth.role() 대신 Supabase 권장 방식인 「to authenticated」 로 같은 뜻을 씀
--    · service_role 키(이관·마이그레이션 스크립트)는 RLS를 건너뜀 — 그 키는 Apps Script 속성에만 둠
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['files','settings','staff','change_log','signs','next_work','tbm','risk_list','daily_log',
                           'roster','roster_changes','default_holidays','fire_ext','fire_checks','eh_stores','eh_devices',
                           'cs_sites','cs_items','cs_checks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "로그인 사용자 읽기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 넣기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 고치기" on public.%I', t);
    execute format('drop policy if exists "로그인 사용자 지우기" on public.%I', t);
    execute format('create policy "로그인 사용자 읽기"   on public.%I for select to authenticated using (true)', t);
    execute format('create policy "로그인 사용자 넣기"   on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "로그인 사용자 고치기" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "로그인 사용자 지우기" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- 직원 표의 PIN 해시는 로그인 사용자에게도 보이지 않게 (4자리라 해시가 보이면 금방 풀림)
-- (표 전체 권한이 있으면 칸 하나만 막는 것이 안 먹으므로, 표 권한을 걷고 보일 칸만 다시 줌)
revoke select on public.staff from authenticated;
grant select (staff_id, name, part, role, auth_user_id, active, updated_at) on public.staff to authenticated;

-- ============================================================================
-- 7. PIN 로그인 (사용자 결정 11-14: 기기마다 시설팀 공용 계정으로 한 번 Supabase 로그인 + 지금처럼 PIN·서명)
--    PIN 해시는 화면에 내려보내지 않고, DB 안에서만 맞춰 봄 (지금 Code.gs hashPin_ 과 같은 SHA-256(salt + PIN))
--    PIN 잠금(30번/10분, 결정 74·80)·근무일 서명 확인은 3단계에서 이 함수에 더함
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

create or replace function public.pin_login(p_pin text)
returns table (staff_id text, name text, part text, role text)
language sql
security definer
set search_path = public, extensions
as $$
  select s.staff_id, s.name, s.part, s.role
  from public.staff s
  where s.active
    and p_pin ~ '^[0-9]{4}$'
    and s.pin_hash = encode(extensions.digest(coalesce(s.pin_salt, '') || p_pin, 'sha256'), 'hex')
  limit 1;
$$;
revoke all on function public.pin_login(text) from public, anon;
grant execute on function public.pin_login(text) to authenticated;

-- ============================================================================
-- 8. 파일 버킷 (Storage) — 사용자 결정 11-14: 공개(public)
--    공개 버킷은 주소를 아는 사람은 로그인 없이 볼 수 있음 (지금 드라이브 PDF 「링크가 있는 사람 보기」와 같은 수준).
--    올리기·고치기·지우기는 로그인한 사용자만. 주소는 무작위 이름으로 만들어 짐작하기 어렵게 (3단계).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('ws-files', 'ws-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "ws-files 로그인 보기"   on storage.objects;
drop policy if exists "ws-files 로그인 올리기" on storage.objects;
drop policy if exists "ws-files 로그인 고치기" on storage.objects;
drop policy if exists "ws-files 로그인 지우기" on storage.objects;
create policy "ws-files 로그인 보기"   on storage.objects for select to authenticated using (bucket_id = 'ws-files');   -- 목록 보기용 (공개 주소 열기는 이것과 상관없음)
create policy "ws-files 로그인 올리기" on storage.objects for insert to authenticated with check (bucket_id = 'ws-files');
create policy "ws-files 로그인 고치기" on storage.objects for update to authenticated using (bucket_id = 'ws-files') with check (bucket_id = 'ws-files');
create policy "ws-files 로그인 지우기" on storage.objects for delete to authenticated using (bucket_id = 'ws-files');
