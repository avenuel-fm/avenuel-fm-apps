-- 업무지원 v0.23.0 · 공조기·에어커튼 가동시간 설정 (요일별 기본 시작·종료, 결정 200)
-- 19_climate.sql 다음에 실행. 두 번 실행해도 됨.
--  · equip_hours = 층(공조기)·묶음(에어커튼)마다 요일(1 월 ~ 7 일) 기본 시작·종료(분)
--  · 줄이 없으면 예전 기본값 (장비 표 def_start · def_end 월~목 · def_end_wkend 금토일)
--  · 가동시간 입력 화면의 「기본 시각」만 바뀜. 이미 저장한 기록은 그대로

create table if not exists public.equip_hours (
  kind       text not null check (kind in ('hvac', 'curtain')),
  grp        text not null,                    -- 공조기 use_floor(6층…) / 에어커튼 short(1G OUT…)
  dow        int not null check (dow between 1 and 7),   -- 1 월 … 7 일 (isodow)
  start_min  int not null, end_min int not null,
  updated_at timestamptz not null default now(), editor text,
  primary key (kind, grp, dow)
);
alter table public.equip_hours enable row level security;
revoke all on public.equip_hours from anon, authenticated;

-- 그날 요일 설정을 덮은 장비 목록 (설정 있으면 e = ew = 설정 종료)
create or replace function public.ws_equip_units_on(p_kind text, d date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(case when h.grp is null then t.x else t.x || jsonb_build_object('s', h.start_min, 'e', h.end_min, 'ew', h.end_min) end order by t.i), '[]'::jsonb)
  from jsonb_array_elements(public.ws_equip_units(p_kind)) with ordinality t(x, i)
  left join public.equip_hours h on h.kind = p_kind and h.grp = t.x->>'grp' and h.dow = extract(isodow from d)::int;
$$;

-- 19_climate.sql 의 것을 바꿔 씀: 장비 기본 시각을 요일 설정으로
create or replace function public.ws_usage_data(p_kind text, d date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'kind', p_kind, 'day', d, 'workDay', public.ws_work_day(), 'wkend', public.ws_wkend(d),
    'units', public.ws_equip_units_on(p_kind, d),
    'recs', (select coalesce(jsonb_object_agg(e.unit, jsonb_build_object('s', e.start_min, 'e', e.end_min, 'off', e.off, 'by', coalesce(e.editor, ''), 'ver', public.ws_ver(e.updated_at))), '{}'::jsonb)
             from public.equip_usage e where e.kind = p_kind and e.log_date = d));
$$;

-- 설정 화면이 받는 모양: groups = [{ g: '6층', days: [[시작, 종료, 설정함?] × 7 (월~일)] }]
create or replace function public.ws_equip_hours_data(p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (
    select t.x->>'grp' g, min(t.i) o, (array_agg(t.x order by t.i))[1] f
    from jsonb_array_elements(public.ws_equip_units(p_kind)) with ordinality t(x, i) group by 1
  )
  select jsonb_build_object('ok', true, 'kind', p_kind, 'groups', coalesce((select jsonb_agg(jsonb_build_object('g', u.g, 'days',
    (select jsonb_agg(jsonb_build_array(coalesce(h.start_min, (u.f->>'s')::int),
                                        coalesce(h.end_min, case when w <= 4 then (u.f->>'e')::int else (u.f->>'ew')::int end),
                                        h.dow is not null) order by w)
     from generate_series(1, 7) w left join public.equip_hours h on h.kind = p_kind and h.grp = u.g and h.dow = w)) order by u.o) from u), '[]'::jsonb));
$$;

create or replace function public.ws_equip_hours_get(p_token text, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_boss(p_token);
  if p_kind not in ('hvac', 'curtain') then return jsonb_build_object('ok', false, 'error', '종류가 맞지 않습니다'); end if;
  return public.ws_equip_hours_data(p_kind);
end $$;

-- p_rows = 고친 칸만 [{ "g": "6층", "w": 1, "s": 600, "e": 1310 }] (종료 1440 = 자정)
create or replace function public.ws_equip_hours_save(p_token text, p_kind text, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_boss(p_token);
  r jsonb; g text; w int; s int; e int; n int := 0;
begin
  if p_kind not in ('hvac', 'curtain') then return jsonb_build_object('ok', false, 'error', '종류가 맞지 않습니다'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_object('ok', false, 'error', '저장할 내용이 없습니다'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    g := r->>'g';
    if not exists (select 1 from jsonb_array_elements(public.ws_equip_units(p_kind)) x where x->>'grp' = g) then
      return jsonb_build_object('ok', false, 'error', coalesce(g, '') || '은(는) 목록에 없습니다'); end if;
    if coalesce(r->>'w', '') !~ '^[1-7]$' or coalesce(r->>'s', '') !~ '^\d+$' or coalesce(r->>'e', '') !~ '^\d+$' then
      return jsonb_build_object('ok', false, 'error', g || ': 요일과 시작·종료를 모두 넣어 주세요'); end if;
    w := (r->>'w')::int; s := (r->>'s')::int; e := (r->>'e')::int;
    if s > 1430 or e > 1440 or s % 10 <> 0 or e % 10 <> 0 then return jsonb_build_object('ok', false, 'error', g || ': 시각이 맞지 않습니다 (10분 단위)'); end if;
    if e <= s then return jsonb_build_object('ok', false, 'error', g || ': 종료가 시작보다 늦어야 합니다'); end if;
    insert into public.equip_hours (kind, grp, dow, start_min, end_min, editor, updated_at) values (p_kind, g, w, s, e, me.name, clock_timestamp())
    on conflict (kind, grp, dow) do update set start_min = excluded.start_min, end_min = excluded.end_min, editor = excluded.editor, updated_at = excluded.updated_at;
    n := n + 1;
  end loop;
  perform public.ws_log(me.name, case when p_kind = 'hvac' then '공조기 가동시간 설정' else '에어커튼 가동시간 설정' end, '', n || '칸');
  return public.ws_equip_hours_data(p_kind);
end $$;

revoke all on function public.ws_equip_units_on(text, date), public.ws_usage_data(text, date), public.ws_equip_hours_data(text),
  public.ws_equip_hours_get(text, text), public.ws_equip_hours_save(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ws_equip_hours_get(text, text), public.ws_equip_hours_save(text, text, jsonb) to authenticated;
