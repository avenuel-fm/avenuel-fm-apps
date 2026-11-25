// 지도 복도 중심선 바닥 그리기 시험 (결정 260)
// 실행: node test/sb_map_centerline_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8139;
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

const zones = f => f.evaluate(() => getFloorZones('1F').filter(z => z.category === 'floor'));
const line = (f, pts) => f.evaluate(pts => { toggleAddZoneMode && 0; drawingZonePoints = pts; finishDrawingZone(); }, pts);
async function startMode(p, f, fl) {
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(150);
  await fl.locator('#btn-zone-cat-floor').click();
  await f.evaluate(() => { if (!floorCenterlineOn) toggleCenterlineFloor(); });
}
(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1280, height: 800 } });
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(150);
  ok(await f.evaluate(() => getComputedStyle(document.getElementById('floor-cl-controls')).display === 'none'), '1) 바닥을 고르기 전에는 중심선 줄이 안 보임');
  await fl.locator('#btn-zone-cat-floor').click();
  ok(await f.evaluate(() => getComputedStyle(document.getElementById('floor-cl-controls')).display !== 'none' && document.getElementById('input-floor-width-px').value === '80'), '2) 바닥을 고르면 중심선 버튼·폭(80)·프리셋이 보임');
  ok(await f.evaluate(() => floorCenterlineOn && document.getElementById('btn-centerline-floor').classList.contains('active')), '3) 바닥을 고르면 중심선 모드가 자동으로 켜짐');
  await f.evaluate(() => toggleCenterlineFloor());
  ok(await f.evaluate(() => !floorCenterlineOn), '3-0) 버튼을 누르면 꺼짐 (예전 점 찍기 방식)');
  await f.evaluate(() => toggleCenterlineFloor());
  const bh = await f.evaluate(() => document.getElementById('zone-guide-banner').getBoundingClientRect().height);
  const emo = await f.evaluate(() => /[\u{1F300}-\u{1FAFF}☀-➿⬜]/u.test(document.getElementById('zone-guide-banner').textContent));
  ok(bh < 70 && !emo, '3-1) 구역 그리기 줄이 한 줄(높이 ' + Math.round(bh) + 'px)이고 이모티콘 없음');
  // 직각 꺾임(ㄴ자): 한 덩어리, 꼭지점 6개
  await f.evaluate(() => { drawingZonePoints = [{ x: 9500, y: 4000 }, { x: 9800, y: 4000 }, { x: 9800, y: 4300 }]; finishDrawingZone(); });
  let z = await zones(f);
  ok(z.length === 1 && z[0].points.length === 6, '4) ㄱ자 중심선 → 도형 1개, 꼭지점 6개(꺾임 안쪽 홈 없음) — ' + z.length + '개/' + (z[0] && z[0].points.length) + '점');
  const ys = z[0].points.map(q => q.y), xs = z[0].points.map(q => q.x);
  ok(Math.min(...ys) === 3960 && Math.max(...xs) === 9840 && Math.min(...xs) === 9500, '5) 폭 80: 바깥 모서리가 뾰족하게 채워짐 (x ' + Math.min(...xs) + '~' + Math.max(...xs) + ', 위 ' + Math.min(...ys) + ')');
  // 같은 중심선을 겹쳐 또 그림 → 도형 1개 유지, 중심선 선분 늘지 않음
  const cl0 = z[0].cl.length;
  await startMode(p, f, fl);
  await f.evaluate(() => { drawingZonePoints = [{ x: 9500, y: 4000 }, { x: 9800, y: 4000 }]; finishDrawingZone(); });
  z = await zones(f);
  ok(z.length === 1 && z[0].cl.length === cl0, '6) 같은 자리에 다시 그려도 도형 1개 · 중심선 ' + cl0 + '개 그대로(겹친 중심선 하나로) — ' + z.length + '개/' + z[0].cl.length);
  // 대각선 교차
  await startMode(p, f, fl);
  await f.evaluate(() => { drawingZonePoints = [{ x: 9600, y: 3900 }, { x: 9900, y: 4200 }]; finishDrawingZone(); });
  z = await zones(f);
  ok(z.length === 1, '7) 대각선 중심선이 기존 바닥과 겹쳐 하나로 합쳐짐 — ' + z.length + '개');
  const diag = z[0].points.some(q => Math.abs(q.x - 9600 - 28.3) < 1.5 && Math.abs(q.y - 3900 + 28.3) < 1.5 || Math.abs(q.x - 9600 + 28.3) < 1.5);
  ok(diag, '8) 대각선 띠 모서리가 45도 방향으로 나옴');
  // 따로 떨어진 새 바닥은 합쳐지지 않음
  await startMode(p, f, fl);
  await f.evaluate(() => { drawingZonePoints = [{ x: 10500, y: 4700 }, { x: 10800, y: 4700 }]; finishDrawingZone(); });
  z = await zones(f);
  ok(z.length === 2, '9) 떨어진 곳에 그리면 별도 도형 (' + z.length + '개)');
  // 급한 꺾임(예각)도 오류·뾰족한 튀어나옴 없이
  await startMode(p, f, fl);
  await f.evaluate(() => { drawingZonePoints = [{ x: 10000, y: 5200 }, { x: 10400, y: 5200 }, { x: 10000, y: 5230 }]; finishDrawingZone(); });
  z = await zones(f);
  const sharp = z.find(q => q.points.some(pt => pt.y >= 5200 && pt.x < 10100));
  const far = sharp ? Math.max(...sharp.points.map(pt => pt.x - 10400)) : 9999;
  ok(!!sharp && far <= 40 * 2 + 1, '10) 예각 꺾임의 뾰족 끝이 반폭의 2배 이내로 깎임 (꺾임점에서 오른쪽으로 최대 ' + Math.round(far) + ')');
  // 자석: 기존 중심선 끝점 근처 → 끝점에 붙음
  await startMode(p, f, fl);
  const sn = await f.evaluate(() => fclSnap(9805, 4296));
  ok(sn && sn.x === 9800 && sn.y === 4300, '11) 기존 중심선 끝점 가까이 가면 자석처럼 붙음 ' + JSON.stringify(sn));
  // 45도 고정
  const o = await f.evaluate(() => { isShiftKeyPressed = true; const r = snapToOrtho({ x: 130, y: 90 }, { x: 0, y: 0 }); isShiftKeyPressed = false; return r; });
  ok(Math.abs(o.x - o.y) < 0.01 && Math.abs(o.x) > 100, '12) Shift: 대각선은 45도로 고정 ' + JSON.stringify(o));
  // 미리보기 띠
  await f.evaluate(() => { drawingZonePoints = [{ x: 9500, y: 4500 }]; updateZoneDrawingPreview(9700, 4500); });
  ok(await f.evaluate(() => document.querySelectorAll('#temp-zone-drawing-layer polygon').length) >= 1, '13) 마우스를 움직이면 반투명 띠 미리보기');
  // 직전 점 취소 (Backspace)
  await f.evaluate(() => { drawingZonePoints = [{ x: 1, y: 1 }, { x: 5, y: 5 }]; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); });
  ok(await f.evaluate(() => drawingZonePoints.length) === 1, '14) Backspace: 직전 점만 취소');
  // 잠금: 바닥 레이어가 잠기면 그려지지 않음
  const nBefore = (await zones(f)).length;
  await f.evaluate(() => { onLayerLockChange('floor', true); drawingZonePoints = [{ x: 9000, y: 3900 }, { x: 9100, y: 3900 }]; finishDrawingZone(); });
  ok((await zones(f)).length === nBefore, '15) 🔑 바닥 잠금이면 중심선으로도 안 그려짐');
  await shot(p, 'shot_map_centerline.png');
  ok(!p.errs.length, '16) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  if (fail) { console.log('\n실패 ' + fail + '건'); process.exit(1); }
  console.log('복도 중심선 바닥 시험 통과');
})();
