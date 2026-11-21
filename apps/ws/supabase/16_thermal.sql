-- ============================================================================
-- 업무지원(WS) 열화상점검 — FLIR 열화상 보고서 작성기(fm/thermal) 자료 (결정 166·168)
-- 실행: 15 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_열화상점검.md 3장
--
--  · thermal_kv     = 작성기 설정 한 줄씩: model(점 위치 학습 값) · template(양식 .atr 파일 {path,url,name})
--  · thermal_report = 만든 보고서 기록 (파일은 Storage ws-files/thermal/…)
--  · 작성기는 Supabase 에 직접 붙지 않고 업무지원 창의 WS_THERMAL 통로 → 이 함수들 (PIN 로그인 표 ws_auth 로 확인)
--  · 쓰는 사람: 소장·부소장·관리자·옵저버 (결정 166). 직원은 메뉴에서도 못 엶
-- ============================================================================
create table if not exists public.thermal_kv (
  k          text primary key,
  v          jsonb not null,
  editor     text,
  updated_at timestamptz not null default now()
);
create table if not exists public.thermal_report (
  id         bigserial primary key,
  title      text not null,
  inspector  text not null default '',
  insp_date  text not null default '',
  path       text not null,
  url        text not null,
  pages      int  not null default 0,
  max_dt     numeric,
  editor     text,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.thermal_report add column if not exists pdf_path  text not null default '';   -- PDF 저장 (결정 168)
alter table public.thermal_report add column if not exists pdf_url   text not null default '';
alter table public.thermal_report add column if not exists drive_url text not null default '';
alter table public.thermal_report alter column path set default '';
alter table public.thermal_report alter column url  set default '';
create index if not exists thermal_report_at on public.thermal_report (created_at desc);
alter table public.thermal_kv enable row level security;       -- 정책 없음 = 표를 직접 못 읽음 (함수로만)
alter table public.thermal_report enable row level security;

-- 모든 직원이 열고 보고서를 만듦 (결정 212). 모두가 같이 쓰는 양식 파일 바꾸기만 이 역할로 제한
create or replace function public.ws_thermal_can_(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_role in ('소장', '부소장', '관리자', '옵저버'), false);
$$;

-- 처음 열 때 한 번: 나 · 학습 값 · 양식 · 최근 보고서 30개
create or replace function public.ws_thermal_boot(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  return jsonb_build_object('ok', true, 'me', jsonb_build_object('name', me.name, 'role', me.role), 'canTemplate', public.ws_thermal_can_(me.role),
    'model', (select v from public.thermal_kv where k = 'model'),
    'template', (select v from public.thermal_kv where k = 'template'),
    'reports', (select coalesce(jsonb_agg(to_jsonb(r) - 'editor' order by r.created_at desc), '[]'::jsonb)
                from (select id, title, inspector, insp_date, path, url, pdf_path, pdf_url, drive_url, pages, max_dt, editor, created_at
                      from public.thermal_report order by created_at desc limit 30) r));
end $$;

-- 설정 한 칸 저장: model(학습 값) · template(양식 파일)
create or replace function public.ws_thermal_set(p_token text, p_k text, p_v jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  if p_k = 'template' and not public.ws_thermal_can_(me.role) then return jsonb_build_object('ok', false, 'error', '양식 파일은 소장·부소장·관리자·옵저버만 바꿀 수 있습니다'); end if;
  if p_k not in ('model', 'template') then return jsonb_build_object('ok', false, 'error', '저장 칸 이름이 맞지 않습니다'); end if;
  if p_v is null or length(p_v::text) > 2000000 then return jsonb_build_object('ok', false, 'error', '저장할 값이 비었거나 너무 큽니다 (2MB 넘음)'); end if;
  if p_k = 'template' and coalesce(p_v->>'path', '') !~ '^thermal/' then return jsonb_build_object('ok', false, 'error', '양식 파일 경로가 맞지 않습니다'); end if;
  insert into public.thermal_kv (k, v, editor, updated_at) values (p_k, p_v, me.name, clock_timestamp())
  on conflict (k) do update set v = excluded.v, editor = excluded.editor, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end $$;

-- 만든 보고서 기록 한 줄
create or replace function public.ws_thermal_report(p_token text, p_r jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token); nid bigint;
begin
  if coalesce(trim(p_r->>'title'), '') = '' then return jsonb_build_object('ok', false, 'error', '보고서 제목이 없습니다'); end if;
  -- .atr(path·url)이나 PDF(pdf_path·pdf_url) 중 하나는 있어야 함. 경로는 thermal/ 로 시작, 주소는 https
  if not ((coalesce(p_r->>'path', '') ~ '^thermal/' and coalesce(p_r->>'url', '') ~ '^https://')
       or (coalesce(p_r->>'pdf_path', '') ~ '^thermal/' and coalesce(p_r->>'pdf_url', '') ~ '^https://')) then
    return jsonb_build_object('ok', false, 'error', '보고서 파일 경로가 맞지 않습니다');
  end if;
  if coalesce(p_r->>'drive_url', '') <> '' and p_r->>'drive_url' !~ '^https://' then return jsonb_build_object('ok', false, 'error', '드라이브 주소가 맞지 않습니다'); end if;
  insert into public.thermal_report (title, inspector, insp_date, path, url, pdf_path, pdf_url, drive_url, pages, max_dt, editor)
  values (left(trim(p_r->>'title'), 200), left(coalesce(p_r->>'inspector', ''), 50), left(coalesce(p_r->>'date', ''), 20),
          coalesce(p_r->>'path', ''), coalesce(p_r->>'url', ''), coalesce(p_r->>'pdf_path', ''), coalesce(p_r->>'pdf_url', ''), coalesce(p_r->>'drive_url', ''),
          greatest(0, least(500, coalesce((p_r->>'pages')::int, 0))),
          case when coalesce(p_r->>'max_dt', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_r->>'max_dt')::numeric end, me.name)
  returning id into nid;
  perform public.ws_log(me.name, '열화상 보고서', left(trim(p_r->>'title'), 200), coalesce(p_r->>'pages', '0') || '쪽');
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

revoke all on function public.ws_thermal_can_(text), public.ws_thermal_boot(text), public.ws_thermal_set(text, text, jsonb),
  public.ws_thermal_report(text, jsonb) from public, anon, authenticated;
grant execute on function public.ws_thermal_boot(text), public.ws_thermal_set(text, text, jsonb), public.ws_thermal_report(text, jsonb) to authenticated;
