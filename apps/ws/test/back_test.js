// 안드로이드·아이폰 뒤로가기(브라우저 기록) 시험 (결정 244): 한 단계씩 위로 · 메인에서 안 쌓임 · 확인창 취소 시 제자리 · 대화창 먼저 닫음
// 먼저: python tools/build_fm.py   그다음: node test/back_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm'), PORT = 8135, BASE = 'http://localhost:' + PORT;
const TOK = 'S003.' + (Date.now() + 3600e3) + '.emp';
const RPC = { ws_bootstrap: () => ({ ok: true, user: { staff_id: 'S003', name: '이영희', part: '전방파트', role: '직원' }, toastSec: 2.6, needSign: false, docs: { signs: 0 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 } } }), ws_menu: () => ({ ok: true, off: [] }) };
const FAKE = `window.supabase = { createClient() { const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return { auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } } }; } };`;
const srv = http.createServer((req, res) => {
  req.on('data', () => {}); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/rpc/')) { const f = RPC[u.pathname.slice(5)] || (() => ({ ok: true })); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: f() })); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 400, height: 800 } });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route(/fonts\.googleapis|cdnjs\.cloudflare/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.addInitScript(t => localStorage.setItem('ws_token', t), TOK);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/ws/app.html'); await p.locator('.grid6').waitFor();
  const view = () => p.evaluate(() => S.view), len = () => p.evaluate(() => history.length);
  const settle = () => p.waitForTimeout(250);
  const back = async () => { await p.evaluate(() => history.back()); await settle(); };
  const l0 = await len();
  await p.evaluate(() => go('docs')); await p.evaluate(() => go('tbm')); await settle();
  ok(await view() === 'tbm' && await len() === l0 + 2, '1) 화면 이동마다 기록이 한 칸씩 쌓임');
  await back(); ok(await view() === 'docs', '2) 뒤로가기 → 한 단계 위(서류작업)');
  await back(); ok(await view() === 'main', '3) 뒤로가기 → 메인');
  await p.evaluate(() => go('docs')); await settle();
  await p.evaluate(() => back()); await settle();   // 화면의 「← 뒤로」 단추 흐름
  ok(await view() === 'main' && await len() === l0 + 1, '4) 화면 뒤로 단추 후 기록도 같이 정리됨(메인에서 더 안 쌓임)');
  await p.evaluate(() => { go('docs'); go('tbm'); S.tbm = S.tbm || {}; S.tbm.dirty = true; }); await settle();
  let asked = 0; p.once('dialog', d => { asked++; d.dismiss(); });
  await back();
  ok(asked === 1 && await view() === 'tbm', '5) 저장 안 한 내용: 뒤로가기 → 확인창 → 취소하면 그 화면에 머묾');
  await back(); // 확인창이 다시 떠야 함 (기록이 어긋나지 않음)
  p.once('dialog', d => { asked++; d.accept(); }); await back();
  ok(asked >= 2 && await view() === 'docs', '6) 취소 후에도 기록 정상 · 다시 누르고 확인하면 위 화면으로');
  await p.evaluate(() => dialog('<p>시험</p>')); await settle();
  await back();
  ok(await view() === 'docs' && !(await p.locator('#layer > *').count()), '7) 대화창이 열려 있으면 뒤로가기는 대화창만 닫음');
  await back(); ok(await view() === 'main', '8) 그다음 뒤로가기는 화면 이동');
  await p.evaluate(() => go('cad')); await settle();
  ok(await p.locator('button:has-text("뒤로")').count() === 1 && await p.locator('.mapback').count() === 1, '8-2) CAD 화면: 뒤로 단추는 왼쪽 아래 하나만');
  await back();
  ok(!errs.length, '9) 화면 오류 없음 ' + errs.join(' / '));
  await b.close(); srv.close();
  console.log(fail ? '\n뒤로가기 시험 실패 ' + fail + '개' : '\n뒤로가기 시험 통과'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
