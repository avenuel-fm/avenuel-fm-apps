-- ============================================================================
-- 도면협의(DW) → Supabase 이관 4: 구글 Apps Script(관리자 열쇠 service_role)만 부르는 함수
-- 실행: 03_api.sql 다음. 여러 번 돌려도 안전.
--  · 메일(서명 요청·서류 요청·시방서) — 메일은 계속 구글(Gmail)에서 보냄. 화면 → 도면협의 웹앱 → 여기
--  · 시트 → DB 한 번 옮기기, 주 1회 드라이브 옮기기 · 백업, PIN·바로가기 주소 넣기, 연결 확인
-- 앱 화면(anon·로그인 기기)은 못 부름 (맨 아래 grant 가 service_role 뿐)
-- ============================================================================

/** 화면이 보낸 로그인 정보 확인 (웹앱이 메일 보내기 전에) */
create or replace function public.dw_svc_role(p_a jsonb) returns text language plpgsql security definer set search_path = public, extensions as $$
begin return public.dw_role_(p_a); end $$;

/** 매장 + 그 차수 검토서 (+ 바로가기 주소 · 안전관리팀/영업팀 메일 기억) */
create or replace function public.dw_svc_get(p_store text, p_round int) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.dw_stores; r public.dw_reviews;
begin
  select * into s from public.dw_stores where id = p_store;
  if not found then return null; end if;
  select * into r from public.dw_reviews where store_id = p_store and round = p_round;
  return jsonb_build_object('store', public.dw_store_out_(s), 'review', case when r.id is null then null else public.dw_review_out_(r) end,
    'shortcut', coalesce(public.dw_set_get('바로가기주소'), ''), 'sigEmails', public.dw_json(public.dw_set_get('SIG_EMAILS'), '{}'));
end $$;

/** 메일을 보낸 뒤 기록: 매장 칸 고치기 + 서명 요청 칸 합치기 + 발송 기록 한 줄 + 변경기록 (한 번에, 잠금 안에서) */
create or replace function public.dw_svc_record(p_store text, p_patch jsonb, p_pending jsonb, p_sendlog jsonb, p_log jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.dw_stores; pm jsonb;
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
  if p_patch is not null and p_patch <> '{}' then perform public.dw_store_patch_(p_store, p_patch); end if;
  if p_pending is not null and p_pending <> '{}' then
    select public.dw_json(data->>'sigPending', '{}') into pm from public.dw_stores where id = p_store;
    if jsonb_typeof(pm) <> 'object' then pm := '{}'; end if;
    perform public.dw_store_patch_(p_store, jsonb_build_object('sigPending', (pm || p_pending)::text));
  end if;
  if p_sendlog is not null then perform public.dw_sendlog_add_(p_store, p_sendlog); end if;
  if p_log is not null then perform public.dw_log_(p_log->>'who', p_log->>'action', p_store, s.data->>'docNo', p_log->>'detail'); end if;
  return (select public.dw_store_out_(x) from public.dw_stores x where x.id = p_store);
end $$;

/** 원격 서명 링크 표 넣기 [{h, who, email, exp(ms), pdf_url, by}] — 같은 칸의 예전 링크(sigPending 의 h)는 끝냄 */
create or replace function public.dw_svc_sign_put(p_store text, p_round int, p_rows jsonb) returns void language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; pm jsonb;
begin
  perform public.dw_lock();
  select public.dw_json(data->>'sigPending', '{}') into pm from public.dw_stores where id = p_store;
  delete from public.dw_sign_tokens where exp < now();   -- 기간 지난 링크 정리 (Code.gs cleanSigTokens_)
  for x in select e from jsonb_array_elements(coalesce(p_rows, '[]')) e loop
    if jsonb_typeof(pm) = 'object' and pm->(p_round || ':' || (x->>'who'))->>'h' is not null then
      delete from public.dw_sign_tokens where h = pm->(p_round || ':' || (x->>'who'))->>'h';
    end if;
    insert into public.dw_sign_tokens (h, store_id, round, who, email, exp, pdf_url, by_role)
    values (x->>'h', p_store, p_round, x->>'who', x->>'email', to_timestamp((x->>'exp')::bigint / 1000.0), x->>'pdf_url', x->>'by')
    on conflict (h) do nothing;
  end loop;
end $$;

/** 설정 한 칸 넣기 (PIN_소장 · PIN_부소장 · 바로가기주소 · SIG_EMAILS) — 시트 메뉴 ③·④·⑧ 이 함께 씀 */
create or replace function public.dw_svc_setting(p_key text, p_value text) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_key not in ('PIN_소장', 'PIN_부소장', '바로가기주소', 'SIG_EMAILS') then raise exception '넣을 수 없는 설정: %', p_key; end if;
  perform public.dw_set_put(p_key, coalesce(p_value, ''));
  if p_key like 'PIN\_%' then perform public.dw_set_put('PIN_FAIL', '{}'); end if;
end $$;

/** PDF 를 웹앱이 받았을 때(서명 요청) 파일 줄 정보 — 화면이 이미 dw_pdf_saved 로 적은 줄 */
create or replace function public.dw_svc_file(p_id text) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select public.dw_file_out_(f) || jsonb_build_object('kind', f.kind, 'store_id', f.store_id, 'drive_folder', f.drive_folder)
  from public.dw_files f where (f.id::text = p_id or f.drive_id = p_id) and not f.trash limit 1 $$;

/* ───────── 시트 → DB 한 번 옮기기 (Supa.gs 메뉴 ⑩) ───────── */
create or replace function public.dw_migrate_clear() returns void language sql security definer set search_path = public as $$
  truncate table public.dw_reviews, public.dw_stores, public.dw_rules, public.dw_phrases, public.dw_synonyms, public.dw_log, public.dw_deleted,
    public.dw_sign_tokens, public.dw_guides, public.dw_guide_build, public.dw_settings, public.dw_files restart identity cascade $$;

/* ───────── 주 1회: DB 백업 (표 하나를 JSON 하나로) ───────── */
create or replace function public.dw_backup(p_table text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_table is null or not (p_table = any (array['dw_files', 'dw_settings', 'dw_stores', 'dw_reviews', 'dw_rules', 'dw_phrases', 'dw_synonyms',
      'dw_log', 'dw_deleted', 'dw_sign_tokens', 'dw_guides'])) then
    raise exception '백업할 수 없는 표: %', p_table;
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from public.%I t', p_table) into r;
  return r;
end $$;

/* ───────── 연결 확인 (메뉴 ⑬, 읽기만) ───────── */
create or replace function public.dw_check_setup() returns jsonb language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
    'bucket', (select public from storage.buckets where id = 'dw-files'),
    'pin', jsonb_build_object('소장', coalesce(public.dw_set_get('PIN_소장'), '') <> '', '부소장', coalesce(public.dw_set_get('PIN_부소장'), '') <> ''),
    'shortcut', coalesce(public.dw_set_get('바로가기주소'), ''),
    'counts', jsonb_build_object('매장', (select count(*) from public.dw_stores), '검토서', (select count(*) from public.dw_reviews),
      '파일', (select count(*) from public.dw_files), '버킷 파일', (select count(*) from public.dw_files where storage_path is not null and not trash),
      '지울 파일', (select count(*) from public.dw_files where trash), '지침', (select count(*) from public.dw_guides), '변경기록', (select count(*) from public.dw_log))) $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'dw\_svc\_%' or p.proname in ('dw_migrate_clear', 'dw_backup', 'dw_check_setup')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
