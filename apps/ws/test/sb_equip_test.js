// 소화전·공기호흡기 점검 화면 시험 (결정 224): 앱(QR 관리 탭·③ 현황·④⑤ 고르기) + QR 화면 eq.html(로그인 입력 / 지난 점검 표)
// 진짜 Supabase 대신 가짜(FAKE)를 씀 — 화면 → 통로 → DB 함수에 넘기는 값만 봄. DB 함수 자체 시험은 equip_sql_test.js
// 먼저: python tools/build_fm.py   그다음: node test/sb_equip_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8133;
const TK = 'S001.' + (Date.now() + 3600e3) + '.abc';
const ME = { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' };
const D = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), YM = D.slice(0, 7);
const T1 = 'abcdefghjkmn', T2 = 'bcdefghjkmnp';
const EQ = [
  { id: 'WS-EQ-1', kind: 'hyd', floor: '3F', place: '동측 계단 앞', name: '3F 동측 계단 앞 소화전', token: T1 },
  { id: 'WS-EQ-2', kind: 'air', floor: '2F', place: '방재실 1', name: '2F 방재실 1 공기호흡기', token: T2 }
];
const SPEC = { hyd: [{ k: 'ext', label: '외관', ok: '정상', bad: '이상', hint: '사진 찍기' }, { k: 'leak', label: '누수 여부', ok: '누수 없음', bad: '누수 있음', hint: '사진 찍기' }, { k: 'clean', label: '청소 상태', ok: '양호', bad: '불량', hint: '사진 찍기' }],
  air: [{ k: 'charge', label: '충전량', ok: '정상', bad: '이상', gauge: true, hint: '압력계 사진 찍기' }, { k: 'reg', label: '압력조절기', ok: '정상', bad: '이상', gauge: true, hint: '압력계 사진 찍기' }, { k: 'ext', label: '외관', ok: '정상', bad: '이상', hint: '전체 사진 찍기' }] };
const CALLS = [], UPLOADS = [];
const DONE = {};   // 토큰 → 이번 달 점검 {checkId, state}
const photoUrl = k => '/storage/v1/object/public/ws-files/equip/' + T1 + '/' + YM + '/' + k + '.jpg';
const list = kind => ({ ok: true, kind, items: EQ.filter(e => e.kind === kind), execUrl: '', label: { w: 50, h: 50, dpi: 203 } });
const stItems = () => EQ.map(e => { const c = DONE[e.token]; return Object.assign({}, e, { state: c ? (c.state === '이상있음' ? 'bad' : 'ok') : 'miss', checkId: c ? c.checkId : '', at: c ? D + ' 10:24:00' : '', late: !!c, by: c ? '홍길동' : '' }); });
const status = () => { const items = stItems(), n = s => items.filter(i => i.state === s).length; return { ok: true, ym: YM, curYm: YM, day: 14, window: { start: 1, end: 5 }, isCurrent: true, months: [YM], items, counts: { ok: n('ok'), bad: n('bad'), wait: 0, miss: n('miss'), total: items.length } }; };
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: ME, toastSec: 1, needSign: false, docs: { day: D, signs: 1 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 }, window: { start: 1, end: 5 }, day: 14, ym: YM } }),
  ws_fe_list: () => ({ ok: true, items: [{ id: 'WS-FE-1', floor: '1F', store: '카페', no: 1, name: '카페-소화기1', token: 'cdefghjkmnpq', created: '' }], execUrl: '', label: { w: 50, h: 50, dpi: 203 } }),
  ws_eq_list: a => list(a.p_kind),
  ws_eq_add: a => {
    const d = a.p_d, place = String(d.place).replace(/\s+/g, ' ').trim(), name = d.floor + ' ' + place + ' ' + (d.kind === 'hyd' ? '소화전' : '공기호흡기');   // DB 함수 ws_clean 처럼 빈칸 정리
    if (EQ.some(e => e.name === name)) return { ok: false, error: '이미 등록된 위치입니다: ' + name };
    EQ.push({ id: 'WS-EQ-' + (EQ.length + 1), kind: d.kind, floor: d.floor, place, name, token: 'dddddddddddd'.slice(0, 11) + EQ.length });
    return Object.assign(list(d.kind), { added: name });
  },
  ws_eq_delete: a => { const n = EQ.length; for (const id of a.p_ids) { const i = EQ.findIndex(e => e.id === id); if (i >= 0) EQ.splice(i, 1); } return Object.assign(list(a.p_kind), { count: n - EQ.length }); },
  ws_eq_status: () => status(),
  ws_eq_detail: a => ({ ok: true, name: '3F 동측 계단 앞 소화전', floor: '3F', kind: 'hyd', kindName: '소화전', ym: YM, state: '이상있음', at: D + ' 10:24:00', late: true, by: '홍길동',
    items: [{ k: 'ext', label: '외관', bad: false, text: '정상', memo: '', photo: photoUrl('p1') }, { k: 'leak', label: '누수 여부', bad: true, text: '누수 있음', memo: '배관 이음부 물방울', photo: photoUrl('p2') }, { k: 'clean', label: '청소 상태', bad: false, text: '양호', memo: '', photo: photoUrl('p3') }] }),
  ws_eq_open: a => {
    if (a.p_token !== TK) throw new Error('LOGIN');
    const e = EQ.find(x => x.token === a.p_qr);
    if (!e) return { ok: false, error: '등록되지 않았거나 삭제된 QR입니다. 시설팀에 알려 주세요.' };
    return { ok: true, me: ME.name, eq: { id: e.id, kind: e.kind, kindName: e.kind === 'hyd' ? '소화전' : '공기호흡기', name: e.name, floor: e.floor, place: e.place }, spec: SPEC[e.kind], ym: YM, monthLabel: '이번 달',
      window: { start: 1, end: 5 }, day: 14, late: true, early: false, exists: !!DONE[e.token], photo: { w: 640, q: 0.6 } };
  },
  ws_eq_pub: a => {
    const e = EQ.find(x => x.token === a.p_qr);
    if (!e) return { ok: false, error: '등록되지 않았거나 삭제된 QR입니다. 시설팀에 알려 주세요.' };
    const s = SPEC[e.kind];
    return { ok: true, eq: { kind: e.kind, kindName: e.kind === 'hyd' ? '소화전' : '공기호흡기', name: e.name, floor: e.floor }, spec: s, ym: YM, rows: [
      { ym: YM, state: 'miss', day: '', late: false, by: '', items: [] },
      { ym: '2026-10', state: 'bad', day: '10-02', late: false, by: '홍*동', items: s.map((x, i) => ({ k: x.k, bad: i === 1, memo: i === 1 ? '배관 이음부 물방울' : '' })) },
      { ym: '2026-09', state: 'ok', day: '09-03', late: true, by: '김*수', items: s.map(x => ({ k: x.k, bad: false, memo: '' })) }] };
  },
  ws_eq_submit: a => {
    if (a.p_token !== TK) throw new Error('LOGIN');
    const e = EQ.find(x => x.token === a.p_qr);
    if (DONE[e.token] && !a.p_d.overwrite) return { ok: false, exists: true, error: '이번 달 입력이 이미 있습니다.' };
    const bad = Object.values(a.p_d.items).some(i => i.bad);
    DONE[e.token] = { checkId: 'WS-EC-1', state: bad ? '이상있음' : '이상없음' };
    return { ok: true, state: DONE[e.token].state, late: true, checkId: 'WS-EC-1', name: e.name, by: '홍길동', at: D + ' 10:24:00' };
  }
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return {
    auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; }, async signOut() { return {}; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return {
      async upload(p, blob) { await post('/upload', { p, type: blob.type, size: blob.size }); return { error: null }; },
      getPublicUrl(p) { return { data: { publicUrl: location.origin + '/storage/v1/object/public/ws-files/' + p } }; } }; } }
  };
} };`;
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) {
      const fn = u.pathname.slice(5), a = JSON.parse(body || '{}');
      CALLS.push({ fn, a });
      if (a.p_token !== TK && !/^ws_eq_(pub|open|submit)$/.test(fn)) return j({ err: 'LOGIN' });
      try { return j({ data: (RPC[fn] || (() => ({ ok: true })))(a) }); } catch (e) { return j({ err: e.message }); }
    }
    if (u.pathname === '/upload') { UPLOADS.push(JSON.parse(body)); return j({}); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);
const last = fn => CALLS.filter(c => c.fn === fn).pop();
const count = fn => CALLS.filter(c => c.fn === fn).length;
const called = async (fn, n0) => { for (let i = 0; i < 60; i++) { if (count(fn) > n0) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const GAUGE = path.join(__dirname, 'gauge.jpg');
const shot = async (pg, name) => { if (process.env.SHOTS) await pg.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: true }); };   // 눈으로 볼 때만: SHOTS=폴더
const BASE = 'http://localhost:' + PORT + '/ws/';

(async () => {
  const b = await chromium.launch();
  const mk = async (tok) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: QRLIB }));
    if (tok) await c.addInitScript(t => { try { localStorage.setItem('ws_token', t); localStorage.setItem('ws_dev_at', '2026-11-14'); } catch (e) {} }, tok);
    return c;
  };
  const c = await mk(TK);
  const errs = [];
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE + 'app.html'); await p.locator('.grid6').waitFor();

  // ── 소화기 점검 메뉴 ──
  await p.evaluate(() => go('fire'));
  const menu = await p.locator('.wrap.list').innerText();
  ok(/① 소화기, 소화전, 공기호흡기 QR 관리/.test(menu) && /③ 층별 소화전, 공기호흡기 점검 현황/.test(menu) && /④ 소화전 점검 입력/.test(menu) && /⑤ 공기호흡기 점검 입력/.test(menu) && !/수정중/.test(menu), '1) 메뉴: ①②③ + 새 ④ 소화전 점검 입력 · ⑤ 공기호흡기 점검 입력 (「수정중」은 사라짐)');

  await p.locator('text=소화전·공기호흡기 기한 지남').waitFor();
  ok(/이번 달 소화전·공기호흡기[\s\S]*0 \/ 2곳/.test(await p.locator('.wrap.list').innerText()) && /미입력 2곳/.test(await p.locator('.wrap.list').innerText()), '1-2) 메뉴 맨 위: 소화전·공기호흡기 이번 달 0 / 2곳 + 미입력 알림');
  await shot(p, 'a_menu');
  // ── ① QR 관리 탭 ──
  await p.click('text=① 소화기, 소화전, 공기호흡기 QR 관리');
  await p.locator('.fe').first().waitFor();
  ok(await p.locator('.seg button').allInnerTexts().then(t => t.join() === '소화기,소화전,공기호흡기'), '2) QR 관리: 소화기 / 소화전 / 공기호흡기 탭');
  let n0 = count('ws_eq_list');
  await p.click('.seg button:text-is("소화전")'); await p.locator('.fe b:text-is("3F 동측 계단 앞 소화전")').waitFor();
  ok(last('ws_eq_list').a.p_kind === 'hyd' && count('ws_eq_list') === n0 + 1, '3) 소화전 탭: 소화전 목록만 받아 층 아래에 바로 보임');
  ok(await p.evaluate(() => qrUrl('abcdefghjkmn')).then(u => /\?eq=abcdefghjkmn$/.test(u)) && !(await p.locator('.store-h').count()), '4) 소화전 QR 주소는 ?eq= · 매장 묶음 없음');
  await shot(p, 'b_qr_tab');
  await p.click('button:has-text("+ 등록")');
  await p.selectOption('#aFloor', '2F'); await p.fill('#aPlace', ' 서측 복도 '); await p.click('#aBtn');
  await p.locator('.fe b:text-is("2F 서측 복도 소화전")').waitFor();
  ok(JSON.stringify(last('ws_eq_add').a.p_d) === JSON.stringify({ kind: 'hyd', floor: '2F', place: ' 서측 복도 ' }), '5) 등록: 종류·층·위치(직접 적은 글)를 DB 함수에 넘김');
  await p.click('button:has-text("+ 등록")'); await p.selectOption('#aFloor', '2F'); await p.fill('#aPlace', '서측 복도'); await p.click('#aBtn');
  await p.locator('#aMsg:has-text("이미 등록된 위치입니다")').waitFor();
  ok(true, '6) 같은 위치 다시 등록 → 안내가 창 안에 뜸');
  await p.click('button:has-text("취소")');
  // 공기호흡기 탭 + 소화기 탭으로 돌아가면 ?fe=
  n0 = count('ws_eq_list');
  await p.click('.seg button:text-is("공기호흡기")'); await p.locator('.fe b:text-is("2F 방재실 1 공기호흡기")').waitFor();
  ok(last('ws_eq_list').a.p_kind === 'air' && !(await p.locator('.fe b:text-is("3F 동측 계단 앞 소화전")').count()), '7) 공기호흡기 탭: 따로 목록');
  await p.click('.seg button:text-is("소화기")'); await p.locator('.fe b:text-is("카페-소화기1")').waitFor();
  ok(await p.evaluate(() => qrUrl('x')).then(u => /\?fe=x$/.test(u)), '8) 소화기 탭으로 돌아오면 QR 주소는 ?fe=');
  // 출력 미리보기: 이름 통째로
  await p.click('.seg button:text-is("소화전")'); await p.locator('.fe b:text-is("3F 동측 계단 앞 소화전")').waitFor();
  await p.locator('.fe:has(b:text-is("3F 동측 계단 앞 소화전")) input[type=checkbox]').check();
  await p.click('button:has-text("출력")'); await p.locator('.pvbox .label').first().waitFor();
  ok(await p.locator('.pvbox .label b').first().innerText() === '3F 동측 계단 앞 소화전' && !!(await p.locator('.pvbox .label img').first().getAttribute('src')), '9) 라벨 미리보기: 「3F 동측 계단 앞 소화전」 이름 + QR 그림');
  await p.click('.back[aria-label="닫기"]');
  // 삭제 (앞에서 고른 칸은 먼저 풀고, 새로 등록한 것만)
  await p.locator('.fe:has(b:text-is("3F 동측 계단 앞 소화전")) input[type=checkbox]').uncheck();
  await p.locator('.fe:has(b:text-is("2F 서측 복도 소화전")) input[type=checkbox]').check();
  await p.click('button.warn:has-text("삭제")'); await p.click('#dBtn');
  await p.locator('.fe b:text-is("2F 서측 복도 소화전")').waitFor({ state: 'detached' });
  const del = last('ws_eq_delete').a;
  ok(del.p_ids.join() === 'WS-EQ-3' && del.p_kind === 'hyd', '10) 삭제: 고른 번호와 종류를 넘기고 목록에서 빠짐');

  // ── ③ 층별 현황 ──
  await p.evaluate(() => openHyd());
  await p.locator('.floor').first().waitFor();
  const tree = await p.locator('.tree').innerText();
  ok(/전체 2곳 \(소화전 1 · 공기호흡기 1\)/.test(tree) && /2F[\s\S]*소화전 0 · 공기호흡기 1/.test(tree) && /3F[\s\S]*소화전 1 · 공기호흡기 0/.test(tree) && /미입력 1/.test(tree), '11) ③ 현황: 층마다 「소화전 n · 공기호흡기 n」 + 미입력 표시');
  ok(/기한 지남 · 미입력 2곳/.test(await p.locator('.banner').first().innerText()), '11-2) ③ 현황 알림 단위는 「곳」(소화기는 「대」)');
  await shot(p, 'c_status');
  ok(await p.locator('.mnav').innerText().then(t => t.includes(YM.slice(0, 4) + '년')), '12) 월 이동 칸 + 입력 기간 안내 (소화기와 같은 모양)');
  await p.click('.floor:has-text("3F")'); await p.locator('.store-h b:text-is("소화전")').waitFor();
  ok(/미입력|입력 없음/.test(await p.locator('.feb').first().innerText()), '13) 층을 누르면 위치별 목록 (아직 점검 전)');
  DONE[T1] = { checkId: 'WS-EC-1', state: '이상있음' };
  await p.evaluate(() => loadHyd(S.hq.ym)); await p.locator('.feb:has-text("동측 계단 앞")').waitFor();
  await p.evaluate(() => { S.view = 'hydfl'; S.hfloor = '3F'; render(); });
  await p.click('.feb:has-text("동측 계단 앞")'); await p.locator('.dialog img').first().waitFor();
  const dl = await p.locator('.dialog').innerText();
  await shot(p, 'e_detail');
  ok(/점검자 홍길동/.test(dl) && /누수 있음/.test(dl) && /배관 이음부 물방울/.test(dl) && await p.locator('.dialog img').count() === 3, '14) 항목을 누르면 점검자·항목별 정상/이상·이상 내용·사진 3장');
  await p.click('.dialog .back'); delete DONE[T1];

  // ── ④ 고르기 → eq.html ──
  await p.evaluate(() => openEqPick('hyd')); await p.locator('.feb').first().waitFor();
  const pk = await p.locator('.wrap.list').innerText();
  await shot(p, 'f_pick');
  ok(/3F[\s\S]*동측 계단 앞/.test(pk) && !/방재실/.test(pk), '15) ④ 소화전 점검 입력: 소화전만 층별로 나열');
  await Promise.all([p.waitForURL(/eq\.html\?eq=abcdefghjkmn&from=app/), p.click('.feb:has-text("동측 계단 앞")')]);
  ok(true, '16) 고르면 입력 화면 eq.html?eq=고유번호 가 열림 (QR을 찍은 것과 같은 화면)');

  // ── eq.html 로그인 상태: 소화전 입력 (휴대폰 크기 — 카메라 화면은 휴대폰용) ──
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('#send').waitFor();
  const hd = await p.locator('.fp').innerText();
  ok(/3F 동측 계단 앞 소화전/.test(hd) && /점검자 홍길동/.test(hd) && /로그인한 직원 홍길동 님으로 열렸습니다/.test(hd) && /기한 후 입력/.test(hd) && await p.locator('.seg').count() === 3 && await p.locator('.shot').count() === 3, '17) 로그인 상태: PIN 없이 열림 · 점검자 = 내 이름 · 기한 후 안내 · 항목 3개');
  ok(await p.locator('#send').isDisabled() && /외관, 누수 여부, 청소 상태 사진을 찍어 주세요/.test(await p.locator('#miss').innerText()), '18) 사진 3장이 없으면 [저장하기] 꺼짐 + 빠진 항목 안내');
  const shoot = async k => {
    await p.evaluate(kk => openCamera(kk), k); await p.locator('#shutter').waitFor();
    await p.setInputFiles('#file', GAUGE);
    await p.locator('button:has-text("이 사진 쓰기")').click(); await p.locator('.cam').waitFor({ state: 'detached' });
  };
  await p.click('#bad_leak'); await p.locator('#memo_leak').waitFor();
  ok(await p.locator('#memo_ext').isHidden(), '19) 「이상」을 고르면 이상 내용 칸이 나옴 (다른 항목엔 없음)');
  await p.fill('#memo_leak', '배관 이음부 물방울');
  for (const k of ['ext', 'leak']) await shoot(k);
  ok(await p.locator('#send').isDisabled() && /청소 상태 사진/.test(await p.locator('#miss').innerText()), '20) 2장만 찍으면 아직 꺼짐 (청소 상태만 남음)');
  await shoot('clean');
  await shot(p, 'g_form');
  ok(await p.locator('#send').isEnabled(), '21) 3장 다 찍으면 [저장하기] 켜짐');
  const u0 = UPLOADS.length;
  await p.click('#send'); await p.locator('text=저장했습니다').waitFor();
  const sub = last('ws_eq_submit').a, ups = UPLOADS.slice(u0);
  ok(ups.length === 3 && ups.every(x => new RegExp('^equip/' + T1 + '/' + YM + '/[a-z0-9]+\\.jpg$').test(x.p) && x.type === 'image/jpeg'), '22) 사진 3장을 버킷 equip/{QR}/연월/ 아래 JPEG로 올림 ' + (ups[0] && ups[0].p));
  ok(sub.p_token === TK && sub.p_qr === T1 && sub.p_d.items.leak.bad === true && sub.p_d.items.leak.memo === '배관 이음부 물방울' && sub.p_d.items.ext.bad === false && sub.p_d.items.ext.memo === '' && Object.keys(sub.p_files).sort().join() === 'clean,ext,leak' && sub.p_files.ext.path.startsWith('equip/' + T1), '23) DB 함수에 내 표·QR·항목별 정상/이상·이상 내용·사진 주소를 넘김 (사진 내용은 안 보냄)');
  const dn = await p.locator('.fp').innerText();
  await shot(p, 'h_done');
  ok(/이상 있음으로 기록/.test(dn) && /점검자 홍길동/.test(dn) && /WS-EC-1/.test(dn) && await p.locator('a.btn:has-text("업무지원 앱으로")').getAttribute('href') === 'app.html', '24) 끝 화면: 이상 있음으로 기록 · 점검자 · 저장 번호 · [업무지원 앱으로]');

  // ── 같은 달 다시 입력(덮어쓰기) ──
  await p.reload(); await p.locator('#send').waitFor();
  ok(/이미 있습니다/.test(await p.locator('.main').innerText()), '25) 이번 달 이미 있으면 안내가 뜸');
  for (const k of ['ext', 'leak', 'clean']) await shoot(k);
  const u1 = UPLOADS.length; await p.click('#send'); await p.locator('.dialog:has-text("이번 달 입력이 이미 있습니다")').waitFor();
  ok(UPLOADS.length === u1, '26) 덮어쓰기 확인창이 먼저 — 사진은 아직 안 올림');
  await p.click('.dialog button:has-text("바꾸기")'); await p.locator('text=저장했습니다').waitFor();
  ok(last('ws_eq_submit').a.p_d.overwrite === true, '27) 「바꾸기」 → overwrite: true 로 저장');

  // ── 공기호흡기 입력: 압력계 항목만 동그라미 ──
  await p.goto(BASE + 'eq.html?eq=' + T2); await p.locator('#send').waitFor();
  ok(/충전량[\s\S]*압력조절기[\s\S]*외관/.test(await p.locator('.main').innerText()) && await p.locator('.shot svg[viewBox="0 0 230 230"]').count() === 2, '28) 공기호흡기: 충전량·압력조절기·외관 · 압력계 그림은 앞 2개만');
  await p.evaluate(() => openCamera('charge')); await p.locator('#shutter').waitFor();
  ok(await p.locator('.view svg').count() === 1 && /동그라미에 압력계/.test(await p.locator('#camMsg').innerText()), '29) 충전량 촬영: 동그라미 안내선 + 「압력계를 맞춰 주세요」');
  await p.click('.cam-top button[aria-label="닫기"]');
  await p.evaluate(() => openCamera('ext')); await p.locator('#shutter').waitFor();
  ok(await p.locator('.view svg').count() === 0 && /외관 사진을 찍어/.test(await p.locator('#camMsg').innerText()), '30) 외관 촬영: 안내선 없이 「사진을 찍어 주세요」');
  await p.click('.cam-top button[aria-label="닫기"]');

  // ── QR 오류 ──
  await p.goto(BASE + 'eq.html?eq=zzzzzzzzzzzz'); await p.locator('.note').waitFor();
  ok(/삭제된 QR/.test(await p.locator('.note').innerText()), '31) 없는/삭제된 QR → 안내');
  await p.goto(BASE + 'eq.html?eq=abc'); await p.locator('.note').waitFor();
  ok(/올바르지 않습니다/.test(await p.locator('.note').innerText()), '32) 모양이 틀린 QR → 안내 (서버에 묻지 않음)');

  // ── 바로가기 index.html: ?eq= → eq.html ──
  await p.goto(BASE + 'index.html?eq=' + T1); await p.waitForURL(/eq\.html\?eq=/);
  ok(true, '33) 바로가기 페이지: QR 주소(?eq=)를 eq.html 로 보냄');

  // ── 로그인 안 한 사람 ──
  const g = await mk(''); const gp = await g.newPage(); gp.on('pageerror', e => errs.push(e.message));
  const o0 = count('ws_eq_open');
  await gp.goto(BASE + 'eq.html?eq=' + T1); await gp.locator('.t').waitFor();
  const gt = await gp.locator('.fp').innerText();
  await shot(gp, 'i_guest');
  ok(count('ws_eq_open') === o0 && /점검 입력은 앱에 로그인한 직원만/.test(gt) && !(await gp.locator('#send').count()), '34) 로그인 안 함: 입력 칸 없음 · 로그인 안내');
  const gh = await gp.content().then(h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
  const c35 = [/홍\*동/.test(gt), /김\*수/.test(gt), !/홍길동/.test(gt), /누수 있음/.test(gt), /배관 이음부 물방울/.test(gt), /미입력/.test(gt), /기한 후/.test(gt), !/<img|\.jpg|\/storage\/v1/.test(gh)];   // 사진 그림·주소가 없어야 함 (글꼴 링크는 상관없음)
  ok(!c35.includes(false), '35) 지난 점검 표: 정상/이상 칸 · 이상 내용 · 미입력 · 기한 후 · 이름은 가림 · 사진 없음');
  await Promise.all([gp.waitForURL(/\/ws\/app\.html$/), gp.click('#login')]);
  ok(await gp.evaluate(() => sessionStorage.getItem('ws_after')) === BASE + 'eq.html?eq=' + T1, '36) [앱에 로그인하기]: 돌아올 QR 주소를 기억하고 앱으로');
  // 앱이 로그인을 마치면 그 QR 화면으로 (같은 사이트 eq.html 만)
  await Promise.all([gp.waitForURL(/eq\.html\?eq=/), gp.evaluate(() => afterLogin())]);
  ok(true, '37) 로그인 뒤 afterLogin → 기억해 둔 QR 입력 화면으로 돌아감');
  await gp.goto(BASE + 'app.html');
  for (const bad of ['https://evil.example/ws/eq.html?eq=' + T1, BASE + 'app.html?eq=' + T1, BASE + 'eq.html?eq=short']) {
    await gp.evaluate(a => sessionStorage.setItem('ws_after', a), bad);
    ok(await gp.evaluate(() => afterLogin()) === false && /\/ws\/app\.html$/.test(gp.url()), '38) 엉뚱한 돌아올 주소는 무시: ' + bad.slice(0, 40));
  }
  // 표는 있는데 로그인이 풀린 경우(서버가 LOGIN) → 로그인 안 한 화면
  const s = await mk('S001.' + (Date.now() + 3600e3) + '.old'); const sp = await s.newPage();
  await sp.goto(BASE + 'eq.html?eq=' + T1); await sp.locator('.t').waitFor();
  ok(/점검 입력은 앱에 로그인한 직원만/.test(await sp.locator('.fp').innerText()), '39) 저장된 표가 틀렸거나 풀렸으면 → 지난 점검 표 화면으로');
  const x = await mk(); const xp = await x.newPage();
  await xp.goto(BASE + 'eq.html?eq=' + T1); await xp.locator('.t').waitFor();
  ok(true, '40) 표가 아예 없어도 지난 점검 표');

  ok(!errs.length, '41) 화면 오류 없음 ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n실패 ' + fail + '개' : '\n소화전·공기호흡기 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
