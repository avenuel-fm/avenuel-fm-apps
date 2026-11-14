-- 11-14 고침: Supabase는 where 없는 update·delete를 막음 (「UPDATE requires a WHERE clause」)
-- 공사장 점검 [기본 항목 고치기] 저장 · 환경설정 [위험성 목록] 저장이 이 오류로 안 됨 → 두 함수만 다시 만듦
-- 쓰는 법: Supabase → SQL Editor → 이 파일 내용 전부 붙여 넣고 Run. 여러 번 돌려도 안전 (07_cs.sql·08_settings.sql에도 같은 고침이 들어 있음)

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
  update public.cs_items set seq = seq + 100000 where true;   -- 순서(seq)를 새로 매기려고 잠시 비켜 둠 (Supabase는 where 없는 update를 막음)
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

create or replace function public.ws_risk_save(p_token text, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_boss(p_token);
  n int := case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else -1 end;
  k int;
begin
  if n < 1 or n > 200 then return jsonb_build_object('ok', false, 'error', '위험성 목록은 1~200줄로 해 주세요.'); end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where public.ws_clean(e->>'risk', 100) <> '' and public.ws_clean(e->>'words', 200) = '') then
    return jsonb_build_object('ok', false, 'error', '낱말이 빈 줄이 있습니다. TBM 작업에서 찾을 낱말을 넣어 주세요.');
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_risk'));
  delete from public.risk_list where true;   -- Supabase는 where 없는 delete를 막음
  insert into public.risk_list (seq, words, risk, kind, likelihood, severity, fix1, fix2, fix3, fix4, active)
  select row_number() over (order by o), public.ws_clean(e->>'words', 200), public.ws_clean(e->>'risk', 100), public.ws_clean(e->>'kind', 30),
    case when e->>'p' ~ '^[1-3]$' then (e->>'p')::int else 1 end, case when e->>'s' ~ '^[1-3]$' then (e->>'s')::int else 1 end,
    public.ws_risk_fix(e->'fixes', 1), public.ws_risk_fix(e->'fixes', 2), public.ws_risk_fix(e->'fixes', 3), public.ws_risk_fix(e->'fixes', 4), true
  from jsonb_array_elements(p_rows) with ordinality a(e, o) where public.ws_clean(e->>'risk', 100) <> '';
  get diagnostics k = row_count;
  if k = 0 then raise exception '위험요인이 있는 줄이 하나도 없습니다.'; end if;   -- 지운 것을 되돌림
  perform public.ws_log(me.name, '위험성 목록', '', k || '줄');
  return jsonb_build_object('ok', true, 'rows', public.ws_risk_rows_());
end $$;
