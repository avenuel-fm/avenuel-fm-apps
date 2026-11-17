// 도면협의 Supabase 판 화면 시험 (fm/dw/app.html): 기기 등록 → PIN → 대시보드 → 매장 → 발송 기록 PDF 「열기」 → 앱 안 PDF 보기 → 기기 등록 풀기
// 진짜 Supabase 대신: 화면 쪽은 가짜 supabase-js(아래 FAKE), DB 함수는 PGlite 에 supabase/01~04 를 그대로 올려 실제로 돌림
// pdf.js 는 cdnjs 에서 받음 (인터넷 필요). 먼저 python tools/build_fm.py  그다음 node test/sb_ui_test.js [사진 폴더]
const http = require('http'), fs = require('fs'), path = require('path');
const { BASE, FILES, SQL, H, NM } = require('./sb_sql_test.js');
const wsRequire = require('module').createRequire(path.join(NM, 'x.js'));
const { PGlite } = wsRequire('@electric-sql/pglite');
const { pgcrypto } = wsRequire('@electric-sql/pglite/contrib/pgcrypto');
const { chromium } = wsRequire('playwright');
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const OUT = process.argv[2] || '';
const PORT = 8141;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

/** 한 쪽짜리 작은 PDF (글자 한 줄) */
function tinyPdf() {
  const st = 'BT /F1 24 Tf 72 720 Td (DW test PDF) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + st.length + ' >>\nstream\n' + st + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let s = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(s.length); s += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = s.length;
  s += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(s + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n', 'latin1');
}

const FAKE = `window.supabase = { createClient() {
  const K = 'fake_sb_session', get = () => { try { return JSON.parse(localStorage.getItem(K)); } catch (e) { return null; } };
  const post = (u, b, raw) => fetch(u, { method: 'POST', body: raw || JSON.stringify(b) }).then(r => r.json());
  return {
    auth: {
      async getSession() { return { data: { session: get() } }; },
      async signInWithPassword(c) {
        if (c.email === 'team@avenuel-fm.app' && c.password === 'team-pass-1') { localStorage.setItem(K, JSON.stringify({ user: { email: c.email } })); return { error: null }; }
        return { error: { message: 'Invalid login credentials' } };
      },
      async signOut() { localStorage.removeItem(K); return { error: null }; }
    },
    async rpc(fn, args) { const r = await post('/rpc/' + fn + '?role=' + (get() ? 'authenticated' : 'anon'), args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return {
      async upload(p, blob) { if (!get()) return { error: { message: 'row-level security' } }; await post('/upload?p=' + encodeURIComponent(p) + '&t=' + encodeURIComponent(blob.type), null, blob); return { error: null }; },
      getPublicUrl(p) { return { data: { publicUrl: location.origin + '/public/' + p } }; } }; } }
  };
} };`;

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(BASE);
  for (const f of FILES) await db.exec(SQL(f));
  await db.query("insert into dw_settings values ('PIN_소장', $1), ('PIN_부소장', $2)", [H('1234'), H('5678')]);
  const BUCKET = { 'pdf/2026-11/a1.pdf': { type: 'application/pdf', body: tinyPdf() } };
  const pdfUrl = 'http://localhost:' + PORT + '/public/pdf/2026-11/a1.pdf';
  await db.query('insert into dw_stores (id, seq, data) values ($1, 1, $2)', ['11111111-2222-3333-4444-555555555555', JSON.stringify({
    docNo: '에비뉴엘컨펌_001_261114', tenant: '시험매장', status: '협의중', createdAt: '2026-11-14 09:00', updatedAt: '2026-11-14 09:00',
    sendLog: JSON.stringify([{ t: 'pdf', at: '2026-11-14 09:30:00', d: '1차 검토서 PDF', round: 1, url: pdfUrl, by: '소장' }]) })]);
  const calls = [];
  let lock = Promise.resolve();
  const rpc = (fn, args, role) => (lock = lock.then(async () => {   // PGlite 는 한 번에 하나씩
    calls.push(fn);
    const ks = Object.keys(args || {}), v = ks.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
    await db.exec('set role ' + role);
    try { return (await db.query('select public.' + fn + '(' + ks.map((k, i) => k + ' => $' + (i + 1)).join(', ') + ') r', v)).rows[0].r; }
    finally { await db.exec('reset role'); }
  }));

  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', async () => {
      const u = new URL(req.url, 'http://x'), body = Buffer.concat(chunks);
      const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (u.pathname.startsWith('/rpc/')) {
        const role = u.searchParams.get('role') === 'authenticated' ? 'authenticated' : 'anon';
        try { j({ data: await rpc(u.pathname.slice(5), JSON.parse(String(body) || '{}'), role) }); } catch (e) { j({ err: e.message }); }
        return;
      }
      if (u.pathname === '/upload') { BUCKET[u.searchParams.get('p')] = { type: u.searchParams.get('t'), body }; return j({}); }
      if (u.pathname.startsWith('/public/')) {
        const o = BUCKET[decodeURIComponent(u.pathname.slice(8))];
        if (!o) { res.statusCode = 404; return res.end(); }
        res.setHeader('content-type', o.type); res.setHeader('access-control-allow-origin', '*'); return res.end(o.body);
      }
      const f = path.join(FM, decodeURIComponent(u.pathname));
      if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
      res.end(fs.readFileSync(f));
    });
  }).listen(PORT);

  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, deviceScaleFactor: 2 });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const shot = n => OUT ? p.screenshot({ path: path.join(OUT, n + '.png') }) : null;
  const errText = () => p.locator('.err').first().textContent();

  await p.goto('http://localhost:' + PORT + '/dw/app.html');
  await p.locator('#deviceForm').waitFor();
  ok(await p.locator('#loginForm').count() === 0, '1) 처음 열면 기기 등록 화면 (PIN 화면 아님)');
  await shot('sb_1_기기등록');
  await p.fill('#devE', 'team@avenuel-fm.app'); await p.fill('#devP', 'wrong');
  await p.click('#deviceForm button[type=submit]');
  await p.waitForFunction(() => (document.querySelector('#deviceForm .err') || {}).textContent);
  ok(/맞지 않습니다/.test(await errText()), '2) 틀린 비밀번호 → 안내 글');
  await p.fill('#devP', 'team-pass-1'); await p.click('#deviceForm button[type=submit]');
  await p.locator('#loginForm').waitFor();
  ok(await p.locator('[data-act=devoff]').count() === 1, '3) 등록되면 PIN 화면 + 「기기 등록 풀기」');
  await shot('sb_2_PIN');

  await p.fill('#pin', '0000'); await p.click('#loginForm button[type=submit]');
  await p.waitForFunction(() => (document.querySelector('#loginErr') || {}).textContent);
  ok(/PIN/.test(await p.locator('#loginErr').textContent()), '4) 틀린 PIN → 안내 (DB 가 틀린 횟수 기록)');
  ok(JSON.parse((await db.query("select value from dw_settings where key = 'PIN_FAIL'")).rows[0].value).n >= 1, '   DB PIN_FAIL 에 1번 이상 기록');
  await p.fill('#pin', '1234'); await p.click('#loginForm button[type=submit]');
  await p.locator('[data-act=open]').first().waitFor();
  ok(await p.locator('text=시험매장').count() > 0, '5) PIN 1234 → 대시보드에 DB 매장(시험매장)');
  ok(calls.includes('dw_start') || calls.includes('dw_login'), '   로그인은 DB 함수로');
  await shot('sb_3_대시보드');

  await p.locator('[data-act=open]').first().click();
  const link = p.locator('#specRec a[data-pv]');
  await link.waitFor({ timeout: 15000 });
  ok(true, '6) 매장 열면 발송 기록에 PDF 「열기」 (data-pv)');
  await link.scrollIntoViewIfNeeded();
  const pages = c.pages().length;
  await link.click();
  await p.locator('#pvLayer').waitFor();
  try {
    await p.waitForFunction(() => { const cv = document.querySelector('#pvC1'); return cv && cv.width > 0; }, null, { timeout: 30000 });
    ok(true, '7) 앱 안 PDF 보기: 1쪽 그림 (새 창 안 열림)');
  } catch (e) { ok(false, '7) 앱 안 PDF 보기 — ' + ((await p.locator('#pvLayer').textContent()) || e.message).slice(0, 120)); }
  ok(c.pages().length === pages, '   새 창 없음');
  ok(/1쪽/.test(await p.locator('.pv-name small').textContent()), '   위에 쪽 수 표시');
  await shot('sb_4_PDF보기');
  await p.click('[data-pv-act=zin]');
  ok(/150%/.test(await p.locator('.pv-zoom span').textContent()), '8) 크게(+) → 150%');
  await p.waitForFunction(() => { const cv = document.querySelector('#pvC1'); return cv && parseInt(cv.style.width, 10) > 400; }, null, { timeout: 15000 });
  const dl = p.waitForEvent('download', { timeout: 10000 });
  await p.click('[data-pv-act=down]');
  ok(/\.pdf$/.test((await dl).suggestedFilename()), '9) 내려받기 → .pdf 파일');
  await p.click('[data-pv-act=close]');
  ok(await p.locator('#pvLayer').count() === 0 && !(await p.evaluate(() => document.documentElement.classList.contains('pv-open'))), '10) 뒤로 → 보기 닫힘, 매장 화면 그대로');

  // 서명칸 손바닥 무시: 펜이 한 번 닿으면 터치는 안 그림, 펜 전 손바닥 자국은 지움
  await p.locator('[data-act=sig]').first().click();
  await p.locator('#sigc').waitFor();
  const ink = () => p.evaluate(() => { const c = document.querySelector('#sigc'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  const stroke = (type, id, y) => p.evaluate(([type, id, y]) => {
    const c = document.querySelector('#sigc'), r = c.getBoundingClientRect(), o = (t, x) => c.dispatchEvent(new PointerEvent(t, { pointerType: type, pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, pressure: 0.5 }));
    o('pointerdown', 20); for (let x = 30; x <= 200; x += 10) o('pointermove', x); o('pointerup', 200);
  }, [type, id, y]);
  await stroke('touch', 11, 40); const a1 = await ink();
  await stroke('pen', 22, 90); const a2 = await ink();
  await stroke('touch', 12, 140); const a3 = await ink();
  ok(a1 > 0, '12-1) 서명칸: 펜 전에는 손가락으로 그려짐');
  ok(a2 > 0 && a2 === a3, '12-2) 펜이 닿은 뒤 손바닥(터치)은 안 그려짐');
  ok(await p.evaluate(() => { const c = document.querySelector('#sigc'), d = c.getContext('2d').getImageData(0, 0, c.width, Math.floor(c.height * 0.25)).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }), '12-3) 펜 전 손바닥 자국은 지워짐');
  ok(await p.locator('.gv, video').count() === 0, '12-4) 서명칸 안내 동영상 없음');
  await p.click('#sigCancel');

  // 서명란 연락처 자동 입력 (결정 139) + 대시보드 날짜 한 줄
  await db.query("insert into dw_stores values ('ct', 2, '{}')");
  await db.query("insert into dw_reviews (id, store_id, round, data) values ('ct1', 'ct', 1, $1)", [JSON.stringify({ savedAt: '2026-11-10 10:00:00', safetyName: '김안전', safetyTel: '010-1234-5678' })]);
  await p.locator('[data-act=dash]').first().click();
  await p.locator('[data-act=new]').first().waitFor();
  ok(await p.evaluate(() => !document.querySelector('td.c-open br')), '13) 대시보드 오픈 예정일: 날짜와 D-표시 한 줄 (줄바꿈 없음)');
  await p.locator('[data-act=new]').first().click();
  await p.locator('#f-safetyName').waitFor();
  await p.waitForFunction(() => (document.querySelector('#dl-safety') || {}).children && document.querySelector('#dl-safety').children.length > 0, null, { timeout: 15000 });
  await p.fill('#f-safetyName', '김안전'); await p.locator('#f-safetyName').dispatchEvent('change');
  ok(await p.inputValue('#f-safetyTel') === '010-1234-5678', '14) 새 양식: 안전관리팀 성명 넣으면 연락처 자동');
  ok(await p.locator('#f-respName[list]').count() === 0 && await p.locator('#f-ownerName[list]').count() === 0, '   공사 책임자·발주처 성명은 대상 아님');

  await p.reload();
  await p.waitForFunction(() => document.querySelector('[data-act=open]') || document.querySelector('#loginForm'));
  ok(await p.locator('#deviceForm').count() === 0, '11) 다시 열면 기기 등록 안 물음');
  await p.evaluate(() => { localStorage.removeItem('dr_auth'); });
  await p.reload(); await p.locator('#loginForm').waitFor();
  await p.click('[data-act=devoff]');
  await p.click('button:text-is("등록 풀기")');
  await p.locator('#deviceForm').waitFor();
  ok(true, '12) 「기기 등록 풀기」 → 다시 기기 등록 화면');

  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n실패 ' + fail + '개' : '\n도면협의 Supabase 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
