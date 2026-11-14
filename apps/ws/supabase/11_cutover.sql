-- ============================================================================
-- 업무지원(WS) → Supabase 바꿔 타는 날: 구글 예약 작업이 DB에 쓰는 함수
-- 실행: 10 다음에 SQL Editor 에 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.17
--
--  · ws_log_weather(일자, 날씨): 매일 오후 1시 네이버 날씨 → 그날 일지의 **빈 날씨 칸만** 채움 (Code.gs logWeatherFill_ 와 같음)
--      줄이 없으면 날씨만 든 줄을 만듦. 수정시각(updated_at)은 그대로 → 일지를 보고 있던 화면이 저장해도 겹침 안 남
--  · ws_clean_signs(일수): 매일 새벽 3시 — TBM PDF에 안 쓰인 서명을 90일 뒤 지운 표시, 드라이브로 옮긴 서명 그림 번호를 돌려줌(Apps Script가 휴지통으로)
--  · 둘 다 service_role(관리자 열쇠)만 — 앱 화면은 못 부름
-- ============================================================================
create or replace function public.ws_log_weather(p_day date, p_w jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  num text[] := array['최저', '최고', '최고풍속', '미세먼지'];
  k text;
  v jsonb := '{}'::jsonb;
  wx text := nullif(public.ws_clean(p_w->>'날씨', 10), '');
  grade text := nullif(p_w->>'미세먼지등급', '');
  r public.daily_log;
  filled text[] := '{}';
begin
  if p_day is null then raise exception '일자가 없습니다'; end if;
  foreach k in array num loop
    v := v || jsonb_build_object(k, case when btrim(coalesce(p_w->>k, '')) ~ '^-?\d+(\.\d+)?$' then (p_w->>k)::numeric end);
  end loop;
  if grade is not null and grade not in ('좋음', '보통', '나쁨', '매우나쁨') then grade := null; end if;
  perform pg_advisory_xact_lock(hashtext('ws_log_' || p_day));   -- 일지 저장(ws_log_save_)과 같은 자물쇠
  select * into r from public.daily_log where log_date = p_day;
  if wx is not null and r.weather is null then filled := array_append(filled, '날씨'); end if;
  if v->>'최저' is not null and r.t_min is null then filled := array_append(filled, '최저'); end if;
  if v->>'최고' is not null and r.t_max is null then filled := array_append(filled, '최고'); end if;
  if v->>'최고풍속' is not null and r.wind_max is null then filled := array_append(filled, '최고풍속'); end if;
  if v->>'미세먼지' is not null and r.pm is null then filled := array_append(filled, '미세먼지'); end if;
  if grade is not null and r.pm_grade is null then filled := array_append(filled, '미세먼지등급'); end if;
  if cardinality(filled) = 0 then return jsonb_build_object('ok', true, 'filled', '[]'::jsonb); end if;
  insert into public.daily_log as t (log_date, weather, t_min, t_max, wind_max, pm, pm_grade, weather_source)
  values (p_day, wx, (v->>'최저')::numeric, (v->>'최고')::numeric, (v->>'최고풍속')::numeric, (v->>'미세먼지')::numeric, grade, '네이버')
  on conflict (log_date) do update set
    weather = coalesce(t.weather, excluded.weather), t_min = coalesce(t.t_min, excluded.t_min), t_max = coalesce(t.t_max, excluded.t_max),
    wind_max = coalesce(t.wind_max, excluded.wind_max), pm = coalesce(t.pm, excluded.pm), pm_grade = coalesce(t.pm_grade, excluded.pm_grade),
    weather_source = '네이버';
  perform public.ws_log('예약 작업', '종합업무일지 날씨', p_day::text, array_to_string(filled, ','));
  return jsonb_build_object('ok', true, 'filled', to_jsonb(filled));
end $$;
revoke all on function public.ws_log_weather(date, jsonb) from public, anon, authenticated;
grant execute on function public.ws_log_weather(date, jsonb) to service_role;

create or replace function public.ws_clean_signs(p_days int default 90)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
  drive jsonb;
begin
  with gone as (
    update public.signs set deleted = true
    where not deleted and not tbm_used and work_day < public.ws_work_day() - greatest(coalesce(p_days, 90), 30)
    returning sign_file_id)
  select count(*), coalesce(jsonb_agg(f.drive_id) filter (where f.is_archived and f.drive_id is not null), '[]'::jsonb) into n, drive
  from gone g left join public.files f on f.id = g.sign_file_id;
  if n > 0 then perform public.ws_log('예약 작업', '서명 정리', '', n || '개'); end if;
  return jsonb_build_object('ok', true, 'n', n, 'drive', drive);
end $$;
revoke all on function public.ws_clean_signs(int) from public, anon, authenticated;
grant execute on function public.ws_clean_signs(int) to service_role;
