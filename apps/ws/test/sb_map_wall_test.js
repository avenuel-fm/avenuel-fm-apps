// 지도 외벽 경계 시험 (결정 316): 외벽 레이어 · 닫힘 검사(이어 닫기) · 외벽 안으로 자르기(바닥 5px) · 기능실 3px/겹치기
//   · 외벽 자석·테두리 따라가기(곡선) · 밖으로 나간 도형 맞추기 · 다른 층 복사 · 잠금
// 실행: node test/sb_map_wall_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8146;
const exp = Date.now() + 3600e3, TOK = 'S001.' + exp + '.boss';
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
// 곡선 매장: 오른쪽 위가 반지름 100 둥근 모서리 (가운데 10400,4300)
const CURVE = '<path id="c" d="M10200 4200 L10400 4200 A100 100 0 0 1 10500 4300 L10500 4500 L10200 4500 Z" fill="#dfe7f0" ds-x="10350" ds-y="4350" ds-width="300" ds-height="300"/><text x="10350" y="4350"><tspan>곡선</tspan></text>';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${room('a', '아그라', 9600, 4200)}${CURVE}</g></svg>`;
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
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor();
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
const maxX = z => Math.max(...z.points.map(q => q.x));
const W = [{ x: 9300, y: 3950 }, { x: 11200, y: 3950 }, { x: 11200, y: 5900 }, { x: 9300, y: 5900 }];   // 외벽 네모 (왼쪽 변은 처음엔 안 그림)

(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1280, height: 800 } });
  const box = await p.locator('iframe.mapframe').boundingBox();
  const scr = (x, y) => f.evaluate(([x, y]) => { const m = document.querySelector('#map-container svg').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]).then(q => ({ x: q.x + box.x, y: q.y + box.y }));
  await f.evaluate(() => { focusStoreAt(9700, 4250); }); await p.waitForTimeout(500);

  // 1) 레이어 메뉴: 도면 보조 레이어 맨 위에 외벽 (보이기 + 잠금)
  const lay = await f.evaluate(() => {
    const m = document.getElementById('symbol-filter-dropdown-menu'), kids = Array.from(m.children).map(e => e.textContent.trim());
    const hi = kids.findIndex(t => t === '도면 보조 레이어');
    const row = document.getElementById('chk-zone-filter-wall')?.closest('label');
    return { next: kids[hi + 1], info: kids[hi + 2], checked: document.getElementById('chk-zone-filter-wall')?.checked, lock: !!row?.querySelector('.chk-lock[data-lock="wall"]') };
  });
  ok(lay.next === '외벽' && /인포/.test(lay.info) && lay.checked && lay.lock, '1) 레이어 메뉴 「도면 보조 레이어」 맨 위에 외벽 (보이기 켬 · 잠금 칸) ' + JSON.stringify(lay));

  // 2) 외벽 생기기 전에 밖으로 나갈 도형들: 바닥 · 직접 그린 매장
  const outFloor = await zone(f, 'floor', [{ x: 11000, y: 5300 }, { x: 11300, y: 5300 }, { x: 11300, y: 5400 }, { x: 11000, y: 5400 }]);
  ok(maxX(outFloor) === 11300, '2) 외벽이 없으면 바닥은 그린 대로 ' + maxX(outFloor));
  const outStore = await drawStore(f, [{ x: 11050, y: 5500 }, { x: 11250, y: 5500 }, { x: 11250, y: 5600 }, { x: 11050, y: 5600 }]);
  await f.evaluate(() => { document.getElementById('edit-name').value = '밖매장'; saveStoreEdit(); });

  // 3) 외벽을 세 변만 그림 → 끊긴 곳 표시 · 경계로 안 씀
  await zone(f, 'wall', W);
  const open3 = await f.evaluate(() => ({ bar: document.getElementById('wall-check-bar')?.textContent || '', show: document.getElementById('wall-check-bar')?.style.display, mark: !!document.querySelector('#wall-gap-mark line'), area: !!wallArea(0), fill: document.querySelector('.user-drawn-wall')?.getAttribute('fill') }));
  ok(/닫히지 않았습니다/.test(open3.bar) && open3.show === 'flex' && open3.mark && !open3.area, '3) 안 닫힌 외벽: 끊긴 곳 빨간 점선 + 알림 줄, 경계로 안 씀 ' + JSON.stringify(open3));
  ok(open3.fill === 'none', '3-1) 외벽은 색을 칠하지 않음 (다른 레이어를 덮지 않음)');
  const notClipped = await zone(f, 'floor', [{ x: 11100, y: 5000 }, { x: 11300, y: 5000 }, { x: 11300, y: 5100 }, { x: 11100, y: 5100 }]);
  ok(maxX(notClipped) === 11300, '3-2) 외벽이 안 닫혔을 땐 바닥을 자르지 않음');
  await shot(p, 'shot_map_wall_gap.png');

  // 4) 「이어 닫기」 → 닫힘 → 밖으로 나간 도형 알림
  await fl.locator('#wall-check-bar .wall-bar-btn').click(); await p.waitForTimeout(150);
  const closed = await f.evaluate(() => { const c = wallChains(); return { rings: c.rings.length, open: c.open.length, bar: document.getElementById('wall-check-bar').textContent, flash: document.querySelectorAll('.wall-outside-flash').length }; });
  ok(closed.rings === 1 && closed.open === 0, '4) 이어 닫기 → 외벽이 한 바퀴 닫힘 ' + JSON.stringify(closed));
  ok(/밖으로 나간 도형 3개/.test(closed.bar) && closed.flash >= 3, '4-1) 밖으로 나간 바닥 2 · 매장 1 을 깜빡여 알림 ' + closed.bar);
  await shot(p, 'shot_map_wall_outside.png');
  await fl.locator('#wall-check-bar .wall-bar-btn').click(); await p.waitForTimeout(150);
  const fit = await f.evaluate(id => { const z = getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor'); return { fx: Math.max(...z.flatMap(q => q.points.map(p => p.x))), left: shapesOutsideWall().length, cs: getCustomStores(FLOORS[currentFloorIdx].code).find(c => c.name === '밖매장').pathData }; }, outStore);
  const sb = await bboxOf(f, outStore);
  ok(Math.abs(fit.fx - 11195) < 0.6 && fit.left === 0, '4-2) 「안쪽으로 맞추기」: 바닥은 외벽 안쪽 5px 까지 ' + JSON.stringify(fit));
  ok(Math.abs(sb.x1 - 11200) < 0.6 && /11200/.test(fit.cs), '4-3) 매장은 외벽선까지 (저장도 됨) ' + JSON.stringify(sb));

  // 5) 닫힌 외벽 밖으로 그리면 자름: 바닥 5px · 방화구역 면 · 제연구획 선 · 매장
  const fl5 = await zone(f, 'floor', [{ x: 10900, y: 4800 }, { x: 11400, y: 4800 }, { x: 11400, y: 4900 }, { x: 10900, y: 4900 }]);
  ok(Math.abs(maxX(fl5) - 11195) < 0.6, '5) 바닥이 외벽을 넘으면 외벽선 안쪽 5px 까지만 ' + maxX(fl5));
  const fire5 = await zone(f, 'fire', [{ x: 10900, y: 5600 }, { x: 11400, y: 5600 }, { x: 11400, y: 5700 }, { x: 10900, y: 5700 }]);
  ok(Math.abs(maxX(fire5) - 11200) < 0.6, '5-1) 방화구역 면은 외벽선까지 ' + maxX(fire5));
  const smoke5 = await zone(f, 'smoke', [{ x: 10900, y: 5750 }, { x: 11400, y: 5750 }]);
  ok(smoke5.points.length === 2 && Math.abs(maxX(smoke5) - 11200) < 0.6, '5-2) 제연구획 선은 외벽에서 멈춤 ' + JSON.stringify(smoke5.points));
  const st5 = await drawStore(f, [{ x: 11000, y: 4400 }, { x: 11400, y: 4400 }, { x: 11400, y: 4500 }, { x: 11000, y: 4500 }]);
  const sb5 = await bboxOf(f, st5);
  ok(Math.abs(sb5.x1 - 11200) < 0.6, '5-3) 매장도 외벽선까지 ' + JSON.stringify(sb5));
  await f.evaluate(() => cancelStoreEdit());
  await f.evaluate(() => onZoneCheckboxChange('wall', false));
  const hid = await zone(f, 'floor', [{ x: 10900, y: 4950 }, { x: 11400, y: 4950 }, { x: 11400, y: 4990 }, { x: 10900, y: 4990 }]);
  const hidDisp = await f.evaluate(() => getComputedStyle(document.querySelector('.safety-zone-item[data-zone-category="wall"]')).display);
  ok(hidDisp === 'none' && Math.abs(maxX(hid) - 11195) < 0.6, '5-4) 외벽 레이어를 숨겨도 경계 역할은 그대로 ' + hidDisp);
  await f.evaluate(() => onZoneCheckboxChange('wall', true));

  // 6) 외벽은 외벽을 고를 때만 눌림
  const pe = await f.evaluate(() => { setZoneCategory('floor'); const a = getComputedStyle(document.querySelector('.user-drawn-wall')).pointerEvents; setZoneCategory('wall'); const b = getComputedStyle(document.querySelector('.user-drawn-wall')).pointerEvents; return { a, b }; });
  ok(pe.a === 'none' && pe.b !== 'none', '6) 다른 종류를 그릴 땐 외벽이 눌리지 않음 ' + JSON.stringify(pe));

  // 7) 기능실 3px: 아그라(9450~9750 · 4100~4300) 오른쪽에 조금 떨어지게 그리면 → 기능실 탭에서 붙고 3px
  const R = await f.evaluate(() => SHAPE_SNAP_PX / scale);
  const gx = 9750 + Math.min(8, R * 0.6);
  const u7 = await drawStore(f, [{ x: gx, y: 4150 }, { x: 9850, y: 4150 }, { x: 9850, y: 4250 }, { x: gx, y: 4250 }]);
  const before = await bboxOf(f, u7);
  await fl.locator('#tab-type-utility').click(); await p.waitForTimeout(100);
  const asUtil = await bboxOf(f, u7);
  await fl.locator('#tab-type-store').click(); await p.waitForTimeout(100);
  const asStore = await bboxOf(f, u7);
  ok(Math.abs(before.x0 - gx) < 0.2 && Math.abs(asUtil.x0 - 9753) < 0.2 && Math.abs(asStore.x0 - gx) < 0.2, `7) 기능실 탭: 매장 옆이면 붙고 3px (${before.x0} → ${asUtil.x0}), 매장명 탭으로 돌리면 되돌림 (${asStore.x0})`);
  await fl.locator('#tab-type-utility').click();
  await f.evaluate(() => { document.getElementById('edit-name').value = 'EPS'; saveStoreEdit(); });
  const saved7 = await bboxOf(f, u7);
  ok(Math.abs(saved7.x0 - 9753) < 0.2, '7-1) 저장하면 3px 붙은 모양 그대로 ' + saved7.x0);
  await shot(p, 'shot_map_wall_util3.png');

  // 8) 기능실이 매장을 침범하면 그린 대로
  const u8 = await drawStore(f, [{ x: 9650, y: 4000 }, { x: 9700, y: 4000 }, { x: 9700, y: 4150 }, { x: 9650, y: 4150 }]);
  const cut8 = await bboxOf(f, u8);
  await fl.locator('#tab-type-utility').click(); await p.waitForTimeout(100);
  const ov8 = await bboxOf(f, u8);
  ok(cut8.y1 < 4100 && ov8.y1 === 4150, `8) 매장 규칙은 아그라 밖으로 자름(${cut8.y1}), 기능실 탭은 침범한 그대로(${ov8.y1})`);
  await f.evaluate(() => cancelStoreEdit());

  // 9) 외벽 자석 · 같은 도형 테두리 따라가기 (실제 클릭)
  await f.evaluate(() => { if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('wall'); drawingZonePoints = []; lastWallSnap = null; });
  const sn = await f.evaluate(() => wallSnap(9451, 4102));
  ok(sn && sn.x === 9450 && sn.y === 4100, '9) 외벽 그릴 때 매장 모서리에 붙음 ' + JSON.stringify(sn && { x: sn.x, y: sn.y }));
  let q = await scr(9600, 4101); await p.mouse.click(q.x, q.y); await p.waitForTimeout(80);
  q = await scr(9449, 4200); await p.mouse.click(q.x, q.y); await p.waitForTimeout(80);
  const tr = await f.evaluate(() => drawingZonePoints.map(p => [p.x, p.y]));
  ok(tr.length === 3 && tr[1][0] === 9450 && tr[1][1] === 4100 && tr[2][0] === 9450, '9-1) 같은 매장 테두리 위 두 점 → 모서리를 돌아 따라 그림 ' + JSON.stringify(tr));
  await f.evaluate(() => { drawingZonePoints = []; lastWallSnap = null; focusStoreAt(10350, 4350); }); await p.waitForTimeout(400);
  q = await scr(10300, 4200); await p.mouse.click(q.x, q.y); await p.waitForTimeout(80);
  q = await scr(10500, 4420); await p.mouse.click(q.x, q.y); await p.waitForTimeout(80);
  const cv = await f.evaluate(() => drawingZonePoints.map(p => [p.x, p.y]));
  const onArc = cv.slice(1, -1).filter(([x, y]) => x > 10400 && y < 4300 && Math.abs(Math.hypot(x - 10400, y - 4300) - 100) < 1.5).length;
  ok(onArc >= 3, `9-2) 곡선 모서리는 같은 곡률로 따라감 (호 위 점 ${onArc}개, 전체 ${cv.length})`);
  await shot(p, 'shot_map_wall_trace.png');
  await f.evaluate(() => { drawingZonePoints = []; lastWallSnap = null; focusStoreAt(9700, 4250); }); await p.waitForTimeout(400); await f.evaluate(() => { window.isShiftKeyPressed = true; });
  q = await scr(9600, 4101); await p.mouse.click(q.x, q.y); await p.waitForTimeout(80);
  const sh = await f.evaluate(() => { window.isShiftKeyPressed = false; const r = drawingZonePoints.map(p => [p.x, p.y]); drawingZonePoints = []; return r; });
  ok(sh.length === 1 && sh[0][1] !== 4100, '9-3) Shift 누르고 찍으면 자석 없이 곧게 ' + JSON.stringify(sh));

  // 10) 잠금 · 다른 층 복사
  const lk = await f.evaluate(() => { onLayerLockChange('wall', true); const z = getFloorZones(FLOORS[currentFloorIdx].code).find(z => z.category === 'wall'); selectAndEditWallZone(z); const r = !activeEditingWallZone; onLayerLockChange('wall', false); return r; });
  ok(lk, '10) 외벽 레이어를 잠그면 외벽 수정 안 됨');
  const cp = await f.evaluate(() => { openWallCopy(); const opt = document.querySelector('#wall-check-bar .wall-copy-opt input[value="2F"]'); opt.checked = true; copyWallToFloors(); copyWallToFloors.call(null); return { n: getFloorZones('2F').filter(z => z.category === 'wall').length, here: wallZonesOf(FLOORS[currentFloorIdx].code).length }; });
  ok(cp.n === cp.here && cp.n > 0, '10-1) 외벽을 다른 층(2F)에 복사 (두 번 눌러도 한 벌) ' + JSON.stringify(cp));
  const btnShown = await f.evaluate(() => { setZoneCategory('wall'); const a = getComputedStyle(document.getElementById('btn-wall-copy')).display; setZoneCategory('floor'); const b = getComputedStyle(document.getElementById('btn-wall-copy')).display; return { a, b }; });
  ok(btnShown.a !== 'none' && btnShown.b === 'none', '10-2) 「다른 층에 복사」 버튼은 외벽을 고를 때만 ' + JSON.stringify(btnShown));

  ok(!p.errs.length, '11) 화면 오류 없음 ' + p.errs.join(' | '));
  await b.close(); srv.close();
  console.log(fail ? `\n${fail}개 실패` : '\n지도 외벽 경계 시험 모두 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
