// 지도 바닥 · 지우개 · 직각 체크박스 시험 (결정 216)
// 삭제한 매장 자리 흰 바닥이 새 매장 위를 덮던 것 · 구역 그리기에 「바닥」 · 「지우개」 · 직각 체크박스 · 레이어 메뉴 바닥 · 휴대폰 줄바꿈
// 실행: node test/sb_map_floor_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8136;
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

  // ── 1) 새 매장이 흰 바닥 위 ──
  await f.evaluate(() => { drawingPoints = [{ x: 10300, y: 5100 }, { x: 10420, y: 5100 }, { x: 10420, y: 5250 }, { x: 10300, y: 5250 }]; finishDrawingPolygon(); closeAllPopovers(); });
  await p.waitForTimeout(300);
  const lay = await f.evaluate(() => ({ vac: document.querySelectorAll('#floor-layer #floor-vacant path.vacant-floor-polygon').length, rootVac: document.querySelectorAll('#map-container > svg > path.vacant-floor-polygon').length, vendor: document.querySelectorAll('#vendor-stores-layer g.store-group').length, custom: document.querySelectorAll('#custom-stores-top-layer g.store-group').length }));
  ok(lay.vac === 1 && lay.rootVac === 0 && lay.vendor >= 1 && lay.custom === 1, '1) 삭제한 매장 자리의 흰 바닥은 「바닥」 층에 · 업체 매장은 매장 층으로 (' + JSON.stringify(lay) + ')');
  ok(await before(f, '#floor-layer', '#vendor-stores-layer') && await before(f, '#vendor-stores-layer', '#custom-stores-top-layer') && await before(f, '#custom-stores-top-layer', '#safety-zones-layer'), '2) 겹침 순서: 바닥 < 업체 매장 < 직접 그린 매장 < 구역');
  const sc = await pixel(f, 10320, 5240);
  ok(near(sc, [230, 240, 252, 255]), '3) 흰 바닥 자리에 새로 그린 매장이 그대로 보임 (바닥에 덮이지 않음) ' + sc.join(','));

  // ── 2) 구역 그리기 줄: 바닥 · 지우개 · 직각 체크 ──
  await f.evaluate(() => toggleAddZoneMode());
  await p.waitForTimeout(200);
  ok(await f.evaluate(() => ['btn-zone-cat-floor', 'btn-zone-eraser', 'chk-zone-ortho'].every(id => { const e = document.getElementById(id); return e && e.getClientRects().length > 0; })), '4) 구역 그리기 줄에 「바닥」 · 「지우개」 · 직각 체크박스');
  ok(await f.evaluate(() => { const o = document.getElementById('chk-zone-ortho'), er = document.getElementById('btn-zone-eraser'), ro = o.getBoundingClientRect(), re = er.getBoundingClientRect(); return o.type === 'checkbox' && re.right <= ro.left + 1; }), '5) 지우개는 직각 왼쪽 · 직각은 체크박스');
  await fl.locator('#btn-zone-cat-floor').click();
  const st = await f.evaluate(() => ({ cat: currentZoneCategory, geom: currentZoneGeometry, lineOff: document.getElementById('btn-zone-geom-line').disabled, polyOn: document.getElementById('btn-zone-geom-polygon').classList.contains('active'), act: document.getElementById('btn-zone-cat-floor').classList.contains('active') }));
  ok(st.cat === 'floor' && st.geom === 'polygon' && st.lineOff && st.polyOn && st.act, '6) 바닥은 면(영역)만 · 선은 고를 수 없음');
  await shot(p, 'shot_map_floor_bar.png');

  // ── 3) 바닥 그리기: 매장 위에 겹쳐도 매장이 위 ──
  await draw(f, [{ x: 9500, y: 4120 }, { x: 9760, y: 4120 }, { x: 9760, y: 4300 }, { x: 9500, y: 4300 }]);
  await p.waitForTimeout(300);
  const fz = await f.evaluate(() => { const z = getFloorZones('1F').filter(z => z.category === 'floor'); const e = document.querySelector('#floor-outline-layer polygon.user-floor-line'); return { n: z.length, name: z[0] && z[0].name, geom: z[0] && z[0].geometry, fill: e && e.getAttribute('fill'), inZones: !!document.querySelector('#safety-zones-layer [data-zone-category="floor"]') }; });
  ok(fz.n === 1 && fz.name === '바닥 1' && fz.geom === 'polygon' && fz.fill === 'none' && !fz.inZones, '7) 바닥 저장: 면 · 이름 「바닥 1」 · 투명(색 없음)으로 맨 위 점선 층에 그림 (구역 층에는 없음)');
  const over = await pixel(f, 9550, 4150);
  ok(near(over, [223, 231, 240, 255]), '8) 바닥을 매장(아그라) 위에 겹쳐 그려도 화면에는 안 보임 · 매장이 위 ' + over.join(','));
  const off = await f.evaluate(() => { const e = document.querySelector('.user-floor-line'), cs = getComputedStyle(e); return { s: cs.stroke, pe: cs.pointerEvents, on: document.body.classList.contains('zone-drawing-mode') }; });
  ok(!off.on && off.s === 'none' && off.pe === 'none', '9) 평소 바닥은 점선도 없고 눌리지도 않음');
  await fl.locator('#btn-symbol-menu').click();
  ok(await fl.locator('#chk-zone-filter-floor').count() === 1 && !(await fl.locator('#chk-zone-filter-floor').isChecked()), '10) 레이어 메뉴 구역 칸에 「바닥」 (처음엔 꺼짐)');
  await fl.locator('#chk-zone-filter-floor').check();
  const on = await f.evaluate(() => { const cs = getComputedStyle(document.querySelector('.user-floor-line')); return { s: cs.stroke, d: cs.strokeDasharray }; });
  ok(on.s === 'rgb(0, 0, 0)' && on.d !== 'none', '11) 바닥 레이어를 켜면 검은 점선 (' + on.s + ' / ' + on.d + ')');
  await shot(p, 'shot_map_floor_outline.png');
  await fl.locator('#chk-zone-filter-floor').uncheck();
  ok(await f.evaluate(() => getComputedStyle(document.querySelector('.user-floor-line')).stroke === 'none'), '12) 레이어를 끄면 점선만 사라지고 바닥은 그대로');
  await fl.locator('#btn-symbol-menu').click();
  await f.evaluate(() => closeAllPopovers());

  // ── 4) 지우개 ──
  ok(await pixel(f, 10530, 5030).then(c => near(c, [255, 0, 0, 255])), '13) (지우기 전) 도면 원본의 빨간 얼룩이 보임');
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(200);
  await fl.locator('#btn-zone-eraser').click();
  const er = await f.evaluate(() => ({ cat: currentZoneCategory, on: document.getElementById('btn-zone-eraser').classList.contains('on'), off: ['fire', 'smoke', 'wall', 'floor'].every(c => document.getElementById('btn-zone-cat-' + c).disabled), poly: document.getElementById('btn-zone-geom-polygon').classList.contains('active') }));
  ok(er.cat === 'erase' && er.on && er.off && er.poly, '14) 지우개를 켜면 구역 종류는 잠기고 면으로 그림');
  await draw(f, [{ x: 10420, y: 4940 }, { x: 10640, y: 4940 }, { x: 10640, y: 5130 }, { x: 10420, y: 5130 }]);
  await p.waitForTimeout(300);
  const ez = await f.evaluate(() => { const z = getFloorZones('1F').filter(z => z.category === 'erase'); return { n: z.length, name: z[0] && z[0].name, poly: document.querySelectorAll('#eraser-layer polygon.user-eraser').length, mask: !!document.querySelector('#eraser-mask'), attr: document.getElementById('eraser-layer').getAttribute('mask'), holes: document.querySelectorAll('#eraser-mask > path, #eraser-mask > polygon').length, cat: currentZoneCategory, mode: isZoneDrawingMode }; });
  ok(ez.n === 1 && ez.name === '지우개 1' && ez.poly === 1 && ez.mask && ez.attr === 'url(#eraser-mask)' && ez.holes >= 3 && ez.cat === 'floor' && !ez.mode, '15) 지우개 저장 · 매장·바닥에 구멍 뚫린 마스크 · 끝나면 지우개 꺼짐 (' + JSON.stringify(ez) + ')');
  const gone = await pixel(f, 10530, 5030), kept = await pixel(f, 10830, 5030);
  ok(near(gone, [255, 255, 255, 255]) && near(kept, [255, 0, 0, 255]), '16) 지운 범위의 얼룩은 바닥색(흰색)으로 · 범위 밖은 그대로 ' + gone.join(',') + ' / ' + kept.join(','));
  const order = await f.evaluate(() => { const ids = Array.from(document.querySelectorAll('#map-container > svg > g[id]')).map(g => g.id); return ids; });
  ok(order.indexOf('eraser-layer') > order.indexOf('safety-zones-layer') && order.indexOf('eraser-layer') > order.indexOf('utility-lines-layer') + 0 && order.indexOf('floor-layer') < order.indexOf('vendor-stores-layer'), '17) 지우개는 구역·인포·심벌보다 위, 바닥은 매장보다 아래 (' + order.join(' < ') + ')');
  await f.evaluate(() => { drawingPoints = [{ x: 10520, y: 4980 }, { x: 10600, y: 4980 }, { x: 10600, y: 5090 }, { x: 10520, y: 5090 }]; finishDrawingPolygon(); closeAllPopovers(); });
  await p.waitForTimeout(300);
  const hole = await pixel(f, 10530, 5080);
  ok(near(hole, [230, 240, 252, 255]), '18) 지우개 범위 안에 매장을 그려도 매장은 지워지지 않음 ' + hole.join(','));
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(200);
  await shot(p, 'shot_map_floor_eraser.png');
  await f.evaluate(() => toggleAddZoneMode());

  // ── 5) 바닥·지우개 열어 지우기 ──
  const zid = await f.evaluate(() => getFloorZones('1F').find(z => z.category === 'floor').id);
  await f.evaluate(id => openZoneModal(getFloorZones('1F').find(z => z.id === id)), zid);
  ok(/바닥/.test(await fl.locator('#zone-modal-badge').innerText()) && /매장·기능실 아래/.test(await fl.locator('#zone-info-category').innerText()), '19) 바닥 상세 창: 종류 표시');
  await f.evaluate(() => deleteCurrentZone()); await p.waitForTimeout(300);
  ok(await f.evaluate(() => getFloorZones('1F').every(z => z.category !== 'floor') && !document.querySelector('.user-floor-line')), '20) 바닥 지우기');

  // ── 6) 직각 체크박스 ──
  await f.evaluate(() => toggleAddZoneMode()); await p.waitForTimeout(200);
  await fl.locator('#chk-zone-ortho').check();
  const og = await f.evaluate(() => {
    drawingZonePoints = [{ x: 10300, y: 5100 }]; updateZoneDrawingPreview(10400, 5130);
    const l = document.querySelector('#temp-zone-drawing-layer line');
    return { on: isGlobalOrthoMode, snap: snapToOrtho({ x: 110, y: 105 }, { x: 100, y: 100 }), y2: l && parseFloat(l.getAttribute('y2')) };
  });
  ok(og.on && og.snap.x === 110 && og.snap.y === 100 && og.y2 === 5100, '21) 직각 체크 → 수평·수직으로만 그려짐 (미리보기 선 y=' + og.y2 + ')');
  await fl.locator('#chk-zone-ortho').uncheck();
  ok(await f.evaluate(() => !isGlobalOrthoMode && !document.getElementById('chk-zone-ortho').checked), '22) 체크를 풀면 자유롭게');
  await f.evaluate(() => { drawingZonePoints = []; exitAddZoneMode(); });
  ok(!p.errs.length, '23) 화면 오류 없음 (PC)' + (p.errs.length ? ': ' + p.errs.join(' / ') : ''));

  // ── 7) 휴대폰: 구역 그리기 줄이 줄바꿈 ──
  const [q, g] = await open(b, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await g.evaluate(() => toggleAddZoneMode()); await q.waitForTimeout(300);
  const mb = await g.evaluate(() => { const el = document.getElementById('zone-guide-banner'), bn = el.getBoundingClientRect(), W = innerWidth; return { l: bn.left, r: bn.right, W, all: ['btn-zone-cat-floor', 'btn-zone-eraser', 'chk-zone-ortho', 'btn-zone-geom-polygon'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.left >= 0 && r.right <= W; }), clip: el.scrollWidth > el.clientWidth + 1 }; });
  ok(mb.l >= -1 && mb.r <= mb.W + 1 && mb.all && !mb.clip, '24) 휴대폰: 구역 그리기 줄이 옆으로 잘리지 않고 접힘 (' + [mb.l, mb.r, mb.W].map(Math.round).join(',') + ')');
  const cover = await q.evaluate(() => {   // 왼쪽 아래 「뒤로」 버튼이 줄을 가리지 않는지 (바깥 화면 기준으로 비교)
    const fr = document.querySelector('iframe.mapframe'), o = fr.getBoundingClientRect(), d = fr.contentDocument, bk = document.querySelector('.mapback').getBoundingClientRect();
    return ['btn-zone-cat-fire', 'btn-zone-cat-floor', 'btn-zone-eraser', 'chk-zone-ortho', 'btn-zone-geom-line', 'btn-zone-geom-polygon'].filter(id => {
      const r = d.getElementById(id).getBoundingClientRect(), L = r.left + o.left, T = r.top + o.top, R = r.right + o.left, B = r.bottom + o.top;
      return L < bk.right && R > bk.left && T < bk.bottom && B > bk.top;
    });
  });
  ok(cover.length === 0, '24-1) 휴대폰: 뒤로 버튼이 구역 그리기 줄 단추를 가리지 않음 ' + cover.join(','));
  await shot(q, 'shot_map_floor_phone.png');
  ok(!q.errs.length, '25) 화면 오류 없음 (휴대폰)' + (q.errs.length ? ': ' + q.errs.join(' / ') : ''));

  // ── 8) 예전에 저장된 도면에 남은 흰 바닥(맨 끝) 정리 ──
  KV.lotte_saved_svg_1F = STALE;
  const [r, h] = await open(b, { viewport: { width: 1280, height: 800 } });
  ok(await h.evaluate(() => document.querySelectorAll('#map-container > svg > path.vacant-floor-polygon').length === 0 && document.querySelectorAll('#floor-vacant path').length === 1), '26) 예전 저장 도면의 맨 끝 흰 바닥은 지우고 바닥 층에서 다시 그림');
  ok(!r.errs.length, '27) 화면 오류 없음 (예전 저장 도면)' + (r.errs.length ? ': ' + r.errs.join(' / ') : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n바닥·지우개 시험 실패 ' + fail + '개' : '\n바닥·지우개 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
