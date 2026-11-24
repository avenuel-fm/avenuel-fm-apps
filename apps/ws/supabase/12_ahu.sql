-- ============================================================================
-- 업무지원(WS) 서류작업 › 공조기 환기온도 (결정 128) — 표 · DB 함수
-- 실행: 11 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_공조기환기온도.md
--
--  · ahu_unit  = 공조기 목록 38대 (엑셀 「공조기 운영 및 온도일지」 순서). 매장이 바뀌면 이 표만 고침
--  · ahu_temp  = 하루 한 줄: 외기온도·습도·냉수공급온도 × 11:00·16:00 (칸 이름 「12」 = 첫 회차 11:00, 결정 196) + 공조기 환기온도(temps)
--  · 저장은 **고친 칸만** 받아 합침 → 12:00(휴대폰)과 16:00(PC)을 다른 사람이 넣어도 서로 안 지움
--  · 날씨·최저·최고·습도는 같은 날 종합업무일지(daily_log)에서 읽기만. 습도 칸(humidity)은 여기서 더함 (11_cutover.sql ws_log_weather 가 채움)
-- ============================================================================
alter table public.daily_log add column if not exists humidity numeric;   -- 네이버 오후 1시 습도(%)

create table if not exists public.ahu_unit (
  seq     int primary key,                       -- 화면·출력 순서
  no      text not null unique,                  -- AHU 번호 (예 7F-39)
  room    text not null default '',              -- 공조실
  place   text not null default '',              -- 사용장소
  active  boolean not null default true
);
create table if not exists public.ahu_temp (
  log_date     date primary key,
  out_t12 numeric, out_t16 numeric,              -- 외기온도
  out_h12 numeric, out_h16 numeric,              -- 습도
  cw_t12  numeric, cw_t16  numeric,              -- 냉수공급온도
  temps        jsonb not null default '{}'::jsonb,   -- { "7F-39": { "12": 22.3, "16": 22.7 } }
  authors      text[] not null default '{}',     -- 저장한 사람 (점검자)
  editor       text,
  updated_at   timestamptz,
  pdf_file_id  uuid references public.files(id),
  pdf_at       timestamptz
);
-- 화면은 아래 함수로만 (표를 바로 읽고 쓰지 못함)
alter table public.ahu_unit enable row level security;
alter table public.ahu_temp enable row level security;
revoke all on public.ahu_unit, public.ahu_temp from anon, authenticated;

insert into public.ahu_unit (seq, no, room, place) values
  (1, '7F-39', '공조실-4', '6층 더페어링,와인 라콘차'),
  (2, '6F-36', '공조실-1', '6층 뮤지엄,상품권 스시이세이,목탄장'),
  (3, '6F-35', '공조실-2', '5층 테이스터5.1 채뉴욕,GK언더웨어 아므마니 언더웨어'),
  (4, '6F-34', '공조실-2', '6층 아그라,르지우 JS가든'),
  (5, '6F-33', '공조실-3', '5층 샌프란시스코마켓,수선실,헬렌카렌스키,막스마라위크앤드,이페쎄'),
  (6, '6F-32', '공조실-3', '6층 해남천일관 한우리, TWG'),
  (7, '6F-31', '공조실-4', '5층 랄프로렌 띠어리, 비이커'),
  (8, '6F-30', '공조실-4', '5층 산드로,마쥬 클럽모나코,레페트 일비종떼,캡슐'),
  (9, '6F-29', '공조실-5', '5층 올세인츠, 스페이스놀,채뉴욕 밀턴,파라마키'),
  (10, '6F-28', '공조실-5', '6층 프라이빗 아트홀, 커뮤니티'),
  (11, '5F-27', '공조실-1', '5층 김영모과자점 후지필름, 이구일포토그랩스'),
  (12, '5F-26', '공조실-3', '4층 블랙라운지 제나, 에트로'),
  (13, '5F-25', '공조실-3', '4층 버버리맨즈 돌체앤가바나'),
  (14, '5F-24', '공조실-4', '4층 구찌맨즈, 루이비통맨즈'),
  (15, '5F-23', '공조실-5', '4층 폴로랄프로렌 발렌시아가.디올'),
  (16, '5F-22', '공조실-5', '4층 CP컴퍼니 톰포드,벨루티 일레븐티,디올슈즈'),
  (17, '4F-21', '공조실-1', '3층 아르마니 띠어리,스톤아일랜드 휴고보스,라르디니'),
  (18, '4F-20', '공조실-1', '3층 보라악수 알렉산드로 파리. 스텔라'),
  (19, '4F-19', '공조실-2', '4층 PSR 캘롤리나헤레나, 피비아니필리피'),
  (20, '4F-18', '공조실-3', '3층 캐나다구스 아르마니, 메링링 질샌더, 메종'),
  (21, '4F-17', '공조실-4', '3층 겐조, 파투 엘리든, 베이비'),
  (22, '4F-16', '공조실-5', '3층 퍼플 퓨잡, 페트레이'),
  (23, '4F-15', '공조실-5', '3층 로크, 안드레스샌드라, 데스트니'),
  (24, '3F-14', '공조실-1', '2층 델보, 막스마라, 멀버리,에르노'),
  (25, '3F-13', '공조실-2', '2층 에메랄드, 몽클레어, 토즈,로저비비에'),
  (26, '3F-12', '공조실-3', '2층 로에버,다미아니, 발망,쉘린느, 발렌시아가'),
  (27, '3F-11', '공조실-4', '2층 쇼파드,예거,구찌, 테그호이어, 피아제,IWC'),
  (28, '2F-10', '공조실-5', '2층 파네라이, 부세론,로저드뷔, 콘스탄틴'),
  (29, '2F-9', '공조실-5', '2층 오메가,블랑팡, 타사키,프레드,튜더'),
  (30, 'B1F-8', '공조실-3', '1층 루이비통'),
  (31, 'B1F-7', '공조실-3', '1층 롤렉스,버버리, 구찌, 디올, 로로피아나'),
  (32, 'B1F-6', '공조실-4', '1층 보테가베네타, 티파니앤코,벨루티'),
  (33, 'B1F-5', '공조실-1', '1층 에르메스, 샤넬'),
  (34, 'B1F-4', '공조실-1', '1층 까르띠에 불가리, 발렌티노 반클리프, 쇼메'),
  (35, 'B1F-2', '공조실-1', '지하1층 아디파,화장품 코너'),
  (36, 'B1F-1', '공조실-1', '지하1층 노하스, 알렉산드로,고디바'),
  (37, 'B3F-1', '공조실-1', 'B3층 직원식당 홀, 세정실,매점'),
  (38, 'B3F-HVU1', '공조실-1', 'B3층 직원식당 주방 (외조기)')
on conflict (seq) do nothing;

-- 칸 이름 → [최저, 최고]
create or replace function public.ws_ahu_range(p_key text)
returns numeric[] language sql immutable set search_path = public as $$
  select (case when p_key like 'out_t%' then array[-30, 50] when p_key like 'out_h%' then array[0, 100]
               when p_key like 'cw_t%' then array[-5, 50] else array[-10, 50] end)::numeric[];
$$;

-- 서명란 (사용자 11-19): 그날 로그인 서명한 사람 중에서
--  · 소장 칸  = 소장 > 부소장 (직원 탭 역할 또는 그 달 근무표 직책)
--  · 파트장 칸 = 기계·건축 파트장 > 냉동장 (근무표 직책. 근무표가 없으면 직원 탭 「파트장」 + 파트 기건·기계)
--  같은 순위가 여럿이면 먼저 서명한 사람. 아무도 없으면 빈 칸
create or replace function public.ws_ahu_signs(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  with sg as (
    select s.name, s.signed_at, public.ws_file_url(s.sign_file_id) img, coalesce(st.role, '') srole, coalesce(st.part, '') spart,
           coalesce(r.section, '') rsec, coalesce(r.role, '') rrole
    from public.signs s left join public.staff st using (staff_id)
    left join lateral (select section, role from public.roster where ym = to_char(p_day, 'YYYY-MM') and name = s.name and not deleted order by seq limit 1) r on true
    where s.work_day = p_day and not s.deleted and s.sign_file_id is not null),
  rk as (
    select name, img, signed_at,
           case when srole = '소장' or rrole = '소장' then 1 when srole = '부소장' or rrole = '부소장' then 2 end boss,
           case when rrole like '%파트장%' and rsec ~ '기계|건축' then 1
                when rrole = '' and srole = '파트장' and spart ~ '기건|기계|건축' then 1
                when rrole like '%냉동%' then 2 end part
    from sg)
  select jsonb_build_object(
    'boss', (select jsonb_build_object('name', name, 'img', img) from rk where boss is not null order by boss, signed_at limit 1),
    'part', (select jsonb_build_object('name', name, 'img', img) from rk where part is not null order by part, signed_at limit 1));
$$;

-- 화면이 받는 모양: 목록 · 그날 기록 · 종합업무일지 날씨
create or replace function public.ws_ahu_data(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'day', p_day, 'workDay', public.ws_work_day(), 'signs', public.ws_ahu_signs(p_day),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('no', no, 'room', room, 'place', place) order by seq), '[]'::jsonb) from public.ahu_unit where active),
    'rec', (select jsonb_build_object('out_t12', t.out_t12, 'out_t16', t.out_t16, 'out_h12', t.out_h12, 'out_h16', t.out_h16, 'cw_t12', t.cw_t12, 'cw_t16', t.cw_t16,
                     'temps', t.temps, 'authors', to_jsonb(t.authors), 'by', coalesce(t.editor, ''), 'ver', public.ws_ver(t.updated_at),
                     'pdf', case when t.pdf_file_id is null then null else jsonb_build_object('url', public.ws_file_url(t.pdf_file_id), 'at', public.ws_ver(t.pdf_at)) end)
            from public.ahu_temp t where t.log_date = p_day),
    'wx', (select jsonb_build_object('weather', coalesce(l.weather, ''), 'tmin', l.t_min, 'tmax', l.t_max, 'humidity', l.humidity)
           from public.daily_log l where l.log_date = p_day and not l.deleted));
$$;

create or replace function public.ws_ahu_get(p_token text, p_day text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date;
begin
  perform public.ws_auth(p_token);
  d := case when coalesce(p_day, '') = '' then public.ws_work_day() else public.ws_date(p_day) end;
  if d is null or d > public.ws_work_day() then return jsonb_build_object('ok', false, 'error', '일자가 맞지 않습니다'); end if;
  return public.ws_ahu_data(d);
end $$;

-- p_c = 고친 칸만: { "out_t12": "9.8", "temps": { "7F-39": { "16": "22.7" } } }. 빈 글자 = 지움
create or replace function public.ws_ahu_save(p_token text, p_day text, p_c jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  cols text[] := array['out_t12', 'out_t16', 'out_h12', 'out_h16', 'cw_t12', 'cw_t16'];
  nm jsonb := '{"out_t":"외기온도","out_h":"습도","cw_t":"냉수공급온도"}';
  c jsonb := coalesce(p_c, '{}'::jsonb);
  v jsonb := '{}'::jsonb;     -- 숫자로 바꾼 값 (null = 지움)
  tp jsonb := '{}'::jsonb;    -- 공조기 고친 칸
  k text; u text; h text; raw text; n numeric; rg numeric[];
  tt jsonb;
begin
  if d is null or d > public.ws_work_day() then return jsonb_build_object('ok', false, 'error', '일자가 맞지 않습니다'); end if;
  for k, raw in select key, value from jsonb_each_text(c - 'temps') loop
    if not (k = any (cols)) then return jsonb_build_object('ok', false, 'error', '알 수 없는 칸입니다'); end if;
    raw := btrim(coalesce(raw, ''));
    if raw = '' then v := v || jsonb_build_object(k, null); continue; end if;
    rg := public.ws_ahu_range(k);
    if raw !~ '^-?\d+(\.\d+)?$' or raw::numeric < rg[1] or raw::numeric > rg[2] then
      return jsonb_build_object('ok', false, 'error', (nm->>left(k, 5)) || ' ' || case right(k, 2) when '12' then '11' else right(k, 2) end || ':00 칸은 ' || rg[1] || ' ~ ' || rg[2] || ' 숫자로 넣어 주세요');
    end if;
    v := v || jsonb_build_object(k, round(raw::numeric, 1));
  end loop;
  if jsonb_typeof(c->'temps') = 'object' then
    for u in select jsonb_object_keys(c->'temps') loop
      if not exists (select 1 from public.ahu_unit where no = u and active) then return jsonb_build_object('ok', false, 'error', '공조기 ' || u || '은(는) 목록에 없습니다'); end if;
      if jsonb_typeof(c->'temps'->u) <> 'object' then continue; end if;
      for h, raw in select key, value from jsonb_each_text(c->'temps'->u) loop
        if h not in ('12', '16') then return jsonb_build_object('ok', false, 'error', '점검 시각은 11:00·16:00만 됩니다'); end if;
        raw := btrim(coalesce(raw, ''));
        n := null;
        if raw <> '' then
          if raw !~ '^-?\d+(\.\d+)?$' or raw::numeric < -10 or raw::numeric > 50 then
            return jsonb_build_object('ok', false, 'error', u || ' ' || case h when '12' then '11' else h end || ':00 환기온도는 -10 ~ 50 숫자로 넣어 주세요');
          end if;
          n := round(raw::numeric, 1);
        end if;
        tp := jsonb_set(tp, array[u], coalesce(tp->u, '{}'::jsonb) || jsonb_build_object(h, n));
      end loop;
    end loop;
  end if;
  if v = '{}'::jsonb and tp = '{}'::jsonb then return public.ws_ahu_data(d); end if;
  perform pg_advisory_xact_lock(hashtext('ws_ahu_' || d));
  insert into public.ahu_temp (log_date) values (d) on conflict (log_date) do nothing;
  select temps into tt from public.ahu_temp where log_date = d;
  -- 공조기마다 고친 시각만 덮고, 둘 다 비면 그 공조기를 뺌
  for u in select jsonb_object_keys(tp) loop
    tt := jsonb_set(tt, array[u], jsonb_strip_nulls(coalesce(tt->u, '{}'::jsonb) || (tp->u)));
    if tt->u = '{}'::jsonb then tt := tt - u; end if;
  end loop;
  update public.ahu_temp set
    out_t12 = case when v ? 'out_t12' then (v->>'out_t12')::numeric else out_t12 end,
    out_t16 = case when v ? 'out_t16' then (v->>'out_t16')::numeric else out_t16 end,
    out_h12 = case when v ? 'out_h12' then (v->>'out_h12')::numeric else out_h12 end,
    out_h16 = case when v ? 'out_h16' then (v->>'out_h16')::numeric else out_h16 end,
    cw_t12  = case when v ? 'cw_t12'  then (v->>'cw_t12')::numeric  else cw_t12  end,
    cw_t16  = case when v ? 'cw_t16'  then (v->>'cw_t16')::numeric  else cw_t16  end,
    temps = tt,
    authors = case when me.name = any (authors) then authors else array_append(authors, me.name) end,
    editor = me.name, updated_at = clock_timestamp()
  where log_date = d;
  perform public.ws_log(me.name, '공조기 환기온도 저장', d::text, (select count(*) from jsonb_object_keys(tp)) || '대');
  return public.ws_ahu_data(d);
end $$;

-- PDF (B4 가로, 화면에서 만들어 버킷에 올린 뒤) — 옛 PDF 파일은 지우지 않음 (주 1회 드라이브로 같이 옮겨짐, 03_docs.sql 과 같음)
create or replace function public.ws_ahu_save_pdf(p_token text, p_day text, p_file jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  fid uuid;
begin
  if d is null or not exists (select 1 from public.ahu_temp where log_date = d) then return jsonb_build_object('ok', false, 'error', '먼저 [저장]을 눌러 주세요'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_ahu_' || d));
  fid := public.ws_add_file('ahu_pdf', p_file, 'application/pdf', d || '_공조기환기온도.pdf',
                            '서류작업/공조기환기온도/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM'), me.name);
  update public.ahu_temp set pdf_file_id = fid, pdf_at = clock_timestamp() where log_date = d;
  perform public.ws_log(me.name, '공조기 환기온도 PDF', d::text, '');
  return public.ws_ahu_data(d);
end $$;

-- 권한: 도우미는 막음. 로그인 기기만 3개
revoke all on function public.ws_ahu_range(text), public.ws_ahu_data(date), public.ws_ahu_signs(date), public.ws_ahu_get(text, text), public.ws_ahu_save(text, text, jsonb),
  public.ws_ahu_save_pdf(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ws_ahu_get(text, text), public.ws_ahu_save(text, text, jsonb), public.ws_ahu_save_pdf(text, text, jsonb) to authenticated;
