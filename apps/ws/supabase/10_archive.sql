-- ============================================================================
-- 업무지원(WS) → Supabase 이관 5단계: 주 1회 드라이브 옮기기의 DB 백업 도우미
-- 실행: 09 다음에 SQL Editor 에 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.16
--
--  · ws_backup(표 이름): 그 표 전체를 JSON 하나로 (Apps Script archiveBackup_ 가 CSV로 바꿔 드라이브에 저장)
--    REST 표 읽기는 한 번에 1000줄까지라, 함수 하나로 통째로 받음
--  · service_role(관리자 열쇠)만 — 앱 화면은 못 부름. 정해 둔 표만 (기기 표 ws_sessions 등은 안 됨)
-- ============================================================================
create or replace function public.ws_backup(p_table text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  if p_table is null or not (p_table = any (array['files', 'settings', 'staff', 'change_log', 'signs', 'next_work', 'tbm', 'risk_list', 'daily_log',
      'roster', 'roster_changes', 'default_holidays', 'fire_ext', 'fire_checks', 'eh_stores', 'eh_devices', 'cs_sites', 'cs_items', 'cs_checks', 'ahu_unit', 'ahu_temp'])) then
    raise exception '백업할 수 없는 표: %', p_table;
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from public.%I t', p_table) into r;
  return r;
end $$;
revoke all on function public.ws_backup(text) from public, anon, authenticated;
grant execute on function public.ws_backup(text) to service_role;
