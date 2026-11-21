-- ============================================================================
-- 업무지원(WS) 서류작업 › 온습도/공조기/에어커튼 입력 (결정 182·184·186) — 옛 [구역별 온습도 확인] 앱 이관
-- 실행: 12_ahu.sql 다음 아무 때나 SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_온습도공조기.md · 옛 앱 자료: docs/온습도앱_옛자료/
--
--  · ahu_unit       = 공조기 목록 (12_ahu.sql) 에 칸 추가: 쓰는 층·옛 번호·구역·기본 시각·전력(kW). 옛 3·37·38번은 active=false 줄
--  · curtain_unit   = 에어커튼 36대 (묶음 키는 옛 기록과 이어지므로 바꾸지 말 것)
--  · climate_zone   = 실내 온습도 재는 곳 19칸 (6F~1F 1·2·3구역, B1F 1구역)
--  · climate_record = 온습도 1번 (저장한 때가 측정 시각, 쌓기만)
--  · equip_usage    = 장비 1대의 하루 가동 (공조기 hvac / 에어커튼 curtain). 기록은 영구 보관 — 지우는 함수 없음
--  · 시각은 분(0~1439). 미가동 = 0시간, 시작·종료가 빈 줄 = 아직 입력 안 함(통계 제외)
-- ============================================================================

-- ── 공조기 목록 칸 추가 ──
alter table public.ahu_unit add column if not exists use_floor text;      -- 쓰는 층 (화면 묶음, 옛 앱 floorGroups) 예 6층
alter table public.ahu_unit add column if not exists old_no int;          -- 옛 온습도 앱 번호 (시트 기록 옮길 때)
alter table public.ahu_unit add column if not exists zone text;           -- PC 표 구역 (1구역·2구역·3구역)
alter table public.ahu_unit add column if not exists def_start int;       -- 기본 시작(분)
alter table public.ahu_unit add column if not exists def_end int;         -- 기본 종료(분) 월~목
alter table public.ahu_unit add column if not exists def_end_wkend int;   -- 기본 종료(분) 금·토·일
alter table public.ahu_unit add column if not exists kw numeric;          -- 전력(kW), 빈 칸 = 환산에서 뺌 (결정 184)

insert into public.ahu_unit (seq, no, room, place, active) values
  (903, 'OLD-3', '', '옛 3번 (화면에서 뺌, 기록만)', false),
  (937, 'OLD-37', '', '옛 37번 (화면에서 뺌, 기록만)', false),
  (938, 'OLD-38', '', '옛 38번 (화면에서 뺌, 기록만)', false)
on conflict (seq) do nothing;

-- 옛 번호 → no · 쓰는 층 · 구역 (WS_온습도공조기 3장). kw 는 건드리지 않음
update public.ahu_unit u set old_no = m.old_no, use_floor = m.fl, zone = m.zn,
  def_start = case m.fl when 'B3층' then 510 else 600 end,
  def_end = case m.fl when '6층' then 1310 when 'B3층' then 1120 else 1160 end,
  def_end_wkend = case m.fl when '6층' then 1310 when 'B3층' then 1120 else 1220 end
from (values
  ('6F-28', 28, '6층', '3구역'), ('6F-32', 32, '6층', '2구역'), ('6F-34', 34, '6층', '1구역'), ('6F-36', 36, '6층', '1구역'), ('7F-39', 39, '6층', '2구역'),
  ('5F-27', 27, '5층', '1구역'), ('6F-29', 29, '5층', '3구역'), ('6F-30', 30, '5층', '3구역'), ('6F-31', 31, '5층', '2구역'), ('6F-33', 33, '5층', '2구역'), ('6F-35', 35, '5층', '1구역'),
  ('4F-21', 21, '4층', '1구역'), ('5F-22', 22, '4층', '3구역'), ('5F-23', 23, '4층', '3구역'), ('5F-24', 24, '4층', '2구역'), ('5F-25', 25, '4층', '2구역'), ('5F-26', 26, '4층', '1구역'),
  ('4F-15', 15, '3층', '3구역'), ('4F-16', 16, '3층', '3구역'), ('4F-17', 17, '3층', '2구역'), ('4F-18', 18, '3층', '2구역'), ('4F-19', 19, '3층', '1구역'), ('4F-20', 20, '3층', '1구역'),
  ('2F-9', 9, '2층', '3구역'), ('2F-10', 10, '2층', '3구역'), ('3F-11', 11, '2층', '2구역'), ('3F-12', 12, '2층', '2구역'), ('3F-13', 13, '2층', '1구역'), ('3F-14', 14, '2층', '1구역'),
  ('B1F-4', 4, '1층', '1구역'), ('B1F-5', 5, '1층', '1구역'), ('B1F-6', 6, '1층', '3구역'), ('B1F-7', 7, '1층', '2구역'), ('B1F-8', 8, '1층', '2구역'),
  ('B1F-1', 1, 'B1층', '1구역'), ('B1F-2', 2, 'B1층', '1구역'),
  ('B3F-1', 40, 'B3층', null), ('B3F-HVU1', 41, 'B3층', null),
  ('OLD-3', 3, null, null), ('OLD-37', 37, null, null), ('OLD-38', 38, null, null)
) m(no, old_no, fl, zn)
where u.no = m.no;

-- ── 에어커튼 36대 ──
create table if not exists public.curtain_unit (
  key           text primary key,              -- 예 1G1OUT-3 (옛 시트 번호 그대로)
  grp           text not null,                 -- 묶음 키 예 1G1OUT
  grp_name      text not null,                 -- 예 1층 1게이트 OUT
  short         text not null,                 -- 화면 묶음 칸 예 1G OUT
  log_grp       text not null,                 -- 종합업무일지 막대 묶음
  n             int not null,                  -- 묶음 안 번호
  single        boolean not null default false,-- 번호 없이 1대 (브릿지)
  tone          text not null default '',      -- 이름 배경 (예외 색: f1out 주황·f1in 하늘·f1 연두·b1·f4·f6)
  seq           int not null,
  def_start     int not null default 600,
  def_end       int not null default 1200,
  def_end_wkend int not null default 1170,
  kw            numeric,
  active        boolean not null default true
);
insert into public.curtain_unit (key, grp, grp_name, short, log_grp, n, single, tone, seq)
select g.k || '-' || i, g.k, g.nm, g.sh, g.lg, i, g.one, g.tn, g.o * 100 + i
from (values
  ('B1G24', '지하1층 24게이트', '지하1층 24G', 'B1 24G', 2, false, 'b1', 1),
  ('1G1OUT', '1층 1게이트 OUT', '1G OUT', '1G OUT', 7, false, 'f1out', 2), ('1G1IN', '1층 1게이트 IN', '1G IN', '1G IN', 5, false, 'f1in', 3),
  ('1G2OUT', '1층 2게이트 OUT', '2G OUT', '2G OUT', 3, false, 'f1out', 4), ('1G2IN', '1층 2게이트 IN', '2G IN', '2G IN', 3, false, 'f1in', 5),
  ('1G6OUT', '1층 6게이트 OUT', '6G OUT', '6G OUT', 3, false, 'f1out', 6), ('1G6IN', '1층 6게이트 IN', '6G IN', '6G IN', 3, false, 'f1in', 7),
  ('1REAR', '1층 후방 피난도어', '후방 피난도어', '후방 도어', 8, false, 'f1', 8),
  ('4BR', '4층 브릿지', '4층 브릿지', '4·6 브릿지', 1, true, 'f4', 9), ('6BR', '6층 브릿지', '6층 브릿지', '4·6 브릿지', 1, true, 'f6', 10)
) g(k, nm, sh, lg, cnt, one, tn, o), generate_series(1, g.cnt) i
on conflict (key) do nothing;

-- ── 실내 온습도 재는 곳 ──
create table if not exists public.climate_zone (
  floor text not null, zone text not null, seq int not null,
  primary key (floor, zone)
);
insert into public.climate_zone (floor, zone, seq)
select f.fl, z.zn, f.o * 10 + z.o
from (values ('6F', 1), ('5F', 2), ('4F', 3), ('3F', 4), ('2F', 5), ('1F', 6)) f(fl, o), (values ('1구역', 1), ('2구역', 2), ('3구역', 3)) z(zn, o)
union all select 'B1F', '1구역', 71
on conflict (floor, zone) do nothing;

create table if not exists public.climate_record (
  id          text primary key,                -- 옛 기록은 시트 id 그대로
  log_date    date not null,                   -- 근무일 (오전 6시 경계)
  measured_at timestamptz not null,
  floor       text not null, zone text not null,
  t numeric not null, h numeric not null, di numeric not null,
  out_t numeric, out_h numeric,
  author      text, src text not null default 'app',   -- app / sheet(옛 기록)
  updated_at  timestamptz not null default now()
);
create index if not exists climate_record_day on public.climate_record (log_date);

create table if not exists public.equip_usage (
  kind       text not null check (kind in ('hvac', 'curtain')),
  log_date   date not null,
  unit       text not null,                    -- ahu_unit.no / curtain_unit.key
  start_min  int, end_min int,
  off        boolean not null default false,   -- 미가동 = 0시간
  supply_t   numeric, exhaust_t numeric,       -- 옛 시트 급기·배기온도 (옮기기만)
  updated_at timestamptz not null default now(),
  editor     text, src text not null default 'app',
  primary key (kind, log_date, unit)
);
create index if not exists equip_usage_day on public.equip_usage (log_date);

alter table public.curtain_unit enable row level security;
alter table public.climate_zone enable row level security;
alter table public.climate_record enable row level security;
alter table public.equip_usage enable row level security;
revoke all on public.curtain_unit, public.climate_zone, public.climate_record, public.equip_usage from anon, authenticated;

-- ── 도우미 ──
-- 불쾌지수 DI = 0.81T + 0.01H(0.99T−14.3) + 46.3 (소수 첫째)
create or replace function public.ws_di(t numeric, h numeric)
returns numeric language sql immutable as $$ select round(0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3, 1) $$;
-- 가동 분: 미가동 0, 시작·종료 다 있으면 차, 아니면 null(미입력)
create or replace function public.ws_run_min(p_off boolean, s int, e int)
returns int language sql immutable as $$ select case when p_off then 0 when s is not null and e is not null then greatest(0, e - s) end $$;
-- 금·토·일
create or replace function public.ws_wkend(d date)
returns boolean language sql immutable as $$ select extract(dow from d) in (0, 5, 6) $$;
create or replace function public.ws_floor_tone(f text)
returns text language sql immutable as $$
  select case f when '6층' then 'f6' when '5층' then 'f5' when '4층' then 'f4' when '3층' then 'f3' when '2층' then 'f2' when '1층' then 'f1' when 'B1층' then 'b1' when 'B3층' then 'b3' else '' end $$;
create or replace function public.ws_power_price()
returns numeric language sql stable security definer set search_path = public as $$
  select case when btrim(coalesce(public.ws_setting('전력단가'), '')) ~ '^\d+(\.\d+)?$' then btrim(public.ws_setting('전력단가'))::numeric end $$;

-- 장비 목록 (화면이 받는 모양). 공조기 순서 = 쓰는 층(6층→B3층) 안에서 엑셀 순서
create or replace function public.ws_equip_units(p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_kind = 'hvac' then
    (select coalesce(jsonb_agg(jsonb_build_object('u', no, 'name', no, 'sub', place, 'grp', use_floor, 'tone', public.ws_floor_tone(use_floor), 'zone', coalesce(zone, ''),
       's', def_start, 'e', def_end, 'ew', def_end_wkend, 'kw', kw) order by array_position(array['6층','5층','4층','3층','2층','1층','B1층','B3층'], use_floor), seq), '[]'::jsonb)
     from public.ahu_unit where active)
  else
    (select coalesce(jsonb_agg(jsonb_build_object('u', key, 'name', case when single then grp_name else n || '번' end, 'sub', case when single then '' else grp_name end,
       'grp', short, 'tone', tone, 's', def_start, 'e', def_end, 'ew', def_end_wkend, 'kw', kw) order by seq), '[]'::jsonb)
     from public.curtain_unit where active)
  end;
$$;

create or replace function public.ws_usage_data(p_kind text, d date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'kind', p_kind, 'day', d, 'workDay', public.ws_work_day(), 'wkend', public.ws_wkend(d),
    'units', public.ws_equip_units(p_kind),
    'recs', (select coalesce(jsonb_object_agg(e.unit, jsonb_build_object('s', e.start_min, 'e', e.end_min, 'off', e.off, 'by', coalesce(e.editor, ''), 'ver', public.ws_ver(e.updated_at))), '{}'::jsonb)
             from public.equip_usage e where e.kind = p_kind and e.log_date = d));
$$;

-- ── 가동시간 ──
create or replace function public.ws_usage_get(p_token text, p_kind text, p_day text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date;
begin
  perform public.ws_auth(p_token);
  if p_kind not in ('hvac', 'curtain') then return jsonb_build_object('ok', false, 'error', '종류가 맞지 않습니다'); end if;
  d := case when coalesce(p_day, '') = '' then public.ws_work_day() else public.ws_date(p_day) end;
  if d is null or d > public.ws_work_day() then return jsonb_build_object('ok', false, 'error', '일자가 맞지 않습니다'); end if;
  return public.ws_usage_data(p_kind, d);
end $$;

-- p_rows = 고친 장비만 [{ "u": "7F-39", "s": 600, "e": 1310, "off": false }]. s·e 둘 다 빈 칸 + off 아님 = 입력 지움(줄은 남김)
create or replace function public.ws_usage_save(p_token text, p_kind text, p_day text, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  d date := public.ws_date(p_day);
  r jsonb; u text; s int; e int; o boolean; nm text; n int := 0;
begin
  if p_kind not in ('hvac', 'curtain') then return jsonb_build_object('ok', false, 'error', '종류가 맞지 않습니다'); end if;
  if d is null or d > public.ws_work_day() or d < public.ws_work_day() - 31 then return jsonb_build_object('ok', false, 'error', '최근 31일 안의 날짜만 고칠 수 있습니다'); end if;
  if jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'error', '저장할 내용이 없습니다'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    u := r->>'u';
    nm := case when p_kind = 'hvac' then (select no from public.ahu_unit where no = u and active) else (select key from public.curtain_unit where key = u and active) end;
    if nm is null then return jsonb_build_object('ok', false, 'error', '장비 ' || coalesce(u, '') || '은(는) 목록에 없습니다'); end if;
    o := coalesce((r->>'off')::boolean, false);
    s := case when o or coalesce(r->>'s', '') = '' then null else (r->>'s')::int end;
    e := case when o or coalesce(r->>'e', '') = '' then null else (r->>'e')::int end;
    if (s is null) <> (e is null) then return jsonb_build_object('ok', false, 'error', u || ': 시작과 종료를 둘 다 넣어 주세요'); end if;
    if s is not null and (s < 0 or s > 1439 or e > 1440 or s % 10 <> 0 or e % 10 <> 0) then return jsonb_build_object('ok', false, 'error', u || ': 시각이 맞지 않습니다 (10분 단위)'); end if;
    if s is not null and e <= s then return jsonb_build_object('ok', false, 'error', u || ': 종료가 시작보다 늦어야 합니다'); end if;
    insert into public.equip_usage as x (kind, log_date, unit, start_min, end_min, off, editor, updated_at)
    values (p_kind, d, u, s, e, o, me.name, clock_timestamp())
    on conflict (kind, log_date, unit) do update set start_min = excluded.start_min, end_min = excluded.end_min, off = excluded.off,
      editor = excluded.editor, updated_at = excluded.updated_at, src = 'app';
    n := n + 1;
  end loop;
  perform public.ws_log(me.name, case when p_kind = 'hvac' then '공조기 가동시간 저장' else '에어커튼 가동시간 저장' end, d::text, n || '대');
  return public.ws_usage_data(p_kind, d);
end $$;

-- 메인 「미입력」 (결정 184, Q6): 그날 기본 종료 시각(월~목 19:20, 금토일 20:20)이 지나면 오늘, 그 전에는 어제 남은 것
create or replace function public.ws_usage_missing(p_kind text, d date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from jsonb_array_elements(public.ws_equip_units(p_kind)) x
  where not exists (select 1 from public.equip_usage e where e.kind = p_kind and e.log_date = d and e.unit = x->>'u'
                    and (e.off or (e.start_min is not null and e.end_min is not null)));
$$;
create or replace function public.ws_usage_todo(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wd date; k timestamp; m int; d date; lbl text; fin int;
begin
  perform public.ws_auth(p_token);
  wd := public.ws_work_day();
  k := now() at time zone 'Asia/Seoul';
  m := extract(hour from k)::int * 60 + extract(minute from k)::int;
  fin := case when public.ws_wkend(wd) then 1220 else 1160 end;   -- plpgsql IF 안에는 CASE … THEN 을 못 씀
  if k::date > wd or m >= fin then d := wd; lbl := '오늘';   -- 자정 뒤(근무일 끝)도 오늘 몫
  else d := wd - 1; lbl := '어제'; end if;
  return jsonb_build_object('ok', true, 'day', d, 'when', lbl, 'hvac', public.ws_usage_missing('hvac', d), 'curtain', public.ws_usage_missing('curtain', d));
end $$;

-- 리포트 자료: 기간 안 장비별 하루 분 [[날짜, 장비, 분], …] + 목록(kW) + 단가. 계산은 화면에서 (옛 앱과 같은 식)
create or replace function public.ws_usage_report(p_token text, p_kind text, p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a date := public.ws_date(p_from); b date := public.ws_date(p_to);
begin
  perform public.ws_auth(p_token);
  if p_kind not in ('hvac', 'curtain') or b is null then return jsonb_build_object('ok', false, 'error', '기간이 맞지 않습니다'); end if;
  a := coalesce(a, (select min(log_date) from public.equip_usage where kind = p_kind), b);
  return jsonb_build_object('ok', true, 'kind', p_kind, 'from', a, 'to', b, 'workDay', public.ws_work_day(), 'price', public.ws_power_price(),
    'first', (select min(log_date) from public.equip_usage where kind = p_kind),
    'units', public.ws_equip_units(p_kind),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(e.log_date, e.unit, public.ws_run_min(e.off, e.start_min, e.end_min)) order by e.log_date), '[]'::jsonb)
             from public.equip_usage e where e.kind = p_kind and e.log_date between a and b and public.ws_run_min(e.off, e.start_min, e.end_min) is not null));
end $$;

-- ── 온습도 ──
create or replace function public.ws_climate_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wd date;
begin
  perform public.ws_auth(p_token);
  wd := public.ws_work_day();
  return jsonb_build_object('ok', true, 'day', wd,
    'zones', (select jsonb_agg(jsonb_build_array(floor, zone) order by seq) from public.climate_zone),
    'recs', (select coalesce(jsonb_agg(jsonb_build_object('at', to_char(measured_at at time zone 'Asia/Seoul', 'HH24:MI'), 'floor', floor, 'zone', zone, 't', t, 'h', h, 'di', di) order by measured_at), '[]'::jsonb)
             from public.climate_record where log_date = wd));
end $$;

-- p_rows = 넣은 구역만 [{ "floor": "6F", "zone": "1구역", "t": "24.1", "h": "52" }], p_out = { "t": "11.2", "h": "48" } (빈 칸 가능)
create or replace function public.ws_climate_add(p_token text, p_rows jsonb, p_out jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_auth(p_token);
  r jsonb; t numeric; h numeric; ot numeric; oh numeric; n int := 0;
  num text := '^-?\d+(\.\d+)?$';
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_object('ok', false, 'error', '온도·습도를 넣은 구역이 없습니다'); end if;
  if coalesce(btrim(p_out->>'t'), '') <> '' then
    if btrim(p_out->>'t') !~ num or btrim(p_out->>'t')::numeric not between -30 and 50 then return jsonb_build_object('ok', false, 'error', '실외온도는 -30 ~ 50 숫자로 넣어 주세요'); end if;
    ot := round(btrim(p_out->>'t')::numeric, 1);
  end if;
  if coalesce(btrim(p_out->>'h'), '') <> '' then
    if btrim(p_out->>'h') !~ num or btrim(p_out->>'h')::numeric not between 0 and 100 then return jsonb_build_object('ok', false, 'error', '실외습도는 0 ~ 100 숫자로 넣어 주세요'); end if;
    oh := round(btrim(p_out->>'h')::numeric);
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if not exists (select 1 from public.climate_zone where floor = r->>'floor' and zone = r->>'zone') then return jsonb_build_object('ok', false, 'error', '측정 위치가 맞지 않습니다'); end if;
    if coalesce(btrim(r->>'t'), '') !~ num or btrim(r->>'t')::numeric not between -10 and 50 then return jsonb_build_object('ok', false, 'error', (r->>'floor') || ' ' || (r->>'zone') || ' 온도는 -10 ~ 50 숫자로 넣어 주세요'); end if;
    if coalesce(btrim(r->>'h'), '') !~ num or btrim(r->>'h')::numeric not between 0 and 100 then return jsonb_build_object('ok', false, 'error', (r->>'floor') || ' ' || (r->>'zone') || ' 습도는 0 ~ 100 숫자로 넣어 주세요'); end if;
    t := round(btrim(r->>'t')::numeric, 1); h := round(btrim(r->>'h')::numeric);
    insert into public.climate_record (id, log_date, measured_at, floor, zone, t, h, di, out_t, out_h, author)
    values (gen_random_uuid()::text, public.ws_work_day(), clock_timestamp(), r->>'floor', r->>'zone', t, h, public.ws_di(t, h), ot, oh, me.name);
    n := n + 1;
  end loop;
  perform public.ws_log(me.name, '온습도 저장', public.ws_work_day()::text, n || '곳');
  return public.ws_climate_get(p_token);
end $$;

create or replace function public.ws_climate_report(p_token text, p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a date := public.ws_date(p_from); b date := public.ws_date(p_to);
begin
  perform public.ws_auth(p_token);
  if b is null then return jsonb_build_object('ok', false, 'error', '기간이 맞지 않습니다'); end if;
  a := coalesce(a, (select min(log_date) from public.climate_record), b);
  return jsonb_build_object('ok', true, 'from', a, 'to', b, 'first', (select min(log_date) from public.climate_record),
    'zones', (select jsonb_agg(jsonb_build_array(floor, zone) order by seq) from public.climate_zone),
    'rows', (select coalesce(jsonb_agg(jsonb_build_array(to_char(measured_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), floor, zone, t, h, di, out_t, out_h) order by measured_at), '[]'::jsonb)
             from public.climate_record where log_date between a and b));
end $$;

-- ── 전력(kW)·단가 (환경설정, 소장만 고침) ──
create or replace function public.ws_equip_kw_get(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_boss(p_token);
  return jsonb_build_object('ok', true, 'price', public.ws_power_price(), 'hvac', public.ws_equip_units('hvac'), 'curtain', public.ws_equip_units('curtain'));
end $$;
-- p_d = { "price": "130.5" 또는 "", "hvac": { "7F-39": "7.5" 또는 "" }, "curtain": { "1G1OUT-1": "1.2" } } — 고친 것만
create or replace function public.ws_equip_kw_save(p_token text, p_d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me public.staff := public.ws_boss(p_token);
  k text; v text; nv numeric;
begin
  if p_d ? 'price' then
    v := btrim(coalesce(p_d->>'price', ''));
    if v <> '' and (v !~ '^\d+(\.\d+)?$' or v::numeric > 10000) then return jsonb_build_object('ok', false, 'error', '단가는 0 ~ 10000 숫자(원/kWh)로 넣어 주세요'); end if;
    insert into public.settings (key, value) values ('전력단가', v) on conflict (key) do update set value = excluded.value;
  end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_d->'hvac', '{}'::jsonb)) union all select key, value from jsonb_each_text(coalesce(p_d->'curtain', '{}'::jsonb)) loop
    v := btrim(coalesce(v, ''));
    if v <> '' and (v !~ '^\d+(\.\d+)?$' or v::numeric > 1000) then return jsonb_build_object('ok', false, 'error', k || ' 전력은 0 ~ 1000 숫자(kW)로 넣어 주세요'); end if;
    nv := nullif(v, '')::numeric;
    if exists (select 1 from public.ahu_unit where no = k) then update public.ahu_unit set kw = nv where no = k;
    elsif exists (select 1 from public.curtain_unit where key = k) then update public.curtain_unit set kw = nv where key = k;
    else return jsonb_build_object('ok', false, 'error', '장비 ' || k || '은(는) 목록에 없습니다'); end if;
  end loop;
  perform public.ws_log(me.name, '장비 전력·단가 저장', '', '');
  return public.ws_equip_kw_get(p_token);
end $$;

-- ── 종합업무일지 「공조기 · 에어커튼 가동」 (결정 120 → 184): 구글 ?api=logac 와 같은 답 모양
--    { hvac|curtain: { name, total, entered, off, groups: [[묶음, [시간|null…]]], c: {d,m,y}, p: {d,m,y} } }
create or replace function public.ws_log_ac_kind(p_kind text, d date, pd date)
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select x->>'u' u, case when p_kind = 'hvac' then (case when x->>'grp' like 'B%' then replace(x->>'grp', '층', '') else x->>'grp' end)
                                     else (select log_grp from public.curtain_unit where key = x->>'u') end g, ord
             from jsonb_array_elements(public.ws_equip_units(p_kind)) with ordinality t(x, ord)),
  h as (select e.log_date, e.unit, public.ws_run_min(e.off, e.start_min, e.end_min) / 60.0 hr
        from public.equip_usage e join u on u.u = e.unit
        where e.kind = p_kind and public.ws_run_min(e.off, e.start_min, e.end_min) is not null
          and ((e.log_date between date_trunc('year', d)::date and d) or (e.log_date between date_trunc('year', pd)::date and pd))),
  s as (select x, (select round(sum(hr), 1) from h where log_date between a and x) v, a
        from (values (d, d), (d, date_trunc('month', d)::date), (d, date_trunc('year', d)::date),
                     (pd, pd), (pd, date_trunc('month', pd)::date), (pd, date_trunc('year', pd)::date)) q(x, a)),
  dh as (select unit, hr from h where log_date = d),
  gr as (select g, min(ord) o, jsonb_agg((select to_jsonb(round(dh.hr, 1)) from dh where dh.unit = u.u) order by ord) hs from u group by g)
  select jsonb_build_object('name', case when p_kind = 'hvac' then '공조기' else '에어커튼' end,
    'total', (select count(*) from u), 'entered', (select count(*) from dh), 'off', (select count(*) from dh where hr = 0),
    'groups', (select jsonb_agg(jsonb_build_array(g, hs) order by o) from gr),
    'c', jsonb_build_object('d', (select v from s where x = d and a = d), 'm', (select v from s where x = d and a = date_trunc('month', d)::date), 'y', (select v from s where x = d and a = date_trunc('year', d)::date)),
    'p', jsonb_build_object('d', (select v from s where x = pd and a = pd), 'm', (select v from s where x = pd and a = date_trunc('month', pd)::date), 'y', (select v from s where x = pd and a = date_trunc('year', pd)::date)));
$$;
create or replace function public.ws_log_ac(p_token text, p_day text, p_prev text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := public.ws_date(p_day); pd date := public.ws_date(p_prev);
begin
  perform public.ws_auth(p_token);
  if d is null then return jsonb_build_object('ok', false, 'error', '일자가 맞지 않습니다'); end if;
  pd := coalesce(pd, (d - interval '1 year')::date);
  return jsonb_build_object('ok', true, 'day', d, 'ac', jsonb_build_object('hvac', public.ws_log_ac_kind('hvac', d, pd), 'curtain', public.ws_log_ac_kind('curtain', d, pd)));
end $$;

-- ── 권한: 도우미는 막음, 화면 함수만 로그인 기기에 ──
revoke all on function public.ws_di(numeric, numeric), public.ws_run_min(boolean, int, int), public.ws_wkend(date), public.ws_floor_tone(text), public.ws_power_price(),
  public.ws_equip_units(text), public.ws_usage_data(text, date), public.ws_usage_missing(text, date), public.ws_log_ac_kind(text, date, date),
  public.ws_usage_get(text, text, text), public.ws_usage_save(text, text, text, jsonb), public.ws_usage_todo(text), public.ws_usage_report(text, text, text, text),
  public.ws_climate_get(text), public.ws_climate_add(text, jsonb, jsonb), public.ws_climate_report(text, text, text),
  public.ws_equip_kw_get(text), public.ws_equip_kw_save(text, jsonb), public.ws_log_ac(text, text, text) from public, anon, authenticated;
grant execute on function public.ws_usage_get(text, text, text), public.ws_usage_save(text, text, text, jsonb), public.ws_usage_todo(text), public.ws_usage_report(text, text, text, text),
  public.ws_climate_get(text), public.ws_climate_add(text, jsonb, jsonb), public.ws_climate_report(text, text, text),
  public.ws_equip_kw_get(text), public.ws_equip_kw_save(text, jsonb), public.ws_log_ac(text, text, text) to authenticated;
