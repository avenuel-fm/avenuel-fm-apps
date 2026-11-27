// 지도 바닥 채우기 시험 (결정 334): 평행 넓힘 · 1~5px 틈 무시 · 변 끄기 · 계단 · 가로지름 거부 · 외벽 멈춤
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
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${room('a', '아그라', 9600, 4200)}${box('sa', '매장A', 9900, 4400, 10040, 4480)}${box('sb', '매장B', 10043, 4400, 10200, 4480)}${box('c1', '매장C1', 9900, 4600, 10050, 4660)}${box('c2', '매장C2', 10053, 4620, 10200, 4680)}${box('se', '매장E', 10800, 5180, 10900, 5280)}</g></svg>`;
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

  // 1) 평행: 위는 매장A·B(3px 틈 무시) 앞 20px, 아래는 가까운 C1 앞 20px
  await put([fl('zf1', R(9950, 4520, 10150, 4542))]);
  await f.evaluate(() => toggleFloorFill(true));
  const on = await f.evaluate(() => ({ on: ffOn, act: document.getElementById('btn-floor-fill').classList.contains('active'), step: document.getElementById('ff-step-wrap').style.display }));
  ok(on.on && on.act && on.step !== 'none', '1) 버튼 켬 → 켜짐 표시 · 「매장 따라 계단」 보임 ' + JSON.stringify(on));
  await click(10100, 4530);
  const pv = await f.evaluate(() => ({ edges: ffPrev && ffPrev.edges.map(e => [e.i, Math.round(e.runs[0].d * 10) / 10]), quads: document.querySelectorAll('#floor-fill-layer .ff-edge.on').length, pop: document.querySelector('#floor-fill-pop .wall-seg-title')?.textContent, pts: drawingZonePoints.length }));
  ok(pv.edges && pv.edges.length === 2 && pv.quads === 2 && /넓힐 변 2\/2/.test(pv.pop) && pv.pts === 0, '1-1) 누르면 미리 보기만 (위·아래 변 2개, 점 안 찍힘) ' + JSON.stringify(pv));
  await shot(p, 'shot_map_floor_fill.png');
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  let B = await bb('zf1');
  ok(B && near(B.y0, 4500) && near(B.y1, 4580) && near(B.x0, 9950) && near(B.x1, 10150), '1-2) 채우기 → 위 4500(매장A·B 앞 20) · 아래 4580(C1 앞 20) · 옆은 그대로 ' + JSON.stringify(B));
  await f.evaluate(() => handleUndo()); await p.waitForTimeout(400);
  await f.evaluate(() => { if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('floor'); toggleFloorFill(true); });
  B = await bb('zf1');
  ok(B && near(B.y0, 4520) && near(B.y1, 4542), '1-3) 되돌리기 → 원래대로 ' + JSON.stringify(B));

  // 2) 변 눌러 끄기: 위 변을 끄고 채우면 아래만
  await click(10100, 4530);
  await click(10100, 4510);
  const off = await f.evaluate(() => ({ off: ffPrev && ffPrev.edges.filter(e => !e.on).length, pop: document.querySelector('#floor-fill-pop .wall-seg-title')?.textContent }));
  ok(off.off === 1 && /넓힐 변 1\/2/.test(off.pop), '2) 주황 칸을 누르면 그 변만 꺼짐 ' + JSON.stringify(off));
  await f.evaluate(() => document.querySelector('#floor-fill-pop .ff-ok').click()); await p.waitForTimeout(200);
  B = await bb('zf1');
  ok(B && near(B.y0, 4520) && near(B.y1, 4580), '2-1) 위는 그대로 · 아래만 넓힘 ' + JSON.stringify(B));

  // 3) 매장 따라 계단: 오른쪽(C2 앞)은 4600 까지
  await put([fl('zf1', R(9950, 4520, 10150, 4542))]);
  await f.evaluate(() => { document.getElementById('chk-ff-step').checked = true; });
  await click(10100, 4530);
  await f.evaluate(() => ffApply()); await p.waitForTimeout(200);
  B = await bb('zf1');
  ok(B && near(B.y0, 4500) && near(B.y1, 4600) && B.pts.some(q => near(q[1], 4580) && q[0] < 10060), '3) 계단: 왼쪽 C1 앞 4580 · 오른쪽 C2 앞 4600 ' + JSON.stringify(B && B.pts));
  await f.evaluate(() => { document.getElementById('chk-ff-step').checked = false; });

  // 4) 매장을 가로지르는 바닥은 안 함
  await put([fl('zf2', R(9980, 4450, 10020, 4520))]);
  await click(10000, 4510);
  const t4 = await toast();
  ok(await f.evaluate(() => ffPrev === null) && /가로지르는 바닥은 채우지 않습니다/.test(t4), '4) 매장A를 가로지르는 바닥은 채우지 않음 ' + t4);

  // 5) 앞에 매장 없음 → 그대로 · 외벽이 먼저 → 외벽 안 5px 에서 멈춤
  await put([fl('zf3', R(10600, 5200, 10700, 5260)), { id: 'zw1', name: '외벽 1', category: 'wall', geometry: 'line', points: [{ x: 10760, y: 5100 }, { x: 10760, y: 5400 }] }]);
  await f.evaluate(() => focusStoreAt(10700, 5230)); await p.waitForTimeout(300);
  await click(10650, 5230);
  const e5 = await f.evaluate(() => ffPrev && ffPrev.edges.map(e => Math.round(e.runs[0].d * 10) / 10));
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

  await f.evaluate(() => { const s = currentStores.find(q => !q.isCustom && q.textElement && /매장E/.test(q.textElement.textContent)); fitOrigLabel(s.textElement, '유모차 대여소', s.polygonElement); focusStoreAt(10850, 5230); });
  await p.waitForTimeout(300); await shot(p, 'shot_map_label_wrap.png');

  ok(!p.errs.length, '7) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  console.log(fail ? `실패 ${fail}건` : '지도 바닥 채우기 시험 통과');
  process.exit(fail ? 1 : 0);
})();
