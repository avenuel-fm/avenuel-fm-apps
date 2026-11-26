-- ============================================================================
-- 업무지원(WS) 서류작업 › 위험작업신청서 (사진 보관형) — docs/설계/WS_위험작업신청서.md, 결정 236
-- 실행: 15_menu.sql 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전). 15_menu.sql 도 먼저 다시 Run (메뉴 키 docs.risk)
--  · 손으로 쓴 신청서 사진을 찍는 대로 바로 저장 (사진 한 장 = 한 줄). 날짜 태그 · 업체명(직접 입력, 선택) · 위치(버튼, 선택)
--  · 사진 파일은 화면이 버킷 risk_photo/ 에 먼저 올리고 주소·경로만 넘김 (글자가 읽히게 2400px·85% — 일반 사진보다 덜 줄임)
--  · cid = 기기가 사진마다 만든 고유 번호. 응답만 못 받고 다시 보내도 한 번만 저장
--  · 보기·올리기·지우기: 전 직원 (지우기 전 직원으로, 사용자 11-27). 지운 사진은 숨김 처리만 (파일은 그대로) · 누가 지웠는지 변경기록에 남김
-- ============================================================================
create table if not exists public.rw_photos (
  rk_id      text primary key,                 -- WS-RK-YYYYMMDD-###
  photo_day  date not null,                    -- 날짜 태그 (찍은 날, 기본 오늘)
  company    text not null default '',         -- 업체명·매장명 (직접 입력)
  floor      text not null default '',         -- 위치 (B3 … 10F, 외곽) — 비워도 됨
  file_id    uuid references public.files(id),
  cid        text,
  saved_at   timestamptz not null default clock_timestamp(),
  saved_by   text,
  deleted    boolean not null default false
);
create unique index if not exists rw_photos_cid on public.rw_photos (cid) where cid is not null;
create index if not exists rw_photos_day on public.rw_photos (photo_day desc, saved_at) where not deleted;
alter table public.rw_photos enable row level security;   -- 정책 없음 = 표를 직접 못 읽음 (함수로만)

create or replace function public.ws_rw_floors()
returns text[] language sql immutable set search_path = public as $$ select array['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '10F', '외곽']; $$;

create or replace function public.ws_rw_out(r public.rw_photos)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.rk_id, 'day', r.photo_day::text, 'co', r.company, 'floor', r.floor, 'by', coalesce(r.saved_by, ''),
    'at', to_char(r.saved_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), 'src', public.ws_file_url(r.file_id));
$$;

-- 목록: 검색어(날짜·업체명·위치 글자) · 날짜 범위. 둘 다 없으면 최근 60일. 최대 600장
create or replace function public.ws_rw_list(p_token text, p_q text, p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  q text := lower(btrim(coalesce(p_q, '')));
  f date := public.ws_date(p_from);
  t date := public.ws_date(p_to);
begin
  perform public.ws_menu_guard(me.role, 'docs.risk');
  if q = '' and f is null and t is null then f := public.ws_work_day() - 60; end if;
  return jsonb_build_object('ok', true, 'admin', true, 'floors', to_jsonb(public.ws_rw_floors()),
    'list', coalesce((select jsonb_agg(public.ws_rw_out(x) order by x.photo_day desc, x.saved_at) from (
        select * from public.rw_photos p
        where not p.deleted and (f is null or p.photo_day >= f) and (t is null or p.photo_day <= t)
          and (q = '' or p.photo_day::text like '%' || q || '%' or to_char(p.photo_day, 'MM-DD') like '%' || q || '%' or lower(p.company) like '%' || q || '%' or lower(p.floor) like '%' || q || '%')
        order by p.photo_day desc, p.saved_at limit 600) x), '[]'::jsonb));
end $$;

-- 사진 한 장 저장. p_file = { url, path } (버킷 risk_photo/ 에 먼저 올린 것)
create or replace function public.ws_rw_add(p_token text, p_day text, p_co text, p_floor text, p_file jsonb, p_cid text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := coalesce(public.ws_date(p_day), public.ws_work_day());
  co text := public.ws_clean(p_co, 30);
  fl text := case when coalesce(p_floor, '') = any(public.ws_rw_floors()) then p_floor else '' end;
  v_cid text := case when coalesce(p_cid, '') ~ '^[a-z0-9]{8,40}$' then p_cid end;
  r public.rw_photos;
  fid uuid;
  v_id text;
  n int;
begin
  perform public.ws_menu_guard(me.role, 'docs.risk');
  if d < public.ws_work_day() - 3650 or d > public.ws_work_day() + 1 then return jsonb_build_object('ok', false, 'error', '날짜가 올바르지 않습니다.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_risk'));
  if v_cid is not null then
    select * into r from public.rw_photos where cid = v_cid;
    if r.rk_id is not null then return jsonb_build_object('ok', true, 'dup', true, 'item', public.ws_rw_out(r)); end if;
  end if;
  if (select count(*) from public.rw_photos where saved_by = me.name and saved_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'error', '하루에 저장할 수 있는 사진 수를 넘었습니다.');
  end if;
  select count(*) + 1 into n from public.rw_photos where photo_day = d;
  fid := public.ws_add_file('risk_photo', p_file, 'image/jpeg', d || '_위험작업신청서-' || coalesce(nullif(public.ws_safe_name(co), ''), '업체미입력') || '_' || lpad(n::text, 3, '0') || '.jpg',
                            '서류작업/위험작업신청서/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM'), me.name);
  v_id := public.ws_next_id('RK', array(select rk_id from public.rw_photos));
  insert into public.rw_photos (rk_id, photo_day, company, floor, file_id, cid, saved_by) values (v_id, d, co, fl, fid, v_cid, me.name) returning * into r;
  return jsonb_build_object('ok', true, 'item', public.ws_rw_out(r));
end $$;

-- 지우기 (전 직원, 사용자 11-27). 숨김 처리
create or replace function public.ws_rw_delete(p_token text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.rw_photos;
begin
  perform public.ws_menu_guard(me.role, 'docs.risk');
  update public.rw_photos set deleted = true where rk_id = p_id and not deleted returning * into r;
  if r.rk_id is null then return jsonb_build_object('ok', false, 'error', '사진을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  perform public.ws_log(me.name, '위험작업신청서 사진 삭제', p_id, r.photo_day || ' · ' || r.company);
  return jsonb_build_object('ok', true);
end $$;

-- 권한: 도우미는 막음. 로그인 기기만 3개
revoke all on function public.ws_rw_floors(), public.ws_rw_out(public.rw_photos), public.ws_rw_list(text, text, text, text),
  public.ws_rw_add(text, text, text, text, jsonb, text), public.ws_rw_delete(text, text) from public, anon, authenticated;
grant execute on function public.ws_rw_list(text, text, text, text), public.ws_rw_add(text, text, text, text, jsonb, text), public.ws_rw_delete(text, text) to authenticated;
