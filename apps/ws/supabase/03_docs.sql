-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-2 묶음: 서류작업 (명일 작업 · TBM · 종합업무일지) DB 함수
-- 기준: apps/ws/src/Code.gs v0.9.14 nextWorkGet/Save · tbmGet/Save/SavePdf · logGet/Save/SavePdf
-- 실행: 01 · 02 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.10
--
--  · 화면이 사진·PDF를 ws-files 버킷에 먼저 올리고 { url, path } 만 넘김 → 여기서 files 표에 적고 업무 표가 files.id 를 가리킴
--  · 바뀐 사진·PDF의 옛 파일은 지우지 않음 (주 1회 드라이브 이관 때 기록으로 같이 옮겨짐)
--  · ver(겹침 확인) = 마지막 고친 시각을 마이크로초까지 글자로 → 같은 초에 두 번 저장해도 다름 (시트 판의 '+' 대신)
--  · 날씨(네이버 오후 1시)·공조기 가동시간은 구글(Apps Script)에 남음 — 화면 통로(ws-api.js)가 따로 부름
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 도우미
-- ---------------------------------------------------------------------------
-- Code.gs cleanText_: 제어 문자·<> 빼고, 빈칸 한 칸으로, 앞뒤 빈칸 빼고, 최대 글자 수
create or replace function public.ws_clean(p text, p_max int)
returns text language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x01-\x1f<>]', '', 'g'), '\s+', ' ', 'g')), p_max);
$$;

-- 겹침 확인 값 (한국 시각, 마이크로초까지). 없으면 ''
create or replace function public.ws_ver(p timestamptz)
returns text language sql immutable set search_path = public as $$
  select coalesce(to_char(p at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS.US'), '');
$$;

-- 'YYYY-MM-DD' 글자 → 날짜, 틀리면 null
create or replace function public.ws_date(p text)
returns date language plpgsql immutable set search_path = public as $$
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

-- 화면이 올린 파일을 files 표에 적음. 경로는 '{kind}/YYYY-MM/{영문·숫자}.{jpg|png|pdf}', 주소는 그 경로의 공개 주소여야 함
create or replace function public.ws_add_file(p_kind text, p_file jsonb, p_mime text, p_name text, p_folder text, p_who text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  u text := p_file->>'url';
  pth text := p_file->>'path';
  fid uuid;
begin
  if coalesce(pth, '') !~ ('^' || p_kind || '/\d{4}-\d{2}/[a-z0-9]+\.(jpg|png|pdf)$')
     or coalesce(u, '') not like '%/object/public/ws-files/' || pth then
    raise exception '파일 정보가 올바르지 않습니다. 다시 해 주세요.';
  end if;
  insert into public.files (kind, file_url, storage_path, mime, file_name, drive_folder, created_by)
  values (p_kind, u, pth, p_mime, p_name, p_folder, p_who) returning id into fid;
  return fid;
end $$;

create or replace function public.ws_file_url(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select file_url from public.files where id = p_id), '');
$$;

-- ---------------------------------------------------------------------------
-- 명일 작업 예정 (Code.gs nwSheet_ · nextWorkGet · nextWorkSave, 결정 62·68)
-- ---------------------------------------------------------------------------
create or replace function public.ws_nw_data(p_date date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'date', p_date,
    'ver', (select public.ws_ver(max(edited_at)) from public.next_work where work_date = p_date),
    'by', coalesce((select edited_by from public.next_work where work_date = p_date order by edited_at desc nulls last limit 1), ''),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('dept', coalesce(dept, ''), 'place', coalesce(place, ''), 'work', coalesce(work, ''), 'note', coalesce(note, '')) order by seq)
                      from public.next_work where work_date = p_date), '[]'::jsonb));
$$;

create or replace function public.ws_next_work_get(p_token text, p_date text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  def date := public.ws_work_day() + 1;   -- 기본 = 작성일(근무일) 다음 날
  d date;
begin
  perform public.ws_auth(p_token);
  d := case when coalesce(p_date, '') = '' then def else public.ws_date(p_date) end;
  if d is null then return jsonb_build_object('ok', false, 'error', '일자 형식이 맞지 않습니다'); end if;
  return jsonb_build_object('ok', true, 'defaultDate', def, 'workDay', public.ws_work_day()) || public.ws_nw_data(d);
end $$;

-- 그 일자 줄을 모두 새로 씀. ver가 다르면 덮어쓰지 않고 새 내용을 돌려줌
create or replace function public.ws_next_work_save(p_token text, p_date text, p_rows jsonb, p_ver text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_date);
  cur jsonb;
  x jsonb;
  clean jsonb := '[]'::jsonb;
  at timestamptz := clock_timestamp();
begin
  if d is null then return jsonb_build_object('ok', false, 'error', '일자 형식이 맞지 않습니다'); end if;
  for x in select e from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) e loop
    x := jsonb_build_object('dept', coalesce(x->>'dept', ''), 'place', public.ws_clean(x->>'place', 40), 'work', public.ws_clean(x->>'work', 100), 'note', public.ws_clean(x->>'note', 40));
    if x->>'place' <> '' or x->>'work' <> '' or x->>'note' <> '' then clean := clean || jsonb_build_array(x); end if;   -- 입력한 줄만
  end loop;
  if jsonb_array_length(clean) > 30 then return jsonb_build_object('ok', false, 'error', '줄은 30줄까지 넣을 수 있습니다'); end if;
  if exists (select 1 from jsonb_array_elements(clean) e where e->>'dept' not in ('전방파트', '기건파트')) then
    return jsonb_build_object('ok', false, 'error', '부서(전방파트·기건파트)를 골라 주세요');
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_nw_' || d));
  cur := public.ws_nw_data(d);
  if coalesce(p_ver, '') <> cur->>'ver' then
    return jsonb_build_object('ok', false, 'conflict', true, 'error', coalesce(nullif(cur->>'by', ''), '다른 사람') || '님이 먼저 고쳤어요. 새 내용을 불러왔습니다.') || cur;
  end if;
  delete from public.next_work where work_date = d;
  insert into public.next_work (work_date, seq, dept, place, work, note, edited_by, edited_at)
  select d, i, e->>'dept', e->>'place', e->>'work', e->>'note', me.name, at from jsonb_array_elements(clean) with ordinality t(e, i);
  perform public.ws_log(me.name, '명일 작업 저장', d::text, jsonb_array_length(clean) || '줄');
  return jsonb_build_object('ok', true) || public.ws_nw_data(d);
end $$;

-- ---------------------------------------------------------------------------
-- TBM (Code.gs tbmGet · tbmSave · tbmSavePdf, 결정 58·66·70)
-- ---------------------------------------------------------------------------
-- 첫 위험성 목록 (Code.gs RISK_SEED, 11-06 확정) — 표가 비었을 때만. 4단계 옮기기가 시트 「위험성목록」으로 덮어씀
insert into public.risk_list (seq, words, risk, kind, likelihood, severity, fix1, fix2, fix3, fix4)
select * from (values
  (1, '사다리', 'A형 사다리 미끄러짐·상부 균형 상실', '떨어짐', 2, 3, '✓2인 1조, 1명은 아래에서 사다리 지지', '✓안전모(턱끈) 착용, 미끄럼 방지 발판·벌림 고정 확인', '최상단 발판 위 작업 금지', null),
  (2, '비계', '작업발판 끝에서 헛디딤, 안전난간 없는 곳 접근', '떨어짐', 3, 3, '✓안전대 부착설비에 안전대 걸고 작업', '✓안전난간·발끝막이판 설치 확인', '작업 전 발판 고정 점검', null),
  (3, '우마, 말비계', '우마 위에서 움직이다 중심 잃음', '떨어짐', 2, 2, '✓바퀴 잠금 확인 뒤 올라감', '✓안전모 착용', '우마에 탄 채 옮기지 않음', null),
  (4, '테이블리프트, 고소작업대, 렌탈', '작업대 올라가다 천장 배관·보에 몸 끼임', '끼임', 2, 3, '✓유도자 배치, 위쪽 장애물 확인', '✓비상정지 위치·작동 확인', '안전대 체결', '작업 반경 출입 통제'),
  (5, '스카이', '버킷에서 떨어짐, 차량 기울어짐', '떨어짐', 2, 3, '✓버킷 안에서 안전대 체결', '✓아웃트리거 설치·바닥 확인', '아래쪽 출입 통제', null),
  (6, '크레인, 양중, 인양', '들어 올린 짐 흔들림·와이어로프 끊어짐', '맞음', 2, 3, '✓짐 아래 출입금지 구역 설정', '✓와이어로프·훅 해지장치 사전 점검', '신호수 배치', null),
  (7, '달비계', '로프 풀림·끊어짐', '떨어짐', 2, 3, '✓작업 로프와 따로 구명줄에 안전대 체결', '✓로프 고정점·손상 사전 점검', '아래쪽 출입 통제', null),
  (8, '용접, 용단, 화기', '불티가 주변 가연물에 튀어 불남', '화재', 2, 3, '✓주변 가연물 치우거나 방염포 덮음', '✓소화기 비치, 화재감시인 배치', '작업 뒤 30분 불씨 확인', null),
  (9, '그라인더, 절단', '숫돌 깨져 파편 튐, 옷 말려 들어감', '맞음', 2, 2, '✓방호덮개 장착 확인', '✓보안면·보호장갑 착용', '소매·끈 정리', null),
  (10, '페인트, 도장, 약품', '유기용제 증기 마심·불붙음', '화학물질 노출', 2, 2, '✓환기(창문·송풍기)', '✓방독마스크·보호장갑 착용', '주변 화기 금지', null),
  (11, '분전반, 차단기, 배선, 전기', '전기 흐르는 부분 노출·접촉', '감전', 1, 3, '✓작업 전 검전, 되도록 차단 뒤 작업', '✓절연장갑·절연화 착용', '차단기 잠금·「작업 중」 표지', null),
  (12, '펌프, 팬, 공조기, 모터, 벨트', '돌아가는 부분이 멈추기 전에 손 넣음', '끼임', 1, 3, '✓전원 차단·잠금·표지 뒤 작업', '✓완전히 멈춘 것 확인 뒤 손 넣기', null, null),
  (13, '정화조, 맨홀, 집수정, 밀폐', '산소 부족·유해가스', '질식', 1, 3, '✓들어가기 전 산소·가스 농도 측정', '✓환기 뒤 들어감, 밖에 감시인 배치', '송기마스크 비치', null),
  (14, '옥상, 냉각탑', '옥상 끝 쪽 접근', '떨어짐', 1, 3, '✓안전난간 안쪽에서만 작업', '✓2인 1조', null, null),
  (15, '운반, 중량물, 자재', '무거운 물건 혼자 들다 허리 다침', '무리한 동작', 2, 2, '✓대차 사용, 무거운 것은 2인 운반', '✓무릎 굽혀 들기', null, null),
  (16, '배수, 물기, 청소', '바닥 물기·기름에 미끄러짐', '넘어짐', 2, 1, '✓작업 전 바닥 물기 닦기', '✓미끄럼 방지 안전화 착용', '통로 정리', null),
  (17, '천장, 점검구', '천장 안 튀어나온 철골에 머리 부딪힘', '부딪힘', 2, 1, '✓안전모 착용', '✓랜턴 휴대, 조명 확보', null, null),
  (18, '(기본)', '공구·자재 다루다 손 다침', '절단·베임·찔림', 1, 1, '✓보호장갑 착용', '공구 사용 전 상태 확인', null, null)
) v where not exists (select 1 from public.risk_list);

-- 위험성 목록: 순서대로. ✓ 로 시작하는 개선조치 = 미리 체크
create or replace function public.ws_risk_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'words', (select coalesce(jsonb_agg(btrim(w)), '[]'::jsonb) from regexp_split_to_table(coalesce(r.words, ''), '[,，]') w where btrim(w) <> ''),
    'risk', r.risk, 'kind', coalesce(r.kind, ''),
    'p', case when r.likelihood between 1 and 3 then r.likelihood else 1 end,
    's', case when r.severity between 1 and 3 then r.severity else 1 end,
    'fixes', (select coalesce(jsonb_agg(jsonb_build_object('t', regexp_replace(btrim(f), '^✓\s*', ''), 'on', btrim(f) ~ '^✓') order by i), '[]'::jsonb)
              from unnest(array[r.fix1, r.fix2, r.fix3, r.fix4]) with ordinality u(f, i) where btrim(coalesce(f, '')) <> '')
  ) order by r.seq), '[]'::jsonb)
  from public.risk_list r where r.active and coalesce(r.risk, '') <> '';
$$;

-- TBM 날짜: 고른 지난 날짜, 없거나 틀리거나 앞날이면 오늘 근무일
create or replace function public.ws_tbm_day(p text)
returns date language sql stable set search_path = public as $$
  select case when public.ws_date(p) < public.ws_work_day() then public.ws_date(p) else public.ws_work_day() end;
$$;

create or replace function public.ws_tbm_get(p_token text, p_want text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d date;
  r public.tbm;
  sg jsonb;
  mgr jsonb;
begin
  perform public.ws_auth(p_token);
  d := public.ws_tbm_day(p_want);
  select coalesce(jsonb_agg(jsonb_build_object('no', n, 'id', sign_id, 'name', name, 'part', coalesce(part, ''), 'role', role, 'at', at, 'img', img) order by n), '[]'::jsonb) into sg
  from (select row_number() over (order by s.signed_at, s.sign_id) n, s.sign_id, s.name, s.part, coalesce(st.role, '') role,
               to_char(s.signed_at at time zone 'Asia/Seoul', 'HH24:MI') at, public.ws_file_url(s.sign_file_id) img
        from public.signs s left join public.staff st using (staff_id) where s.work_day = d and not s.deleted) t;
  select jsonb_build_object('name', e->>'name', 'img', e->>'img') into mgr
  from jsonb_array_elements(sg) e where e->>'role' in ('소장', '부소장') order by e->>'role' = '소장' desc, (e->>'no')::int limit 1;
  select * into r from public.tbm where work_day = d and not deleted;
  return jsonb_build_object(
    'ok', true, 'day', d, 'today', public.ws_work_day(), 'signs', sg, 'manager', mgr, 'risks', public.ws_risk_list(),
    'works', case when r.tbm_id is not null then r.works   -- 아직 저장 안 했으면 그 날짜 명일 작업 예정에서 (비고는 위험성 미리 고르기에만)
             else (select coalesce(jsonb_agg(e || '{"n": ""}'::jsonb), '[]'::jsonb) from jsonb_array_elements(public.ws_nw_data(d)->'rows') e) end,
    'checks', case when r.tbm_id is not null then r.checks end,
    'saved', r.tbm_id is not null, 'by', coalesce(r.author_name, ''), 'at', public.ws_ver(r.updated_at),
    'photos', jsonb_build_object('meet', public.ws_file_url(r.meet_file_id), 'chant', public.ws_file_url(r.chant_file_id)),
    'pdf', case when r.pdf_file_id is not null then jsonb_build_object('id', r.pdf_file_id, 'at', public.ws_ver(r.pdf_at), 'signs', r.sign_count,
                                                                      'url', public.ws_file_url(r.pdf_file_id), 'shared', true) end);
end $$;

-- 1~3 (아니면 '')
create or replace function public.ws_n3(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when p #>> '{}' ~ '^\s*\d+(\.\d+)?\s*$' and (p #>> '{}')::numeric between 1 and 3 then to_jsonb(round((p #>> '{}')::numeric)::int) else '""'::jsonb end;
$$;

-- [저장] 본체 (PDF 저장도 같이 씀). p_files = { meet: {url, path}, chant: {url, path} } 바꾼 사진만
create or replace function public.ws_tbm_save_(me public.staff, p_d jsonb, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d date := public.ws_tbm_day(p_d->>'day');
  v_works jsonb;
  v_checks jsonb := '{}'::jsonb;
  k text;
  meet uuid;
  chant uuid;
  folder text := '서류작업/TBM/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM');
  r public.tbm;
begin
  if jsonb_typeof(p_d->'works') is distinct from 'array' or jsonb_array_length(p_d->'works') > 30 then
    return jsonb_build_object('ok', false, 'error', '작업 표는 30줄까지 넣을 수 있습니다');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'place', public.ws_clean(w->>'place', 40), 'work', public.ws_clean(w->>'work', 100),
    'dept', case when w->>'dept' in ('전방파트', '기건파트') then w->>'dept' else '' end,
    'n', case when coalesce(w->>'n', '') ~ '^\d{1,3}$' then w->>'n' else '' end,
    'risk', public.ws_clean(w->>'risk', 60), 'kind', public.ws_clean(w->>'kind', 20), 'p', public.ws_n3(w->'p'), 's', public.ws_n3(w->'s'),
    'fixes', (select coalesce(jsonb_agg(c order by i), '[]'::jsonb) from (select public.ws_clean(f, 80) c, i
              from jsonb_array_elements_text(case when jsonb_typeof(w->'fixes') = 'array' then w->'fixes' else '[]'::jsonb end) with ordinality u(f, i) where i <= 6) z where c <> '')
  ) order by i), '[]'::jsonb) into v_works
  from jsonb_array_elements(p_d->'works') with ordinality t(w, i);
  foreach k in array array['사다리', '비계', '우마', '테이블리프트', '크레인', '스카이', '달비계', '용접기'] loop
    if coalesce(p_d->'checks'->>k, '') not in ('', 'false', '0') then v_checks := v_checks || jsonb_build_object(k, true); end if;
  end loop;
  if p_files ? 'meet' then meet := public.ws_add_file('tbm_meet', p_files->'meet', 'image/jpeg', d || '_TBM-회의사진_001.jpg', folder, me.name); end if;
  if p_files ? 'chant' then chant := public.ws_add_file('tbm_chant', p_files->'chant', 'image/jpeg', d || '_TBM-구호사진_002.jpg', folder, me.name); end if;
  perform pg_advisory_xact_lock(hashtext('ws_tbm_' || d));
  insert into public.tbm (tbm_id, work_day, author_id, author_name, meet_file_id, chant_file_id, works, checks, updated_at)
  values ('WS-TB-' || to_char(d, 'YYYYMMDD') || '-001', d, me.staff_id, me.name, meet, chant, v_works, v_checks, clock_timestamp())
  on conflict (work_day) do update set works = excluded.works, checks = excluded.checks, updated_at = excluded.updated_at, deleted = false,
    meet_file_id = coalesce(excluded.meet_file_id, tbm.meet_file_id), chant_file_id = coalesce(excluded.chant_file_id, tbm.chant_file_id)
  returning * into r;
  perform public.ws_log(me.name, 'TBM 저장', d::text, jsonb_array_length(v_works) || '줄 · 사진 ' || ((meet is not null)::int + (chant is not null)::int) || '장');
  return jsonb_build_object('ok', true, 'at', public.ws_ver(r.updated_at));
end $$;

create or replace function public.ws_tbm_save(p_token text, p_d jsonb, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  return public.ws_tbm_save_(public.ws_auth(p_token), coalesce(p_d, '{}'::jsonb), coalesce(p_files, '{}'::jsonb));
end $$;

-- [PDF로 저장]: p_d 가 있으면 먼저 저장. 쓰인 서명은 tbm_used. p_files.pdf = 올린 PDF
create or replace function public.ws_tbm_save_pdf(p_token text, p_files jsonb, p_sign_ids jsonb, p_d jsonb, p_want text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  s jsonb;
  d date := public.ws_tbm_day(p_want);
  ids text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(p_sign_ids) = 'array' then p_sign_ids else '[]'::jsonb end));
  r public.tbm;
  fid uuid;
begin
  if p_d is not null and jsonb_typeof(p_d) = 'object' then
    s := public.ws_tbm_save_(me, p_d, coalesce(p_files, '{}'::jsonb) - 'pdf');
    if not (s->>'ok')::boolean then return s; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_tbm_' || d));
  select * into r from public.tbm where work_day = d and not deleted;
  if r.tbm_id is null then return jsonb_build_object('ok', false, 'error', '먼저 [저장]을 눌러 주세요'); end if;
  fid := public.ws_add_file('tbm_pdf', p_files->'pdf', 'application/pdf', d || '_TBM.pdf',
                            '서류작업/TBM/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM'), me.name);
  update public.tbm set pdf_file_id = fid, pdf_at = clock_timestamp(), sign_count = cardinality(ids) where tbm_id = r.tbm_id returning * into r;
  update public.signs set tbm_used = true where sign_id = any(ids) and not tbm_used;
  perform public.ws_log(me.name, 'TBM PDF 저장', d::text, '서명 ' || cardinality(ids) || '명');
  return jsonb_build_object('ok', true, 'warn', '', 'pdf', jsonb_build_object('id', fid, 'at', public.ws_ver(r.pdf_at), 'signs', r.sign_count,
                                                                         'url', public.ws_file_url(fid), 'shared', true));
end $$;

-- ---------------------------------------------------------------------------
-- 종합업무일지 (Code.gs logGet · logSave · logSavePdf, 결정 116·120)
--   한 표(daily_log)에 25·26년 과거자료(4단계에서 옮김, updated_at 비움)와 새로 쓴 날이 같이 있음.
--   전년·누계·증감은 저장하지 않고 읽을 때 계산
-- ---------------------------------------------------------------------------
create or replace function public.ws_num(p numeric)
returns text language sql immutable set search_path = public as $$ select coalesce(trim_scale(p)::text, ''); $$;

-- 한 줄 → 화면이 쓰는 시트 열 이름 (Code.gs logOut_)
create or replace function public.ws_log_out(r public.daily_log)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when r.log_date is null then null else jsonb_build_object(
    '일자', r.log_date, '영업시간', public.ws_num(r.business_hours), '날씨', coalesce(r.weather, ''), '최저', public.ws_num(r.t_min), '최고', public.ws_num(r.t_max),
    '최고풍속', public.ws_num(r.wind_max), '미세먼지', public.ws_num(r.pm), '미세먼지등급', coalesce(r.pm_grade, ''), '날씨출처', coalesce(r.weather_source, ''),
    '시수', public.ws_num(r.m_city_water), '중수', public.ws_num(r.m_grey_water), '식당시수', public.ws_num(r.m_food_water), '식당온수', public.ws_num(r.m_food_hot),
    '식당가스', public.ws_num(r.m_food_gas), '식당분전반', public.ws_num(r.m_food_panel), '식기세척분전반', public.ws_num(r.m_dish_panel), '매점분전반', public.ws_num(r.m_shop_panel),
    '급탕', public.ws_num(r.m_hot_supply), '환탕', public.ws_num(r.m_hot_return), '급탕탱크', public.ws_num(r.m_hot_tank), '전기', public.ws_num(r.electricity),
    '야간그림_id', coalesce(r.night_file_id::text, ''), 'pdf_id', coalesce(r.pdf_file_id::text, ''), 'PDF만든시각', public.ws_ver(r.pdf_at),
    '작성자', coalesce(r.author, ''), '수정자', coalesce(r.editor, ''), '수정시각', public.ws_ver(r.updated_at), '삭제여부', 'N', '비고', coalesce(r.note, ''),
    'works', jsonb_build_object('전기방재', r.work_elec, '기계건축', r.work_mech)) end;
$$;

-- 한 줄의 숫자들 (Code.gs logVals_) — 실온수 = 급탕 − 환탕
create or replace function public.ws_log_vals(r public.daily_log)
returns jsonb language sql immutable set search_path = public as $$
  select case when r.log_date is null then '{}'::jsonb else jsonb_build_object(
    '영업시간', r.business_hours, '최저', r.t_min, '최고', r.t_max, '최고풍속', r.wind_max, '미세먼지', r.pm, '전기', r.electricity,
    '시수', r.m_city_water, '중수', r.m_grey_water, '식당시수', r.m_food_water, '식당온수', r.m_food_hot, '식당가스', r.m_food_gas,
    '식당분전반', r.m_food_panel, '식기세척분전반', r.m_dish_panel, '매점분전반', r.m_shop_panel, '급탕', r.m_hot_supply, '환탕', r.m_hot_return,
    '급탕탱크', r.m_hot_tank, '실온수', round(r.m_hot_supply - r.m_hot_return, 3)) end;
$$;

-- from ~ to (둘 다 포함) 합 (Code.gs logSum_)
create or replace function public.ws_log_sum(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    '영업시간', round(coalesce(sum(business_hours), 0), 3), '전기', round(coalesce(sum(electricity), 0), 3),
    '실온수', round(coalesce(sum(round(m_hot_supply - m_hot_return, 3)), 0), 3),
    '시수', round(coalesce(sum(m_city_water), 0), 3), '중수', round(coalesce(sum(m_grey_water), 0), 3), '식당시수', round(coalesce(sum(m_food_water), 0), 3),
    '식당온수', round(coalesce(sum(m_food_hot), 0), 3), '식당가스', round(coalesce(sum(m_food_gas), 0), 3), '식당분전반', round(coalesce(sum(m_food_panel), 0), 3),
    '식기세척분전반', round(coalesce(sum(m_dish_panel), 0), 3), '매점분전반', round(coalesce(sum(m_shop_panel), 0), 3),
    '급탕', round(coalesce(sum(m_hot_supply), 0), 3), '환탕', round(coalesce(sum(m_hot_return), 0), 3), '급탕탱크', round(coalesce(sum(m_hot_tank), 0), 3))
  from public.daily_log where log_date between p_from and p_to and not deleted;
$$;

-- 그 근무일 TBM 작업 표(없으면 명일 작업 예정)의 작업위치 + 작업내용, 부서마다 10줄 (Code.gs logTbm_)
create or replace function public.ws_log_tbm(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  with w as (
    select e, i from public.tbm t, jsonb_array_elements(t.works) with ordinality x(e, i) where t.work_day = p_day and not t.deleted
    union all
    select e, i from jsonb_array_elements(public.ws_nw_data(p_day)->'rows') with ordinality x(e, i)
     where not exists (select 1 from public.tbm where work_day = p_day and not deleted)
  ), l as (
    select case e->>'dept' when '전방파트' then '전기방재' when '기건파트' then '기계건축' end dept,
           public.ws_clean(concat_ws(' ', nullif(btrim(e->>'place'), ''), nullif(btrim(e->>'work'), '')), 100) t, i
    from w
  ), n as (select dept, t, row_number() over (partition by dept order by i) k from l where dept is not null and t <> '')
  select jsonb_build_object(
    '전기방재', coalesce((select jsonb_agg(t order by k) from n where dept = '전기방재' and k <= 10), '[]'::jsonb),
    '기계건축', coalesce((select jsonb_agg(t order by k) from n where dept = '기계건축' and k <= 10), '[]'::jsonb));
$$;

-- 일지 날짜: 고른 날(앞날은 안 됨), 없거나 틀리면 오늘 근무일
create or replace function public.ws_log_day(p text)
returns date language sql stable set search_path = public as $$
  select case when public.ws_date(p) <= public.ws_work_day() then public.ws_date(p) else public.ws_work_day() end;
$$;

-- 화면에 줄 것 전부 (Code.gs logData_) — 공조기(ac)는 화면 통로가 구글에서 받아 붙임
create or replace function public.ws_log_data(p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  prev date := (p_day - interval '1 year')::date;   -- 2월 29일 → 전년 2월 28일
  c public.daily_log; p public.daily_log; y public.daily_log;
begin
  select * into c from public.daily_log where log_date = p_day and not deleted;
  select * into p from public.daily_log where log_date = prev and not deleted;
  select * into y from public.daily_log where log_date = p_day - 1 and not deleted;
  return jsonb_build_object(
    'ok', true, 'day', p_day, 'prevDay', prev, 'workDay', public.ws_work_day(),
    'cur', public.ws_log_out(c), 'prev', public.ws_log_out(p),
    'vals', jsonb_build_object('c', public.ws_log_vals(c), 'p', public.ws_log_vals(p), 'y', public.ws_log_vals(y)),
    'month', jsonb_build_object('c', public.ws_log_sum(date_trunc('month', p_day)::date, p_day), 'p', public.ws_log_sum(date_trunc('month', prev)::date, prev)),
    'year', jsonb_build_object('c', public.ws_log_sum(date_trunc('year', p_day)::date, p_day), 'p', public.ws_log_sum(date_trunc('year', prev)::date, prev)),
    'ver', public.ws_ver(c.updated_at), 'by', case when c.updated_at is not null then coalesce(c.editor, '') else '' end,   -- 과거자료(고친 적 없음)는 ''
    'pdf', case when c.pdf_file_id is not null then jsonb_build_object('id', c.pdf_file_id, 'at', public.ws_ver(c.pdf_at), 'url', public.ws_file_url(c.pdf_file_id)) end,
    'night', public.ws_file_url(c.night_file_id), 'tbm', public.ws_log_tbm(p_day));
end $$;

create or replace function public.ws_log_get(p_token text, p_day text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return public.ws_log_data(public.ws_log_day(p_day));
end $$;

-- 저장 본체 (Code.gs logSave). p_files.night = 새 야간 그림, p_d.night = '-' 이면 빼기
create or replace function public.ws_log_save_(me public.staff, p_day text, p_d jsonb, p_ver text, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d date := public.ws_date(p_day);
  nums text[] := array['영업시간', '최저', '최고', '최고풍속', '미세먼지', '전기', '시수', '중수', '식당시수', '식당온수', '식당가스', '식당분전반', '식기세척분전반', '매점분전반', '급탕', '환탕', '급탕탱크'];
  v jsonb := '{}'::jsonb;   -- 숫자 칸: 이름 → 숫자 또는 null
  k text;
  raw text;
  grade text := coalesce(p_d->>'미세먼지등급', '');
  works jsonb := '{}'::jsonb;
  night uuid;
  r public.daily_log;
  cur_ver text;
begin
  if d is null or d > public.ws_work_day() then return jsonb_build_object('ok', false, 'error', '일자가 맞지 않습니다'); end if;
  foreach k in array nums loop
    raw := btrim(replace(coalesce(p_d->>k, ''), ',', ''));
    if raw <> '' and raw !~ '^-?\d+(\.\d+)?$' then return jsonb_build_object('ok', false, 'error', k || ' 칸에는 숫자만 넣어 주세요'); end if;
    v := v || jsonb_build_object(k, nullif(raw, '')::numeric);
  end loop;
  if grade not in ('', '좋음', '보통', '나쁨', '매우나쁨') then return jsonb_build_object('ok', false, 'error', '미세먼지 등급을 골라 주세요'); end if;
  foreach k in array array['전기방재', '기계건축'] loop
    works := works || jsonb_build_object(k, (select coalesce(jsonb_agg(c order by i), '[]'::jsonb) from (select public.ws_clean(t, 100) c, i
      from jsonb_array_elements_text(case when jsonb_typeof(p_d->'works'->k) = 'array' then p_d->'works'->k else '[]'::jsonb end) with ordinality u(t, i)) z where c <> ''));
    if jsonb_array_length(works->k) > 10 then return jsonb_build_object('ok', false, 'error', k || ' 작업은 10줄까지 넣을 수 있습니다'); end if;
  end loop;
  if coalesce(p_files, '{}'::jsonb) ? 'night' then
    night := public.ws_add_file('log_night', p_files->'night', 'image/jpeg', d || '_야간작업_001.jpg',
                                '서류작업/종합업무일지/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM'), me.name);
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_log_' || d));
  select * into r from public.daily_log where log_date = d;
  cur_ver := case when r.deleted then '' else public.ws_ver(r.updated_at) end;
  if coalesce(p_ver, '') <> cur_ver then
    return public.ws_log_data(d) || jsonb_build_object('ok', false, 'conflict', true,
      'error', coalesce(nullif(case when r.updated_at is not null then r.editor end, ''), '다른 사람') || '님이 먼저 고쳤어요. 새 내용을 불러왔습니다.');
  end if;
  insert into public.daily_log as t (log_date, business_hours, weather, t_min, t_max, wind_max, pm, pm_grade, weather_source,
    m_city_water, m_grey_water, m_food_water, m_food_hot, m_food_gas, m_food_panel, m_dish_panel, m_shop_panel, m_hot_supply, m_hot_return, m_hot_tank,
    electricity, work_elec, work_mech, night_file_id, author, editor, updated_at, deleted, note)
  values (d, (v->>'영업시간')::numeric, nullif(public.ws_clean(p_d->>'날씨', 10), ''), (v->>'최저')::numeric, (v->>'최고')::numeric, (v->>'최고풍속')::numeric,
    (v->>'미세먼지')::numeric, nullif(grade, ''), nullif(public.ws_clean(p_d->>'날씨출처', 10), ''),
    (v->>'시수')::numeric, (v->>'중수')::numeric, (v->>'식당시수')::numeric, (v->>'식당온수')::numeric, (v->>'식당가스')::numeric, (v->>'식당분전반')::numeric,
    (v->>'식기세척분전반')::numeric, (v->>'매점분전반')::numeric, (v->>'급탕')::numeric, (v->>'환탕')::numeric, (v->>'급탕탱크')::numeric,
    (v->>'전기')::numeric, works->'전기방재', works->'기계건축', night, me.name, me.name, clock_timestamp(), false,
    left(btrim(regexp_replace(replace(coalesce(p_d->>'비고', ''), E'\r', ''), '[\x01-\x09\x0b-\x1f<>]', '', 'g')), 500))   -- 비고는 줄바꿈 둠
  on conflict (log_date) do update set
    business_hours = excluded.business_hours,
    -- 빈칸으로 보내도 자동으로 들어온 날씨는 지우지 않음 (오후 1시 전에 연 화면)
    weather = coalesce(excluded.weather, t.weather), t_min = coalesce(excluded.t_min, t.t_min), t_max = coalesce(excluded.t_max, t.t_max),
    wind_max = coalesce(excluded.wind_max, t.wind_max), pm = coalesce(excluded.pm, t.pm), pm_grade = coalesce(excluded.pm_grade, t.pm_grade),
    weather_source = case when p_d ? '날씨출처' then excluded.weather_source else t.weather_source end,
    m_city_water = excluded.m_city_water, m_grey_water = excluded.m_grey_water, m_food_water = excluded.m_food_water, m_food_hot = excluded.m_food_hot,
    m_food_gas = excluded.m_food_gas, m_food_panel = excluded.m_food_panel, m_dish_panel = excluded.m_dish_panel, m_shop_panel = excluded.m_shop_panel,
    m_hot_supply = excluded.m_hot_supply, m_hot_return = excluded.m_hot_return, m_hot_tank = excluded.m_hot_tank, electricity = excluded.electricity,
    work_elec = excluded.work_elec, work_mech = excluded.work_mech,
    night_file_id = case when night is not null then night when p_d->>'night' = '-' then null else t.night_file_id end,
    author = case when t.deleted then excluded.author else coalesce(t.author, excluded.author) end,
    editor = excluded.editor, updated_at = excluded.updated_at, deleted = false, note = excluded.note;
  perform public.ws_log(me.name, '종합업무일지 저장', d::text, case when night is not null then '야간 그림 바꿈' else '' end);
  return public.ws_log_data(d);
end $$;

create or replace function public.ws_log_save(p_token text, p_day text, p_d jsonb, p_ver text, p_files jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  return public.ws_log_save_(public.ws_auth(p_token), p_day, coalesce(p_d, '{}'::jsonb), p_ver, p_files);
end $$;

-- PDF 저장 (B4 가로, 화면에서 만듦) — p_d 가 있으면 먼저 저장. p_files.pdf = 올린 PDF
create or replace function public.ws_log_save_pdf(p_token text, p_day text, p_files jsonb, p_d jsonb, p_ver text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  v text := p_ver;
  s jsonb;
  r public.daily_log;
  fid uuid;
begin
  if d is null then return jsonb_build_object('ok', false, 'error', '일자가 맞지 않습니다'); end if;
  if p_d is not null and jsonb_typeof(p_d) = 'object' then
    s := public.ws_log_save_(me, p_day, p_d, p_ver, coalesce(p_files, '{}'::jsonb) - 'pdf');
    if not (s->>'ok')::boolean then return s; end if;
    v := s->>'ver';
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_log_' || d));
  select * into r from public.daily_log where log_date = d and not deleted;
  if r.log_date is null then return jsonb_build_object('ok', false, 'error', '먼저 [저장]을 눌러 주세요'); end if;
  if coalesce(v, '') <> public.ws_ver(r.updated_at) then
    return public.ws_log_data(d) || jsonb_build_object('ok', false, 'conflict', true,
      'error', coalesce(nullif(r.editor, ''), '다른 사람') || '님이 먼저 고쳤어요. 새 내용을 불러왔습니다. 다시 PDF로 저장해 주세요.');
  end if;
  fid := public.ws_add_file('log_pdf', p_files->'pdf', 'application/pdf', d || '_종합업무일지.pdf',
                            '서류작업/종합업무일지/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM'), me.name);
  update public.daily_log set pdf_file_id = fid, pdf_at = clock_timestamp() where log_date = d;
  perform public.ws_log(me.name, '종합업무일지 PDF 저장', d::text, '');
  return public.ws_log_data(d) || jsonb_build_object('warn', '');
end $$;

-- ---------------------------------------------------------------------------
-- 권한: ws_ 함수는 모두 막고, 화면이 부르는 것만 로그인 기기(authenticated)에 엶 (02의 4개 포함)
--   Supabase는 새 함수를 anon·authenticated 도 부를 수 있게 만들므로 하나씩 막아야 함
-- ---------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'ws\_%' loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;
grant execute on function public.ws_login(text, text, text, text), public.ws_sign_today(text, text, text),
  public.ws_logout(text), public.ws_bootstrap(text),
  public.ws_next_work_get(text, text), public.ws_next_work_save(text, text, jsonb, text),
  public.ws_tbm_get(text, text), public.ws_tbm_save(text, jsonb, jsonb), public.ws_tbm_save_pdf(text, jsonb, jsonb, jsonb, text),
  public.ws_log_get(text, text), public.ws_log_save(text, text, jsonb, text, jsonb), public.ws_log_save_pdf(text, text, jsonb, jsonb, text)
  to authenticated;
