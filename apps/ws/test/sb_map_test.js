// 지도 화면 시험 (결정 130 · 기록 132 · 동시 편집·권한 134)
// 메인 「지도」 칸 → 업무지원 안에 도면 앱(fm/map) → 자료는 PIN 표로만 · 저장(판 비교) · 기록 달력 · 지난 날 보기 전용 · 소장 되돌리기 · 직원 보기 전용 · Delete 키 · 터치
// 진짜 Supabase 대신 가짜 DB 함수(이 파일 RPC). DB 함수 자체는 sql_test.js (13_map.sql)
// 먼저: python tools/build_fm.py   그다음: node test/sb_map_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8133;

const exp = Date.now() + 3600e3;
const TOK = { boss: 'S001.' + exp + '.boss', emp: 'S003.' + exp + '.emp' };
const USER = { [TOK.boss]: { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, [TOK.emp]: { staff_id: 'S003', name: '이영희', part: '전방파트', role: '직원' } };
const kst = d => new Date(Date.now() + 9 * 3600e3 - d * 864e5).toISOString().slice(0, 10);
const TODAY = kst(0), YEST = kst(1);
const LINE = { id: 'L1', subType: 'elec', subTypeLabel: '전기', className: 'util-line-eps', sourceName: '기능실A', targetName: '매장B', points: [{ x: 9500, y: 4100 }, { x: 9900, y: 4300 }] };
const KV = { lotte_symbols_1F: '[]', lotte_util_lines_1F: JSON.stringify([LINE]) }, VERS = { lotte_symbols_1F: 'v0', lotte_util_lines_1F: 'v0' };
const SAVES = [], BASES = [], RESTORES = [];
let n = 0;
const me = a => { const u = USER[a.p_token]; if (!u) throw new Error('LOGIN'); return u; };
const RPC = {
  ws_bootstrap(a) { return { ok: true, user: me(a), toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_map_load(a) {
    const u = me(a);
    return { ok: true, kv: KV, vers: VERS, bases: {}, canEdit: u.role !== '직원', isBoss: u.role === '소장',
      urls: { avenuel: Object.fromEntries(['6F', '5F', '4F', '3F', '2F', '1F', 'B1'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])),
        dept: Object.fromEntries(['12', '11', '10', '09', '08', '07', '06', '05', '04', '03', '02', '01', 'B1', 'B2', 'B3', 'B4'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])),
        castle: Object.fromEntries(['02', '01', 'B1'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])) } };
  },
  ws_map_save(a) {
    const u = me(a); SAVES.push(a);
    if (u.role === '직원') return { ok: false, error: '지도는 소장·부소장·파트장·옵저버만 고칠 수 있습니다' };
    if ((VERS[a.p_k] || '') !== (a.p_ver || '')) return { ok: false, conflict: true, error: '그사이 김철수님이 이 층을 고쳤습니다. 새로 불러옵니다.' };
    if (a.p_v == null) { delete KV[a.p_k]; delete VERS[a.p_k]; return { ok: true, ver: '' }; }
    KV[a.p_k] = a.p_v; VERS[a.p_k] = 'v' + (++n); return { ok: true, ver: VERS[a.p_k] };
  },
  ws_map_base(a) { me(a); BASES.push(a.p_k); return { ok: true, sha: 'x' }; },
  ws_map_days(a) { me(a); return { ok: true, days: [{ day: YEST, keys: ['lotte_symbols_1F', 'lotte_facility_specs_1F'], by: ['옛사람'] }, { day: TODAY, keys: ['lotte_util_lines_1F'], by: ['홍길동'] }], restores: [] }; },
  ws_map_at(a) { me(a); return { ok: true, kv: { lotte_symbols_1F: '[]', lotte_base_svg_1F: OLD_SVG } }; },
  ws_map_restore(a) { const u = me(a); RESTORES.push(a.p_day); return u.role === '소장' ? { ok: true, n: 1 } : { ok: false, error: '되돌리기는 소장만 할 수 있습니다' }; }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return {
    auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } }
  };
} };`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080"><rect x="9400" y="4000" width="600" height="400" fill="#ddd"/></svg>';
const OLD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="9280 3880 1950 2080"><rect id="old-floor" x="9400" y="4000" width="300" height="300" fill="#ccc"/></svg>';
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) { const f = RPC[u.pathname.slice(5)] || (() => ({ ok: true })); try { j({ data: f(JSON.parse(body || '{}')) }); } catch (e) { j({ err: e.message }); } return; }
    if (u.pathname === '/floor.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(SVG); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : /\.css$/.test(f) ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);

async function open(b, tok, opts) {
  const c = await b.newContext(opts || { viewport: { width: 1280, height: 800 } });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await c.addInitScript(t => { if (location.pathname === '/ws/app.html') localStorage.setItem('ws_token', t); }, tok);
  const p = await c.newPage(); p.errs = []; p.dialogs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', d => { p.dialogs.push(d.message()); p.onDialog ? p.onDialog(d) : d.accept(); });
  await p.goto('http://localhost:' + PORT + '/ws/app.html');
  await p.locator('.grid6').waitFor();
  return p;
}
const mapFrame = p => p.frames().find(x => /\/map\/index\.html$/.test(x.url()));
async function openMap(p) {
  if (p.isMobile) await p.tap('.grid6 .tile:has-text("지도")'); else await p.click('.grid6 .tile:has-text("지도")');
  await p.frameLocator('iframe.mapframe').locator('#map-container svg').waitFor({ timeout: 15000 });
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor();
  return mapFrame(p);
}

(async () => {
  const b = await chromium.launch();
  // ── 소장 · PC ──
  const p = await open(b, TOK.boss);
  const tiles = await p.locator('.grid6 .tile').allInnerTexts();
  ok(tiles.length === 7 && /지도/.test(tiles[5]) && /CAD/.test(tiles[6]) && tiles.filter(t => /작업중/.test(t)).length === 1 && /시방서 검색/.test(tiles[3]) && /자재현황/.test(tiles[4]) && /준비중/.test(tiles[4]), '1) 메인 6번째 칸이 「지도」, 7번째(환경설정 위) 칸이 「CAD」(결정 184), 4번째 「시방서 검색」(결정 140), 5번째 「자재현황 · 준비중」(결정 168), 작업중 1칸');
  let f = await openMap(p);
  ok(new URL(p.url()).pathname === '/ws/app.html' && await f.evaluate(() => !!document.querySelector('#map-container svg rect')), '2) 업무지원 화면 안에서 열림 · 로그인 표로 받은 주소로 그림');
  ok(!fs.readFileSync(path.join(FM, 'map', 'js', 'config', 'floors.js'), 'utf8').includes('amazonaws'), '3) 공개 코드(floors.js)에 도면 주소 없음');
  await p.waitForTimeout(300);
  ok(BASES.includes('lotte_base_svg_1F'), '4) 업체 바탕 도면을 받으면 보관 함수로 보냄 (기록용)');
  ok(await f.evaluate(() => mapStore.canEdit && mapStore.isBoss && !document.querySelector('.ro-chip') && !document.body.classList.contains('map-ro')), '5) 소장: 고치기 가능 (보기 전용 표시 없음)');
  await f.evaluate(() => { mapStore.setItem('lotte_symbols_1F', '[1]'); mapStore.setItem('lotte_symbols_1F', '[1,2]'); mapStore.removeItem('lotte_floor_zones_1F'); });
  await p.waitForTimeout(500);
  const s1 = SAVES.filter(s => s.p_k === 'lotte_symbols_1F');
  ok(s1.length === 2 && s1[0].p_ver === 'v0' && s1[1].p_ver === VERS.lotte_symbols_1F.replace(/\d+$/, m => m - 1) && KV.lotte_symbols_1F === '[1,2]', '6) 저장할 때 판을 같이 보내고, 다음 저장은 받은 새 판으로 (' + s1.map(s => s.p_ver).join(' → ') + ')');
  // 동시 편집: 그사이 다른 사람이 고침
  VERS.lotte_symbols_1F = 'other';
  await f.evaluate(() => { window.__mark = 1; mapStore.setItem('lotte_symbols_1F', '[3]'); });
  await p.waitForFunction(() => { const fr = document.querySelector('iframe.mapframe'); return fr && fr.contentWindow && !fr.contentWindow.__mark && fr.contentWindow.mapStore; }, null, { timeout: 8000 }).catch(() => {});
  ok(p.dialogs.some(m => /그사이 김철수님이/.test(m)) && KV.lotte_symbols_1F === '[1,2]', '7) 동시 편집: 다른 사람이 먼저 고쳤으면 저장 안 하고 알림 → 새로 불러옴');
  VERS.lotte_symbols_1F = 'v9';
  f = mapFrame(p); await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor();
  // Delete 키 (WS 남은 버그)
  p.onDialog = d => d.dismiss();
  await f.evaluate(() => selectUtilLineForDelete(getFloorUtilityLines('1F')[0]));
  p.onDialog = null;
  await f.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })));
  await p.waitForTimeout(400);
  ok(JSON.parse(KV.lotte_util_lines_1F).length === 0, '8) 설비 연결선: 확인 창 취소 뒤에도 선택이 남아 Delete 키로 지움');
  // 기록 달력
  await p.frameLocator('iframe.mapframe').locator('#btn-hist').click();
  const pop = p.frameLocator('iframe.mapframe').locator('.hist-pop');
  await pop.locator('.hist-cal').waitFor();
  const yBtn = pop.locator('button[data-d="' + YEST + '"]');
  if (YEST.slice(0, 7) !== TODAY.slice(0, 7)) await pop.locator('button[data-m="-1"]').click();
  ok(await yBtn.evaluate(e => e.classList.contains('chg')) && /1F 매장 · 1F 심벌|1F 심벌 · 1F 매장/.test(await pop.innerText()), '9) 기록 달력: 바뀐 날 점 · 「1F 매장 · 1F 심벌」');
  await shot(p, 'shot_sb_map_cal.png');
  await yBtn.click();
  await p.frameLocator('iframe.mapframe').locator('.hist-bar').waitFor();
  await p.frameLocator('iframe.mapframe').locator('#old-floor').waitFor({ timeout: 8000 }).catch(() => {});
  const bar = await p.frameLocator('iframe.mapframe').locator('.hist-bar').innerText();
  ok(/기준/.test(bar) && /보기 전용/.test(bar) && /이 날로 되돌리기/.test(bar) && await f.evaluate(() => !!document.querySelector('#old-floor')), '10) 지난 날: 「…기준 · 보기 전용」 띠 · 그때 보관한 업체 도면으로 그림');
  const nSave = SAVES.length;
  await f.evaluate(() => mapStore.setItem('lotte_symbols_1F', '["x"]'));
  await p.waitForTimeout(300);
  ok(SAVES.length === nSave && await f.evaluate(() => document.body.classList.contains('map-ro') && document.getElementById('btn-edit-menu').disabled && /지난 기록/.test(document.getElementById('btn-edit-menu').title)), '11) 지난 날 보기: 저장 안 함 · 편집 버튼 막힘');
  await shot(p, 'shot_sb_map.png');
  await p.frameLocator('iframe.mapframe').locator('#hist-rest').click();
  await p.frameLocator('iframe.mapframe').locator('.hist-dlg .yes').click();
  await p.waitForTimeout(800);
  ok(RESTORES[0] === YEST, '12) 소장: 「이 날로 되돌리기」 → 확인 → 되돌리기 함수');
  f = mapFrame(p); await p.frameLocator('iframe.mapframe').locator('#btn-hist').waitFor();
  ok(await f.evaluate(() => !mapStore.viewAt && !document.querySelector('.hist-bar')), '13) 되돌린 뒤 지금 모습으로 새로 불러옴');
  const ctx = d => d.evaluate(() => !document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  ok(await ctx(p) && await ctx(f), '14) PC 오른쪽 버튼 메뉴 막음 (업무지원 · 지도 둘 다)');
  // 타점 (결정 136): 제목 없음 · [에비뉴엘] [타점 ›] · 밀려 나오는 메뉴로 백화점 → 같은 기능
  const fl = p.frameLocator('iframe.mapframe');
  ok(await f.evaluate(() => !document.querySelector('.main-title') && !/잠실점 쇼핑맵/.test(document.querySelector('header').innerText) && document.querySelectorAll('.mainboard-building-tab').length === 2), '14-1) 「잠실점 쇼핑맵」 글자 없음 · 건물 탭은 에비뉴엘·타점 둘');
  await fl.locator('#btn-other-bld').click(); await fl.locator('#other-drawer.open').waitFor();
  await p.waitForTimeout(300);
  await fl.locator('.other-card[data-building="dept"]').click();
  await fl.locator('#map-container svg rect').first().waitFor(); await p.waitForTimeout(500);
  ok(await f.evaluate(() => currentBuildingId === 'dept' && FLOORS.length === 16 && /타점 · 백화점/.test(document.getElementById('btn-other-bld').innerText) && document.getElementById('btn-other-bld').classList.contains('active') && !document.getElementById('other-drawer').classList.contains('open')), '14-2) 타점 › 백화점: 메뉴 닫히고 백화점 16개 층 지도 · 탭에 「타점 · 백화점」');
  const nD = SAVES.length;
  await f.evaluate(() => mapStore.setItem('lotte_symbols_01_dept', '[9]')); await p.waitForTimeout(300);
  ok(SAVES.length === nD + 1 && SAVES[nD].p_k === 'lotte_symbols_01_dept' && BASES.some(k => /_dept$/.test(k)), '14-3) 백화점도 저장·업체 도면 보관 같게 (칸 이름 끝 _dept)');
  await fl.locator('#btn-other-bld').click(); await fl.locator('#other-drawer.open').waitFor(); await p.waitForTimeout(300);
  await fl.locator('.other-card[data-building="castle"]').click(); await p.waitForTimeout(800);
  ok(await f.evaluate(() => currentBuildingId === 'castle' && FLOORS.length === 3 && /타점 · 캐슬플라자/.test(document.getElementById('btn-other-bld').innerText)), '14-4) 타점 › 캐슬플라자 3개 층');
  await fl.locator('.mainboard-building-tab[data-building="avenuel"]').click(); await p.waitForTimeout(800);
  ok(await f.evaluate(() => currentBuildingId === 'avenuel' && document.getElementById('other-tab-label').textContent === '타점'), '14-5) 에비뉴엘로 돌아오면 탭 글자 「타점」');
  await p.click('.mapback'); await p.locator('.grid6').waitFor();
  ok(!p.errs.length, '15) 화면 오류 없음 (소장)' + (p.errs.length ? ': ' + p.errs.join(' / ') : ''));

  // ── 직원 · 아이패드(터치) ──
  const e = await open(b, TOK.emp, { viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  e.isMobile = true;
  const fe = await openMap(e);
  const nS = SAVES.length;
  await fe.evaluate(() => mapStore.setItem('lotte_symbols_1F', '["e"]'));
  await e.waitForTimeout(300);
  ok(await fe.evaluate(() => !mapStore.canEdit && !!document.querySelector('.ro-chip') && document.body.classList.contains('map-ro') && document.getElementById('btn-edit-menu').disabled && document.getElementById('btn-undo').disabled) && SAVES.length === nS, '16) 직원: 「보기 전용」 표시 · 편집·되돌리기 버튼 꺼짐 · 저장 안 보냄');
  await e.frameLocator('iframe.mapframe').locator('#btn-hist').tap();
  await e.frameLocator('iframe.mapframe').locator('.hist-cal').waitFor();
  if (YEST.slice(0, 7) !== TODAY.slice(0, 7)) await e.frameLocator('iframe.mapframe').locator('.hist-pop button[data-m="-1"]').tap();
  await e.frameLocator('iframe.mapframe').locator('.hist-pop button[data-d="' + YEST + '"]').tap();
  await e.frameLocator('iframe.mapframe').locator('.hist-bar').waitFor();
  ok(await e.frameLocator('iframe.mapframe').locator('#hist-rest').count() === 0, '17) 터치로 기록 달력·지난 날 보기 · 직원은 되돌리기 버튼 없음');
  await e.frameLocator('iframe.mapframe').locator('#hist-back').tap();
  await e.waitForTimeout(400);
  ok(await fe.evaluate(() => !document.querySelector('.hist-bar') && !mapStore.viewAt), '18) 터치로 「오늘로 돌아가기」');
  const ectx = await e.evaluate(() => !document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  ok(!ectx, '19) 터치 기기는 길게 누르기 메뉴 그대로 (오른쪽 버튼 막기는 PC만)');
  ok(!e.errs.length, '20) 화면 오류 없음 (직원·터치)' + (e.errs.length ? ': ' + e.errs.join(' / ') : ''));

  const d = await (await b.newContext()).newPage(); await d.goto('http://localhost:' + PORT + '/map/index.html'); await d.waitForTimeout(500);
  ok(/업무지원 앱에서/.test(await d.locator('body').innerText()) && await d.locator('#map-container svg').count() === 0, '21) 지도 주소를 바로 열면 자료 없이 안내만');
  await b.close(); srv.close();
  console.log(fail ? '\n지도 시험 실패 ' + fail + '개' : '\n지도 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
async function shot(p, name) { await p.screenshot({ path: path.join(__dirname, '..', name) }); }
