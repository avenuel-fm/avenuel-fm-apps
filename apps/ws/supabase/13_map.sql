-- ============================================================================
-- 업무지원(WS) 지도 — 도면 앱(fm/map) 자료 (결정 130)
-- 실행: 12 다음에 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_지도.md
--
--  · map_kv    = 도면 앱이 브라우저에 두던 저장 칸을 그대로 한 줄씩 (이름 = 옛 localStorage 이름, 값 = 글자)
--                매장·기능실(specs·deleted·renamed·custom·vacant), 구역, 심벌, 설비 연결선, 축척, 고친 도면 그림
--  · map_floor = 층 도면 그림 주소. 공개 코드(fm/map)·이 저장소에 두지 않고 로그인한 사람에게만 넘김
--  · 화면은 PIN 로그인 표(ws_auth)가 있어야 읽고 씀. 같은 칸을 둘이 고치면 나중 저장이 남음
-- ============================================================================
create table if not exists public.map_kv (
  k          text primary key,
  v          text not null,
  editor     text,
  updated_at timestamptz not null default now()
);
create table if not exists public.map_floor (
  building text not null,
  code     text not null,
  svg_url  text not null,
  primary key (building, code)
);
alter table public.map_kv enable row level security;
alter table public.map_floor enable row level security;
revoke all on public.map_kv, public.map_floor from anon, authenticated;

-- 층 주소 26개는 공개 저장소에 두지 않음 → 처음 한 번 따로 넣음 (WS_지도.md 3장). 업체가 주소를 바꾸면 이 표만 고침

-- 처음 열 때 한 번: 모든 저장 칸 + 층 도면 주소
create or replace function public.ws_map_load(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return jsonb_build_object('ok', true,
    'kv', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from public.map_kv),
    'urls', (select coalesce(jsonb_object_agg(building, f), '{}'::jsonb)
             from (select building, jsonb_object_agg(code, svg_url) f from public.map_floor group by building) x));
end $$;

-- 칸 하나 저장. p_v = null 이면 지움
create or replace function public.ws_map_save(p_token text, p_k text, p_v text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me public.staff := public.ws_auth(p_token);
begin
  if coalesce(p_k, '') !~ '^lotte_[A-Za-z0-9_]+$' or length(p_k) > 80 then
    return jsonb_build_object('ok', false, 'error', '저장 칸 이름이 맞지 않습니다');
  end if;
  if length(p_v) > 5000000 then return jsonb_build_object('ok', false, 'error', '도면이 너무 큽니다 (5MB 넘음)'); end if;
  if p_v is null then
    delete from public.map_kv where k = p_k;
  else
    insert into public.map_kv (k, v, editor, updated_at) values (p_k, p_v, me.name, clock_timestamp())
    on conflict (k) do update set v = excluded.v, editor = excluded.editor, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ws_map_load(text), public.ws_map_save(text, text, text) from public, anon, authenticated;
grant execute on function public.ws_map_load(text), public.ws_map_save(text, text, text) to authenticated;
