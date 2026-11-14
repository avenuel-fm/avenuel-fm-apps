// Supabase 이관 3-2·3-3 화면 시험: 명일 작업 · TBM · 종합업무일지 · 출근현황이 Supabase 통로(ws-api.js)로 저장되는지 (fm/ws/app.html)
// 진짜 Supabase 대신 가짜(FAKE)를 씀 — 화면 → 통로 → DB 함수에 넘기는 값만 봄. DB 함수 자체 시험은 sql_test.js
// 먼저: python tools/build_fm.py   그다음: node test/sb_docs_test.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const FM = path.join(__dirname, '..', '..', '..', 'fm');
const PORT = 8132;
const TK = 'S001.' + (Date.now() + 3600e3) + '.abc';   // 화면이 보는 표 모양 (staff_id.만료ms.무작위)
const kst = () => new Date(Date.now() + 3 * 3600e3);   // 근무일 = 한국 시각 − 6시간
const D = kst().toISOString().slice(0, 10), T = new Date(Date.parse(D) + 864e5).toISOString().slice(0, 10);
const ver = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').replace('Z', '000');

/* 가짜 DB 함수 — 03_docs.sql 과 같은 답 모양 (간단히) */
const ME = { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' };
const NW = {}, TBM = {}, LOG = {}, CALLS = [], UPLOADS = [];
const KEYS = ['영업시간', '전기', '실온수', '시수', '중수', '식당시수', '식당온수', '식당가스', '식당분전반', '식기세척분전반', '매점분전반', '급탕', '환탕', '급탕탱크'];
const zero = () => Object.fromEntries(KEYS.map(k => [k, 0]));
const nwData = d => Object.assign({ date: d, ver: '', by: '', rows: [] }, NW[d]);
const logData = d => {
  const c = LOG[d];
  return { ok: true, day: d, prevDay: (Number(d.slice(0, 4)) - 1) + d.slice(4), workDay: D, cur: c ? c.cur : null, prev: null,
    vals: { c: {}, p: {}, y: {} }, month: { c: zero(), p: zero() }, year: { c: zero(), p: zero() },
    ver: c ? c.ver : '', by: c ? ME.name : '', pdf: c && c.pdf || null, night: c && c.night || '', tbm: { 전기방재: ['1층 등 교체'], 기계건축: [] } };
};
const AT = {};
const attData = d => ({ ok: true, date: d, today: D, months: [D.slice(0, 7)], ju: Array(30).fill(1), upBy: ME.name, upAt: D + ' 08:00:00', canFix: true, canBoss: true,
  people: [{ sec: '전기', role: '소장', name: ME.name, v: '', raw: '', fix: null, hol: '' },
    { sec: '기계', role: '기사', name: '김철수', v: AT.fix ? AT.fix.v : '', raw: '', fix: AT.fix ? { by: ME.name, at: D + ' 09:00:00' } : null, hol: AT.hol || '' }] });
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: ME, toastSec: 1, needSign: false, docs: { day: D, signs: 1 }, fire: { counts: { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 }, window: { start: 1, end: 5 }, day: 14, ym: D.slice(0, 7) } }),
  ws_next_work_get: a => Object.assign({ ok: true, defaultDate: T, workDay: D }, nwData(a.p_date || T)),
  ws_next_work_save: a => {
    const cur = nwData(a.p_date);
    if (a.p_ver !== cur.ver) return Object.assign({ ok: false, conflict: true, error: cur.by + '님이 먼저 고쳤어요. 새 내용을 불러왔습니다.' }, cur);
    NW[a.p_date] = { ver: ver(), by: ME.name, rows: a.p_rows };
    return Object.assign({ ok: true }, nwData(a.p_date));
  },
  ws_tbm_get: () => {
    const t = TBM[D];
    return { ok: true, day: D, today: D, signs: [{ no: 1, id: 'SG1', name: ME.name, part: ME.part, role: '소장', at: '08:01', img: '/public/sign/x.png' }], manager: { name: ME.name, img: '' },
      risks: [{ words: ['(기본)'], risk: '공구 손 다침', kind: '베임', p: 1, s: 1, fixes: [{ t: '보호장갑 착용', on: true }] }],
      works: t ? t.works : nwData(D).rows.map(r => Object.assign({ n: '' }, r)), checks: t ? t.checks : null, saved: !!t, by: t ? ME.name : '', at: t ? t.at : '',
      photos: { meet: t && t.meet || '', chant: '' }, pdf: t && t.pdf || null };
  },
  ws_tbm_save: a => {
    const t = TBM[D] = Object.assign(TBM[D] || {}, { works: a.p_d.works, checks: a.p_d.checks, at: ver() });
    if (a.p_files.meet) t.meet = a.p_files.meet.url;
    return { ok: true, at: t.at };
  },
  ws_tbm_save_pdf: a => {
    if (a.p_d) RPC.ws_tbm_save({ p_d: a.p_d, p_files: a.p_files });
    const t = TBM[D]; if (!t) return { ok: false, error: '먼저 [저장]을 눌러 주세요' };
    t.pdf = { id: 'f1', at: ver(), signs: a.p_sign_ids.length, url: a.p_files.pdf.url, shared: true };
    return { ok: true, warn: '', pdf: t.pdf };
  },
  ws_log_get: a => logData(a.p_day || D),
  ws_log_save: a => {
    const d = a.p_day, c = LOG[d];
    if (a.p_ver !== (c ? c.ver : '')) return Object.assign(logData(d), { ok: false, conflict: true, error: '홍길동님이 먼저 고쳤어요. 새 내용을 불러왔습니다.' });
    LOG[d] = { ver: ver(), cur: Object.assign({}, a.p_d), night: a.p_files.night ? a.p_files.night.url : a.p_d.night === '-' ? '' : c && c.night, pdf: c && c.pdf };
    return logData(d);
  },
  ws_att_get: a => attData(a.p_date || D),
  ws_att_fix: a => { AT.fix = { name: a.p_name, v: a.p_value }; return attData(a.p_date); },
  ws_att_holiday: a => { AT.hol = a.p_days.join(','); return attData(a.p_date || D); },
  ws_att_put: a => ({ ok: true, count: a.p_rows.length }),
  ws_log_save_pdf: a => {
    if (a.p_d) { const s = RPC.ws_log_save(a); if (!s.ok) return s; }
    LOG[a.p_day].pdf = { id: 'f2', at: ver(), url: a.p_files.pdf.url };
    return Object.assign(logData(a.p_day), { warn: '' });
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
const H2P = "window.html2pdf=function(){const o={set(){return o},from(){return o},outputPdf(){return Promise.resolve('data:application/pdf;filename=generated.pdf;base64,'+btoa('%PDF-1.4 '+'x'.repeat(300)))}};return o};";
let AC_ASKED = '', AC_N = 0;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) {
      const fn = u.pathname.slice(5), a = JSON.parse(body || '{}');
      CALLS.push({ fn, a });
      if (a.p_token !== TK) return j({ err: 'LOGIN' });
      try { return j({ data: RPC[fn](a) }); } catch (e) { return j({ err: e.message }); }
    }
    if (u.pathname === '/upload') { UPLOADS.push(JSON.parse(body)); return j({}); }
    const f = path.join(FM, decodeURIComponent(u.pathname));
    if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
}).listen(PORT);
const last = fn => CALLS.filter(c => c.fn === fn).pop();
// 알림 글자는 앞 화면 것이 투명하게 남아 있을 수 있어, 서버(가짜)에 그 함수가 새로 왔는지로 기다림
const called = async (fn, n0) => { for (let i = 0; i < 80; i++) { if (CALLS.filter(c => c.fn === fn).length > n0) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const count = fn => CALLS.filter(c => c.fn === fn).length;

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: r.request().url().indexOf('html2pdf') !== -1 ? H2P : '' }));
  await c.route('https://script.google.com/**', r => {   // 구글 웹앱 ?api=logac (공조기 가동시간)
    const u = new URL(r.request().url()); AC_N++; AC_ASKED = u.searchParams.get('api') + ' ' + u.searchParams.get('day');
    const k = n => ({ name: n, total: 2, entered: 1, off: 0, groups: [['1층', [3.5, null]]], c: { d: 3.5, m: 10, y: 100 }, p: { d: 2, m: 9, y: 90 } });
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, day: u.searchParams.get('day'), ac: { hvac: k('공조기'), curtain: k('에어커튼') } }) });
  });
  await c.addInitScript(tk => { try { localStorage.setItem('ws_token', tk); localStorage.setItem('ws_dev_at', '2026-11-14'); } catch (e) {} }, TK);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const toast = t => p.locator('.toast', { hasText: t }).waitFor({ timeout: 8000 }).then(() => true, () => false);
  await p.goto('http://localhost:' + PORT + '/ws/app.html');
  await p.locator('.grid6').waitFor();

  // ── 명일 작업 ──
  await p.evaluate(() => openNw()); await p.locator('.nwrow').first().waitFor();
  ok(await p.locator('.nwdate').getAttribute('data-date') === T, '1) 명일 작업: 기본 일자 내일 (Supabase에서 불러옴)');
  await p.fill('.nwrow .f-work input', '1층 등 교체'); await p.fill('.nwrow .f-place input', '1층');
  await p.click('#nwSave');
  ok(await toast('저장했습니다'), '2) 명일 작업 저장 → 「저장했습니다」');
  const ns = last('ws_next_work_save').a;
  ok(ns.p_date === T && ns.p_ver === '' && ns.p_rows.length === 1 && ns.p_rows[0].work === '1층 등 교체', '3) DB 함수에 일자·줄·ver 넘김');
  ok(/저장됨/.test(await p.locator('#nwState').innerText()), '4) 화면에 「저장됨」');
  NW[T].ver = ver() + 'x'; NW[T].by = '김철수';   // 다른 사람이 먼저 고침
  await p.fill('.nwrow .f-note input', '오전'); await p.click('#nwSave');
  ok(await toast('김철수님이 먼저 고쳤어요'), '5) 겹치면 안내하고 새 내용을 불러옴');

  // ── TBM ──
  NW[D] = { ver: ver(), by: ME.name, rows: [{ dept: '전방파트', place: '1층', work: '등 교체', note: '' }] };
  await p.evaluate(() => openTbm()); await p.locator('.tbw').first().waitFor();
  ok(/등 교체/.test(await p.locator('.tbw').first().innerText()), '6) TBM: 오늘 명일 작업에서 작업 표');
  await p.locator('.tbph').first().locator('input[type=file]').nth(1).setInputFiles(path.join(__dirname, 'gauge.jpg'));
  await p.waitForFunction(() => S.tbm && S.tbm.up.meet);
  await p.click('.nwbar button:text-is("저장")');
  ok(await toast('저장했습니다'), '7) TBM 저장');
  const up = UPLOADS.find(x => /^tbm_meet\//.test(x.p)), ts = last('ws_tbm_save').a;
  ok(up && /^tbm_meet\/\d{4}-\d{2}\/[a-z0-9]+\.jpg$/.test(up.p) && up.type === 'image/jpeg', '8) 회의 사진을 버킷 tbm_meet/ 아래 JPEG로 올림 ' + (up && up.p));
  ok(ts.p_files.meet && ts.p_files.meet.path === up.p && !('meet' in ts.p_d) && ts.p_d.works.length === 1, '9) DB 함수에는 사진 주소만 (사진 내용은 안 보냄)');
  await p.click('.nwbar button:text-is("PDF로 저장")');
  ok(await toast('PDF로 저장했습니다'), '10) TBM PDF로 저장');
  const pu = UPLOADS.find(x => /^tbm_pdf\//.test(x.p)), tp = last('ws_tbm_save_pdf').a;
  ok(pu && pu.type === 'application/pdf' && /\.pdf$/.test(pu.p) && tp.p_files.pdf.path === pu.p && tp.p_sign_ids.join() === 'SG1', '11) PDF를 버킷 tbm_pdf/ 에 올리고 서명 번호 넘김');
  ok(await p.locator('a.btn.pri', { hasText: 'PDF 열기' }).getAttribute('href') === tp.p_files.pdf.url, '12) [PDF 열기] = 버킷 공개 주소');
  await p.evaluate(() => loadTbm(true));
  ok(/\/ws-files\/tbm_meet\//.test(await p.locator('.tbph img').first().getAttribute('src')), '13) 다시 불러오면 회의 사진은 버킷 주소로 보임');

  // ── 종합업무일지 (PC) ──
  await p.evaluate(() => openLog()); await p.locator('#lgSheet').waitFor();
  ok(AC_ASKED === 'logac ' + D && await p.locator('.acb[data-ac="공조기"]').count() === 1, '14) 일지: 공조기 가동시간은 구글 ?api=logac 에서 (' + AC_ASKED + ')');
  await p.fill('input.lgin[data-k="전기"]', '1234');
  await p.click('#lgSave');
  ok(await toast('저장했습니다'), '15) 일지 저장');
  const ls = last('ws_log_save').a;
  ok(ls.p_day === D && ls.p_ver === '' && ls.p_d['전기'] === '1234' && ls.p_d.works['전기방재'][0] === '1층 등 교체' && JSON.stringify(ls.p_files) === '{}', '16) DB 함수에 숫자·금일작업(TBM에서) 넘김');
  ok(AC_N === 1, '17) 저장 뒤 공조기는 10분 기억 (구글 다시 안 부름)');
  const n18 = count('ws_log_save_pdf'); await p.click('#lgPdf');
  ok(await called('ws_log_save_pdf', n18) && await toast('PDF로 저장했습니다'), '18) 일지 PDF로 저장');
  const lp = last('ws_log_save_pdf').a, lu = UPLOADS.find(x => /^log_pdf\//.test(x.p));
  ok(lu && lp.p_files.pdf.path === lu.p && lp.p_d === null && lp.p_ver === LOG[D].ver, '19) 고친 것 없으면 PDF만 (저장 안 함, ver 넘김)');
  ok(await p.locator('#lgBar a', { hasText: 'PDF 열기' }).getAttribute('href') === lp.p_files.pdf.url, '20) 일지 [PDF 열기] = 버킷 주소');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_log.png') });

  // ── 출근현황 (3-3) ──
  await p.setViewportSize({ width: 390, height: 800 });
  await p.evaluate(() => openAtt()); await p.locator('.atorg').waitFor();
  ok(/김철수/.test(await p.locator('.atorg').innerText()) && last('ws_att_get').a.p_date === '', '21) 출근현황: Supabase에서 그날 표');
  await p.evaluate(() => atFixSave(S.at.r.people.findIndex(x => x.name === '김철수'), '연'));
  ok(await toast('김철수 → 연'), '22) 그날 고치기 → 안내');
  const af = last('ws_att_fix').a;
  ok(af.p_date === D && af.p_name === '김철수' && af.p_value === '연', '23) DB 함수에 날짜·이름·상태 넘김');
  await p.evaluate(() => { S.at.hol = ['토', '월']; return atHolSave(S.at.r.people.findIndex(x => x.name === '김철수')); });
  ok(last('ws_att_holiday').a.p_days.join() === '토,월' && await toast('기본 휴일 저장'), '24) 기본 휴일 저장');
  const xr = await p.evaluate(() => run('attPut', S.token, S.at.r.date.slice(0, 7), [{ sec: '전기', role: '소장', name: '홍길동', days: [''] }],
    'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + btoa('PK' + 'x'.repeat(200))));
  const xu = UPLOADS.find(x => /^roster_xlsx\//.test(x.p)), xp = last('ws_att_put').a;
  ok(xr.ok && xu && /^roster_xlsx\/\d{4}-\d{2}\/[a-z0-9]+\.xlsx$/.test(xu.p) && /spreadsheetml/.test(xu.type) && xp.p_file.path === xu.p, '25) 엑셀 원본을 버킷 roster_xlsx/ 에 올리고 주소만 넘김 ' + (xu && xu.p));
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_att.png') });
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n화면 시험 실패 ' + fail + '개' : '\n3-2·3-3 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
