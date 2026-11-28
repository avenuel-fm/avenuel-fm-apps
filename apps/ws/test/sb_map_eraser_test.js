// 지도 기능실 수정 중 연결선 고르기·Del · 매장명 끌어 옮기기 · 동그라미 지우개 시험 (결정 374)
// 실행: node test/sb_map_eraser_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8152;
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
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor({ state: 'attached' });
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

(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1280, height: 800 } });
  let dialogs = 0; p.on('dialog', () => { dialogs++; });
  const box = await p.locator('iframe.mapframe').boundingBox();
  const scr = (x, y) => f.evaluate(([x, y]) => { const m = document.querySelector('#map-container svg').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]).then(q => ({ x: q.x + box.x, y: q.y + box.y }));
  const mkStore = (pts, name, util) => f.evaluate(([pts, name, util]) => {
    toggleAddStoreMode(); drawingPoints = pts; finishDrawingPolygon();
    if (util) setEditType('utility');
    document.getElementById('edit-name').value = name; saveStoreEdit();
    return currentStores[currentStores.length - 1].id;
  }, [pts, name, util]);
  const R = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  await f.evaluate(() => focusStoreAt(9700, 4550)); await p.waitForTimeout(500);
  const S = await mkStore(R(9350, 4450, 9450, 4530), '에스매장');
  const S2 = await mkStore(R(9550, 4650, 9650, 4730), '투매장');
  const U = await mkStore(R(9750, 4450, 9850, 4530), 'EPS', true);
  await f.evaluate(([s, s2, u]) => {
    const mk = (id, src, srcName, pts) => ({ id, subType: 'power', subTypeLabel: '전기', className: 'util-line-eps', color: '#dc2626', sourceStoreId: String(src), sourceName: srcName, targetStoreId: String(u), targetName: currentStores.find(x => x.id === u).name, points: pts.map(([x, y]) => ({ x, y })) });
    saveFloorUtilityLines(FLOORS[currentFloorIdx].code, [mk('ln1', s, '에스매장', [[9750, 4490], [9450, 4490]]), mk('ln2', s2, '투매장', [[9800, 4530], [9800, 4690], [9650, 4690]])]);
    renderFloorUtilityLines(); closeAllPopovers(); }, [S, S2, U]);
  await p.waitForTimeout(300);
  const lines = () => f.evaluate(() => getFloorUtilityLines(FLOORS[currentFloorIdx].code).map(l => l.id));
  const L0 = await lines();
  ok(L0.length === 2, '0) 준비: 기능실 EPS 에 매장 연결선 2개 (' + L0.length + ')');
  const vis = () => f.evaluate(() => Array.from(document.querySelectorAll('#utility-lines-layer .util-line-item-group')).filter(g => g.style.display !== 'none').map(g => g.getAttribute('data-id')).sort().join(','));
  const modalOpen = () => f.evaluate(() => editModal.style.display !== 'none');
  // 선 첫 마디 1/4 지점의 화면 점 · 지도 점 (가운데는 이름표가 덮음)
  const linePt0 = id => f.evaluate(id => { const pl = document.querySelector(`#utility-lines-layer .util-line-item-group[data-id="${id}"] .util-feeder-line`), m = pl.getScreenCTM(), a = pl.points[0], c = pl.points[1];
    const x = a.x + (c.x - a.x) / 4, y = a.y + (c.y - a.y) / 4; return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, mx: x, my: y }; }, id).then(q => ({ x: q.x + box.x, y: q.y + box.y, mx: q.mx, my: q.my }));
  // 선을 고르면 지도가 그쪽으로 움직임 → 멈출 때까지 기다림
  const linePt = async id => { let a = await linePt0(id); for (let i = 0; i < 40; i++) { await p.waitForTimeout(100); const b = await linePt0(id); if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) return b; a = b; } return a; };

  // ── A) 기능실 수정하기: 연결선 모두 표시 · 눌러 고르기(확인 창 없음) · Esc 는 선택만 풀기 · Del 삭제 ──
  await f.evaluate(u => openEditModalForStore(currentStores.find(x => x.id === u)), U); await p.waitForTimeout(400);
  ok(await vis() === [...L0].sort().join(','), 'A1) 기능실 수정하기를 열면 연결선 2개 모두 보임 (' + await vis() + ')');
  let q = await linePt(L0[0]);
  await p.mouse.click(q.x, q.y); await p.waitForTimeout(200);
  ok(dialogs === 0 && await f.evaluate(() => activeSelectedUtilLineId) === L0[0] && await modalOpen(), 'A2) 선을 누르면 확인 창 없이 골라짐 · 수정 창 그대로');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(!(await f.evaluate(() => activeSelectedUtilLineId)) && await modalOpen(), 'A3) Esc: 선택만 풀리고 수정 창은 그대로');
  q = await linePt(L0[0]);
  await p.mouse.click(q.x, q.y); await p.waitForTimeout(200);
  await p.keyboard.press('Delete'); await p.waitForTimeout(200);
  const L1 = await lines();
  ok(L1.length === 1 && !L1.includes(L0[0]) && dialogs === 0 && await modalOpen(), 'A4) Delete: 고른 선만 지워짐 · 수정 창 그대로 (' + L1.join(',') + ')');
  await f.evaluate(() => { if (editModal.style.display !== 'none') cancelStoreEdit(); closeAllPopovers(); handleUndo(); }); await p.waitForTimeout(800);
  ok((await lines()).length === 2, 'A5) 되돌리기로 선 돌아옴');

  // ── B) 매장명 끌어 옮기기 ──
  const lbl = s => f.evaluate(s => { const st = currentStores.find(x => x.id === s), t = st.textElement, tb = t.getBBox(), pb = st.polygonElement.getBBox();
    return { dx: +t.dataset.lblDx || 0, dy: +t.dataset.lblDy || 0, cx: tb.x + tb.width / 2, cy: tb.y + tb.height / 2, sx: pb.x + pb.width / 2, sy: pb.y + pb.height / 2, cur: getComputedStyle(t).cursor }; }, s);
  const txtPt = s => f.evaluate(s => { const r = currentStores.find(x => x.id === s).textElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, s).then(q => ({ x: q.x + box.x, y: q.y + box.y }));
  const k = await f.evaluate(() => scale);
  const dragTxt = async (s, dx, dy, shift, check) => { const a = await txtPt(s); await p.mouse.move(a.x, a.y); if (shift) await p.keyboard.down('Shift'); await p.mouse.down();
    for (let i = 1; i <= 6; i++) await p.mouse.move(a.x + dx * i / 6, a.y + dy * i / 6);
    const mid = check ? await check() : null; await p.mouse.up(); if (shift) await p.keyboard.up('Shift'); await p.waitForTimeout(150); return mid; };
  await f.evaluate(s => openEditModalForStore(currentStores.find(x => x.id === s)), S); await p.waitForTimeout(300);
  const b0 = await lbl(S);
  ok(b0.cur === 'move', 'B1) 수정 중 매장명에 마우스를 올리면 십자 화살표 (' + b0.cur + ')');
  const d0 = await f.evaluate(s => currentStores.find(x => x.id === s).polygonElement.getAttribute('d'), S);
  await dragTxt(S, 30, 18);
  const b1 = await lbl(S);
  ok(Math.abs(b1.dx - 30 / k) < 1.5 && Math.abs(b1.dy - 18 / k) < 1.5, 'B2) 끌면 이름만 옮겨짐 ' + JSON.stringify(b1));
  ok(await f.evaluate(s => currentStores.find(x => x.id === s).polygonElement.getAttribute('d'), S) === d0, 'B2-1) 도형은 그대로');
  await dragTxt(S, 25, 9, true);
  const b2 = await lbl(S);
  ok(Math.abs(b2.dy - b1.dy) < 0.01 && b2.dx > b1.dx + 20 / k, 'B3) Shift 누르고 끌면 가로로만 ' + JSON.stringify(b2));
  const toC = (b2.sx - b2.cx) * k + 2;   // 가운데에서 2px 모자란 곳까지 → 붙어야 함
  const g = await dragTxt(S, toC, 0, true, () => f.evaluate(() => document.querySelectorAll('#lbl-snap-guide line').length));
  const b3 = await lbl(S);
  ok(g >= 1 && Math.abs(b3.cx - b3.sx) < 0.6, 'B4) 도형 가운데 가까이 오면 딱 붙고 점선 안내 (' + g + '줄) ' + JSON.stringify(b3));
  ok(!(await f.evaluate(() => !!document.getElementById('lbl-snap-guide'))), 'B4-1) 놓으면 안내선 사라짐');
  await f.evaluate(() => saveStoreEdit()); await p.waitForTimeout(200);
  const b4 = await lbl(S);
  ok(Math.abs(b4.dy - b3.dy) < 0.01 && b4.dy > 5, 'B5) 저장해도 옮긴 자리 그대로 ' + JSON.stringify(b4));
  await f.evaluate(s => { const st = currentStores.find(x => x.id === s); openEditModalForStore(st); document.getElementById('edit-name').value = '에스매장2'; saveStoreEdit(); }, S);
  const b5 = await lbl(S);
  ok(Math.abs(b5.cy - b4.cy) < 0.6, 'B6) 이름을 바꿔도 옮긴 자리 그대로 ' + JSON.stringify(b5));
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(500);
  const b6 = await lbl(S);
  ok(Math.abs(b6.cy - b4.cy) < 0.6, 'B7) 다시 열어도 옮긴 자리 그대로 ' + JSON.stringify(b6));
  await f.evaluate(s => openEditModalForStore(currentStores.find(x => x.id === s)), S); await p.waitForTimeout(200);
  await dragTxt(S, -20, -20);
  await f.evaluate(() => cancelStoreEdit()); await p.waitForTimeout(150);
  const b7 = await lbl(S);
  ok(Math.abs(b7.dx - b6.dx) < 0.01 && Math.abs(b7.dy - b6.dy) < 0.01 && b7.cur !== 'move', 'B8) 「취소」 하면 이름 자리 원래대로 ' + JSON.stringify(b7));

  // ── C) 동그라미 지우개 ──
  await f.evaluate(() => { closeAllPopovers(); if (!isZoneDrawingMode) toggleAddZoneMode(); }); await p.waitForTimeout(200);
  await fl.locator('#btn-zone-eraser').click();
  ok(await f.evaluate(() => document.body.classList.contains('eraser-brush') && currentZoneCategory === 'erase'), 'C1) 지우개 켜짐');
  ok((await vis()).split(',').length === 2, 'C2) 지우개 중엔 연결선이 모두 보임 (' + await vis() + ')');
  await f.evaluate(() => focusStoreAt(10400, 4950)); await p.waitForTimeout(700);
  const a0 = await scr(10300, 4900);
  await p.mouse.move(a0.x, a0.y);
  const cur = () => f.evaluate(() => { const c = document.getElementById('eraser-cursor'); return c && c.style.display !== 'none' ? c.getBoundingClientRect().width : 0; });
  ok(Math.abs(await cur() - 20) < 0.5, 'C3) 마우스에 지름 20px 동그라미 (' + await cur() + ')');
  await p.keyboard.press(']'); const c40 = await cur();
  await p.keyboard.press('['); await p.keyboard.press('['); const c10 = await cur();
  await p.keyboard.press(']'); const c20 = await cur();
  ok(Math.abs(c40 - 40) < 0.5 && Math.abs(c10 - 10) < 0.5 && Math.abs(c20 - 20) < 0.5, 'C4) [ ] 키로 10·20·40px (' + [c40, c10, c20].join('/') + ')');
  const nz = () => f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'erase').length);
  const stroke = async (pts, check) => { const s0 = await scr(pts[0][0], pts[0][1]); await p.mouse.move(s0.x, s0.y); await p.mouse.down();
    for (const [x, y] of pts.slice(1)) { const s1 = await scr(x, y); await p.mouse.move(s1.x, s1.y, { steps: 6 }); }
    const mid = check ? await check() : null; await p.mouse.up(); await p.waitForTimeout(200); return mid; };
  // 빨간 얼룩(바닥)만 문지르기 → 걸린 게 없으면 바로 흰색
  const z0 = await nz();
  const gray = await stroke([[10505, 5030], [10555, 5030]], () => f.evaluate(() => document.querySelector('#eraser-temp-layer polyline')?.getAttribute('stroke')));
  ok(gray === '#94a3b8', 'C5) 누른 채 움직이면 회색으로 칠해짐 (' + gray + ')');
  const zz = await f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'erase').pop());
  ok(await nz() === z0 + 1 && zz.geometry === 'stroke' && zz.points.length >= 2 && zz.w > 0 && !(await f.evaluate(() => !!document.getElementById('erase-confirm'))), 'C6) 놓으면 걸린 게 없으니 바로 칠 저장 ' + JSON.stringify({ g: zz.geometry, w: zz.w, n: zz.points.length }));
  const px = await pixel(f, 10530, 5030);
  ok(near(px, [255, 255, 255, 255]), 'C7) 칠한 곳은 바닥색(흰색) ' + px.join(','));
  await f.evaluate(() => focusStoreAt(9600, 4550)); await p.waitForTimeout(700);
  // 잠금(처음엔 켜짐): 매장 위를 문질러도 매장은 안 걸리고 연결선만 걸림
  ok(await f.evaluate(() => document.getElementById('chk-eraser-lock').checked && ebLock), 'C7-1) 「매장·기능실 잠금」 처음엔 켜짐');
  const lpL = await linePt(L0[0]);
  await stroke([[9400, 4470], [lpL.mx, lpL.my]]);
  const rwL = await f.evaluate(() => Array.from(document.querySelectorAll('#erase-confirm .ec-kind')).map(e => e.textContent));
  ok(rwL.length >= 1 && rwL.every(k => k === '연결선'), 'C7-2) 잠금 중엔 매장은 안 걸리고 연결선만 ' + JSON.stringify(rwL));
  await fl.locator('#erase-confirm .ec-cancel').click(); await p.waitForTimeout(200);
  await fl.locator('#chk-eraser-lock').uncheck();
  ok(await f.evaluate(() => !ebLock && localStorage.getItem('map_eraser_lock') === '0'), 'C7-3) 잠금을 풀면 이 기기에 기억');
  // 매장 S 위 → 빨간 표시 → 창 → 취소 = 칠 없앰
  const hitMid = await stroke([[9330, 4490], [9400, 4490]], () => f.evaluate(s => currentStores.find(x => x.id === s).polygonElement.classList.contains('erase-hit'), S));
  ok(hitMid, 'C8) 문지르는 중 걸린 매장은 빨간 테두리로 깜빡임');
  const rows = () => f.evaluate(() => Array.from(document.querySelectorAll('#erase-confirm .ec-row')).map(r => ({ kind: r.querySelector('.ec-kind').textContent, name: r.querySelector('.ec-name').textContent, on: r.querySelector('input').checked })));
  let rw = await rows();
  ok(rw.length === 1 && rw[0].kind === '매장' && /에스매장2/.test(rw[0].name) && rw[0].on && /삭제하시겠습니까/.test(await fl.locator('#erase-confirm .ec-title').innerText()), 'C9) 놓으면 「삭제하시겠습니까?」 창에 걸린 매장 (체크됨) ' + JSON.stringify(rw));
  await shot(p, 'shot_map_eraser_confirm.png');
  await fl.locator('#erase-confirm .ec-cancel').click(); await p.waitForTimeout(200);
  ok(await nz() === z0 + 1 && !(await f.evaluate(() => !!document.querySelector('#eraser-temp-layer, .erase-hit'))) && await f.evaluate(s => !!currentStores.find(x => x.id === s), S), 'C10) 취소: 칠도 없어지고 매장 그대로');
  // 매장 S + 연결선 → 매장 체크 풀고 확인 → 선만 지워지고 칠 남음
  const lp = await linePt(L0[0]);
  await stroke([[9400, 4470], [lp.mx, lp.my]]);
  rw = await rows();
  ok(rw.some(r => r.kind === '매장') && rw.some(r => r.kind === '연결선') && rw.every(r => r.on), 'C11) 매장과 연결선이 함께 걸림 · 모두 체크 ' + JSON.stringify(rw));
  await f.evaluate(() => { const r = Array.from(document.querySelectorAll('#erase-confirm .ec-row')).find(r => r.querySelector('.ec-kind').textContent === '매장'); r.querySelector('input').click(); });
  ok(!(await f.evaluate(s => currentStores.find(x => x.id === s).polygonElement.classList.contains('erase-hit'), S)), 'C12) 체크를 풀면 빨간 표시도 꺼짐');
  const nLineHit = rw.filter(r => r.kind === '연결선').length;
  await fl.locator('#erase-confirm .ec-ok').click(); await p.waitForTimeout(300);
  ok((await lines()).length === 2 - nLineHit && await f.evaluate(s => !!currentStores.find(x => x.id === s), S) && await nz() === z0 + 2, 'C13) 확인: 체크한 연결선만 지움 · 매장은 그대로 · 칠 남음');
  await f.evaluate(() => handleUndo()); await p.waitForTimeout(800);
  ok((await lines()).length === 2 && await nz() === z0 + 1, 'C14) 되돌리기 한 번에 선과 칠이 함께 돌아옴');
  const b8 = await lbl(S);
  ok(Math.abs(b8.cy - b4.cy) < 0.6, 'C14-1) 되돌리기로 도면을 다시 그려도 옮긴 매장명 자리 그대로 ' + JSON.stringify(b8));
  // 기능실 U 지우기 (Enter = 확인)
  if (!(await f.evaluate(() => isZoneDrawingMode && currentZoneCategory === 'erase'))) { await f.evaluate(() => { if (!isZoneDrawingMode) toggleAddZoneMode(); }); await fl.locator('#btn-zone-eraser').click(); }
  await stroke([[9780, 4490], [9820, 4490]]);
  rw = await rows();
  ok(rw.length === 1 && rw[0].kind === '기능실', 'C15) 기능실도 걸림 ' + JSON.stringify(rw));
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok(!(await f.evaluate(u => !!currentStores.find(x => x.id === u), U)) && !(await f.evaluate(() => !!document.getElementById('erase-confirm'))), 'C16) Enter = 확인 → 기능실 지워짐');
  await shot(p, 'shot_map_eraser.png');
  // ── D) 결정 376: Shift 직선 · 열쇠 잠긴 레이어 · 외벽선·외벽 밖 ──
  await f.evaluate(() => focusStoreAt(10400, 4950)); await p.waitForTimeout(700);
  { const s0 = await scr(10450, 5100); await p.mouse.move(s0.x, s0.y); await p.keyboard.down('Shift'); await p.mouse.down();
    const s1 = await scr(10530, 5140); await p.mouse.move(s1.x, s1.y, { steps: 6 }); await p.mouse.up(); await p.keyboard.up('Shift'); await p.waitForTimeout(250); }
  const zs = await f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'erase').pop());
  const ys = zs.points.map(q => q.y), xs = zs.points.map(q => q.x);
  ok(Math.max(...ys) - Math.min(...ys) < 0.5 && Math.max(...xs) - Math.min(...xs) > 50, 'D1) Shift 누르고 문지르면 가로로만 ' + JSON.stringify({ dy: Math.max(...ys) - Math.min(...ys), dx: Math.max(...xs) - Math.min(...xs) }));
  await f.evaluate(() => onLayerLockChange('sym_fire_hydrant', true));
  await stroke([[10450, 5200], [10530, 5200]]);
  const zk = await f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'erase').pop());
  await f.evaluate(() => onLayerLockChange('sym_fire_hydrant', false));
  await f.evaluate(() => renderFloorZones(FLOORS[currentFloorIdx].code));
  const kg = await f.evaluate(() => { const g = document.querySelector('#eraser-layer g[data-keep-grp="sym_fire_hydrant"]'); return g ? { n: g.querySelectorAll('polyline').length, m: !!document.querySelector(g.getAttribute('mask').slice(4, -1)) } : null; });
  ok(zk.keep === 'sym_fire_hydrant' && kg && kg.n === 1 && kg.m, 'D2) 칠할 때 잠긴 레이어는 그 칠에 기억 · 열쇠를 풀어도 따로 구멍 ' + JSON.stringify({ keep: zk.keep, kg }));
  // 닫힌 외벽 → 지우개는 외벽 안만, 외벽선은 구멍
  const z9 = await f.evaluate(() => { const c = FLOORS[currentFloorIdx].code, zs = getFloorZones(c);
    zs.push({ id: 'zone_eb_wall', name: '외벽', category: 'wall', geometry: 'line', points: [[10000, 4000], [11000, 4000], [11000, 5600], [10000, 5600], [10000, 4000]].map(([x, y]) => ({ x, y })) });
    saveFloorZones(c, zs); renderFloorZones(c);
    const cp = document.querySelector('#eraser-defs #eraser-clip path');
    return { clip: document.getElementById('eraser-layer').getAttribute('clip-path'), d: cp ? cp.getAttribute('d').slice(0, 30) : '',
      wallHole: Array.from(document.querySelectorAll('#eraser-defs mask')).every(m => !!m.querySelector('.building-exterior-wall')) }; });
  ok(z9.clip === 'url(#eraser-clip)' && /^M10000/.test(z9.d) && z9.wallHole, 'D3) 외벽이 닫히면 칠은 외벽 안쪽만 · 외벽선은 늘 구멍 ' + JSON.stringify(z9));
  await f.evaluate(() => focusStoreAt(9600, 4550)); await p.waitForTimeout(700);
  await stroke([[9330, 4490], [9400, 4490]]);
  ok(!(await f.evaluate(() => !!document.getElementById('erase-confirm'))) && await f.evaluate(s => !!currentStores.find(x => x.id === s), S), 'D3-1) 외벽 밖 매장은 문질러도 안 걸림');
  await f.evaluate(() => focusStoreAt(10400, 4950)); await p.waitForTimeout(700);
  const zOut = await nz();
  await stroke([[10950, 5100], [11080, 5100]]);
  ok(await nz() === zOut + 1 && near(await pixel(f, 10960, 5100), [255, 255, 255, 255]), 'D4) 외벽 안쪽 칠은 흰색');
  await f.evaluate(() => { const c = FLOORS[currentFloorIdx].code; saveFloorZones(c, getFloorZones(c).filter(z => z.id !== 'zone_eb_wall')); renderFloorZones(c); });
  ok(!(await f.evaluate(() => document.getElementById('eraser-layer').getAttribute('clip-path'))), 'D5) 외벽이 없으면 자르지 않음');
  await fl.locator('#btn-zone-eraser').click();
  ok(await f.evaluate(() => !document.body.classList.contains('eraser-brush')) && await vis() === '', 'C17) 지우개를 끄면 연결선 다시 숨김 (' + await vis() + ')');
  ok(!p.errs.length, 'Z) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  if (fail) { console.log('\n실패 ' + fail + '건'); process.exit(1); }
  console.log('연결선 고르기·매장명 옮기기·동그라미 지우개 시험 통과');
})();

