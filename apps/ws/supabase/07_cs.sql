-- ============================================================================
-- 업무지원(WS) → Supabase 이관 3-5 묶음 (2): 공사장 점검 DB 함수
-- 기준: apps/ws/src/Code.gs v0.9.14 csHome · csSiteSave · csSiteEnd · csItemsSave · csGet · csSave · csSavePdf
-- 실행: 06 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.13
--
--  · 사진·PDF는 화면 통로가 버킷(cs_photo/·cs_pdf/)에 먼저 올리고 주소·경로만 넘김. 점검 항목(items)의 사진 id = files.id
--  · 뺀 사진·예전 PDF는 지우지 않음 (5단계 드라이브 옮기기 때 함께 정리)
-- ============================================================================

-- 기본 점검 항목 9개 (Code.gs CS_SEED, 「점검에 넣기」 = 정리정돈·통로 · 안전수칙 위반) — 표가 비었을 때만
insert into public.cs_items (seq, item, descr, active, in_check, changed_by, changed_at)
select o, t, d, true, t in ('정리정돈·통로', '안전수칙 위반'), '처음 목록', now()
from (values
  (1, '비치서류', '공정표, 위험성평가표, 작업허가서, MSDS(물질안전보건자료), 작업자 명단 비치'),
  (2, '화기작업 관리', '화기작업 허가, 불티 방지포, 소화기 2대·화재감시자 배치, 작업 후 30분 잔불 확인'),
  (3, '위험물 보관', '인화성 물질(도료·시너·가스) 격리 보관, 보관함 잠금, 반입량 최소'),
  (4, '소방시설 보호', '감지기 덮개 작업 후 해제, 스프링클러·소화전·방화셔터 앞 막힘 없음'),
  (5, '전기 안전', '임시 분전반 누전차단기, 전선 피복 손상·문어발 없음, 퇴근 시 전원 차단'),
  (6, '개인 보호구', '안전모·안전화 착용, 고소작업 시 안전대 체결'),
  (7, '고소·사다리 작업', '말비계·사다리 고정, 2인 1조, 작업 구간 통제'),
  (8, '정리정돈·통로', '자재 적치 정돈, 피난통로·비상구 확보, 가림막·출입 통제'),
  (9, '안전수칙 위반', '흡연, 음주, 무단 화기 사용, 개구부 덮개 미설치 등')) v(o, t, d)
where not exists (select 1 from public.cs_items);

create or replace function public.ws_cs_rounds()
returns text[] language sql immutable set search_path = public as $$ select array['오후점검', '퇴실점검', '추가 점검']; $$;

create or replace function public.ws_cs_items_()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('t', item, 'd', coalesce(descr, ''), 'use', in_check) order by seq), '[]'::jsonb) from public.cs_items where active and item <> '';
$$;

create or replace function public.ws_cs_sites_()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', cs_id, 'name', name, 'work', coalesce(work, ''), 'co', coalesce(company, '')) order by created_at, cs_id), '[]'::jsonb)
  from public.cs_sites where active;
$$;

-- 점검 한 줄 (Code.gs csCheckOut_ — 항목은 안 보냄)
create or replace function public.ws_cs_check_out(r public.cs_checks)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when r.ck_id is null then null else jsonb_build_object('id', r.ck_id, 'date', r.check_day::text, 'site', r.cs_id, 'round', r.round, 'name', r.site_name,
    'work', coalesce(r.work, ''), 'co', coalesce(r.company, ''), 'by', coalesce(r.checker, ''), 'at', public.ws_kst(r.checked_at),
    'ok', coalesce(r.n_good, 0), 'bad', coalesce(r.n_bad, 0), 'na', coalesce(r.n_na, 0), 'saved', public.ws_kst(r.updated_at),
    'pdf', case when r.pdf_file_id is not null then jsonb_build_object('url', public.ws_file_url(r.pdf_file_id), 'at', public.ws_kst(r.pdf_at)) end,
    'stale', r.pdf_file_id is not null and r.updated_at > r.pdf_at) end;
$$;

-- 그날 그 현장의 점검들 (회차 순)
create or replace function public.ws_cs_rounds_(p_day date, p_site text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.ws_cs_check_out(c) order by c.round), '[]'::jsonb) from public.cs_checks c where c.check_day = p_day and c.cs_id = p_site and not c.deleted;
$$;

create or replace function public.ws_cs_admin(me public.staff)
returns boolean language sql immutable set search_path = public as $$ select me.role in ('관리자', '소장'); $$;

create or replace function public.ws_cs_home(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_work_day();
begin
  return jsonb_build_object('ok', true, 'day', d::text, 'admin', public.ws_cs_admin(me), 'items', public.ws_cs_items_(), 'sites', public.ws_cs_sites_(),
    'today', coalesce((select jsonb_agg(public.ws_cs_check_out(c) order by c.ck_id) from public.cs_checks c where not c.deleted and c.check_day = d), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(public.ws_cs_check_out(c) order by c.check_day desc, c.ck_id) from public.cs_checks c where not c.deleted and c.check_day < d), '[]'::jsonb));
end $$;

-- 현장 추가·고치기 (누구나). id 있으면 고침
create or replace function public.ws_cs_site_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_name text := public.ws_clean(p_d->>'name', 30);
  v_work text := public.ws_clean(p_d->>'work', 30);
  v_co text := public.ws_clean(p_d->>'co', 30);
  v_id text := coalesce(p_d->>'id', '');
begin
  if v_name = '' then return jsonb_build_object('ok', false, 'error', '현장 이름을 넣어 주세요. (예: 5F 리모와)'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_cs_site'));
  if v_id <> '' and not exists (select 1 from public.cs_sites where cs_id = v_id and active) then
    return jsonb_build_object('ok', false, 'error', '현장을 찾지 못했습니다. 새로고침해 주세요.');
  end if;
  if exists (select 1 from public.cs_sites where active and name = v_name and cs_id <> v_id) then
    return jsonb_build_object('ok', false, 'error', '「' || v_name || '」 현장이 이미 있습니다.');
  end if;
  if v_id <> '' then
    update public.cs_sites set name = v_name, work = v_work, company = v_co where cs_id = v_id;
    perform public.ws_log(me.name, '공사 현장 고침', v_id, v_name);
  else
    v_id := public.ws_next_id('CS', array(select cs_id from public.cs_sites));
    insert into public.cs_sites (cs_id, name, work, company, active, created_at, created_by) values (v_id, v_name, v_work, v_co, true, clock_timestamp(), me.name);
    perform public.ws_log(me.name, '공사 현장 추가', v_id, v_name);
  end if;
  return jsonb_build_object('ok', true, 'sites', public.ws_cs_sites_());
end $$;

-- 공사 끝: 목록에서 뺌 (지난 점검·PDF는 그대로)
create or replace function public.ws_cs_site_end(p_token text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  v_name text;
begin
  update public.cs_sites set active = false, ended_at = clock_timestamp() where cs_id = p_id and active returning name into v_name;
  if v_name is null then return jsonb_build_object('ok', false, 'error', '현장을 찾지 못했습니다.'); end if;
  perform public.ws_log(me.name, '공사 끝', p_id, v_name);
  return jsonb_build_object('ok', true, 'sites', public.ws_cs_sites_());
end $$;

-- 기본 항목 바꾸기 (관리자·소장만): 목록 전체 [{t, d, use}]를 순서대로. 빠진 항목은 사용 안 함(줄은 남김, 뒤로)
create or replace function public.ws_cs_items_save(p_token text, p_list jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  n int := case when jsonb_typeof(p_list) = 'array' then jsonb_array_length(p_list) else 0 end;
  at timestamptz := clock_timestamp();
  x record;
  hit int;
begin
  if not public.ws_cs_admin(me) then return jsonb_build_object('ok', false, 'error', '기본 항목은 관리자·소장만 고칠 수 있습니다.'); end if;
  if n < 1 or n > 30 then return jsonb_build_object('ok', false, 'error', '항목은 1~30개로 해 주세요.'); end if;
  if exists (select 1 from jsonb_array_elements(p_list) e where public.ws_clean(e->>'t', 30) = '') then return jsonb_build_object('ok', false, 'error', '항목 이름이 빈 줄이 있습니다.'); end if;
  if not exists (select 1 from jsonb_array_elements(p_list) e where e->>'use' = 'true') then return jsonb_build_object('ok', false, 'error', '「점검에 넣기」 항목을 1개 이상 골라 주세요.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_cs_items'));
  update public.cs_items set seq = seq + 100000;   -- 순서(seq)를 새로 매기려고 잠시 비켜 둠
  for x in select public.ws_clean(e->>'t', 30) t, public.ws_clean(e->>'d', 100) d, e->>'use' = 'true' u, o::int o from jsonb_array_elements(p_list) with ordinality a(e, o) loop
    hit := null;
    update public.cs_items set seq = x.o, descr = x.d, active = true, in_check = x.u, changed_by = me.name, changed_at = at
    where seq = (select min(seq) from public.cs_items where seq >= 100000 and item = x.t) returning seq into hit;
    if hit is null then
      insert into public.cs_items (seq, item, descr, active, in_check, changed_by, changed_at) values (x.o, x.t, x.d, true, x.u, me.name, at);
    end if;
  end loop;
  update public.cs_items set active = false, changed_by = me.name, changed_at = at where seq >= 100000 and active;
  update public.cs_items c set seq = n + k.r from (select seq s, row_number() over (order by seq) r from public.cs_items where seq >= 100000) k where c.seq = k.s;
  perform public.ws_log(me.name, '공사 점검 기본 항목', '', (select string_agg(case when e->>'use' = 'true' then '[점검] ' else '' end || public.ws_clean(e->>'t', 30), ', ' order by o)
                                                        from jsonb_array_elements(p_list) with ordinality a(e, o)));
  return jsonb_build_object('ok', true, 'items', public.ws_cs_items_());
end $$;

create or replace function public.ws_cs_day(p text)
returns date language sql stable set search_path = public as $$ select coalesce(public.ws_date(p), public.ws_work_day()); $$;

-- 현장 하나의 그날 한 회차. 회차를 안 주면 아직 안 한 회차 (둘 다 했으면 퇴실점검)
create or replace function public.ws_cs_get(p_token text, p_date text, p_site text, p_round int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d date := public.ws_cs_day(p_date);
  rd int := case when p_round between 1 and 3 then p_round end;
  r public.cs_checks;
  site jsonb;
  items jsonb;
begin
  perform public.ws_auth(p_token);
  if rd is null then
    rd := coalesce((select min(k) from unnest(array[1, 2]) k where not exists (select 1 from public.cs_checks where check_day = d and cs_id = p_site and not deleted and round = k)), 2);
  end if;
  select * into r from public.cs_checks where check_day = d and cs_id = p_site and not deleted and round = rd;
  site := case when r.ck_id is not null then jsonb_build_object('id', r.cs_id, 'name', r.site_name, 'work', coalesce(r.work, ''), 'co', coalesce(r.company, ''))
               else (select jsonb_build_object('id', cs_id, 'name', name, 'work', coalesce(work, ''), 'co', coalesce(company, '')) from public.cs_sites where cs_id = p_site and active) end;
  if site is null then return jsonb_build_object('ok', false, 'error', '현장을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  if r.ck_id is not null then
    select coalesce(jsonb_agg((x - 'photos') || jsonb_build_object('photos', coalesce((
             select jsonb_agg(jsonb_build_object('id', p->>'id', 'at', coalesce(p->>'at', ''), 'src', case when p->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.ws_file_url((p->>'id')::uuid) else '' end) order by po)
             from jsonb_array_elements(coalesce(x->'photos', '[]'::jsonb)) with ordinality q(p, po)), '[]'::jsonb)) order by xo), '[]'::jsonb)
      into items from jsonb_array_elements(r.items) with ordinality a(x, xo);
  else
    select coalesce(jsonb_agg(jsonb_build_object('t', item, 'd', coalesce(descr, ''), 'st', '', 'memo', '', 'photos', '[]'::jsonb) order by seq), '[]'::jsonb)
      into items from public.cs_items where active and in_check and item <> '';
  end if;
  return jsonb_build_object('ok', true, 'date', d::text, 'round', rd, 'site', site, 'items', items,
    'check', public.ws_cs_check_out(r), 'rounds', public.ws_cs_rounds_(d, p_site));
end $$;

-- 저장 (자동 저장도 이것): 항목 전체. 새 사진은 { id: '', at, file: {url, path} } (버킷 cs_photo/ 에 먼저 올린 것)
-- 점검자·점검시각 = 처음 저장한 사람·시각 (결정 100)
create or replace function public.ws_cs_save(p_token text, p_date text, p_site text, p_list jsonb, p_round int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_cs_day(p_date);
  rd int := case when p_round between 1 and 3 then p_round else 1 end;
  n int := case when jsonb_typeof(p_list) = 'array' then jsonb_array_length(p_list) else 0 end;
  r public.cs_checks;
  site public.cs_sites;
  old_n jsonb := '{}';   -- 예전 사진 id → 파일 번호. 화면이 보낸 id는 이 점검의 사진일 때만 받음
  seq int;
  base text;
  out_items jsonb := '[]';
  ids jsonb := '[]';
  x jsonb; p jsonb; ph jsonb; pid jsonb;
  fid uuid;
  v_at text;
  v_st text;
  cnt int[] := array[0, 0, 0];
  t timestamptz := clock_timestamp();
  v_id text;
begin
  if n < 1 or n > 30 then return jsonb_build_object('ok', false, 'error', '항목은 1~30개로 해 주세요.'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_cs_' || d || '_' || coalesce(p_site, '')));
  select * into r from public.cs_checks where check_day = d and cs_id = p_site and not deleted and round = rd;
  select * into site from public.cs_sites where cs_id = p_site and (active or r.ck_id is not null);
  if r.ck_id is null and site.cs_id is null then return jsonb_build_object('ok', false, 'error', '현장을 찾지 못했습니다. 새로고침해 주세요.'); end if;
  if r.ck_id is not null then
    select coalesce(jsonb_object_agg(op->>'id', coalesce((op->>'n')::int, 0)), '{}') into old_n
    from jsonb_array_elements(r.items) a(x0), jsonb_array_elements(coalesce(x0->'photos', '[]'::jsonb)) b(op);
  end if;
  seq := greatest(coalesce(r.photo_seq, 0), coalesce((select max(v::int) from jsonb_each_text(old_n) e(k, v)), 0));   -- 지운 사진 번호도 다시 안 씀
  base := d || '_공사장점검-' || public.ws_safe_name(coalesce(r.site_name, site.name)) || '_' || (public.ws_cs_rounds())[rd];
  for x in select e from jsonb_array_elements(p_list) e loop
    x := case when jsonb_typeof(x) = 'object' then x else '{}'::jsonb end;
    ph := '[]'; pid := '[]';
    for p in select e from jsonb_array_elements(case when jsonb_typeof(x->'photos') = 'array' then x->'photos' else '[]'::jsonb end) e limit 6 loop
      v_at := case when coalesce(p->>'at', '') ~ '^\d{1,2}:\d{2}$' then p->>'at' else '' end;
      if p ? 'file' and jsonb_typeof(p->'file') = 'object' then
        seq := seq + 1;
        fid := public.ws_add_file('cs_photo', p->'file', 'image/jpeg', base || '_' || lpad(seq::text, 3, '0') || '.jpg',
                                  '점검/공사장점검/' || to_char(d, 'YYYY') || '/' || to_char(d, 'YYYY-MM'), me.name);
        ph := ph || jsonb_build_object('id', fid::text, 'at', v_at, 'n', seq);
        pid := pid || to_jsonb(fid::text);
      elsif old_n ? coalesce(p->>'id', '') then
        ph := ph || jsonb_build_object('id', p->>'id', 'at', v_at, 'n', (old_n->>(p->>'id'))::int);
        pid := pid || to_jsonb(p->>'id');
      end if;
    end loop;
    v_st := case when x->>'st' in ('양호', '미흡', '해당없음') then x->>'st' else '' end;
    if v_st <> '' then cnt[array_position(array['양호', '미흡', '해당없음'], v_st)] := cnt[array_position(array['양호', '미흡', '해당없음'], v_st)] + 1; end if;
    out_items := out_items || jsonb_build_object('t', coalesce(nullif(public.ws_clean(x->>'t', 30), ''), '(이름 없음)'), 'd', public.ws_clean(x->>'d', 100), 'st', v_st,
      'memo', left(btrim(regexp_replace(coalesce(x->>'memo', ''), '[\x01-\x09\x0b-\x1f<>]', '', 'g')), 300), 'extra', coalesce(x->>'extra', '') = 'true', 'photos', ph);
    ids := ids || jsonb_build_array(pid);
  end loop;
  if r.ck_id is not null then
    v_id := r.ck_id;
    update public.cs_checks set items = out_items, photo_seq = seq, n_good = cnt[1], n_bad = cnt[2], n_na = cnt[3], updated_at = t, edited_by = me.name where ck_id = v_id;
  else
    v_id := public.ws_next_id('CK', array(select ck_id from public.cs_checks));
    insert into public.cs_checks (ck_id, check_day, cs_id, site_name, work, company, checker_id, checker, checked_at, items, n_good, n_bad, n_na, photo_seq, updated_at, edited_by, deleted, round)
    values (v_id, d, p_site, site.name, site.work, site.company, me.staff_id, me.name, t, out_items, cnt[1], cnt[2], cnt[3], seq, t, me.name, false, rd);
  end if;
  select * into r from public.cs_checks where ck_id = v_id;
  return jsonb_build_object('ok', true, 'items', ids, 'check', public.ws_cs_check_out(r), 'rounds', public.ws_cs_rounds_(d, p_site));
end $$;

-- 화면이 만든 A4 PDF (현장마다 하루 1개)를 그날 그 현장의 모든 회차에 적음
create or replace function public.ws_cs_save_pdf(p_token text, p_ck_id text, p_file jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r public.cs_checks;
  fid uuid;
  t timestamptz := clock_timestamp();
begin
  select * into r from public.cs_checks where ck_id = p_ck_id and not deleted;
  if r.ck_id is null then return jsonb_build_object('ok', false, 'error', '먼저 저장해 주세요'); end if;
  perform pg_advisory_xact_lock(hashtext('ws_cs_' || r.check_day || '_' || r.cs_id));
  fid := public.ws_add_file('cs_pdf', p_file, 'application/pdf', r.check_day || '_공사장점검-' || public.ws_safe_name(r.site_name) || '.pdf',
                            '점검/공사장점검/' || to_char(r.check_day, 'YYYY') || '/' || to_char(r.check_day, 'YYYY-MM'), me.name);
  update public.cs_checks set pdf_file_id = fid, pdf_at = t where check_day = r.check_day and cs_id = r.cs_id and not deleted;
  perform public.ws_log(me.name, '공사장 점검 PDF', p_ck_id, r.check_day || ' · ' || r.site_name);
  select * into r from public.cs_checks where ck_id = p_ck_id;
  return jsonb_build_object('ok', true, 'check', public.ws_cs_check_out(r), 'rounds', public.ws_cs_rounds_(r.check_day, r.cs_id), 'warn', '');
end $$;

-- ---------------------------------------------------------------------------
-- 권한: 도우미는 막음. 로그인 기기만 7개
-- ---------------------------------------------------------------------------
revoke all on function public.ws_cs_rounds(), public.ws_cs_items_(), public.ws_cs_sites_(), public.ws_cs_check_out(public.cs_checks), public.ws_cs_rounds_(date, text),
  public.ws_cs_admin(public.staff), public.ws_cs_home(text), public.ws_cs_site_save(text, jsonb), public.ws_cs_site_end(text, text), public.ws_cs_items_save(text, jsonb),
  public.ws_cs_day(text), public.ws_cs_get(text, text, text, int), public.ws_cs_save(text, text, text, jsonb, int), public.ws_cs_save_pdf(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ws_cs_home(text), public.ws_cs_site_save(text, jsonb), public.ws_cs_site_end(text, text), public.ws_cs_items_save(text, jsonb),
  public.ws_cs_get(text, text, text, int), public.ws_cs_save(text, text, text, jsonb, int), public.ws_cs_save_pdf(text, text, jsonb) to authenticated;
