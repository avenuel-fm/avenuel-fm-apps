// 소화전·공기호흡기 점검 화면 시험 (결정 224·230): 앱(QR 관리 탭·③ 현황 — 조회만) + QR 화면 eq.html(로그인 입력 / 지난 점검 표)
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
  { id: 'WS-EQ-1', kind: 'hyd', floor: '3F', place: '동측 계단 앞', no: 1, name: '동측 계단 앞-소화전1', token: T1, printed: false },
  { id: 'WS-EQ-2', kind: 'air', floor: '2F', place: '방재실 1', no: 1, name: '방재실 1-공기호흡기1', token: T2, printed: true }
];
const FE = [{ id: 'WS-FE-1', floor: '1F', store: '카페', no: 1, name: '카페-소화기1', token: 'cdefghjkmnpq', created: '', printed: true }];
const FLS = ['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F'];
const KN = { hyd: '소화전', air: '공기호흡기' };
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();   // DB 함수 ws_clean 처럼 빈칸 정리
const SPEC = { hyd: [{ k: 'ext', label: '외관', ok: '정상', bad: '이상', hint: '사진 찍기' }, { k: 'leak', label: '누수 여부', ok: '누수 없음', bad: '누수 있음', hint: '사진 찍기' }, { k: 'clean', label: '청소 상태', ok: '양호', bad: '불량', hint: '사진 찍기' }],
  air: [{ k: 'charge', label: '충전량', ok: '정상', bad: '이상', gauge: true, hint: '압력계 사진 찍기' }, { k: 'reg', label: '압력조절기', ok: '정상', bad: '이상', gauge: true, hint: '압력계 사진 찍기' }, { k: 'ext', label: '외관', ok: '정상', bad: '이상', hint: '전체 사진 찍기' }] };
const CALLS = [], UPLOADS = [];
const DONE = {};   // 토큰 → 이번 달 점검 {checkId, state}
const photoUrl = k => '/storage/v1/object/public/ws-files/equip/' + T1 + '/' + YM + '/' + k + '.jpg';
const byFloor = (a, b) => FLS.indexOf(a.floor) - FLS.indexOf(b.floor) || String(a.place || a.store).localeCompare(String(b.place || b.store)) || a.no - b.no;
const feList = () => ({ ok: true, items: FE.slice().sort(byFloor), execUrl: '', label: { w: 50, h: 50, dpi: 203 } });
const list = kind => ({ ok: true, kind, items: EQ.filter(e => e.kind === kind).sort(byFloor), execUrl: '', label: { w: 50, h: 50, dpi: 203 } });
const stItems = () => EQ.map(e => { const c = DONE[e.token]; return Object.assign({}, e, { state: c ? (c.state === '이상있음' ? 'bad' : 'ok') : 'miss', checkId: c ? c.checkId : '', at: c ? D + ' 10:24:00' : '', late: !!c, by: c ? '홍길동' : '' }); });
const status = () => { const items = stItems(), n = s => items.filter(i => i.state === s).length; return { ok: true, ym: YM, curYm: YM, day: 14, window: { start: 1, end: 5 }, isCurrent: true, months: [YM], items, counts: { ok: n('ok'), bad: n('bad'), wait: 0, miss: n('miss'), total: items.length } }; };
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: ME, toastSec: 1, needSign: false, docs: { day: D, signs: 1 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 }, window: { start: 1, end: 5 }, day: 14, ym: YM } }),
  ws_fe_list: () => feList(),
  ws_fe_delete: a => { let n = 0; for (const id of a.p_ids) { const i = FE.findIndex(e => e.id === id); if (i >= 0) { FE.splice(i, 1); n++; } } return Object.assign(feList(), { count: n }); },
  ws_fe_status: () => ({ ok: true, ym: YM, curYm: YM, day: 14, window: { start: 1, end: 5 }, isCurrent: true, months: [YM], items: FE.map(e => Object.assign({}, e, e.name === '카페-소화기1' ? { state: 'ok', checkId: 'CK1', at: D + ' 10:00', late: false } : { state: 'miss', checkId: '', at: '', late: false })), counts: { ok: 0, bad: 0, wait: 0, miss: FE.length, total: FE.length } }),
  ws_fe_add: a => {
    const d = a.p_d, store = norm(d.store), n = Math.max(1, Math.min(20, Math.floor(Number(d.count)) || 1)), names = [];
    if (!store) return { ok: false, error: '위치를 적어 주세요.' };
    const m = FE.filter(x => x.store === store).reduce((x, y) => Math.max(x, y.no), 0);
    for (let i = 1; i <= n; i++) { const name = store + '-소화기' + (m + i); FE.push({ id: 'WS-FE-' + (FE.length + 1), floor: d.floor, store, no: m + i, name, token: 'fe' + String(FE.length + 1).padStart(10, 'x'), created: '', printed: false }); names.push(name); }
    return Object.assign(feList(), { added: names });
  },
  ws_eq_list: a => list(a.p_kind),
  ws_eq_add: a => {
    const d = a.p_d, place = norm(d.place), n = Math.max(1, Math.min(20, Math.floor(Number(d.count)) || 1)), names = [];
    if (place === '오류시험') return { ok: false, error: '시험용 오류입니다.' };
    if (!place) return { ok: false, error: '위치를 적어 주세요. (예: 동측 계단 앞)' };
    const m = EQ.filter(x => x.kind === d.kind && x.place === place).reduce((x, y) => Math.max(x, y.no), 0);
    for (let i = 1; i <= n; i++) { const name = place + '-' + KN[d.kind] + (m + i); EQ.push({ id: 'WS-EQ-' + (EQ.length + 1), kind: d.kind, floor: d.floor, place, no: m + i, name, token: 'q' + String(EQ.length + 1).padStart(11, 'z'), printed: false }); names.push(name); }
    return Object.assign(list(d.kind), { added: names });
  },
  ws_eq_delete: a => { const n = EQ.length; for (const id of a.p_ids) { const i = EQ.findIndex(e => e.id === id); if (i >= 0) EQ.splice(i, 1); } return Object.assign(list(a.p_kind), { count: n - EQ.length }); },
  ws_qr_rename: a => {
    const nv = norm(a.p_new), fe = a.p_kind === 'fe';
    if (!nv) return { ok: false, error: '위치를 적어 주세요.' };
    if (nv === '중복') return { ok: false, error: '같은 이름의 위치가 이미 있습니다. 다른 이름으로 해 주세요.' };
    let n = 0;
    (fe ? FE : EQ.filter(e => e.kind === a.p_kind)).forEach(e => {
      if (e.floor === a.p_floor && (fe ? e.store : e.place) === a.p_old) { n++; if (fe) { e.store = nv; e.name = nv + '-소화기' + e.no; } else { e.place = nv; e.name = nv + '-' + KN[a.p_kind] + e.no; } }
    });
    return n ? Object.assign(fe ? feList() : list(a.p_kind), { count: n }) : { ok: false, error: '고칠 것을 찾지 못했습니다. 화면을 새로 고쳐 주세요.' };
  },
  ws_qr_printed: a => { (a.p_kind === 'fe' ? FE : EQ.filter(e => e.kind === a.p_kind)).forEach(e => { if (a.p_ids.indexOf(e.id) !== -1) e.printed = true; }); return a.p_kind === 'fe' ? feList() : list(a.p_kind); },
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
  const mk = async (tok, xl) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: xl && /xlsx/.test(r.request().url()) ? xl : QRLIB }));
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
  ok(/① 소화기\/소화전\/공기호흡기 QR 관리/.test(menu) && !/QR 관리 · 인쇄/.test(menu) && /② 매장별 소화기 점검 현황/.test(menu) && /③ 층별 소화전\/공기호흡기 점검 현황/.test(menu) && !/④/.test(menu) && !/⑤/.test(menu) && !/점검 입력/.test(menu) && !/수정중/.test(menu), '1) 메뉴: ①②③만 — 새 이름(슬래시), ④ 소화전 점검 입력·⑤ 공기호흡기 점검 입력 줄은 없어짐');
  ok(/소화기\/소화전\/공기호흡기 점검/.test(await p.locator('header.top').innerText()), '1-1) 메뉴 제목 「소화기/소화전/공기호흡기 점검」');

  await p.locator('text=소화전·공기호흡기 기한 지남').waitFor();
  ok(/이번 달 소화전·공기호흡기[\s\S]*0 \/ 2곳/.test(await p.locator('.wrap.list').innerText()) && /미입력 2곳/.test(await p.locator('.wrap.list').innerText()), '1-2) 메뉴 맨 위: 소화전·공기호흡기 이번 달 0 / 2곳 + 미입력 알림');
  await shot(p, 'a_menu');
  // ── ① QR 관리 v2 (결정 228): 탭 · 층→위치 아코디언 (모두 접힘으로 시작) ──
  await p.click('text=① 소화기/소화전/공기호흡기 QR 관리');
  ok(/소화기\/소화전\/공기호흡기 QR 관리/.test(await p.locator('header.top').innerText()), '1-2) QR 관리 제목 「소화기/소화전/공기호흡기 QR 관리」');
  await p.locator('.ac-h').first().waitFor();
  ok(await p.locator('.seg button').allInnerTexts().then(t => t.join() === '소화기,소화전,공기호흡기') && await p.locator('.seg button.on').innerText() === '소화기', '2) QR 관리: 소화기 / 소화전 / 공기호흡기 탭, 처음은 소화기');
  ok(await p.locator('.fe').count() === 0 && /1F[\s\S]*위치 1곳 · 소화기 1대/.test(await p.locator('.ac-h').first().innerText()), '2-2) 처음은 모두 접힘: 층 줄만 보임 (「1F 위치 1곳 · 소화기 1대」)');
  let n0 = count('ws_eq_list');
  await p.click('.seg button:text-is("소화전")'); await p.locator('.ac-h:has-text("3F")').waitFor();
  ok(last('ws_eq_list').a.p_kind === 'hyd' && count('ws_eq_list') === n0 + 1 && await p.locator('.fe').count() === 0, '3) 소화전 탭: 소화전만 받아 층 아코디언(접힘)으로 보임');
  ok(/3F[\s\S]*위치 1곳 · 소화전 1개/.test(await p.locator('.ac-h').first().innerText()) && /미인쇄 1/.test(await p.locator('.ac-h').first().innerText()), '3-2) 층 줄에 위치 수·개수 + 미인쇄 개수');
  await p.click('.ac-t:has-text("3F")'); await p.locator('.ac-t:has-text("동측 계단 앞")').waitFor();
  ok(await p.locator('.fe').count() === 0, '3-3) 층을 펼치면 위치 줄이 나옴 (위치는 아직 접힘)');
  await p.click('.ac-t:has-text("동측 계단 앞")'); await p.locator('.fe b:text-is("동측 계단 앞-소화전1")').waitFor();
  ok(await p.locator('.fe .chip:text-is("미인쇄")').count() === 1 && await p.locator('.ac-act button').allInnerTexts().then(t => t.join() === '+ 1개 추가,이름 고치기'), '3-4) 위치를 펼치면 [+ 1개 추가] [이름 고치기] 와 항목 · 「미인쇄」 딱지');
  ok(await p.evaluate(() => qrUrl('abcdefghjkmn')).then(u => /\?eq=abcdefghjkmn$/.test(u)), '4) 소화전 QR 주소는 ?eq=');
  await shot(p, 'b_qr_tab');
  // 등록 창: 종류 체크박스 · 층 B3~10F · 위치
  await p.click('button:has-text("+ 등록")'); await p.locator('#aPre').waitFor();
  ok(await p.locator('.ckl').count() === 3 && await p.locator('#ak_hyd').isChecked() && !(await p.locator('#ak_fe').isChecked()) && !(await p.locator('#ak_air').isChecked()), '5) 등록 창: 종류 체크 3개, 지금 탭(소화전)만 미리 체크');
  const opts = await p.locator('#aFloor option').allInnerTexts();
  ok(opts.length === 14 && opts[0] === 'B3' && opts[12] === '10F' && opts[13] === 'POPUP', '5-2) 층 선택 B3 ~ 10F + 맨 끝 POPUP (14개)');
  ok(await p.evaluate(() => xlFloor('popup') === 'POPUP' && xlFloor('팝업') === 'POPUP' && xlFloor('POPUP층') === 'POPUP' && xlFloor('5F') === '5F' && xlFloor('11F') === ''), '5-2b) 엑셀 시트 이름 POPUP·팝업 → POPUP 층')
  ok(await p.locator('label:has-text("위치")').count() >= 1 && !(await p.locator('text=매장명').count()), '5-3) 「매장명」 대신 「위치」');
  await p.selectOption('#aFloor', '10F'); await p.fill('#aStore', ' 옥상  기계실 '); await p.fill('#aCount', '2');
  ok(/동측|옥상 기계실-소화전1 ~ 옥상 기계실-소화전2/.test(await p.locator('#aPre').innerText()) && !/소화기/.test(await p.locator('#aPre').innerText()), '5-4) 만들어지는 이름 미리보기 「옥상 기계실-소화전1 ~ 옥상 기계실-소화전2」');
  await p.check('#ak_fe');
  ok(/옥상 기계실-소화기1 ~ 옥상 기계실-소화기2/.test(await p.locator('#aPre').innerText()) && /소화전1/.test(await p.locator('#aPre').innerText()), '5-5) 소화기도 체크하면 미리보기에 두 종류');
  await shot(p, 'b2_reg');
  await p.uncheck('#ak_fe'); await p.uncheck('#ak_hyd');
  await p.click('#aBtn');
  ok(/종류를 하나 이상/.test(await p.locator('#aMsg').innerText()), '5-6) 종류를 하나도 안 고르면 안내');
  // 일부만 실패: 소화기 성공 → 소화전 실패
  await p.check('#ak_fe'); await p.check('#ak_hyd'); await p.fill('#aStore', '오류시험');
  await p.click('#aBtn'); await p.locator('#aMsg:has-text("시험용 오류")').waitFor();
  ok(/소화기은\(는\) 등록했습니다\. 소화전: 시험용 오류입니다\./.test(await p.locator('#aMsg').innerText()) && !(await p.locator('#ak_fe').isChecked()) && await p.locator('#ak_hyd').isChecked(), '6) 일부만 실패: 된 종류(소화기)는 체크 풀리고 실패 이유를 알려 줌 · 창은 그대로');
  ok(FE.some(x => x.store === '오류시험'), '6-2) 앞 종류는 실제로 등록됨');
  const f0 = count('ws_fe_add'), e0 = count('ws_eq_add');
  await p.fill('#aStore', ' 옥상  기계실 ');
  await p.check('#ak_air'); await p.uncheck('#ak_hyd');
  await p.click('#aBtn'); await p.locator('.fe b:text-is("옥상 기계실-공기호흡기1")').waitFor();
  ok(count('ws_eq_add') === e0 + 1 && count('ws_fe_add') === f0 && JSON.stringify(last('ws_eq_add').a.p_d) === JSON.stringify({ kind: 'air', floor: '10F', place: ' 옥상  기계실 ', count: '2' }), '7) 등록: 고른 종류의 DB 함수만 부름 (종류·층·위치·대수)');
  ok(await p.locator('.seg button.on').innerText() === '공기호흡기' && await p.locator('.fe input:checked').count() === 2 && /출력 \(2\)/.test(await p.locator('.tools').innerText()), '8) 등록 뒤: 그 종류 탭으로, 층·위치가 펼쳐지고 방금 만든 2개가 미리 체크됨 → 바로 [출력 (2)]');
  ok(await p.locator('.fe .chip:text-is("미인쇄")').count() === 2, '8-2) 방금 만든 것은 「미인쇄」');
  // 소화기+소화전 한꺼번에
  await p.click('button:has-text("+ 등록")'); await p.selectOption('#aFloor', 'B3'); await p.fill('#aStore', '주차장 A'); await p.fill('#aCount', '1');
  await p.check('#ak_fe'); await p.check('#ak_hyd'); await p.uncheck('#ak_air');
  const fa = count('ws_fe_add'), ea = count('ws_eq_add');
  await p.click('#aBtn'); await p.locator('.toast', { hasText: '소화기 1대 · 소화전 1개 등록' }).waitFor();
  ok(count('ws_fe_add') === fa + 1 && count('ws_eq_add') === ea + 1 && FE.some(x => x.name === '주차장 A-소화기1') && EQ.some(x => x.name === '주차장 A-소화전1'), '9) 두 종류 체크 → 소화기·소화전이 같은 위치로 한꺼번에 등록 (알림에 종류별 개수)');
  ok(await p.locator('.seg button.on').innerText() === '소화기', '9-2) 지금 탭(공기호흡기)이 체크에 없으면 방금 만든 첫 종류 탭(소화기)으로 옮김');
  await p.click('.seg button:text-is("소화전")'); await p.locator('.ac-h:has-text("B3")').waitFor();
  await p.click('button:has-text("모두 펼치기")'); await p.locator('.fe b:text-is("동측 계단 앞-소화전1")').waitFor();
  // [+ 1개 추가]
  const e1 = count('ws_eq_add');
  await p.locator('.ac:has(> .ac-h .ac-n:text-is("동측 계단 앞")) > .ac-b .ac-act button:has-text("+ 1개 추가")').click();
  await p.locator('.fe b:text-is("동측 계단 앞-소화전2")').waitFor();
  ok(count('ws_eq_add') === e1 + 1 && JSON.stringify(last('ws_eq_add').a.p_d) === JSON.stringify({ kind: 'hyd', floor: '3F', place: '동측 계단 앞', count: 1 }) && await p.locator('.fe:has(b:text-is("동측 계단 앞-소화전2")) input').isChecked(), '10) [+ 1개 추가]: 같은 층·위치에 번호 이어서 한 개 더 · 방금 만든 것 체크됨');
  // 이름 고치기
  await p.locator('.ac:has(> .ac-h .ac-n:text-is("동측 계단 앞")) > .ac-b .ac-act button:has-text("이름 고치기")').click(); await p.locator('#rnNew').waitFor();
  ok(await p.locator('#rnNew').inputValue() === '동측 계단 앞' && /한꺼번에 바뀝니다/.test(await p.locator('.dialog').innerText()), '11) 이름 고치기 창: 지금 이름이 채워져 있고 안내');
  await p.fill('#rnNew', '중복'); await p.click('#rnBtn'); await p.locator('#rnMsg:has-text("같은 이름의 위치가 이미 있습니다")').waitFor();
  ok(true, '11-2) 겹치는 이름이면 창 안에 안내');
  await p.fill('#rnNew', ' 동측  출입구 '); await p.click('#rnBtn');
  await p.locator('.ac-t:has-text("동측 출입구")').waitFor();
  const rn = last('ws_qr_rename').a;
  ok(rn.p_kind === 'hyd' && rn.p_floor === '3F' && rn.p_old === '동측 계단 앞' && rn.p_new === ' 동측  출입구 ' && EQ.filter(e => e.place === '동측 출입구').length === 2, '12) 이름 고치기: 종류·층·옛이름·새이름을 넘기고 위치 안 모두 새 이름으로');
  ok(await p.locator('.fe b:text-is("동측 출입구-소화전1")').count() === 1 && await p.locator('.fe b:text-is("동측 출입구-소화전2")').count() === 1 && await p.locator('.ac-t[aria-expanded="true"]:has-text("동측 출입구")').count() === 1, '12-2) 새 이름으로 바뀌고 펼친 상태 그대로');
  // 검색 → 자동 펼침
  await p.click('button:has-text("모두 접기")'); await p.waitForTimeout(80);
  ok(await p.locator('.fe').count() === 0, '13) [모두 접기] → 전부 접힘');
  await p.fill('input[type=search]', '출입구'); await p.locator('.fe b:text-is("동측 출입구-소화전1")').waitFor();
  ok(await p.locator('.ac-h').count() === 2 && !(await p.locator('.ac-h:has-text("B3")').count()), '14) 검색: 맞는 층·위치만 남고 자동으로 펼쳐져 항목이 바로 보임');
  await p.fill('input[type=search]', ''); await p.waitForTimeout(80);
  ok(await p.locator('.fe').count() === 0, '14-2) 검색을 지우면 다시 접힌 모습');
  await p.click('button:has-text("모두 펼치기")'); await p.locator('.fe').first().waitFor();
  ok(await p.locator('.fe').count() === EQ.filter(e => e.kind === 'hyd').length, '15) [모두 펼치기] → 소화전 전부 보임');
  // 선택: 층 체크 = 그 층 전부, 일부만이면 가운데 표시
  await p.locator('.fe:has(b:text-is("동측 출입구-소화전1")) input').check();
  ok(await p.locator('.ac-h > input[data-part]').count() >= 1 && await p.evaluate(() => document.querySelector('.ac-h > input[data-part]').indeterminate), '16) 일부만 고르면 층·위치 체크칸이 「일부 선택」 모양');
  await p.locator('.ac-h:has-text("B3") > input').check();
  ok(await p.locator('.ac-h:has-text("B3") > input').isChecked() && /출력 \(2\)/.test(await p.locator('.tools').innerText()), '17) 층 체크칸 = 그 층 전부 고르기');
  await p.locator('.ac-h:has-text("B3") > input').uncheck();
  // 라벨 미리보기 + 인쇄하면 「미인쇄」 사라짐
  await p.locator('.ac-h:has-text("3F") > input').check();
  await p.click('button:has-text("출력")'); await p.locator('.pvbox .label').first().waitFor();
  ok(await p.locator('.pvbox .label b').first().innerText() === '동측 출입구-소화전1' && !!(await p.locator('.pvbox .label img').first().getAttribute('src')), '18) 라벨 미리보기: 「동측 출입구-소화전1」 이름 + QR 그림');
  await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await p.click('button:has-text("1장 시험 인쇄")'); await p.waitForTimeout(400);
  ok(count('ws_qr_printed') === 0, '19) 1장 시험 인쇄는 「인쇄함」으로 치지 않음');
  await p.locator('.ac-h:has-text("3F") > input').check().catch(() => {});
  await p.click('button:has-text("출력")'); await p.locator('.pvbox .label').first().waitFor();
  await p.click('#pvGo'); await called('ws_qr_printed', 0);
  const pr = last('ws_qr_printed').a;
  ok(pr.p_kind === 'hyd' && pr.p_ids.length === 2 && EQ.filter(e => e.printed && e.place === '동측 출입구').length === 2, '20) [인쇄] → 서버에 「인쇄함」 기록 (종류·번호들)');
  ok(await p.locator('.fe:has(b:text-is("동측 출입구-소화전1")) .chip:text-is("미인쇄")').count() === 0, '20-2) 인쇄한 것은 「미인쇄」 딱지가 사라짐');
  // 소화기 탭: 층 → 위치, ?fe=
  await p.click('.seg button:text-is("소화기")'); await p.locator('.ac-h:has-text("1F")').waitFor();
  ok(await p.evaluate(() => qrUrl('x')).then(u => /\?fe=x$/.test(u)) && last('ws_fe_list'), '21) 소화기 탭으로 돌아오면 QR 주소는 ?fe=');
  await shot(p, 'b3_fe_tab');
  // 삭제: 새로 만든 소화전 전부 지우기
  await p.click('.seg button:text-is("소화전")'); await p.locator('.ac-h:has-text("B3")').waitFor();
  await p.click('button:has-text("모두 펼치기")'); await p.locator('.fe').first().waitFor();
  for (const nm of ['동측 출입구-소화전2', '주차장 A-소화전1']) await p.locator('.fe:has(b:text-is("' + nm + '")) input').check();
  await p.click('button.warn:has-text("삭제")'); await p.click('#dBtn');
  await p.locator('.fe b:text-is("주차장 A-소화전1")').waitFor({ state: 'detached' });
  const del = last('ws_eq_delete').a;
  ok(del.p_ids.length === 2 && del.p_kind === 'hyd' && !EQ.some(e => e.name === '주차장 A-소화전1'), '22) 삭제: 고른 번호와 종류를 넘기고 목록에서 빠짐');
  // 뒷 시험(③ 현황 등)이 쓰는 자료로 되돌림: 소화전 1·공기호흡기 1
  for (let i = EQ.length - 1; i >= 0; i--) if (![T1, T2].includes(EQ[i].token)) EQ.splice(i, 1);
  EQ[0].place = '동측 계단 앞'; EQ[0].name = '동측 계단 앞-소화전1';
  await p.evaluate(() => { S.qrKind = 'fe'; });

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

  // ── 앱에는 점검 입력이 없음 (조회만) — 입력은 QR을 찍은 휴대폰 화면 eq.html 에서만 (결정 230) ──
  await p.evaluate(() => openHyd()); await p.locator('.floor').first().waitFor();
  const hy = await p.locator('.wrap.list').innerText();
  ok(/조회만 됩니다/.test(hy) && /QR을 휴대폰으로 찍어서/.test(hy) && !(await p.locator('button:has-text("점검 입력")').count()), '15) ③ 현황: 「조회만 됩니다 · 입력은 QR을 휴대폰으로」 안내, 점검 입력 버튼 없음');
  ok(!(await p.evaluate(() => typeof openEqPick !== 'undefined' || typeof renderEqPick !== 'undefined')), '16) 앱 코드에서 ④⑤ 고르기 화면이 사라짐');
  await p.goto(BASE + 'eq.html?eq=' + T1);   // QR을 찍은 것과 같음

  // ── eq.html 로그인 상태: 소화전 입력 (휴대폰 크기 — 카메라 화면은 휴대폰용) ──
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('#send').waitFor();
  const hd = await p.locator('.fp').innerText();
  ok(/동측 계단 앞-소화전1/.test(hd) && /3F · 이번 달/.test(hd) && /점검자 홍길동/.test(hd) && /로그인한 직원 홍길동 님으로 열렸습니다/.test(hd) && /기한 후 입력/.test(hd) && await p.locator('.seg').count() === 3 && await p.locator('.shot').count() === 3, '17) 로그인 상태: PIN 없이 열림 · 점검자 = 내 이름 · 기한 후 안내 · 항목 3개');
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

  // ── 매장별 소화기 수량 엑셀 올리기·내려받기 (결정 244) ──
  const XLS = { '1F': [[], ['NO.', '브랜드명', '소화기 개수'], ['1', '카페', '3'], ['2', '신규 매장', '2'], ['', '계', '5']], '5F': [[], ['NO.', '브랜드명', '소화기 개수'], ['1', ' 꼼  데 ', '1'], ['2', '없는수량', ''], ['', '계', '1']], '메모': [['x']] };
  const FX = 'window.XLSX={read:()=>({SheetNames:' + JSON.stringify(Object.keys(XLS)) + ',Sheets:' + JSON.stringify(XLS) + '}),utils:{sheet_to_json:w=>w,book_new:()=>({SheetNames:[],Sheets:{}}),aoa_to_sheet:a=>a,book_append_sheet:(wb,w,n)=>{wb.SheetNames.push(n);wb.Sheets[n]=w;}},writeFile:(wb,n)=>{window.__xl={name:n,sheets:wb.SheetNames,rows:wb.Sheets};}};';
  const xc = await mk(TK, FX), xp2 = await xc.newPage(); xp2.on('pageerror', e => errs.push(e.message)); xp2.on('dialog', d => d.accept());
  await xp2.goto(BASE + 'app.html'); await xp2.locator('.grid6').waitFor();
  await xp2.evaluate(() => openStatus()); await xp2.locator('.tree').waitFor();
  ok(/엑셀 올리기/.test(await xp2.locator('.wrap.list').innerText()) && /엑셀 내려받기/.test(await xp2.locator('.wrap.list').innerText()), '42) 매장별 현황 첫 화면에 [엑셀 올리기] [엑셀 내려받기]');
  await xp2.setInputFiles('.wrap.list input[type=file]', { name: '소화기.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  const nAdd0 = count('ws_fe_add');
  await xp2.locator('.dialog h2:has-text("엑셀 올리기")').waitFor();
  const pv = await xp2.locator('.dialog').innerText();
  ok(/1F · 5F/.test(pv) && /카페[\s\S]*3대[\s\S]*1대[\s\S]*\+2 등록/.test(pv) && /신규 매장[\s\S]*새 매장[\s\S]*\+2 등록/.test(pv) && /꼼 데[\s\S]*\+1 등록/.test(pv) && /새로 등록 \+5대/.test(pv) && !/없는수량|계\b/.test(pv.replace('엑셀 올리기', '')) && !/메모/.test(pv), '43) 미리보기: 층 시트(1F·5F)만, 「계」·수량 없는 줄·층 아닌 시트는 뺌, 부족분 +5대');
  ok(count('ws_fe_add') === nAdd0, '44) 미리보기만으로는 저장하지 않음');
  await shot(xp2, 'x_preview');
  n0 = count('ws_fe_add'); await xp2.click('#xlGo'); await called('ws_fe_add', n0 + 2); await xp2.locator('.dialog').waitFor({ state: 'detached' });
  const adds = CALLS.filter(c => c.fn === 'ws_fe_add').slice(n0).map(c => c.a.p_d.floor + '|' + c.a.p_d.store + '|' + c.a.p_d.count).join();
  ok(adds === '1F|카페|2,1F|신규 매장|2,5F|꼼 데|1', '45) 등록하기 → 부족한 만큼만 소화기 등록 ' + adds);
  await xp2.setInputFiles('.wrap.list input[type=file]', { name: '소화기.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await xp2.locator('.dialog h2:has-text("엑셀 올리기")').waitFor();
  ok(/등록할 것 없음/.test(await xp2.locator('.dialog').innerText()) && await xp2.locator('#xlGo').isDisabled() && !/대 초과/.test(await xp2.locator('.dialog').innerText()), '46) 같은 파일을 다시 올리면 「등록할 것 없음」(중복 등록 안 됨)');
  await xp2.click('.dialog button:text-is("취소")');
  await xp2.evaluate(() => { S.floor = '5F'; go('floor'); }); await xp2.locator('.store').first().waitFor();
  ok(/5F 엑셀 올리기/.test(await xp2.locator('.wrap.list').innerText()), '47) 층 화면에는 「5F 엑셀 올리기」');
  await xp2.setInputFiles('.wrap.list input[type=file]', { name: '소화기.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await xp2.locator('.dialog h2:has-text("엑셀 올리기")').waitFor();
  ok(/엑셀 올리기 — 5F\b/.test(await xp2.locator('.dialog h2').innerText()) && !/카페/.test(await xp2.locator('.dialog').innerText()), '48) 층 화면에서 올리면 그 층 시트만 읽음');
  await xp2.click('.dialog button:text-is("취소")');
  await xp2.click('button:has-text("5F 엑셀 내려받기")'); await xp2.waitForFunction(() => window.__xl);
  const xd = await xp2.evaluate(() => window.__xl);
  ok(xd.name === '소화기 현황_5F.xlsx' && xd.sheets.join() === '5F' && JSON.stringify(xd.rows['5F'].slice(1)) === JSON.stringify([['NO.', '브랜드명', '소화기 개수'], [1, '꼼 데', 1], ['', '계', { t: 'n', f: 'SUM(C3:C3)', v: 1 }]]), '49) 내려받기: 올린 양식과 같은 칸 (시트 이름=층, NO·브랜드명·소화기 개수, 계) ' + JSON.stringify(xd.rows['5F']));
  await xp2.evaluate(() => { window.__xl = null; go('status'); }); await xp2.locator('.tree').waitFor();
  await xp2.click('button:has-text("엑셀 내려받기")'); await xp2.waitForFunction(() => window.__xl);
  const xs = (await xp2.evaluate(() => window.__xl)).sheets.join(); ok(/^(B3,)?1F,5F(,10F)?$/.test(xs), '50) 첫 화면에서 내려받으면 등록된 층 모두, 층 순서대로 ' + xs);

  // ── 층 화면에서 소화기 삭제 (결정 250) ──
  await xp2.evaluate(() => { S.floor = '1F'; go('floor'); }); await xp2.locator('.store').first().waitFor();
  ok(await xp2.locator('button:text-is("소화기 삭제")').count() === 1, '51) 층 화면에 [소화기 삭제] 버튼');
  await xp2.click('button:text-is("소화기 삭제")');
  ok(/지울 소화기를 눌러 고르세요/.test(await xp2.locator('.wrap.list').innerText()) && await xp2.locator('button:has-text("선택 0대 삭제")').isDisabled(), '52) 삭제 모드: 안내 + 고르기 전에는 [선택 0대 삭제]가 꺼져 있음');
  await xp2.click('.feb:has-text("카페-소화기1")');   // 점검 입력이 있는 것
  await xp2.click('.store:has-text("신규 매장") button:text-is("전체 선택")');
  ok(await xp2.locator('button:text-is("선택 3대 삭제")').count() === 1 && /이번 달 점검 입력 있음/.test(await xp2.locator('.feb:has-text("카페-소화기1")').innerText()), '53) 소화기 1대 + 매장 전체 선택 → 「선택 3대 삭제」, 점검 입력 있는 것은 표시');
  await xp2.click('button:text-is("선택 3대 삭제")');
  const ask = await xp2.locator('.dialog').innerText();
  ok(/소화기 3대 삭제/.test(ask) && /카페-소화기1/.test(ask) && /신규 매장-소화기1/.test(ask) && /점검을 이미 입력한 1대도 지워집니다/.test(ask), '54) 확인 창: 지울 이름 목록 + 점검 입력 있는 1대도 지워진다는 안내');
  n0 = count('ws_fe_delete'); await xp2.click('#fdBtn'); await called('ws_fe_delete', n0); await xp2.locator('.dialog').waitFor({ state: 'detached' });
  ok(last('ws_fe_delete').a.p_ids.length === 3 && !(await xp2.locator('text=신규 매장').count()) && !/지울 소화기를 눌러/.test(await xp2.locator('.wrap.list').innerText()) && await xp2.locator('button:text-is("소화기 삭제")').count() === 1, '55) 삭제 → 3대 지움, 목록 새로 읽고 삭제 모드 끝, 층 화면 그대로');

  ok(!errs.length, '41) 화면 오류 없음 ' + (errs.length ? JSON.stringify(errs) : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n실패 ' + fail + '개' : '\n소화전·공기호흡기 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
