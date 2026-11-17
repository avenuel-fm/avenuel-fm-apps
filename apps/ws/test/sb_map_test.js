// 지도 화면 시험 (결정 130): 메인 「지도」 칸 → 업무지원 안에 도면 앱(fm/map) → 자료는 PIN 표로만 받고 저장 · PC 오른쪽 버튼 막음
// 진짜 Supabase 대신 가짜 DB 함수(이 파일 RPC). DB 함수 자체는 sql_test.js (13_map.sql)
// 먼저: python tools/build_fm.py   그다음: node test/sb_map_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8133;

const TOK = 'S001.' + (Date.now() + 3600e3) + '.abc';
const KV = { lotte_symbols_1F: '[]' }, SAVES = [];
const ME = { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '직원' };
const auth = a => { if (a.p_token !== TOK) throw new Error('LOGIN'); };
const RPC = {
  ws_bootstrap(a) { auth(a); return { ok: true, user: ME, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }; },
  ws_map_load(a) { auth(a); return { ok: true, kv: KV, urls: { avenuel: Object.fromEntries(['6F', '5F', '4F', '3F', '2F', '1F', 'B1'].map(f => [f, 'http://localhost:' + PORT + '/floor.svg'])) } }; },
  ws_map_save(a) { auth(a); SAVES.push(a); if (a.p_v == null) delete KV[a.p_k]; else KV[a.p_k] = a.p_v; return { ok: true }; }
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
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) { try { j({ data: RPC[u.pathname.slice(5)](JSON.parse(body || '{}')) }); } catch (e) { j({ err: e.message }); } return; }
    if (u.pathname === '/floor.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end(SVG); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : /\.css$/.test(f) ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } });   // PC (마우스)
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await c.addInitScript(t => { if (location.pathname === '/ws/app.html') localStorage.setItem('ws_token', t); }, TOK);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + PORT + '/ws/app.html');
  await p.locator('.grid6').waitFor();
  const tiles = await p.locator('.grid6 .tile').allInnerTexts();
  ok(tiles.length === 6 && /지도/.test(tiles[5]) && tiles.filter(t => /작업중/.test(t)).length === 3, '1) 메인 6번째(환경설정 위) 칸이 「지도」, 나머지 작업중 3칸 그대로');
  await p.click('.grid6 .tile:has-text("지도")');
  const fr = p.frameLocator('iframe.mapframe');
  await fr.locator('#map-container svg').waitFor({ timeout: 15000 });
  ok(new URL(p.url()).pathname === '/ws/app.html', '2) 지도가 업무지원 화면 안에서 열림 (주소창은 app.html 그대로)');
  const f = p.frames().find(x => /\/map\/index\.html$/.test(x.url()));
  ok(f && await f.evaluate(() => !!document.querySelector('#map-container svg rect')), '3) 로그인 표로 받은 층 도면 주소로 그림을 그림');
  ok(!fs.readFileSync(path.join(FM, 'map', 'js', 'config', 'floors.js'), 'utf8').includes('amazonaws'), '4) 공개 코드(floors.js)에 도면 주소 없음');
  ok(await f.evaluate(() => mapStore.getItem('lotte_symbols_1F')) === '[]', '5) 저장 칸을 DB에서 받아 둠');
  await f.evaluate(() => { mapStore.setItem('lotte_util_lines_1F', '[{"id":"x"}]'); mapStore.removeItem('lotte_symbols_1F'); });
  await p.waitForTimeout(400);
  ok(SAVES.length === 2 && KV.lotte_util_lines_1F === '[{"id":"x"}]' && !('lotte_symbols_1F' in KV), '6) 고치면 DB 함수로 저장·지움 (' + SAVES.map(s => s.p_k).join(', ') + ')');
  const ctx = d => d.evaluate(() => !document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  ok(await ctx(p) && await ctx(f), '7) PC 오른쪽 버튼 메뉴 막음 (업무지원 · 지도 둘 다)');
  await p.screenshot({ path: 'shot_sb_map.png' });
  await p.click('.backbar button'); await p.locator('.grid6').waitFor();
  ok(true, '8) [뒤로] → 메인');
  const d = await c.newPage(); await d.goto('http://localhost:' + PORT + '/map/index.html'); await d.waitForTimeout(500);
  ok(/업무지원 앱에서/.test(await d.locator('body').innerText()) && await d.locator('#map-container svg').count() === 0, '9) 지도 주소를 바로 열면 자료 없이 안내만');
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n지도 시험 실패 ' + fail + '개' : '\n지도 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
