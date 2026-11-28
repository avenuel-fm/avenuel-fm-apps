// 지도 후방복도 시험 (결정 380): 회색 후방 구역 → 후방복도 · 1px 비움 · 외벽 밀착 · 맨 아래 층 · 크기 외벽 막기 · 다시 맞추기 · 열쇠
// 실행: node test/sb_map_corridor_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8158;
const exp = Date.now() + 3600e3, TOK = 'S001.' + exp + '.boss';
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
// 후방 구역(업체 Staff area): sa1 가로 띠(매장 b 가 가로지름) · sa2 세로 띠(외벽 왼쪽 밖까지) · 작은 것 · 지도 밖 것
const STAFF = `<g id="sg" name="Staff area"></g>`
  + `<path id="sa1" data-parent-id="sg" d="M9500 4500 L10000 4500 L10000 4600 L9500 4600 Z" fill="#c7c0b7" stroke="#bdb4a8"/>`
  + `<path id="sa2" data-parent-id="sg" d="M9250 5000 L9450 5000 L9450 5500 L9250 5500 Z" fill="#c7c0b7" stroke="#bdb4a8"/>`
  + `<path id="sa3" data-parent-id="sg" d="M9600 5700 L9620 5700 L9620 5720 L9600 5720 Z" fill="#c7c0b7"/>`
  + `<path id="sa5" data-parent-id="sg" d="M9500 5900 L9700 5900 L9700 6200 L9500 6200 Z" fill="#c7c0b7"/>`
  + `<g name="Staff area" id="sg2"><path id="sa4" d="M12000 4500 L12300 4500 L12300 4600 L12000 4600 Z" fill="#c7c0b7"/></g>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${STAFF}${room('a', '아그라', 9600, 4200)}${room('b', '비매장', 9800, 4550)}</g></svg>`;
const RPC = {
  ws_bootstrap() { return { ok: true, user: { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_map_load() { return { ok: true, kv: {}, vers: {}, bases: {}, canEdit: true, isBoss: true, canRestore: true, urls: { avenuel: Object.fromEntries(['6F', '5F', '4F', '3F', '2F', '1F', 'B1'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])), dept: {}, castle: {} } }; },
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
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor({ state: 'attached' });
  await p.waitForTimeout(600);
  const f = p.frames().find(x => /\/map\/index\.html(\?.*)?$/.test(x.url()));
  await f.evaluate(() => { if (!document.getElementById('floor-panel').classList.contains('hidden')) toggleFloorPanel(); });
  return [p, f, p.frameLocator('iframe.mapframe')];
}
// 구역 그리기: 종류를 고르고 점을 넣어 완료 (그리기 상태는 그대로 둠)
const zone = (f, cat, pts) => f.evaluate(([cat, pts]) => {
  if (!isZoneDrawingMode) toggleAddZoneMode();
  setZoneCategory(cat); if (typeof floorCenterlineOn !== 'undefined' && floorCenterlineOn) toggleCenterlineFloor();
  drawingZonePoints = pts; finishDrawingZone();
  const z = getFloorZones(FLOORS[currentFloorIdx].code); return z[z.length - 1];
}, [cat, pts]);
// 매장 그리기 → 수정 창이 열린 채로 그 도형
const drawStore = (f, pts) => f.evaluate(pts => { if (isZoneDrawingMode) exitAddZoneMode(); toggleAddStoreMode(); drawingPoints = pts; finishDrawingPolygon(); return currentStores[currentStores.length - 1].id; }, pts);
const bboxOf = (f, id) => f.evaluate(id => { const pts = parseSvgPathPoints(currentStores.find(s => s.id === id).polygonElement.getAttribute('d')); const xs = pts.map(q => q.x), ys = pts.map(q => q.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }, id);
const W = [{ x: 9300, y: 3950 }, { x: 11200, y: 3950 }, { x: 11200, y: 5900 }, { x: 9300, y: 5900 }];
const cor = f => f.evaluate(() => getCustomStores(FLOORS[currentFloorIdx].code).filter(c => c.kind === '후방복도').map(c => ({ id: c.id, name: c.name, src: c.src, color: c.fillColor })));
const fillAt = (f, id, pts) => f.evaluate(([id, pts]) => { const p = document.querySelector(`#corridor-layer g.store-group[data-store-id="${id}"] path`); return pts.map(([x, y]) => p.isPointInFill(new DOMPoint(x, y))); }, [id, pts]);

(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1280, height: 800 } });
  const box = await p.locator('iframe.mapframe').boundingBox();
  const scr = (x, y) => f.evaluate(([x, y]) => { const m = document.querySelector('#map-container svg').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]).then(q => ({ x: q.x + box.x, y: q.y + box.y }));

  // 1) 처음 열면 업체 회색 후방 구역 → 후방복도 도형 (작은 것·지도 밖 것은 뺌)
  const c1 = await cor(f);
  ok(c1.length === 2 && c1.every(c => /층 후방복도$/.test(c.name) && c.color === '#b4bfcc') && c1.map(c => c.src).sort().join() === 'sa1,sa2', '1) 후방복도 2곳 · 이름 「층 후방복도」 · 후방복도 색 ' + JSON.stringify(c1));
  const A = c1.find(c => c.src === 'sa1').id, B = c1.find(c => c.src === 'sa2').id;
  const lay = await f.evaluate(() => {
    const svg = document.querySelector('#map-container svg'), kids = Array.from(svg.children).map(e => e.id);
    const src = document.getElementById('sa1');
    return { order: kids.indexOf('corridor-layer') >= 0 && kids.indexOf('corridor-layer') < kids.indexOf('floor-layer') && kids.indexOf('floor-layer') < kids.indexOf('vendor-stores-layer'),
      n: svg.querySelectorAll('#corridor-layer g.store-group[data-util-kind="후방복도"]').length, hid: getComputedStyle(src).visibility, notStore: !currentStores.some(s => s.polygonElement === src) };
  });
  ok(lay.order && lay.n === 2 && lay.hid === 'hidden' && lay.notStore, '1-1) 맨 아래 층(바닥·매장 아래) · 원래 회색은 숨기고 매장으로 안 묶음 ' + JSON.stringify(lay));
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(400);
  const again = await f.evaluate(() => ({ cs: getCustomStores(FLOORS[currentFloorIdx].code).filter(c => c.kind === '후방복도').length, dom: document.querySelectorAll('#corridor-layer g.store-group').length }));
  ok(again.cs === 2 && again.dom === 2, '1-2) 층을 다시 열어도 한 번만 만듦 ' + JSON.stringify(again));

  // 1-3) 지도 틀에 걸친 큰 후방 구역(가운데가 틀 밖): 지상층은 뺌, 지하1층은 틀 안만 씀
  const t13 = await f.evaluate(() => {
    const svg = document.querySelector('#map-container svg'), crop = FLOORS[currentFloorIdx].crop;
    const up = corridorSources(svg, { code: '1F', crop }).map(s => s.src), b1 = corridorSources(svg, { code: 'B1', crop }).find(s => s.src === 'sa5');
    return { up: up.includes('sa5'), b1: b1 && Math.max(...b1.ring.map(q => q[1])) };
  });
  ok(!t13.up && t13.b1 === 5960, '1-3) 틀에 걸친 후방 구역: 지상층 뺌 · 지하1층은 틀 안까지만 ' + JSON.stringify(t13));

  // 2) 매장 b(9650~9950)가 가로지른 곳은 둘레 1px 비움
  const g2 = await fillAt(f, A, [[9600, 4550], [9648.6, 4550], [9649.5, 4550], [9800, 4550], [9950.5, 4550], [9951.4, 4550]]);
  ok(JSON.stringify(g2) === '[true,true,false,false,false,true]', '2) 매장이 지나간 자리 + 둘레 1px 비움 ' + JSON.stringify(g2));
  await f.evaluate(() => focusStoreAt(9700, 4550)); await p.waitForTimeout(400);
  await shot(p, 'shot_map_corridor.png');

  // 3) 외벽을 닫으면 외벽 밖은 깎이고 외벽선에 딱 붙음
  await zone(f, 'wall', W); await zone(f, 'wall', [W[3], W[0]]);
  await f.evaluate(() => { exitAddZoneMode(); syncSvgCache(); });
  const g3 = await fillAt(f, B, [[9280, 5200], [9299.6, 5200], [9300.4, 5200], [9440, 5200]]);
  ok(JSON.stringify(g3) === '[false,false,true,true]', '3) 외벽 밖은 깎고 외벽선(9300)에 간격 없이 붙음 ' + JSON.stringify(g3));

  // 4) 기능실(EPS)을 복도 위에 그리면 복도는 그 둘레 1px 비움 · 기능실은 그린 대로
  const u = await drawStore(f, [{ x: 9550, y: 4480 }, { x: 9600, y: 4480 }, { x: 9600, y: 4620 }, { x: 9550, y: 4620 }]);
  await fl.locator('#tab-type-utility').click(); await p.waitForTimeout(100);
  await f.evaluate(() => { document.querySelector('input[name="util-type-opt"][value="EPS"]').click(); saveStoreEdit(); });
  const g4 = await fillAt(f, A, [[9520, 4550], [9548.6, 4550], [9549.5, 4550], [9575, 4550], [9600.5, 4550], [9601.4, 4550]]);
  const ub = await bboxOf(f, u);
  ok(JSON.stringify(g4) === '[true,true,false,false,false,true]' && ub.y0 === 4480 && ub.y1 === 4620, '4) 기능실은 그린 대로, 복도는 기능실 둘레 1px 비움 ' + JSON.stringify({ g4, ub }));

  // 5) 바닥을 복도 위에 그려도 복도에 안 잘림
  const fz = await zone(f, 'floor', [{ x: 9960, y: 4510 }, { x: 9990, y: 4510 }, { x: 9990, y: 4590 }, { x: 9960, y: 4590 }]);
  await f.evaluate(() => exitAddZoneMode());
  const fxs = fz.points.map(q => q.x), fys = fz.points.map(q => q.y);
  ok(Math.min(...fxs) === 9960 && Math.max(...fxs) === 9990 && Math.min(...fys) === 4510 && Math.max(...fys) === 4590, '5) 바닥은 복도 위에 그린 대로 ' + JSON.stringify(fz.points));

  // 6) 후방복도 수정 창: 「후방복도」 선택 · 후방복도 색
  const k6 = await f.evaluate(id => { const st = currentStores.find(s => s.id === id); openEditModalForStore(st); const r = document.querySelector('input[name="util-type-opt"]:checked'); const on = document.querySelector('#edit-modal .color-swatch.active')?.dataset.color; cancelStoreEdit(); return { r: r && r.value, on }; }, A);
  ok(k6.r === '후방복도' && k6.on === '#b4bfcc', '6) 후방복도를 열면 「후방복도」 선택 · 후방복도 색 ' + JSON.stringify(k6));

  // 7) 크기 늘리기: 외벽 밖으로 안 늘어남 (모서리 손잡이를 외벽 밖까지 끌기)
  await f.evaluate(() => focusStoreAt(9420, 4000)); await p.waitForTimeout(400);
  const s7 = await drawStore(f, [{ x: 9400, y: 3970 }, { x: 9450, y: 3970 }, { x: 9450, y: 4020 }, { x: 9400, y: 4020 }]);
  const h = await f.evaluate(() => { const r = document.querySelector('#shape-edit-handles .shape-handle[data-corner="0"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const to = await scr(9300 - 60, 3970 - 60);
  await p.mouse.move(box.x + h.x, box.y + h.y); await p.mouse.down();
  await p.mouse.move((box.x + h.x + to.x) / 2, (box.y + h.y + to.y) / 2, { steps: 4 }); await p.mouse.move(to.x, to.y, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(150);
  const b7 = await bboxOf(f, s7);
  ok(b7.x0 >= 9299.9 && b7.y0 >= 3949.9 && b7.x0 < 9350 && Math.abs(b7.x1 - 9450) < 0.2, '7) 크기를 외벽 밖까지 늘려도 외벽선에서 멈춤 ' + JSON.stringify(b7));
  await f.evaluate(() => cancelStoreEdit());

  // 8) 「후방복도 다시 맞추기」: 고친 이름은 이어 받음
  await f.evaluate(id => { openEditModalForStore(currentStores.find(s => s.id === id)); document.getElementById('edit-name').value = '1층 동쪽복도'; saveStoreEdit(); }, A);
  await f.evaluate(() => rebuildCorridors()); await p.waitForTimeout(600);
  const c8 = await cor(f);
  const dom8 = await f.evaluate(() => document.querySelectorAll('#corridor-layer g.store-group').length);
  ok(c8.length === 2 && dom8 === 2 && c8.find(c => c.id === A)?.name === '1층 동쪽복도', '8) 다시 맞추기: 2곳 · 고친 이름 그대로 ' + JSON.stringify(c8));
  const g8 = await fillAt(f, A, [[9575, 4550], [9800, 4550], [9520, 4550]]);
  ok(JSON.stringify(g8) === '[false,false,true]', '8-1) 다시 맞춰도 기능실·매장 자리는 비움 ' + JSON.stringify(g8));

  // 8-2) 지도에는 후방복도 이름 글자를 안 씀 · 이름은 자료와 수정 창에 그대로 (결정 380 보충)
  const t8 = await f.evaluate(id => {
    const txt = Array.from(document.querySelectorAll('#corridor-layer text')).map(t => t.textContent).join('');
    const st = currentStores.find(s => s.id === id); openEditModalForStore(st); const nm = document.getElementById('edit-name').value; saveStoreEdit();
    const after = Array.from(document.querySelectorAll('#corridor-layer text')).map(t => t.textContent).join('');
    const epsTxt = Array.from(document.querySelectorAll('#custom-stores-top-layer text')).map(t => t.textContent).join(' ');
    return { txt, nm, after, epsTxt };
  }, A);
  ok(t8.txt === '' && t8.after === '' && t8.nm === '1층 동쪽복도' && /새매장/.test(t8.epsTxt), '8-2) 후방복도 글자 없음(저장 뒤에도) · 이름은 수정 창에 그대로 · 기능실 글자는 있음 ' + JSON.stringify(t8));

  // 9) 레이어: 보기 끄기 · 열쇠 (못 고름 · 지우개 대상 아님)
  const l9 = await f.evaluate(id => {
    onCorridorCheckboxChange(false); const hid = getComputedStyle(document.getElementById('corridor-layer')).display; onCorridorCheckboxChange(true);
    ebLock = false; const t0 = ebTargets().some(t => t.kind === 'corridor');
    onLayerLockChange('corridor', true);
    const t1 = ebTargets().some(t => t.kind === 'corridor');
    closeAllPopovers(); activeSelectedStore = null;
    document.querySelector(`#corridor-layer g.store-group[data-store-id="${id}"] path`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const sel = !!(activeSelectedStore && activeSelectedStore.id === id);
    onLayerLockChange('corridor', false); ebLock = true;
    return { hid, t0, t1, sel, lock: !!document.querySelector('input.chk-lock[data-lock="corridor"]') };
  }, A);
  ok(l9.hid === 'none' && l9.t0 && !l9.t1 && !l9.sel && l9.lock, '9) 보기 끄면 숨김 · 열쇠 잠그면 고르기·지우개 막힘 ' + JSON.stringify(l9));

  // 11) 다 깎여 빈 후방복도가 있어도 매장 그리기 점이 찍힘 (지하1층 실제 고장 11-28)
  const e11 = await f.evaluate(() => {
    if (isZoneDrawingMode) exitAddZoneMode();
    document.querySelector('#corridor-layer path.store-polygon').setAttribute('d', '');
    let err = '';
    try { snapToGrid(10400, 5600); } catch (e) { err = e.message; }
    if (!isDrawingMode) toggleAddStoreMode();
    drawingPoints = [];
    return err;
  });
  const v11 = await p.locator('iframe.mapframe').boundingBox();
  await p.mouse.click(v11.x + v11.width / 2, v11.y + v11.height / 2); await p.waitForTimeout(200);
  ok(e11 === '' && await f.evaluate(() => drawingPoints.length) === 1, '11) 빈 후방복도가 있어도 매장 추가 점이 찍힘 ' + e11);
  await f.evaluate(() => { if (isDrawingMode) toggleAddStoreMode(); });

  // 12) 매장 크기 조절 틀(점선·네모 손잡이)은 저장 안 함 · 예전에 저장된 것은 열 때 지움 (1층 남은 틀 11-28)
  const t12 = await f.evaluate(() => {
    const svg = document.querySelector('#map-container svg'), NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g'); g.id = 'shape-edit-handles'; g.innerHTML = '<rect x="9535" y="4390" width="145" height="90" stroke-dasharray="8 5"/>';
    svg.appendChild(g);
    syncSvgCache();
    const saved = !svgCache.get(FLOORS[currentFloorIdx].code).includes('shape-edit-handles');
    bindStoresAndPolygons(FLOORS[currentFloorIdx]);
    return { saved, gone: !svg.querySelector('#shape-edit-handles') };
  });
  ok(t12.saved && t12.gone, '12) 크기 조절 틀은 저장 안 함 · 남아 있던 것은 열 때 지움 ' + JSON.stringify(t12));

  ok(!p.errs.length, '10) 화면 오류 없음 ' + p.errs.join(' | '));
  await b.close(); srv.close();
  console.log(fail ? `\n${fail}개 실패` : '\n지도 후방복도 시험 모두 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
