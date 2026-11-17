-- ============================================================================
-- 도면협의(DW) → Supabase 이관 3: 화면이 부르는 DB 함수 (Code.gs api* 와 같은 일 · 같은 답 모양)
-- 실행 순서: 01_schema.sql → 02_const.sql → 03_api.sql → 04_service.sql. 여러 번 돌려도 안전.
-- 화면 → fm/dw/dw-api.js → 여기 함수. 모두 security definer (표는 화면이 직접 못 봄 — 01 참고)
-- 첫 값 p_a = 화면의 로그인 정보 { role, token } (로그인 때만 { pin })
-- 오류는 raise exception 의 글이 그대로 화면 안내가 됨 (Code.gs throw new Error 와 같은 글)
-- ============================================================================

/* ───────── 도우미 (화면에서 못 부름 — 맨 아래 revoke) ───────── */
create or replace function public.dw_h(s text) returns text language sql immutable
set search_path = public, extensions as $$ select encode(digest('drawing-review:' || s, 'sha256'), 'hex') $$;   -- Code.gs hash_ 와 같은 값 (옛 PIN·기기 기억이 그대로 통함)

create or replace function public.dw_now_text() returns text language sql stable as $$ select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') $$;
create or replace function public.dw_today() returns text language sql stable as $$ select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') $$;
create or replace function public.dw_ms() returns bigint language sql volatile as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
create or replace function public.dw_lock() returns void language sql as $$ select pg_advisory_xact_lock(7342001) $$;   -- LockService 대신 (끝나면 저절로 풀림)

create or replace function public.dw_json(s text, d jsonb) returns jsonb language plpgsql immutable as $$
begin return coalesce(nullif(s, '')::jsonb, d); exception when others then return d; end $$;
create or replace function public.dw_int(s text, d int) returns int language sql immutable as $$
  select case when coalesce(s, '') ~ '^\s*-?\d{1,9}(\.0+)?\s*$' then round(s::numeric)::int else d end $$;

create or replace function public.dw_set_get(k text) returns text language sql stable as $$ select value from public.dw_settings where key = k $$;
create or replace function public.dw_set_put(k text, v text) returns void language sql as $$
  insert into public.dw_settings (key, value) values (k, v) on conflict (key) do update set value = excluded.value $$;

create or replace function public.dw_log_(who text, act text, sid text, doc text, detail text) returns void language sql as $$
  insert into public.dw_log (who, action, store_id, doc_no, detail) values (who, act, nullif(sid, ''), nullif(doc, ''), nullif(detail, '')) $$;

/** JS !!v */
create or replace function public.dw_truthy(v jsonb) returns boolean language sql immutable as $$
  select case when v is null then false else case jsonb_typeof(v) when 'boolean' then v::text = 'true' when 'number' then v::text::numeric <> 0
    when 'string' then v #>> '{}' <> '' when 'null' then false else true end end $$;

/* ───────── 로그인 (Code.gs auth_ · pinGate_ · pinFail_ , 결정 39·41) ───────── */
create or replace function public.dw_pin_gate_() returns text language plpgsql as $$
declare v jsonb := public.dw_json(public.dw_set_get('PIN_FAIL'), '{}'); n bigint := public.dw_ms(); lk bigint := 0;
begin
  if (v->>'lock') ~ '^\d+$' then lk := (v->>'lock')::bigint; end if;
  if lk > n then return 'PIN이 여러 번 틀려 ' || ceil((lk - n) / 60000.0)::int || '분 동안 PIN 입력을 막았습니다. 잠시 뒤 다시 해 주세요.'; end if;
  return null;
end $$;

create or replace function public.dw_pin_fail_() returns void language plpgsql as $$
declare v jsonb := public.dw_json(public.dw_set_get('PIN_FAIL'), '{}'); n bigint := public.dw_ms();
  vt bigint := case when (v->>'t') ~ '^\d+$' then (v->>'t')::bigint end;
  vlt bigint := case when (v->>'lt') ~ '^\d+$' then (v->>'lt')::bigint end;
  locks int; lt bigint; cnt int; ms bigint;
begin
  locks := case when coalesce(vlt, 0) > 0 and n - vlt < 6 * 3600000 then coalesce(public.dw_int(v->>'locks', 0), 0) else 0 end;
  lt := case when locks > 0 then vlt else 0 end;
  if vt is null or vt = 0 or n - vt > 600000 then v := jsonb_build_object('n', 0, 't', n); end if;
  cnt := coalesce(public.dw_int(v->>'n', 0), 0) + 1;
  v := v || jsonb_build_object('n', cnt, 'locks', locks, 'lt', lt);
  if cnt >= 20 then
    locks := locks + 1;
    ms := case when locks >= 3 then 3600000 else 600000 end;
    v := jsonb_build_object('n', 0, 't', n, 'lock', n + ms, 'locks', locks, 'lt', case when lt > 0 then lt else n end);
    perform public.dw_log_('보안', 'PIN 입력 잠금', '', '', '10분 안에 20번 틀림 · ' || (ms / 60000) || '분 잠금 (6시간 안 ' || locks || '번째)');
  end if;
  perform public.dw_set_put('PIN_FAIL', v::text);
end $$;

/** 로그인 확인. 틀리면 role 없이 err (틀린 횟수는 저장해야 해서 여기서는 raise 안 함) */
create or replace function public.dw_auth_(a jsonb, out role text, out err text) language plpgsql as $$
declare r text; sv text; anyset boolean := false; h text; roles text[] := array['소장', '부소장'];
begin
  a := coalesce(a, '{}');
  if coalesce(a->>'role', '') = '' and coalesce(a->>'token', '') = '' and a ? 'pin' and jsonb_typeof(a->'pin') <> 'null' then
    err := public.dw_pin_gate_(); if err is not null then return; end if;
    h := public.dw_h(a->>'pin');
    foreach r in array roles loop
      sv := public.dw_set_get('PIN_' || r);
      if coalesce(sv, '') <> '' then anyset := true; end if;
      if sv = h then role := r; return; end if;
    end loop;
    if anyset then perform public.dw_pin_fail_(); err := 'PIN이 맞지 않습니다.'; return; end if;
    err := 'PIN이 아직 설정되지 않았습니다. 시트의 [도면협의] 메뉴에서 PIN을 설정해 주세요.'; return;
  end if;
  r := a->>'role';
  if r is null or not (r = any (roles)) then err := '로그인이 필요합니다.'; return; end if;
  sv := public.dw_set_get('PIN_' || r);
  if coalesce(sv, '') = '' then err := r || ' PIN이 아직 설정되지 않았습니다. 시트의 [도면협의] 메뉴에서 PIN을 설정해 주세요.'; return; end if;
  if coalesce(a->>'token', '') <> '' then
    if a->>'token' <> public.dw_h('token:' || r || ':' || sv) then err := 'PIN이 바뀌었습니다. 새 PIN으로 다시 로그인해 주세요.'; return; end if;
    role := r; return;
  end if;
  err := public.dw_pin_gate_(); if err is not null then return; end if;
  if public.dw_h(coalesce(a->>'pin', '')) <> sv then perform public.dw_pin_fail_(); err := 'PIN이 맞지 않습니다.'; return; end if;
  role := r;
end $$;

/** 로그인 뒤 모든 함수: 기기에 기억한 표(token)만 받음. PIN은 dw_login·dw_start 로만 (틀린 횟수를 세려고) */
create or replace function public.dw_role_(a jsonb) returns text language plpgsql as $$
declare x record;
begin
  if coalesce(a->>'token', '') = '' then raise exception '로그인이 필요합니다.'; end if;
  select * into x from public.dw_auth_(a);
  if x.err is not null then raise exception '%', x.err; end if;
  return x.role;
end $$;

/* ───────── 읽기 모양 (Code.gs cleanStore_ · readReviews_) ───────── */
create or replace function public.dw_store_out_(s public.dw_stores) returns jsonb language sql stable as $$
  select (select jsonb_object_agg(k, coalesce(s.data->k, '""'::jsonb)) from jsonb_array_elements_text(public.dw_const()->'storeKeys') k)
    || jsonb_build_object('id', s.id, 'seq', s.seq, 'currentRound', coalesce(public.dw_int(s.data->>'currentRound', 1), 1)) $$;

create or replace function public.dw_review_out_(r public.dw_reviews) returns jsonb language sql stable as $$
  select (select jsonb_object_agg(k, coalesce(r.data->k, '""'::jsonb))
          from (select jsonb_array_elements_text(public.dw_const()->'reviewMetaKeys') k
                union all select f->>0 from jsonb_array_elements(public.dw_const()->'fields') f) ks)
    || jsonb_build_object('id', r.id, 'storeId', r.store_id, 'round', r.round,
         'rulesAck', coalesce(r.data->>'rulesAck', '') = 'Y', 'chiefOk', coalesce(r.data->>'chiefOk', '') = 'Y') $$;

create or replace function public.dw_stores_list_() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(public.dw_store_out_(s) order by s.seq, s.id), '[]') from public.dw_stores s $$;

create or replace function public.dw_store_get_(sid text) returns jsonb language plpgsql stable as $$
declare s public.dw_stores;
begin
  select * into s from public.dw_stores where id = sid;
  if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
  return jsonb_build_object('store', public.dw_store_out_(s),
    'reviews', (select coalesce(jsonb_agg(public.dw_review_out_(r) order by r.round), '[]') from public.dw_reviews r where r.store_id = sid));
end $$;

create or replace function public.dw_store_patch_(sid text, patch jsonb) returns void language sql as $$
  update public.dw_stores set data = data || patch, updated_at = now() where id = sid $$;

/** 미제출 서류 이름들 (Code.gs docMissing_) */
create or replace function public.dw_doc_missing_(d jsonb) returns text language sql stable as $$
  select coalesce(string_agg(x->>1, ', ' order by o), '') from jsonb_array_elements(public.dw_const()->'docNames') with ordinality e(x, o)
  where d->>(x->>0) = '미제출' $$;

/** 매장 목록 요약을 마지막 차수로 (Code.gs syncStoreFromReviews_) */
create or replace function public.dw_sync_store_(sid text, nowt text) returns void language plpgsql as $$
declare r public.dw_reviews; d jsonb;
begin
  select * into r from public.dw_reviews where store_id = sid order by round desc limit 1;
  if not found then return; end if;
  d := r.data;
  perform public.dw_store_patch_(sid, jsonb_build_object(
    'tenant', coalesce(d->>'tenant', ''), 'location', coalesce(d->>'location', ''), 'storeType', coalesce(d->>'storeType', ''),
    'contractor', coalesce(d->>'contractorCompany', ''), 'openDate', coalesce(d->>'openDate', ''),
    'periodStart', coalesce(d->>'periodStart', ''), 'periodEnd', coalesce(d->>'periodEnd', ''), 'fireCheckDate', coalesce(d->>'fireCheckDate', ''),
    'chiefOk', case when d->>'chiefOk' = 'Y' then 'Y' else '' end, 'docMissing', public.dw_doc_missing_(d),
    'currentRound', r.round::text, 'lastReviewDate', coalesce(d->>'reviewDate', ''), 'updatedAt', nowt));
end $$;

/** 발송 기록 한 줄 더하기 (Code.gs addSendLog_) */
create or replace function public.dw_sendlog_add_(sid text, entry jsonb) returns void language plpgsql as $$
declare s public.dw_stores; list jsonb; patch jsonb;
begin
  select * into s from public.dw_stores where id = sid for update;
  if not found then return; end if;
  list := public.dw_json(s.data->>'sendLog', '[]');
  if jsonb_typeof(list) <> 'array' then list := '[]'; end if;
  if coalesce(entry->>'at', '') = '' then entry := entry || jsonb_build_object('at', public.dw_now_text()); end if;
  list := list || jsonb_build_array(entry);
  while jsonb_array_length(list) > 1 and length(list::text) > 40000 loop list := list - 0; end loop;
  while jsonb_array_length(list) > 150 loop list := list - 0; end loop;
  patch := jsonb_build_object('sendLog', list::text);
  if entry->>'t' = 'defect' then patch := patch || jsonb_build_object('defectSent', entry->>'at'); end if;
  perform public.dw_store_patch_(sid, patch);
end $$;

/* ───────── 검토서 저장 검사 (Code.gs sanitizeReview_ · sanitizePhotos_) ───────── */
create or replace function public.dw_num_(v jsonb, lo numeric, hi numeric) returns numeric language plpgsql immutable as $$
declare x numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then return case when v is null then 0 else greatest(lo, least(hi, 0)) end; end if;
  if jsonb_typeof(v) = 'boolean' then x := case when v::text = 'true' then 1 else 0 end;
  elsif jsonb_typeof(v) = 'number' then x := v::text::numeric;
  elsif jsonb_typeof(v) = 'string' then
    if btrim(v #>> '{}') = '' then x := 0;
    elsif btrim(v #>> '{}') ~ '^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$' then x := btrim(v #>> '{}')::numeric;
    else return 0; end if;
  else return 0; end if;
  return greatest(lo, least(hi, round(x * 10) / 10));
end $$;

create or replace function public.dw_photos_(v text) returns text language plpgsql stable as $$
declare list jsonb; outv jsonb;
begin
  if coalesce(v, '') = '' then return ''; end if;
  begin list := v::jsonb; exception when others then return ''; end;
  if jsonb_typeof(list) <> 'array' then return ''; end if;
  select jsonb_agg(o order by ord) into outv from (
    select ord, jsonb_build_object(
      'id', left(regexp_replace(coalesce(p->>'id', ''), '[^A-Za-z0-9_-]', '', 'g'), 24), 'f', p->>'f',
      'a', public.dw_num_(p->'a', 0, 20000), 'x', public.dw_num_(p->'x', -5000, 5000), 'y', public.dw_num_(p->'y', -5000, 20000),
      'w', public.dw_num_(p->'w', 20, 2000), 'h', public.dw_num_(p->'h', 20, 4000),
      'r', case when p->>'r' in ('0', '90', '180', '270') then (p->>'r')::int else 0 end) o
    from jsonb_array_elements(list) with ordinality e(p, ord)
    where jsonb_typeof(p) = 'object' and coalesce(p->>'f', '') ~ '^[-A-Za-z0-9_]{10,80}$'
    order by ord limit (public.dw_const()->>'photoMax')::int) s;
  return coalesce(outv::text, '');
end $$;

create or replace function public.dw_sanitize_(rv jsonb) returns jsonb language plpgsql stable as $$
declare c jsonb := public.dw_const(); f jsonb; k text; t text; v text; na text[]; o jsonb := '{}';
  pop text[] := array(select jsonb_array_elements_text(c->'popupDep'));
begin
  if rv->>'storeType' in (select jsonb_array_elements_text(c->'popupTypes')) then na := pop;
  elsif rv->>'kitchen' = '없음' then na := array(select jsonb_array_elements_text(c->'kitchenDep'));
  else na := '{}'; end if;
  for f in select x from jsonb_array_elements(c->'fields') x loop
    k := f->>0; t := f->>2;
    if k = any (na) then o := o || jsonb_build_object(k, '해당없음'); continue; end if;
    if t = 'bool' then o := o || jsonb_build_object(k, public.dw_truthy(rv->k)); continue; end if;
    v := case when rv->k is null or jsonb_typeof(rv->k) = 'null' then '' else rv->>k end;
    if t = 'choice' and v <> '' and not ((f->3) ? v) and not (v = '해당없음' and k = any (pop)) then v := ''; end if;
    if t = 'sig' then
      if v <> '' and left(v, 22) <> 'data:image/png;base64,' then v := ''; end if;
      if length(v) > (c->>'sigMax')::int then raise exception '서명 이미지가 너무 큽니다. 다시 서명해 주세요.'; end if;
    elsif k = 'notesPhotos' then v := public.dw_photos_(v);
    elsif t <> 'long' then v := left(v, 500);
    else v := left(v, 20000); end if;
    o := o || jsonb_build_object(k, v);
  end loop;
  return o;
end $$;

/** 서명 칸 [sig, date, name, tel] 셋 (Code.gs SIG_WHO) */
create or replace function public.dw_keep_remote_sigs_(d jsonb, sid text, rnd int, cleared jsonb) returns jsonb language plpgsql stable as $$
declare ex jsonb; w jsonb;
begin
  select data into ex from public.dw_reviews where store_id = sid and round = rnd;
  if ex is null then return d; end if;
  if jsonb_typeof(cleared) is distinct from 'array' then cleared := '[]'; end if;
  for w in select value from jsonb_each(public.dw_const()->'sigWho') loop
    if coalesce(d->>(w->>'sig'), '') = '' and coalesce(ex->>(w->>'sig'), '') <> '' and not (cleared ? (w->>'sig')) then
      d := d || jsonb_build_object(w->>'sig', ex->>(w->>'sig'), w->>'date', coalesce(ex->>(w->>'date'), ''));
    end if;
    if coalesce(d->>(w->>'name'), '') = '' and coalesce(ex->>(w->>'name'), '') <> '' then d := d || jsonb_build_object(w->>'name', ex->>(w->>'name')); end if;
    if coalesce(d->>(w->>'tel'), '') = '' and coalesce(ex->>(w->>'tel'), '') <> '' then d := d || jsonb_build_object(w->>'tel', ex->>(w->>'tel')); end if;
  end loop;
  return d;
end $$;

/** 검토서 한 줄 넣기·바꾸기 (Code.gs upsertReview_): 소장 확인 칸은 따로 정하지 않았으면 그대로 */
create or replace function public.dw_upsert_review_(sid text, rnd int, d jsonb, new_id text) returns void language plpgsql as $$
declare ex public.dw_reviews; k text;
begin
  select * into ex from public.dw_reviews where store_id = sid and round = rnd for update;
  d := d || jsonb_build_object('rulesAck', case when public.dw_truthy(d->'rulesAck') then 'Y' else '' end);
  foreach k in array array['chiefOk', 'chiefOkBy', 'chiefOkAt'] loop
    if not (d ? k) then d := d || jsonb_build_object(k, case when ex.id is not null then coalesce(ex.data->>k, '') else '' end); end if;
  end loop;
  d := d - 'id' - 'storeId' - 'round';
  if ex.id is not null then
    update public.dw_reviews set data = d, saved_at = now() where id = ex.id;
  else
    insert into public.dw_reviews (id, store_id, round, data) values (coalesce(nullif(new_id, ''), gen_random_uuid()::text), sid, rnd, d);
  end if;
end $$;

/* ───────── 화면 함수: 로그인 · 첫 화면 ───────── */
create or replace function public.dw_bootstrap_() returns jsonb language plpgsql stable as $$
declare c jsonb := public.dw_const(); sc text := public.dw_set_get('바로가기주소');
begin
  if coalesce(sc, '') !~ '^https://[^\s?#]+$' then sc := ''; end if;
  return jsonb_build_object(
    'version', '', 'appUrl', '', 'publicUrl', sc,   -- 비면 dw-api.js 가 지금 주소(…/fm/dw/)로 채움
    'phraseCats', c->'phraseCats', 'synonyms', public.dw_synonyms_(), 'storeLabel', c->'storeLabel', 'docPrefix', c->'docPrefix',
    'fields', c->'fields', 'rules', public.dw_rules_(), 'phrases', public.dw_phrases_(), 'guides', public.dw_guides_client_(),
    'signature', c->'signature', 'specFrom', c->'specFrom', 'specFromName', c->'specFromName',
    'sigEmails', public.dw_json(public.dw_set_get('SIG_EMAILS'), '{}'));
end $$;

create or replace function public.dw_rules_() returns jsonb language sql stable as $$
  select case when exists (select 1 from public.dw_rules where text <> '')
    then (select jsonb_agg(text order by seq) from public.dw_rules where text <> '') else public.dw_const()->'rules' end $$;
create or replace function public.dw_phrases_() returns jsonb language sql stable as $$
  select case when exists (select 1 from public.dw_phrases)
    then (select jsonb_agg(jsonb_build_object('t', t, 'c', c) order by seq) from public.dw_phrases) else public.dw_const()->'phrases' end $$;
create or replace function public.dw_synonyms_() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(g order by seq), '[]') from (
    select seq, (select jsonb_agg(w) from (select btrim(x) w from unnest(array[word] || regexp_split_to_array(alts, '[,，、\n]')) x) y where w <> '') g
    from public.dw_synonyms) s where jsonb_array_length(g) > 1 $$;

create or replace function public.dw_login(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare x record;
begin
  select * into x from public.dw_auth_(p_a);
  if x.err is not null then return jsonb_build_object('__err', x.err); end if;
  return jsonb_build_object('role', x.role, 'token', public.dw_h('token:' || x.role || ':' || public.dw_set_get('PIN_' || x.role)));
end $$;

create or replace function public.dw_start(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare x record;
begin
  select * into x from public.dw_auth_(p_a);
  if x.err is not null then return jsonb_build_object('__err', x.err); end if;
  return jsonb_build_object('role', x.role, 'token', public.dw_h('token:' || x.role || ':' || public.dw_set_get('PIN_' || x.role)),
    'boot', public.dw_bootstrap_(), 'stores', public.dw_stores_list_());
end $$;

create or replace function public.dw_bootstrap(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin perform public.dw_role_(p_a); return public.dw_bootstrap_(); end $$;

create or replace function public.dw_list_stores(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin perform public.dw_role_(p_a); return public.dw_stores_list_(); end $$;

create or replace function public.dw_get_store(p_a jsonb, p_store text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin perform public.dw_role_(p_a); return public.dw_store_get_(p_store); end $$;

/** 업체명 자동완성: 업체명마다 가장 최근 담당자 (Code.gs readCompanies_) */
create or replace function public.dw_companies(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.dw_role_(p_a);
  return (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'kind', kind, 'person', person, 'tel', tel, 'email', email) order by name collate "C"), '[]')
    from (select distinct on (name) * from (
      select btrim(coalesce(r.data->>(p.k || 'Company'), '')) name, p.l kind, coalesce(r.data->>(p.k || 'Name'), '') person,
             coalesce(r.data->>(p.k || 'Tel'), '') tel, coalesce(r.data->>(p.k || 'Email'), '') email, coalesce(r.data->>'savedAt', '') at, p.o, r.saved_at
      from public.dw_reviews r cross join (values ('owner', '발주처', 1), ('contractor', '시공업체', 2)) p(k, l, o)) a
      where name <> '' order by name, at desc, saved_at desc, o desc) b);
end $$;

/* ───────── 검토서 저장 · 차수 ───────── */
create or replace function public.dw_save_review(p_a jsonb, p_review jsonb, p_finalize boolean) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); nowt text := public.dw_now_text(); d jsonb; cid text; sid text; s public.dw_stores;
  rnd int; seqn int; fd text;
begin
  perform public.dw_lock();
  d := public.dw_sanitize_(coalesce(p_review, '{}'));
  cid := case when coalesce(p_review->>'clientId', '') ~ '^c-[A-Za-z0-9_-]{6,60}$' then p_review->>'clientId' else '' end;
  sid := coalesce(p_review->>'storeId', '');
  if sid = '' and cid <> '' and exists (select 1 from public.dw_stores where id = cid) then sid := cid; end if;
  if sid = '' then
    -- 새 매장: 일련번호는 지운 매장 번호도 다시 쓰지 않음 (LAST_SEQ)
    seqn := greatest(coalesce((select max(seq) from public.dw_stores), 0), coalesce(public.dw_int(public.dw_set_get('LAST_SEQ'), 0), 0)) + 1;
    perform public.dw_set_put('LAST_SEQ', seqn::text);
    fd := coalesce(nullif(d->>'reviewDate', ''), public.dw_today());
    insert into public.dw_stores (id, seq, data) values (coalesce(nullif(cid, ''), gen_random_uuid()::text), seqn, jsonb_build_object(
      'docNo', (public.dw_const()->>'docPrefix') || '_' || lpad(seqn::text, 3, '0') || '_' || substr(replace(fd, '-', ''), 3, 6),
      'firstDate', fd, 'status', '협의중', 'updatedAt', nowt)) returning * into s;
    rnd := 1;
  else
    select * into s from public.dw_stores where id = sid;
    if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
    if s.data->>'status' = '컨펌완료' then raise exception '컨펌완료된 매장입니다. 대시보드에서 컨펌완료를 취소한 뒤 수정해 주세요.'; end if;
    rnd := coalesce(nullif(public.dw_int(p_review->>'round', 0), 0), 1);
  end if;
  d := public.dw_keep_remote_sigs_(d, s.id, rnd, p_review->'_sigCleared');
  d := d || jsonb_build_object('status', case when p_finalize or p_review->>'status' = '검토완료' then '검토완료' else '작성중' end,
    'savedAt', nowt, 'savedBy', role);
  perform public.dw_upsert_review_(s.id, rnd, d, '');
  perform public.dw_sync_store_(s.id, nowt);
  perform public.dw_log_(role, case when p_finalize then '검토완료 저장' else '저장' end, s.id, s.data->>'docNo', rnd || '차');
  return public.dw_store_get_(s.id);
end $$;

/** 다음 차수: 직전 내용 복사(특이사항·서명·동의서·검토일 빼고) */
create or replace function public.dw_next_round(p_a jsonb, p_store text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; last public.dw_reviews; d jsonb := '{}'; f jsonb; k text; nowt text := public.dw_now_text();
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
  if s.data->>'status' = '컨펌완료' then raise exception '컨펌완료된 매장은 다음 차수를 만들 수 없습니다.'; end if;
  select * into last from public.dw_reviews where store_id = p_store order by round desc limit 1;
  for f in select x from jsonb_array_elements(public.dw_const()->'fields') x loop
    k := f->>0;
    d := d || jsonb_build_object(k, coalesce(last.data->k, '""'::jsonb));
  end loop;
  foreach k in array array['notes', 'notesPhotos', 'rulesAck', 'safetySig', 'salesSig', 'respSig', 'safetySigDate', 'salesSigDate', 'respSigDate',
      'agreeChecks', 'agreeRespSig', 'agreeRespSigDate', 'agreeLotteSig', 'agreeLotteSigDate'] loop
    d := d || jsonb_build_object(k, '');
  end loop;
  d := d || jsonb_build_object('reviewDate', public.dw_today(), 'status', '작성중', 'savedAt', nowt, 'savedBy', role);
  perform public.dw_upsert_review_(p_store, coalesce(last.round, 0) + 1, d, gen_random_uuid()::text);
  perform public.dw_sync_store_(p_store, nowt);
  perform public.dw_log_(role, '다음 차수 생성', p_store, s.data->>'docNo', (coalesce(last.round, 0) + 1) || '차');
  return public.dw_store_get_(p_store);
end $$;

/** 매장 통째로 삭제: 모든 차수 → 삭제보관, 이 매장 파일은 지울 표시(주 1회 작업이 버킷·드라이브에서 지움) */
create or replace function public.dw_delete_store(p_a jsonb, p_store text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; n int;
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '이미 삭제된 검토서입니다.'; end if;
  if s.data->>'status' = '컨펌완료' then raise exception '컨펌완료된 매장은 삭제할 수 없습니다. 대시보드에서 컨펌완료를 먼저 취소해 주세요.'; end if;
  perform public.dw_set_put('LAST_SEQ', greatest(coalesce((select max(seq) from public.dw_stores), 0), coalesce(public.dw_int(public.dw_set_get('LAST_SEQ'), 0), 0))::text);
  insert into public.dw_deleted (deleted_by, store_id, round, data)
    select role || ' (검토서 삭제)', r.store_id, r.round, r.data || jsonb_build_object('id', r.id, 'storeId', r.store_id, 'round', r.round::text)
    from public.dw_reviews r where r.store_id = p_store order by r.round;
  get diagnostics n = row_count;
  delete from public.dw_stores where id = p_store;   -- 검토서 줄은 따라서 지워짐 (on delete cascade)
  update public.dw_files set trash = true where store_id = p_store;
  perform public.dw_log_(role, '검토서 삭제', p_store, s.data->>'docNo', coalesce(s.data->>'tenant', '') || ' · ' || n || '개 차수 → 삭제보관 탭');
  return public.dw_stores_list_();
end $$;

create or replace function public.dw_delete_last_round(p_a jsonb, p_store text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; last public.dw_reviews;
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
  if s.data->>'status' = '컨펌완료' then raise exception '컨펌완료된 매장은 차수를 삭제할 수 없습니다.'; end if;
  if (select count(*) from public.dw_reviews where store_id = p_store) <= 1 then raise exception '1차만 남은 매장은 차수를 삭제할 수 없습니다.'; end if;
  select * into last from public.dw_reviews where store_id = p_store order by round desc limit 1;
  insert into public.dw_deleted (deleted_by, store_id, round, data)
    values (role, last.store_id, last.round, last.data || jsonb_build_object('id', last.id, 'storeId', last.store_id, 'round', last.round::text));
  delete from public.dw_reviews where id = last.id;
  perform public.dw_sync_store_(p_store, public.dw_now_text());
  perform public.dw_log_(role, '차수 삭제', p_store, s.data->>'docNo', last.round || '차 (검토일 ' || coalesce(nullif(last.data->>'reviewDate', ''), '-') || ') → 삭제보관 탭');
  return public.dw_store_get_(p_store);
end $$;

create or replace function public.dw_set_chief_ok(p_a jsonb, p_store text, p_round int, p_on boolean) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; nowt text := public.dw_now_text();
begin
  if role <> '소장' then raise exception '소장 확인은 소장 PIN으로 접속했을 때만 할 수 있습니다.'; end if;
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.'; end if;
  update public.dw_reviews set data = data || case when p_on then jsonb_build_object('chiefOk', 'Y', 'chiefOkBy', role, 'chiefOkAt', nowt)
    else jsonb_build_object('chiefOk', '', 'chiefOkBy', '', 'chiefOkAt', '') end
  where store_id = p_store and round = p_round;
  if not found then raise exception '저장된 검토서가 없습니다. 먼저 저장해 주세요.'; end if;
  perform public.dw_sync_store_(p_store, nowt);
  perform public.dw_log_(role, case when p_on then '소장 확인' else '소장 확인 취소' end, p_store, s.data->>'docNo', p_round || '차');
  return public.dw_store_get_(p_store);
end $$;

create or replace function public.dw_set_confirmed(p_a jsonb, p_store text, p_confirmed boolean) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; nowt text := public.dw_now_text();
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
  perform public.dw_store_patch_(p_store, case when p_confirmed
    then jsonb_build_object('status', '컨펌완료', 'confirmedBy', role, 'confirmedAt', nowt, 'updatedAt', nowt)
    else jsonb_build_object('status', '협의중', 'confirmedBy', '', 'confirmedAt', '', 'updatedAt', nowt) end);
  perform public.dw_log_(role, case when p_confirmed then '컨펌완료' else '컨펌완료 취소' end, p_store, s.data->>'docNo', '');
  return public.dw_stores_list_();
end $$;

create or replace function public.dw_save_phrases(p_a jsonb, p_list jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); n int; lst jsonb;
begin
  if jsonb_typeof(p_list) is distinct from 'array' then raise exception '문구 목록이 올바르지 않습니다.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'c', case when c in (select jsonb_array_elements_text(public.dw_const()->'phraseCats')) then c else '기타' end) order by o), '[]')
    into lst from (
      select o, left(regexp_replace(coalesce(case when jsonb_typeof(p) = 'object' then p->>'t' end, ''), '\s+$', ''), 500) t,
             coalesce(case when jsonb_typeof(p) = 'object' then p->>'c' end, '') c
      from jsonb_array_elements(p_list) with ordinality e(p, o)) x
    where btrim(t, E' 	
') <> '';
  n := jsonb_array_length(lst);
  if n > 300 then raise exception '문구는 300개까지 저장할 수 있습니다.'; end if;
  perform public.dw_lock();
  delete from public.dw_phrases where true;   -- Supabase 는 조건 없는 지우기를 막음
  insert into public.dw_phrases (seq, t, c) select o, e->>'t', e->>'c' from jsonb_array_elements(lst) with ordinality x(e, o);
  perform public.dw_log_(role, '자주 쓰는 문구 저장', '', '', n || '개');
  return public.dw_phrases_();
end $$;

/* ───────── 파일: 화면이 버킷에 먼저 올리고(dw-api.js) 여기서 dw_files 에 적음 ─────────
   p_file = { path, url, size, mime } — path 는 버킷 dw-files 안 (영문·숫자) */
create or replace function public.dw_file_in_(f jsonb, kinds text[], sid text, nm text, folder text, who text, kind text) returns uuid language plpgsql as $$
declare fid uuid;
begin
  if coalesce(f->>'path', '') !~ ('^(' || array_to_string(kinds, '|') || ')/[A-Za-z0-9/_.-]+$') or coalesce(f->>'url', '') !~ '^https://' then
    raise exception '파일을 올리지 못했습니다. 다시 해 주세요.';
  end if;
  insert into public.dw_files (kind, file_url, storage_path, mime, file_name, drive_folder, size_bytes, store_id, created_by)
  values (kind, f->>'url', f->>'path', nullif(f->>'mime', ''), nm, folder, public.dw_int(f->>'size', null), nullif(sid, ''), who) returning dw_files.id into fid;
  return fid;
end $$;

/** 파일 하나 꺼낼 정보: 버킷이면 url, 드라이브로 옮긴 것이면 drive_id (dw-api.js 가 구글 웹앱 통로로 받음) */
create or replace function public.dw_file_out_(f public.dw_files) returns jsonb language sql stable as $$
  select jsonb_build_object('id', f.id, 'url', case when f.storage_path is not null then f.file_url end, 'drive_id', f.drive_id,
    'mime', f.mime, 'name', f.file_name, 'size', f.size_bytes) $$;

create or replace function public.dw_file(p_a jsonb, p_id text, p_kind text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare f public.dw_files;
begin
  perform public.dw_role_(p_a);
  select * into f from public.dw_files where (id::text = p_id or drive_id = p_id) and kind = any (string_to_array(p_kind, ',')) and not trash limit 1;
  if not found then return null; end if;
  return public.dw_file_out_(f);
end $$;

/** 특이사항 사진 올림 (Code.gs apiUploadPhoto): 이름 = 1차_YYYYMMDD_HHmmss_###.jpg, 드라이브로 옮길 때 도면협의_사진/문서번호 */
create or replace function public.dw_photo_added(p_a jsonb, p_store text, p_round int, p_file jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; nm text; fid uuid;
begin
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '먼저 검토서를 저장해 주세요.'; end if;
  nm := coalesce(nullif(p_round, 0), 1) || '차_' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD_HH24MISS') || '_' || floor(random() * 1000)::int
    || case when p_file->>'mime' = 'image/png' then '.png' else '.jpg' end;
  fid := public.dw_file_in_(p_file, array['photo'], p_store, nm, 'photo/' || (s.data->>'docNo'), role, 'photo');
  perform public.dw_log_(role, '사진 첨부', p_store, s.data->>'docNo', nm);
  return jsonb_build_object('fileId', fid, 'name', nm);
end $$;

/** 검토서 PDF 보관 (Code.gs apiSavePdf · savePdfFile_): 같은 이름은 새것으로 바꿈 */
create or replace function public.dw_pdf_in_(s public.dw_stores, p_round int, p_name text, p_file jsonb, who text) returns public.dw_files language plpgsql as $$
declare nm text; fid uuid; f public.dw_files;
begin
  nm := regexp_replace(coalesce(nullif(p_name, ''), (s.data->>'docNo') || '_' || p_round || '차.pdf'), '[\\/:*?"<>|]', '_', 'g');
  if nm !~* '\.pdf$' then nm := nm || '.pdf'; end if;
  update public.dw_files set trash = true where kind = 'pdf' and store_id = s.id and file_name = nm and not trash;
  fid := public.dw_file_in_(p_file || jsonb_build_object('mime', 'application/pdf'), array['pdf'], s.id, nm, 'pdf/' || (s.data->>'docNo'), who, 'pdf');
  select * into f from public.dw_files where dw_files.id = fid;
  return f;
end $$;

create or replace function public.dw_pdf_saved(p_a jsonb, p_store text, p_round int, p_name text, p_file jsonb, p_auto boolean) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; f public.dw_files;
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '매장을 찾을 수 없습니다.'; end if;
  f := public.dw_pdf_in_(s, p_round, p_name, p_file, role);
  if p_auto is not null then   -- null = 서명 요청에 붙일 PDF (Code.gs savePdfFile_ 처럼 기록 없이)
    perform public.dw_log_(role, case when p_auto then 'PDF 자동 보관' else 'PDF 저장' end, p_store, s.data->>'docNo', f.file_name);
    perform public.dw_sendlog_add_(p_store, jsonb_build_object('t', 'pdf', 'by', role, 'round', p_round,
      'd', p_round || '차 ' || case when p_auto then '검토 완료 → 자동 보관' else '저장' end, 'url', f.file_url, 'f', f.id));
  end if;
  return jsonb_build_object('url', f.file_url, 'name', f.file_name, 'fileId', f.id, 'folder', '도면협의_출력/' || (s.data->>'docNo'),
    'store', (select public.dw_store_out_(x) from public.dw_stores x where x.id = p_store));
end $$;

/* ───────── 종합방재실 협의서 (매장마다 1장) ───────── */
create or replace function public.dw_firedoc_set(p_a jsonb, p_store text, p_file jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; old jsonb; work text; nm text; fid uuid;
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  if not found then raise exception '먼저 검토서를 저장해 주세요.'; end if;
  old := public.dw_json(s.data->>'fireDoc', null);
  work := left(btrim(regexp_replace(regexp_replace('방재실협의서-' || coalesce(nullif(s.data->>'tenant', ''), '매장'),
    '[[:space:]/\\:*?"<>|_#%&{}$!''@+`=]+', '-', 'g'), '-+', '-', 'g'), '-'), 30);
  nm := public.dw_today() || '_' || work || '_001' || case when p_file->>'mime' = 'image/png' then '.png' else '.jpg' end;
  fid := public.dw_file_in_(p_file, array['firedoc'], p_store, nm, 'photo/' || (s.data->>'docNo'), role, 'firedoc');
  perform public.dw_store_patch_(p_store, jsonb_build_object('fireDoc', jsonb_build_object('f', fid, 'at', public.dw_now_text(), 'by', role, 'r', 0, 'name', nm)::text));
  if old->>'f' is not null then update public.dw_files set trash = true where (id::text = old->>'f' or drive_id = old->>'f') and kind = 'firedoc'; end if;
  perform public.dw_log_(role, case when old->>'f' is not null then '방재실 협의서 다시 올림' else '방재실 협의서 올림' end, p_store, s.data->>'docNo', nm);
  return public.dw_store_get_(p_store);
end $$;

create or replace function public.dw_firedoc(p_a jsonb, p_store text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.dw_stores; d jsonb; f public.dw_files;
begin
  perform public.dw_role_(p_a);
  select * into s from public.dw_stores where id = p_store;
  d := public.dw_json(s.data->>'fireDoc', null);
  if d->>'f' is null then raise exception '올린 종합방재실 협의서가 없습니다.'; end if;
  select * into f from public.dw_files where (id::text = d->>'f' or drive_id = d->>'f') and not trash limit 1;
  if not found then raise exception '협의서 파일을 찾을 수 없습니다. 다시 올려 주세요.'; end if;
  return jsonb_build_object('file', public.dw_file_out_(f), 'r', case when d->>'r' in ('0', '90', '180', '270') then (d->>'r')::int else 0 end, 'f', d->>'f');
end $$;

create or replace function public.dw_firedoc_rotate(p_a jsonb, p_store text, p_r int) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.dw_stores; d jsonb;
begin
  perform public.dw_role_(p_a);
  if p_r is null or p_r not in (0, 90, 180, 270) then raise exception '방향 값이 올바르지 않습니다.'; end if;
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  d := public.dw_json(s.data->>'fireDoc', null);
  if d->>'f' is null then raise exception '올린 종합방재실 협의서가 없습니다.'; end if;
  perform public.dw_store_patch_(p_store, jsonb_build_object('fireDoc', (d || jsonb_build_object('r', p_r))::text));
  return jsonb_build_object('r', p_r);
end $$;

create or replace function public.dw_firedoc_delete(p_a jsonb, p_store text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); s public.dw_stores; d jsonb;
begin
  perform public.dw_lock();
  select * into s from public.dw_stores where id = p_store;
  d := public.dw_json(s.data->>'fireDoc', null);
  if d->>'f' is null then raise exception '올린 종합방재실 협의서가 없습니다.'; end if;
  update public.dw_files set trash = true where (id::text = d->>'f' or drive_id = d->>'f') and kind = 'firedoc';
  perform public.dw_store_patch_(p_store, jsonb_build_object('fireDoc', ''));
  perform public.dw_log_(role, '방재실 협의서 지움', p_store, s.data->>'docNo', coalesce(d->>'name', ''));
  return public.dw_store_get_(p_store);
end $$;

/* ───────── 원격 서명 (로그인 없는 사람: 링크의 표만으로) ───────── */
create or replace function public.dw_sign_key_(tok text) returns text language sql immutable as $$ select 'SIGT_' || left(public.dw_h('sig:' || tok), 40) $$;

create or replace function public.dw_sign_ticket_(tok text) returns public.dw_sign_tokens language plpgsql as $$
declare t public.dw_sign_tokens;
begin
  if coalesce(tok, '') !~ '^[0-9a-f]{40,80}$' then raise exception '서명 링크가 올바르지 않습니다.'; end if;
  select * into t from public.dw_sign_tokens where h = public.dw_sign_key_(tok);
  if not found then raise exception '이미 서명했거나 더 이상 쓸 수 없는 링크입니다. 시설팀에 새 링크를 요청해 주세요.'; end if;
  if t.exp < now() then raise exception '링크 사용 기간(7일)이 지났습니다. 시설팀에 새 링크를 요청해 주세요.'; end if;
  return t;
end $$;

create or replace function public.dw_sign_info(p_token text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t public.dw_sign_tokens := public.dw_sign_ticket_(p_token); c jsonb; s public.dw_stores; r public.dw_reviews;
begin
  c := public.dw_const()->'sigWho'->t.who;
  select * into s from public.dw_stores where id = t.store_id;
  select * into r from public.dw_reviews where store_id = t.store_id and round = t.round;
  if s.id is null or r.id is null then raise exception '검토서를 찾을 수 없습니다. 시설팀에 문의해 주세요.'; end if;
  return jsonb_build_object('label', public.dw_const()->'storeLabel', 'tenant', coalesce(r.data->>'tenant', ''), 'round', t.round,
    'docNo', s.data->>'docNo', 'who', c->>'l',
    'org', coalesce(nullif(c->>'org', ''), nullif(r.data->>(c->>'orgKey'), ''), nullif(r.data->>'contractorCompany', ''), ''),
    'name', coalesce(r.data->>(c->>'name'), ''), 'tel', coalesce(r.data->>(c->>'tel'), ''),
    'pdfUrl', t.pdf_url, 'until', to_char(t.exp at time zone 'Asia/Seoul', 'FMMM/FMDD'));
end $$;

create or replace function public.dw_sign_submit(p_token text, p_data jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t public.dw_sign_tokens; c jsonb; nm text; tel text; sig text; s public.dw_stores; r public.dw_reviews; pm jsonb;
begin
  perform public.dw_lock();
  t := public.dw_sign_ticket_(p_token);
  c := public.dw_const()->'sigWho'->t.who;
  p_data := coalesce(p_data, '{}');
  nm := left(btrim(coalesce(p_data->>'name', '')), 40);
  tel := left(regexp_replace(coalesce(p_data->>'tel', ''), '[^0-9-]', '', 'g'), 13);
  sig := coalesce(p_data->>'sig', '');
  if nm = '' then raise exception '성명을 입력해 주세요.'; end if;
  if length(regexp_replace(tel, '\D', '', 'g')) < 9 then raise exception '연락처를 입력해 주세요.'; end if;
  if left(sig, 22) <> 'data:image/png;base64,' then raise exception '서명을 그려 주세요.'; end if;
  if length(sig) > (public.dw_const()->>'sigMax')::int then raise exception '서명 이미지가 너무 큽니다. 다시 써 주세요.'; end if;
  select * into s from public.dw_stores where id = t.store_id;
  select * into r from public.dw_reviews where store_id = t.store_id and round = t.round;
  if s.id is null or r.id is null then raise exception '검토서를 찾을 수 없습니다. 시설팀에 문의해 주세요.'; end if;
  update public.dw_reviews set data = data || jsonb_build_object(c->>'name', nm, c->>'tel', tel, c->>'sig', sig, c->>'date', public.dw_today()) where id = r.id;
  delete from public.dw_sign_tokens where h = t.h;
  pm := public.dw_json(s.data->>'sigPending', '{}');
  if jsonb_typeof(pm) <> 'object' then pm := '{}'; end if;
  perform public.dw_store_patch_(s.id, jsonb_build_object('sigPending', (pm - (t.round || ':' || t.who))::text));
  perform public.dw_sendlog_add_(s.id, jsonb_build_object('t', 'sig', 'round', t.round, 'd', (c->>'l') || ' ' || nm || ' · ' || tel || ' (원격 서명)'));
  perform public.dw_log_('원격 서명', (c->>'l') || ' 서명', s.id, s.data->>'docNo', t.round || '차 ' || nm || ' · ' || tel || ' · ' || coalesce(t.email, ''));
  return jsonb_build_object('ok', true, 'who', c->>'l', 'tenant', coalesce(r.data->>'tenant', ''));
end $$;

/* ───────── 지침 (검색 색인 · 쪽 그림) ─────────
   지침 PDF 는 화면에서 버킷 guide/pdf/ 에 올림(지침 관리 → PDF 올리기), 쪽 그림은 guide/{지침ID}/ */
create or replace function public.dw_guides_client_() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(o order by grp, ord2), '[]') from (
    select 0 grp, ord::bigint ord2, jsonb_build_object('id', id, 'title', title, 'short', short, 'pages', pages, 'landscape', landscape, 'images', page_map <> '{}') o
    from public.dw_guides where not archived
    union all
    select 1, row_number() over (order by archived_at desc nulls last, id desc), jsonb_build_object('id', id, 'title', title, 'short', short, 'pages', pages,
      'landscape', landscape, 'images', page_map <> '{}', 'archived', true, 'archivedAt', coalesce(archived_at, ''))
    from public.dw_guides where archived) s $$;

create or replace function public.dw_guide_index(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.dw_role_(p_a);
  return (select coalesce(jsonb_agg(e order by g.archived, case when g.archived then 0 else g.ord end, g.archived_at desc nulls last, g.id desc, o), '[]')
    from public.dw_guides g cross join lateral jsonb_array_elements(g.entries) with ordinality x(e, o));
end $$;

create or replace function public.dw_guide_page(p_a jsonb, p_guide text, p_page int) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare fid text; f public.dw_files;
begin
  perform public.dw_role_(p_a);
  select page_map->>(p_page::text) into fid from public.dw_guides where id = p_guide;
  if fid is null then return null; end if;
  select * into f from public.dw_files where (id::text = fid or drive_id = fid) and not trash limit 1;
  if not found then return null; end if;
  return public.dw_file_out_(f);
end $$;

create or replace function public.dw_guide_state_() returns jsonb language sql stable as $$
  select jsonb_build_object('sb', true, 'folderUrl', '', 'folderName', '도면협의_지침',
    'pdfs', (select coalesce(jsonb_agg(jsonb_build_object('fileId', id, 'name', file_name, 'size', coalesce(size_bytes, 0),
        'updated', to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS')) order by file_name collate "C"), '[]')
      from public.dw_files where kind = 'guide_pdf' and not trash),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'short', short, 'pages', pages, 'landscape', landscape,
        'localPages', local_pages, 'fileId', coalesce(file_id, ''), 'fileName', coalesce(file_name, ''), 'fileUpdated', coalesce(file_updated, ''),
        'entries', n_entries, 'builtAt', coalesce(built_at, ''), 'builtBy', coalesce(built_by, ''), 'legacy', false, 'images', page_map <> '{}') order by ord), '[]')
      from public.dw_guides where not archived),
    'archive', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'short', short, 'pages', pages, 'entries', n_entries,
        'fileName', coalesce(file_name, ''), 'builtAt', coalesce(built_at, ''), 'archivedAt', coalesce(archived_at, '')) order by archived_at desc nulls last, id desc), '[]')
      from public.dw_guides where archived),
    'building', (select data - 'pages' from public.dw_guide_build),
    'guides', public.dw_guides_client_()) $$;

create or replace function public.dw_guide_admin(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin perform public.dw_role_(p_a); return public.dw_guide_state_(); end $$;

/** 지침 PDF 올림 (드라이브 지침 폴더에 넣던 일) — 주 1회 작업이 도면협의_지침 폴더로 옮김 */
create or replace function public.dw_guide_pdf_add(p_a jsonb, p_file jsonb, p_name text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '[\\/:*?"<>|]', '_', 'g'), 120);
begin
  if nm !~* '\.pdf$' then raise exception 'PDF 파일만 올릴 수 있습니다.'; end if;
  perform public.dw_file_in_(p_file || jsonb_build_object('mime', 'application/pdf'), array['guide'], '', nm, 'guide', role, 'guide_pdf');
  perform public.dw_log_(role, '지침 PDF 올림', '', '', nm);
  return public.dw_guide_state_();
end $$;

create or replace function public.dw_guide_pdf_remove(p_a jsonb, p_id text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); nm text;
begin
  update public.dw_files set trash = true where id::text = p_id and kind = 'guide_pdf' and not trash returning file_name into nm;
  if nm is not null then perform public.dw_log_(role, '지침 PDF 지움', '', '', nm); end if;
  return public.dw_guide_state_();
end $$;

create or replace function public.dw_guide_trash_pages_(pages jsonb) returns void language sql as $$
  update public.dw_files set trash = true where kind = 'guide_page' and id::text in (select value from jsonb_each_text(coalesce(pages, '{}'))) $$;

create or replace function public.dw_guide_begin(p_a jsonb, p_info jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); ttl text := btrim(coalesce(p_info->>'title', '')); sh text := btrim(coalesce(p_info->>'short', ''));
  f public.dw_files; stamp text; b jsonb; resume boolean; loc boolean := public.dw_truthy(p_info->'localPages');
begin
  if ttl = '' or sh = '' then raise exception '지침 이름과 줄임말을 입력해 주세요.'; end if;
  select * into f from public.dw_files where id::text = coalesce(p_info->>'fileId', '') and kind = 'guide_pdf' and not trash;
  if not found then raise exception '지침 폴더에 있는 PDF만 색인할 수 있습니다.'; end if;
  stamp := to_char(f.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS');
  perform public.dw_lock();
  select data into b from public.dw_guide_build;
  resume := b is not null and b->>'fileId' = f.id::text and b->>'fileUpdated' = stamp and public.dw_truthy(b->'localPages') = loc;
  if b is not null and not resume then perform public.dw_guide_trash_pages_(b->'pages'); end if;
  if not resume then
    b := jsonb_build_object('id', 'g' || to_hex(public.dw_ms()), 'fileId', f.id, 'fileName', f.file_name, 'fileUpdated', stamp, 'localPages', loc,
      'startedAt', public.dw_now_text(), 'startedBy', role, 'pages', '{}'::jsonb);
  end if;
  b := b || jsonb_build_object('title', ttl, 'short', sh, 'replaces', coalesce(p_info->>'replaces', ''));
  insert into public.dw_guide_build (one, data) values (true, b) on conflict (one) do update set data = excluded.data;
  return jsonb_build_object('id', b->>'id', 'resumed', resume,
    'have', (select coalesce(jsonb_agg(k::int order by k::int), '[]') from jsonb_object_keys(b->'pages') k));
end $$;

create or replace function public.dw_building_(gid text) returns jsonb language plpgsql as $$
declare b jsonb;
begin
  select data into b from public.dw_guide_build for update;
  if b is null or b->>'id' is distinct from gid then raise exception '색인 작업 정보가 없습니다. 지침 관리 화면에서 다시 시작해 주세요.'; end if;
  return b;
end $$;

/** 쪽 그림 [{p, path, url, size}] — 화면이 버킷 guide/{지침ID}/ 에 먼저 올림 */
create or replace function public.dw_guide_save_pages(p_a jsonb, p_id text, p_pages jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); b jsonb; pg jsonb; p int; fid uuid; n int := 0;
begin
  perform public.dw_lock();
  b := public.dw_building_(p_id);
  for pg in select x from jsonb_array_elements(coalesce(p_pages, '[]')) x loop
    p := public.dw_int(pg->>'p', 0);
    if p < 1 or coalesce(pg->>'path', '') not like 'guide/' || p_id || '/%' then continue; end if;
    if b->'pages' ? p::text then perform public.dw_guide_trash_pages_(jsonb_build_object('x', b->'pages'->>(p::text))); end if;
    fid := public.dw_file_in_(pg || jsonb_build_object('mime', 'image/jpeg'), array['guide'], '', 'p' || lpad(p::text, 3, '0') || '.jpg', 'guide/' || p_id, role, 'guide_page');
    b := jsonb_set(b, array['pages', p::text], to_jsonb(fid::text));
    n := n + 1;
  end loop;
  update public.dw_guide_build set data = b where one;
  return jsonb_build_object('saved', n);
end $$;

create or replace function public.dw_guide_finish(p_a jsonb, p_id text, p_meta jsonb, p_entries jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); b jsonb; pages int := coalesce(public.dw_int(p_meta->>'pages', 0), 0); cnt int; pos int; g public.dw_guides; nowt text := public.dw_now_text();
begin
  if pages = 0 or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'PDF에서 글자를 찾지 못했습니다. 스캔(사진) PDF는 검색할 수 없습니다.';
  end if;
  perform public.dw_lock();
  b := public.dw_building_(p_id);
  select count(*) into cnt from jsonb_object_keys(b->'pages');
  if cnt < pages then raise exception '쪽 이미지가 % / %쪽만 저장되었습니다. "이어서 만들기"를 눌러 주세요.', cnt, pages; end if;
  -- 같은 PDF 를 다시 만든 것은 지우고, 바꿀 지침(replaces)·내용이 바뀐 판은 「이전 판」으로
  for g in select * from public.dw_guides where not archived and (id = b->>'replaces' or (file_id is not null and file_id = b->>'fileId')) order by ord loop
    if pos is null then pos := g.ord; end if;
    if g.file_id = b->>'fileId' and g.file_updated = b->>'fileUpdated' then
      perform public.dw_guide_trash_pages_(g.page_map);
      delete from public.dw_guides where id = g.id;
    else
      update public.dw_guides set archived = true, archived_at = nowt where id = g.id;
    end if;
  end loop;
  if pos is null then pos := coalesce((select max(ord) from public.dw_guides where not archived), -1) + 1; end if;
  insert into public.dw_guides (id, ord, title, short, pages, landscape, local_pages, file_id, file_name, file_updated, entries, n_entries, page_map, built_at, built_by)
  values (p_id, pos, b->>'title', b->>'short', pages, public.dw_truthy(p_meta->'landscape'), public.dw_truthy(b->'localPages'), b->>'fileId', b->>'fileName', b->>'fileUpdated',
    (select jsonb_agg(case when jsonb_typeof(e) = 'object' then e || jsonb_build_object('d', p_id) else e end order by o) from jsonb_array_elements(p_entries) with ordinality x(e, o)),
    jsonb_array_length(p_entries), b->'pages', nowt, role);
  delete from public.dw_guide_build where true;
  perform public.dw_log_(role, '지침 색인', '', '', (b->>'title') || ' · ' || pages || '쪽 · ' || jsonb_array_length(p_entries) || '개 항목');
  return public.dw_guide_state_();
end $$;

create or replace function public.dw_guide_remove(p_a jsonb, p_id text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); g public.dw_guides;
begin
  perform public.dw_lock();
  delete from public.dw_guides where id = p_id and not archived returning * into g;
  if g.id is null then raise exception '이미 삭제된 지침입니다.'; end if;
  perform public.dw_guide_trash_pages_(g.page_map);
  perform public.dw_log_(role, '지침 삭제', '', '', g.title);
  return public.dw_guide_state_();
end $$;

create or replace function public.dw_guide_remove_archived(p_a jsonb, p_id text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare role text := public.dw_role_(p_a); g public.dw_guides;
begin
  perform public.dw_lock();
  delete from public.dw_guides where id = p_id and archived returning * into g;
  if g.id is null then raise exception '이미 삭제된 이전 판입니다.'; end if;
  perform public.dw_guide_trash_pages_(g.page_map);
  perform public.dw_log_(role, '지침 이전 판 삭제', '', '', g.title);
  return public.dw_guide_state_();
end $$;

create or replace function public.dw_guide_rename(p_a jsonb, p_id text, p_info jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare ttl text := btrim(coalesce(p_info->>'title', '')); sh text := btrim(coalesce(p_info->>'short', ''));
begin
  perform public.dw_role_(p_a);
  if ttl = '' or sh = '' then raise exception '지침 이름과 줄임말을 입력해 주세요.'; end if;
  update public.dw_guides set title = ttl, short = sh where id = p_id and not archived;
  return public.dw_guide_state_();
end $$;

create or replace function public.dw_guide_cancel(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare b jsonb;
begin
  perform public.dw_role_(p_a);
  perform public.dw_lock();
  select data into b from public.dw_guide_build;
  if b is not null then perform public.dw_guide_trash_pages_(b->'pages'); delete from public.dw_guide_build where true; end if;
  return public.dw_guide_state_();
end $$;

/* ───────── 문 잠그기: dw_ 함수는 모두 막고, 화면이 쓰는 것만 열기 ───────── */
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'dw\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function
  public.dw_login(jsonb), public.dw_start(jsonb), public.dw_bootstrap(jsonb), public.dw_list_stores(jsonb), public.dw_get_store(jsonb, text),
  public.dw_companies(jsonb), public.dw_save_review(jsonb, jsonb, boolean), public.dw_next_round(jsonb, text), public.dw_delete_store(jsonb, text),
  public.dw_delete_last_round(jsonb, text), public.dw_set_chief_ok(jsonb, text, int, boolean), public.dw_set_confirmed(jsonb, text, boolean),
  public.dw_save_phrases(jsonb, jsonb), public.dw_file(jsonb, text, text), public.dw_photo_added(jsonb, text, int, jsonb),
  public.dw_pdf_saved(jsonb, text, int, text, jsonb, boolean), public.dw_firedoc_set(jsonb, text, jsonb), public.dw_firedoc(jsonb, text),
  public.dw_firedoc_rotate(jsonb, text, int), public.dw_firedoc_delete(jsonb, text),
  public.dw_guide_index(jsonb), public.dw_guide_page(jsonb, text, int), public.dw_guide_admin(jsonb), public.dw_guide_pdf_add(jsonb, jsonb, text),
  public.dw_guide_pdf_remove(jsonb, text), public.dw_guide_begin(jsonb, jsonb), public.dw_guide_save_pages(jsonb, text, jsonb),
  public.dw_guide_finish(jsonb, text, jsonb, jsonb), public.dw_guide_remove(jsonb, text), public.dw_guide_remove_archived(jsonb, text),
  public.dw_guide_rename(jsonb, text, jsonb), public.dw_guide_cancel(jsonb)
to authenticated;
-- 원격 서명 링크는 로그인 없이 (기기 등록 안 한 사람)
grant execute on function public.dw_sign_info(text), public.dw_sign_submit(text, jsonb) to anon, authenticated;
