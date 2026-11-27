// 지도 심벌 이름·크기·위치 창 시험 (결정 292 · 소화전·공기호흡기 자동 이름 결정 298)
// 실행: node test/sb_map_symbol_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8147;
const exp = Date.now() + 3600e3, TOK = 'S001.' + exp + '.boss';
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
const junk = (x, y) => `<rect class="junk" x="${x}" y="${y}" width="60" height="60" fill="#ff0000"/>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080"><g>${room('a', '아그라', 9600, 4200)}${junk(10500, 5000)}${junk(10800, 5000)}</g></svg>`;
// 예전에 저장된 도면: 도면 맨 끝에 흰 바닥이 붙어 있음 (이게 매장 위를 덮던 원인)
const STALE = SVG.replace('</svg>', '<path class="vacant-floor-polygon" d="M9400 4000h100v100z" fill="#ffffff"/></svg>');
const OLD = [{ id: 'o1', type: 'fire_hydrant', x: 9600, y: 4200, createdAt: '2026-01-01T00:00:00Z' }, { id: 'o2', type: 'fire_hydrant', x: 9620, y: 4210, place: '아그라', no: 1, name: '아그라-소화전1', createdAt: '2026-01-02T00:00:00Z' }, { id: 'o4', type: 'air_respirator', x: 9700, y: 4300, name: '1F공기호흡기02', createdAt: '2026-01-04T00:00:00Z' }, { id: 'o3', type: 'clean_extinguisher', x: 11000, y: 5700, createdAt: '2026-01-03T00:00:00Z' }];
const KV = { lotte_symbols_1F: JSON.stringify(OLD) };
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

const syms = f => f.evaluate(() => loadFloorSymbols('1F'));
(async () => {
  const b = await chromium.launch();
  const [p, f, fl] = await open(b, { viewport: { width: 1400, height: 900 } });
  let s = await syms(f);
  const o1 = s.find(x => x.id === 'o1'), o2 = s.find(x => x.id === 'o2'), o3 = s.find(x => x.id === 'o3'), o4 = s.find(x => x.id === 'o4');
  ok(o1.name === '1F소화전01' && o2.name === '1F소화전02', '1) 이름 없던·옛 규칙 소화전: 찍은 순서로 「1F소화전01·02」 (' + o1.name + ', ' + o2.name + ')');
  ok(o4.name === '1F공기호흡기02', '1-1) 이미 새 규칙 이름은 그대로 (' + o4.name + ')');
  ok(o3.name === '1F-소화기1', '2) 매장·구역 밖 옛 청정소화기: 층 이름으로 「1F-소화기1」 (' + o3.name + ')');
  const r = await f.evaluate(() => +document.querySelector('.cad-symbol-node circle').getAttribute('r'));
  ok(Math.abs(r * r / 25 - 7) < 0.05, '3) 심벌 크기: 면적 7배 (반지름 ' + r + ')');
  const col = await f.evaluate(() => [...document.querySelectorAll('.cad-symbol-node')].map(g => g.dataset.type + ':' + g.querySelector('circle').getAttribute('fill')).sort().join(' '));
  ok(/clean_extinguisher:#475569/.test(col) && /fire_hydrant:#1e293b/.test(col), '4) 청정소화기 진한 회색, 소화전 그대로 (' + col + ')');
  ok(await f.evaluate(() => !/[\u{1F300}-\u{1FAFF}]/u.test(document.getElementById('map-symbols-layer').innerHTML + document.getElementById('symbol-guide-banner').innerHTML)), '5) 심벌·안내 띠에 그림문자 없음 (그림으로 그림)');
  ok(await f.evaluate(() => getComputedStyle(document.querySelector('.cad-symbol-label')).display === 'none'), '6) 평소에는 이름표 숨김');

  // 평소 클릭 → 이름 말풍선
  await f.evaluate(() => document.querySelector('.cad-symbol-node[data-id="o1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 300 })));
  const bub = await f.evaluate(() => { const e = document.getElementById('symbol-name-bubble'); return e && e.style.display === 'block' ? e.textContent : ''; });
  ok(bub === '1F소화전01', '7) 평소 심벌 클릭 → 이름 말풍선 「' + bub + '」');

  // 편집: 공기호흡기는 창 없이 이름 자동 · 비어 있는 가장 작은 번호
  await f.evaluate(() => { startSymbolEditMode(); setSymbolType('air_respirator'); });
  ok(await f.evaluate(() => getComputedStyle(document.querySelector('.cad-symbol-label')).display !== 'none'), '8) 편집 중에는 이름표 보임');
  await f.evaluate(() => addSymbolAt(10800, 5600));
  ok(await fl.locator('#symbol-place-dialog').count() === 0, '9) 공기호흡기는 위치 창 없이 바로 배치');
  await f.evaluate(() => addSymbolAt(10850, 5600));
  s = await syms(f);
  let air = s.filter(x => x.type === 'air_respirator').map(x => x.name).sort();
  ok(air.join(',') === '1F공기호흡기01,1F공기호흡기02,1F공기호흡기03', '10) 비어 있던 01 먼저, 그다음 03 (' + air + ')');
  const a1 = s.find(x => x.name === '1F공기호흡기01');
  await f.evaluate(id => document.querySelector(`.cad-symbol-node[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), a1.id);
  ok(await fl.locator('#symbol-place-input').count() === 0 && (await fl.locator('#symbol-name-preview').textContent()) === '1F공기호흡기01' && await fl.locator('#symbol-place-del').count() === 1, '11) 편집 중 클릭 → 이름 보기 · 삭제 (위치 칸 없음)');
  await fl.locator('#symbol-place-del').click();
  await f.evaluate(() => addSymbolAt(10900, 5600));
  s = await syms(f);
  air = s.filter(x => x.type === 'air_respirator').map(x => x.name).sort();
  ok(!s.some(x => x.id === a1.id) && air.join(',') === '1F공기호흡기01,1F공기호흡기02,1F공기호흡기03', '12) 지운 번호(01)를 다시 씀 (' + air + ')');
  await f.evaluate(() => { setSymbolType('fire_hydrant'); addSymbolAt(10950, 5600); });
  ok((await syms(f)).some(x => x.type === 'fire_hydrant' && x.name === '1F소화전03'), '12-1) 소화전도 이어서 「1F소화전03」');

  // 청정·분말 소화기: 위치 창 그대로
  await f.evaluate(() => { setSymbolType('clean_extinguisher'); addSymbolAt(10800, 5650); });
  await fl.locator('#symbol-place-dialog').waitFor();
  const sug = await fl.locator('#symbol-place-input').inputValue();
  ok(sug === '1F' && /1F-소화기2/.test(await fl.locator('#symbol-name-preview').textContent()), '13) 소화기는 위치 창: 미리 넣은 위치 「' + sug + '」 · 이름 미리보기');
  await shot(p, 'shot_sb_map_symbol_dialog.png');
  await fl.locator('#symbol-place-input').fill('동측 계단 앞');
  ok((await fl.locator('#symbol-name-preview').textContent()) === '동측 계단 앞-소화기1', '13-1) 위치를 바꾸면 이름도 바로 바뀜');
  await fl.locator('#symbol-place-input').press('Enter');
  await f.evaluate(() => { setSymbolType('powder_extinguisher'); addSymbolAt(11050, 5700); });
  await fl.locator('#symbol-place-input').fill('동측 계단 앞');
  await fl.locator('#symbol-place-ok').click();
  s = await syms(f);
  ok(s.some(x => x.type === 'powder_extinguisher' && x.name === '동측 계단 앞-소화기2') && await f.evaluate(() => isSymbolMode), '13-2) 분말도 「소화기」로 번호 이어서 · Enter 뒤에도 배치 모드 그대로');

  // 비우면 저장 안 함 · 취소
  const n0 = s.length;
  await f.evaluate(() => addSymbolAt(10700, 5500));
  await fl.locator('#symbol-place-input').fill('  ');
  await fl.locator('#symbol-place-ok').click();
  ok(await fl.locator('#symbol-place-dialog').count() === 1 && (await syms(f)).length === n0, '14) 위치가 비면 배치 안 함');
  await fl.locator('#symbol-place-input').press('Escape');
  ok(await fl.locator('#symbol-place-dialog').count() === 0 && (await syms(f)).length === n0 && await f.evaluate(() => isSymbolMode), '15) ESC 는 창만 닫음 (배치 모드 그대로)');

  // 소화기 클릭 → 위치 고치기 · 삭제
  const c1 = (await syms(f)).find(x => x.name === '동측 계단 앞-소화기1');
  await f.evaluate(id => document.querySelector(`.cad-symbol-node[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), c1.id);
  ok((await fl.locator('#symbol-place-input').inputValue()) === '동측 계단 앞' && await fl.locator('#symbol-place-del').count() === 1, '16) 소화기 클릭 → 위치 창 (저장·삭제)');
  await fl.locator('#symbol-place-input').fill('서측 복도');
  await fl.locator('#symbol-place-ok').click();
  s = await syms(f);
  ok(s.find(x => x.id === c1.id).name === '서측 복도-소화기1', '17) 위치를 고치면 이름 「서측 복도-소화기1」');
  await f.evaluate(id => document.querySelector(`.cad-symbol-node[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), c1.id);
  await fl.locator('#symbol-place-del').click();
  ok(!(await syms(f)).some(x => x.id === c1.id), '18) 삭제');
  await shot(p, 'shot_sb_map_symbol_edit.png');
  ok(!p.errs.length, '19) 화면 오류 없음 ' + p.errs.join(' | '));
  // 결과 그림: 네 심벌을 크게 (화면 확인용)
  await f.evaluate(() => {
    const d = document.createElement('div'); d.id = 'sym-prev';
    d.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#eef2f7;padding:10px';
    d.innerHTML = '<svg viewBox="-20 -20 360 40" width="1080" height="120">' + Object.values(SYMBOL_DEFINITIONS).map((def, i) =>
      `<g transform="translate(${i * 90},0)">${symbolSvgInner(def, SYMBOL_R)}<text x="16" y="0" dominant-baseline="central" font-size="9" fill="#0f172a">${def.name}</text></g>`).join('') + '</svg>';
    document.body.appendChild(d);
  });
  await fl.locator('#sym-prev').screenshot({ path: path.join(process.env.SHOT_DIR || path.join(__dirname, '..'), 'shot_sb_map_symbol_icons.png') });
  await b.close(); srv.close();
  console.log(fail ? '실패 ' + fail : '지도 심벌 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
