// 바로가기 페이지(저장소 fm/)를 시험에서 그대로 씀 — 사본을 두지 않아 build:fm 뒤 옛 화면을 시험하는 일이 없음
// 바꿔 끼우는 것: apps.js의 업무지원 주소(시험 주소), anyExec면 ws/index.html의 주소 모양 검사 끔
const fs = require('fs'), path = require('path');
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function swap(s, re, to, what) {
  if (!re.test(s)) throw new Error('fm_serve: ' + what + '을(를) 찾지 못했습니다 — fm/ 파일 모양이 바뀌었으면 이 시험 도우미도 고쳐 주세요');
  return s.replace(re, to);
}
module.exports = function fmFile(p, exec, anyExec) {
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const f = path.join(FM, path.normalize(p).replace(/^([\\/]*\.\.)+/, ''));
  let body = fs.readFileSync(f);
  if (p === 'apps.js') body = swap(String(body), /(ws:\s*\{[^}]*exec:\s*)'[^']*'/, "$1" + JSON.stringify(exec), 'apps.js 업무지원 주소');
  // 이 시험들은 옛 구글 앱(껍데기 → /exec, ?fe= → check.html)을 봄 → 바꿔 탄 뒤(LIVE true)에도 LIVE false 로 (새 앱은 sb_*_test.js)
  if (p === 'ws/config.js') body = swap(String(body), /LIVE: (true|false),/, 'LIVE: false,', 'ws/config.js LIVE');
  if (anyExec && p === 'ws/index.html') body = swap(String(body), /if \(!\/\^https:.*\.test\(app\.exec \|\| ''\)\) \{/, 'if (false) {', 'ws/index.html 주소 검사');
  return { body, type: TYPES[path.extname(f)] || 'application/octet-stream' };
};
