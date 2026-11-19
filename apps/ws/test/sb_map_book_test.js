// 지도 매장 대장 화면 시험 (결정 152): 고유번호 · 이름 바꾸기·지우기 · 도형 삭제 · 되돌리기 · 엑셀 받기·올리기 · 직원 권한
// 엑셀 도구(SheetJS)는 실제 주소에서 받으므로 인터넷이 필요함. 실행: node test/sb_map_book_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8134;
const exp = Date.now() + 3600e3;
const TOK = { boss: 'S001.' + exp + '.boss', emp: 'S003.' + exp + '.emp' };
const USER = { [TOK.boss]: { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, [TOK.emp]: { staff_id: 'S003', name: '이영희', part: '전방파트', role: '직원' } };
const KV = { lotte_facility_specs_1F: JSON.stringify({ 샤넬: { type: 'store', fields: [{ label: '차단기 규격', value: '3P 75A' }] } }) }, VERS = {};
const SAVES = [];
let n = 0;
const me = a => { const u = USER[a.p_token]; if (!u) throw new Error('LOGIN'); return u; };
const FLOORS = ['6F', '5F', '4F', '3F', '2F', '1F', 'B1'];
const RPC = {
  ws_bootstrap(a) { return { ok: true, user: me(a), toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_map_load(a) { const u = me(a); return { ok: true, kv: KV, vers: VERS, bases: {}, canEdit: u.role !== '직원', isBoss: u.role === '소장', urls: { avenuel: Object.fromEntries(FLOORS.map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])), dept: {}, castle: {} } }; },
  ws_map_save(a) { const u = me(a); SAVES.push(a); if (u.role === '직원') return { ok: false, error: '권한 없음' }; if (a.p_v == null) { delete KV[a.p_k]; return { ok: true, ver: '' }; } KV[a.p_k] = a.p_v; VERS[a.p_k] = 'v' + (++n); return { ok: true, ver: VERS[a.p_k] }; },
  ws_map_base() { return { ok: true, sha: 'x' }; }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return { auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } } };
} };`;
const room = (id, name, x, y) => `<path id="${id}" d="M${x - 150} ${y - 100}h300v200h-300z" fill="#dfe7f0" ds-x="${x}" ds-y="${y}" ds-width="300" ds-height="200"/><text x="${x}" y="${y}"><tspan>${name}</tspan></text>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080" width="1950" height="2080">${room('a', '아그라', 9600, 4200)}${room('b', '샤넬', 10100, 4200)}${room('c', '화장실', 9600, 4800)}${room('d', '화장실', 10100, 4800)}<text x="10900" y="5800"><tspan>안내문</tspan></text></svg>`;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/rpc/')) { res.setHeader('content-type', 'application/json'); const f = RPC[u.pathname.slice(5)] || (() => ({ ok: true })); try { return res.end(JSON.stringify({ data: f(JSON.parse(body || '{}')) })); } catch (e) { return res.end(JSON.stringify({ err: e.message })); } }
    if (u.pathname === '/floor.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(SVG); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : /\.css$/.test(f) ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);

async function open(b, tok) {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.addInitScript(t => { if (location.pathname === '/ws/app.html') localStorage.setItem('ws_token', t); }, tok);
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:' + PORT + '/ws/app.html');
  await p.locator('.grid6').waitFor();
  await p.click('.grid6 .tile:has-text("지도")');
  await p.frameLocator('iframe.mapframe').locator('#map-container svg').waitFor({ timeout: 15000 });
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor();
  await p.waitForTimeout(500);
  return p;
}
const frameOf = p => p.frames().find(x => /\/map\/index\.html$/.test(x.url()));
const book = (f = '1F') => JSON.parse(KV['lotte_store_book_' + f]);
const idOf = (name, f) => Object.keys(book(f).items).find(k => book(f).items[k].name === name);
const shot = (p, name) => p.screenshot({ path: path.join(process.env.SHOT_DIR || path.join(__dirname, '..'), name) });

(async () => {
  const b = await chromium.launch();
  const p = await open(b, TOK.boss);
  const f = frameOf(p), fl = p.frameLocator('iframe.mapframe');
  const edit = name => f.evaluate(x => openEditModalForStore(currentStores.find(s => s.name === x)), name);
  const save = async () => { await fl.locator('#edit-modal button:has-text("저장")').click(); await p.waitForTimeout(250); };

  ok(Object.keys(book().items).length === 4 && !Object.values(book().items).some(x => x.name === '안내문'), '1) 도형 있는 매장 4곳에 번호, 도형 없는 글자는 번호 없음');
  const AG = idOf('아그라'), CH = idOf('샤넬');
  ok(/^AV-1F-\d{4}$/.test(AG), '2) 번호 모양 ' + AG);
  ok(book().items[CH].details['차단기|일반'] === '3P 75A', '3) 예전에 입력한 상세 값을 옮김');
  ok(JSON.stringify(book().items[AG].details) === '{}', '4) 지어낸 기본값(3P 50A)은 넣지 않음');

  await edit('아그라');
  ok(await fl.locator('#edit-store-id').innerText() === AG && await fl.locator('#store-detail-form input').count() === 6, '5) 수정 창: 고유번호 표시 · 항목 6칸 (from 만, to 없음)');
  await p.waitForTimeout(400);
  ok(await f.evaluate(() => { const r = document.getElementById('edit-modal').getBoundingClientRect(); return document.getElementById('edit-modal').contains(document.elementFromPoint(r.left + r.width / 2, r.top + 6)); }), '5-1) 수정 창 맨 위가 윗줄에 가리지 않음');
  await shot(p, 'shot_book_edit.png');
  await fl.locator('[data-detail-key="차단기|일반"]').fill('50');
  await fl.locator('[data-detail-key="급수"]').fill('25A');
  await fl.locator('#edit-name').fill('새아그라');
  await save();
  ok(book().items[AG].name === '새아그라' && book().items[AG].details.급수 === '25A', '6) 이름을 바꿔도 번호 그대로 · 상세내역 저장');

  await edit('새아그라');
  await fl.locator('#btn-clear-name').click(); await p.waitForTimeout(250);
  ok(book().items[AG].name === '' && book().items[AG].details.급수 === '25A', '7) 이름만 지움: 번호·상세내역 남음');
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(300);
  ok(await f.evaluate(id => { const s = currentStores.find(x => x.bookId === id); return !!s && s.name === '' && /이름 없음/.test(s.textElement.textContent); }, AG), '8) 다시 열어도 그 도형에 묶임 · 「이름 없음」 표시');

  const [c1, c2] = Object.keys(book().items).filter(k => book().items[k].name === '화장실').sort();
  await f.evaluate(id => openEditModalForStore(currentStores.find(s => s.bookId === id)), c1);
  await fl.locator('#btn-popover-delete').click(); await p.waitForTimeout(300);
  ok(!book().items[c1] && !!book().items[c2], '9) 도형 삭제: 그 도형만 지움 (같은 이름의 다른 도형은 남음)');
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(300);
  ok(await f.evaluate(id => !currentStores.some(s => s.bookId === id), c1) && !book().items[c1], '10) 다시 열어도 삭제 유지 · 번호 되살아나지 않음');
  await f.evaluate(() => handleUndo()); await p.waitForTimeout(500);
  ok(!!book().items[c1] && !book().deleted.length, '11) 되돌리기: 지운 번호 복원');
  await f.evaluate(id => openEditModalForStore(currentStores.find(s => s.bookId === id)), c1);
  await fl.locator('#btn-popover-delete').click(); await p.waitForTimeout(300);

  const next = book().next;
  await f.evaluate(() => { drawingPoints = [{ x: 10600, y: 5300 }, { x: 10800, y: 5300 }, { x: 10800, y: 5500 }, { x: 10600, y: 5500 }]; finishDrawingPolygon(); });
  await p.waitForTimeout(300);
  const nid = `AV-1F-${String(next).padStart(4, '0')}`;
  ok(!!book().items[nid] && JSON.stringify(book().items[nid].details) === '{}', '12) 새로 그린 도형: 새 번호 ' + nid + ' · 지운 번호를 다시 쓰지 않음');
  await f.evaluate(id => { closeAllPopovers(); openEditModalForStore(currentStores.find(s => s.bookId === id)); }, nid);
  await fl.locator('#edit-name').fill('새 기능실'); await save();
  await f.evaluate(() => selectFloor(currentFloorIdx, true)); await p.waitForTimeout(300);
  ok(await f.evaluate(id => currentStores.filter(s => s.bookId === id).length === 1 && document.querySelectorAll('#custom-stores-top-layer g.store-group').length === 1, nid), '13) 직접 그린 매장도 다시 열었을 때 번호 유지 · 겹치지 않음');

  // 엑셀 받기
  const [dl] = await Promise.all([p.waitForEvent('download'), f.evaluate(() => { downloadStoreExcel(); })]);
  const b64 = fs.readFileSync(await dl.path()).toString('base64');
  const got = await f.evaluate(s => { const wb = XLSX.read(s, { type: 'base64' }); return { names: wb.SheetNames, rows: XLSX.utils.sheet_to_json(wb.Sheets['1층'], { header: 1, defval: '' }) }; }, b64);
  ok(dl.suggestedFilename() === '에비뉴엘 매장.xlsx' && got.names[0] === 'B1층' && got.names.length === 7 && got.rows[0].join() === '순번,매장명,차단기,,,급수,배수,가스' && got.rows[1].join() === ',,일반,비상,from,,,', '14) 엑셀 받기: 층마다 시트 · 올려 주신 양식과 같은 머리글');
  ok(!got.rows.slice(2).some(r => r[1] === '이름 없음' || r[1] === ''), '15) 이름 없는 도형은 엑셀에서 뺌');

  // 엑셀 올리기
  const up = await f.evaluate(() => {
    const ws = XLSX.utils.aoa_to_sheet([['순번', '매장명', '차단기', '', '', '급수', '배수', '가스', '통신'], ['', '', '일반', '비상', 'from', '', '', '', ''], [1, '샤넬', 100, 30, '1번 EPS', '', '', 6, 'LAN'], [2, '없는매장', 1, '', '', '', '', '', ''], [3, '<b>나쁜글</b>', 1, '', '', '', '', '', '']]);
    ws['!merges'] = [{ s: { r: 0, c: 2 }, e: { r: 0, c: 4 } }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '1층');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  });
  const before = KV.lotte_store_book_1F;
  await fl.locator('#store-excel-file').setInputFiles({ name: '에비뉴엘 매장.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(up, 'base64') });
  await fl.locator('.xl-box').waitFor();
  const dlg = await fl.locator('.xl-box').innerText();
  await shot(p, 'shot_book_excel.png');
  ok(KV.lotte_store_book_1F === before && /없는매장/.test(dlg) && /통신/.test(dlg) && /1곳 저장/.test(dlg), '16) 확인 창: 저장 전엔 안 들어감 · 없는 매장·새 항목 표시');
  ok(/<b>나쁜글<\/b>/.test(dlg), '17) 엑셀 글자는 그대로 글자로만 표시');
  await fl.locator('#xl-save').click(); await fl.locator('.xl-box').waitFor({ state: 'detached' }); await p.waitForTimeout(500);
  const d = book().items[CH].details;
  ok(d['차단기|일반'] === '100' && d['차단기|from'] === '1번 EPS' && d.가스 === '6' && d.통신 === 'LAN', '18) 저장: 값 반영 · 더한 열 「통신」도 저장');
  ok(!Object.values(book().items).some(x => x.name === '없는매장'), '19) 도면에 없는 이름은 저장 안 함');
  await edit('샤넬');
  ok(await fl.locator('[data-detail-key="통신"]').inputValue() === 'LAN', '20) 더한 항목이 수정 창에 나옴');
  await f.evaluate(() => closeAllPopovers());
  await f.evaluate(() => storePanel.classList.remove('hidden'));
  await p.waitForTimeout(250); await shot(p, 'shot_book_list.png');
  ok(await f.evaluate(id => { const i = document.getElementById('store-search-box'); i.value = id; filterStoreList(); const c = document.querySelectorAll('#store-list-container .store-item-card'); return c.length === 1 && c[0].innerText.includes('샤넬') && c[0].innerText.includes(id); }, CH), '21) 고유번호로 찾기 · 목록에 번호와 상세 요약');
  ok(!p.errs.length, '22) 화면 오류 없음 (소장)' + (p.errs.length ? ': ' + p.errs.join(' / ') : ''));

  const e = await open(b, TOK.emp), fe = frameOf(e);
  const nS = SAVES.length;
  ok(await fe.evaluate(id => currentStores.some(s => s.bookId === id), CH), '23) 직원: 고유번호·상세내역 보임');
  ok(await fe.evaluate(() => getComputedStyle(document.getElementById('btn-excel-up')).display === 'none' && getComputedStyle(document.getElementById('btn-excel-down')).display !== 'none'), '24) 직원: 엑셀 받기만 보이고 올리기는 없음');
  await fe.evaluate(() => { openEditModalForStore(currentStores[0]); saveStoreBook('1F', StoreBook.emptyBook()); }); await e.waitForTimeout(300);
  ok(SAVES.length === nS && await fe.evaluate(() => getComputedStyle(document.getElementById('edit-modal')).display === 'none' || !document.getElementById('edit-modal').classList.contains('show')), '25) 직원: 수정 창 안 열림 · 저장 안 보냄');
  ok(!e.errs.length, '26) 화면 오류 없음 (직원)' + (e.errs.length ? ': ' + e.errs.join(' / ') : ''));

  await b.close(); srv.close();
  console.log(fail ? '\n매장 대장 시험 실패 ' + fail + '개' : '\n매장 대장 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
