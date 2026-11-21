// 온습도/공조기/에어커튼 입력 화면 시험 (WS_온습도공조기, 결정 192·194·196): 탭 4개 · 온습도 · 가동시간 · 리포트 · kW·단가 · 메인 미입력 알림
// 진짜 Supabase 대신 가짜 — 화면 → 통로(ws-api.js) → DB 함수에 넘기는 값만 봄. DB 함수 자체는 sql_test.js (19_climate.sql)
// 먼저: python tools/build_fm.py   그다음: node test/sb_climate_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8133;
const TK = 'S001.' + (Date.now() + 3600e3) + '.abc';
const D = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const Y = new Date(Date.parse(D) - 864e5).toISOString().slice(0, 10);
const ME = { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' };
const CALLS = [];
const UNITS = {
  hvac: [{ u: '7F-39', name: '7F-39', sub: '', grp: '6층', tone: 'f6', zone: '1구역', s: 600, e: 1310, ew: 1310, kw: '7.5' }, { u: '6F-36', name: '6F-36', sub: '', grp: '6층', tone: 'f6', zone: '2구역', s: 600, e: 1310, ew: 1310, kw: null },
    { u: '5F-27', name: '5F-27', sub: '', grp: '5층', tone: 'f5', zone: '1구역', s: 600, e: 1160, ew: 1220, kw: null }],
  curtain: [{ u: '1G1OUT-1', name: '1번', sub: '1G OUT', grp: '1G OUT', tone: 'f1out', zone: null, s: 600, e: 1200, ew: 1170, kw: '1.2' }, { u: '1G1IN-1', name: '1번', sub: '1G IN', grp: '1G IN', tone: 'f1in', zone: null, s: 600, e: 1200, ew: 1170, kw: null }]
};
const REC = { hvac: {}, curtain: {} }, CLIM = [];
let PRICE = '120', KW = { '7F-39': '7.5', '1G1OUT-1': '1.2' };
const ZONES = [['6F', '1구역'], ['6F', '2구역'], ['6F', '3구역'], ['B1F', '1구역']];
const ug = (kind, day) => ({ ok: true, kind, day, workDay: D, wkend: false, units: UNITS[kind], recs: REC[kind][day] || {} });
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: ME, toastSec: 1, needSign: false, docs: { day: D, signs: 1 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 }, window: { start: 1, end: 5 }, day: 14, ym: D.slice(0, 7) } }),
  ws_usage_todo: () => ({ ok: true, day: Y, when: '어제', hvac: 3, curtain: 0 }),
  ws_usage_get: a => ug(a.p_kind, a.p_day || D),
  ws_usage_save: a => {
    const m = REC[a.p_kind][a.p_day] = REC[a.p_kind][a.p_day] || {};
    a.p_rows.forEach(r => { m[r.u] = { s: r.s, e: r.e, off: !!r.off, by: ME.name, ver: 'v' }; });
    return ug(a.p_kind, a.p_day);
  },
  ws_usage_report: a => ({ ok: true, from: a.p_from || '2024-05-01', to: a.p_to, workDay: D, price: PRICE, first: '2024-05-01',
    units: UNITS[a.p_kind].map(u => Object.assign({}, u, { kw: KW[u.u] || null })),
    rows: [[D, a.p_kind === 'hvac' ? '7F-39' : '1G1OUT-1', 600], [Y, a.p_kind === 'hvac' ? '7F-39' : '1G1OUT-1', 540], [Y, a.p_kind === 'hvac' ? '6F-36' : '1G1IN-1', 0], [Y, 'OLD-3', 300]] }),
  ws_climate_get: () => ({ ok: true, day: D, zones: ZONES, recs: CLIM.slice() }),
  ws_climate_add: a => { a.p_rows.forEach(r => CLIM.push({ at: '14:05', floor: r.floor, zone: r.zone, t: Number(r.t), h: Number(r.h), di: 0 })); return RPC.ws_climate_get(); },
  ws_climate_report: a => ({ ok: true, from: a.p_from || '2024-05-01', to: a.p_to, zones: ZONES,
    rows: [[D + ' 11:00', '6F', '1구역', 24.1, 52, 70.8, 11.2, 48], [D + ' 15:00', '6F', '2구역', 27.5, 66, 77.1, 12, 40]] }),
  ws_equip_kw_get: () => ({ ok: true, price: PRICE, hvac: UNITS.hvac.map(u => Object.assign({}, u, { kw: KW[u.u] || null })), curtain: UNITS.curtain.map(u => Object.assign({}, u, { kw: KW[u.u] || null })) }),
  ws_equip_kw_save: a => { if (a.p_d.price != null) PRICE = a.p_d.price; Object.assign(KW, a.p_d.hvac, a.p_d.curtain); return RPC.ws_equip_kw_get(); },
  ws_ahu_get: a => ({ ok: true, day: a.p_day || D, workDay: D, units: [{ no: '7F-39', room: '공조실-4', place: '6층' }], rec: null, wx: {}, signs: { boss: null, part: null } }),
  ws_menu: () => ({ ok: true, off: [] })
};
const FAKE = `window.supabase = { createClient() {
  const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  return {
    auth: { async getSession() { return { data: { session: { user: { email: 'team@avenuel-fm.app' } } } }; }, async signOut() { return {}; } },
    async rpc(fn, args) { const r = await post('/rpc/' + fn, args); return r.err ? { data: null, error: { message: r.err } } : { data: r.data, error: null }; },
    storage: { from() { return { async upload() { return { error: null }; }, getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } }
  };
} };`;
// Chart.js 흉내: 그린 횟수·종류만 남김
const CHART = 'window.Chart=function(el,cfg){window.CHART_N=(window.CHART_N||0)+1;window.CHART_T=cfg.type+":"+cfg.data.datasets.length;this.destroy=function(){}};';
http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'), j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) {
      const fn = u.pathname.slice(5), a = JSON.parse(body || '{}');
      CALLS.push({ fn, a });
      if (a.p_token !== TK) return j({ err: 'LOGIN' });
      if (!RPC[fn]) return j({ err: 'no ' + fn });
      try { return j({ data: RPC[fn](a) }); } catch (e) { return j({ err: e.message }); }
    }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);
const last = fn => CALLS.filter(c => c.fn === fn).pop();
const count = fn => CALLS.filter(c => c.fn === fn).length;
const called = async (fn, n0) => { for (let i = 0; i < 80; i++) { if (count(fn) > n0) return true; await new Promise(r => setTimeout(r, 100)); } return false; };

(async () => {
  const b = await chromium.launch();
  const ctx = async w => {
    const c = await b.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: /Chart\.js/.test(r.request().url()) ? CHART : '' }));
    await c.route('https://script.google.com/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }));
    await c.route('https://api.open-meteo.com/**', r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { temperature_2m: 11.24, relative_humidity_2m: 47.6 } }) }));
    await c.addInitScript(tk => { try { localStorage.setItem('ws_token', tk); localStorage.setItem('ws_dev_at', '2026-11-14'); } catch (e) {} }, TK);
    const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:' + PORT + '/ws/app.html'); await p.locator('.grid6').waitFor();
    return p;
  };
  const toastOf = (p, t) => p.locator('.toast', { hasText: t }).waitFor({ timeout: 8000 }).then(() => true, () => false);

  // ── 휴대폰 ──
  const p = await ctx(390);
  const td = await p.locator('.todo').innerText();
  ok(/어제 가동시간 미입력/.test(td) && /공조기 3대/.test(td.replace(/\s+/g, ' ')) && !/에어커튼/.test(td.split('\n').slice(1).join(' ')), 'C1) 메인: 「어제 가동시간 미입력 · 공조기 3대」 (0대인 에어커튼은 버튼 없음)');
  await p.screenshot({ path: path.join(__dirname, 'shot_cl_main.png') });
  await p.click('.todo button'); await p.locator('.uc').first().waitFor();
  ok(last('ws_usage_get').a.p_kind === 'hvac' && last('ws_usage_get').a.p_day === Y && await p.locator('.nwdate').getAttribute('data-date') === Y, 'C2) 알림 누르면 공조기 가동시간 · 어제 날짜로 열림');
  const tabs = await p.locator('.cltabs button').allInnerTexts();
  ok(tabs.join('|') === 'AHU 환기온도 점검일지|온습도|공조기 가동시간|에어커튼 가동시간' && /on/.test(await p.locator('.cltabs button').nth(2).getAttribute('class')), 'C3) 탭 4개 · 지금 탭 표시 (' + tabs.join('|') + ')');
  ok(await p.locator('.flnav button').count() === 2 && await p.locator('.uc').count() === 2 && /6층/.test(await p.locator('.flhd').innerText()), 'C4) 휴대폰: 층 한 쪽씩 (6층 2대) · 층 고르기 2칸');
  ok(await p.locator('.uc[data-card="7F-39"] select[data-f="eh"]').inputValue() === '9' && await p.locator('.uc[data-card="7F-39"] select[data-f="ea"]').inputValue() === 'pm' && /11시간 50분/.test(await p.locator('.uc[data-card="7F-39"] .f').innerText()), 'C5) 기본 시각 채움 (6층 오후 9:50 · 11시간 50분)');
  await p.selectOption('.uc[data-card="7F-39"] select[data-f="eh"]', '8');
  ok(/10시간 50분/.test(await p.locator('.uc[data-card="7F-39"] .f').innerText()) && /1대 저장 안 함/.test(await p.locator('#useState').innerText()), 'C6) 시각 바꾸면 가동시간 바로 다시 셈 · 「1대 저장 안 함」');
  await p.check('.uc[data-card="6F-36"] input[data-f="off"]');
  ok(/미가동/.test(await p.locator('.uc[data-card="6F-36"] .f').innerText()) && /isoff/.test(await p.locator('.uc[data-card="6F-36"]').getAttribute('class')), 'C7) 미가동 체크 → 0시간 · 흐리게');
  let n0 = count('ws_usage_save'); await p.click('#useSave');
  ok(await called('ws_usage_save', n0) && await toastOf(p, '2대 저장했습니다'), 'C8) 저장');
  let sv = last('ws_usage_save').a;
  ok(sv.p_kind === 'hvac' && sv.p_day === Y && JSON.stringify(sv.p_rows) === '[{"u":"7F-39","s":600,"e":1250,"off":false},{"u":"6F-36","s":null,"e":null,"off":true}]', 'C9) DB 함수에 날짜·장비별 분 (오후 8:50 = 1250) · 미가동 ' + JSON.stringify(sv.p_rows));
  await p.click('.nextfl button:has-text("다음")');
  ok(/5층/.test(await p.locator('.flhd').innerText()) && await p.locator('.uc').count() === 1, 'C10) [다음] → 5층');
  await p.selectOption('.uc[data-card="5F-27"] select[data-f="ea"]', 'am'); await p.selectOption('.uc[data-card="5F-27"] select[data-f="eh"]', '9');
  await p.click('#useSave');
  ok(await toastOf(p, '종료가 시작보다 빠릅니다') && /종료가 시작보다/.test(await p.locator('#useState').innerText()), 'C11) 종료가 시작보다 빠르면 저장 안 하고 아래 줄에 이유');
  await p.selectOption('.uc[data-card="5F-27"] select[data-f="ea"]', 'pm');
  n0 = count('ws_usage_save'); await p.click('#useSave'); await called('ws_usage_save', n0);
  ok(JSON.stringify(last('ws_usage_save').a.p_rows) === '[{"u":"5F-27","s":600,"e":1280,"off":false}]', 'C12) 고친 것만 다시 저장 ' + JSON.stringify(last('ws_usage_save').a.p_rows));
  await p.screenshot({ path: path.join(__dirname, 'shot_cl_use.png'), fullPage: true });
  // 에어커튼 탭: 안 고친 쪽도 [저장] = 화면의 아직 저장 안 한 장비(기본 시각) 저장
  await p.click('.cltabs button:has-text("에어커튼")'); await p.locator('.uc[data-card="1G1OUT-1"]').waitFor();
  ok(/1번/.test(await p.locator('.uc .flname').first().innerText()) && /1G OUT/.test(await p.locator('.uc .flname').first().innerText()) && await p.locator('.uc[data-card="1G1OUT-1"] select[data-f="eh"]').inputValue() === '8', 'C13) 에어커튼: 「1G OUT 1번」 · 기본 오후 8:00');
  n0 = count('ws_usage_save'); await p.click('#useSave'); await called('ws_usage_save', n0);
  ok(last('ws_usage_save').a.p_kind === 'curtain' && JSON.stringify(last('ws_usage_save').a.p_rows) === '[{"u":"1G1OUT-1","s":600,"e":1200,"off":false}]', 'C14) 고친 것 없이 [저장] = 이 쪽의 아직 저장 안 한 장비를 기본 시각으로');

  // 온습도 탭
  await p.click('.cltabs button:has-text("온습도")'); await p.locator('.zr').first().waitFor();
  await p.waitForFunction(() => S.clim && S.clim.out.t !== '');
  ok(await p.locator('input[aria-label="실외온도"]').inputValue() === '11.2' && await p.locator('input[aria-label="실외습도"]').inputValue() === '48', 'C15) 실외 온도·습도는 날씨에서 자동 (11.2℃ · 48%)');
  await p.fill('input[aria-label="6층 1구역 실내온도"]', '24.1'); await p.fill('input[aria-label="6층 1구역 실내습도"]', '52');
  ok(/70\.8 · 쾌적/.test(await p.locator('#di-6F-1구역').innerText()), 'C16) 넣는 동안 불쾌지수 70.8 · 쾌적');
  await p.fill('input[aria-label="6층 2구역 실내온도"]', '28'); await p.fill('input[aria-label="6층 2구역 실내습도"]', '70');
  ok(/불쾌/.test(await p.locator('#di-6F-2구역').innerText()) && /온도가 높습니다/.test(await p.locator('#climAdv').innerText()), 'C17) 높으면 「불쾌」 · 조치 권고');
  await p.fill('input[aria-label="6층 3구역 실내온도"]', '25');
  await p.click('#climSave');
  ok(await toastOf(p, '6층 3구역: 온도와 습도를 둘 다'), 'C18) 한 칸만 넣으면 안내');
  await p.fill('input[aria-label="6층 3구역 실내온도"]', '');
  n0 = count('ws_climate_add'); await p.click('#climSave'); await called('ws_climate_add', n0);
  const ca = last('ws_climate_add').a;
  ok(JSON.stringify(ca.p_rows) === '[{"floor":"6F","zone":"1구역","t":"24.1","h":"52"},{"floor":"6F","zone":"2구역","t":"28","h":"70"}]' && JSON.stringify(ca.p_out) === '{"t":"11.2","h":"48"}' && await toastOf(p, '2곳 저장했습니다'), 'C19) 저장 → 구역 2곳 + 실외');
  ok(/오늘 14:05 · 24\.1℃ 52%/.test(await p.locator('.zr').first().innerText()), 'C20) 저장 뒤 구역마다 오늘 마지막 기록');
  await p.screenshot({ path: path.join(__dirname, 'shot_cl_clim.png'), fullPage: true });
  // AHU 탭: 11:00
  await p.click('.cltabs button:has-text("AHU")'); await p.locator('.hvtime').waitFor();
  ok(/11:00/.test(await p.locator('.hvtime').innerText()) && !/12:00/.test(await p.locator('#app').innerText()), 'C21) AHU 탭: 첫 점검 11:00 (12:00 글자 없음)');
  // 서류작업 메뉴 줄
  await p.evaluate(() => go('docs'));
  ok(/온습도\/공조기\/에어커튼 입력/.test(await p.locator('#app').innerText()), 'C22) 서류작업 메뉴: 「온습도/공조기/에어커튼 입력」');
  ok(!p.errs.length, 'C23) 휴대폰 화면 오류 없음 ' + p.errs.join(' / '));

  // ── PC ──
  const q = await ctx(1280);
  await q.evaluate(() => openUse('hvac')); await q.locator('.ucpc').waitFor();
  ok(await q.locator('.ucpc tbody tr').count() === 2 && await q.locator('.uc').count() === 3 && await q.locator('.flnav').count() === 0, 'C24) PC: 층 × 구역 표 한 장에 모두 (층 고르기 없음)');
  await q.screenshot({ path: path.join(__dirname, 'shot_cl_use_pc.png'), fullPage: true });
  await q.click('button:has-text("리포트")'); await q.locator('.kpis').first().waitFor();
  await q.waitForFunction(() => window.CHART_N > 0);
  const rt = await q.locator('#repBody').innerText();
  ok(/오늘 미입력/.test(rt) && /2대 \/ 3대/.test(rt) && /단가 120원\/kWh/.test(rt) && /kW 미입력 2대/.test(rt) && /75\.0kWh/.test(rt) && /9,000원/.test(rt), 'C25) 공조기 리포트: 미입력 · 단가 · kW 미입력 2대 · 오늘 10시간×7.5kW = 75kWh · 9,000원');
  ok(!/OLD-3/.test(rt) && await q.evaluate(() => window.CHART_T) === 'bar:2', 'C26) 옛 3·37·38번은 통계에서 뺌 · 그래프 (막대 + 선)');
  const dl = q.waitForEvent('download'); await q.click('button:has-text("CSV")');
  const csvF = await (await dl).path(), csv = fs.readFileSync(csvF, 'utf8');
  ok(/^﻿날짜,공조기,가동시간\(시간\),kW,전력량\(kWh\),예상 요금\(원\)/.test(csv) && /7F-39,10\.0,7\.5,75\.0,9000/.test(csv) && !/OLD-3/.test(csv), 'C27) CSV 받기 (한글 깨짐 방지 표시 · 전력·요금 칸)');
  await q.screenshot({ path: path.join(__dirname, 'shot_cl_rep.png'), fullPage: true });
  await q.click('.nwbar button:has-text("뒤로")'); await q.locator('.ucpc').waitFor();
  ok(await q.evaluate(() => S.view) === 'use', 'C28) 리포트 [뒤로] → 공조기 가동시간');
  await q.evaluate(() => openClim()); await q.locator('.cltbl').waitFor();
  await q.click('button:has-text("리포트")'); await q.locator('.kpis').waitFor();
  const ct = await q.locator('#repBody').innerText();
  ok(/측정 건수\s*2건/.test(ct) && /주의/.test(ct) && /온도가 높습니다/.test(ct), 'C29) 온습도 리포트: 건수 · 단계 · 조치 권고');
  // kW·단가 (소장)
  await q.evaluate(() => openKw()); await q.locator('input[aria-label="전력 단가"]').waitFor();
  ok(await q.locator('input[aria-label="전력 단가"]').inputValue() === '120' && await q.locator('input[aria-label="6F-36 전력"]').inputValue() === '', 'C30) 장비 전력·단가: 지금 값 · 모르는 칸은 빈 칸');
  await q.fill('input[aria-label="6F-36 전력"]', '5,5'); await q.fill('input[aria-label="전력 단가"]', '135');
  n0 = count('ws_equip_kw_save'); await q.click('.nwbar button:has-text("저장")'); await called('ws_equip_kw_save', n0);
  ok(JSON.stringify(last('ws_equip_kw_save').a.p_d) === '{"hvac":{"6F-36":"5.5"},"curtain":{},"price":"135"}', 'C31) 고친 칸만 저장 (쉼표 → 점) ' + JSON.stringify(last('ws_equip_kw_save').a.p_d));
  ok(!q.errs.length, 'C32) PC 화면 오류 없음 ' + q.errs.join(' / '));

  await b.close();
  console.log(fail ? '✗ 실패 ' + fail + '개' : '온습도/공조기/에어커튼 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + (e && e.stack || e)); process.exit(1); });
