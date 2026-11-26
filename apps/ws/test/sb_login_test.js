// Supabase 이관 3-1 화면 시험: 기기 등록 → PIN → 서명 → 메인 → 환경설정 「기기 등록 풀기」 (fm/ws/app.html)
// 진짜 Supabase 대신 가짜(이 파일 안 FAKE)를 씀 — 화면 흐름만 봄. DB 함수(02_login.sql) 자체 시험은 따로.
// 먼저: python tools/build_fm.py   그다음: node test/sb_login_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8131;

/* 가짜 DB 함수 — 02_login.sql 과 같은 답 모양 */
const DB = { staff: [{ staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장', pin: '1234' }], signs: [], sessions: {}, fails: 0 };
const day = () => new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3).toISOString().slice(0, 10);
const RPC = {
  ws_admin_staff: () => ({ ok: true, toastSec: 2.6, staff: [{ staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }] }),
  ws_risk_get: () => ({ ok: true, rows: [] }),
  ws_login(a) {
    const me = DB.staff.find(s => s.pin === a.p_pin);
    if (!me) { DB.fails++; return { ok: false, error: 'PIN이 맞지 않습니다. (' + DB.fails + '/5)' }; }
    if (!DB.signs.some(s => s.staff_id === me.staff_id && s.day === day())) {
      if (!a.p_sign_url) return { ok: false, needSign: true, name: me.name, part: me.part, day: day() };
      if (!/^sign\//.test(a.p_sign_path || '')) throw new Error('서명이 비어 있습니다. 다시 써 주세요.');
      DB.signs.push({ staff_id: me.staff_id, day: day(), url: a.p_sign_url });
    }
    const tok = me.staff_id + '.' + (Date.now() + 3600e3) + '.' + Math.random().toString(16).slice(2);
    DB.sessions[tok] = me.staff_id;
    return { ok: true, token: tok, user: { staff_id: me.staff_id, name: me.name, part: me.part, role: me.role } };
  },
  ws_bootstrap(a) {
    const id = DB.sessions[a.p_token]; if (!id) throw new Error('LOGIN');
    const me = DB.staff.find(s => s.staff_id === id);
    return { ok: true, user: { staff_id: me.staff_id, name: me.name, part: me.part, role: me.role }, toastSec: 2.6, needSign: false,
      docs: { day: day(), signs: DB.signs.length }, fire: { counts: { ok: 3, bad: 0, wait: 2, miss: 0, total: 5 }, window: { start: 1, end: 5 }, day: 14, ym: day().slice(0, 7) } };
  },
  ws_logout(a) { delete DB.sessions[a.p_token]; return null; }
};
const FAKE = `window.supabase = { createClient() {
  const K = 'fake_sb_session', get = () => { try { return JSON.parse(localStorage.getItem(K)); } catch (e) { return null; } };
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return {
    auth: {
      async getSession() { if (localStorage.getItem('fake_sb_fail')) return { data: { session: null }, error: { message: 'Failed to fetch' } }; return { data: { session: get() } }; },
      async signInWithPassword(c) {
        if (c.email === 'team@avenuel-fm.app' && c.password === 'team-pass-1') { localStorage.setItem(K, JSON.stringify({ user: { email: c.email } })); return { error: null }; }
        return { error: { message: 'Invalid login credentials' } };
      },
      async signOut() { localStorage.removeItem(K); return { error: null }; }
    },
    async rpc(fn, args) { if (!get()) return { data: null, error: { message: 'permission denied' } }; const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return {
      async upload(p, blob) { if (!get()) return { error: { message: 'row-level security' } }; let corner = null, ink = 0; if (blob.type === 'image/png') { const bm = await createImageBitmap(blob), c = new OffscreenCanvas(bm.width, bm.height).getContext('2d'); c.drawImage(bm, 0, 0); const d = c.getImageData(0, 0, bm.width, bm.height).data; corner = d[3]; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) ink++; } await post('/upload', { p, type: blob.type, size: blob.size, corner, ink }); return { error: null }; },
      getPublicUrl(p) { return { data: { publicUrl: location.origin + '/public/' + p } }; } }; } }
  };
} };`;
const UPLOADS = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) { try { j({ data: RPC[u.pathname.slice(5)](JSON.parse(body || '{}')) }); } catch (e) { j({ err: e.message }); } return; }
    if (u.pathname === '/upload') { UPLOADS.push(JSON.parse(body)); return j({}); }
    if (u.pathname === '/fake-supabase.js') { res.setHeader('content-type', 'application/javascript'); return res.end(FAKE); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, deviceScaleFactor: 2 });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:' + PORT + '/ws/app.html');
  await p.locator('.devcard').waitFor();
  ok(await p.locator('.key').count() === 0, '1) 처음 열면 기기 등록 화면 (PIN 화면 아님)');
  ok(/사이트 데이터 삭제/.test(await p.locator('.devwhy').innerText()), '1-1) 처음(기록 없음)엔 「닫을 때 사이트 데이터 삭제」 끄기 안내');
  await p.fill('#devE', 'team@avenuel-fm.app'); await p.fill('#devP', 'wrong');
  await p.click('.devcard button[type=submit]'); await p.waitForFunction(() => document.querySelector('.devmsg') && document.querySelector('.devmsg').textContent);
  ok(/맞지 않습니다/.test(await p.locator('.devmsg').innerText()) && await p.inputValue('#devE') === 'team@avenuel-fm.app', '2) 틀리면 빨간 안내, 이메일은 남음');
  await p.fill('#devP', 'team-pass-1'); await p.click('.devcard button[type=submit]');
  await p.locator('.key').first().waitFor();
  ok(await p.locator('.devchip').count() === 1, '3) 등록하면 PIN 화면 + 「등록된 기기」');
  await p.reload(); await p.locator('.key').first().waitFor();
  ok(await p.locator('.devcard').count() === 0, '4) 다시 열어도 기기 등록을 묻지 않음 (기억)');
  // 결정 286: 등록 기록은 남았는데 켤 때 새로 받기만 실패 → 등록 화면 대신 「연결 확인 중」, 되면 저절로 PIN
  await p.evaluate(() => { localStorage.setItem('ws_sb_auth', '{}'); localStorage.setItem('fake_sb_fail', '1'); });
  await p.reload(); await p.locator('.devwait').waitFor();
  ok(await p.locator('.devcard').count() === 0, '4-1) 불러오기 실패면 등록 화면이 아니라 「연결을 확인하는 중」');
  await p.evaluate(() => localStorage.removeItem('fake_sb_fail'));
  await p.locator('.key').first().waitFor({ timeout: 8000 });
  ok(true, '4-2) 연결되면 저절로 PIN 화면 (다시 등록 안 함)');
  await p.evaluate(() => localStorage.removeItem('ws_sb_auth'));
  for (const k of '1234') await p.click(`.key:text-is("${k}")`);
  await p.locator('#spad canvas.i').waitFor();
  ok(true, '5) PIN 맞으면 근무일 첫 서명 화면');
  const bb = await p.locator('#spad canvas.i').boundingBox();
  await p.mouse.move(bb.x + bb.width * .1, bb.y + bb.height * .5); await p.mouse.down();
  for (const [x, y] of [[.3, .2], [.5, .8], [.7, .3], [.9, .6]]) await p.mouse.move(bb.x + bb.width * x, bb.y + bb.height * y, { steps: 5 });
  await p.mouse.up(); await p.click('#sGo');
  await p.locator('.grid6').waitFor();
  ok(UPLOADS.length === 1 && /^sign\/\d{4}-\d{2}\/[a-z0-9]+\.png$/.test(UPLOADS[0].p) && UPLOADS[0].type === 'image/png', '6) 서명 PNG를 버킷 sign/ 아래 영문 경로로 올림 ' + (UPLOADS[0] || {}).p);
  ok(UPLOADS[0] && UPLOADS[0].corner === 0 && UPLOADS[0].ink > 0, '6-1) 서명 PNG 바탕은 투명, 글씨만 남음 (모서리 투명도 ' + (UPLOADS[0] || {}).corner + ', 글씨 점 ' + (UPLOADS[0] || {}).ink + ')');
  ok(/소화기/.test(await p.locator('.grid6').innerText()), '7) 메인 화면 (소화기 칸)');
  await p.click('button:text-is("환경설정")');
  await p.locator('.card.strow', { hasText: 'team@avenuel-fm.app' }).waitFor({ timeout: 5000 }).catch(() => {});
  ok(/위험성 목록 0줄/.test(await p.locator('.wrap.list').innerText()), '8) 환경설정이 Supabase에서 열림 (3-6: 직원 목록·위험성 목록)');
  ok(/team@avenuel-fm\.app/.test(await p.locator('.card.strow').last().innerText()), '9) 환경설정 「이 기기」에 등록된 계정');
  await p.screenshot({ path: 'shot_sb_set.png', fullPage: true });
  await p.click('button:text-is("기기 등록 풀기")'); await p.locator('.devcard').waitFor();
  ok(await p.evaluate(() => !localStorage.getItem('fake_sb_session') && !localStorage.getItem('ws_token')), '10) 등록 풀면 기기 등록 화면, 표도 지움');
  await p.evaluate(() => localStorage.setItem('ws_dev_at', '2026-11-26')); await p.reload(); await p.locator('.devcard').waitFor();   // 서버에서 풀린 경우 흉내
  ok(/등록이 풀렸습니다/.test(await p.locator('.devwhy').innerText()), '10-1) 등록한 날은 남고 로그인만 없으면 「등록이 풀렸습니다」 안내');
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '11) 휴대폰 옆으로 넘침 없음');
  await p.screenshot({ path: 'shot_sb_device.png' });
  const z = await p.evaluate(async () => {   // 사진 줄이기: 3000×2000 → 긴 쪽 1200 이하 JPEG
    const cv = document.createElement('canvas'); cv.width = 3000; cv.height = 2000; const g = cv.getContext('2d');
    for (let i = 0; i < 400; i++) { g.fillStyle = 'hsl(' + i + ',70%,50%)'; g.fillRect(Math.random() * 3000, Math.random() * 2000, 200, 200); }
    const big = await new Promise(r => cv.toBlob(r, 'image/png'));
    const out = await WS_API.compressImage(big), im = await createImageBitmap(out);
    return { type: out.type, w: im.width, h: im.height, before: big.size, after: out.size };
  });
  ok(z.type === 'image/jpeg' && z.w === 1200 && z.h === 800 && z.after < z.before, '12) 사진 줄이기 3000×2000 → ' + z.w + '×' + z.h + ' JPEG (' + Math.round(z.before / 1024) + 'KB → ' + Math.round(z.after / 1024) + 'KB)');
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  // 바꿔 타는 날 스위치: 바로가기 페이지(index.html)가 config.js LIVE 를 보고 감
  const cfg = fs.readFileSync(path.join(FM, 'ws', 'config.js'), 'utf8');
  ok(/LIVE: true,/.test(cfg), '13) 지금 config.js 는 LIVE: true (11-14 바꿔 탐 — Supabase 앱)');
  await c.route('https://script.google.com/**', r => r.fulfill({ contentType: 'text/html', body: '<p>google</p>' }));
  const go = async (live, q) => {
    await c.unroute('**/ws/config.js');
    await c.route('**/ws/config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfg.replace(/LIVE: (true|false),/, 'LIVE: ' + live + ',') }));
    const g = await c.newPage(); await g.goto('http://localhost:' + PORT + '/ws/index.html' + q); await g.waitForTimeout(400);   // GitHub Pages 는 /ws/ 에 index.html 을 보여 줌
    const u = new URL(g.url()), fr = await g.locator('iframe').getAttribute('src').catch(() => null); await g.close();
    return u.pathname.replace('/ws/', '') + u.search + (fr ? ' → ' + fr : '');
  };
  const r1 = await go(true, ''), r2 = await go(true, '?fe=abc123def456'), r3 = await go(true, '?eh=xyz789xyz789');
  ok(r1 === 'app.html' && r2 === 'check-sb.html?fe=abc123def456' && r3 === 'eh-sb.html?eh=xyz789xyz789', '14) LIVE: true → 앱·소화기 QR·전열필증 QR 이 Supabase 화면으로 (' + [r1, r2, r3].join(' / ') + ')');
  const r4 = await go(false, '?fe=abc123def456'), r5 = await go(false, '?eh=xyz789xyz789');
  ok(r4 === 'check.html?fe=abc123def456' && /^index\.html\?eh=xyz789xyz789 → https:\/\/script\.google\.com\/.+\/exec\?eh=xyz789xyz789$/.test(r5), '15) LIVE: false 로 되돌리면 옛 구글 앱 (' + r4 + ' / ' + r5 + ')');
  await b.close(); srv.close();
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
