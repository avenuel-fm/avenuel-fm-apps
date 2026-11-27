// 지도 휴대폰 화면 시험 (결정 160): 뒤로 작은 버튼 · 윗줄 숨기기 · 전체화면 · 선택 글자 흰색 · 새 매장 글자 줄바꿈 · 인포 레이어
// 실행: node test/sb_map_mobile_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8135;
const exp = Date.now() + 3600e3, TOK = 'S001.' + exp + '.boss';
const RPC = {
  ws_bootstrap() { return { ok: true, user: { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_map_load() { return { ok: true, kv: {}, vers: {}, bases: {}, canEdit: true, isBoss: true, urls: { avenuel: Object.fromEntries(['6F', '5F', '4F', '3F', '2F', '1F', 'B1'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])), dept: {}, castle: {} } }; },
  ws_map_save() { return { ok: true, ver: 'v' + Date.now() }; },
  ws_map_base() { return { ok: true, sha: 'x' }; }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return { auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return { data: r.data, error: null }; },
    storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } } };
} };`;
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
const poi = (name, x, y) => `<g group-type="POI_GROUP" name="${name}"><image width="50" height="50" href="data:image/gif;base64,R0lGODlhAQABAAAAACw=" x="${x}" y="${y}"/></g>`;
const plate = (id, x, y, tf) => `<path id="${id}" d="M${x} ${y} L${x + 50} ${y} L${x + 50} ${y + 50} L${x} ${y + 50} Z" fill="#67615d" stroke="#ffffff"${tf ? ` transform="${tf}"` : ''}/>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${room('a', '아그라', 9600, 4200)}${plate('pl-ev', 9890, 4590, 'matrix(1,0,0,1,10,10)')}${plate('pl-door', 10000, 4600)}${poi('엘리베이터', 9900, 4600)}${poi('Tax Refund', 9950, 4600)}${poi('출입구', 10000, 4600)}</g></svg>`;
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
  return [p, p.frames().find(x => /\/map\/index\.html(\?.*)?$/.test(x.url())), p.frameLocator('iframe.mapframe')];
}
const vis = (f, sel) => f.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; }, sel);

(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await f.evaluate(() => { if (!document.getElementById('floor-panel').classList.contains('hidden')) toggleFloorPanel(); });
  const r = await p.evaluate(() => { const bk = document.querySelector('.mapback').getBoundingClientRect(), fr = document.querySelector('iframe.mapframe').getBoundingClientRect(); return { bk: [bk.left, bk.bottom, bk.width], fr: fr.bottom, h: innerHeight, bar: document.querySelectorAll('.backbar').length }; });
  ok(r.bar === 0 && r.bk[0] < 30 && r.h - r.bk[1] < 40 && r.bk[2] < 120 && r.h - r.fr < 2, '1) 뒤로: 아래 넓은 줄 없음 · 왼쪽 아래 작은 버튼 · 지도가 화면 아래까지 (' + r.bk.map(Math.round).join(',') + ')');
  await shot(p, 'shot_map_mobile.png');
  ok(await vis(f, '#btn-menu-tab') && await vis(f, 'header'), '2) 휴대폰: 「메뉴 숨기기」 탭 보임');
  await fl.locator('#btn-menu-tab').tap();
  ok(!await vis(f, 'header') && /메뉴/.test(await fl.locator('#btn-menu-tab').innerText()) && !/숨기기/.test(await fl.locator('#btn-menu-tab').innerText()), '3) 탭을 누르면 윗줄 숨김 · 「메뉴」 탭만 남음');
  await shot(p, 'shot_map_mobile_hidden.png');
  await fl.locator('#btn-menu-tab').tap();
  ok(await vis(f, 'header'), '4) 다시 누르면 윗줄 내려옴');

  const fit = await f.evaluate(() => !document.querySelector('.floating-controls [title="화면 맞춤"]') && document.querySelector('.map-top-right-group #btn-fullscreen') !== null);
  ok(fit, '5) 「전체화면」 단추가 오른쪽 위 매장·기능실 줄에 (아래 화면 맞춤 단추는 옮김)');
  await fl.locator('#btn-fullscreen').tap(); await p.waitForTimeout(400);
  const full = await f.evaluate(() => Array.from(document.querySelectorAll('button')).filter(e => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && !e.closest('[style*="display:none"], [style*="display: none"]'); }).map(e => e.id || e.className));
  const pf = await p.evaluate(() => { const fr = document.querySelector('iframe.mapframe').getBoundingClientRect(); return document.body.classList.contains('mapfull') && fr.top === 0 && fr.height >= innerHeight - 1; });
  ok(pf && /종료/.test(await fl.locator('#btn-fullscreen').innerText()), '6) 전체화면: 지도 칸이 화면 가득 · 단추 글자 「종료」');
  ok(full.length === 1 && full[0] === 'btn-fullscreen', '7) 전체화면에서는 종료 단추만 보임 (' + full.join(',') + ')');
  await shot(p, 'shot_map_mobile_full.png');
  await fl.locator('#btn-fullscreen').tap(); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !document.body.classList.contains('mapfull')) && await vis(f, 'header') && /전체화면/.test(await fl.locator('#btn-fullscreen').innerText()), '8) 종료하면 원래 화면');

  const info = await f.evaluate(() => { const l = document.getElementById('info-layer'); const names = l ? Array.from(l.querySelectorAll('g[group-type]')).map(g => g.getAttribute('name')) : []; const top = document.getElementById('custom-stores-top-layer'); return { names, after: !top || !!(top.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING), pe: l && l.style.pointerEvents }; });
  ok(info.names.join() === '엘리베이터,Tax Refund' && info.pe === 'none', '9) 인포 레이어: 엘리베이터·택스리펀드만 묶음 (출입구는 뺌) · 눌러도 그리기 안 막음');
  await f.evaluate(() => { drawingPoints = [{ x: 10300, y: 5100 }, { x: 10420, y: 5100 }, { x: 10420, y: 5250 }, { x: 10300, y: 5250 }]; finishDrawingPolygon(); closeAllPopovers(); });
  await p.waitForTimeout(300);
  const order = await f.evaluate(() => { const l = document.getElementById('info-layer'), top = document.getElementById('custom-stores-top-layer'); return !!(top.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); });
  ok(order, '10) 매장을 그린 뒤에도 인포 레이어가 그린 매장보다 위');
  await f.evaluate(() => onInfoLayerChange(false));
  ok(await f.evaluate(() => document.getElementById('info-layer').style.display === 'none'), '11) 레이어 메뉴 「인포」 끄면 숨김');
  const pl = await f.evaluate(() => ({ ev: !!document.querySelector('#info-layer #pl-ev'), door: !document.getElementById('pl-door').closest('#info-layer'),
    tint: Array.from(document.querySelectorAll('#info-layer image')).every(i => i.getAttribute('filter') === 'url(#info-tint)') && !!document.getElementById('info-tint') }));
  ok(pl.ev && pl.door, '11-1) 인포 그림 밑 받침 사각형도 인포 레이어로 (끄면 바닥 보임) · 출입구 받침은 그대로');
  ok(pl.tint, '11-2) 인포 그림 색을 하나로 (남색 바탕 · 흰 그림)');
  await f.evaluate(() => onInfoLayerChange(true));

  const cs = await f.evaluate(() => currentStores.find(s => s.isCustom).bookId);
  await f.evaluate(id => openEditModalForStore(currentStores.find(s => s.bookId === id)), cs);
  await fl.locator('#edit-name').fill('아주 긴 이름의 새로운 기능실 공간');
  await fl.locator('#edit-modal button:has-text("저장")').click(); await p.waitForTimeout(300);
  const lab = await f.evaluate(id => { const s = currentStores.find(x => x.bookId === id), t = s.textElement, bx = s.polygonElement.getBBox(); const lines = Array.from(t.querySelectorAll('tspan')); return { size: t.getAttribute('font-size'), anchor: t.getAttribute('text-anchor'), n: lines.length, fits: lines.every(l => l.getComputedTextLength() <= bx.width), mid: lines.every(l => Math.abs(parseFloat(l.getAttribute('x')) - bx.x - bx.width / 2) < 0.1), weight: t.getAttribute('font-weight'), all: lines.map(l => l.textContent).join('') }; }, cs);
  ok(lab.size === '20' && lab.weight === '400' && lab.anchor === 'middle' && lab.n >= 2 && lab.fits && lab.mid && lab.all.replace(/\s/g, '') === '아주긴이름의새로운기능실공간', '12) 새 매장 글자 20·보통(옆 매장과 같음) · 길면 다음 줄 · 사각형 정중앙 (' + lab.n + '줄)');
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(400);
  ok(await f.evaluate(id => currentStores.find(x => x.bookId === id).textElement.querySelectorAll('tspan').length >= 2, cs), '13) 다시 열어도 줄바꿈 유지');
  // 삼각형·ㄱ자: 도형 안 가장 큰 네모의 가운데 (결정 302)
  const shp = await f.evaluate(() => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.querySelector('#map-container svg'), g = document.createElementNS(ns, 'g'); svg.appendChild(g);
    const put = (d, name) => { const pa = document.createElementNS(ns, 'path'), t = document.createElementNS(ns, 'text'); pa.setAttribute('d', d); g.append(pa, t); layoutStoreLabel(t, name, pa);
      const tb = t.getBBox(), pts = [[tb.x, tb.y], [tb.x + tb.width, tb.y], [tb.x, tb.y + tb.height], [tb.x + tb.width, tb.y + tb.height]];
      return { inside: pts.every(([x, y]) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return pa.isPointInFill(q); }), x: +t.getAttribute('x'), lines: t.querySelectorAll('tspan').length }; };
    const r = { tri: put('M9300 3900L9700 4300L9300 4300Z', '메종키츠네'), ell: put('M9300 4400H9700V4500H9400V4800H9300Z', '젠틀몬스터 하우스') };
    g.remove(); return r;
  });
  ok(shp.tri.inside && shp.tri.lines === 1, '13-1) 삼각형: 이름이 한 줄로 도형 안에 (' + JSON.stringify(shp.tri) + ')');
  ok(shp.ell.inside && Math.abs(shp.ell.x - 9500) < 10, '13-2) ㄱ자: 넓은 쪽 네모의 가운데 (' + JSON.stringify(shp.ell) + ')');
  await f.evaluate(() => selectAndHighlightStore(currentStores.find(s => s.name === '아그라'))); await p.waitForTimeout(300);
  ok(await f.evaluate(() => getComputedStyle(currentStores.find(s => s.name === '아그라').textElement).fill === 'rgb(255, 255, 255)'), '14) 선택한 매장 이름은 흰색');
  ok(!p.errs.length, '15) 화면 오류 없음 (휴대폰)' + (p.errs.length ? ': ' + p.errs.join(' / ') : ''));

  const [q, g] = await open(b, { viewport: { width: 1280, height: 800 } });
  ok(!await vis(g, '#btn-menu-tab') && await q.evaluate(() => !!document.querySelector('.mapback')), '16) PC: 메뉴 숨기기 탭 없음 · 뒤로 작은 버튼');
  ok(!q.errs.length, '17) 화면 오류 없음 (PC)' + (q.errs.length ? ': ' + q.errs.join(' / ') : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n휴대폰 지도 시험 실패 ' + fail + '개' : '\n휴대폰 지도 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
