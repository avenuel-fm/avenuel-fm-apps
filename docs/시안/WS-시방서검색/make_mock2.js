// 시안 2차 (11-17): 쪽 한 장 맞춤 + 외부용 단독 페이지 — 지금 만든 업무지원 화면(fm/ws/app.html)을 가짜 자료로 띄우고 바뀔 모양을 얹어 찍음
// 실행: apps/ws 폴더에서  python tools/build_fm.py  뒤  node ../../docs/시안/WS-시방서검색/make_mock2.js
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '../../../apps/ws')] }));
const FM = path.join(__dirname, '..', '..', '..', 'fm'), OUT = __dirname, PORT = 8141, BASE = 'http://localhost:' + PORT;
const TOK = 'S003.' + (Date.now() + 3600e3) + '.emp';
const L = ['3.4 방화구획 및 관통부 처리', '가. 매장 경계벽이 방화구획인 경우 배관·덕트·전선 관통부는', '    내화충전재로 틈새 없이 메운다.', '나. 방화구획 관통부 처리 후 감리 확인 사진을 제출한다.',
  '다. 방화셔터 하강 구역에는 집기·진열대를 두지 않는다.', '라. 천장 내부 방화구획 벽체는 슬래브 하부까지 연장한다.', '', '3.5 감지기 및 스프링클러', '가. 천장 높이 변경 시 감지기 위치를 재배치한다.', '나. 스프링클러 헤드는 살수 장애가 없도록 한다.'];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="848" viewBox="0 0 600 848"><rect width="600" height="848" fill="#fff"/>' +
  '<text x="48" y="60" font-size="13" fill="#888" font-family="sans-serif">롯데백화점 Tenant 시설공사 지침 · 소방</text>' +
  L.map((t, i) => '<text x="48" y="' + (120 + i * 30) + '" font-size="' + (/^\d/.test(t) ? 16 : 14) + '" font-weight="' + (/^\d/.test(t) ? 700 : 400) + '" fill="#222" font-family="sans-serif">' + t + '</text>').join('') +
  Array.from({ length: 22 }, (_, i) => '<rect x="48" y="' + (440 + i * 16) + '" width="' + (420 + (i * 37) % 80) + '" height="7" rx="3" fill="#E3E6EA"/>').join('') +
  '<text x="300" y="825" font-size="12" fill="#999" text-anchor="middle" font-family="sans-serif">- 12 -</text></svg>';
const GUIDES = [{ id: 'G1', title: '롯데백화점 Tenant 시설공사 지침 (2024.07)', short: '시설공사', pages: 86, images: true }, { id: 'G2', title: '통합안전관리지침', short: '통합안전', pages: 52, images: true }, { id: 'G3', title: 'Tenant 설비공사 지침', short: '설비공사', pages: 40, images: true }];
const E = [['G1', 12, '소방', '3.4 방화구획 및 관통부 처리', '매장 경계벽이 방화구획인 경우 배관·덕트·전선 관통부는 내화충전재로 틈새 없이 메운다.'], ['G1', 12, '소방', '3.4 방화구획 및 관통부 처리', '방화구획 관통부 처리 후 감리 확인 사진을 제출한다.'],
  ['G2', 31, '방화및방염관련', '2. 방화구획', '공사 중 방화구획을 임시로 해체할 때에는 방재실과 협의하고 작업 종료 후 즉시 복구한다.'], ['G3', 8, '덕트', '덕트', '방화구획을 관통하는 덕트에는 방화댐퍼를 설치하고 점검구를 둔다.']]
  .map(x => ({ d: x[0], p: x[1], s: x[2], h: x[3], t: x[4], b: [[0.075, 0.13, 0.9, 0.21, 0]] }));
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: { staff_id: 'S003', name: '이영희', part: '전방파트', role: '직원' }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }),
  ws_spec_boot: () => ({ ok: true, guides: GUIDES, synonyms: [] }), ws_spec_index: () => ({ ok: true, entries: E }), ws_spec_page: () => ({ ok: true, img: BASE + '/page.svg', pdf: '' })
};
const FAKE = `window.supabase = { createClient() { return { auth: { async getSession() { return { data: { session: { user: { email: 'x@x' } } } }; } },
  async rpc(fn, a) { const r = await fetch('/rpc/' + fn, { method: 'POST', body: JSON.stringify(a) }).then(r => r.json()); return { data: r, error: null }; },
  storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } } }; } };`;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/rpc/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify((RPC[u.pathname.slice(5)] || (() => ({ ok: true })))())); }
  if (u.pathname === '/page.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(SVG); }
  const f = path.join(FM, decodeURIComponent(u.pathname));
  if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : 'application/javascript'); res.end(fs.readFileSync(f));
}).listen(PORT);

// 쪽 한 장 맞춤: 쪽 칸 높이에 맞춰 폭을 정함 (+ 버튼으로 키우면 그때 스크롤)
const FIT = () => document.querySelectorAll('.sppv-b').forEach(b => { const g = b.querySelector('.sppg'); if (!g) return; const w = Math.min(b.clientWidth - 24, (b.clientHeight - 24) * 600 / 848); g.style.width = w + 'px'; g.style.maxWidth = 'none'; b.scrollTop = 0; });
// 외부용 단독 페이지: 로그인·이름·뒤로 없음, 머리에 시설팀 이름, PDF 원본 없음
const PUB = () => {
  document.querySelector('header.top').outerHTML = '<header class="top"><div class="top-in"><div class="ttl"><small>롯데백화점 잠실점 에비뉴엘 · 시설팀</small><b>시방서 검색</b></div><span class="me" style="background:none;color:var(--muted);font-size:13px">공사 지침 · 읽기 전용</span></div></header>';
  document.querySelectorAll('.backbar').forEach(x => x.remove());
  document.querySelectorAll('.spo').forEach(x => x.remove());
  const n = document.querySelector('.spside .card:nth-child(2) .spnote'); if (n) n.textContent = '문의: 에비뉴엘 시설팀 (지침은 롯데백화점 기준, 최신판만)';
};
(async () => {
  const b = await chromium.launch();
  const shot = async (vp, name, pub, big) => {
    const c = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await c.route(/fonts\.googleapis|cdnjs/, r => r.fulfill({ body: '' }));
    await c.addInitScript(t => localStorage.setItem('ws_token', t), TOK);
    const p = await c.newPage(); await p.goto(BASE + '/ws/app.html'); await p.locator('.grid6').waitFor();
    await p.evaluate(() => openSpec()); await p.locator('#spQ').waitFor(); await p.fill('#spQ', '방화구획');
    if (big) { await p.locator('#spRes .pgb').first().click(); await p.locator('.spsheet img').waitFor(); } else await p.locator('#spPv img').waitFor();
    await p.waitForTimeout(200); await p.evaluate(FIT); if (pub) await p.evaluate(PUB);
    await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, name) }); await c.close();
  };
  await shot({ width: 1440, height: 900 }, '시안5_PC_쪽한장맞춤.png', false, false);
  await shot({ width: 1440, height: 900 }, '시안6_외부단독_PC.png', true, false);
  await shot({ width: 390, height: 844 }, '시안7_외부단독_휴대폰_쪽보기.png', true, true);
  await b.close(); srv.close(); process.exit(0);
})();
