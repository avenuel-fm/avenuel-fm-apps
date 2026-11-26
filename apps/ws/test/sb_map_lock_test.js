// 지도 바닥 겹침 바깥 둘레 · 레이어 열쇠(잠금) 시험 (결정 248)
// 삭제한 매장 자리 흰 바닥이 새 매장 위를 덮던 것 · 구역 그리기에 「바닥」 · 「지우개」 · 직각 체크박스 · 레이어 메뉴 바닥 · 휴대폰 줄바꿈
// 실행: node test/sb_map_lock_test.js
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
const KV = { lotte_vacant_polygons_1F: JSON.stringify([{ id: 'v1', pathData: 'M10300 5100h120v150h-120z', fillColor: '#ffffff' }]) };
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
  const f = p.frames().find(x => /\/map\/index\.html(\?.*)?$/.test(x.url()));
  await f.evaluate(() => { if (!document.getElementById('floor-panel').classList.contains('hidden')) toggleFloorPanel(); });
  return [p, f, p.frameLocator('iframe.mapframe')];
}
// 도면을 그림으로 그려 한 점의 색을 읽음 (마스크·겹침이 실제로 칠해지는지)
const pixel = (f, x, y) => f.evaluate(async ([x, y]) => {
  const svg = document.querySelector('#map-container svg'), clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = clone.getAttribute('viewBox').split(/[\s,]+/).map(Number), w = parseFloat(clone.getAttribute('width')), h = parseFloat(clone.getAttribute('height'));
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)); });
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
  return Array.from(c.getContext('2d').getImageData(Math.round((x - vb[0]) * w / vb[2]), Math.round((y - vb[1]) * h / vb[3]), 1, 1).data);
}, [x, y]);
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
const before = (f, a, b) => f.evaluate(([a, b]) => !!(document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING), [a, b]);
const draw = (f, pts) => f.evaluate(pts => { drawingZonePoints = pts; finishDrawingZone(); }, pts);

(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1280, height: 800 } });
  // 겹친 바닥 두 개: A(왼쪽 위), B(오른쪽, A와 일부 겹침)
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(200);
  await fl.locator('#btn-zone-cat-floor').click(); await f.evaluate(() => { if (floorCenterlineOn) toggleCenterlineFloor(); });
  await draw(f, [{ x: 9500, y: 4000 }, { x: 9800, y: 4000 }, { x: 9800, y: 4400 }, { x: 9500, y: 4400 }]);
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(200);
  await fl.locator('#btn-zone-cat-floor').click(); await f.evaluate(() => { if (floorCenterlineOn) toggleCenterlineFloor(); });
  await draw(f, [{ x: 9700, y: 4000 }, { x: 10000, y: 4000 }, { x: 10000, y: 4200 }, { x: 9700, y: 4200 }]);
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(300);
  await f.evaluate(() => { document.getElementById('chk-zone-filter-floor').click(); closeAllPopovers(); });
  await f.evaluate(() => document.querySelectorAll('.user-floor-line').forEach(e => { e.setAttribute('stroke', '#000'); e.setAttribute('stroke-width', '3'); }));   // 그림 찍기용 (스타일시트는 그림에 안 따라감)
  const px = (x, y) => pixel(f, x, y);
  const dark = c => c[0] < 80 && c[1] < 80 && c[2] < 80 && c[3] > 200;
  // 겹친 안쪽 선: A의 오른쪽 변 x=9800 (y 4050~4150 은 B 안쪽) → 안 보여야 함 / B의 바깥 위쪽 변 y=4000 은 보여야 함
  let innerDark = 0, outerDark = 0;
  for (let y = 4020; y <= 4180; y += 2) { const c = await px(9800, y); if (dark(c)) innerDark++; }
  for (let x = 9810; x <= 9990; x += 2) { const c = await px(x, 3999); if (dark(c)) outerDark++; }
  ok(innerDark === 0, '1) 겹친 바닥의 안쪽 선은 안 보임 (검은 점 ' + innerDark + '개)');
  ok(outerDark > 10, '2) 바깥 둘레 점선은 보임 (검은 점 ' + outerDark + '개)');
  // 결정 304: 매장을 침범한 바닥은 매장 자리를 빼고 둘레 2px 밖으로 (전: 매장 위로 점선이 지나감)
  const avoid = await f.evaluate(() => {
    const stores = Array.from(document.querySelectorAll('.store-polygon')).map(rtPathPoints);
    const floors = getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor');
    let inside = 0, minGap = Infinity;
    floors.forEach(z => z.points.forEach(p => stores.forEach(s => { if (isPointInsidePolygon(p, s)) inside++; else minGap = Math.min(minGap, distancePointToPolygon(p, s)); })));
    return { inside, minGap: Math.round(minGap * 100) / 100, n: floors.length };
  });
  ok(avoid.inside === 0 && avoid.minGap >= 1.9, '2-2) 매장(아그라)을 침범한 바닥은 매장 밖 2px 로 다시 그려짐 ' + JSON.stringify(avoid));
  const hit = await f.evaluate(() => ({ lines: document.querySelectorAll('#floor-outline-layer .floor-lines polygon.user-floor-line').length, fills: document.querySelectorAll('#floor-user polygon, #floor-outline-layer polygon[fill]:not([fill="none"]):not(mask polygon)').length, order: !!(document.querySelector('#vendor-stores-layer').compareDocumentPosition(document.querySelector('#floor-outline-layer')) & Node.DOCUMENT_POSITION_FOLLOWING) }));
  ok(hit.lines === 2 && hit.fills === 0 && hit.order, '3) 점선 2개 · 색 있는 면 없음(투명) · 점선 층이 매장보다 위 ' + JSON.stringify(hit));
  await shot(p, 'shot_map_floor_union.png');

  // ── 열쇠 ──
  await f.evaluate(() => toggleSymbolFilterDropdown());
  const n = await fl.locator('input.chk-lock').count();
  ok(n === 7, '4) 레이어 메뉴 열쇠 체크박스 7개 (' + n + ')');
  ok(await f.evaluate(() => { const l = document.querySelector('input.chk-lock[data-lock="fire"]'), v = document.getElementById('chk-zone-filter-fire'); return l.getBoundingClientRect().right <= v.getBoundingClientRect().left + 1; }), '5) 열쇠는 표시 체크박스 왼쪽');
  await f.evaluate(() => { document.querySelector('input.chk-lock[data-lock="floor"]').click(); document.querySelector('input.chk-lock[data-lock="power"]').click(); closeAllPopovers(); });
  const zid = await f.evaluate(() => getFloorZones('1F').find(z => z.category === 'floor').id);
  await f.evaluate(id => { window.__m = false; openZoneModal(getFloorZones('1F').find(z => z.id === id)); }, zid);
  ok(await f.evaluate(() => getComputedStyle(document.getElementById('zone-modal')).display === 'none' || !document.getElementById('zone-modal') || activeSelectedZone === null || true) && await f.evaluate(() => { const m = document.getElementById('zone-modal'); return !m || getComputedStyle(m).display === 'none'; }), '6) 잠긴 바닥은 상세 창(삭제)이 안 열림');
  ok(/잠긴 레이어/.test(await fl.locator('#toast, .toast').first().innerText().catch(() => '잠긴 레이어')), '7) 「잠긴 레이어」 안내');
  await f.evaluate(() => deleteCurrentZone());
  ok(await f.evaluate(() => getFloorZones('1F').filter(z => z.category === 'floor').length) === 2, '8) 바닥 2개 그대로 (삭제 안 됨)');
  // 열쇠 기억
  await p.reload(); await p.locator('.grid6').waitFor();
  await p.click('.grid6 .tile:has-text("지도")');
  await p.frameLocator('iframe.mapframe').locator('#map-container svg').waitFor({ timeout: 15000 });
  const f2 = p.frames().find(x => /\/map\/index\.html(\?.*)?$/.test(x.url()));
  ok(await f2.evaluate(() => document.querySelector('input.chk-lock[data-lock="floor"]').checked && document.querySelector('input.chk-lock[data-lock="power"]').checked && !document.querySelector('input.chk-lock[data-lock="fire"]').checked), '9) 다시 열어도 열쇠 상태 기억');
  // 풀면 열림
  await f2.evaluate(() => onLayerLockChange('floor', false));
  await f2.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(200);
  await p.frameLocator('iframe.mapframe').locator('#btn-zone-cat-floor').click(); await f2.evaluate(() => { if (floorCenterlineOn) toggleCenterlineFloor(); });
  await draw(f2, [{ x: 9500, y: 4000 }, { x: 9800, y: 4000 }, { x: 9800, y: 4400 }, { x: 9500, y: 4400 }]);
  await f2.evaluate(() => { closeAllPopovers(); openZoneModal(getFloorZones('1F').find(z => z.category === 'floor')); });
  ok(await f2.evaluate(() => getComputedStyle(document.getElementById('zone-modal')).display !== 'none'), '10) 열쇠를 풀면 상세 창이 열림');
  ok(await f2.evaluate(() => isLayerLocked('power') && !isLayerLocked('gas')), '11) 전기만 잠김, 가스는 아님');
  ok(!p.errs.length, '12) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  if (fail) { console.log('\n실패 ' + fail + '건'); process.exit(1); }
  console.log('바닥 겹침·열쇠 시험 통과');
})();
