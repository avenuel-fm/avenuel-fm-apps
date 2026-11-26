// 지도 도형 고치기 시험 (결정 308): 기운 도형 글자 · 도형 크기·자리 · 바닥이 매장 피하기 · 연결선 다시 그리기 · 끊긴 복도 표시 · 모서리 자석
// 실행: node test/sb_map_shape_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8145;
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
const draw = (f, pts) => f.evaluate(pts => { drawingZonePoints = pts; finishDrawingZone(); }, pts);

(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1280, height: 800 } });
  const box = await p.locator('iframe.mapframe').boundingBox();
  const scr = (x, y) => f.evaluate(([x, y]) => { const m = document.querySelector('#map-container svg').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]).then(q => ({ x: q.x + box.x, y: q.y + box.y }));
  const drag = async (a, dx, dy) => { await p.mouse.move(a.x, a.y); await p.mouse.down(); for (let i = 1; i <= 5; i++) await p.mouse.move(a.x + dx * i / 5, a.y + dy * i / 5); await p.mouse.up(); await p.waitForTimeout(100); };
  const bbox = d => f.evaluate(d => { const xs = [], ys = []; parseSvgPathPoints(d).forEach(q => { xs.push(q.x); ys.push(q.y); }); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }, d);
  const dOf = id => f.evaluate(s => currentStores.find(x => x.id === s).polygonElement.getAttribute('d'), id);
  await f.evaluate(() => { focusStoreAt(9600, 4450); }); await p.waitForTimeout(500);

  // 1) 모서리 자석: 매장 그리기 중엔 아그라(9450~9750 · 4100~4300) 모서리·변에 붙음
  const sn = await f.evaluate(() => { toggleAddStoreMode(); const r = { c: snapToGrid(9451.5, 4101.2), e: snapToGrid(9601.3, 4098.9) }; toggleAddStoreMode(); r.off = snapToGrid(9451.5, 4101.2); return r; });
  ok(sn.c.type === 'corner' && sn.c.x === 9450 && sn.c.y === 4100, '1) 그릴 때 옆 매장 모서리에 붙음 ' + JSON.stringify(sn.c));
  ok(sn.e.type === 'edge' && Math.abs(sn.e.y - 4100) < 0.01 && Math.abs(sn.e.x - 9601.3) < 0.01, '1-1) 모서리가 멀면 벽(변)에 붙음 ' + JSON.stringify(sn.e));
  ok(sn.off.type !== 'corner' && sn.off.type !== 'edge', '1-2) 그리기가 아니면 격자 자석만 (예전 그대로)');

  // 바닥: 아그라 아래 넓은 복도 (아그라와 겹침 → 아그라 밖 2px 로)
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(150);
  await fl.locator('#btn-zone-cat-floor').click(); await f.evaluate(() => { if (floorCenterlineOn) toggleCenterlineFloor(); });
  await draw(f, [{ x: 9300, y: 4250 }, { x: 9900, y: 4250 }, { x: 9900, y: 4700 }, { x: 9300, y: 4700 }]);
  const fl1 = await f.evaluate(() => { const z = getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor'); const a = rtPathPoints(document.querySelector('#a')); return { n: z.length, inside: z.some(q => q.points.some(pt => isPointInsidePolygon(pt, a))), cut: z.some(q => q.points.some(pt => Math.abs(pt.y - 4302) < 0.01)) }; });
  ok(fl1.n === 1 && !fl1.inside && fl1.cut, '2) 바닥(면)이 매장을 침범하면 매장 둘레 2px 밖으로 다시 그림 ' + JSON.stringify(fl1));
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(150);
  await fl.locator('#btn-zone-cat-floor').click(); await f.evaluate(() => { if (!floorCenterlineOn) toggleCenterlineFloor(); drawingZonePoints = [{ x: 9600, y: 3950 }, { x: 9600, y: 4150 }]; finishCenterlineFloor(); });
  const fl2 = await f.evaluate(() => { const a = rtPathPoints(document.querySelector('#a')); return getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor').every(q => q.points.every(pt => !isPointInsidePolygon(pt, a))); });
  ok(fl2, '2-1) 복도 중심선으로 그린 바닥도 매장 안으로 안 들어감');
  await f.evaluate(() => { if (isZoneDrawingMode) toggleAddZoneMode(); });
  // 2-2) 매장을 꿰뚫어 지나가는 바닥은 그린 대로 (결정 310)
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(150);
  await fl.locator('#btn-zone-cat-floor').click(); await f.evaluate(() => { if (floorCenterlineOn) toggleCenterlineFloor(); });
  await draw(f, [{ x: 9350, y: 4150 }, { x: 9850, y: 4150 }, { x: 9850, y: 4200 }, { x: 9350, y: 4200 }]);
  const fl3 = await f.evaluate(() => { const z = getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor'), q = z[z.length - 1]; return { n: q.points.length, pts: JSON.stringify(q.points) }; });
  ok(fl3.n === 4 && fl3.pts === JSON.stringify([{ x: 9350, y: 4150 }, { x: 9850, y: 4150 }, { x: 9850, y: 4200 }, { x: 9350, y: 4200 }]), '2-2) 매장을 꿰뚫어 지나가는 바닥은 자르지 않고 그린 대로 ' + fl3.pts);
  await f.evaluate(() => { if (isZoneDrawingMode) toggleAddZoneMode(); });

  // 직접 그린 매장 S, 기능실 U (바닥 위)
  const mkStore = (pts, name, util) => f.evaluate(([pts, name, util]) => {
    toggleAddStoreMode(); drawingPoints = pts; finishDrawingPolygon();
    if (util) setEditType('utility');
    document.getElementById('edit-name').value = name; saveStoreEdit();
    return currentStores[currentStores.length - 1].id;
  }, [pts, name, util]);
  const S = await mkStore([{ x: 9350, y: 4450 }, { x: 9450, y: 4450 }, { x: 9450, y: 4530 }, { x: 9350, y: 4530 }], '에스매장');
  const U = await mkStore([{ x: 9750, y: 4450 }, { x: 9850, y: 4450 }, { x: 9850, y: 4530 }, { x: 9750, y: 4530 }], 'EPS', true);
  await f.evaluate(([s, u]) => { const st = id => currentStores.find(x => x.id === id); startUtilityLineDrawingMode(); handleUtilLineMapClick(null, st(u)); handleUtilLineMapClick(null, st(s)); }, [S, U]);
  const line0 = await f.evaluate(() => JSON.stringify((getFloorUtilityLines(FLOORS[currentFloorIdx].code)[0] || {}).points || null));
  ok(line0 && line0.length > 10, '3) 매장-기능실 연결선 생김');

  // 4) 수정하기: 창은 오른쪽 아래 · 지도는 그대로 만짐 · 손잡이 4개 · 원래 색
  const sD0 = await f.evaluate(s => { const st = currentStores.find(x => x.id === s); openEditModalForStore(st); return st.polygonElement.getAttribute('d'); }, S);
  const ui = await f.evaluate(() => { const o = document.getElementById('modal-overlay'), r = document.getElementById('edit-modal').getBoundingClientRect(); return { side: o.classList.contains('as-side-overlay'), pe: getComputedStyle(o).pointerEvents, right: innerWidth - r.right < 40, handles: document.querySelectorAll('#shape-edit-handles .shape-handle').length, sel: !!document.querySelector('.store-polygon.selected'), cur: getComputedStyle(document.querySelector('.store-polygon.shape-editing')).cursor }; });
  ok(ui.side && ui.pe === 'none' && ui.right, '4) 수정 창이 오른쪽 · 뒤 지도는 가리지 않음 ' + JSON.stringify(ui));
  ok(ui.handles === 4 && !ui.sel && ui.cur === 'move', '4-1) 모서리 손잡이 4개 · 원래 색 · 가운데는 십자(이동) 커서 ' + JSON.stringify(ui));
  const hcur = await f.evaluate(() => Array.from(document.querySelectorAll('#shape-edit-handles .shape-handle')).map(h => h.style.cursor).join(','));
  ok(hcur === 'nwse-resize,nesw-resize,nwse-resize,nesw-resize', '4-2) 모서리는 크기 조절 커서 (' + hcur + ')');
  const k = await f.evaluate(() => scale);
  await drag(await scr(9400, 4490), 0, 60);
  const b1 = await bbox(await dOf(S));
  ok(Math.abs(b1.y0 - (4450 + 60 / k)) < 1.5 && Math.abs(b1.x0 - 9350) < 1.5 && Math.abs(b1.x1 - b1.x0 - 100) < 0.5, '5) 가운데를 끌면 도형이 통째로 옮겨짐 ' + JSON.stringify(b1));
  const ty = await f.evaluate(s => +currentStores.find(x => x.id === s).textElement.getAttribute('y'), S);
  ok(ty > 4490 + 60 / k - 10, '5-1) 이름도 같이 옮겨짐 (' + ty + ')');
  await drag(await scr(b1.x1, b1.y1), 50 * k, 40 * k);
  const b2 = await bbox(await dOf(S));
  const ratio = (b2.x1 - b2.x0) / (b2.y1 - b2.y0);
  ok(Math.abs(b2.x0 - b1.x0) < 0.5 && Math.abs(b2.y0 - b1.y0) < 0.5 && b2.x1 - b2.x0 > 130 && Math.abs(ratio - 100 / 80) < 0.02, '6) 모서리를 끌면 맞은편 모서리 기준 · 그린 모양(비율) 그대로 커짐 ' + JSON.stringify(b2));
  await f.evaluate(() => cancelStoreEdit());
  const sD1 = await dOf(S);
  ok(sD1 === sD0 && !(await f.evaluate(() => !!document.getElementById('shape-edit-handles'))), '7) 「취소」 하면 모양·자리 원래대로 · 손잡이 없어짐');

  // 8) 다시 열어 옮기고 저장 → 저장값 · 연결선 다시 그림
  await f.evaluate(s => openEditModalForStore(currentStores.find(x => x.id === s)), S);
  await drag(await scr(9400, 4490), 0, 60 * k);
  await f.evaluate(() => saveStoreEdit()); await p.waitForTimeout(200);
  const sv = await f.evaluate(s => getCustomStores(FLOORS[currentFloorIdx].code).find(c => c.id === s).pathData, S);
  const b3 = await bbox(sv);
  ok(Math.abs(b3.y0 - 4510) < 1.5, '8) 「저장」 하면 옮긴 자리가 저장됨 ' + JSON.stringify(b3));
  const line1 = await f.evaluate(() => getFloorUtilityLines(FLOORS[currentFloorIdx].code)[0].points);
  const endY = line1[line1.length - 1].y;
  ok(JSON.stringify(line1) !== line0 && endY >= 4505 && endY <= 4595, '8-1) 붙어 있던 연결선이 새 자리로 다시 그려짐 (끝 ' + JSON.stringify(line1[line1.length - 1]) + ')');
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(400);
  ok(await dOf(S) === sv, '8-2) 다시 열어도 옮긴 자리 그대로');

  // 9) 기운 도형: 글자도 같은 기울기 · 넘치면 기울기 그대로 키움
  const T = await f.evaluate(() => {
    const c = { x: 9620, y: 4620 }, a = 30 * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)], L = 60, S = 32;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + u[0] * i * L / 2 + v[0] * j * S / 2, y: c.y + u[1] * i * L / 2 + v[1] * j * S / 2 }));
    toggleAddStoreMode(); drawingPoints = pts; finishDrawingPolygon();
    document.getElementById('edit-name').value = '기울어진 아주 긴 매장'; saveStoreEdit();
    const st = currentStores[currentStores.length - 1], t = storeTilt(parseSvgPathPoints(st.polygonElement.getAttribute('d')));
    return { tr: st.textElement.getAttribute('transform'), deg: t && t.deg, L: t && t.L, S: t && t.S, cx: t && t.cx, cy: t && t.cy, w: st.textElement.querySelector('tspan').getComputedTextLength(), lines: st.textElement.querySelectorAll('tspan').length,
      saved: getCustomStores(FLOORS[currentFloorIdx].code).find(c => c.id === st.id).pathData === st.polygonElement.getAttribute('d') };
  });
  ok(Math.abs(parseFloat((/^rotate\(([-\d.]+) /.exec(T.tr || '') || [])[1]) - 30) < 0.5 && T.lines === 1, '9) 기운 도형의 글자를 도형 기울기(30도)대로 한 줄 ' + T.tr);
  ok(Math.abs(T.deg - 30) < 0.5 && T.L >= T.w + 11 && T.L > 60 && Math.abs(T.cx - 9620) < 0.5 && Math.abs(T.cy - 4620) < 0.5 && T.saved, '9-1) 글자가 넘쳐 도형을 키움 · 가운데·기울기 그대로 · 저장 ' + JSON.stringify(T));

  // 10) 끊긴 복도: 다른 섬 바닥 위 매장과 이으면 끊긴 자리를 빨간 점선으로
  await f.evaluate(() => { const z = getFloorZones(FLOORS[currentFloorIdx].code); z.push({ id: 'zone_island', name: '바닥 9', category: 'floor', geometry: 'polygon', points: [{ x: 10050, y: 4450 }, { x: 10400, y: 4450 }, { x: 10400, y: 4700 }, { x: 10050, y: 4700 }] }); saveFloorZones(FLOORS[currentFloorIdx].code, z); renderFloorZones(FLOORS[currentFloorIdx].code); });
  const I = await mkStore([{ x: 10200, y: 4500 }, { x: 10300, y: 4500 }, { x: 10300, y: 4580 }, { x: 10200, y: 4580 }], '섬매장');
  const gap = await f.evaluate(([i, u]) => { const st = id => currentStores.find(x => x.id === id); const r = routeBetweenStores(st(u), st(i)); startUtilityLineDrawingMode(); handleUtilLineMapClick(null, st(u)); handleUtilLineMapClick(null, st(i)); exitUtilityLineDrawingMode();
    const m = document.querySelector('#route-gap-mark line'); return { ok: r.ok, gap: r.gap, mark: !!m, n: getFloorUtilityLines(FLOORS[currentFloorIdx].code).length }; }, [I, U]);
  ok(!gap.ok && gap.mark && gap.n === 1, '10) 복도가 끊기면 선을 안 그리고 끊긴 자리를 빨간 점선으로 표시 ' + JSON.stringify({ ok: gap.ok, mark: gap.mark, n: gap.n }));
  ok(gap.gap && gap.gap[0].x < 9910 && gap.gap[1].x > 10040 && Math.abs(gap.gap[0].y - gap.gap[1].y) < 20, '10-1) 표시는 두 바닥 사이 틈 (' + JSON.stringify(gap.gap) + ')');

  ok(!p.errs.length, '11) 화면 오류 없음 ' + p.errs.join('|'));
  await shot(p, 'shot_map_shape.png');
  await b.close(); srv.close();
  console.log(fail ? `실패 ${fail}건` : '지도 도형 고치기 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
