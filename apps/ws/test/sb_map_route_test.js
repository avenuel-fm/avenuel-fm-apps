// 지도 배관 연결 길찾기 시험 (결정 246)
// 삭제한 매장 자리 흰 바닥이 새 매장 위를 덮던 것 · 구역 그리기에 「바닥」 · 「지우개」 · 직각 체크박스 · 레이어 메뉴 바닥 · 휴대폰 줄바꿈
// 실행: node test/sb_map_route_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8137;
const exp = Date.now() + 3600e3, TOK = 'S001.' + exp + '.boss';
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
const junk = (x, y) => `<rect class="junk" x="${x}" y="${y}" width="60" height="60" fill="#ff0000"/>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${room('a', '아그라', 9600, 4200)}${junk(10500, 5000)}${junk(10800, 5000)}</g></svg>`;
// 예전에 저장된 도면: 도면 맨 끝에 흰 바닥이 붙어 있음 (이게 매장 위를 덮던 원인)
const STALE = SVG.replace('</svg>', '<path class="vacant-floor-polygon" d="M9400 4000h100v100z" fill="#ffffff"/></svg>');
const KV = { lotte_util_lines_1F: JSON.stringify([{ id: 'old1', subType: 'power', points: [{x:1,y:1},{x:50,y:50}] }]), lotte_floor_zones_1F: JSON.stringify([{ id: 'z1', category: 'floor', name: '바닥 1', points: [{x:9300,y:4500},{x:11000,y:4500},{x:11000,y:4640},{x:9300,y:4640}] }]), lotte_vacant_polygons_1F: JSON.stringify([{ id: 'v1', pathData: 'M10300 5100h120v150h-120z', fillColor: '#ffffff' }]) };
const RPC = {
  ws_bootstrap() { return { ok: true, user: { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_map_load() { return { ok: true, kv: KV, vers: {}, bases: {}, canEdit: true, isBoss: true, canRestore: true, urls: { avenuel: Object.fromEntries(['6F', '5F', '4F', '3F', '2F', '1F', 'B1'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])), dept: {}, castle: {} } }; },
  ws_map_save() { return { ok: true, ver: 'v' + Date.now() }; },
  ws_map_base() { return { ok: true, sha: 'x' }; }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return { auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return { data: r.data, error: null }; },
    storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } } };
} };`;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/rpc/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: (RPC[u.pathname.slice(5)] || (() => ({ ok: true })))(JSON.parse(body || '{}')) })); }
    if (u.pathname === '/floor.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(SVG); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : /\.css$/.test(f) ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);
const shot = (p, name) => p.screenshot({ path: path.join(process.env.SHOT_DIR || path.join(__dirname, '..'), name) });

async function open(b, opts) {
  const c = await b.newContext(opts);
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.addInitScript(t => { if (location.pathname === '/ws/app.html') localStorage.setItem('ws_token', t); }, TOK);
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:' + PORT + '/ws/app.html');
  await p.locator('.grid6').waitFor();
  await p.click('.grid6 .tile:has-text("지도")');
  await p.frameLocator('iframe.mapframe').locator('#map-container svg').waitFor({ timeout: 15000 });
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor();
  await p.waitForTimeout(600);
  const f = p.frames().find(x => /\/map\/index\.html$/.test(x.url()));
  await f.evaluate(() => { if (!document.getElementById('floor-panel').classList.contains('hidden')) toggleFloorPanel(); });
  return [p, f, p.frameLocator('iframe.mapframe')];
}

(async () => {
  const b = await chromium.launch();
  const [p, f] = await open(b, { viewport: { width: 1400, height: 900 } });
  const toasts = [];
  await f.evaluate(() => { window.__t = []; const o = showToast; window.showToast = (m, d) => { window.__t.push(m); return o(m, d); }; });
  const setup = withFloor => f.evaluate(withFloor => {
    const svg = document.querySelector('#map-container svg');
    const mk = (x, y, name, type) => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('class', 'store-group');
      g.innerHTML = `<path class="store-polygon" d="M${x} ${y}h300v200h-300z" fill="#e6f0fc"/><text x="${x+150}" y="${y+100}"><tspan>${name}</tspan></text>`; svg.appendChild(g);
      const it = { id: 'T' + name, name, type, polygonElement: g.querySelector('path') }; currentStores.push(it); return it; };
    window.__S = mk(9500, 4300, '가게1', 'store'); window.__U = mk(10200, 4700, 'EPS-1', 'utility');
    if (!withFloor) saveFloorZones(FLOORS[currentFloorIdx].code, []);
  }, withFloor);
  await setup(true);
  // 예전 배관: 확인창(자동 수락)으로 지워짐
  await f.evaluate(() => startUtilityLineDrawingMode());
  ok(await f.evaluate(() => getFloorUtilityLines('1F').length === 0), '예전 방식 배관이 지워짐');
  // 매장(자) 먼저 → 기능실(모)
  await f.evaluate(() => { handleUtilLineMapClick(null, window.__S); });
  ok((await f.evaluate(() => window.__t)).some(t => /기능실\(모\)/.test(t)), '매장을 누르면 기능실을 물음');
  await f.evaluate(() => { handleUtilLineMapClick(null, window.__U); });
  const line = await f.evaluate(() => getFloorUtilityLines('1F')[0]);
  ok(!!line && line.auto === true, '선이 저장됨(자동 표시)');
  const a = line ? line.points : [];
  ok(a.length >= 2 && a.every((q, i) => i === 0 || Math.abs(q.x - a[i - 1].x) < .2 || Math.abs(q.y - a[i - 1].y) < .2), '대각선 없음: ' + JSON.stringify(a));
  ok(a.length && a[0].x === 10350 && a[0].y === 4700, '점 순서가 기능실(모) 입구에서 시작 → 흐름은 모에서 자로');
  ok(a.length && a[a.length - 1].x === 9650 && a[a.length - 1].y === 4500, '끝은 매장(자) 입구점');
  ok(line && line.sourceName === '가게1' && line.targetName === 'EPS-1', '자=매장, 모=기능실로 저장');
  await f.evaluate(() => { renderFloorUtilityLines(); });
  ok(await f.evaluate(() => getComputedStyle(document.querySelector('.util-feeder-line')).animationName === 'utilFlowForward'), '점선 흐름이 선 방향(모→자)');
  await shot(p, 'shot_util_route.png');
  // 바닥이 없으면 선 안 그리고 토스트
  await f.evaluate(() => { window.__t.length = 0; saveFloorUtilityLines('1F', []); saveFloorZones('1F', []); startUtilityLineDrawingMode(); handleUtilLineMapClick(null, window.__U); handleUtilLineMapClick(null, window.__S); });
  ok((await f.evaluate(() => window.__t)).includes('바닥면 작성 필요'), '바닥 없으면 「바닥면 작성 필요」 토스트');
  ok(await f.evaluate(() => getFloorUtilityLines('1F').length === 0), '바닥 없으면 선이 없음');
  ok(await f.evaluate(() => !document.getElementById('btn-route')), '위쪽 길찾기 버튼은 없어짐');
  ok(p.errs.length === 0, '화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
