// 시방서 검색 화면 시험 (결정 140) + 직원 추가 창의 옵저버 (결정 138)
// 메인 4번째 칸 「시방서 검색」 → 도면협의 지침 자료를 읽기만 · 비슷한 말 · 띄어쓰기 무시 · 지침 체크박스(결정 146) · 이전 판 · 쪽 보기(PC 오른쪽 칸 / 휴대폰 창) · 참조 복사
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
const PAGES = [], SEARCH = [], CALLS = [];
let ROLE = '직원', MENU_OFF = [];   // 메인 메뉴 켜기·끄기 (결정 148)
const RPC = {
  ws_bootstrap() { return { ok: true, user: { staff_id: 'S003', name: '이영희', part: '전방파트', role: ROLE }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_menu() { return { ok: true, off: MENU_OFF }; },
  ws_admin_set_menu(a) { MENU_OFF = a.p_off; return { ok: true, off: MENU_OFF }; },
  ws_admin_staff() { return { ok: true, toastSec: 2.6, staff: [{ staff_id: 'S003', name: '이영희', part: '관리', role: '소장' }] }; },
  ws_risk_get() { return { ok: true, rows: [] }; },
  ws_spec_boot() { return { ok: true, guides: GUIDES, synonyms: [['방화구획', '방화 구획', '방화벽']] }; },
  ws_spec_index() { return { ok: true, entries: ENTRIES }; },
  ws_spec_pub_boot() { return { ok: true, guides: GUIDES.filter(g => !g.archived), synonyms: [['방화구획', '방화 구획', '방화벽']] }; },
  ws_spec_pub_search(a) {   // 14_spec.sql 과 같은 규칙의 가짜: 지금 판만 · 띄어쓰기 무시 · 비슷한 말 · 건수는 전부, 결과는 고른 지침만
    SEARCH.push(a); const c = w => String(w).toLowerCase().replace(/\s+/g, ''), cq = c(a.p_q), syn = [['방화구획', '방화 구획', '방화벽']];
    const terms = [cq].concat(...syn.filter(g => g.some(w => c(w) === cq)).map(g => g.map(c)));
    const hit = ENTRIES.filter(e => e.d !== 'G0' && terms.some(w => c(e.t).includes(w) || c((e.h || '') + (e.l || '')).includes(w))), counts = {};
    hit.forEach(e => counts[e.d] = (counts[e.d] || 0) + 1);
    return { ok: true, counts, entries: hit.filter(e => a.p_guides.includes(e.d)).slice(0, 80) };
  },
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
    if (u.pathname.startsWith('/rpc/')) { CALLS.push(u.pathname.slice(5)); const f = RPC[u.pathname.slice(5)] || (() => ({ ok: true })); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: f(JSON.parse(body || '{}')) })); }
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
  ok(/시방서 검색/.test(await p.locator('header.top').innerText()) && (await p.locator('#spGL .spck:not(.old) input:checked').count()) === 2, '2) 직원도 열림 · 검색하는 지침 체크박스 2개 (모두 켜짐, 이전 판은 목록에서 뺌)');
  ok(/검색어를 넣거나/.test(await p.locator('#spRes').innerText()), '3) 처음엔 안내 글');
  await p.fill('#spQ', '방화구획');
  let hits = await texts(p, '#spRes .sphit');
  ok(hits.length === 2 && /비슷한 말도 찾음: 방화벽$/.test(await p.locator('#spSyn').innerText()), '4) 검색 + 비슷한 말(방화벽)까지 2건, 이전 판은 뺌');
  const ck = await texts(p, '#spGL .spck');
  ok(/시설공사.*1$/s.test(ck[0]) && /통합안전.*1$/s.test(ck[1]) && /이전 판도 검색/.test(ck[2]) && !(await p.locator('#spF').isVisible()), '5) PC: 왼쪽 체크박스에 지침별 건수 · 이전 판 체크 · 위 단추 줄은 숨김');
  await p.locator('#spPv .sppv-b img').waitFor();
  const fit = async pg => pg.evaluate(() => [...document.querySelectorAll('.sppv-b')].filter(b => b.offsetParent).every(b => { const g = b.querySelector('.sppg'); return g && g.getBoundingClientRect().bottom <= b.getBoundingClientRect().bottom + 1 && b.scrollHeight <= b.clientHeight + 1; }));
  await p.waitForFunction(() => { const g = document.querySelector('#spPv .sppg'); return g && g.style.width; });
  ok(await fit(p), '6-1) PC: 쪽 한 장이 칸 안에 다 보임 (아래 안 잘림, 스크롤 없음)');
  await p.click('#spPv [aria-label="크게"]'); await p.waitForFunction(() => /125%/.test(document.querySelector('#spPv .sptools').textContent));
  await p.waitForFunction(() => document.querySelector('#spPv .sppv-b').scrollHeight > document.querySelector('#spPv .sppv-b').clientHeight + 1);
  ok(true, '6-2) + 누르면 그때 크게 (스크롤로 봄)');
  const pb = p.locator('#spPv .sppv-b'), sc = () => pb.evaluate(b => [b.scrollLeft, b.scrollTop]), bx = await pb.boundingBox();
  await p.evaluate(() => { S.sp.zoom = 2.5; spPv(); }); await p.waitForFunction(() => { const b = document.querySelector('#spPv .sppv-b'); return b.classList.contains('pan') && b.scrollWidth > b.clientWidth + 40; });
  await pb.evaluate(b => { b.scrollLeft = 20; b.scrollTop = 60; }); const s0 = await sc();
  await p.mouse.move(bx.x + 200, bx.y + 200); await p.mouse.down(); await p.mouse.move(bx.x + 190, bx.y + 170); await p.mouse.up();
  const s1 = await sc();
  ok(s1[0] === s0[0] + 10 && s1[1] === s0[1] + 30 && await pb.evaluate(b => getComputedStyle(b).scrollbarWidth === 'none' && b.offsetWidth === b.clientWidth + 0), '6-3) 확대한 쪽을 마우스로 끌어 움직임 · 스크롤바 숨김 ' + s0 + ' → ' + s1);
  await p.evaluate(() => { S.sp.zoom = 1.25; spPv(); }); await p.waitForFunction(() => /125%/.test(document.querySelector('#spPv .sptools').textContent) && document.querySelector('#spPv .sppg'));
  const gap5 = await p.evaluate(() => document.querySelector('.backbar .btn').getBoundingClientRect().top - document.querySelector('#spPv .sppv').getBoundingClientRect().bottom);
  ok(Math.abs(gap5 - 5) <= 1 && await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight), '6-4) 쪽 칸 아래 끝이 뒤로 버튼 5px 위 (' + gap5 + 'px)');
  ok(await p.locator('#spRes .mk').first().evaluate(e => getComputedStyle(e).color === 'rgb(255, 255, 255)'), '6-5) 검색어 글자는 흰색');
  await p.click('#spPv [aria-label="작게"]');
  ok(await p.locator('#spPv .hl').count() >= 1 && await p.locator('#spPv .spo').isVisible() && /3\.4 방화구획/.test(await p.locator('#spPv .spttl').innerText()), '6) PC: 첫 결과의 쪽이 오른쪽에 바로 · 노란 표시 · PDF 원본 단추');
  await p.locator('#spRes .sphit').nth(1).click();
  await p.waitForFunction(() => /방화벽/.test(document.querySelector('#spPv .spttl').textContent));
  await p.locator('#spPv .sppv-b img').waitFor();
  ok(PAGES.includes('G2:31') && !(await p.locator('#spPv .spo').isVisible()) && await p.locator('#spRes .sphit.on').count() === 1, '7) 다른 결과 누르면 오른쪽 쪽이 바뀜 (원본 PDF 없으면 단추 숨김)');
  await p.locator('#spGL .spck').nth(0).locator('input').uncheck();
  hits = await texts(p, '#spRes .sphit');
  ok(hits.length === 1 && /통합안전/.test(hits[0]) && /1$/.test((await texts(p, '#spGL .spck'))[0]), '8) 체크 끈 지침은 검색에서 빠짐 (건수는 그대로 보임)');
  await p.locator('#spGL .spck').nth(1).locator('input').uncheck();
  ok(/하나 이상 고르세요/.test(await p.locator('#spRes').innerText()), '8-1) 모두 끄면 「하나 이상 고르세요」');
  await p.locator('#spGL .spck').nth(0).locator('input').check(); await p.locator('#spGL .spck').nth(1).locator('input').check();
  await p.locator('#spGL .spck.old input').check();
  hits = await texts(p, '#spRes .sphit');
  ok(hits.length === 3 && hits.some(t => /이전 판/.test(t)), '9) 이전 판 포함 → 옛 판 결과도 (표시 붙음)');
  await p.locator('#spGL .spck.old input').uncheck();
  await p.fill('#spQ', '방 화구 획');
  ok((await texts(p, '#spRes .sphit')).length >= 1, '10) 띄어쓰기가 달라도 찾음');
  await p.fill('#spQ', '방화구획');
  await p.locator('#spRes .sphit').first().locator('.btn.pri').click();
  ok(await p.evaluate(() => navigator.clipboard.readText()) === '(시설공사 소방, p.12)', '11) 참조 복사 → (시설공사 소방, p.12)');
  await p.locator('#spRes .sphit').first().locator('.btn:has-text("쪽 크게 보기")').click();
  await p.locator('.spsheet .sppv-b img').waitFor();
  ok(!/노란 표시/.test(await p.locator('.spsheet').innerText()), '11-1) 「노란 표시 = 검색어가 있는 줄」 문구 없음');
  for (let k = 0; k < 4; k++) await p.click('.spsheet [aria-label="크게"]');
  const bb = p.locator('.spsheet .sppv-b.pan'); await bb.locator('img').waitFor();
  await bb.evaluate(b => { b.scrollLeft = 0; b.scrollTop = 80; });
  const bx2 = await bb.boundingBox(), bs = () => bb.evaluate(b => [b.scrollLeft, b.scrollTop]);
  await p.mouse.move(bx2.x + 300, bx2.y + 300); await p.mouse.down(); await p.mouse.move(bx2.x + 280, bx2.y + 250); await p.mouse.up();
  const bs1 = await bs();
  ok(bs1[0] === Math.min(20, await bb.evaluate(b => b.scrollWidth - b.clientWidth)) && bs1[0] > 0 && bs1[1] === 130, '11-2) 쪽 크게 보기: 왼쪽 버튼을 누른 채 끌면 쪽이 움직임 ' + bs1);
  for (let k = 0; k < 4; k++) await p.click('.spsheet [aria-label="작게"]');
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
  await m.tap('#spF button:has-text("시설공사")');
  ok((await texts(m, '#spRes .sphit')).length === 1 && await m.locator('#spF button:not(.old)[aria-pressed="false"]').count() === 1, '21-1) 휴대폰: 위 단추로 지침 끄기 (여러 개 켜고 끔)');
  await m.tap('#spF button:has-text("시설공사")');
  await m.locator('#spRes .pgb').first().tap();
  await m.locator('.spsheet .sppv-b img').waitFor();
  await m.waitForFunction(() => { const g = document.querySelector('.spsheet .sppg'); return g && g.style.width; });
  ok(await m.locator('.spsheet .hl').count() >= 1 && await fit(m), '22) 휴대폰: 쪽 번호 누르면 아래에서 쪽 보기 창 · 쪽 한 장이 다 보임');
  const rc = await m.evaluate(() => { const r = document.querySelector('.spsheet .sppv').getBoundingClientRect(); return { r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, vv: visualViewport.width }; });
  ok(rc.r <= rc.w + 1 && rc.b <= rc.h + 1, '22-1) 휴대폰: 쪽 보기 창이 화면 안에 다 들어옴 ' + JSON.stringify(rc));
  await m.screenshot({ path: path.join(__dirname, 'shot_spec_phone.png') });
  const cdp = await m.context().newCDPSession(m), mb = await m.locator('.spsheet .sppv-b').boundingBox(), cx = mb.x + mb.width / 2, cy = mb.y + mb.height / 2;
  const tp = dx => [{ x: cx - dx, y: cy, id: 0 }, { x: cx + dx, y: cy, id: 1 }], pw = () => m.evaluate(() => document.querySelector('.spsheet .sppg').offsetWidth), w0p = await pw();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(40) });
  for (const dx of [60, 80, 100]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(dx) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const pz = await m.evaluate(() => [document.querySelector('.spsheet .sptools .spnote').textContent, visualViewport.scale, document.querySelector('.spsheet .sppv-b').scrollLeft]);
  ok(await pw() > w0p * 2 && pz[0] === '250%' && pz[1] === 1 && pz[2] > 0, '22-2) 휴대폰: 쪽 칸만 두 손가락으로 확대 (화면 전체는 그대로) ' + w0p + ' → ' + await pw() + ' ' + pz);
  await m.evaluate(() => { const b = document.querySelector('.spsheet .sppv-b'); b.scrollLeft = 0; b.scrollTop = 0; });
  await m.locator('.spsheet .sppv-b').evaluate(b => b.scrollBy(0, 0));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 0 }] });
  for (const d of [20, 40, 60]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - d, y: cy - d, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const mv = await m.evaluate(() => { const b = document.querySelector('.spsheet .sppv-b'); return [b.scrollLeft, b.scrollTop]; });
  ok(mv[0] > 0 && mv[1] > 0, '22-3) 휴대폰: 한 손가락으로 쪽 이동 ' + mv);
  for (let k = 0; k < 6; k++) await m.tap('.spsheet [aria-label="작게"]');
  await m.tap('.spsheet [aria-label="닫기"]');
  ok(await m.locator('.spsheet').count() === 0 && !m.errs.length, '23) 닫기 · 휴대폰 화면 오류 없음 ' + m.errs.join(' / '));


  // ── 메인 메뉴 켜기·끄기 (결정 148): 직원은 꺼진 칸을 못 엶, 소장·관리자·옵저버는 엶, 소장이 환경설정에서 끔 ──
  MENU_OFF = ['map'];
  const e1 = await open(b), mt1 = e1.locator('.grid6 .tile').nth(5);
  ok(/작업중/.test(await mt1.innerText()) && await e1.locator('.grid6 .tile:has-text("지도")').count() === 0, 'M1) 직원: 꺼진 지도 칸은 「작업중」 칸으로 보임');
  ok(await mt1.isDisabled() && await e1.locator('.grid6 .tile.soon:disabled').count() === 3, 'M2) 직원: 꺼진 칸·작업중 칸 모두 눌리지 않음');
  ROLE = '옵저버'; const e2 = await open(b);
  ok(!/꺼짐/.test(await e2.locator('.grid6').innerText()) && await e2.locator('.grid6 .tile:has-text("지도")').isEnabled(), 'M3) 옵저버: 지도 칸은 평소 모양 (「직원에게 꺼짐」 글자 없음)');
  await e2.screenshot({ path: path.join(__dirname, 'shot_menu_main_admin.png') });
  await e2.click('.grid6 .tile:has-text("지도")'); await e2.locator('.mapframe').waitFor();
  ok(true, 'M4) 옵저버: 꺼진 지도도 열림');
  ROLE = '소장'; const e3 = await open(b);
  await e3.evaluate(() => openSet()); await e3.locator('.menuseg').first().waitFor();
  ok((await e3.locator('.menuseg').count()) === 5 && await e3.locator('.strow:has-text("지도") .menuseg button.on').innerText() === '꺼짐', 'M5) 환경설정: 메인 메뉴 5칸(하위는 접힘) · 지도는 꺼짐으로 보임');
  await e3.locator('.strow:has-text("시방서 검색") .menuseg button:has-text("꺼짐")').click();
  await e3.waitForFunction(() => /끔/.test((document.querySelector('.toast') || {}).textContent || ''));
  ok(JSON.stringify(MENU_OFF) === '["map","spec"]' && await e3.locator('.strow:has-text("시방서 검색") .menuseg button.on').innerText() === '꺼짐', 'M6) 소장이 시방서 검색 「꺼짐」 → 설정 저장');
  // 아코디언: 점검을 펼치면 하위 4개 · 열화상점검만 끄면 저장되고, 직원은 이름만 보이는 막힌 줄 (결정 208)
  await e3.locator('.menuacc:has-text("점검")').click();
  ok(await e3.locator('.menusub .menuseg').count() === 4, 'M8) 점검 펼침: 하위 메뉴 4개 켜기·끄기');
  await e3.locator('.menusub:has-text("열화상점검") .menuseg button:has-text("꺼짐")').click();
  await e3.waitForFunction(() => /열화상점검 끔/.test((document.querySelector('.toast') || {}).textContent || ''));
  ok(JSON.stringify(MENU_OFF) === '["map","spec","inspect.thermal"]' && /3개 켜짐/.test(await e3.locator('.menuacc:has-text("점검")').innerText()), 'M9) 열화상점검 꺼짐 저장 · 점검 「하위 4개 중 3개 켜짐」');
  ROLE = '직원'; const e4 = await open(b); await e4.evaluate(() => go('inspect'));
  ok(await e4.locator('.row:has-text("열화상점검")').isDisabled() && await e4.locator('.row:has-text("소화기 점검")').isEnabled(), 'M10) 직원: 꺼진 하위 메뉴만 막힘');
  MENU_OFF = ['inspect']; await e4.evaluate(() => { S.menuOff = ['inspect']; render(); });
  ok(await e4.locator('.row:has-text("소화기 점검")').isDisabled(), 'M11) 윗 메뉴를 끄면 하위 메뉴도 모두 막힘');
  ok(!e1.errs.length && !e3.errs.length, 'M7) 메뉴 화면 오류 없음 (옵저버 화면은 지도 가짜 자료가 비어 빼고 봄) ' + e1.errs.concat(e3.errs).join(' / '));
  await e3.screenshot({ path: path.join(__dirname, 'shot_menu_set.png') }); await e1.screenshot({ path: path.join(__dirname, 'shot_menu_main.png') });
  ROLE = '직원'; MENU_OFF = [];

  // ── 외부용 단독 페이지 spec.html (결정 142): 로그인·기기 등록 없이 시방서 검색만 ──
  const c0 = CALLS.length, x = await open(b, {}, '/ws/spec.html');
  const team = x.locator('header.top .spteam');
  ok(await team.innerText() === '잠실점 에비뉴엘 시설팀' && Number(await team.evaluate(e => getComputedStyle(e).fontWeight)) >= 700 && !(await x.locator('text=로그아웃').count()) && !(await x.locator('.backbar').count()) && (await x.title()) === '시방서 검색 · 에비뉴엘 시설팀', '24) 외부용: 로그인 없이 바로 시방서 검색 (이름·로그아웃·뒤로 없음)');
  await x.fill('#spQ', '방화구획');
  await x.locator('#spPv .sppv-b img').waitFor();
  ok((await texts(x, '#spRes .sphit')).length === 2 && !(await x.locator('#spGL .spck.old').count()) && !(await x.locator('#spPv .spo').isVisible()) && PAGES.includes('pub:G1:12:false'), '25) 외부용: 검색·쪽 보기 됨 · 이전 판 체크·PDF 원본 없음 · 로그인 표를 안 보냄');
  ok(SEARCH.length >= 1 && SEARCH[SEARCH.length - 1].p_q === '방화구획' && SEARCH.length <= 3 && !CALLS.slice(c0).some(c => /index/.test(c)), '25-1) 외부용: 검색은 서버에서 (색인 통째로 안 받음 · 글자마다 부르지 않음 ' + SEARCH.length + '번)');
  await x.locator('#spGL .spck').nth(0).locator('input').uncheck();
  await x.waitForFunction(() => document.querySelectorAll('#spRes .sphit').length === 1);
  ok(JSON.stringify(SEARCH[SEARCH.length - 1].p_guides) === '["G2"]' && /1$/.test((await texts(x, '#spGL .spck'))[0]), '25-2) 외부용: 체크 끈 지침은 서버에도 빼고 물음 · 건수는 그대로');
  await x.locator('#spGL .spck').nth(0).locator('input').check(); await x.waitForFunction(() => document.querySelectorAll('#spRes .sphit').length === 2);
  const blocked = await x.evaluate(() => ['contextmenu', 'F12', 'u'].map(k => { const e = k === 'contextmenu' ? new MouseEvent('contextmenu', { bubbles: true, cancelable: true }) : new KeyboardEvent('keydown', { key: k, ctrlKey: k === 'u', bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }));
  const src = fs.readFileSync(path.join(FM, 'ws', 'spec.html'), 'utf8');
  ok(blocked.every(Boolean) && !/renderTbm|renderLogin|ws-api\.js|ws_login/.test(src) && src.length < 120e3, '25-3) 외부용: 오른쪽 버튼·F12·Ctrl+U 막음 · 시방서 코드만 담은 가벼운 파일 (' + Math.round(src.length / 1024) + 'KB)');
  ok(/문의: 에비뉴엘 시설팀/.test(await x.locator('.spside').innerText()) && !x.errs.length, '26) 외부용: 안내 글 · 화면 오류 없음 ' + x.errs.join(' / '));
  await x.screenshot({ path: path.join(__dirname, 'shot_spec_pub.png') });

  await b.close(); srv.close();
  console.log(fail ? '\n시방서 검색 화면 시험 실패 ' + fail + '개' : '\n시방서 검색 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
