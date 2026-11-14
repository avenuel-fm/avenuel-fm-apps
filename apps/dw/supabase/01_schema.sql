-- ============================================================================
-- 도면협의(DW) → Supabase 이관 1: 표 · 보안 · 파일 버킷   【업무지원과 같은 Supabase 프로젝트, 표 이름은 dw_ 로 시작】
-- 기준: apps/dw/src/Code.gs v1.8.14 의 시트 탭 (매장 · 검토서 · 준수사항 · 자주쓰는문구 · 비슷한말 · 변경기록 · 삭제보관 · 설정)
-- 실행: Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 돌려도 안전.
-- 설계 설명: docs/설계/DW_Supabase이관.md
--
-- 원칙 (업무지원 이관 결정을 그대로 따름)
--  · 기기마다 시설팀 공용 계정으로 한 번 Supabase 로그인 + 그다음은 지금처럼 소장·부소장 PIN (결정 36 그대로)
--  · 표는 화면이 직접 못 읽고 못 고침 — 모두 02_functions.sql 의 DB 함수(PIN 확인 뒤)로만. (업무지원보다 한 단계 더 막음)
--  · 매장·검토서 내용은 시트 칸 이름 그대로 jsonb(data)에 — 화면이 받던 모양 그대로 돌려주려고
--  · 파일(사진·협의서·PDF·지침)은 dw_files 표 한 곳에. 버킷 dw-files 는 공개(주소를 아는 사람만), 경로는 영문·숫자만
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- 파일 (주 1회 드라이브 옮기기 스크립트가 보는 표)
create table if not exists public.dw_files (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                 -- 'photo' 'firedoc' 'pdf' 'guide_pdf' 'guide_page' (guide_page 는 드라이브로 안 옮김 — 검색 미리보기용)
  file_url      text,                          -- 버킷 공개 주소(옮기기 전) 또는 드라이브 주소(옮긴 뒤)
  storage_path  text,                          -- 버킷 안 경로 (드라이브로 옮기면 비움)
  mime          text,
  file_name     text,                          -- 드라이브에 저장할 이름
  drive_folder  text,                          -- 'photo/문서번호' · 'pdf/문서번호' · 'guide' (앱 폴더 4개 중 하나 + 하위 폴더)
  drive_id      text,
  size_bytes    bigint,
  store_id      text,
  is_archived   boolean not null default false,
  trash         boolean not null default false,   -- 지운 매장·바꾼 협의서·같은 이름 PDF: 주 1회 작업이 버킷·드라이브에서 지우고 줄도 지움
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists dw_files_to_archive on public.dw_files (created_at) where is_archived = false and storage_path is not null and trash = false;
create unique index if not exists dw_files_drive on public.dw_files (drive_id) where drive_id is not null;

create table if not exists public.dw_settings (key text primary key, value text);   -- 바로가기주소 · LAST_SEQ · SIG_EMAILS · PIN_소장 · PIN_부소장 · PIN_FAIL

create table if not exists public.dw_stores (
  id         text primary key,                 -- 매장ID (UUID 글자)
  seq        int  not null,                    -- 일련번호
  data       jsonb not null default '{}',      -- STORE_COLS 의 나머지 칸 (docNo · tenant · status · sendLog …) 모두 글자
  updated_at timestamptz not null default now()
);

create table if not exists public.dw_reviews (
  id         text primary key,                 -- 검토ID
  store_id   text not null references public.dw_stores(id) on delete cascade,
  round      int  not null,
  data       jsonb not null default '{}',      -- 작성상태·저장일시·소장확인 … + FIELDS 전부 (서명 그림 data:image/png 도 그대로)
  saved_at   timestamptz not null default now(),
  unique (store_id, round)
);

create table if not exists public.dw_rules    (seq int primary key, text text not null);
create table if not exists public.dw_phrases  (seq int primary key, t text not null, c text not null default '기타');
create table if not exists public.dw_synonyms (seq int primary key, word text not null, alts text not null default '');

create table if not exists public.dw_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  who      text, action text, store_id text, doc_no text, detail text
);

create table if not exists public.dw_deleted (   -- 삭제보관: 지운 차수 한 줄씩
  id         bigint generated always as identity primary key,
  deleted_at timestamptz not null default now(),
  deleted_by text,
  store_id   text,
  round      int,
  data       jsonb not null
);

-- 원격 서명 일회용 표 (링크의 표는 저장하지 않고 해시만)
create table if not exists public.dw_sign_tokens (
  h        text primary key,
  store_id text not null,
  round    int  not null,
  who      text not null,                      -- safety · sales · resp
  email    text,
  exp      timestamptz not null,
  pdf_url  text,
  by_role  text
);

-- 지침 (검색 색인 · 쪽 이미지 지도)
create table if not exists public.dw_guides (
  id           text primary key,
  ord          int not null default 0,
  title        text not null,
  short        text not null,
  pages        int not null default 0,
  landscape    boolean not null default false,
  local_pages  boolean not null default false,
  file_id      text,                           -- 원본 PDF (dw_files.id, 옮긴 옛 지침은 드라이브 번호)
  file_name    text,
  file_updated text,
  entries      jsonb not null default '[]',    -- 검색 항목 (예전 _검색색인 json)
  n_entries    int not null default 0,
  page_map     jsonb not null default '{}',    -- 쪽 번호 → dw_files.id
  built_at     text, built_by text,
  archived     boolean not null default false, -- 개정판으로 바뀐 이전 판
  archived_at  text
);
create table if not exists public.dw_guide_build (   -- 만들고 있는(끊긴) 색인 작업 한 줄
  one          boolean primary key default true check (one),
  data         jsonb not null
);

-- ============================================================================
-- 보안: 표는 화면(anon·authenticated)이 직접 못 봄. DB 함수(security definer)로만.
--       service_role(관리자 열쇠, 구글 Apps Script 스크립트 속성에만)은 RLS를 건너뜀.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['dw_files','dw_settings','dw_stores','dw_reviews','dw_rules','dw_phrases','dw_synonyms','dw_log',
                           'dw_deleted','dw_sign_tokens','dw_guides','dw_guide_build']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ============================================================================
-- 파일 버킷 dw-files — 공개(주소를 아는 사람은 로그인 없이 봄, 지금 드라이브 「링크가 있는 사람 보기」와 같은 수준)
-- 올리기는 로그인한 기기만. 지우기는 관리자 열쇠(주 1회 옮기기)만.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('dw-files', 'dw-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "dw-files 로그인 보기"   on storage.objects;
drop policy if exists "dw-files 로그인 올리기" on storage.objects;
create policy "dw-files 로그인 보기"   on storage.objects for select to authenticated using (bucket_id = 'dw-files');
create policy "dw-files 로그인 올리기" on storage.objects for insert to authenticated with check (bucket_id = 'dw-files');
