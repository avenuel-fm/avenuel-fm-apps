-- ============================================================================
-- 업무지원(WS) 메인 메뉴 켜기·끄기 (결정 148) — 환경설정(소장)에서 메인 칸을 끄면 직원은 못 엶. 소장·관리자·옵저버는 꺼진 칸도 엶
-- 실행: SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전). 그다음 13_map.sql · 14_spec.sql 도 다시 Run (서버에서도 막기)
-- 저장: settings 표 key '메인메뉴끄기' = 꺼진 칸 이름을 쉼표로 (docs, inspect, spec, map, cad, docs.tbm … inspect.cs : 윗 메뉴 · 하위 메뉴 이름). 빈 값 = 모두 켜짐
-- ============================================================================

create or replace function public.ws_menu_off_()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select k from unnest(string_to_array(coalesce(public.ws_setting('메인메뉴끄기'), ''), ',')) k
                        where k in ('docs', 'inspect', 'spec', 'map', 'cad', 'docs.tbm', 'docs.nw', 'docs.att', 'docs.ahu', 'docs.log', 'inspect.fire', 'inspect.eh', 'inspect.thermal', 'inspect.cs')), '{}'::text[]);
$$;

-- 꺼진 칸도 여는 역할 (사용자 11-19 「소장 포함」)
create or replace function public.ws_menu_open_(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_role in ('소장', '관리자', '옵저버'), false);
$$;

-- 서버에서도 막기: 지도·시방서 자료 함수 맨 앞에서 부름 (직원이 화면을 거치지 않고 불러도)
create or replace function public.ws_menu_guard(p_role text, p_key text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_key = any(public.ws_menu_off_()) and not public.ws_menu_open_(p_role) then raise exception '지금은 사용 중지된 메뉴입니다.'; end if;
end $$;

-- 메인 화면이 앱을 열 때 같이 받음
create or replace function public.ws_menu(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return jsonb_build_object('ok', true, 'off', to_jsonb(public.ws_menu_off_()));
end $$;

create or replace function public.ws_admin_set_menu(p_token text, p_off text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_boss(p_token); v text;
begin
  select coalesce(string_agg(k, ',' order by array_position(array['docs', 'inspect', 'spec', 'map', 'cad', 'docs.tbm', 'docs.nw', 'docs.att', 'docs.ahu', 'docs.log', 'inspect.fire', 'inspect.eh', 'inspect.thermal', 'inspect.cs'], k)), '') into v
    from (select distinct k from unnest(coalesce(p_off, '{}'::text[])) k where k in ('docs', 'inspect', 'spec', 'map', 'cad', 'docs.tbm', 'docs.nw', 'docs.att', 'docs.ahu', 'docs.log', 'inspect.fire', 'inspect.eh', 'inspect.thermal', 'inspect.cs')) x;
  perform public.ws_set_text('메인메뉴끄기', v);
  perform public.ws_log(me.name, '메인 메뉴 끄기', '', coalesce(nullif(v, ''), '모두 켬'));
  return jsonb_build_object('ok', true, 'off', to_jsonb(public.ws_menu_off_()));
end $$;

revoke all on function public.ws_menu_off_(), public.ws_menu_open_(text), public.ws_menu_guard(text, text), public.ws_menu(text), public.ws_admin_set_menu(text, text[]) from public, anon, authenticated;
grant execute on function public.ws_menu(text), public.ws_admin_set_menu(text, text[]) to authenticated;
