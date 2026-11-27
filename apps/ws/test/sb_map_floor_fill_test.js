// 지도 바닥 채우기 시험 (결정 334·348): 매장 모양 따라(사선) · 1~5px 틈 무시 · 변 끄기 · 간격 칸 · 여러 바닥 · 가로지름 거부 · 외벽 멈춤
// 실행: node test/sb_map_floor_fill_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8149;
const exp = Date.now() + 3600e3, TOK = 'S001.' + exp + '.boss';
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
const box = (id, name, x0, y0, x1, y1) => `<path id="${id}" d="M${x0} ${y0}H${x1}V${y1}H${x0}z" fill="#dfe7f0" ds-x="${(x0 + x1) / 2}" ds-y="${(y0 + y1) / 2}" ds-width="${x1 - x0}" ds-height="${y1 - y0}"/><text x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2}"><tspan>${name}</tspan></text>`;
// 위: 매장A·B 사이 3px 틈 · 아래: C1·C2 앞선이 20px 들쭉날쭉(사이 3px 틈) · 오른쪽 아래: 외벽(x=10760) 너머 매장E
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${room('a', '아그라', 9600, 4200)}${box('sa', '매장A', 9900, 4400, 10040, 4480)}${box('sb', '매장B', 10043, 4400, 10200, 4480)}${box('c1', '매장C1', 9900, 4600, 10050, 4660)}${box('c2', '매장C2', 10053, 4620, 10200, 4680)}${box('se', '매장E', 10800, 5180, 10900, 5280)}<path id="sd" d="M10400 4750H10550V4950H10320z" fill="#dfe7f0" ds-x="10450" ds-y="4850" ds-width="230" ds-height="200"/><text x="10460" y="4850"><tspan>매장D</tspan></text></g></svg>`;
const KV = {};
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
  return [p, f];
}

(async () => {
  const b = await chromium.launch();
  const [p, f] = await open(b, { viewport: { width: 1280, height: 800 } });
  const fb = await p.locator('iframe.mapframe').boundingBox();
  const scr = (x, y) => f.evaluate(([x, y]) => { const m = document.querySelector('#map-container svg').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]).then(q => ({ x: q.x + fb.x, y: q.y + fb.y }));
  const click = async (x, y) => { const q = await scr(x, y); await p.mouse.click(q.x, q.y); await p.waitForTimeout(150); };
  const R = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const fl = (id, pts) => ({ id, name: '바닥 ' + id.slice(2), category: 'floor', geometry: 'polygon', points: pts });
  const put = zones => f.evaluate(zones => { const c = FLOORS[currentFloorIdx].code, z = getFloorZones(c).filter(q => q.category !== 'floor' && q.category !== 'wall').concat(zones); saveFloorZones(c, z); renderFloorZones(c); }, zones);
  const bb = id => f.evaluate(id => { const z = getFloorZones(FLOORS[currentFloorIdx].code).find(q => q.id === id); if (!z) return null; const xs = z.points.map(q => q.x), ys = z.points.map(q => q.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), pts: z.points.map(q => [q.x, q.y]) }; }, id);
  const near = (a, c) => Math.abs(a - c) < 0.6;
  const toast = () => f.evaluate(() => document.getElementById('toast').textContent);
  await f.evaluate(() => { focusStoreAt(10050, 4540); if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('floor'); if (floorCenterlineOn) toggleCenterlineFloor(); });
  await p.waitForTimeout(400);

  // 0) 아래 줄: 주동선·일반·후방 없음, 「바닥 채우기」 있음
  const ui = await f.evaluate(() => ({ chips: [...document.querySelectorAll('button, label')].filter(e => e.offsetParent && /^(주동선|일반|후방)$/.test(e.textContent.trim())).length, btn: !!document.getElementById('btn-floor-fill')?.offsetParent }));
  ok(ui.chips === 0 && ui.btn, '0) 주동선·일반·후방 없음 · 「바닥 채우기」 버튼 ' + JSON.stringify(ui));

  // 1) 매장 모양 따라: 위는 매장A·B(3px 틈 무시) 앞 20px, 아래는 왼쪽 C1 앞 4580 · 오른쪽 C2 앞 4600
  await put([fl('zf1', R(9950, 4520, 10150, 4542))]);
  await f.evaluate(() => { try { localStorage.removeItem('map_ff_gap'); } catch (e) {} document.getElementById('ff-gap').value = '20'; toggleFloorFill(true); });
  const on = await f.evaluate(() => ({ on: ffOn, act: document.getElementById('btn-floor-fill').classList.contains('active'), gap: document.getElementById('ff-gap-wrap').style.display, step: !!document.getElementById('chk-ff-step') }));
  ok(on.on && on.act && on.gap !== 'none' && !on.step, '1) 버튼 켬 → 켜짐 표시 · 「매장 간격」 칸 보임 · 계단 체크 없음 ' + JSON.stringify(on));
  await click(10100, 4530);
  const pv = await f.evaluate(() => ({ edges: ffPrev && ffPrev.items[0].edges.map(e => [e.i, Math.round(e.dmax * 10) / 10]), quads: document.querySelectorAll('#floor-fill-layer .ff-edge.on').length, pop: document.querySelector('#floor-fill-pop .wall-seg-title')?.textContent, pts: drawingZonePoints.length }));
  ok(pv.edges && pv.edges.length === 2 && pv.quads === 2 && /넓힐 변 2\/2/.test(pv.pop) && pv.pts === 0, '1-1) 누르면 미리 보기만 (위·아래 변 2개, 점 안 찍힘) ' + JSON.stringify(pv));
  await shot(p, 'shot_map_floor_fill.png');
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  let B = await bb('zf1');
  ok(B && near(B.y0, 4500) && near(B.y1, 4600) && near(B.x0, 9950) && near(B.x1, 10150) && B.pts.some(q => near(q[1], 4580) && q[0] < 10060) && B.pts.length <= 8, '1-2) 채우기 → 위 4500 · 아래 왼쪽 4580(C1) · 오른쪽 4600(C2) · 옆은 그대로 ' + JSON.stringify(B && B.pts));
  await f.evaluate(() => handleUndo()); await p.waitForTimeout(400);
  await f.evaluate(() => { if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('floor'); toggleFloorFill(true); });
  B = await bb('zf1');
  ok(B && near(B.y0, 4520) && near(B.y1, 4542), '1-3) 되돌리기 → 원래대로 ' + JSON.stringify(B));

  // 2) 변 눌러 끄기: 위 변을 끄고 채우면 아래만
  await click(10100, 4530);
  await click(10100, 4510);
  const off = await f.evaluate(() => ({ off: ffPrev && ffPrev.items[0].edges.filter(e => !e.on).length, pop: document.querySelector('#floor-fill-pop .wall-seg-title')?.textContent }));
  ok(off.off === 1 && /넓힐 변 1\/2/.test(off.pop), '2) 주황 칸을 누르면 그 변만 꺼짐 ' + JSON.stringify(off));
  await f.evaluate(() => document.querySelector('#floor-fill-pop .ff-ok').click()); await p.waitForTimeout(200);
  B = await bb('zf1');
  ok(B && near(B.y0, 4520) && near(B.y1, 4600), '2-1) 위는 그대로 · 아래만 넓힘 ' + JSON.stringify(B));

  // 3) 매장 간격 30 → 바로 다시 계산 · 이 기기에 기억
  await put([fl('zf1', R(9950, 4520, 10150, 4542))]);
  await click(10100, 4530);
  await f.evaluate(() => { const i = document.getElementById('ff-gap'); i.value = '30'; i.dispatchEvent(new Event('change')); });
  const g3 = await f.evaluate(() => ({ top: ffPrev && ffPrev.items[0].edges.find(e => e.n.y < 0).dmax, saved: localStorage.getItem('map_ff_gap') }));
  ok(g3.top !== undefined && near(g3.top, 10) && g3.saved === '30', '3) 간격 30 으로 바꾸면 미리 보기가 바로 다시 (위 10px) · 기억 ' + JSON.stringify(g3));
  await f.evaluate(() => { ffCancel(); const i = document.getElementById('ff-gap'); i.value = '20'; i.dispatchEvent(new Event('change')); });

  // 3-1) 사선 매장(매장D) 앞은 사선으로 · 계단 없음 · 간격 20
  await put([fl('zf5', R(10200, 4740, 10240, 4960))]);
  await f.evaluate(() => focusStoreAt(10300, 4850)); await p.waitForTimeout(300);
  await click(10220, 4850);
  await f.evaluate(() => ffApply()); await p.waitForTimeout(200);
  const d3 = await f.evaluate(() => { const z = getFloorZones(FLOORS[currentFloorIdx].code).find(q => q.id === 'zf5'); const ins = x => isPointInsidePolygon({ x, y: 4850 }, z.points); return { n: z.points.length, in: ins(10337.8), out: ins(10339.2), pts: z.points.map(q => [q.x, q.y]) }; });
  ok(d3.in && !d3.out && d3.n <= 14, '3-1) 사선 매장 앞은 사선 그대로 20px 띄움 (계단 없음, 꼭짓점 ' + d3.n + '개) ' + JSON.stringify(d3.pts));
  await shot(p, 'shot_map_floor_fill_diag.png');

  // 3-2) Shift+클릭으로 여러 바닥 함께 → 겹치면 「겹친 바닥 2개 합치기」 → 한 장
  await put([fl('zf1', R(9950, 4520, 10150, 4542)), fl('zf6', R(9950, 4552, 10150, 4570))]);
  await f.evaluate(() => focusStoreAt(10050, 4540)); await p.waitForTimeout(300);
  await click(10100, 4530);
  const q6 = await scr(10100, 4560); await p.keyboard.down('Shift'); await p.mouse.click(q6.x, q6.y); await p.keyboard.up('Shift'); await p.waitForTimeout(150);
  const m3 = await f.evaluate(() => ({ n: ffPrev && ffPrev.items.length, pop: document.querySelector('#floor-fill-pop .wall-seg-title')?.textContent }));
  ok(m3.n === 2 && /바닥 2개/.test(m3.pop), '3-2) Shift+클릭 → 바닥 2개 함께 미리 보기 ' + JSON.stringify(m3));
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const t32 = await f.evaluate(() => ({ msg: document.getElementById('toast').textContent, btn: document.querySelector('#toast .toast-btn')?.textContent }));
  ok(/바닥 2개를 채웠습니다/.test(t32.msg) && t32.btn === '겹친 바닥 2개 합치기', '3-3) 한 번에 채움 · 「겹친 바닥 2개 합치기」 ' + JSON.stringify(t32));
  await f.evaluate(() => document.querySelector('#toast .toast-btn').click()); await p.waitForTimeout(200);
  const m4 = await f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor').map(z => z.id));
  ok(m4.length === 1, '3-4) 누르면 한 장 ' + JSON.stringify(m4));

  // 4) 매장을 가로지르는 바닥은 안 함
  await put([fl('zf2', R(9980, 4450, 10020, 4520))]);
  await click(10000, 4510);
  const t4 = await toast();
  ok(await f.evaluate(() => ffPrev === null) && /가로지르는 바닥은 채우지 않습니다/.test(t4), '4) 매장A를 가로지르는 바닥은 채우지 않음 ' + t4);

  // 5) 앞에 매장 없음 → 그대로 · 외벽이 먼저 → 외벽 안 5px 에서 멈춤
  await put([fl('zf3', R(10600, 5200, 10700, 5260)), { id: 'zw1', name: '외벽 1', category: 'wall', geometry: 'line', points: [{ x: 10760, y: 5100 }, { x: 10760, y: 5400 }] }]);
  await f.evaluate(() => focusStoreAt(10700, 5230)); await p.waitForTimeout(300);
  await click(10650, 5230);
  const e5 = await f.evaluate(() => ffPrev && ffPrev.items[0].edges.map(e => Math.round(e.dmax * 10) / 10));
  ok(e5 && e5.length === 1 && near(e5[0], 55), '5) 매장E 쪽 변만 · 외벽(x=10760) 안 5px 까지 (55) ' + JSON.stringify(e5));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(await f.evaluate(() => ffPrev === null && ffOn), '5-1) Esc → 미리 보기만 취소');

  // 6) 저장본에 안 남음 · Esc 두 번째 → 끔 · 구역 그리기 끝내면 꺼짐
  await click(10650, 5230);
  ok(!(await f.evaluate(() => { syncSvgCache(); return svgCache.get(FLOORS[currentFloorIdx].code).includes('floor-fill-layer'); })), '6) 미리 보기는 지도 저장본에 안 남음');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(await f.evaluate(() => !ffOn && !document.getElementById('btn-floor-fill').classList.contains('active') && !document.getElementById('floor-fill-layer')), '6-1) Esc 한 번 더 → 바닥 채우기 끔');
  await f.evaluate(() => { toggleFloorFill(true); exitAddZoneMode(); });
  ok(await f.evaluate(() => !ffOn), '6-2) 구역 그리기를 끝내면 바닥 채우기도 꺼짐');

  // 8) 업체 도면 매장 이름이 도형(매장E 폭 100)을 넘치면 줄 나눔 · 짧으면 원래대로 (결정 338)
  const lb = await f.evaluate(() => {
    const s = currentStores.find(q => !q.isCustom && q.textElement && /매장E/.test(q.textElement.textContent));
    if (!s) return null;
    const t = s.textElement, before = { x: t.querySelector('tspan').getAttribute('x'), anchor: t.getAttribute('text-anchor') };
    fitOrigLabel(t, '유모차 대여소', s.polygonElement);
    const pb = s.polygonElement.getBBox(), tb = t.getBBox();
    const long = { lines: [...t.querySelectorAll('tspan')].map(x => x.textContent), name: t.dataset.lblName, inside: tb.x >= pb.x - 0.5 && tb.x + tb.width <= pb.x + pb.width + 0.5, cx: Math.round(tb.x + tb.width / 2) };
    fitOrigLabel(t, '매장E', s.polygonElement);
    const back = { lines: [...t.querySelectorAll('tspan')].map(x => x.textContent), x: t.querySelector('tspan').getAttribute('x'), anchor: t.getAttribute('text-anchor'), name: t.dataset.lblName };
    return { long, back, before };
  });
  ok(lb && JSON.stringify(lb.long.lines) === '["유모차","대여소"]' && lb.long.name === '유모차 대여소' && lb.long.inside && Math.abs(lb.long.cx - 10850) <= 2, '8) 넘치는 매장 이름은 「유모차 / 대여소」 두 줄 · 도형 안 가운데 ' + JSON.stringify(lb && lb.long));
  ok(lb && JSON.stringify(lb.back.lines) === '["매장E"]' && lb.back.x === lb.before.x && lb.back.anchor === lb.before.anchor && !lb.back.name, '8-1) 짧은 이름으로 바꾸면 도면 원래 자리·한 줄 ' + JSON.stringify(lb && lb.back));

  // 9) 잠긴 외벽: 점 안 찍힘 · 취소/Esc/완료는 점만 지움(먹통 없음) · 그리던 중 종류 바꾸면 점 지움 (결정 346)
  await f.evaluate(() => { focusStoreAt(10350, 4300); onLayerLockChange('wall', true); if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('wall'); });
  await p.waitForTimeout(1700);
  await click(10300, 4300);
  const l9 = await f.evaluate(() => ({ pts: drawingZonePoints.length, toast: document.getElementById('toast').textContent }));
  ok(l9.pts === 0 && /잠긴 레이어/.test(l9.toast), '9) 잠긴 외벽은 점부터 안 찍힘 ' + JSON.stringify(l9));
  const nWall = () => f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'wall').length);
  const w0 = await nWall();
  const l91 = await f.evaluate(() => { drawingZonePoints = [{ x: 10300, y: 4300 }, { x: 10400, y: 4300 }]; handleZoneCancelOrEsc(); const a = drawingZonePoints.length; drawingZonePoints = [{ x: 10300, y: 4300 }, { x: 10400, y: 4300 }]; finishDrawingZone(); return { esc: a, done: drawingZonePoints.length, mode: isZoneDrawingMode }; });
  ok(l91.esc === 0 && l91.done === 0 && l91.mode && (await nWall()) === w0, '9-1) 잠긴 채 취소·Esc·완료 → 찍던 점만 지움 (그리기 상태 그대로) ' + JSON.stringify(l91));
  await f.evaluate(() => onLayerLockChange('wall', false));
  await click(10300, 4300); await click(10400, 4300);
  const l92 = await f.evaluate(() => { const before = drawingZonePoints.length; setZoneCategory('fire'); return { before, after: drawingZonePoints.length, toast: document.getElementById('toast').textContent }; });
  ok(l92.before === 2 && l92.after === 0 && /그리던 선은 지웠습니다/.test(l92.toast) && (await nWall()) === w0, '9-2) 외벽 그리던 중 방화구역을 누르면 점 지움 (방화구역으로 안 바뀜) ' + JSON.stringify(l92));
  await f.evaluate(() => exitAddZoneMode());

  await f.evaluate(() => { const s = currentStores.find(q => !q.isCustom && q.textElement && /매장E/.test(q.textElement.textContent)); fitOrigLabel(s.textElement, '유모차 대여소', s.polygonElement); focusStoreAt(10850, 5230); });
  await p.waitForTimeout(300); await shot(p, 'shot_map_label_wrap.png');

  ok(!p.errs.length, '7) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  console.log(fail ? `실패 ${fail}건` : '지도 바닥 채우기 시험 통과');
  process.exit(fail ? 1 : 0);
})();
