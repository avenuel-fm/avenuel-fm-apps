/* ── 공조기 환기온도 (WS_공조기환기온도 15.3.23, 결정 128) — 휴대폰은 11:00·16:00 골라 (결정 196) 한 대씩, PC는 B4 종이 위에 바로. 저장은 고친 칸만 ── */
const AHU_OUT = [['out_t', '외기온도', '℃'], ['out_h', '습도', '%'], ['cw_t', '냉수공급온도', '℃']];
const AHU_HM = { 12: '11:00', 16: '16:00' };   // 저장 칸 「12」 = 첫 회차 11:00 (결정 196, 11-21 전 기록도 11:00 칸에)
async function openAhu() { S.ahu = null; go('ahu'); await loadAhu(''); }
async function loadAhu(day) {
  const r = await call('ahuGet', day);
  if (!r.ok) { toast(r.error); return; }
  ahuSet(r);
}
function ahuSet(r) {
  const rec = r.rec || {}, s = x => x == null ? '' : String(x), v = { temps: {} };
  AHU_OUT.forEach(o => ['12', '16'].forEach(t => { v[o[0] + t] = s(rec[o[0] + t]); }));
  r.units.forEach(u => { const t = (rec.temps || {})[u.no] || {}; v.temps[u.no] = { 12: s(t['12']), 16: s(t['16']) }; });
  const old = S.ahu && S.ahu.day === r.day ? S.ahu.slot : '';
  const kd = new Date(Date.now() + 9 * 3600e3), kstM = kd.getUTCHours() * 60 + kd.getUTCMinutes();
  S.ahu = { srv: r, day: r.day, v, ch: {}, slot: old || (r.day === r.workDay && kstM >= 810 ? '16' : '12'), busy: false, pdfBusy: false };
  if (S.view === 'ahu') render();
}
function ahuDirty() { return Object.keys(S.ahu.ch).length > 0; }
function ahuLeaveOk() { return !(S.ahu && ahuDirty()) || confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?'); }
function ahuCal() {
  const g = S.ahu, t = g.srv.workDay;
  pickDate({ cur: g.day, home: t, max: t, homeLbl: '오늘로 (' + Number(t.slice(5, 7)) + '월 ' + Number(t.slice(8, 10)) + '일)',
    fn: ds => { if (ds !== S.ahu.day && ahuLeaveOk()) loadAhu(ds); } });
}
function ahuSlot(t) { S.ahu.slot = t; render(); }
// 입력 중에는 다시 그리지 않음 (초점 유지)
function ahuIn(el) {
  const g = S.ahu, k = el.dataset.k, u = el.dataset.u, t = el.dataset.t, val = ahuNorm(el.value); g.err = '';
  if (u) { g.v.temps[u][t] = val; const c = g.ch.temps = g.ch.temps || {}; (c[u] = c[u] || {})[t] = val; }
  else { g.v[k] = val; g.ch[k] = val; }
  if (el.classList.contains('inp')) el.classList.toggle('empty', !val);
  el.classList.toggle('bad', !!ahuCheck(k || 'u', val));
  const e = $('ahuState'); if (e) e.innerHTML = ahuState();
  docSlotSet(ahuDoc());
  const n = t && $('ahuCnt' + t); if (n) n.textContent = ahuCount(t);
}
// 「22,5」→「22.5」, 「22.5℃」→「22.5」 (서버가 숫자만 받으므로 미리 고침)
function ahuNorm(x) { return String(x).replace(/[℃%\s]/g, '').replace(/,/g, '.'); }
// 칸 하나 검사 (서버 ws_ahu_save 와 같은 범위). 문제 없으면 ''
function ahuCheck(k, val, name) {
  if (val === '') return '';
  const rg = k === 'u' ? [-10, 50] : k.indexOf('out_t') === 0 ? [-30, 50] : k.indexOf('out_h') === 0 ? [0, 100] : [-5, 40];
  return /^-?\d+(\.\d+)?$/.test(val) && Number(val) >= rg[0] && Number(val) <= rg[1] ? '' : (name || '') + ' ' + rg[0] + ' ~ ' + rg[1] + ' 숫자로 넣어 주세요';
}
// 고친 칸 중 문제 있는 칸 [{k, u, t, msg}]
function ahuBads() {
  const g = S.ahu, out = [], nm = {};
  AHU_OUT.forEach(o => { nm[o[0]] = o[1]; });
  Object.keys(g.ch).forEach(k => {
    if (k === 'temps') Object.keys(g.ch.temps).forEach(u => Object.keys(g.ch.temps[u]).forEach(t => { const m = ahuCheck('u', g.ch.temps[u][t], u + ' ' + AHU_HM[t]); if (m) out.push({ u, t, msg: m }); }));
    else { const m = ahuCheck(k, g.ch[k], nm[k.slice(0, 5)] + ' ' + AHU_HM[k.slice(5)]); if (m) out.push({ k, t: k.slice(5), msg: m }); }
  });
  return out;
}
function ahuCount(t) { const g = S.ahu; return '입력 ' + g.srv.units.filter(u => g.v.temps[u.no][t] !== '').length + '/' + g.srv.units.length; }
function ahuDoc() {
  const g = S.ahu, pdf = g.srv.rec && g.srv.rec.pdf;
  return { sid: 'ahuState', state: ahuState(), print: lgPc() ? 'ahuPrint()' : '', id: 'ahuSave', save: 'ahuPdf()', busy: g.busy, pdfBusy: g.pdfBusy, pdf: pdf && !ahuDirty() ? { url: pdf.url, pv: { name: g.day + '_공조기환기온도.pdf', sub: '서류작업 › 공조기 환기온도 ›' } } : null };
}
function ahuState() {
  const g = S.ahu, r = g.srv.rec;
  const bad = ahuDirty() ? ahuBads() : [];
  if (bad.length) return '<span class="nwstate dirty"><i class="dot"></i>고칠 칸 ' + bad.length + '개' + (g.err ? '<small class="hverr"> · ' + h(g.err) + '</small>' : '') + '</span>';
  if (g.err) return '<span class="nwstate dirty"><i class="dot"></i>저장 안 함<small class="hverr"> · ' + h(g.err) + '</small></span>';
  return ahuDirty() ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : r && r.ver ? '<span class="nwstate">' + ICON.ok + '저장됨' + (lgPc() ? ' · ' + h(String(r.ver).slice(11, 16)) + ' ' + h(r.by) : '') + '</span>' : '<span class="nwstate" style="color:var(--muted)">아직 저장 안 함</span>';
}
function ahuMd(d, y) { return (y ? d.slice(0, 4) + '년 ' : '') + Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일 (' + '일월화수목금토'[new Date(d + 'T12:00:00+09:00').getDay()] + ')'; }
function ahuLong(d) { return [0, 5, 6].indexOf(new Date(d + 'T12:00:00+09:00').getDay()) !== -1; }   // 금토일 = 연장영업
function ahuWho() { const r = S.ahu.srv.rec; return r && r.authors && r.authors.length ? r.authors.join('·') : (S.user && S.user.name) || ''; }
function ahuWx() {
  const w = S.ahu.srv.wx || {}, n = (x, u) => x == null || x === '' ? '—' : x + u;
  return [['날씨', w.weather || '—'], ['최저', n(w.tmin, '℃')], ['최고', n(w.tmax, '℃')], ['습도', n(w.humidity, '%')]];
}
function ahuBox(attrs, val, cls) {
  const m = /data-k="([a-z_0-9]+)"/.exec(attrs), bad = ahuCheck(m ? m[1] : 'u', val) ? ' bad' : '';   // 고쳐야 할 칸은 다시 그려도 빨간 채로
  return '<input class="' + cls + (val === '' && cls === 'inp' ? ' empty' : '') + bad + '" inputmode="decimal" maxlength="8" value="' + h(val) + '" ' + attrs + ' oninput="ahuIn(this)" onchange="this.value=ahuNorm(this.value)">';
}
/** 종이 (화면·인쇄·PDF 같은 틀) */
function ahuSheet(edit) {
  const g = S.ahu, us = g.srv.units, val = (a, x) => edit ? ahuBox(a, x, 'lgin') : h(x);
  const blocks = [us.slice(0, 13), us.slice(13, 26), us.slice(26)];
  const grid = blocks.map(b => '<table class="hvt"><colgroup><col style="width:84px"><col><col style="width:62px"><col style="width:62px"></colgroup>' +
    '<thead><tr><th rowspan="2">AHU NO.</th><th rowspan="2">사용장소</th><th colspan="2">환기온도 (℃)</th></tr><tr><th>11:00</th><th>16:00</th></tr></thead><tbody>' +
    b.map(u => '<tr><td class="no">' + h(u.no) + '<small>' + h(u.room) + '</small></td><td class="l" title="' + h(u.place) + '">' + h(u.place) + '</td>' +
      ['12', '16'].map(t => '<td class="v">' + val('data-u="' + h(u.no) + '" data-t="' + t + '" aria-label="' + h(u.no) + ' ' + AHU_HM[t] + '"', g.v.temps[u.no][t]) + '</td>').join('') + '</tr>').join('') +
    Array(Math.max(0, 13 - b.length)).fill('<tr><td></td><td></td><td></td><td></td></tr>').join('') + '</tbody></table>').join('');
  return '<div class="hvs"><div class="hvsh"><div><h1>에비뉴엘 AHU · 환기온도 점검일지</h1><div class="d">' + ahuMd(g.day, true) + (ahuLong(g.day) ? ' &nbsp;<span class="hvchip">연장영업</span>' : '') + '</div></div>' +
    '<div class="wx">' + ahuWx().map(x => '<span>' + x[0] + ' <b>' + h(x[1]) + '</b></span>').join('') + '<span>점검자 <b>' + h(ahuWho()) + '</b></span></div>' +
    '<table class="hvsign"><tr><th>파트장</th><th>소장</th></tr><tr>' + ['part', 'boss'].map(k => { const x = (g.srv.signs || {})[k]; return '<td>' + (x && x.img ? '<img src="' + h(x.img) + '" alt="' + h(x.name) + ' 서명">' : '') + '</td>'; }).join('') + '</tr></table></div>' +
    '<div style="display:flex;gap:10px;align-items:stretch"><table class="hvsmall"><tr><th>점검시간</th><th>11:00</th><th>16:00</th></tr>' +
    AHU_OUT.map(o => '<tr><th>' + o[1] + '</th>' + ['12', '16'].map(t => '<td>' + val('data-k="' + o[0] + t + '" aria-label="' + o[1] + ' ' + AHU_HM[t] + '"', g.v[o[0] + t]) + '</td>').join('') + '</tr>').join('') + '</table>' +
    '<div class="hvnote"><b>특이사항</b> · 동절기 -7℃ 일 때 에너지센터 순환펌프 가동 확인 후 공조기 가동<br>공조기 정지시간: 평일 19:50 · 주말(금토일) 20:20</div></div>' +
    '<div class="hvgrid">' + grid + '</div></div>';
}
function ahuZoom() { return Math.min(1, (Math.min(window.innerWidth, 1680) - 34) / 1378); }
function renderAhu() {
  const g = S.ahu;
  if (!g) return clTop() + '<div class="wrap list">' + clTabs('ahu') + '<div class="banner b-gray">불러오는 중…</div></div>';
  const past = g.day < g.srv.workDay ? '<span style="font-size:var(--size-s);color:var(--muted)">지난 날짜입니다 · 고치면 저장할 수 있습니다</span>' : '';
  const bar = '<div class="nwbar" id="ahuBar">' + docBar(ahuDoc()) + '</div>';
  const date = '<button class="nwdate" data-date="' + h(g.day) + '" onclick="ahuCal()" aria-label="일자 바꾸기">' + ICON.cal + ahuMd(g.day) + '</button>';
  if (lgPc()) return clTop() + '<div class="lgwrap">' + clTabs('ahu') +
    '<div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)">' + date + (past || '<span style="font-size:var(--size-s);color:var(--muted)">칸을 눌러 바로 입력 · 휴대폰에서 넣은 값도 여기 보임</span>') + '</div>' +
    '<div id="ahuSheet" style="zoom:' + ahuZoom() + '">' + ahuSheet(true) + '</div>' + bar + '</div>';
  const t = g.slot, o = t === '16' ? '12' : '';
  const rows = g.srv.units.map(u => '<div class="hvr"><div class="nm"><b>' + h(u.no) + '</b><i>' + h(u.room) + '</i><small>' + h(u.place) + '</small>' +
    (o ? '<span class="prev">11:00 · ' + (g.v.temps[u.no][o] !== '' ? h(g.v.temps[u.no][o]) + '℃' : '—') + '</span>' : '') + '</div>' +
    '<label class="hvin">' + ahuBox('data-u="' + h(u.no) + '" data-t="' + t + '" aria-label="' + h(u.no) + ' 환기온도"', g.v.temps[u.no][t], 'inp') + '<span>℃</span></label></div>').join('');
  return clTop() + '<div class="wrap list">' + clTabs('ahu') +
    '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>AHU 환기온도 점검일지</b>' + date + '</div>' +
    '<div class="hvmeta">' + (ahuLong(g.day) ? '<span class="hvchip">연장영업</span>' : '') + '점검자 ' + h(ahuWho()) + (past ? '<br>' + past : '') + '</div>' +
    '<div class="seg hvtime" role="group" aria-label="점검 시각">' + ['12', '16'].map(x => '<button type="button" class="' + (x === t ? 'on' : '') + '" aria-pressed="' + (x === t) + '" onclick="ahuSlot(\'' + x + '\')">' + AHU_HM[x] + '<small id="ahuCnt' + x + '">' + ahuCount(x) + '</small></button>').join('') + '</div>' +
    '<div class="hvw">' + AHU_OUT.map(x => '<label>' + x[1] + '<span class="hvin">' + ahuBox('data-k="' + x[0] + t + '"', g.v[x[0] + t], 'inp') + '<span>' + x[2] + '</span></span></label>').join('') + '</div>' +
    '<div class="hvmeta">' + ahuWx().map(x => x[0] + ' ' + h(x[1])).join(' · ') + ' <span style="color:var(--muted)">(종합업무일지에서 자동)</span></div></div>' +
    '<div class="hvsec">공조기 환기온도 (' + AHU_HM[t] + ')</div><div class="hvlist">' + rows + '</div>' + bar + '</div>';
}
async function ahuSave(quiet) {
  const g = S.ahu; if (g.busy) return false;
  if (!ahuDirty()) { if (!quiet) toast('바뀐 것이 없습니다'); return true; }
  const bad = ahuBads();
  if (bad.length) {   // 서버에 보내기 전에: 첫 문제 칸으로 가서 이유를 아래 줄에 남김 (사라지는 알림만으로는 놓침)
    const b = bad[0]; g.err = b.msg;
    if (!lgPc() && g.slot !== b.t) g.slot = b.t;
    render(); toast(b.msg);
    const el = document.querySelector(b.u ? '[data-u="' + b.u + '"][data-t="' + b.t + '"]' : '[data-k="' + b.k + '"]');
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    return false;
  }
  const sent = JSON.parse(JSON.stringify(g.ch));
  g.busy = true; render();
  try {
    const r = await call('ahuSave', g.day, g.ch);
    if (!r.ok) { g.busy = false; g.err = r.error; render(); toast(r.error); return false; }
    const late = g.ch;   // 저장하는 사이에 더 넣은 값은 지우지 않고 「저장 안 함」으로 남김
    ahuSet(r); ahuLate(late, sent); if (!quiet) toast(r.queued ? OFFMSG : '저장했습니다'); return true;
  } catch (e) { g.busy = false; g.err = '서버에 닿지 않았습니다. 다시 눌러 주세요'; render(); return false; }
}
function ahuLate(late, sent) {
  const g = S.ahu, tp = late.temps || {}, st = sent.temps || {};
  Object.keys(tp).forEach(u => Object.keys(tp[u]).forEach(t => { const x = tp[u][t]; if ((st[u] || {})[t] !== x) { g.v.temps[u][t] = x; ((g.ch.temps = g.ch.temps || {})[u] = g.ch.temps[u] || {})[t] = x; } }));
  Object.keys(late).forEach(k => { if (k !== 'temps' && sent[k] !== late[k]) { g.v[k] = late[k]; g.ch[k] = late[k]; } });
  if (ahuDirty()) render();
}
/* 인쇄 = B4 가로 한 장 (1376px = 364mm) */
async function ahuPrint() {
  if (ahuDirty() && !(await ahuSave(true))) return;   // 저장 안 한 값이 있으면 먼저 저장 (인쇄만 하면 기록에 안 남음)
  $('print').innerHTML = '<style>@page{size:364mm 257mm;margin:0}</style>' + ahuSheet(false);
  setTimeout(() => window.print(), 300);
}
async function ahuPdf() {
  if (S.ahu.busy) return;
  if (ahuDirty() && !(await ahuSave(true))) return;
  if (!S.ahu.srv.rec) { toast('먼저 값을 넣어 주세요'); return; }
  const g = S.ahu; g.busy = true; g.pdfBusy = true; render();
  try {
    await loadH2p();
    const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
    const box = document.createElement('div'); box.style.cssText = 'width:1376px;background:#fff'; box.innerHTML = ahuSheet(false);
    wrap.appendChild(box); document.body.appendChild(wrap);
    let uri;
    try {
      try { if (document.fonts) await document.fonts.ready; } catch (e) {}
      const keepY = window.scrollY; window.scrollTo(0, 0);
      try {
        uri = await html2pdf().set({
          margin: 0, filename: g.day + '_공조기환기온도.pdf', image: { type: 'jpeg', quality: 0.92 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 1376 },   // 서명 그림이 Supabase 주소여도 PDF에 들어가게
          jsPDF: { unit: 'mm', format: [364, 257], orientation: 'landscape' }, pagebreak: { mode: ['legacy'] }
        }).from(box.firstChild).outputPdf('datauristring');
      } finally { window.scrollTo(0, keepY); }
    } finally { wrap.remove(); }
    const r = await call('ahuSavePdf', g.day, uri);
    if (!r.ok) { g.busy = false; g.pdfBusy = false; render(); toast(r.error); return; }
    ahuSet(r); toast('저장하고 PDF도 만들었습니다');
  } catch (e) { g.busy = false; g.pdfBusy = false; render(); toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
}

/* 날짜 고르기 달력 (명일 작업 · TBM, 11-13) — 바로가기 페이지 안에서는 휴대폰 기본 날짜 칸이 안 열리는 기기가 있어 출근현황 달력 모양으로 */
let PICK = null;
function pickDate(o) { PICK = o; pickDraw(o.cur.slice(0, 7)); }
function pickDraw(ym) {
  const o = PICK, y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(), first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  let g = WEEK.map(w => '<span class="w">' + w + '</span>').join('') + '<span></span>'.repeat(first);
  for (let d = 1; d <= last; d++) {
    const ds = ym + '-' + String(d).padStart(2, '0'), wd = (first + d - 1) % 7;
    g += '<button class="' + (wd === 0 ? 'sun ' : wd === 6 ? 'sat ' : '') + (ds === o.cur ? 'on ' : '') + (ds === o.home ? 'today' : '') + '" data-d="' + ds + '" onclick="pickGo(\'' + ds + '\')" aria-label="' + m + '월 ' + d + '일"' + (o.max && ds > o.max ? ' disabled' : '') + '><b>' + d + '</b></button>';
  }
  const mv = k => new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7), nx = mv(1);
  dialog('<div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)"><button class="btn sm" onclick="pickDraw(\'' + mv(-1) + '\')" aria-label="앞 달">‹</button><b style="flex:1;text-align:center;font-size:var(--size-l)">' + y + '년 ' + m + '월</b>' +
    '<button class="btn sm" onclick="pickDraw(\'' + nx + '\')" aria-label="다음 달"' + (o.max && nx > o.max.slice(0, 7) ? ' disabled' : '') + '>›</button><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="atcal">' + g + '</div><button class="btn" style="width:100%;margin-top:var(--sp-2)" onclick="pickGo(\'' + o.home + '\')">' + h(o.homeLbl) + '</button>');
}
function pickGo(ds) { closeDialog(); PICK.fn(ds); }
/* 그날 상태 고르기 (6장) */
function atFixOpen(i, keep) {
  const r = S.at.r, x = r.people[i]; if (!keep) S.at.pick = x.v;
  const opts = () => AT_CODES.map(c => '<button class="attag s-' + atCls(c) + (c === S.at.pick ? ' sel' : '') + '" aria-pressed="' + (c === S.at.pick) + '" onclick="S.at.pick=' + h(JSON.stringify(c)) + ';atFixOpen(' + i + ',1)">' + atLbl(c) + '</button>').join('');
  dialog('<div style="display:flex;align-items:center;margin-bottom:var(--sp-1)"><div class="fname"><b style="font-size:var(--size-l)">' + h(x.name) + ' · ' + h(atKo(r.date)) + '</b><small>엑셀 값: ' + h(atLbl(x.raw)) + (x.fix ? ' · 고침: ' + h(x.fix.by) + ' ' + h(x.fix.at) : '') + ' → 바꿀 상태를 고르세요 (이날만)</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="atopts" style="margin-top:var(--sp-2)">' + opts() + '</div>' +
    '<div class="nwmeta">고친 사람·시각이 남고, 엑셀을 다시 올려도 이날 고친 값은 그대로입니다.</div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3)">' + (x.fix ? '<button class="btn" style="flex:1" onclick="atFixSave(' + i + ',\'(되돌림)\')">엑셀 값으로 되돌리기</button>' : '') +
    '<button class="btn pri big" style="flex:1" onclick="atFixSave(' + i + ',S.at.pick)"' + (S.at.pick === x.v ? ' disabled' : '') + '>' + h(atLbl(S.at.pick)) + '(으)로 바꾸기</button></div>');
}
async function atFixSave(i, v) {
  const x = S.at.r.people[i]; closeDialog();
  try { const r = await call('attFix', S.at.r.date, x.name, v); if (!r.ok) return toast(r.error); S.at = { r }; render(); toast(x.name + ' → ' + (v === '(되돌림)' ? '엑셀 값' : atLbl(v))); } catch (e) {}
}
/* 기본 휴일 (6장): 소장·부소장·총무만 고침, 다른 사람은 보기만 */
function atHolOpen(i, sel) {
  const r = S.at.r, x = r.people[i], cur = sel || (x.hol ? x.hol.split(',') : []), ed = r.canBoss;
  S.at.hol = cur;
  dialog('<div style="display:flex;align-items:center;margin-bottom:var(--sp-1)"><div class="fname"><b style="font-size:var(--size-l)">' + h(x.name) + ' · ' + h(atRole(x.role)) + ' — 기본 휴일</b><small>' + (ed ? '매주 쉬는 요일을 고르세요 (여러 개)' : '소장·부소장·총무만 고칠 수 있습니다') + '</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="atwk" style="margin-top:var(--sp-2)">' + WEEK.map(w => '<button class="' + (cur.indexOf(w) !== -1 ? 'sel' : '') + '" aria-pressed="' + (cur.indexOf(w) !== -1) + '"' + (ed ? ' onclick="atHolTog(' + i + ',\'' + w + '\')"' : ' disabled') + ' style="' + (w === '일' ? 'color:var(--red)' : w === '토' ? 'color:var(--blue)' : '') + '">' + w + '</button>').join('') + '</div>' +
    '<div class="atchk" style="margin-top:var(--sp-2)">지금: <b>' + (cur.length ? cur.join(' · ') : '없음') + '</b><br>엑셀에서 이 요일이 빈 칸(출근)이면 「휴」로 봅니다. 엑셀에 다른 값(연·9-7 등)이 있으면 엑셀 값이 먼저입니다.</div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3)"><button class="btn" style="flex:1" onclick="closeDialog()">닫기</button>' + (ed ? '<button class="btn pri" style="flex:1" onclick="atHolSave(' + i + ')">저장</button>' : '') + '</div>');
}
function atHolTog(i, w) { const c = S.at.hol.slice(), k = c.indexOf(w); if (k === -1) c.push(w); else c.splice(k, 1); atHolOpen(i, c); }
async function atHolSave(i) {
  const x = S.at.r.people[i]; closeDialog();
  try { const r = await call('attHoliday', x.name, S.at.hol, S.at.r.date); if (!r.ok) return toast(r.error); S.at = { r }; render(); toast(x.name + ' 기본 휴일 저장'); } catch (e) {}
}
/* 그림 (5장): 가로 1200px 판을 2배로 그려 PNG — 명일 작업처럼 내려받고 그림도 보여 줌 */
function atImgHtml(r) {
  const t = new Date(), p = n => String(n).padStart(2, '0');
  return '<div class="atimg"><div class="attl"><b>' + h(atKo(r.date)) + ' 근무인원</b><span>잠실점 에비뉴엘 시설관리</span></div>' + atOrg(r.people, false) + atSums(r.people) +
    '<div class="stamp">업무지원 앱 · ' + t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes()) + '</div></div>';
}
async function atImage() {
  const r = S.at.r, btn = $('atImgBtn'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 그림 만드는 중'; }
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
  wrap.innerHTML = atImgHtml(r); document.body.appendChild(wrap);
  const box = wrap.firstChild; box.classList.add('cap'); const W = box.offsetWidth, H = box.offsetHeight;
  try {
    await loadH2p();
    try { if (document.fonts) await document.fonts.ready; } catch (e) {}
    const keepY = window.scrollY; window.scrollTo(0, 0);
    let url;
    try { url = await html2pdf().set({ margin: 0, image: { type: 'png' }, html2canvas: { scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: W },
        jsPDF: { unit: 'px', format: [W, H], orientation: 'landscape', hotfixes: ['px_scaling'] } }).from(box).outputImg('datauristring'); }
    finally { window.scrollTo(0, keepY); }
    const name = r.date + '_출근현황.png';
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    dialog('<div style="display:flex;align-items:center;margin-bottom:var(--sp-2)"><div class="fname"><b style="font-size:var(--size-l)">그림으로 저장</b><small>' + h(name) + '</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
      '<img class="nwimg" id="atImg" src="' + url + '" alt="출근현황 ' + h(r.date) + '">' +
      '<div class="banner b-info" style="margin-top:var(--sp-2)">내려받기가 되지 않으면 위 그림을 <b>길게 눌러 「이미지 저장」</b>을 고르세요.</div>' +
      '<a class="btn pri big" style="width:100%;margin-top:var(--sp-2)" href="' + url + '" download="' + h(name) + '">다시 내려받기</a>');
  } catch (e) { toast('그림을 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
  finally { wrap.remove(); if (btn) { btn.disabled = false; btn.innerHTML = ICON.dl + '그림으로 저장'; } }
}

/* 엑셀 올리기 (4장): 화면에서 엑셀 읽기 도구(SheetJS)로 읽어 칸 글자만 서버로 */
let XLS = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return XLS || (XLS = new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = ok; sc.onerror = () => { XLS = null; no(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.appendChild(sc);
  }));
}
/** 표(줄×칸 글자) → { ym, rows, tot, unknown } — 날짜 줄(1, 2, 3…)을 찾아 그 왼쪽 2·3·4칸 = 이름·직책·구역. hid[줄] = 엑셀에서 숨긴 줄 */
function atParse(aoa, hid) {
  const c = v => String(v == null ? '' : v).trim();
  let ym = '', hr = -1, c0 = -1;
  aoa.slice(0, 6).forEach(row => (row || []).forEach(v => { const m = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(c(v)); if (m && !ym) ym = m[1] + '-' + m[2].padStart(2, '0'); }));
  for (let r = 0; r < Math.min(aoa.length, 20) && hr < 0; r++) { const row = aoa[r] || []; for (let k = 0; k < row.length - 1; k++) if (c(row[k]) === '1' && c(row[k + 1]) === '2') { hr = r; c0 = k; break; } }
  if (hr < 0 || c0 < 2) return { error: '날짜 줄(1, 2, 3 …)을 찾지 못했습니다. 근무 스케줄 엑셀이 맞는지 확인해 주세요.' };
  let n = 0; while (n < 31 && c(aoa[hr][c0 + n]) === String(n + 1)) n++;
  const rows = [], unknown = {}; let sec = '', tot = null;
  for (let r = hr + 1; r < aoa.length; r++) {
    const row = aoa[r] || [], a = c0 >= 4 ? c(row[c0 - 4]) : '', role = c(row[c0 - 3]), name = c(row[c0 - 2]);
    const days = Array.from({ length: n }, (_, i) => c(row[c0 + i]));
    if (/총원/.test(a + role)) { tot = days.map(v => v === '' ? null : Number(v)); continue; }   // 빈 칸(엑셀이 안 센 날)은 맞춰 보지 않음
    if (/합계/.test(a + role)) continue;
    if (a) sec = a.replace(/\s+/g, '');
    if (!role && !name) continue;   // 요일 줄·아래 안내 글 (공사장 안전관리는 구역·직책 칸이 합쳐져 직책이 비어 있음)
    if (!name && hid && hid[r]) continue;   // 숨긴 빈 줄은 공석 아님 (숨긴 줄이라도 이름 있으면 읽음, 사용자 11-13)
    if (name) days.forEach(v => { if (AT_KNOWN.indexOf(v) === -1) unknown[v] = (unknown[v] || []).concat(name); });
    rows.push({ sec, role, name, days });
  }
  if (!rows.length) return { error: '직원 줄을 찾지 못했습니다.' };
  const ju = Array.from({ length: n }, (_, i) => rows.filter(x => x.name && !/^공사장/.test(x.sec) && atIsDay(x.days[i])).length);   // 엑셀 「주간근무총원」은 공사장 안전관리를 빼고 셈
  const bad = tot ? ju.map((v, i) => tot[i] == null || v === tot[i] ? 0 : i + 1).filter(Boolean) : null;
  return { ym, rows, n, bad, unknown };
}
function atB64(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function atFile(el) {
  const f = el.files && el.files[0]; if (!f) return;
  S.atup = { busy: true, name: f.name }; render();
  try {
    await loadXlsx();
    const buf = await f.arrayBuffer(), wb = XLSX.read(buf, { type: 'array', cellStyles: true }), ws = wb.Sheets[wb.SheetNames[0]];
    const r0 = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0, hid = (ws['!rows'] || []).slice(r0).map(x => !!(x && x.hidden));
    const p = atParse(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true }), hid);
    S.atup = Object.assign({ name: f.name, day: 1, file: buf.byteLength < 3e6 ? 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + atB64(buf) : '' }, p);
  } catch (e) { S.atup = { name: f.name, error: '엑셀을 읽지 못했습니다: ' + (e && e.message ? e.message : e) }; }
  render();
}
function renderAttUp() {
  const u = S.atup || {};
  let body = '<div class="card" style="padding:var(--sp-4)"><div class="nwhead"><b>근무 스케줄 엑셀 올리기</b></div>' +
    '<label class="btn" style="width:100%;min-height:64px;border-style:dashed;color:var(--blue);margin-top:var(--sp-2)">' + ICON.clip + '엑셀 파일(.xlsx) 고르기<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange="atFile(this)" style="position:absolute;width:1px;height:1px;opacity:0"></label>';
  if (u.busy && !u.rows) body += '<div class="nwmeta"><span class="spin"></span> ' + h(u.name) + ' 읽는 중…</div>';
  else if (u.error) body += '<div class="banner b-red" style="margin-top:var(--sp-2)">' + h(u.error) + '</div>';
  else if (u.rows) {
    const named = u.rows.filter(x => x.name).length, unk = Object.keys(u.unknown);
    body += '<div class="atchk" style="margin-top:var(--sp-2)">' + ICON.file + h(u.name) + ' · ' + (u.ym ? '<b>' + h(ymLabel(u.ym)) + '</b> (제목 줄에서 읽음)' : '<span class="w">몇 월인지 못 읽음 — 아래에서 고르세요</span>') + '<br>' +
      ICON.ok + named + '명' + (u.rows.length > named ? ' + 공석 ' + (u.rows.length - named) + '줄' : '') + ' × ' + u.n + '일 읽음 · 빈 칸 = 출근<br>' +
      (u.bad == null ? '<span class="w">' + ICON.warn + '엑셀 「주간근무총원」 줄을 못 찾아 맞춰 보지 못했습니다</span>' : u.bad.length ? '<span class="w">' + ICON.warn + '엑셀 「주간근무총원」과 다른 날: ' + u.bad.join(', ') + '일</span>' : ICON.ok + '엑셀 「주간근무총원」 줄과 앱 계산 ' + u.n + '일 모두 같음') +
      unk.map(k => '<br><span class="w">' + ICON.warn + '처음 보는 기호 「' + h(k) + '」 (' + h(u.unknown[k].filter((x, i, a) => a.indexOf(x) === i).join(', ')) + ' ' + u.unknown[k].length + '칸) → 휴무로 셈</span>').join('') + '</div>' +
      '<label class="nwmeta" style="display:flex;align-items:center;gap:var(--sp-2)">저장할 달 <input type="month" class="inp" style="width:auto" value="' + h(u.ym) + '" onchange="S.atup.ym=this.value"></label></div>' +
      '<div class="card" style="padding:var(--sp-4)"><div class="nwhead"><b>미리보기 · ' + u.day + '일</b><button class="btn sm" onclick="S.atup.day=Math.max(1,S.atup.day-1);render()" aria-label="앞 날">‹</button><button class="btn sm" onclick="S.atup.day=Math.min(S.atup.n,S.atup.day+1);render()" aria-label="다음 날">›</button></div>' +
      '<table class="atst" style="margin-top:var(--sp-2)"><tr><th>구역</th><th>직책</th><th>이름</th><th>' + u.day + '일</th></tr>' +
      u.rows.map(x => '<tr><td>' + h(x.sec) + '</td><td>' + h(atRole(x.role)) + '</td><td>' + (x.name ? '<b>' + h(x.name) + '</b>' : '<span class="z">공석</span>') + '</td><td>' + (x.name ? '<span class="attag s-' + atCls(x.days[u.day - 1]) + '">' + h(atLbl(x.days[u.day - 1])) + '</span>' : '') + '</td></tr>').join('') + '</table>' +
      '<div class="nwmeta">같은 달을 다시 올리면 그 달을 새 것으로 바꿉니다. 그날 고친 것과 기본 휴일은 그대로 둡니다. (기본 휴일은 미리보기에 안 보임)</div></div>';
  } else body += '<div class="nwmeta">매월 초 만드는 근무 스케줄 엑셀 파일을 고르세요. 첫 번째 시트를 읽습니다.</div></div>';
  return topbar('출근현황 ›', '엑셀 올리기') + '<div class="wrap list">' + body +
    '<div class="nwbar"><button class="btn pri" id="atUpSave" onclick="atUpSave()"' + (u.rows && !u.busy ? '' : ' disabled') + '>' + (u.busy && u.rows ? '<span class="spin"></span>' : u.rows && u.ym ? h(ymLabel(u.ym)) + ' 저장' : '저장') + '</button></div></div>';
}
async function atUpSave() {
  const u = S.atup; if (!u || !u.rows || u.busy) return;
  if (!/^\d{4}-\d{2}$/.test(u.ym || '')) return toast('저장할 달을 골라 주세요');
  u.busy = true; render();
  try {
    const r = await call('attPut', u.ym, u.rows, u.file);
    if (!r.ok) { u.busy = false; render(); return toast(r.error); }
    toast(ymLabel(u.ym) + ' 근무 스케줄 ' + r.count + '줄 저장'); S.atup = null; S.at = null; go('att'); loadAtt(S.atToday && S.atToday.slice(0, 7) === u.ym ? '' : u.ym + '-01');
  } catch (e) { u.busy = false; render(); }
}

