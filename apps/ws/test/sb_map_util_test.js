// 지도 배관 선: 평소 숨김 · 누르면 표시 · 같은 쌍 여러 선 1px 간격 · 전기 붉은색 시험 (결정 254)
// 삭제한 매장 자리 흰 바닥이 새 매장 위를 덮던 것 · 구역 그리기에 「바닥」 · 「지우개」 · 직각 체크박스 · 레이어 메뉴 바닥 · 휴대폰 줄바꿈
// 실행: node test/sb_map_util_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8138;
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
  const [p, f] = await open(b, { viewport: { width: 1280, height: 800 } });
  const pt = (x, y) => ({ x, y });
  const mk = (id, sub, cls, src, tgt, pts) => ({ id, subType: sub, subTypeLabel: sub, className: cls, color: '#000', sourceName: src, targetName: tgt, auto: true, points: pts });
  const P = [pt(100, 100), pt(100, 200), pt(300, 200)];
  await f.evaluate(([L]) => { saveFloorUtilityLines('1F', L); renderFloorUtilityLines(); clearUtilityLineHighlight(); }, [[
    mk('u1', 'power', 'util-line-eps', 'S1', 'E1', P), mk('u2', 'water', 'util-line-water', 'S1', 'E1', P), mk('u3', 'gas', 'util-line-gas', 'S1', 'E1', P),
    mk('u4', 'power', 'util-line-eps', 'S2', 'E1', [pt(500, 100), pt(500, 200)]), mk('u5', 'power', 'util-line-eps', 'S3', 'E2', [pt(700, 100), pt(700, 200)])]]);
  const vis = () => f.evaluate(() => Array.from(document.querySelectorAll('#utility-lines-layer .util-line-item-group')).filter(g => g.style.display !== 'none').map(g => g.getAttribute('data-id')).sort().join(','));
  ok(await vis() === '', '1) 평소에는 선이 하나도 안 보임 (보이는 선: ' + await vis() + ')');
  await f.evaluate(() => highlightUtilityLinesForStore({ id: '', name: 'S1' }));
  ok(await vis() === 'u1,u2,u3', '2) 매장 S1을 누르면 그 매장의 선만 보임 (' + await vis() + ')');
  await f.evaluate(() => highlightUtilityLinesForStore({ id: '', name: 'E1' }));
  ok(await vis() === 'u1,u2,u3,u4', '3) 기능실 E1을 누르면 그 기능실에서 나간 모든 선이 보임 (' + await vis() + ')');
  await f.evaluate(() => clearUtilityLineHighlight());
  ok(await vis() === '', '4) 선택을 풀면 다시 안 보임');
  // 이름표 겹침 (결정 258): 같은 쌍 선 3개의 이름표가 서로 안 겹침
  await f.evaluate(() => highlightUtilityLinesForStore({ id: '', name: 'E1' }));
  const boxes = await f.evaluate(() => Array.from(document.querySelectorAll('#utility-lines-layer .util-line-item-group')).filter(g => g.style.display !== 'none').map(g => g.querySelector('.util-spec-badge-group')).filter(l => l && l.style.display !== 'none').map(l => { const r = l.querySelector('rect').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  let overlap = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const A = boxes[i], B = boxes[j]; if (A[0] < B[2] - 0.5 && B[0] < A[2] - 0.5 && A[1] < B[3] - 0.5 && B[1] < A[3] - 0.5) overlap++; }
  ok(boxes.length === 4 && overlap === 0, '2-2) 보이는 선 4개의 이름표가 서로 겹치지 않음 (이름표 ' + boxes.length + '개, 겹침 ' + overlap + '쌍)');
  ok(await f.evaluate(() => Array.from(document.querySelectorAll('#utility-lines-layer .util-line-item-group')).filter(g => g.style.display !== 'none').every(g => { const l = g.querySelector('.util-spec-badge-group'); return /translate/.test(l.getAttribute('transform') || ''); })), '2-3) 이름표는 각자 자리로 옮겨져 있음');
  await f.evaluate(() => clearUtilityLineHighlight());
  const pts = await f.evaluate(() => ['u1', 'u2', 'u3', 'u4'].map(id => document.querySelector('#utility-lines-layer polyline[data-id="' + id + '"]').getAttribute('points')));
  const num = s => s.split(' ').map(q => q.split(',').map(Number));
  const [a, m, c, solo] = pts.map(num);
  ok(a[0][0] === 96 || a[0][0] === 104, '5) 같은 쌍 선 3개: 첫 선이 4px 옆 (' + pts[0] + ')');
  ok(m[0][0] === 100 && m[1][1] === 200, '6) 가운데 선은 원래 길 그대로 (' + pts[1] + ')');
  ok(Math.abs(Math.abs(a[0][0] - m[0][0]) - 4) < 0.01 && Math.abs(Math.abs(c[0][0] - m[0][0]) - 4) < 0.01 && a[0][0] !== c[0][0], '7) 선 사이 가운데끼리 4px = 굵기 3px + 간격 1px, 양옆으로');
  ok(Math.abs(a[1][0] - a[0][0]) < 0.01 && Math.abs(Math.abs(a[1][1] - 200) - 4) < 0.01 && Math.abs(a[2][1] - a[1][1]) < 0.01, '8) 꺾이는 곳도 평행 유지 (' + pts[0] + ')');
  ok(solo[0][0] === 500 && solo[1][0] === 500, '9) 쌍이 다른 선(혼자)은 그대로');
  const saved = await f.evaluate(() => getFloorUtilityLines('1F').find(l => l.id === 'u1').points[0].x);
  ok(saved === 100, '10) 저장된 선 위치는 바뀌지 않음');
  const css = await f.evaluate(() => { const g = document.querySelector('#utility-lines-layer .util-line-item-group'); const col = id => getComputedStyle(document.querySelector('#utility-lines-layer polyline[data-id="' + id + '"]')).stroke; return { power: col('u1'), water: col('u2') }; });
  ok(css.power === 'rgb(220, 38, 38)' && css.water !== 'rgb(220, 38, 38)', '11) 전기는 붉은색, 수도는 아님 (' + css.power + ' / ' + css.water + ')');
  ok(await f.evaluate(() => UTIL_SPECS_CONFIG.power.color === '#dc2626'), '12) 새로 그리는 전기선 색도 붉은색');
  // 이름표 고치기·옮기기 (결정 308)
  let dialogs = 0; p.on('dialog', () => { dialogs++; });   // 처리(수락)는 위의 open 에서
  await f.evaluate(() => { const L = getFloorUtilityLines('1F'); L.push({ id: 'u6', subType: 'power', subTypeLabel: 'power', className: 'util-line-eps', color: '#000', sourceName: 'S9', targetName: 'E9', auto: true, points: [{ x: 9700, y: 4300 }, { x: 9700, y: 4600 }] }); saveFloorUtilityLines('1F', L); renderFloorUtilityLines(); });
  await f.evaluate(() => highlightUtilityLinesForStore({ id: '', name: 'S9' }));
  const lab = () => f.evaluate(() => { const l = document.querySelector('#utility-lines-layer .util-line-item-group[data-id="u6"] .util-spec-badge-group'), r = l.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: +l.querySelector('rect').getAttribute('height'), lines: [...l.querySelectorAll('tspan')].map(t => t.textContent), tf: l.getAttribute('transform') }; });
  const fr = await (await p.$('iframe.mapframe')).boundingBox();
  let L0 = await lab();
  await p.mouse.click(fr.x + L0.x, fr.y + L0.y);
  ok(dialogs === 0, '14) 이름표 한 번 누름: 삭제 확인창 안 뜸');
  await p.mouse.dblclick(fr.x + L0.x, fr.y + L0.y);
  const ed = p.frameLocator('iframe.mapframe').locator('#util-label-editor');
  ok(await ed.count() === 1 && dialogs === 0, '15) 더블클릭 → 고치는 칸이 뜸');
  const h1 = await ed.evaluate(e => e.offsetHeight);
  await ed.press('End'); await ed.press('Enter'); await ed.type('2번 EPS → 까르띠에');
  const h2 = await ed.evaluate(e => e.offsetHeight);
  ok(h2 > h1, '16) Enter로 다음 줄 · 칸이 커짐 (' + h1 + ' → ' + h2 + ')');
  await ed.evaluate(e => e.blur());   // 바깥 누르면(포커스가 빠지면) 저장
  const s5 = await f.evaluate(() => getFloorUtilityLines('1F').find(l => l.id === 'u6'));
  ok(s5.labelText === 'power\n2번 EPS → 까르띠에', '17) 저장: ' + JSON.stringify(s5.labelText));
  await f.evaluate(() => highlightUtilityLinesForStore({ id: '', name: 'S9' }));
  L0 = await lab();
  ok(L0.lines.length === 2 && L0.h === 36, '18) 이름표 두 줄 · 상자 높이 22 → 36 (' + L0.lines.join('/') + ', ' + L0.h + ')');
  await p.mouse.move(fr.x + L0.x, fr.y + L0.y); await p.mouse.down(); await p.mouse.move(fr.x + L0.x + 60, fr.y + L0.y + 40, { steps: 5 }); await p.mouse.up();
  const s5b = await f.evaluate(() => getFloorUtilityLines('1F').find(l => l.id === 'u6'));
  ok(s5b.labelPos && s5b.labelPos.x > 9740, '19) 끌어서 옮긴 자리 저장 (' + JSON.stringify(s5b.labelPos) + ')');
  await f.evaluate(() => { renderFloorUtilityLines(); highlightUtilityLinesForStore({ id: '', name: 'S9' }); });
  const L1 = await lab();
  ok(L1.tf === `translate(${s5b.labelPos.x.toFixed(1)},${s5b.labelPos.y.toFixed(1)})`, '20) 다시 그려도 옮긴 자리 그대로 (' + L1.tf + ')');
  ok(await f.evaluate(() => document.querySelector('#utility-lines-layer .util-line-item-group[data-id="u6"] .util-label-link').style.display !== 'none'), '21) 옮긴 이름표와 선을 가는 선으로 이음');
  await p.mouse.dblclick(fr.x + L1.x, fr.y + L1.y);
  await ed.press('Escape');
  ok(await ed.count() === 0 && (await f.evaluate(() => getFloorUtilityLines('1F').find(l => l.id === 'u6').labelText)) === s5.labelText, '22) Esc는 고치지 않고 닫음');
  await p.mouse.dblclick(fr.x + L1.x, fr.y + L1.y);
  await ed.fill(''); await ed.evaluate(e => e.blur());
  ok(!(await f.evaluate(() => 'labelText' in getFloorUtilityLines('1F').find(l => l.id === 'u6'))), '23) 글자를 다 지우면 원래 이름표로');
  await f.evaluate(() => { onLayerLockChange('power', true); highlightUtilityLinesForStore({ id: '', name: 'S9' }); });
  const L2 = await lab();
  await p.mouse.dblclick(fr.x + L2.x, fr.y + L2.y);
  ok(await ed.count() === 0, '24) 전기 레이어를 잠그면 고치기 안 됨');
  await f.evaluate(() => onLayerLockChange('power', false));
  ok(!p.errs.length, '13) 화면 오류 없음 ' + p.errs.join('|'));
  await b.close(); srv.close();
  if (fail) { console.log('\n실패 ' + fail + '건'); process.exit(1); }
  console.log('배관 선 표시·간격·색 시험 통과');
})();
