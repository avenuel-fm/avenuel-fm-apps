// Supabase 이관 3-2~3-5 화면 시험: 명일 작업 · TBM · 종합업무일지 · 출근현황 · 소화기(QR 점검 check-sb.html 포함) · 전열필증(eh-sb.html 포함) · 공사장 점검 · 환경설정가 Supabase 통로(ws-api.js)로 저장되는지 (fm/ws/app.html)
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
    ver: c ? c.ver : '', by: c ? ME.name : '', pdf: c && c.pdf || null, night: c && c.night || '', tbm: { 전기방재: ['1층 등 교체'], 기계건축: [] },
    signs: { front: null, mech: null, vice: { name: '홍길동', img: SIGN_IMG }, boss: { name: '홍길동', img: SIGN_IMG } } };
};
const AT = {};
const AHU = {}, AHU_UNITS = [{ no: '7F-39', room: '공조실-4', place: '6층 더페어링,와인 라콘차' }, { no: '6F-36', room: '공조실-1', place: '6층 뮤지엄' }, { no: 'B3F-HVU1', room: '공조실-1', place: 'B3층 직원식당 주방 (외조기)' }];
var SIGN_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 60'%3E%3Cpath d='M8 40 C20 10 30 50 42 25 S60 45 70 20 S95 50 112 18' fill='none' stroke='%23123' stroke-width='4'/%3E%3C/svg%3E";
const ahuData = d => ({ ok: true, day: d, workDay: D, units: AHU_UNITS, rec: AHU[d] || null, wx: { weather: '맑음', tmin: 4, tmax: 13.5, humidity: 45 }, signs: { boss: { name: '홍길동', img: SIGN_IMG }, part: null } });
const attData = d => ({ ok: true, date: d, today: D, months: [D.slice(0, 7)], ju: Array(30).fill(1), upBy: ME.name, upAt: D + ' 08:00:00', canFix: true, canBoss: true,
  people: [{ sec: '전기', role: '소장', name: ME.name, v: '', raw: '', fix: null, hol: '' },
    { sec: '기계', role: '기사', name: '김철수', v: AT.fix ? AT.fix.v : '', raw: '', fix: AT.fix ? { by: ME.name, at: D + ' 09:00:00' } : null, hol: AT.hol || '' }] });
const FE = [], CHK = { exists: false };
const EH_F = ['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '팝업'];
const ehData = () => ({ ok: true, floor: '1F', floors: EH_F.map(f => ({ code: f, stores: f === '1F' ? 1 : 0, items: f === '1F' ? 1 : 0 })),
  stores: [{ id: 'WS-ES-1', no: 1, name: '카페', items: [{ id: 'WS-EH-1', no: '1F-1-1', name: '오븐', w: '3000', maker: 'S', m1: '갑', m2: '을', date: '2026-01-02', printed: '', token: 'abcdefghjkmp' }] }],
  names: [['1F', '카페', 'WS-ES-1']], empty: false, execUrl: '', dpi: 203 });
const STAFF = [{ staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, { staff_id: 'S002', name: '김철수', part: '기건파트', role: '직원' }];
const RISK = [{ words: '(기본)', risk: '손 다침', kind: '베임', p: 1, s: 2, fixes: [{ t: '보호장갑', on: true }] },
  { words: '분전반, 배선', risk: '감전', kind: '감전', p: 2, s: 3, fixes: [{ t: '전원 차단', on: true }] }];
const RW = [], WD = [], WN = [], HJ = []; let WF = 0;
const CSITE = { id: 'WS-CS-1', name: '5F 리모와', work: '인테리어', co: 'A사' }, CS = {};
const feData = () => ({ ok: true, items: FE, execUrl: '', label: { w: 50, h: 50, dpi: 203 } });
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
  // 공조기 환기온도 (12_ahu.sql) — 고친 칸만 합침
  ws_ahu_get: a => ahuData(a.p_day || D),
  ws_ahu_save: a => {
    const r = AHU[a.p_day] = AHU[a.p_day] || { temps: {}, authors: [] };
    Object.entries(a.p_c).forEach(([k, v]) => { if (k !== 'temps') r[k] = v === '' ? null : Number(v); });
    Object.entries(a.p_c.temps || {}).forEach(([u, o]) => { r.temps[u] = Object.assign(r.temps[u] || {}, ...Object.entries(o).map(([t, v]) => ({ [t]: v === '' ? null : Number(v) }))); });
    if (r.authors.indexOf(ME.name) === -1) r.authors.push(ME.name);
    r.ver = ver(); r.by = ME.name;
    return ahuData(a.p_day);
  },
  ws_ahu_save_pdf: a => { if (!AHU[a.p_day]) return { ok: false, error: '먼저 [저장]을 눌러 주세요' }; AHU[a.p_day].pdf = { url: a.p_file.url, at: ver() }; return ahuData(a.p_day); },
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
  ws_fe_list: () => feData(),
  ws_fe_add: a => { FE.push({ id: 'WS-FE-1', floor: a.p_d.floor, store: a.p_d.store, no: 1, name: a.p_d.store + '-소화기1', token: 'abcdefghjkmn', created: '' }); return Object.assign(feData(), { added: [a.p_d.store + '-소화기1'] }); },
  ws_label_save: a => ({ ok: true, label: { w: a.p_w, h: a.p_h, dpi: 203 } }),
  ws_fe_status: a => ({ ok: true, ym: D.slice(0, 7), curYm: D.slice(0, 7), day: 14, window: { start: 1, end: 5 }, isCurrent: true, months: [D.slice(0, 7)],
    items: [{ id: 'WS-FE-1', floor: '1F', store: '카페', name: '카페-소화기1', no: 1, state: 'ok', checkId: 'WS-FC-1', at: D + ' 10:00:00', late: true }], counts: { ok: 1, bad: 0, wait: 0, miss: 0, total: 1 } }),
  ws_fe_detail: () => ({ ok: true, name: '카페-소화기1', floor: '1F', ym: D.slice(0, 7), state: '이상없음', at: D + ' 10:00:00', late: true,
    photo: '/storage/v1/object/public/ws-files/fire/abcdefghjkmn/p.jpg', signA: '/storage/v1/object/public/ws-files/fire/abcdefghjkmn/m.png', signB: '' }),
  ws_check_init: () => ({ ok: true, fe: { name: '카페-소화기1', floor: '1F', store: '카페' }, ym: D.slice(0, 7), monthLabel: '이번 달', window: { start: 1, end: 5 }, day: 14, late: true, early: false, exists: CHK.exists, photo: { w: 640, q: 0.6 } }),
  ws_check_submit: a => { CHK.exists = true; return { ok: true, state: a.p_d.state, late: true, checkId: 'WS-FC-1', name: '카페-소화기1', at: D + ' 10:00:00' }; },
  /* 3-5 전열필증 · 공사장 점검 */
  ws_eh_list: () => ehData(),
  ws_eh_save: a => Object.assign(ehData(), { saved: '1F-1-2' }),
  ws_eh_import: () => ehData(),
  ws_eh_view: a => a.p_qr === 'abcdefghjkmp' ? { ok: true, item: { id: 'WS-EH-1', no: '1F-1-1', name: '오븐', w: '3000', maker: 'S', m1: '갑', m2: '을', date: '2026-01-02', floor: '1F', store: '카페' } }
    : { ok: false, error: '삭제된 필증입니다. 시설팀에 알려 주세요.', no: '1F-1-9' },
  ws_cs_home: () => ({ ok: true, day: D, admin: true, items: [{ t: '정리정돈·통로', d: '통로 확보', use: true }], sites: [CSITE], today: CS.check ? [CS.check] : [], past: [] }),
  ws_cs_get: a => ({ ok: true, date: D, round: a.p_round || 1, site: CSITE, items: CS.items || [{ t: '정리정돈·통로', d: '통로 확보', st: '', memo: '', photos: [] }],
    check: CS.check || null, rounds: CS.check ? [CS.check] : [] }),
  ws_cs_save: a => {
    let n = 0;
    CS.items = a.p_list.map(x => Object.assign({}, x, { photos: x.photos.map(ph => ({ id: ph.id || 'P' + (++n), at: ph.at, src: ph.file ? ph.file.url : '' })) }));
    CS.check = Object.assign(CS.check || { id: 'WS-CK-1', date: D, site: CSITE.id, round: 1, name: CSITE.name, work: '', co: '', by: ME.name, at: D + ' 14:00:00', pdf: null }, { ok: 1, bad: 0, na: 0, saved: ver(), stale: false });
    return { ok: true, items: CS.items.map(x => x.photos.map(ph => ph.id)), check: CS.check, rounds: [CS.check] };
  },
  ws_cs_save_pdf: a => { CS.check.pdf = { url: a.p_file.url, at: ver() }; return { ok: true, check: CS.check, rounds: [CS.check], warn: '' }; },
  /* 위험작업신청서 */
  ws_rw_list: () => ({ ok: true, admin: true, floors: ['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '10F', '외곽'], list: RW.map(r => r.item) }),
  ws_rw_add: a => {
    const x = RW.find(r => r.cid === a.p_cid);
    if (x) return { ok: true, dup: true, item: x.item };
    const item = { id: 'WS-RK-' + (RW.length + 1), day: a.p_day || D, co: a.p_co, floor: a.p_floor, by: ME.name, at: '11/24 09:1' + RW.length, src: a.p_file.url };
    RW.push({ cid: a.p_cid, item }); return { ok: true, item };
  },
  ws_rw_delete: a => { const i = RW.findIndex(r => r.item.id === a.p_id); RW.splice(i, 1); return { ok: true }; },
  ws_dw_list: () => ({ ok: true, floors: [], list: WD.slice() }),
  ws_dw_save: a => {
    const d = a.p_d, pic = (l, old) => (l || []).map(x => x.file ? { id: 'F' + (++WF), src: x.file.url } : (old || []).find(y => y.id === x.id)).filter(Boolean);
    const old = WD.find(x => x.id === d.id), item = { id: d.id || 'WS-WD-' + (WD.length + 1), day: d.day, parts: d.parts, workers: d.workers, floor: d.floor, content: d.content, mats: d.mats.filter(m => m.n), note: d.note,
      before: pic(d.before, old && old.before), after: pic(d.after, old && old.after), by: ME.name, at: '11/24 10:00' };
    if (old) WD[WD.indexOf(old)] = item; else WD.push(item); return { ok: true, item };
  },
  ws_dw_delete: a => { WD.splice(WD.findIndex(x => x.id === a.p_id), 1); return { ok: true }; },
  ws_dn_list: () => ({ ok: true, floors: [], list: WN.slice() }),
  ws_dn_save: a => {
    const d = a.p_d, pic = (l, old) => (l || []).map(x => x.file ? { id: 'F' + (++WF), src: x.file.url } : (old || []).find(y => y.id === x.id)).filter(Boolean);
    const old = WN.find(x => x.id === d.id), item = { id: d.id || 'WS-WN-' + (WN.length + 1), day: d.day, co: d.co, floor: d.floor, content: d.content, note: d.note,
      photos: pic(d.photos, old && old.photos), fire: pic(d.fire, old && old.fire), pledge: pic(d.pledge, old && old.pledge), by: ME.name, at: '11/24 10:00' };
    if (old) WN[WN.indexOf(old)] = item; else WN.push(item); return { ok: true, item };
  },
  ws_dn_delete: a => { WN.splice(WN.findIndex(x => x.id === a.p_id), 1); return { ok: true }; },
  ws_hj_list: () => ({ ok: true, list: HJ.slice() }),
  ws_hj_save: a => {
    const d = a.p_d, one = (x, old) => x && x.file ? { id: 'F' + (++WF), src: x.file.url } : x && x.id && old && old.id === x.id ? old : null, old = HJ.find(x => x.id === d.id);
    const item = { id: d.id || 'WS-HJ-' + (HJ.length + 1), day: d.day, due: new Date(Date.parse(d.day) + 10 * 864e5).toISOString().slice(0, 10), items: d.items.map((x, i) => ({ n: x.n, t: x.t, photo: one(x.photo, old && old.items[i] && old.items[i].photo) })),
      signSite: one(d.signSite, old && old.signSite), signFm: one(d.signFm, old && old.signFm), by: ME.name, at: '11/25 10:00' };
    if (old) HJ[HJ.indexOf(old)] = item; else HJ.push(item); return { ok: true, item };
  },
  ws_hj_delete: a => { HJ.splice(HJ.findIndex(x => x.id === a.p_id), 1); return { ok: true }; },
  /* 3-6 환경설정 */
  ws_admin_staff: () => ({ ok: true, toastSec: 2.6, staff: STAFF }),
  ws_risk_get: () => ({ ok: true, rows: RISK }),
  ws_risk_save: a => { RISK.splice(0, RISK.length, ...a.p_rows.filter(r => r.risk)); return { ok: true, rows: RISK }; },
  ws_admin_set_toast: a => ({ ok: true, toastSec: a.p_sec }),
  ws_admin_staff_save: a => { STAFF.push({ staff_id: 'S004', name: a.p_d.name, part: a.p_d.part, role: a.p_d.role }); return { ok: true, staff: STAFF }; },
  ws_admin_staff_pin: a => ({ ok: true, staff_id: a.p_staff_id, name: '김철수' }),
  ws_admin_staff_remove: a => { STAFF.splice(STAFF.findIndex(x => x.staff_id === a.p_staff_id), 1); return { ok: true, staff: STAFF }; },
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
// 앱 안 PDF 보기 시험용 pdf.js 흉내: %PDF 로 시작하는 자료면 2쪽, 아니면 읽기 실패
const PDFJS_FAKE = "window.pdfjsLib={GlobalWorkerOptions:{},getDocument(src){window.PV_SRC=src;const ok=src.data&&src.data[0]===37&&src.data[1]===80;return{promise:ok?Promise.resolve({numPages:2,getPage:async i=>({getViewport:({scale})=>({width:842*scale,height:595*scale}),render:({canvasContext})=>{canvasContext.fillRect(0,0,20,20);window.PV_DRAWN=(window.PV_DRAWN||0)+1;return{promise:Promise.resolve()}}})}):Promise.reject(new Error('Invalid PDF structure'))}}};";
let AC_ASKED = '', WX_ASKED = '', AC_N = 0, AC_DELAY = 0, GAS_PDF = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/rpc/')) {
      const fn = u.pathname.slice(5), a = JSON.parse(body || '{}');
      CALLS.push({ fn, a });
      if (a.p_token !== TK && !/^ws_(check_|eh_view)/.test(fn)) return j({ err: 'LOGIN' });   // QR 점검·필증 보기는 표 없이
      if (fn === 'ws_log_ac') {   // 공조기·에어커튼 가동시간 (19_climate.sql, 결정 194) — 늦게 와도 일지가 먼저 보이는지
        AC_N++; AC_ASKED = fn + ' ' + a.p_day + ' ' + a.p_prev;
        const k = n => ({ name: n, total: 2, entered: 1, off: 0, groups: [['1층', [3.5, null]]], c: { d: 3.5, m: 10, y: 100 }, p: { d: 2, m: 9, y: 90 } });
        return setTimeout(() => j({ data: { ok: true, day: a.p_day, ac: { hvac: k('공조기'), curtain: k('에어커튼') } } }), AC_DELAY);
      }
      try { return j({ data: RPC[fn](a) }); } catch (e) { return j({ err: e.message }); }
    }
    if (u.pathname === '/upload') { UPLOADS.push(JSON.parse(body)); return j({}); }
    if (/^\/storage\/v1\/object\/public\/ws-files\/.+\.pdf$/.test(u.pathname)) {   // 버킷 공개 PDF (없는 것은 404)
      if (/missing/.test(u.pathname)) { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', 'application/pdf'); return res.end(Buffer.from('%PDF-1.4 bucket ' + 'x'.repeat(100)));
    }
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
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: r.request().url().indexOf('html2pdf') !== -1 ? H2P : /pdf\.js\/[\d.]+\/pdf\.min\.js$/.test(r.request().url()) ? PDFJS_FAKE : '' }));
  await c.route('https://script.google.com/**', r => {   // 구글 웹앱 ?api=logac (날씨 채우기) · ?api=pdf
    const u = new URL(r.request().url());
    if (u.searchParams.get('api') === 'pdf') {   // 드라이브로 옮긴 PDF 대신 받기
      GAS_PDF.push(u.searchParams.get('id'));
      const good = /^DRIVE/.test(u.searchParams.get('id'));
      return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(good ? { ok: true, name: 'a.pdf', b64: Buffer.from('%PDF-1.4 drive').toString('base64') } : { ok: false, error: '볼 수 없는 파일입니다' }) });
    }
    WX_ASKED = u.searchParams.get('api') + ' ' + u.searchParams.get('day');   // ?api=logac = 날씨 빠진 날 채우기만 (기다리지 않음)
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, day: u.searchParams.get('day') }) });
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
  ok(await toast('저장하고 PDF도 만들었습니다'), '7) TBM 저장 (PDF도 같이, 결정 176)');
  const up = UPLOADS.find(x => /^tbm_meet\//.test(x.p)), ts = last('ws_tbm_save_pdf').a;
  ok(up && /^tbm_meet\/\d{4}-\d{2}\/[a-z0-9]+\.jpg$/.test(up.p) && up.type === 'image/jpeg', '8) 회의 사진을 버킷 tbm_meet/ 아래 JPEG로 올림 ' + (up && up.p));
  ok(ts.p_files.meet && ts.p_files.meet.path === up.p && !('meet' in ts.p_d) && ts.p_d.works.length === 1, '9) DB 함수에는 사진 주소만 (사진 내용은 안 보냄)');
  ok(ts.p_files.pdf && await p.locator('.nwbar button.pri').count() === 0, '10) 저장 하나로 PDF까지 · 남색 저장 버튼은 [PDF 보기]로 바뀜');
  const pu = UPLOADS.find(x => /^tbm_pdf\//.test(x.p)), tp = last('ws_tbm_save_pdf').a;
  ok(pu && pu.type === 'application/pdf' && /\.pdf$/.test(pu.p) && tp.p_files.pdf.path === pu.p && tp.p_sign_ids.join() === 'SG1', '11) PDF를 버킷 tbm_pdf/ 에 올리고 서명 번호 넘김');
  ok(await p.locator('a.btn', { hasText: 'PDF 보기' }).first().getAttribute('href') === tp.p_files.pdf.url, '12) [PDF 보기] = 버킷 공개 주소');
  // ── 앱 안 PDF 보기 (계정 선택 창 없이) ──
  const pages0 = c.pages().length;
  await p.click('.nwbar a.btn:has-text("PDF 보기")');
  await p.locator('#pvPages canvas').nth(1).waitFor();
  await p.waitForFunction(() => window.PV_DRAWN >= 2);
  ok(c.pages().length === pages0 && await p.evaluate(() => S.view) === 'pdf' && /PDF 보기/.test(await p.locator('.top').innerText()), 'PV1) [PDF 열기] → 새 창 없이 앱 안 「PDF 보기」');
  ok(await p.evaluate(() => PV_SRC.data && String.fromCharCode(...PV_SRC.data.slice(0, 8)) === '%PDF-1.4') && new RegExp(D + "_TBM\.pdf").test(await p.locator('.pv-tool').innerText()) && /2쪽 · 서명 1명/.test(await p.locator('.pv-tool').innerText()),
    'PV2) 버킷 PDF를 받아 2쪽 그림, 이름·쪽 수·서명 수');
  const w1 = await p.evaluate(() => parseFloat($('pvC1').style.width));
  await p.click('.pv-zoom button[aria-label="크게"]'); await p.waitForFunction(() => window.PV_DRAWN >= 4);
  const w2 = await p.evaluate(() => parseFloat($('pvC1').style.width));
  ok(w1 > 600 && w1 <= 960 && Math.abs(w2 - w1 * 1.5) < 2 && (await p.locator('#pvZ').innerText()) === '150%', 'PV3) 크게 → 150% (' + Math.round(w1) + ' → ' + Math.round(w2) + 'px)');
  await p.click('.pv-zoom button[aria-label="작게"]');
  ok((await p.locator('#pvZ').innerText()) === '100%' && await p.locator('.pv-zoom button[aria-label="작게"]').isDisabled(), 'PV4) 작게 → 100%, 더 작게는 막힘');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.pv-bar button:has-text("내려받기")')]);
  ok(dl.suggestedFilename() === D + '_TBM.pdf', 'PV5) 내려받기: ' + dl.suggestedFilename());
  await p.evaluate(() => { navigator.share = async o => { window.SHARED = o; }; });
  await p.click('.pv-bar button:has-text("공유")');
  ok(await p.evaluate(() => window.SHARED && window.SHARED.url) === tp.p_files.pdf.url, 'PV6) 공유 = PDF 링크 (받는 사람은 로그인 없이 봄)');
  await p.click('.pv-bar button:has-text("뒤로")');
  ok(await p.evaluate(() => S.view) === 'tbm' && await p.locator('.nwbar a.btn:has-text("PDF 보기")').count() === 1, 'PV7) 뒤로 → TBM 화면 그대로');
  const openPv = async (url, name) => { await p.evaluate(([u, n]) => { const a = document.createElement('a'); a.href = u; a.dataset.pv = JSON.stringify({ name: n, sub: '시험 ›' }); pdfOpen(a); }, [url, name]); };
  await openPv('https://drive.google.com/file/d/DRIVE_abcdefghijklmnop123/view', 'old.pdf');
  await p.locator('#pvPages canvas').nth(1).waitFor();
  ok(GAS_PDF.pop() === 'DRIVE_abcdefghijklmnop123' && await p.evaluate(() => String.fromCharCode(...PV_SRC.data.slice(0, 14))) === '%PDF-1.4 drive', 'PV8) 드라이브로 옮긴 PDF는 구글 웹앱 ?api=pdf 가 대신 받아 보여 줌');
  await openPv('https://drive.google.com/file/d/PRIVATE_abcdefghijklmnop12/view', 'p.pdf');
  await p.locator('.pv-state[role=alert]').waitFor();
  ok(/볼 수 없는 파일입니다/.test(await p.locator('.pv-state').innerText()) && await p.locator('.pv-state a[target=_blank]').getAttribute('href') === 'https://drive.google.com/file/d/PRIVATE_abcdefghijklmnop12/view', 'PV9) 공유 안 된 드라이브 파일: 안내 + [새 창에서 열기]');
  await openPv('http://localhost:' + PORT + '/storage/v1/object/public/ws-files/tbm_pdf/2026-11/missing.pdf', 'm.pdf');
  await p.locator('.pv-state[role=alert]').waitFor();
  ok(/404/.test(await p.locator('.pv-state').innerText()) && await p.locator('.pv-state button:has-text("다시 시도")').count() === 1 && await p.locator('.pv-bar button:has-text("내려받기")').isDisabled(), 'PV10) 못 받으면 [다시 시도], 내려받기 막힘');
  await p.click('.pv-bar button:has-text("뒤로")');
  ok(await p.evaluate(() => S.view) === 'tbm', 'PV11) 실패 화면에서도 뒤로 → TBM');
  // 「PDF 저장됨 …」 안내 줄 링크 — PDF 뒤 서명이 늘면 아래 버튼이 [PDF로 저장]이 되어 이 링크만 남음 (11-14 휴대폰에서 계정 창)
  const pages1 = c.pages().length;
  await p.click('.banner a:has-text("PDF 보기")');
  await p.locator('#pvPages canvas').nth(1).waitFor();
  ok(c.pages().length === pages1 && await p.evaluate(() => S.view) === 'pdf' && new RegExp(D + "_TBM\.pdf").test(await p.locator('.pv-tool').innerText()), 'PV12) 안내 줄 [PDF 열기]도 새 창 없이 앱 안에서');
  await p.click('.pv-bar button:has-text("뒤로")');
  await p.evaluate(() => loadTbm(true));
  ok(/\/ws-files\/tbm_meet\//.test(await p.locator('.tbph img').first().getAttribute('src')), '13) 다시 불러오면 회의 사진은 버킷 주소로 보임');

  // ── 종합업무일지 (PC) ──
  AC_DELAY = 4000;
  const t0 = Date.now(); await p.evaluate(() => { openLog(); }); await p.locator('#lgSheet').waitFor();
  const t1 = Date.now() - t0, wait = await p.locator('.lgac .acerr').innerText();
  ok(t1 < 2500 && /불러오는 중/.test(wait), '14-1) 일지: 공조기를 기다리지 않고 먼저 보임 (' + t1 + 'ms · ' + wait + ')');
  await p.locator('.acb[data-ac="공조기"]').waitFor({ timeout: 8000 }); AC_DELAY = 0;
  ok(await p.locator('.lgac .acerr').count() === 0, '14-2) 도착하면 그 칸만 채움');
  ok(AC_ASKED === 'ws_log_ac ' + D + ' ' + (Number(D.slice(0, 4)) - 1) + D.slice(4) && WX_ASKED === 'logac ' + D && await p.locator('.acb[data-ac="공조기"]').count() === 1, '14) 일지: 공조기 가동시간은 Supabase ws_log_ac 에서 · 구글은 날씨 채우기만 (' + AC_ASKED + ' / ' + WX_ASKED + ')');
  const lsg = await p.locator('#lgSheet .lgsign td').evaluateAll(t => t.map(x => { const i = x.querySelector('img'); return i ? i.alt : ''; }).join(','));
  ok(lsg === ',,홍길동 서명,홍길동 서명', '14-3) 일지 서명란: 서버가 고른 서명 그림 (부소장·소장 칸) ' + lsg);
  await p.locator('#lgSheet .lghead').screenshot({ path: path.join(__dirname, 'shot_sb_log_sign.png') });
  await p.fill('input.lgin[data-k="전기"]', '1234');
  const n15 = count('ws_log_save_pdf'); await p.click('#lgSave');
  ok(await called('ws_log_save_pdf', n15) && await toast('저장하고 PDF도 만들었습니다'), '15) 일지 저장 = 저장 + PDF 한 번에 (결정 176)');
  const ls = last('ws_log_save_pdf').a;
  ok(ls.p_day === D && ls.p_ver === '' && ls.p_d['전기'] === '1234' && ls.p_d.works['전기방재'][0] === '1층 등 교체' && Object.keys(ls.p_files).join() === 'pdf', '16) DB 함수에 숫자·금일작업(TBM에서) 넘김');
  ok(AC_N === 1, '17) 저장 뒤 공조기는 10분 기억 (구글 다시 안 부름)');
  const lp = ls, lu = UPLOADS.find(x => /^log_pdf\//.test(x.p));
  ok(lu && lp.p_files.pdf.path === lu.p && await p.locator('#lgBar button.pri').count() === 0, '18-19) PDF는 버킷 log_pdf/ 에, 저장 자리는 [PDF 보기]로');
  ok(await p.locator('#lgBar a', { hasText: 'PDF 보기' }).getAttribute('href') === lp.p_files.pdf.url, '20) 일지 [PDF 보기] = 버킷 주소');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_log.png') });

  // ── 공조기 환기온도 (결정 128): PC = 종이 위에 바로 ──
  await p.evaluate(() => openAhu()); await p.locator('#ahuSheet').waitFor();
  const sh = await p.locator('#ahuSheet').innerText();
  ok(/에비뉴엘 AHU · 환기온도 점검일지/.test(sh) && /파트장/.test(sh) && /습도\s*45%/.test(sh) && /B3F-HVU1/.test(sh) && await p.locator('#ahuBar .back-in').count() === 1, 'A1) 공조기 PC: B4 종이 · 서명란 파트장 · 날씨·습도 자동 · 외조기 · 아래 줄 [뒤로]');
  ok(await p.locator('.hvsign img').count() === 1 && await p.locator('.hvsign td').nth(1).locator('img[alt="홍길동 서명"]').count() === 1, 'A1b) 서명란: 소장 칸에 그날 서명 그림, 파트장 칸은 빈 칸');
  await p.locator('.hvsh').screenshot({ path: path.join(__dirname, 'shot_sb_ahu_sign.png') });
  await p.fill('input.lgin[data-u="7F-39"][data-t="12"]', '22.3'); await p.fill('input.lgin[data-k="out_t12"]', '9.8');
  ok(/저장 안 함/.test(await p.locator('#ahuState').innerText()), 'A2) 고치면 「저장 안 함」');
  const na = count('ws_ahu_save_pdf'), nsv = count('ws_ahu_save'); await p.click('#ahuSave');
  ok(await called('ws_ahu_save', nsv) && await toast('저장하고 PDF도 만들었습니다') && JSON.stringify(last('ws_ahu_save').a.p_c) === '{"temps":{"7F-39":{"12":"22.3"}},"out_t12":"9.8"}' && last('ws_ahu_save').a.p_day === D, 'A3) 저장: 고친 칸만 넘김 ' + JSON.stringify(last('ws_ahu_save').a.p_c));
  ok(await called('ws_ahu_save_pdf', na), 'A4) 공조기 저장 = 저장 + PDF (결정 176)');
  const au = UPLOADS.find(x => /^ahu_pdf\//.test(x.p));
  ok(au && last('ws_ahu_save_pdf').a.p_file.path === au.p && await p.locator('#ahuBar a', { hasText: 'PDF 보기' }).getAttribute('href') === last('ws_ahu_save_pdf').a.p_file.url, 'A5) PDF는 버킷 ahu_pdf/ 에, [PDF 보기] = 그 주소');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_ahu_pc.png') });
  // 휴대폰 = 11:00·16:00 골라 한 대씩
  await p.setViewportSize({ width: 390, height: 800 });
  await p.evaluate(() => { S.ahu.slot = '16'; render(); });
  ok(await p.locator('.hvr').count() === 3 && /11:00 · 22\.3℃/.test(await p.locator('.hvr').first().innerText()) && /입력 1\/3/.test(await p.locator('#ahuCnt12').innerText()), 'A6) 휴대폰: 16:00 고르면 줄마다 12:00 값 회색, 입력 수');
  await p.fill('.hvr input[data-u="6F-36"]', '23.5'); await p.fill('input.inp[data-k="cw_t16"]', '7.4');
  ok(/입력 1\/3/.test(await p.locator('#ahuCnt16').innerText()), 'A7) 넣는 동안 입력 수 바뀜 (16:00 1/3)');
  const ns2 = count('ws_ahu_save'); await p.click('#ahuSave');
  ok(await called('ws_ahu_save', ns2) && JSON.stringify(last('ws_ahu_save').a.p_c) === '{"temps":{"6F-36":{"16":"23.5"}},"cw_t16":"7.4"}' && AHU[D].temps['7F-39']['12'] === 22.3, 'A8) 휴대폰 저장도 고친 칸만 (12:00 값 그대로)');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_ahu_m.png'), fullPage: true });
  await p.setViewportSize({ width: 1280, height: 900 });
  // 칸 검사 (김종우 PC 「저장 안 함」 11-20): 숫자 아닌 글자 → 서버에 안 보내고 그 칸 빨갛게 + 이유를 아래 줄에
  await p.evaluate(() => { window.print = () => {}; render(); });
  const n9 = count('ws_ahu_save');
  await p.fill('input.lgin[data-u="7F-39"][data-t="16"]', '정지'); await p.click('#ahuSave');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_ahu_bad.png') });
  const er = await p.locator('#ahuState').innerText();
  ok(count('ws_ahu_save') === n9 && /고칠 칸 1개/.test(er) && /7F-39 16:00/.test(er) && await p.locator('input.lgin.bad[data-u="7F-39"][data-t="16"]').count() === 1, 'A9) 글자 넣고 저장 → 서버에 안 보냄 · 칸 빨간 표시 · 이유가 아래 줄에 남음 ' + er);
  await p.fill('input.lgin[data-u="7F-39"][data-t="16"]', '23,5℃');
  ok(/저장 안 함/.test(await p.locator('#ahuState').innerText()) && await p.locator('input.lgin.bad').count() === 0, 'A10) 「23,5℃」는 숫자로 봐 줌 → 빨간 표시 사라짐');
  ok(await p.evaluate(() => ahuCheck('cw_t16', '45') === '' && ahuCheck('cw_t16', '50') === '' && /−?-5 ~ 50/.test(ahuCheck('cw_t16', '51'))), 'A10b) 냉수공급온도 50까지 넣을 수 있음 (결정 242)');
  const n11 = count('ws_ahu_save'); await p.click('#ahuSave');
  ok(await called('ws_ahu_save', n11) && await toast('저장하고 PDF도 만들었습니다') && last('ws_ahu_save').a.p_c.temps['7F-39']['16'] === '23.5', 'A11) 쉼표·℃는 「23.5」로 고쳐 보냄 ' + JSON.stringify(last('ws_ahu_save').a.p_c));
  await p.waitForFunction(() => !S.ahu.busy && !S.ahu.pdfBusy);   // 저장 뒤 PDF 만드는 동안은 값을 넣어도 먼저 저장하지 않음
  await p.fill('input.lgin[data-u="7F-39"][data-t="12"]', '22.9'); const nb = count('ws_ahu_save');
  await p.click('button:has-text("인쇄 (B4)")');
  ok(await called('ws_ahu_save', nb) && last('ws_ahu_save').a.p_c.temps['7F-39']['12'] === '22.9', 'A12) 저장 안 한 값이 있으면 인쇄 전에 먼저 저장');
  await p.locator('#ahuState', { hasText: '저장됨' }).waitFor();
  const sv = await p.evaluate(() => { const g = S.ahu; return ahuLate({ temps: { '7F-39': { 16: '30' } }, out_t12: '8' }, { temps: { '7F-39': { 16: '29' } }, out_t12: '8' }) || [g.v.temps['7F-39'][16], JSON.stringify(g.ch)]; });
  ok(sv[0] === '30' && sv[1] === '{"temps":{"7F-39":{"16":"30"}}}', 'A13) 저장하는 사이 더 넣은 값은 다시 「저장 안 함」으로 남김 ' + sv);

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

  // ── 소화기 (3-4) ──
  await p.evaluate(() => openQr()); await p.waitForFunction(() => S.qr);
  ok(await p.evaluate(() => qrUrl('abcdefghjkmn')) === 'http://localhost:' + PORT + '/ws/?fe=abcdefghjkmn', '26) QR 주소 = 바로가기 주소(설정 없으면 앱 폴더) + ?fe=');
  await p.evaluate(() => addDialog()); await p.fill('#aStore', '카페'); await p.fill('#aCount', '2'); await p.click('#aBtn');
  ok(await toast('카페-소화기1 등록') && last('ws_fe_add').a.p_d.store === '카페' && last('ws_fe_add').a.p_d.count === '2', '27) 소화기 등록 → DB 함수에 층·매장·개수');
  const lb = await p.evaluate(() => run('labelSave', S.token, '60', 40));
  ok(lb.ok && last('ws_label_save').a.p_w === 60 && last('ws_label_save').a.p_h === 40, '28) 라벨 크기 저장 (숫자로)');
  await p.evaluate(() => openStatus('')); await p.waitForFunction(() => S.st);
  await p.evaluate(() => detail('WS-FC-1')); await p.locator('.ph43 img').waitFor();
  ok(/\/ws-files\/fire\//.test(await p.locator('.ph43 img').getAttribute('src')) && last('ws_fe_detail').a.p_check_id === 'WS-FC-1', '29) 점검 내용 보기: 사진은 버킷 주소');

  // ── QR 점검 입력 check-sb.html (매장 직원, 기기 등록 없이) ──
  const q = await c.newPage(); q.on('pageerror', e => errs.push('check-sb: ' + e.message)); q.on('dialog', d => d.accept());
  await q.goto('http://localhost:' + PORT + '/ws/check-sb.html?fe=abcdefghjkmn');
  await q.waitForFunction(() => /카페-소화기1/.test(document.body.innerText));
  ok(last('ws_check_init').a.p_qr === 'abcdefghjkmn', '30) QR 점검 화면: Supabase에서 소화기 이름을 받아 보여 줌');
  const n0 = UPLOADS.length;
  const png = 'data:image/png;base64,' + Buffer.from('x'.repeat(300)).toString('base64'), jpg = 'data:image/jpeg;base64,' + Buffer.from('y'.repeat(900)).toString('base64');
  const r1 = await q.evaluate(([png, jpg]) => FM_CHECK.submit('abcdefghjkmn', { photo: jpg, signA: png, signB: png, state: '이상없음', overwrite: false }), [png, jpg]);
  const ups = UPLOADS.slice(n0), cs = last('ws_check_submit').a;
  ok(r1.ok && ups.length === 3 && ups.every(u => /^fire\/abcdefghjkmn\/\d{4}-\d{2}\/[a-z0-9]+\.(jpg|png)$/.test(u.p)) && cs.p_files.photo.path === ups.find(u => /\.jpg$/.test(u.p)).p && cs.p_d.state === '이상없음' && !('photo' in cs.p_d), '31) 사진·손글씨 3개를 fire/{QR}/ 아래에 올리고 주소만 넘김');
  const uj = ups.find(u => u.type === 'image/jpeg');
  ok(uj && uj.size === 900, '32) 사진은 화면이 줄인 그대로 (다시 줄이지 않음)');
  const n1 = UPLOADS.length;
  const r2 = await q.evaluate(([png, jpg]) => FM_CHECK.submit('abcdefghjkmn', { photo: jpg, signA: png, signB: png, state: '이상없음', overwrite: false }), [png, jpg]);
  ok(r2.ok === false && r2.exists === true && UPLOADS.length === n1, '33) 이번 달 이미 있으면 올리기 전에 물음 (버킷에 안 남김)');
  await q.screenshot({ path: path.join(__dirname, 'shot_sb_check.png') });

  // ── 전열필증 (3-5) ──
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => openEh()); await p.waitForFunction(() => S.eh);
  ok(last('ws_eh_list').a.p_floor === '1F' && await p.evaluate(() => ehUrl('abcdefghjkmp')) === 'http://localhost:' + PORT + '/ws/?eh=abcdefghjkmp', '34) 전열필증: Supabase 목록, 필증 QR = 앱 폴더 + ?eh=');
  const es = await p.evaluate(() => run('ehSave', S.token, { esId: 'WS-ES-1', name: '포트', w: '800', m1: '갑', date: '2026-01-03' }));
  ok(es.saved === '1F-1-2' && last('ws_eh_save').a.p_d.name === '포트', '35) 기기 추가 → DB 함수에 그대로');
  const SH = { '1F': [['층 : 1'], ['카페'], ['No', '관리번호', '기기명', '용량(W)', '제조사', '관리책임자', '', '승인일자'],
      ['1', '1F-4-1', '오븐', '3,000', 'S', '갑', '을', '24.08,29'], ['2', '', '히터', '', '(폐기)', '갑', '', '']],
    'B1F': [['층 : B1'], ['매장명 : 빵집'], ['No', '관리번호', '기기명'], ['1', 'B1F-2-1', '토스터']] };
  const n36 = count('ws_eh_import');
  const ec = await p.evaluate(sh => run('ehImport', S.token, sh, false), SH);
  ok(ec.ok && ec.check.stores === 2 && ec.check.items === 3 && ec.check.renumbered === 1 && ec.check.bfix === 1 && ec.check.gone === 1 && count('ws_eh_import') === n36, '36) 엑셀 미리 셈은 화면에서 (매장 2·기기 3·새 번호 1·B1F→B1 1·폐기 1)');
  const ei = await p.evaluate(sh => run('ehImport', S.token, sh, true), SH), ea = last('ws_eh_import').a.p_data;
  const it3 = ea.items.find(x => x.name === '히터'), ov = ea.items.find(x => x.name === '오븐');
  ok(ei.ok && ei.check.items === 3 && ea.stores.length === 2 && ea.stores[0].no === 4 && ea.stores[1].no === 2 && it3.no === '1F-4-2' && it3.gone === true && ov.date === '2024-08-29' && ov.w === '3000' && ov.m2 === '을' && ea.items.find(x => x.name === '토스터').no === 'B1-2-1',
    '37) 엑셀 가져오기: 나눠 읽은 매장·기기만 넘김 (관리번호·날짜·폐기)');
  ok(ea.replace === false, '37) 처음 가져오기는 바꿔 넣기 아님');
  const SH2 = { '2F': [['전열기  관리대장 (2026)'], ['', '', '층 :', '2'], ['', '', '매장명 :', '사파이어 라운지'], ['No', '관리번호', '기기명', '사용처', '용량(W)'], ['1', '2F-2-1', '공기청정기', '사파이어 라운지', '70']] };
  await p.evaluate(sh => run('ehImport', S.token, sh, true), SH2);
  const ea2 = last('ws_eh_import').a.p_data;
  ok(ea2.stores[0].name === '사파이어 라운지' && ea2.stores[0].no === 2 && ea2.items[0].no === '2F-2-1', '37) 새 양식 엑셀 (「매장명 :」 옆 칸)');
  await p.evaluate(() => ehImportDlg(true)); await p.waitForSelector('.dialog .banner.b-red');   // 이 시험 화면은 휴대폰 폭이라 단추 대신 바로 엶
  await p.evaluate(sh => { S.ehX = sh; }, SH);
  await p.evaluate(() => { $('ehXo').innerHTML = '<button id="ehXb"></button>'; return ehXSave(); });
  ok(last('ws_eh_import').a.p_data.replace === true, '37) 엑셀 다시 가져오기: 「모두 지움」 안내 → 바꿔 넣기로 넘김');
  const e = await c.newPage(); e.on('pageerror', x => errs.push('eh-sb: ' + x.message));
  await e.goto('http://localhost:' + PORT + '/ws/eh-sb.html?eh=abcdefghjkmp');
  await e.locator('.eht').waitFor();
  const et = await e.locator('.eht').innerText();
  ok(/1F-1-1/.test(et) && /1F · 카페/.test(et) && /3,000 W/.test(et) && /갑 \/ 을/.test(et) && /2026\.01\.02/.test(et), '38) 필증 QR 보기(eh-sb.html): 로그인 없이 필증 내용');
  await e.goto('http://localhost:' + PORT + '/ws/eh-sb.html?eh=zzzzzzzzzzzz');
  await e.locator('.banner').waitFor();
  ok(/삭제된 필증/.test(await e.locator('.banner').innerText()), '39) 삭제된 필증 → 안내');

  // ── 공사장 점검 (3-5) ──
  await p.setViewportSize({ width: 390, height: 800 });
  await p.evaluate(() => openCs()); await p.waitForFunction(() => S.cs && S.cs.ok);
  ok(await p.locator('text=5F 리모와').count() > 0, '40) 공사장 점검: Supabase에서 현장 목록');
  await p.evaluate(d => csOpen(d, 'WS-CS-1', 1), D); await p.waitForFunction(() => S.ck && S.ck.items);
  const jpgB64 = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'gauge.jpg')).toString('base64');
  const n41 = UPLOADS.length;
  await p.evaluate(src => { S.ck.items[0].st = '양호'; S.ck.items[0].photos.push({ id: '', src, at: '14:05' }); csDirty(true); return csFlush(); }, jpgB64);
  const cu = UPLOADS.slice(n41), csv = last('ws_cs_save').a;
  ok(cu.length === 1 && /^cs_photo\/\d{4}-\d{2}\/[a-z0-9]+\.jpg$/.test(cu[0].p) && csv.p_list[0].photos[0].file.path === cu[0].p && !('data' in csv.p_list[0].photos[0]) && csv.p_round === 1 && csv.p_site === 'WS-CS-1',
    '41) 새 사진은 버킷 cs_photo/ 에 올리고 주소만 넘김 ' + (cu[0] && cu[0].p));
  ok(await p.evaluate(() => S.ck.items[0].photos[0].id) === 'P1', '42) 저장 뒤 사진에 DB 번호가 붙음 (다시 안 올림)');
  const n43 = UPLOADS.length;
  await p.evaluate(() => { S.ck.items[0].memo = '통로 확보됨'; csDirty(true); return csFlush(); });
  ok(UPLOADS.length === n43 && last('ws_cs_save').a.p_list[0].photos[0].id === 'P1' && !last('ws_cs_save').a.p_list[0].photos[0].file, '43) 다시 저장: 예전 사진은 번호만 (다시 안 올림)');
  const n44 = count('ws_cs_save_pdf');
  await p.evaluate(() => csPdf());
  ok(await called('ws_cs_save_pdf', n44), '44) 공사장 PDF 저장');
  const cpu = UPLOADS.find(x => /^cs_pdf\//.test(x.p));
  ok(cpu && cpu.type === 'application/pdf' && last('ws_cs_save_pdf').a.p_file.path === cpu.p && last('ws_cs_save_pdf').a.p_ck_id === 'WS-CK-1', '45) PDF를 버킷 cs_pdf/ 에 올리고 점검 번호와 함께');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_cs.png') });

  // ── 위험작업신청서 (결정 236) ──
  await p.evaluate(() => openRw()); await p.waitForFunction(() => S.rw && S.rw.list);
  ok(await p.locator('.rwfl').count() === 11 && await p.locator('.rwadd input[type=file]').count() === 2, 'R1) 위험작업신청서: 사진찍기·갤러리 · 위치 버튼 11개 (B3~10F·외곽)');
  await p.fill('#rwCo', 'OO인테리어'); await p.click('.rwfl >> text="3F"');
  const nr = count('ws_rw_add'), nu = UPLOADS.length;
  await p.locator('.rwadd input[type=file]').nth(1).setInputFiles(path.join(__dirname, 'gauge.jpg'));
  ok(await called('ws_rw_add', nr), 'R2) 사진을 고르면 바로 저장');
  const ra = last('ws_rw_add').a, ru = UPLOADS.slice(nu);
  ok(ru.length === 1 && /^risk_photo\/\d{4}-\d{2}\/[a-z0-9]+\.jpg$/.test(ru[0].p) && ra.p_file.path === ru[0].p && ra.p_co === 'OO인테리어' && ra.p_floor === '3F' && /^[0-9a-f]{24}$/.test(ra.p_cid) && /^\d{4}-\d{2}-\d{2}$/.test(ra.p_day) && !('data' in ra),
    'R3) 사진은 버킷 risk_photo/ 에, 업체명·위치·날짜 태그·고유 번호와 함께 ' + (ru[0] && ru[0].p));
  await p.waitForFunction(() => document.querySelectorAll('.rwt').length === 1);
  ok(/OO인테리어/.test(await p.locator('.rwcap').first().innerText()) && /3F/.test(await p.locator('.rwcap').first().innerText()), 'R4) 일자별 목록에 사진 아래 업체명·위치·시간');
  await p.locator('.rwadd input[type=file]').nth(1).setInputFiles(path.join(__dirname, 'gauge.jpg'));
  await new Promise(r => setTimeout(r, 800));
  ok(count('ws_rw_add') === nr + 1 && await p.locator('.rwt').count() === 1, 'R5) 같은 사진을 또 고르면 건너뜀 (두 번 저장 안 됨)');
  await p.evaluate(() => { window.__run = window.run; window.run = () => Promise.reject(new Error('Failed to fetch')); });
  await p.locator('.rwadd input[type=file]').nth(1).setInputFiles({ name: 'b.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(__dirname, 'gauge.jpg')) });
  await p.waitForFunction(() => S.rw.pend.length === 1);
  ok(/올리기 대기 중 1장/.test(await p.locator('#rwPend').innerText()) && await p.locator('.rwt').count() === 1, 'R6) 통신 불량: 「올리기 대기 중 1장」 · 아직 목록에 안 들어감');
  await p.evaluate(() => { window.run = window.__run; return rwFlush(); });
  await p.waitForFunction(() => S.rw.pend.length === 0 && document.querySelectorAll('.rwt').length === 2);
  ok(await p.locator('#rwPend').innerText() === '' && count('ws_rw_add') === nr + 2, 'R7) 연결되면 자동으로 올라가고 대기 표시가 사라짐');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_rw.png'), fullPage: true });
  await p.locator('.rwim').first().click(); await p.locator('.rwv').waitFor();
  await p.click('.rwvf >> text="＋"');
  ok(/150%/.test(await p.locator('.rwvf b').innerText()) && await p.locator('.rwvf button >> text="이전"').isDisabled(), 'R8) 사진 크게 보기: 확대 · 첫 장이면 이전 막힘');
  await p.click('.rwvf >> text="다음"'); ok(/100%/.test(await p.locator('.rwvf b').innerText()), 'R9) 다음 사진으로 넘기면 100%로');
  await p.click('.rwvh >> text="닫기"'); ok(await p.locator('.rwv').count() === 0, 'R10) 닫기');
  await p.locator('.rwx').first().click();
  await p.waitForFunction(() => document.querySelectorAll('.rwt').length === 1);
  ok(count('ws_rw_delete') === 1, 'R11) 소장·관리자는 ✕로 지움 (되묻기 뒤)');


  // ── 주간/야간 작업내역 (결정 240) ──
  await p.evaluate(() => openWh()); await p.waitForFunction(() => S.wh && S.wh.d.list);
  const wjpg = fs.readFileSync(path.join(__dirname, 'gauge.jpg'));
  const xjf = (n, x) => ({ name: n + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([wjpg, Buffer.from(x || n)]) });
  ok(await p.locator('.whf .rwfl').count() === 11 && await p.locator('.whck input').count() === 2 && await p.locator('.whpc input[type=file]').count() === 8 && await p.locator('#whBar button').count() >= 3, 'W1) 주간작업: 위치 버튼 11개 · 파트 체크 2 · 사진 칸 4개(전 2·후 2, 카메라·파일) · 아래 줄(뒤로·인쇄·PDF·저장)');
  await p.locator('.whck input').first().check(); await p.click('.whf .rwfl >> text="2F"');
  await p.locator('.whf textarea').first().fill('복도 조명 안정기 교체');
  await p.locator('.whpc').nth(0).locator('input[type=file]').nth(1).setInputFiles([xjf('a1')]); await p.locator('.whpc').nth(1).locator('input[type=file]').nth(1).setInputFiles([xjf('a2')]);
  await p.waitForFunction(() => S.wh.d.f.before.length === 2);
  await p.locator('.whmat input').nth(0).fill('안정기 32W'); await p.locator('.whmat input').nth(1).fill('2'); await p.locator('.whmat input').nth(2).fill('개');
  const xwu = UPLOADS.length, xnsave = count('ws_dw_save');
  await p.click('#whBar .btn.pri'); await p.waitForFunction(() => !S.wh.d.busy && S.wh.d.list.length === 1);
  const xwa = last('ws_dw_save').a.p_d, xwup = UPLOADS.slice(xwu);
  ok(count('ws_dw_save') === xnsave + 1 && xwup.length === 2 && xwup.every(u => /^dw_photo\/\d{4}-\d{2}\/[a-z0-9]+\.jpg$/.test(u.p)) && xwa.before.length === 2 && xwa.before[0].file.path === xwup[0].p && !('data' in xwa.before[0]) && xwa.after.length === 0 &&
    xwa.parts[0] === '전기방재' && xwa.floor === '2F' && xwa.mats[0].n === '안정기 32W' && xwa.mats[0].u === '개', 'W2) 저장: 사진 2장 버킷 dw_photo/ 에 올림 · 파트·위치·자재 줄을 함께 넘김');
  ok(await p.locator('.whrow').count() === 1 && await p.evaluate(() => !S.wh.d.f.id && !S.wh.d.f.before.length && !S.wh.d.f.content), 'W3) 저장 뒤 빈 양식 · 목록에 한 줄');
  await p.locator('.whrow').click(); await p.waitForFunction(() => S.wh.d.f.id && S.wh.d.f.before.length === 2);
  await p.locator('.whpc').nth(0).locator('input[type=file]').nth(1).setInputFiles([xjf('c1')]);
  await new Promise(r => setTimeout(r, 800));
  ok(await p.evaluate(() => S.wh.d.f.before.length) === 2 && await p.evaluate(() => !!S.wh.d.f.before[0].data), 'W4) 작업 전 사진은 2칸 (이미 찬 칸에 다시 고르면 바꿈)');
  const xnu2 = UPLOADS.length; await p.click('#whBar .btn.pri'); await p.waitForFunction(() => !S.wh.d.busy && !S.wh.d.dirty);
  ok(UPLOADS.length === xnu2 + 1 && !!last('ws_dw_save').a.p_d.before[0].file && !!last('ws_dw_save').a.p_d.before[1].id && last('ws_dw_save').a.p_d.id === 'WS-WD-1' && WD.length === 1, 'W5) 고쳐 저장: 있던 사진은 번호만, 바꾼 사진 1장만 올림 · 같은 번호로 덮어씀');
  await p.locator('.whrow').click(); await p.waitForFunction(() => S.wh.d.f.id && S.wh.d.f.before.length === 2);
  await p.locator('.whx').first().click(); ok(await p.evaluate(() => S.wh.d.f.before.length) === 1 && /저장 안 함/.test(await p.locator('#whState').innerText()), 'W6) 사진 ✕ (되묻기 뒤) → 「저장 안 함」');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_wh_day.png'), fullPage: true });
  await p.evaluate(() => whPrint()); await new Promise(r => setTimeout(r, 400));
  ok(await p.evaluate(() => $('print').querySelectorAll('.pg').length) === 1 && /안정기 32W/.test(await p.evaluate(() => $('print').innerText)) && await p.evaluate(() => $('print').querySelectorAll('.cell').length) === 1, 'W7) 주간 인쇄: 1쪽 · 사진은 있는 것만 · 사용자재 표');
  await p.click('.seg >> text="야간작업"'); await p.waitForFunction(() => S.wh.n.list);
  ok(await p.locator('.whf').count() === 1 && await p.locator('button >> text="신규작성"').count() === 1 && await p.evaluate(() => !S.wh.n.f.id), 'W8) 야간작업 탭: 열면 바로 빈 신규작성 양식');
  await p.click('button >> text="신규작성"');
  await p.locator('.whf input.inp[maxlength="30"]').fill('OO인테리어'); await p.click('.whf .rwfl >> text="3F"'); await p.locator('.whf textarea').first().fill('매장 천장 방염 도장');
  await p.locator('.whpc').nth(0).locator('input[type=file]').nth(1).setInputFiles([1, 2, 3, 4, 5].map(i => xjf('n' + i)));
  const xfc = p.locator('.whsec').nth(1).locator('.whpc').nth(0);   // 방염집기 1: 입력 4개 = 집기 카메라·파일 / 서류 카메라·파일
  await xfc.locator('input[type=file]').nth(1).setInputFiles([xjf('f1')]);
  await p.waitForFunction(() => S.wh.n.f.photos.length === 5 && S.wh.n.f.fire.length === 1);
  const xn0 = count('ws_dn_save'); await p.evaluate(() => whSave());
  ok(count('ws_dn_save') === xn0 && await toast('방염집기 1에 방염서류 사진도 넣어 주세요'), 'W8a) 방염집기 한쪽 사진만 있으면 저장 막고 안내');
  await xfc.locator('input[type=file]').nth(3).setInputFiles([xjf('f2')]);
  await p.waitForFunction(() => S.wh.n.f.fire.length === 2 && S.wh.n.f.fire[1]);
  const xs0 = p.locator('.whsec').nth(0), xcnt = () => xs0.locator('.whpc').count();
  ok(await xcnt() === 5 && await p.locator('.whsec').nth(1).locator('.whpc').count() === 2, 'W8b) 야간: 현장 사진 5장 → 칸 5개 · 방염집기는 빈 칸 2개 (처음 2칸) · 한 곳에 사진 입력 2개');
  await xs0.locator('.whplus').click(); const x6 = await xcnt();
  for (let i = 0; i < 14; i++) await xs0.locator('.whplus').click();
  ok(x6 === 6 && await xcnt() === 20 && await xs0.locator('.whplus').isDisabled(), 'W8c) ＋ 버튼: 칸이 하나씩 늘고 20칸에서 멈춤(버튼 회색)');
  const xvp = p.viewportSize(); await p.setViewportSize({ width: 1100, height: 900 });
  const xpc = await p.evaluate(() => { const g = document.querySelector('.whfg'), q = g.querySelector('.whpc'), t = q.querySelectorAll('.whfp'); return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, side: Math.abs(t[0].getBoundingClientRect().top - t[1].getBoundingClientRect().top) < 3 && t[1].getBoundingClientRect().left > t[0].getBoundingClientRect().left }; });
  await p.setViewportSize(xvp);
  ok(xpc.cols === 3 && xpc.side, 'W8d) PC: 방염집기 묶음 3열 · 집기사진|방염서류 가로 나란히');
  ok(await p.evaluate(() => whPages('n').split('class="pg"').length - 1) === 3, 'W9) 야간 쪽 수: 내용+현장 사진 · 각서 · 방염서류 1장 = 3쪽 (각서 없으면 「미첨부」 쪽)');
  await p.evaluate(() => whPrint()); await new Promise(r => setTimeout(r, 400));
  ok(/각서 미첨부/.test(await p.evaluate(() => $('print').innerText)) && await p.evaluate(() => $('print').querySelectorAll('.fa img,.fb img').length) === 2, 'W10) 인쇄: 각서 미첨부 표시 · 방염집기 한 곳이 한 쪽(집기사진 + 방염서류)');
  const xnn = UPLOADS.length; await p.click('#whBar .btn.pri'); await p.waitForFunction(() => !S.wh.n.busy && S.wh.n.list.length === 1);
  const xna = last('ws_dn_save').a.p_d, xnup = UPLOADS.slice(xnn);
  ok(xnup.length === 7 && xnup.every(u => /^dw_photo\//.test(u.p)) && xna.co === 'OO인테리어' && xna.floor === '3F' && xna.photos.length === 5 && xna.fire.length === 2 && xna.pledge.length === 0, 'W11) 야간 저장: 현장 5 · 방염집기 사진 2(집기+서류) · 각서 0 → 버킷 dw_photo/ 에 7장');
  ok(/각서 없음/.test(await p.locator('.whrow').first().innerText()) && !/방염집기 없음/.test(await p.locator('.whrow').first().innerText()), 'W12) 목록에 「각서 없음」 표시');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_wh_night.png'), fullPage: true });
  await p.locator('.whrow').click(); await p.waitForFunction(() => S.wh.n.f.id);
  await p.locator('.whsec').nth(2).locator('.whpc').nth(0).locator('input[type=file]').nth(1).setInputFiles([xjf('p1')]);
  await p.waitForFunction(() => S.wh.n.f.pledge.length === 1);
  await p.locator('.whim').first().click(); await p.locator('.rwv').waitFor(); await p.click('.rwvh >> text="닫기"');
  await p.click('.whdel'); await p.waitForFunction(() => S.wh.n.f && !S.wh.n.f.id && !S.wh.n.f.photos.length);
  ok(WN.length === 0 && count('ws_dn_delete') === 1, 'W13) 이 작업 삭제 (되묻기 뒤) · 사진 크게 보기 열고 닫기');
  await p.click('.seg >> text="주간작업"'); await p.locator('.whrow').click(); await p.waitForFunction(() => S.wh.d.f.id);
  await p.click('.whdel'); await p.waitForFunction(() => !S.wh.d.f.id);
  ok(WD.length === 0 && await p.locator('.whrow').count() === 0, 'W14) 주간작업 삭제 → 목록에서 사라짐 · 새 양식으로');
  ok(await p.evaluate(() => JSON.stringify(whWeek('2026-11-24'))) === '["2026-11-22","2026-11-28"]', 'W15) 주(일~토) 계산');
  WD.push({ id: 'X2', day: '2026-11-24', parts: ['기계건축'], workers: 'a', floor: '2F', content: '새 작업', mats: [], note: '', before: [], after: [] },
    { id: 'X1', day: '2026-11-03', parts: ['전기방재'], workers: 'a', floor: 'B1', content: '옛 작업', mats: [], note: '', before: [], after: [] },
    { id: 'X3', day: '2026-10-05', parts: ['전기방재'], workers: 'a', floor: '1F', content: '지난달', mats: [], note: '', before: [], after: [] });
  await p.evaluate(() => whLoad('d')); await p.waitForFunction(() => S.wh.d.list.length === 3);
  ok(await p.locator('.csacc.whmo').count() === 2 && await p.locator('.csacc.whwk').count() === 2 && await p.locator('.whrow').count() === 1, 'W16) 목록 아코디언: 월 2 · (펼친 달의) 주 2 · 가장 최근 주만 펼침 → 1줄');
  await p.locator('.csacc.whwk').nth(1).click(); ok(await p.locator('.whrow').count() === 2, 'W17) 주 머리줄 누르면 펼침');
  await p.click('button >> text="주간보고작성"'); await p.locator('.whrep').waitFor();
  await p.evaluate(() => { window.loadExcelJs = async () => {}; window.whExcel = async (l, f, t, ps) => { window.XR = { n: l.map(x => x.id), f, t, ps }; }; });
  await p.locator('.whrep input[type=date]').fill('2026-11-25'); await p.locator('.whrep .whck input').nth(1).check();
  await p.click('.whrep >> text="엑셀 저장"'); await p.waitForFunction(() => window.XR);
  const xrr = await p.evaluate(() => window.XR);
  ok(xrr.f === "2026-11-22" && xrr.t === "2026-11-28" && xrr.n.join() === "X2" && xrr.ps.length === 2, 'W18) 주간보고: 기준일 주(일~토)·고른 파트의 작업만 엑셀 만들기에 넘김');
  WD.length = 0;
  // ── 하자점검 (결정 266) ──
  await p.evaluate(() => go('inspect'));
  ok(/하자점검/.test(await p.locator('.wrap.list .row').last().innerText()), 'H0) 점검 그룹 맨 아래에 「하자점검」');
  await p.evaluate(() => openDf()); await p.waitForFunction(() => S.df && S.df.list);
  ok(await p.locator('.dfc').count() === 1 && await p.locator('.dfplus').count() === 1 && await p.locator('.dfc .dfcam input[type=file]').count() === 1 && await p.locator('.dfc .whbs input[type=file]').count() === 1 && !/사진 없음/.test(await p.locator('.dfc').innerText()), 'H1) 하자 칸 1개 + 「+」 · 현장명·하자내용 · 카메라(사진 자리 한가운데)·파일 · 「사진 없음」 글자 없음');
  const hbar = await p.locator('#dfBar .btn').allInnerTexts();
  ok(hbar.length === 4 && /뒤로/.test(hbar[0]) && /인쇄 A4/.test(hbar[1]) && /PDF 생성/.test(hbar[2]) && /저장/.test(hbar[3]), 'H2) 아래 버튼: 뒤로 · 인쇄 A4 · PDF 생성 · 저장 ' + hbar.join('|'));
  await p.locator('.dfc').first().locator('input.inp').fill('B1 기계실'); await p.locator('.dfc').first().locator('textarea').fill('천장 누수 자국');
  await p.locator('.dfc').first().locator('input[type=file]').nth(1).setInputFiles([xjf('h1')]);
  await p.waitForFunction(() => S.df.f.items[0].photo);
  ok(await p.locator('.dfc').first().locator('.dfph img').count() === 1 && await p.locator('.dfc').first().locator('.dfcam').count() === 0, 'H3) 사진을 넣으면 사진 칸에 사진이 붙음');
  await p.click('.dfplus'); await p.click('.dfplus');
  const hnm = await p.evaluate(() => S.df.f.items.map(x => x.n).join('|'));
  ok(hnm === 'B1 기계실|B1 기계실 2|B1 기계실 3', 'H4) 「+」 → 새 칸 현장명 = 첫 칸 현장명 + 순서 숫자 ' + hnm);
  await p.locator('.dfc').nth(1).locator('textarea').fill('배관 보온재 탈락');
  const hvp = p.viewportSize(); await p.setViewportSize({ width: 390, height: 800 });
  const hc1 = await p.evaluate(() => getComputedStyle(document.querySelector('.dfg')).gridTemplateColumns.split(' ').length);
  await p.setViewportSize({ width: 1100, height: 900 });
  const hc2 = await p.evaluate(() => getComputedStyle(document.querySelector('.dfg')).gridTemplateColumns.split(' ').length);
  await p.setViewportSize(hvp);
  ok(hc1 === 2 && hc2 === 4, 'H5) 휴대폰 2열 · PC 4열 (' + hc1 + ' · ' + hc2 + ')');
  for (const key of ['signSite', 'signFm']) {
    await p.locator('.dfsb').nth(key === 'signSite' ? 0 : 1).click(); await p.locator('#dfsp').waitFor();
    const bx = await p.locator('#dfsp canvas.i').boundingBox();
    await p.mouse.move(bx.x + 20, bx.y + 40); await p.mouse.down(); for (let i = 0; i < 14; i++) await p.mouse.move(bx.x + 20 + i * 18, bx.y + (i % 2 ? 140 : 40)); await p.mouse.up();
    await p.click('.dialog .btn.pri'); await p.waitForFunction(k => S.df.f[k] && S.df.f[k].data, key);
  }
  ok(await p.locator('.dfsb img').count() === 2 && await p.evaluate(() => /^data:image\/png/.test(S.df.f.signSite.data) && /^data:image\/png/.test(S.df.f.signFm.data)), 'H6) 서명 2개: 눌러서 손글씨 창 → 확인하면 서명 칸에 그림');
  await p.locator('.dfsb').first().click(); await p.locator('#dfsp').waitFor(); await p.click('.dialog .btn.pri');
  ok(await p.locator('#dfsm').innerText().then(x => /너무 짧/.test(x)), 'H7) 서명 안 쓰고 확인 → 막고 안내'); await p.click('.dialog .btn >> text="취소"');
  await p.evaluate(() => dfPrint()); await new Promise(r => setTimeout(r, 400));
  const hpr = await p.evaluate(() => { const t = $('print'), due = dfDue(S.df.f.day); return { pg: t.querySelectorAll('.pg').length, cells: t.querySelectorAll('.cell').length, cols: /repeat\(4,/.test(t.querySelector('.gr').getAttribute('style')) ? 4 : 0, tx: t.innerText, due, sg: t.querySelectorAll('.sgb img').length, trs: t.querySelectorAll('tr').length }; });
  ok(hpr.pg === 1 && hpr.cells === 3 && hpr.cols === 4 && hpr.trs === 4 && /위 하자 내용을 확인했으며 기한 내 처리하겠습니다\./.test(hpr.tx) && hpr.tx.indexOf(hpr.due.slice(0, 4) + '년 ' + Number(hpr.due.slice(5, 7)) + '월 ' + Number(hpr.due.slice(8)) + '일') !== -1 && hpr.sg === 2 && /현장책임자/.test(hpr.tx) && /시설팀/.test(hpr.tx), 'H8) 인쇄: 1쪽 · 사진 4열 · 하자내용 표 · 확인 문구 · 처리 기한(작성일 +10일) · 서명 2칸 ' + JSON.stringify(hpr).slice(0, 160));
  ok(await p.evaluate(() => dfDue('2026-11-25') === '2026-12-05' && dfDue('2026-12-25') === '2027-01-04'), 'H9) 처리 기한 = 작성일 + 10일 (달·해 넘김)');
  await p.evaluate(() => { window.html2pdf = function () { const o = { set() { return o; }, from() { return o; }, outputPdf() { return Promise.resolve(new Blob(['%PDF-1.4 ' + 'x'.repeat(300)], { type: 'application/pdf' })); } }; return o; }; });
  const hs0 = count('ws_hj_save'), hu0 = UPLOADS.length;
  await p.click('#dfPdfB'); await p.waitForFunction(() => S.view === 'pdf');
  const hsa = last('ws_hj_save').a.p_d, hup = UPLOADS.slice(hu0);
  ok(count('ws_hj_save') === hs0 + 1 && hup.length === 3 && hup.filter(u => /\.png$/.test(u.p)).length === 2 && hsa.items.length === 3 && hsa.items[0].photo.file && hsa.signSite.file && hsa.signFm.file && !('data' in hsa.items[0].photo), 'H10) PDF 생성 → 먼저 자동 저장 (사진 1·서명 2 파일로 올리고 주소만 넘김) → PDF 화면');
  await p.evaluate(() => back()); await p.waitForFunction(() => S.view === 'df');
  ok(/PDF 보기/.test(await p.locator('#dfPdfB').innerText()) && await p.evaluate(() => !!S.df.f.id && !S.df.dirty) && /저장됨/.test(await p.locator('#dfState').innerText()), 'H11) 돌아오면 버튼이 「PDF 보기」 · 「저장됨」');
  const hs1 = count('ws_hj_save'); await p.click('#dfPdfB'); await p.waitForFunction(() => S.view === 'pdf'); await p.evaluate(() => back()); await p.waitForFunction(() => S.view === 'df');
  ok(count('ws_hj_save') === hs1, 'H12) 「PDF 보기」는 다시 저장하지 않고 그 PDF를 엶');
  await p.locator('.dfc').first().locator('textarea').fill('천장 누수 자국 (수정)');
  ok(/PDF 생성/.test(await p.locator('#dfPdfB').innerText()) && /저장 안 함/.test(await p.locator('#dfState').innerText()), 'H13) 고치면 다시 「PDF 생성」 · 「저장 안 함」');
  const hu1 = UPLOADS.length; await p.click('#dfBar .btn.pri'); await p.waitForFunction(() => !S.df.busy && !S.df.f.id && S.df.list.length === 1);
  ok(UPLOADS.length === hu1 && !!last('ws_hj_save').a.p_d.items[0].photo.id && !!last('ws_hj_save').a.p_d.signSite.id && last('ws_hj_save').a.p_d.id === 'WS-HJ-1' && HJ.length === 1 && await p.locator('.dfc').count() === 1, 'H14) 저장: 있던 사진·서명은 번호만 · 같은 번호로 덮어씀 · 빈 양식으로');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_defect.png'), fullPage: true });
  await p.locator('.whrow').click(); await p.waitForFunction(() => S.df.f.id);
  await p.click('.whdel'); await p.waitForFunction(() => !S.df.f.id && S.df.list.length === 0);
  ok(HJ.length === 0 && count('ws_hj_delete') === 1, 'H15) 삭제 (되묻기 뒤) → 목록에서 사라짐');
  await p.evaluate(() => { TOASTQ.length = 0; }); await new Promise(r => setTimeout(r, 3500));   // 앞 알림 줄 비우기 (뒤 시험의 알림이 밀리지 않게)

  // ── 환경설정 (3-6) ──
  await p.evaluate(() => openSet()); await p.locator('.strow').first().waitFor();
  ok(await p.locator('.strow').count() >= 2 && /김철수/.test(await p.locator('.wrap.list').innerText()), '46) 환경설정: Supabase에서 직원 목록');
  await p.evaluate(() => setToastSec(1.5));
  ok(last('ws_admin_set_toast').a.p_sec === 1.5 && await toast('알림 시간 1.5초로 저장'), '47) 알림 시간 저장');
  await p.evaluate(() => staffDlg()); await p.fill('#sfN', '박민수'); await p.fill('#sfX', '1357'); await p.click('#sfB');
  ok(await toast('박민수 님을 추가했습니다') && last('ws_admin_staff_save').a.p_d.pin === '1357' && last('ws_admin_staff_save').a.p_d.staff_id === '', '48) 직원 추가 → DB 함수에 이름·PIN');
  await p.evaluate(() => staffPinDlg('S002')); await p.fill('#spX', '9753'); await p.click('#spB');
  ok(await toast('김철수 님의 PIN을 바꿨습니다') && last('ws_admin_staff_pin').a.p_pin === '9753', '49) PIN 변경');
  await p.evaluate(() => staffDel('S004'));
  ok(await toast('박민수 님을 삭제했습니다') && last('ws_admin_staff_remove').a.p_staff_id === 'S004', '50) 직원 삭제');
  ok(/위험성 목록 2줄/.test(await p.locator('.wrap.list').innerText()), '51) 환경설정에 「TBM 위험성 목록 2줄」');
  await p.click('button[onclick="openRisk()"]'); await p.locator('.tbw').first().waitFor();
  ok(await p.locator('.tbw').count() === 2, '52) 위험성 목록 편집 화면: 2줄');
  await p.click('.tbw:nth-of-type(3) button[aria-label="위로"]');   // 2번째 카드(배너 다음) 위로
  ok(await p.evaluate(() => S.rk.rows[0].risk) === '감전' && /고친 내용 있음/.test(await p.locator('#rkSt').innerText()), '53) ↑ 로 순서 바꿈');
  await p.click('button[onclick="rkAdd()"]');
  await p.locator('.tbedit input').nth(0).fill('사다리, 고소'); await p.locator('.tbedit input').nth(1).fill('떨어짐');
  await p.locator('.tbedit .tbseg').nth(1).locator('button', { hasText: '3' }).click();
  await p.locator('.tbedit .tbown input.inp').nth(1).fill('2인 1조'); await p.locator('.tbedit .tbown input[type=checkbox]').nth(1).check();
  await p.click('button[onclick="rkSave()"]');
  ok(await toast('위험성 목록 3줄 저장'), '54) 줄 추가 → 저장');
  const rs = last('ws_risk_save').a.p_rows;
  ok(rs.length === 3 && rs[0].risk === '감전' && rs[2].words === '사다리, 고소' && rs[2].s === 3 && rs[2].fixes[1].t === '2인 1조' && rs[2].fixes[1].on === true && /저장됨/.test(await p.locator('#rkSt').innerText()),
    '55) DB 함수에 순서·낱말·중대성·개선조치(✓) 넘김');
  await p.screenshot({ path: path.join(__dirname, 'shot_sb_risk.png'), fullPage: true });
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await b.close(); srv.close();
  console.log(fail ? '\n화면 시험 실패 ' + fail + '개' : '\n3-2~3-6 화면 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); srv.close(); process.exit(1); });
