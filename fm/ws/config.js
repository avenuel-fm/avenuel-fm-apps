// 업무지원(WS) Supabase 설정 — 한곳에서 관리 (Supabase 이관 2단계, docs/설계/WS_Supabase이관.md)
// 여기 값은 화면에 그대로 보이는 공개용 값입니다. 데이터는 RLS(로그인한 사용자만)로 지킵니다.
// ⚠ service_role(secret) 키는 절대 여기에 넣지 않습니다 — 구글 Apps Script 스크립트 속성에만.
window.WS_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://kjhsduhufwaihhlfdipf.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_fOT-Mnciwl0HDrPKbfOh4g_VrcOObR6',   // publishable(anon) 키
  SUPABASE_BUCKET_NAME: 'ws-files'   // 01_schema_rls.sql 8장의 공개 버킷
});
