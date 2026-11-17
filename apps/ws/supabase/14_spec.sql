-- ============================================================================
-- 업무지원(WS) 시방서 검색 (결정 140) + 옵저버 역할 (결정 138)
-- 실행: SQL Editor 에 통째로 붙여 넣고 Run (여러 번 돌려도 안전). 08_settings.sql · 13_map.sql 도 다시 Run (옵저버)
-- 설계: docs/설계/WS_시방서검색.md
--
--  · 자료는 도면협의(DW) 지침 검색과 같은 표(dw_guides · dw_files · dw_synonyms)를 읽기만 함 — 같은 Supabase 프로젝트
--    지침 추가·개정·색인은 지금처럼 도면협의 「지침 관리」에서만
--  · DW 읽기 함수는 DW 로그인(소장·부소장 PIN)이 있어야 열리므로, 업무지원 PIN 로그인 표(ws_auth)로 여는 함수를 따로 둠
-- ============================================================================

-- 옵저버: 직원 표 역할 검사에 더함 (01_schema_rls.sql 은 새로 만들 때만 쓰이므로 운영 DB는 여기서 바꿈)
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('소장','부소장','파트장','직원','관리자','옵저버'));

-- 지침 목록(이전 판 포함) + 비슷한 말 — 화면 첫 열기 때 한 번
create or replace function public.ws_spec_boot(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return jsonb_build_object('ok', true, 'guides', public.dw_guides_client_(), 'synonyms', public.dw_synonyms_());
end $$;

-- 모든 검색 항목 (DW dw_guide_index 와 같은 순서) — 화면이 받아 두고 브라우저에서 찾음
create or replace function public.ws_spec_index(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ws_auth(p_token);
  return jsonb_build_object('ok', true, 'entries', (select coalesce(jsonb_agg(e order by g.archived, case when g.archived then 0 else g.ord end, g.archived_at desc nulls last, g.id desc, o), '[]')
    from public.dw_guides g cross join lateral jsonb_array_elements(g.entries) with ordinality x(e, o)));
end $$;

-- 쪽 그림 주소 + 원본 PDF 주소 (버킷에 있을 때만 — 드라이브로 옮긴 PDF는 빈 값)
create or replace function public.ws_spec_page(p_token text, p_guide text, p_page int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.dw_guides; img text; pdf text;
begin
  perform public.ws_auth(p_token);
  select * into g from public.dw_guides where id = p_guide;
  if not found then return jsonb_build_object('ok', false, 'error', '지침을 찾지 못했습니다'); end if;
  select file_url into img from public.dw_files
    where (id::text = g.page_map->>(p_page::text) or drive_id = g.page_map->>(p_page::text)) and storage_path is not null and not trash limit 1;
  select file_url into pdf from public.dw_files where id::text = g.file_id and kind = 'guide_pdf' and storage_path is not null and not trash limit 1;
  return jsonb_build_object('ok', true, 'img', coalesce(img, ''), 'pdf', coalesce(pdf, ''));
end $$;

revoke all on function public.ws_spec_boot(text), public.ws_spec_index(text), public.ws_spec_page(text, text, int) from public, anon, authenticated;
grant execute on function public.ws_spec_boot(text), public.ws_spec_index(text), public.ws_spec_page(text, text, int) to authenticated;
