-- ============================================================================
-- 업무지원(WS) → Supabase 이관 4단계: 시트 → DB 옮기기 도우미
-- 실행: 08 다음에 SQL Editor 에 붙여 넣고 Run (여러 번 돌려도 안전)
-- 설계: docs/설계/WS_Supabase이관.md 4.15
--
--  · ws_migrate_clear(): 자료 표를 모두 비움 (Apps Script migrateSheetToSupabase 가 옮기기 전에 부름)
--  · service_role(관리자 열쇠)만 부를 수 있음 — 앱 화면(anon·로그인 기기)은 못 부름
--  · 바꿔 탄 뒤에는 부르지 않음 (앱에서 새로 쓴 자료가 지워짐)
-- ============================================================================
create or replace function public.ws_migrate_clear()
returns void language sql security definer set search_path = public as $$
  truncate table public.cs_checks, public.cs_items, public.cs_sites, public.eh_devices, public.eh_stores, public.fire_checks, public.fire_ext,
    public.default_holidays, public.roster_changes, public.roster, public.daily_log, public.risk_list, public.tbm, public.next_work, public.signs,
    public.ws_sessions, public.ws_pin_guard, public.change_log, public.staff, public.settings, public.files
  restart identity cascade;
$$;
revoke all on function public.ws_migrate_clear() from public, anon, authenticated;
grant execute on function public.ws_migrate_clear() to service_role;
