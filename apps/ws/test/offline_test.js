// 오프라인 임시 저장 화면 시험 (결정 222): 신호 끊김 → 저장 대기 → 다시 열어도 남음 → 복구되면 자동 전송 · 같은 입력은 한 번만
// 진짜 Supabase 대신 가짜 서버(MODE: up 정상 / down 연결 끊김 / lose 서버는 저장했지만 응답을 못 받음)
// 먼저: python tools/build_fm.py   그다음: node test/offline_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm'), PORT = 8147;
const TK = 'S001.' + (Date.now() + 3600e3) + '.abc';
const D = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const ME = { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' };
let MODE = 'up';
const CLIM = [], SEEN = new Set(), CHECKS = [], CALLS = [], UPLOADS = [];
const ZONES = [['6F', '1구역'], ['6F', '2구역']];
const climGet = () => ({ ok: true, day: D, zones: ZONES, recs: CLIM.slice() });
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: ME, toastSec: 1, needSign: false, docs: { day: D, signs: 1 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 }, window: { start: 1, end: 5 }, day: 14, ym: D.slice(0, 7) } }),
  ws_menu: () => ({ ok: true, off: [] }), ws_usage_todo: () => ({ ok: true, day: D, when: '오늘', hvac: 0, curtain: 0 }),
  ws_climate_get: climGet,
  ws_climate_add: a => {   // 진짜 DB 함수와 같은 규칙: 입력 번호가 같으면 한 번만
    if (!a.p_cid || !SEEN.has(a.p_cid)) { if (a.p_cid) SEEN.add(a.p_cid); a.p_rows.forEach(r => CLIM.push({ at: '14:05', floor: r.floor, zone: r.zone, t: Number(r.t), h: Number(r.h), di: 0 })); }
    return climGet();
  },
  ws_check_init: () => ({ ok: true, fe: { name: '카페-소화기1', floor: '1F', store: '카페' }, ym: D.slice(0, 7), monthLabel: '이번 달', window: { start: 1, end: 5 }, day: 14, late: false, early: false, exists: false, photo: { w: 640, q: 0.6 } }),
  ws_check_submit: a => { const c = CHECKS.find(x => x.cid === a.p_d.client_id); if (c) return { ok: true, again: true, checkId: c.id }; CHECKS.push({ cid: a.p_d.client_id, id: 'WS-FC-1' }); return { ok: true, state: a.p_d.state, checkId: 'WS-FC-1' }; }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return {
    auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; }, async signOut() { return {}; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return {
      async upload(p, b, o) { try { const r = await fetch('/up?p=' + encodeURIComponent(p), { method: 'POST', body: 'x' }); const j = await r.json(); return j.dup ? { error: { message: 'The resource already exists', statusCode: '409' } } : { error: null }; } catch (e) { return { error: { message: 'Failed to fetch' } }; } },
      getPublicUrl(p) { return { data: { publicUrl: 'https://x/' + p } }; } }; } }
  };
} };`;
http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'), j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/') || u.pathname === '/up') {
      if (MODE === 'down') return req.socket.destroy();
      if (u.pathname === '/up') { const p = u.searchParams.get('p'), dup = UPLOADS.includes(p); UPLOADS.push(p); if (MODE === 'lose') return req.socket.destroy(); return j({ dup }); }
      const fn = u.pathname.slice(5), a = JSON.parse(body || '{}');
      CALLS.push({ fn, a });
      if (!/^ws_check/.test(fn) && a.p_token !== TK) return j({ err: 'LOGIN' });
      let out; try { out = { data: RPC[fn](a) }; } catch (e) { out = { err: e.message }; }
      if (MODE === 'lose' && /climate_add|check_submit/.test(fn)) return req.socket.destroy();   // 저장은 했는데 응답이 끊김
      return j(out);
    }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);
const count = fn => CALLS.filter(c => c.fn === fn).length;
const idb = p => p.evaluate(() => new Promise(ok => { const r = indexedDB.open('ws_outbox'); r.onsuccess = () => { const q = r.result.transaction('jobs').objectStore('jobs').getAll(); q.onsuccess = () => ok(q.result.map(x => ({ kind: x.kind, state: x.state, id: x.id }))); }; }));

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 900 } });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  for (const h of ['https://fonts.googleapis.com/**', 'https://cdnjs.cloudflare.com/**']) await c.route(h, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://script.google.com/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }));
  await c.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await c.addInitScript(tk => { try { localStorage.setItem('ws_token', tk); localStorage.setItem('ws_dev_at', '2026-11-14'); } catch (e) {} }, TK);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const toastOf = t => p.locator('.toast', { hasText: t }).waitFor({ timeout: 8000 }).then(() => true, () => false);
  const fillSave = async (t, h) => { await p.fill('input[aria-label="6층 2구역 실내온도"]', t); await p.fill('input[aria-label="6층 2구역 실내습도"]', h); await p.click('#climSave'); };

  await p.goto('http://localhost:' + PORT + '/ws/app.html'); await p.locator('.grid6').waitFor();
  await p.evaluate(() => openClim()); await p.locator('.zr').first().waitFor();
  ok(await p.evaluate(() => !!window.WS_OFFLINE && WS_OFFLINE.count() === 0) && await p.locator('.offchip').first().isHidden(), 'O1) 대기가 없으면 「저장 대기」 버튼이 안 보임');

  await fillSave('24.1', '52');
  ok(await toastOf('곳 저장했습니다') && CLIM.length === 1 && (await idb(p)).length === 0, 'O2) 신호가 되면 지금처럼 바로 저장되고 보관분은 지움');

  MODE = 'down';
  await fillSave('23.5', '50');
  ok(await toastOf('이 기기에 저장했습니다'), 'O3) 신호가 없으면 「이 기기에 저장했습니다」 (저장되었다고 하지 않음)');
  ok((await idb(p)).length === 1 && (await idb(p))[0].kind === 'climate' && CLIM.length === 1, 'O4) 기기에 1건 보관, 서버에는 아직 없음');
  const chip = p.locator('.offchip').first();
  ok(await chip.isVisible() && /저장 대기 1건/.test(await chip.innerText()), 'O5) 위 막대에 「저장 대기 1건」');
  await p.screenshot({ path: path.join(__dirname, 'shot_off_wait.png') });
  await chip.click();
  ok(/전송 대기/.test(await p.locator('.dialog').innerText()) && /온습도 1곳/.test(await p.locator('.dialog').innerText()), 'O6) 눌러 보면 대기 목록 (이름·상태)');
  await p.screenshot({ path: path.join(__dirname, 'shot_off_list.png') });
  await p.evaluate(() => WS_OFFLINE.close());

  await p.evaluate(() => WS_OFFLINE.flush(true));
  ok((await idb(p)).length === 1 && /저장 대기 1건/.test(await chip.innerText()), 'O7) 아직 신호가 없으면 계속 대기');

  MODE = 'up';
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForFunction(() => WS_OFFLINE.count() === 0, null, { timeout: 8000 });
  ok(CLIM.length === 2 && (await idb(p)).length === 0 && await p.locator('.offchip').first().isHidden(), 'O8) 신호가 돌아오면 자동 전송 · 대기 0건');
  ok(await toastOf('저장 대기 1건을 전송했습니다'), 'O9) 「저장 대기 1건을 전송했습니다」 알림');
  const sent = CALLS.filter(x => x.fn === 'ws_climate_add').pop().a;
  ok(/^[a-f0-9]{32}$/.test(sent.p_cid) && /^\d{4}-\d{2}-\d{2}T/.test(sent.p_at), 'O10) 입력 번호(client_id)와 입력 시각을 같이 보냄');

  MODE = 'lose'; const n0 = CLIM.length;
  await fillSave('22', '40'); await toastOf('이 기기에 저장했습니다');
  ok(CLIM.length === n0 + 1 && (await idb(p)).length === 1, 'O11) 응답이 끊겨도 보관분은 남김 (서버에는 이미 들어감)');
  MODE = 'up'; await p.evaluate(() => WS_OFFLINE.flush(true)); await p.waitForFunction(() => WS_OFFLINE.count() === 0);
  ok(CLIM.length === n0 + 1 && count('ws_climate_add') >= 4, 'O12) 같은 번호로 다시 보내도 서버 기록은 늘지 않음 (중복 방지)');

  MODE = 'down';
  await fillSave('21', '41'); await toastOf('이 기기에 저장했습니다');
  const p2 = await c.newPage();   // 새 창 = 앱을 닫았다 다시 연 것과 같은 저장소
  await p2.goto('http://localhost:' + PORT + '/ws/sw.js'); const left = await idb(p2); await p2.close();
  ok(left.length === 1 && left[0].kind === 'climate', 'O13) 다른 창·다시 열어도 보관분이 남아 있음');
  MODE = 'up'; await p.evaluate(() => WS_OFFLINE.flush(true)); await p.waitForFunction(() => WS_OFFLINE.count() === 0);

  MODE = 'down';
  await p.evaluate(() => { WS_OFFLINE.tokenFn = () => 'S999.' + (Date.now() + 1e6) + '.x'; });
  const other = await p.evaluate(() => WS_OFFLINE.send({ kind: 'climate', token: 'S002.' + (Date.now() + 1e6) + '.x', label: '남의 입력', args: { rows: [], out: {} } }).then(r => r.status));
  MODE = 'up'; const n1 = count('ws_climate_add'); await p.evaluate(() => WS_OFFLINE.flush(true));
  const left2 = await idb(p);
  ok(other === 'queued' && count('ws_climate_add') === n1 && left2.length === 1 && left2[0].state === 'login', 'O14) 다른 직원이 입력한 건은 본인 로그인 전에는 보내지 않음 (상태 「로그인 필요」)');
  await p.evaluate(() => WS_OFFLINE.drop(WS_OFFLINE.list()[0].id));
  ok((await idb(p)).length === 0, 'O15) 목록에서 버리면 기기에서도 지워짐');

  // ── QR 소화기 점검 (매장 직원, 로그인 없음) ──
  const q = await c.newPage(); q.on('pageerror', e => errs.push('qr: ' + e.message)); q.on('dialog', d => d.accept());
  await q.goto('http://localhost:' + PORT + '/ws/check-sb.html?fe=abcdefghjkmn'); await q.waitForFunction(() => /카페-소화기1/.test(document.body.innerText));
  const png = 'data:image/png;base64,' + Buffer.from('x'.repeat(300)).toString('base64'), jpg = 'data:image/jpeg;base64,' + Buffer.from('y'.repeat(900)).toString('base64');
  const sub = () => q.evaluate(([png, jpg]) => FM_CHECK.submit('abcdefghjkmn', { photo: jpg, signA: png, signB: png, state: '이상없음', overwrite: true }), [png, jpg]);
  MODE = 'down'; UPLOADS.length = 0;
  const r1 = await sub();
  ok(r1.ok && r1.queued && (await idb(q)).filter(x => x.kind === 'fire_check').length === 1 && CHECKS.length === 0, 'Q1) 신호가 없으면 점검 입력이 기기에 보관됨 (queued)');
  await q.evaluate(() => done({ ok: true, queued: true, state: '이상없음' }));
  const pg = await q.locator('#page').innerText();
  ok(/이 기기에 저장했습니다/.test(pg) && /전송되지 않았습니다/.test(pg) && /지우거나 시크릿/.test(pg) && !/보냈습니다/.test(pg), 'Q2) 끝 화면: 「아직 전송되지 않았습니다」 안내 (보냈다고 하지 않음)');
  await q.screenshot({ path: path.join(__dirname, 'shot_off_qr.png') });
  MODE = 'lose';   // 올리는 중 응답이 끊김(서버엔 파일이 들어감) → 다음엔 정상
  await q.evaluate(() => WS_OFFLINE.flush(true));
  MODE = 'up'; await q.evaluate(() => WS_OFFLINE.flush(true)); await q.waitForFunction(() => WS_OFFLINE.count() === 0, null, { timeout: 8000 });
  const paths = [...new Set(UPLOADS)];
  ok(CHECKS.length === 1 && paths.length === 3 && paths.every(x => /^fire\/abcdefghjkmn\/\d{4}-\d{2}\/[a-z0-9]+\.(jpg|png)$/.test(x)), 'Q3) 끊겼다 이어 올려도 같은 경로 3개만 · 점검 1건 (' + paths.length + '/' + CHECKS.length + ')');
  const cs = CALLS.filter(x => x.fn === 'ws_check_submit').pop().a;
  ok(/^[a-f0-9]{32}$/.test(cs.p_d.client_id) && /^\d{4}-/.test(cs.p_d.entered_at) && cs.p_files.photo.path.startsWith('fire/abcdefghjkmn/'), 'Q4) 점검 전송에 입력 번호·입력 시각 포함');

  ok(!errs.length, '화면 오류 없음 ' + errs.join(' / '));
  await b.close();
  console.log(fail ? '실패 ' + fail + '건' : '오프라인 저장 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
