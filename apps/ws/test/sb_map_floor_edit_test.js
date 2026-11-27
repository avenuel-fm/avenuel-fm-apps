// 지도 바닥 고르기·고치기 시험 (결정 330): 호버 강조 · 선택 · 꼭짓점·변 옮기기 · 자석 · Shift · 꼭짓점 지우기 · 합치기 · 삭제
// 실행: node test/sb_map_floor_edit_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8148;
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

(async () => {
  const b = await chromium.launch();
  const [p, f] = await open(b, { viewport: { width: 1280, height: 800 } });
  const box = await p.locator('iframe.mapframe').boundingBox();
  const scr = (x, y) => f.evaluate(([x, y]) => { const m = document.querySelector('#map-container svg').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]).then(q => ({ x: q.x + box.x, y: q.y + box.y }));
  const move = async (x, y) => { const q = await scr(x, y); await p.mouse.move(q.x, q.y); await p.waitForTimeout(60); };
  const click = async (x, y) => { const q = await scr(x, y); await p.mouse.click(q.x, q.y); await p.waitForTimeout(120); };
  const drag = async (x0, y0, x1, y1) => { const a = await scr(x0, y0), c = await scr(x1, y1); await p.mouse.move(a.x, a.y); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(a.x + (c.x - a.x) * i / 6, a.y + (c.y - a.y) * i / 6); await p.mouse.up(); await p.waitForTimeout(150); };
  const zs = () => f.evaluate(() => getFloorZones(FLOORS[currentFloorIdx].code).filter(z => z.category === 'floor').map(z => ({ id: z.id, name: z.name, pts: z.points.map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]) })));
  const ptsOf = async id => ((await zs()).find(z => z.id === id) || {}).pts;
  const toast = () => f.evaluate(() => ({ msg: document.getElementById('toast').textContent, btn: document.querySelector('#toast .toast-btn')?.textContent }));
  const R = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const put = zones => f.evaluate(zones => { const c = FLOORS[currentFloorIdx].code, z = getFloorZones(c).filter(q => q.category !== 'floor').concat(zones); saveFloorZones(c, z); renderFloorZones(c); }, zones);
  const fl = (id, pts) => ({ id, name: '바닥 ' + id.slice(2), category: 'floor', geometry: 'polygon', points: pts });
  await f.evaluate(() => { focusStoreAt(9950, 4600); if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('floor'); if (floorCenterlineOn) toggleCenterlineFloor(); });
  await put([fl('zf1', R(9850, 4500, 10050, 4580)), fl('zf2', R(9850, 4620, 10050, 4680))]);
  await p.waitForTimeout(500);

  // 1) 마우스를 올리면 그 바닥만 강조 + 이름
  await move(9950, 4540);
  const hv = await f.evaluate(() => ({ hover: feHover, poly: document.querySelectorAll('#floor-edit-layer .fe-hover').length, name: document.querySelector('#floor-edit-layer text')?.textContent }));
  ok(hv.hover === 'zf1' && hv.poly === 1 && hv.name === '바닥 1', '1) 바닥에 마우스를 올리면 강조 · 이름 ' + JSON.stringify(hv));
  await move(9950, 4600);
  ok(await f.evaluate(() => feHover === null && !document.querySelector('#floor-edit-layer .fe-hover')), '1-1) 바닥 밖으로 나가면 강조 사라짐');

  // 2) 누르면 선택 · 손잡이 · 편집창 (점은 안 찍힘)
  await click(9950, 4540);
  const sl = await f.evaluate(() => ({ sel: feSel, v: document.querySelectorAll('#floor-edit-layer .fe-vtx').length, m: document.querySelectorAll('#floor-edit-layer .fe-mid').length, pop: document.querySelector('#floor-sel-pop .wall-seg-title')?.textContent, pts: drawingZonePoints.length }));
  ok(sl.sel === 'zf1' && sl.v === 4 && sl.m === 4 && /바닥 1 · 꼭짓점 4개/.test(sl.pop) && sl.pts === 0, '2) 누르면 선택 · 꼭짓점 4 · 변 가운데 점 4 · 편집창 · 새 점 안 찍힘 ' + JSON.stringify(sl));
  await shot(p, 'shot_map_floor_edit.png');

  // 3) 꼭짓점 끌기 → 넓어짐 · 되돌리기
  await drag(10050, 4580, 10090, 4590);
  let P = await ptsOf('zf1');
  ok(P && P.length === 4 && P.some(q => Math.abs(q[0] - 10090) < 1.5 && Math.abs(q[1] - 4590) < 1.5), '3) 꼭짓점을 끌면 그 자리로 · 넓어짐 ' + JSON.stringify(P));
  await f.evaluate(() => handleUndo()); await p.waitForTimeout(400);
  await f.evaluate(() => { if (!isZoneDrawingMode) toggleAddZoneMode(); setZoneCategory('floor'); });
  ok(JSON.stringify(await ptsOf('zf1')) === JSON.stringify([[9850, 4500], [10050, 4500], [10050, 4580], [9850, 4580]]), '3-1) 되돌리기로 원래 모양 ' + JSON.stringify(await ptsOf('zf1')));
  await click(9950, 4540);

  // 4) 변 끌기 → 평행 이동 (두 꼭짓점 함께, 직각 그대로)
  await drag(9850, 4520, 9810, 4530);
  P = await ptsOf('zf1');
  ok(P && P.filter(q => Math.abs(q[0] - 9810) < 1.5).length === 2 && P.every(q => Math.abs(q[1] - 4500) < 0.2 || Math.abs(q[1] - 4580) < 0.2), '4) 변을 끌면 평행하게 밀림 (위아래는 그대로) ' + JSON.stringify(P));

  // 5) 변 가운데 점 끌기 → 새 꼭짓점
  P = await ptsOf('zf1');
  const top = P.filter(q => Math.abs(q[1] - 4500) < 0.2).map(q => q[0]), mx = (top[0] + top[1]) / 2;
  await drag(mx, 4500, mx, 4470);
  P = await ptsOf('zf1');
  ok(P && P.length === 5 && P.some(q => Math.abs(q[0] - mx) < 1.5 && Math.abs(q[1] - 4470) < 1.5), '5) 변 가운데 점을 끌면 새 꼭짓점 ' + JSON.stringify(P));

  // 6) 꼭짓점 두 번 누르면 지움
  const d6 = await scr(mx, 4470); await p.mouse.dblclick(d6.x, d6.y); await p.waitForTimeout(250);
  P = await ptsOf('zf1');
  ok(P && P.length === 4 && !P.some(q => Math.abs(q[1] - 4470) < 1.5), '6) 꼭짓점을 두 번 누르면 지움 ' + JSON.stringify(P) + JSON.stringify(await f.evaluate(() => ({ sel: feSel, pick: !!fePick, log: window.__fe }))));

  // 7) 눌러 고른 뒤 클릭해 놓기 · Shift 는 가로/세로만
  await click(10050, 4500); await click(10070, 4495);
  P = await ptsOf('zf1');
  ok(P && P.some(q => Math.abs(q[0] - 10070) < 1.5 && Math.abs(q[1] - 4495) < 1.5), '7) 꼭짓점을 눌러 고르고 놓을 곳을 클릭 ' + JSON.stringify(P));
  const c7 = P.find(q => Math.abs(q[0] - 10070) < 1.5);
  await p.keyboard.down('Shift'); await drag(c7[0], c7[1], c7[0] + 20, c7[1] - 6); await p.keyboard.up('Shift');
  P = await ptsOf('zf1');
  ok(P && P.some(q => Math.abs(q[0] - c7[0] - 20) < 1.5 && Math.abs(q[1] - c7[1]) < 0.2), '7-1) Shift 를 누르고 끌면 가로/세로로만 ' + JSON.stringify(P));

  // 8) 자석: 옆 바닥(바닥 2) 모서리 가까이 놓으면 붙음 · 모서리만 닿으면 합치기 안 물음
  const k = await f.evaluate(() => scale);
  await drag(10050, 4580, 10050 + 4 / k, 4620 + 4 / k);
  P = await ptsOf('zf1');
  const t8 = await toast();
  ok(P && P.some(q => q[0] === 10050 && q[1] === 4620), '8) 옆 바닥 모서리 가까이 놓으면 그 모서리에 붙음 ' + JSON.stringify(P));
  ok(t8.btn === undefined, '8-1) 모서리만 닿으면 합치기 안 물음 ' + JSON.stringify(t8));

  // 9) 넓혀 겹치면 「옆 바닥과 합치기」 → 한 장
  const c9 = P.find(q => q[1] === 4580 && q[0] < 9900);
  await drag(c9[0], c9[1], c9[0], 4650);
  const t9 = await toast();
  ok(t9.btn === '옆 바닥과 합치기' && /바닥 2와 겹칩니다/.test(t9.msg), '9) 넓혀서 옆 바닥과 겹치면 「옆 바닥과 합치기」 ' + JSON.stringify(t9));
  await f.evaluate(() => document.querySelector('#toast .toast-btn').click()); await p.waitForTimeout(200);
  const mg = await zs();
  ok(mg.length === 1 && mg[0].id === 'zf1', '9-1) 누르면 두 바닥이 한 장 ' + JSON.stringify(mg.map(z => z.id)) + JSON.stringify(await toast()));

  // 10) 매장(아그라 9450~9750 · 4100~4300) 변만 덮게 넓히면 2px 밖 + 「매장 위로 그대로」
  await put([fl('zf3', R(9500, 4350, 9700, 4400))]);
  await f.evaluate(() => { focusStoreAt(9600, 4320); feSel = null; feRender(); }); await p.waitForTimeout(400);
  await click(9600, 4380);
  await drag(9560, 4350, 9560, 4250);
  const t10 = await f.evaluate(() => ({ msg: document.getElementById('toast').textContent, btn: document.querySelector('#toast .toast-btn')?.textContent, top: Math.min(...getFloorZones(FLOORS[currentFloorIdx].code).find(z => z.id === 'zf3').points.map(q => q.y)) }));
  ok(/아그라 자리는 비웠습니다/.test(t10.msg) && t10.btn === '매장 위로 그대로' && Math.abs(t10.top - 4302) < 0.2, '10) 매장 변만 덮으면 2px 밖으로 + 「매장 위로 그대로」 ' + JSON.stringify(t10));
  await f.evaluate(() => document.querySelector('#toast .toast-btn').click()); await p.waitForTimeout(200);
  const top2 = await f.evaluate(() => Math.min(...getFloorZones(FLOORS[currentFloorIdx].code).find(z => z.id === 'zf3').points.map(q => q.y)));
  ok(Math.abs(top2 - 4250) < 0.2, '10-1) 누르면 매장 위로 그대로 ' + top2 + JSON.stringify(await toast()));

  // 11) Esc 로 선택 풀기 · Del 로 삭제 · Shift+클릭은 새 점 · 저장본에 안 남음 · 끝내면 사라짐
  await click(9600, 4380);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  const esc = await f.evaluate(() => ({ sel: feSel, pop: !!document.getElementById('floor-sel-pop'), mode: isZoneDrawingMode }));
  ok(esc.sel === null && !esc.pop && esc.mode, '11) Esc → 선택만 풀림 (그리기 상태 그대로) ' + JSON.stringify(esc));
  await click(9600, 4380); await p.keyboard.press('Delete'); await p.waitForTimeout(150);
  ok(!(await zs()).some(z => z.id === 'zf3'), '11-1) Del → 고른 바닥 삭제');
  await put([fl('zf4', R(9500, 4350, 9700, 4400))]);
  const q11 = await scr(9600, 4380); await p.keyboard.down('Shift'); await p.mouse.click(q11.x, q11.y); await p.keyboard.up('Shift'); await p.waitForTimeout(120);
  const sh = await f.evaluate(() => ({ sel: feSel, pts: drawingZonePoints.length }));
  ok(sh.sel === null && sh.pts === 1, '11-2) Shift+클릭은 바닥 안이어도 새 바닥 첫 점 ' + JSON.stringify(sh));
  const cache = await f.evaluate(() => { drawingZonePoints = []; feSel = 'zf4'; feRender(); syncSvgCache(); return svgCache.get(FLOORS[currentFloorIdx].code).includes('floor-edit-layer'); });
  ok(!cache, '11-3) 고르기 표시는 지도 저장본에 안 남음');
  await f.evaluate(() => exitAddZoneMode());
  ok(await f.evaluate(() => !document.getElementById('floor-edit-layer') && feSel === null), '11-4) 구역 그리기를 끝내면 고르기 표시도 사라짐');

  ok(!p.errs.length, '12) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  console.log(fail ? `실패 ${fail}건` : '지도 바닥 고르기·고치기 시험 통과');
  process.exit(fail ? 1 : 0);
})();
