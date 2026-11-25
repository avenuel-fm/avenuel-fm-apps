-- 17_regrant.sql — 03_docs.sql을 예전 판으로 다시 실행하면 ws_ 함수 권한이 모두 지워져 앱이 「permission denied for function」 오류를 냄 (11-20).
-- 이 파일은 04~16번 SQL의 권한(grant·revoke) 문장만 순서대로 다시 적용합니다. 표·자료는 건드리지 않으며 몇 번 실행해도 같은 결과입니다.
-- 아직 실행하지 않은 번호(예: 16_thermal.sql)의 함수는 없어서 그 문장만 건너뜁니다(「건너뜀」 알림). 나중에 그 번호를 실행하면 자기 권한을 스스로 겁니다.
-- Supabase SQL Editor에서 이 파일 전체를 붙여 넣고 Run 한 번. (01·02·03의 권한은 03이 다시 걸었으므로 뺌)

-- 04_attendance.sql
do $rg$ begin
revoke all on function public.ws_at_is_day(text), public.ws_at_boss(public.staff, text, jsonb), public.ws_at_can_fix(public.staff, date),
  public.ws_att_data(public.staff, text), public.ws_att_get(text, text), public.ws_att_put(text, text, jsonb, jsonb),
  public.ws_att_fix(text, text, text, text), public.ws_att_holiday(text, text, jsonb, text)
  from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '04_attendance.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_att_get(text, text), public.ws_att_put(text, text, jsonb, jsonb),
  public.ws_att_fix(text, text, text, text), public.ws_att_holiday(text, text, jsonb, text) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '04_attendance.sql', sqlerrm; end $rg$;

-- 05_fire.sql
do $rg$ begin
revoke all on function public.ws_set_num(text, numeric), public.ws_set_text(text, text), public.ws_kst(timestamptz), public.ws_safe_name(text),
  public.ws_is_qr(text), public.ws_fe_by_qr(text), public.ws_floor_no(text), public.ws_fe_list_(), public.ws_fe_list(text), public.ws_fe_add(text, jsonb),
  public.ws_fe_delete(text, jsonb), public.ws_label_save(text, numeric, numeric), public.ws_fe_status_(text), public.ws_fe_status(text, text),
  public.ws_fe_detail(text, text), public.ws_check_init(text), public.ws_check_file(text, jsonb, text), public.ws_check_submit(text, jsonb, jsonb),
  public.ws_qr_upload_ok(text)
  from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '05_fire.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_fe_list(text), public.ws_fe_add(text, jsonb), public.ws_fe_delete(text, jsonb), public.ws_label_save(text, numeric, numeric),
  public.ws_fe_status(text, text), public.ws_fe_detail(text, text) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '05_fire.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_check_init(text), public.ws_check_submit(text, jsonb, jsonb), public.ws_qr_upload_ok(text) to anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '05_fire.sql', sqlerrm; end $rg$;

-- 06_eh.sql
do $rg$ begin
revoke all on function public.ws_pad3(int), public.ws_eh_floors(), public.ws_eh_seq(text), public.ws_eh_item(public.eh_devices), public.ws_eh_out(text), public.ws_eh_list(text, text),
  public.ws_next_id(text, text[]), public.ws_new_qr(), public.ws_eh_store_save(text, jsonb), public.ws_eh_store_delete(text, text), public.ws_eh_save(text, jsonb),
  public.ws_eh_bulk_(text, jsonb, text, boolean), public.ws_eh_delete(text, jsonb, text), public.ws_eh_printed(text, jsonb, text), public.ws_eh_view(text),
  public.ws_eh_import(text, jsonb)
  from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '06_eh.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_eh_list(text, text), public.ws_eh_store_save(text, jsonb), public.ws_eh_store_delete(text, text), public.ws_eh_save(text, jsonb),
  public.ws_eh_delete(text, jsonb, text), public.ws_eh_printed(text, jsonb, text), public.ws_eh_import(text, jsonb) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '06_eh.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_eh_view(text) to anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '06_eh.sql', sqlerrm; end $rg$;

-- 07_cs.sql
do $rg$ begin
revoke all on function public.ws_cs_rounds(), public.ws_cs_items_(), public.ws_cs_sites_(), public.ws_cs_check_out(public.cs_checks), public.ws_cs_rounds_(date, text),
  public.ws_cs_admin(public.staff), public.ws_cs_home(text), public.ws_cs_site_save(text, jsonb), public.ws_cs_site_end(text, text), public.ws_cs_items_save(text, jsonb),
  public.ws_cs_day(text), public.ws_cs_get(text, text, text, int), public.ws_cs_save(text, text, text, jsonb, int), public.ws_cs_save_pdf(text, text, jsonb)
  from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '07_cs.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_cs_home(text), public.ws_cs_site_save(text, jsonb), public.ws_cs_site_end(text, text), public.ws_cs_items_save(text, jsonb),
  public.ws_cs_get(text, text, text, int), public.ws_cs_save(text, text, text, jsonb, int), public.ws_cs_save_pdf(text, text, jsonb) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '07_cs.sql', sqlerrm; end $rg$;

-- 08_settings.sql
do $rg$ begin
revoke all on function public.ws_boss(text), public.ws_staff_out(), public.ws_toast_sec(), public.ws_pin_taken(text, text), public.ws_admin_staff(text),
  public.ws_admin_set_toast(text, numeric), public.ws_admin_staff_save(text, jsonb), public.ws_admin_staff_pin(text, text, text), public.ws_admin_staff_remove(text, text),
  public.ws_risk_rows_(), public.ws_risk_get(text), public.ws_risk_save(text, jsonb), public.ws_risk_fix(jsonb, int)
  from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '08_settings.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_admin_staff(text), public.ws_admin_set_toast(text, numeric), public.ws_admin_staff_save(text, jsonb),
  public.ws_admin_staff_pin(text, text, text), public.ws_admin_staff_remove(text, text), public.ws_risk_get(text), public.ws_risk_save(text, jsonb) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '08_settings.sql', sqlerrm; end $rg$;

-- 09_migrate.sql
do $rg$ begin
revoke all on function public.ws_migrate_clear() from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '09_migrate.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_migrate_clear() to service_role;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '09_migrate.sql', sqlerrm; end $rg$;

-- 10_archive.sql
do $rg$ begin
revoke all on function public.ws_backup(text) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '10_archive.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_backup(text) to service_role;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '10_archive.sql', sqlerrm; end $rg$;

-- 11_cutover.sql
do $rg$ begin
revoke all on function public.ws_log_weather(date, jsonb) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '11_cutover.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_log_weather(date, jsonb) to service_role;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '11_cutover.sql', sqlerrm; end $rg$;
do $rg$ begin
revoke all on function public.ws_clean_signs(int) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '11_cutover.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_clean_signs(int) to service_role;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '11_cutover.sql', sqlerrm; end $rg$;
do $rg$ begin
revoke all on function public.ws_check_setup() from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '11_cutover.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_check_setup() to service_role;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '11_cutover.sql', sqlerrm; end $rg$;

-- 12_ahu.sql
do $rg$ begin
revoke all on function public.ws_ahu_range(text), public.ws_ahu_data(date), public.ws_ahu_signs(date), public.ws_ahu_get(text, text), public.ws_ahu_save(text, text, jsonb),
  public.ws_ahu_save_pdf(text, text, jsonb) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '12_ahu.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_ahu_get(text, text), public.ws_ahu_save(text, text, jsonb), public.ws_ahu_save_pdf(text, text, jsonb) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '12_ahu.sql', sqlerrm; end $rg$;

-- 13_map.sql
do $rg$ begin
revoke all on function public.ws_map_can_edit(text), public.ws_map_hist_put(text, text, text), public.ws_map_state(timestamptz), public.ws_map_end(text),
  public.ws_map_load(text), public.ws_map_save(text, text, text, text), public.ws_map_base(text, text, text),
  public.ws_map_days(text), public.ws_map_at(text, text), public.ws_map_restore(text, text) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '13_map.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_map_load(text), public.ws_map_save(text, text, text, text), public.ws_map_base(text, text, text),
  public.ws_map_days(text), public.ws_map_at(text, text), public.ws_map_restore(text, text) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '13_map.sql', sqlerrm; end $rg$;

-- 14_spec.sql
do $rg$ begin
revoke all on function public.ws_spec_boot(text), public.ws_spec_index(text), public.ws_spec_page(text, text, int) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '14_spec.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_spec_boot(text), public.ws_spec_index(text), public.ws_spec_page(text, text, int) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '14_spec.sql', sqlerrm; end $rg$;
do $rg$ begin
revoke all on function public.ws_spec_pub_boot(), public.ws_spec_pub_search(text, text[]), public.ws_spec_pub_page(text, int) from public;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '14_spec.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_spec_pub_boot(), public.ws_spec_pub_search(text, text[]), public.ws_spec_pub_page(text, int) to anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '14_spec.sql', sqlerrm; end $rg$;

-- 15_menu.sql
do $rg$ begin
revoke all on function public.ws_menu_off_(), public.ws_menu_open_(text), public.ws_menu_guard(text, text), public.ws_menu(text), public.ws_admin_set_menu(text, text[]) from public, anon, authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '15_menu.sql', sqlerrm; end $rg$;
do $rg$ begin
grant execute on function public.ws_menu(text), public.ws_admin_set_menu(text, text[]) to authenticated;
exception when undefined_function or undefined_object then raise notice '건너뜀 (%): %', '15_menu.sql', sqlerrm; end $rg$;

