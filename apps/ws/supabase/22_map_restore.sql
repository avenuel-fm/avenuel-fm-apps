-- 22_map_restore.sql — 지도 「이 날로 되돌리기」를 소장·부소장·파트장에게 (결정 212)
-- 전: 소장만. 이제: 소장·부소장·파트장. 직원·관리자·옵저버는 그대로 못 함.
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요 (여러 번 실행해도 안전). 13_map.sql 이 먼저 있어야 합니다.

create or replace function public.ws_map_can_restore(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_role in ('소장', '부소장', '파트장'), false);
$$;

-- 처음 열 때: 'canRestore' 를 더 알려 줌 (화면의 「이 날로 되돌리기」 버튼용). isBoss 는 그대로
create or replace function public.ws_map_load(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  perform public.ws_menu_guard(me.role, 'map');   -- 메인 메뉴에서 끈 지도 (결정 148, 15_menu.sql)
  return jsonb_build_object('ok', true, 'canEdit', public.ws_map_can_edit(me.role), 'isBoss', me.role = '소장',
    'canRestore', public.ws_map_can_restore(me.role),
    'kv', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from public.map_kv),
    'vers', (select coalesce(jsonb_object_agg(k, public.ws_ver(updated_at)), '{}'::jsonb) from public.map_kv),
    'urls', (select coalesce(jsonb_object_agg(building, f), '{}'::jsonb)
             from (select building, jsonb_object_agg(code, svg_url) f from public.map_floor group by building) x),
    'bases', (select coalesce(jsonb_object_agg(k, sha), '{}'::jsonb)
              from (select distinct on (k) k, sha from public.map_hist where k like 'lotte\_base\_svg\_%' order by k, at desc) b));
end $$;

-- 이 날로 되돌리기 (소장·부소장·파트장). 지금 모습은 기록에 그대로 남음 (되돌리기 전 보기)
create or replace function public.ws_map_restore(p_token text, p_day text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  st jsonb; r record; n int := 0;
begin
  if not public.ws_map_can_restore(me.role) then return jsonb_build_object('ok', false, 'error', '되돌리기는 소장·부소장·파트장만 할 수 있습니다'); end if;
  if d is null or d >= (now() at time zone 'Asia/Seoul')::date then return jsonb_build_object('ok', false, 'error', '지난 날짜만 되돌릴 수 있습니다'); end if;
  perform pg_advisory_xact_lock(hashtext('map_restore'));
  st := public.ws_map_state(public.ws_map_end(d::text));
  insert into public.map_restore (to_day, editor) values (d, me.name);
  for r in select k, v from public.map_kv loop                     -- 그날 없던 칸 지움
    if not st ? r.k then
      delete from public.map_kv where k = r.k;
      perform public.ws_map_hist_put(r.k, null, me.name); n := n + 1;
    end if;
  end loop;
  for r in select key k, value v from jsonb_each_text(st) where key not like 'lotte\_base\_svg\_%' loop
    if (select v from public.map_kv where k = r.k) is distinct from r.v then
      insert into public.map_kv (k, v, editor, updated_at) values (r.k, r.v, me.name, clock_timestamp())
      on conflict (k) do update set v = excluded.v, editor = excluded.editor, updated_at = excluded.updated_at;
      perform public.ws_map_hist_put(r.k, r.v, me.name); n := n + 1;
    end if;
  end loop;
  perform public.ws_log(me.name, '지도 되돌리기', d::text, n || '칸');
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- 안쪽 도우미는 로그인한 사람이 직접 못 부름 (ws_map_can_edit 과 같은 방식). load·restore 는 기존 권한이 그대로 유지됨
revoke all on function public.ws_map_can_restore(text) from public, anon, authenticated;
