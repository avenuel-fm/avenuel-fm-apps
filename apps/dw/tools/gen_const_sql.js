// src/Code.gs 의 정해진 값(검토서 항목 FIELDS·매장 칸·기본 문구 …) → supabase/02_const.sql 의 dw_const()
// Code.gs 에서 이 값들을 바꾸면 이 스크립트를 다시 돌리고 Supabase SQL Editor 에서 02_const.sql 을 다시 실행합니다.
// 사용: node tools/gen_const_sql.js   (시험 sql_test.js 가 둘이 같은지 확인함)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
function constOf(code) {
  const ctx = {};
  vm.runInNewContext(code, ctx);   // 맨 위 var 선언만 실행됨 (함수 안은 안 돎)
  const c = {
    fields: ctx.FIELDS,
    storeKeys: ctx.STORE_COLS.map(x => x[0]),
    reviewMetaKeys: ctx.REVIEW_META_COLS.map(x => x[0]),
    kitchenDep: ctx.KITCHEN_DEPENDENT, popupTypes: ctx.POPUP_TYPES, popupDep: ctx.POPUP_DEPENDENT,
    rules: ctx.DEFAULT_RULES, phraseCats: ctx.PHRASE_CATS, phrases: ctx.DEFAULT_PHRASES, synonyms: ctx.DEFAULT_SYNONYMS,
    storeLabel: ctx.APP.STORE_LABEL, docPrefix: ctx.APP.DOC_PREFIX, roles: ctx.APP.ROLES,
    signature: ctx.APP.SPEC_SIGNATURE, specFrom: ctx.APP.SPEC_FROM, specFromName: ctx.APP.SPEC_FROM_NAME,
    sigMax: ctx.APP.SIG_MAX_CHARS, photoMax: ctx.APP.PHOTO_MAX,
    docNames: ctx.DOC_NAMES, sigWho: ctx.SIG_WHO, sigDays: ctx.SIG_DAYS
  };
  return JSON.parse(JSON.stringify(c));
}
function sqlOf(c) {
  const j = JSON.stringify(c).replace(/'/g, "''");
  return '-- 자동 생성: tools/gen_const_sql.js (src/Code.gs 의 정해진 값). 직접 고치지 마세요.\n' +
    '-- 도면협의 Supabase 이관 2: 검토서 항목·매장 칸·기본 문구 — 화면에 보내는 값과 DB 함수가 검사하는 값이 같은 곳에서 나옴\n' +
    'create or replace function public.dw_const() returns jsonb language sql immutable as $dw$\nselect \'' + j + "'::jsonb\n$dw$;\n" +
    'revoke all on function public.dw_const() from public, anon, authenticated;\n';
}
module.exports = { constOf, sqlOf };
if (require.main === module) {
  const c = constOf(fs.readFileSync(path.join(ROOT, 'src/Code.gs'), 'utf8'));
  fs.writeFileSync(path.join(ROOT, 'supabase/02_const.sql'), sqlOf(c));
  console.log('supabase/02_const.sql · 항목', c.fields.length, '· 매장 칸', c.storeKeys.length);
}
