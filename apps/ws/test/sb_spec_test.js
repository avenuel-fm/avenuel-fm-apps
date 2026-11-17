// 시방서 검색 화면 시험 (결정 140) + 직원 추가 창의 옵저버 (결정 138)
// 메인 4번째 칸 「시방서 검색」 → 도면협의 지침 자료를 읽기만 · 비슷한 말 · 띄어쓰기 무시 · 지침별 · 이전 판 · 쪽 보기(PC 오른쪽 칸 / 휴대폰 창) · 참조 복사
// 진짜 Supabase 대신 가짜 DB 함수(이 파일 RPC). DB 함수 자체는 sql_test.js (14_spec.sql)
// 먼저: python tools/build_fm.py   그다음: node test/sb_spec_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8134, BASE = 'http://localhost:' + PORT;
const exp = Date.now() + 3600e3;
const TOK = 'S003.' + exp + '.emp';
const GUIDES = [{ id: 'G1', title: '롯데백화점 Tenant 시설공사 지침', short: '시설공사', pages: 86, images: true },
  { id: 'G2', title: '통합안전관리지침', short: '통합안전', pages: 52, images: true },
  { id: 'G0', title: '옛 시설공사 지침', short: '시설공사', pages: 80, images: true, archived: true, archivedAt: '2026-01-01' }];
const ENTRIES = [
  { d: 'G1', p: 12, s: '소방', h: '3.4 방화구획 및 관통부 처리', t: '매장 경계벽이 방화구획인 경우 배관·덕트 관통부는 내화충전재로 메운다.', b: [[0.08, 0.15, 0.9, 0.2, 0], [0.08, 0.2, 0.9, 0.25, 20]] },
  { d: 'G1', p: 30, s: '소방', h: '감지기', t: '천장 높이 변경 시 감지기 위치를 다시 정한다.' },
  { d: 'G2', p: 31, s: '방화및방염관련', h: '2. 방화벽', t: '공사 중 방화벽을 임시로 해체할 때에는 방재실과 협의한다.' },
  { d: 'G0', p: 11, t: '옛 판: 방화구획 관통부 처리.' }];
const PAGES = [];
const RPC = {
  ws_bootstrap() { return { ok: true, user: { staff_id: 'S003', name: '이영희', part: '전방파트', role: '직원' }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_spec_boot() { return { ok: true, guides: GUIDES, synonyms: [['방화구획', '방화 구획', '방화벽']] }; },
  ws_spec_index() { return { ok: true, entries: ENTRIES }; },
  ws_spec_pub_boot() { return { ok: true, guides: GUIDES.filter(g => !g.archived), synonyms: [['방화구획', '방화 구획', '방화벽']] }; },
  ws_spec_pub_index() { return { ok: true, entries: ENTRIES.filter(e => e.d !== 'G0') }; },
  ws_spec_pub_page(a) { PAGES.push('pub:' + a.p_guide + ':' + a.p_page + ':' + ('p_token' in a)); return { ok: true, img: BASE + '/page.svg', pdf: '' }; },
  ws_spec_page(a) { PAGES.push(a.p_guide + ':' + a.p_page); return { ok: true, img: BASE + '/page.svg', pdf: a.p_guide === 'G1' ? BASE + '/g1.pdf' : '' }; }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return {
    auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } }
  };
} };`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="848"><rect width="600" height="848" fill="#fff"/><text x="40" y="140">3.4</text></svg>';
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/rpc/')) { const f = RPC[u.pathname.slice(5)] || (() => ({ ok: true })); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: f(JSON.parse(body || '{}')) })); }
    if (u.pathname === '/page.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(SVG); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);

async function open(b, opts, url) {
  const c = await b.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opts || {}));
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route(/fonts\.googleapis|cdnjs\.cloudflare/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  if (!url) await c.addInitScript(t => localStorage.setItem('ws_token', t), TOK);
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(BASE + (url || '/ws/app.html'));
  await p.locator(url ? '#spQ' : '.grid6').waitFor();
  return p;
}
const texts = (p, sel) => p.locator(sel).allInnerTexts();

(async () => {
  const b = await chromium.launch();
  // ── PC ──
  const p = await open(b, { permissions: ['clipboard-read', 'clipboard-write'] });
  const tiles = await texts(p, '.grid6 .tile');
  ok(/시방서 검색/.test(tiles[3]) && /서류작업/.test(tiles[0]), '1) 메인 4번째(서류작업 아래) 칸이 「시방서 검색」');
  await p.click('.grid6 .tile:has-text("시방서 검색")');
  await p.locator('#spQ').waitFor();
  ok(/시방서 검색/.test(await p.locator('header.top').innerText()) && (await texts(p, '.spside li')).length === 2, '2) 직원도 열림 · 검색하는 지침 2개 (이전 판은 목록에서 뺌)');
  ok(/검색어를 넣거나/.test(await p.locator('#spRes').innerText()), '3) 처음엔 안내 글');
  await p.fill('#spQ', '방화구획');
  let hits = await texts(p, '#spRes .sphit');
  ok(hits.length === 2 && /비슷한 말도 찾음: 방화벽$/.test(await p.locator('#spSyn').innerText()), '4) 검색 + 비슷한 말(방화벽)까지 2건, 이전 판은 뺌');
  const chips = await texts(p, '#spF button');
  ok(/전체 2/.test(chips[0]) && /시설공사 1/.test(chips[1]) && /통합안전 1/.test(chips[2]) && /이전 판 포함/.test(chips[chips.length - 1]), '5) 지침별 건수 · 이전 판 포함 단추');
  await p.locator('#spPv .sppv-b img').waitFor();
  const fit = async pg => pg.evaluate(() => [...document.querySelectorAll('.sppv-b')].filter(b => b.offsetParent).every(b => { const g = b.querySelector('.sppg'); return g && g.getBoundingClientRect().bottom <= b.getBoundingClientRect().bottom + 1 && b.scrollHeight <= b.clientHeight + 1; }));
  await p.waitForFunction(() => { const g = document.querySelector('#spPv .sppg'); return g && g.style.width; });
  ok(await fit(p), '6-1) PC: 쪽 한 장이 칸 안에 다 보임 (아래 안 잘림, 스크롤 없음)');
  await p.click('#spPv [aria-label="크게"]'); await p.waitForFunction(() => /125%/.test(document.querySelector('#spPv .sptools').textContent));
  await p.waitForFunction(() => document.querySelector('#spPv .sppv-b').scrollHeight > document.querySelector('#spPv .sppv-b').clientHeight + 1);
  ok(true, '6-2) + 누르면 그때 크게 (스크롤로 봄)');
  await p.click('#spPv [aria-label="작게"]');
  ok(await p.locator('#spPv .hl').count() >= 1 && await p.locator('#spPv .spo').isVisible() && /3\.4 방화구획/.test(await p.locator('#spPv .spttl').innerText()), '6) PC: 첫 결과의 쪽이 오른쪽에 바로 · 노란 표시 · PDF 원본 단추');
  await p.locator('#spRes .sphit').nth(1).click();
  await p.waitForFunction(() => /방화벽/.test(document.querySelector('#spPv .spttl').textContent));
  await p.locator('#spPv .sppv-b img').waitFor();
  ok(PAGES.includes('G2:31') && !(await p.locator('#spPv .spo').isVisible()) && await p.locator('#spRes .sphit.on').count() === 1, '7) 다른 결과 누르면 오른쪽 쪽이 바뀜 (원본 PDF 없으면 단추 숨김)');
  await p.click('#spF button:has-text("통합안전")');
  ok((await texts(p, '#spRes .sphit')).length === 1, '8) 지침 고르기 → 그 지침 결과만');
  await p.click('#spF button:has-text("전체")');
  await p.click('#spF .old');
  hits = await texts(p, '#spRes .sphit');
  ok(hits.length === 3 && hits.some(t => /이전 판/.test(t)), '9) 이전 판 포함 → 옛 판 결과도 (표시 붙음)');
  await p.click('#spF .old');
  await p.fill('#spQ', '방 화구 획');
  ok((await texts(p, '#spRes .sphit')).length >= 1, '10) 띄어쓰기가 달라도 찾음');
  await p.fill('#spQ', '방화구획');
  await p.locator('#spRes .sphit').first().locator('.btn.pri').click();
  ok(await p.evaluate(() => navigator.clipboard.readText()) === '(시설공사 소방, p.12)', '11) 참조 복사 → (시설공사 소방, p.12)');
  await p.locator('#spRes .sphit').first().locator('.btn:has-text("쪽 크게 보기")').click();
  await p.locator('.spsheet .sppv-b img').waitFor();
  await p.click('.spsheet [aria-label="닫기"]');
  ok(await p.locator('.spsheet').count() === 0, '12) 쪽 크게 보기 창 열고 닫기');
  await p.fill('#spQ', '없는말');
  ok(/해당하는 내용이 없습니다/.test(await p.locator('#spRes').innerText()) && await p.locator('#spPv .sppv').count() === 0, '13) 결과 없음 안내 · 쪽 보기 비움');
  await p.click('.spchips button:has-text("감지기")');
  ok((await p.inputValue('#spQ')) === '감지기' && (await texts(p, '#spRes .sphit')).length === 1, '14) 자주 찾는 말 누르면 검색');
  await p.screenshot({ path: path.join(__dirname, 'shot_spec_pc.png') });
  await p.click('.backbar button');
  ok(await p.locator('.grid6').count() === 1, '15) 뒤로 → 메인');
  ok(!p.errs.length, '16) PC 화면 오류 없음 ' + p.errs.join(' / '));

  // ── 옵저버 (직원 추가 창) ──
  await p.evaluate(() => { S.set = { staff: [{ staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }], toastSec: 2.6 }; staffDlg(''); });
  ok((await texts(p, '#sfR option')).includes('옵저버'), '17) 역할에 「옵저버」');
  await p.selectOption('#sfR', '옵저버');
  ok(await p.inputValue('#sfP') === '관리' && await p.locator('#sfP').isDisabled(), '18) 옵저버 고르면 파트 「관리」 고정');
  await p.selectOption('#sfR', '직원');
  ok(!(await p.locator('#sfP').isDisabled()), '19) 다른 역할로 바꾸면 파트 다시 고칠 수 있음');

  // ── 휴대폰 ──
  const m = await open(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.tap('.grid6 .tile:has-text("시방서 검색")');
  await m.locator('#spQ').waitFor();
  await m.fill('#spQ', '방화구획');
  ok(!(await m.locator('.spside').isVisible()) && !(await m.locator('#spPv').isVisible()) && (await texts(m, '#spRes .sphit')).length === 2, '20) 휴대폰: 결과만 (옆 칸·쪽 칸 숨김)');
  const wide = await m.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > 391).slice(0, 4).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)));
  ok(!wide.length, '21) 휴대폰: 가로로 넘치지 않음 ' + wide.join(' / '));
  await m.locator('#spRes .pgb').first().tap();
  await m.locator('.spsheet .sppv-b img').waitFor();
  await m.waitForFunction(() => { const g = document.querySelector('.spsheet .sppg'); return g && g.style.width; });
  ok(await m.locator('.spsheet .hl').count() >= 1 && await fit(m), '22) 휴대폰: 쪽 번호 누르면 아래에서 쪽 보기 창 · 쪽 한 장이 다 보임');
  const rc = await m.evaluate(() => { const r = document.querySelector('.spsheet .sppv').getBoundingClientRect(); return { r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, vv: visualViewport.width }; });
  ok(rc.r <= rc.w + 1 && rc.b <= rc.h + 1, '22-1) 휴대폰: 쪽 보기 창이 화면 안에 다 들어옴 ' + JSON.stringify(rc));
  await m.screenshot({ path: path.join(__dirname, 'shot_spec_phone.png') });
  await m.tap('.spsheet [aria-label="닫기"]');
  ok(await m.locator('.spsheet').count() === 0 && !m.errs.length, '23) 닫기 · 휴대폰 화면 오류 없음 ' + m.errs.join(' / '));


  // ── 외부용 단독 페이지 spec.html (결정 142): 로그인·기기 등록 없이 시방서 검색만 ──
  const x = await open(b, {}, '/ws/spec.html');
  ok(/롯데백화점 잠실점 에비뉴엘 · 시설팀/.test(await x.locator('header.top').innerText()) && !(await x.locator('text=로그아웃').count()) && !(await x.locator('.backbar').count()) && (await x.title()) === '시방서 검색 · 에비뉴엘 시설팀', '24) 외부용: 로그인 없이 바로 시방서 검색 (이름·로그아웃·뒤로 없음)');
  await x.fill('#spQ', '방화구획');
  await x.locator('#spPv .sppv-b img').waitFor();
  ok((await texts(x, '#spRes .sphit')).length === 2 && !(await x.locator('#spF .old').count()) && !(await x.locator('#spPv .spo').isVisible()) && PAGES.includes('pub:G1:12:false'), '25) 외부용: 검색·쪽 보기 됨 · 이전 판 단추·PDF 원본 없음 · 로그인 표를 안 보냄');
  ok(/문의: 에비뉴엘 시설팀/.test(await x.locator('.spside').innerText()) && !x.errs.length, '26) 외부용: 안내 글 · 화면 오류 없음 ' + x.errs.join(' / '));
  await x.screenshot({ path: path.join(__dirname, 'shot_spec_pub.png') });

  await b.close(); srv.close();
  console.log(fail ? '\n시방서 검색 화면 시험 실패 ' + fail + '개' : '\n시방서 검색 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
