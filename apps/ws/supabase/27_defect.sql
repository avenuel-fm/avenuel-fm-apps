-- ============================================================================
-- 업무지원(WS) 점검 › 하자점검 — docs/설계/WS_하자점검.md, 결정 266
-- 실행: 26_workhist.sql 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전). 15_menu.sql 도 먼저 다시 Run (메뉴 키 inspect.defect)
--  · 하자점검서 1건(dw_defect) = 일자 · 처리 기한(일자 + 10일, 서버가 계산) · 하자 칸 여러 개(현장명 · 하자내용 · 사진 1장) · 서명 2개(현장책임자 · 시설팀)
--  · 사진·서명 파일은 화면이 버킷 dw_photo/ 에 먼저 올리고 주소·경로만 넘김 (파일 표 files 에 적음)
--  · 보기·쓰기·고치기·지우기: 전 직원 (지운 것은 숨김 처리만, 파일은 그대로). PDF 는 화면에서 만듦 (서버 저장 안 함)
-- ============================================================================
create table if not exists public.dw_defect (
  hj_id      text primary key,                 -- WS-HJ-YYYYMMDD-###
  work_day   date not null,
  due_day    date not null,                    -- work_day + 10
  items      jsonb not null default '[]'::jsonb,   -- [{n 현장명, t 하자내용, p 사진 파일 id | null}]
  sign_site  uuid,                             -- 현장책임자 서명 (png)
  sign_fm    uuid,                             -- 시설팀 서명 (png)
  saved_by   text,
  saved_at   timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted    boolean not null default false
);
alter table public.dw_defect add column if not exists pdf_file uuid;            -- 만든 PDF (files 표). 고쳐 저장하면 비움 (결정 270)
alter table public.dw_defect add column if not exists mail_log jsonb not null default '[]'::jsonb;   -- 보낸 메일 [{at,to,by}]
create index if not exists dw_defect_day on public.dw_defect (work_day desc, saved_at) where not deleted;
alter table public.dw_defect enable row level security;   -- 정책 없음 = 표를 직접 못 읽음 (함수로만)

create or replace function public.ws_hj_file(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_id is null then null else jsonb_build_object('id', p_id, 'src', public.ws_file_url(p_id)) end;
$$;

create or replace function public.ws_hj_out(r public.dw_defect)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.hj_id, 'day', r.work_day::text, 'due', r.due_day::text,
    'items', coalesce((select jsonb_agg(jsonb_build_object('n', e->>'n', 't', e->>'t', 'photo', public.ws_hj_file(nullif(e->>'p', '')::uuid)) order by o)
                       from jsonb_array_elements(r.items) with ordinality u(e, o)), '[]'::jsonb),
    'signSite', public.ws_hj_file(r.sign_site), 'signFm', public.ws_hj_file(r.sign_fm),
    'pdf', r.pdf_file is not null, 'mail', case when jsonb_array_length(r.mail_log) > 0 then r.mail_log->(jsonb_array_length(r.mail_log) - 1) else null end,
    'by', coalesce(r.saved_by, ''), 'at', to_char(r.updated_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'));
$$;

-- 목록: 검색어(일자·현장명·하자내용 글자). 비면 최근 60일. 최대 200건
create or replace function public.ws_hj_list(p_token text, p_q text, p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  q text := lower(btrim(coalesce(p_q, '')));
  f date := public.ws_date(p_from);
  t date := public.ws_date(p_to);
begin
  perform public.ws_menu_guard(me.role, 'inspect.defect');
  if q = '' and f is null and t is null then f := public.ws_work_day() - 60; end if;
  return jsonb_build_object('ok', true,
    'list', coalesce((select jsonb_agg(public.ws_hj_out(x) order by x.work_day desc, x.saved_at) from (
        select * from public.dw_defect p
        where not p.deleted and (f is null or p.work_day >= f) and (t is null or p.work_day <= t)
          and (q = '' or p.work_day::text like '%' || q || '%' or lower(p.items::text) like '%' || q || '%')
        order by p.work_day desc, p.saved_at limit 200) x), '[]'::jsonb));
end $$;

-- 저장 (새로 / 고치기). p_d = { id(고칠 때), day, items[{n, t, photo:{id}|{file:{url,path}}|null}], signSite, signFm ({id}|{file}|null, 안 보내면 그대로) } — 하자 칸 40개까지
create or replace function public.ws_hj_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := coalesce(public.ws_date(p_d->>'day'), public.ws_work_day());
  v_id text := nullif(p_d->>'id', '');
  r public.dw_defect;
  src jsonb := case when jsonb_typeof(p_d->'items') = 'array' then p_d->'items' else '[]'::jsonb end;
  old_ids uuid[];
  res jsonb := '[]'::jsonb;
  rec record;
  ph jsonb; nm text; tx text; pid uuid; sa uuid; sf uuid;
  base text; folder text;
  uid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  perform public.ws_menu_guard(me.role, 'inspect.defect');
  if d is null or d < public.ws_work_day() - 3650 or d > public.ws_work_day() + 1 then return jsonb_build_object('ok', false, 'error', '일자가 올바르지 않습니다.'); end if;
  if jsonb_array_length(src) > 40 then return jsonb_build_object('ok', false, 'error', '하자 칸은 40개까지 넣을 수 있습니다.'); end if;
  if not exists (select 1 from jsonb_array_elements(src) e where public.ws_clean(e->>'t', 300) <> '') then
    return jsonb_build_object('ok', false, 'error', '하자내용을 입력해 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_hj'));
  if v_id is not null then
    select * into r from public.dw_defect where hj_id = v_id and not deleted;
    if r.hj_id is null then return jsonb_build_object('ok', false, 'error', '하자점검서를 찾지 못했습니다. 새로고침해 주세요.'); end if;
    old_ids := array(select nullif(e->>'p', '')::uuid from jsonb_array_elements(r.items) e);
  else
    r.hj_id := public.ws_next_id('HJ', array(select hj_id from public.dw_defect));
    old_ids := '{}'::uuid[];
  end if;
  base := d || '_하자점검';
  folder := '점검/하자점검/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM');
  for rec in select x, o from jsonb_array_elements(src) with ordinality u(x, o) loop
    nm := public.ws_clean(rec.x->>'n', 40); tx := public.ws_clean(rec.x->>'t', 300); pid := null; ph := rec.x->'photo';
    if jsonb_typeof(ph) = 'object' then
      if ph ? 'file' then
        pid := public.ws_add_file('dw_photo', ph->'file', 'image/jpeg', base || '_' || lpad(rec.o::text, 3, '0') || '.jpg', folder, me.name);
      elsif coalesce(ph->>'id', '') ~ uid and (ph->>'id')::uuid = any(old_ids) then
        pid := (ph->>'id')::uuid;
      end if;
    end if;
    if nm = '' and tx = '' and pid is null then continue; end if;
    res := res || jsonb_build_array(jsonb_build_object('n', nm, 't', tx, 'p', pid));
  end loop;
  sa := r.sign_site; sf := r.sign_fm;
  if p_d ? 'signSite' then
    sa := null; ph := p_d->'signSite';
    if jsonb_typeof(ph) = 'object' then
      if ph ? 'file' then sa := public.ws_add_file('dw_photo', ph->'file', 'image/png', base || '_현장책임자서명.png', folder, me.name);
      elsif coalesce(ph->>'id', '') ~ uid and (ph->>'id')::uuid = r.sign_site then sa := r.sign_site; end if;
    end if;
  end if;
  if p_d ? 'signFm' then
    sf := null; ph := p_d->'signFm';
    if jsonb_typeof(ph) = 'object' then
      if ph ? 'file' then sf := public.ws_add_file('dw_photo', ph->'file', 'image/png', base || '_시설팀서명.png', folder, me.name);
      elsif coalesce(ph->>'id', '') ~ uid and (ph->>'id')::uuid = r.sign_fm then sf := r.sign_fm; end if;
    end if;
  end if;
  if v_id is null then
    insert into public.dw_defect (hj_id, work_day, due_day, items, sign_site, sign_fm, saved_by)
    values (r.hj_id, d, d + 10, res, sa, sf, me.name) returning * into r;
  else
    update public.dw_defect set work_day = d, due_day = d + 10, items = res, sign_site = sa, sign_fm = sf, pdf_file = null, updated_at = clock_timestamp()
     where hj_id = v_id returning * into r;
  end if;
  perform public.ws_log(me.name, case when v_id is null then '하자점검 저장' else '하자점검 수정' end, r.hj_id, d || ' · ' || jsonb_array_length(res) || '건');
  return jsonb_build_object('ok', true, 'item', public.ws_hj_out(r));
end $$;

create or replace function public.ws_hj_delete(p_token text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.dw_defect;
begin
  perform public.ws_menu_guard(me.role, 'inspect.defect');
  update public.dw_defect set deleted = true, updated_at = clock_timestamp() where hj_id = p_id and not deleted returning * into r;
  if r.hj_id is null then return jsonb_build_object('ok', false, 'error', '하자점검서를 찾지 못했습니다. 새로고침해 주세요.'); end if;
  perform public.ws_log(me.name, '하자점검 삭제', p_id, r.work_day::text);
  return jsonb_build_object('ok', true);
end $$;

-- PDF 기록 (결정 270): 「PDF 생성」 때 화면이 만든 PDF 를 버킷에 올리고 번호만 넘김. 고쳐 저장하면 위 save 가 비움
create or replace function public.ws_hj_pdf(p_token text, p_id text, p_file jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.dw_defect;
  fid uuid;
begin
  perform public.ws_menu_guard(me.role, 'inspect.defect');
  select * into r from public.dw_defect where hj_id = p_id and not deleted;
  if r.hj_id is null then return jsonb_build_object('ok', false, 'error', '하자점검서를 찾지 못했습니다. 새로고침해 주세요.'); end if;
  fid := public.ws_add_file('dw_photo', p_file, 'application/pdf', r.work_day || '_하자점검.pdf',
    '점검/하자점검/' || to_char(r.work_day, 'YYYY') || '/' || to_char(r.work_day, 'YYYY-MM'), me.name);
  update public.dw_defect set pdf_file = fid where hj_id = p_id returning * into r;
  return jsonb_build_object('ok', true, 'item', public.ws_hj_out(r));
end $$;

-- 메일 발송(구글 서버만 부름): 직원 확인 + 보낼 PDF 정보
create or replace function public.ws_hj_mail_info(p_token text, p_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.dw_defect;
  f public.files;
begin
  perform public.ws_menu_guard(me.role, 'inspect.defect');
  select * into r from public.dw_defect where hj_id = p_id and not deleted;
  if r.hj_id is null then return jsonb_build_object('ok', false, 'error', '하자점검서를 찾지 못했습니다. 새로고침해 주세요.'); end if;
  if r.pdf_file is null then return jsonb_build_object('ok', false, 'error', 'PDF가 없습니다. 먼저 「PDF 생성」을 눌러 주세요.'); end if;
  select * into f from public.files where id = r.pdf_file;
  return jsonb_build_object('ok', true, 'by', me.name, 'day', r.work_day::text,
    'file', jsonb_build_object('id', f.id, 'kind', f.kind, 'storage_path', f.storage_path, 'file_name', f.file_name, 'drive_folder', f.drive_folder, 'drive_id', f.drive_id));
end $$;

create or replace function public.ws_hj_mail_done(p_token text, p_id text, p_to text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.dw_defect;
begin
  perform public.ws_menu_guard(me.role, 'inspect.defect');
  update public.dw_defect set mail_log = (mail_log || jsonb_build_array(jsonb_build_object('at', to_char(clock_timestamp() at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), 'to', left(p_to, 120), 'by', me.name)))
   where hj_id = p_id and not deleted returning * into r;
  if r.hj_id is null then return jsonb_build_object('ok', false, 'error', '하자점검서를 찾지 못했습니다.'); end if;
  perform public.ws_log(me.name, '하자점검 메일 발송', p_id, left(p_to, 120));
  return jsonb_build_object('ok', true, 'item', public.ws_hj_out(r));
end $$;

-- 권한: 도우미는 막음. 로그인 기기만 3개
revoke all on function public.ws_hj_file(uuid), public.ws_hj_out(public.dw_defect),
  public.ws_hj_list(text, text, text, text), public.ws_hj_save(text, jsonb), public.ws_hj_delete(text, text),
  public.ws_hj_pdf(text, text, jsonb), public.ws_hj_mail_info(text, text), public.ws_hj_mail_done(text, text, text) from public, anon, authenticated;
grant execute on function public.ws_hj_list(text, text, text, text), public.ws_hj_save(text, jsonb), public.ws_hj_delete(text, text) to authenticated;
grant execute on function public.ws_hj_pdf(text, text, jsonb) to authenticated;
grant execute on function public.ws_hj_mail_info(text, text), public.ws_hj_mail_done(text, text, text) to service_role;   -- 메일은 구글 서버만
