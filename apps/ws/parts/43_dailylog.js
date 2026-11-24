/* ── 종합업무일지 (WS_종합업무일지 15.3.22, 결정 116) — PC 전용, B4 가로 한 장 ── */
const LG_METERS = [['시수', '에비뉴엘 시수'], ['중수', '에비뉴엘 중수'], ['식당시수', '직원식당 시수'], ['식당온수', '직원식당 온수'], ['식당가스', '직원식당 가스'], ['식당분전반', '직원식당 분전반'],
  ['식기세척분전반', '식기세척실 분전반'], ['매점분전반', '직원식당 매점 분전반']];   // 급탕·환탕·급탕탱크·실온수는 안 씀 (사용자 11-13)
const LG_FIELDS = ['영업시간', '날씨', '최저', '최고', '최고풍속', '미세먼지', '미세먼지등급', '전기', '비고'].concat(LG_METERS.map(m => m[0]));
const LG_DEPTS = ['전기방재', '기계건축'], LG_LINES = 10, LG_GRADES = ['', '좋음', '보통', '나쁨', '매우나쁨'];
const lgPc = () => window.innerWidth >= 1024;
async function openLog() { S.lg = null; go('log'); await loadLog(''); }
async function loadLog(day) {
  const r = await call('logGet', day);
  if (!r.ok) { toast(r.error); return; }
  lgSet(r);
}
function lgSet(r) {
  const f = {}, cur = r.cur || {};
  LG_FIELDS.forEach(k => { f[k] = cur[k] || ''; });
  const works = {};
  LG_DEPTS.forEach(d => { const w = (cur.works && cur.works[d]) || []; works[d] = Array.from({ length: LG_LINES }, (_, i) => w[i] || ''); });
  // 그날 금일작업이 아직 비었으면 TBM 작업 표로 채워 둠 (10줄까지, 저장은 직원이 [저장])
  const tbm = r.tbm || {}, auto = LG_DEPTS.every(d => !works[d].some(x => x)) && LG_DEPTS.some(d => (tbm[d] || []).length);
  if (auto) LG_DEPTS.forEach(d => { works[d] = Array.from({ length: LG_LINES }, (_, i) => (tbm[d] || [])[i] || ''); });
  S.lg = { srv: r, day: r.day, f, works, ver: r.ver, by: r.by, pdf: r.pdf, dirty: auto, busy: false };
  if (S.view === 'log') render();
  // Supabase 판: 공조기·에어커튼은 구글을 거쳐 늦게 옴(6~9초) → 일지를 먼저 보여 주고 그 칸만 나중에 채움
  if (r.acLater) r.acLater.then(ac => { r.ac = ac; delete r.acLater; const el = S.lg && S.lg.srv === r && document.querySelector('#app .lgac'); if (el) el.outerHTML = lgAc(ac); });
}
function lgLeaveOk() { return !(S.lg && S.lg.dirty) || confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?'); }
function lgCal() {
  const g = S.lg, t = g.srv.workDay;
  pickDate({ cur: g.day, home: t, max: t, homeLbl: '오늘 일지로 (' + Number(t.slice(5, 7)) + '월 ' + Number(t.slice(8, 10)) + '일)',
    fn: ds => { if (ds !== S.lg.day && lgLeaveOk()) loadLog(ds); } });
}
function lgN(v) { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return String(v == null ? '' : v).trim() !== '' && isFinite(n) ? n : null; }
function lgF(v) { return v == null ? '' : (Math.round(v * 10) / 10).toLocaleString('ko-KR'); }
function lgRate(c, p) { if (c == null || !p) return ['—', '']; const r = (c - p) / p * 100; return [(r > 0 ? '+' : '') + r.toFixed(1) + '%', r > 0 ? 'up' : r < 0 ? 'dn' : '']; }
/** 화면에서 고친 오늘 값 */
function lgCur(k) { return lgN(S.lg.f[k]); }
/** 누계 = 서버 누계 − 저장된 오늘 값 + 화면의 오늘 값 → 입력하는 동안 바로 맞음 */
function lgSum(kind, k) { const s = S.lg.srv, saved = s.vals.c[k]; return s[kind].c[k] - (saved || 0) + (lgCur(k) || 0); }
function lgBars(k) {
  const s = S.lg.srv;
  return [['일일', s.vals.p[k], lgCur(k)], ['월누계', s.month.p[k], lgSum('month', k)], ['년누계', s.year.p[k], lgSum('year', k)]].map(([l, p, c]) => {
    const mx = Math.max(p || 0, c || 0) || 1, rt = lgRate(c, p);
    return '<div class="lgbr"><span class="lgbl">' + l + '</span><div class="lgbars"><i class="b0" style="width:' + ((p || 0) / mx * 100) + '%"></i><i class="b1" style="width:' + ((c || 0) / mx * 100) + '%"></i></div>' +
      '<span class="lgbv"><span class="p">' + lgF(p) + '</span><span class="c">' + lgF(c) + '</span></span><span class="lgrt ' + rt[1] + '">' + rt[0] + '</span></div>';
  }).join('');
}
/** 공조기·에어커튼 가동 (결정 120): 온습도 앱 기록. 막대 끝 = 12시간, 미가동 = 빨간 점선, 아직 입력 안 함 = 회색 */
function lgAc(ac) {
  const head = '<div class="lgsec">공조기 · 에어커튼 가동 <small>온습도 앱 기록 자동 · 그날 장비별 가동시간 합</small></div>';
  if (!ac) return '<div class="lgac">' + head + '<div class="acerr">온습도 앱 기록을 불러오는 중…</div></div>';
  if (ac.err) return '<div class="lgac">' + head + '<div class="acerr">온습도 앱 기록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</div></div>';
  const v = x => x == null ? '—' : lgF(x);
  const blk = k => '<div class="acb" data-ac="' + k.name + '"><div class="ach"><b>' + k.name + '</b><span>입력 ' + k.entered + '/' + k.total + '대 · 미가동 ' + k.off + '대</span></div>' +
    '<div class="acs">' + [['일일', 'd'], ['월누계', 'm'], ['년누계', 'y']].map(([l, x]) => '<div><small>' + l + ' (시간)</small><em>' + v(k.c[x]) + '</em><i>전년 ' + v(k.p[x]) + '</i></div>').join('') + '</div>' +
    '<div class="acu">' + k.groups.map(([g, hs]) => '<div class="acg" style="flex:' + hs.length + '"><div class="bb">' + hs.map(x => x === 0 ? '<i class="off"></i>' : x == null ? '<i class="na"></i>' : '<i style="height:' + Math.min(100, x / 12 * 100) + '%" title="' + x + '시간"></i>').join('') + '</div><div class="gl">' + g + '</div></div>').join('') + '</div></div>';
  return '<div class="lgac">' + head + '<div class="lgac2">' + blk(ac.hvac) + blk(ac.curtain) + '</div>' +
    '<div class="aclg"><span><i style="background:#1F5FA8"></i>가동시간 (막대 끝 = 12시간)</span><span><i style="border:1px dashed #C0261A"></i>미가동</span><span><i style="background:#E3E7EC"></i>아직 입력 안 함</span></div></div>';
}
function lgSheet(edit) {
  const g = S.lg, s = g.srv, f = g.f, pv = s.prev || {};
  const inp = (k, w) => edit ? '<input class="lgin" data-k="' + k + '" value="' + h(f[k]) + '" oninput="lgIn(this)" inputmode="' + (k === '날씨' ? 'text' : 'decimal') + '"' + (w ? ' style="text-align:center"' : '') + ' aria-label="' + k + '">' : h(f[k]);
  const grade = edit ? '<select class="lgin" data-k="미세먼지등급" onchange="lgIn(this)" aria-label="미세먼지 등급">' + LG_GRADES.map(x => '<option' + (x === f['미세먼지등급'] ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>' : h(f['미세먼지등급']);
  const dd = s.day, wd = '일월화수목금토'[new Date(dd + 'T12:00:00+09:00').getDay()], pwd = '일월화수목금토'[new Date(s.prevDay + 'T12:00:00+09:00').getDay()];
  const ko = d => Number(d.slice(0, 4)) + '년 ' + Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일';
  const pE = s.vals.p['전기'], cE = lgCur('전기'), yE = s.vals.y['전기'], r1 = lgRate(cE, pE), r2 = lgRate(cE, yE);
  const work = d => '<div class="lgwork"><div class="lgsec">금일작업 · ' + d + '</div><ol>' + g.works[d].map((t, i) => '<li><span class="n">' + (i + 1) + '</span>' +
    (edit ? '<input class="lgin" maxlength="100" data-d="' + d + '" data-i="' + i + '" value="' + h(t) + '" placeholder=" " oninput="lgWork(this)" aria-label="' + d + ' ' + (i + 1) + '번">' : '<span>' + h(t) + '</span>') + '</li>').join('') + '</ol></div>';
  return '<div class="lgs">' +
    '<div class="lghead"><div><h1>에비뉴엘 종합업무일지</h1><div class="d">' + ko(dd) + ' (' + wd + ') · 잠실점 에비뉴엘 시설관리</div></div>' +
    '<table class="lgsign"><tr><th>전방책임자</th><th>기건책임자</th><th>시설부소장</th><th>시설소장</th></tr><tr>' +
    ['front', 'mech', 'vice', 'boss'].map(k => { const x = (s.signs || {})[k]; return '<td>' + (x && x.img ? '<img src="' + h(x.img) + '" alt="' + h(x.name) + ' 서명">' : '') + '</td>'; }).join('') + '</tr></table></div>' +
    '<div class="lgtop"><div><div class="lgsec">영업 · 날씨 <small>전년 = ' + ko(s.prevDay) + ' (' + pwd + ')</small></div>' +
    '<table class="lgt"><thead><tr><th style="width:96px">구분</th><th>영업시간</th><th>월누계</th><th>월영업일수</th><th>날씨</th><th>최저 (℃)</th><th>최고 (℃)</th><th>최고풍속 (m/s)</th><th>미세먼지 (㎍/㎥)</th><th>미세먼지 등급</th></tr></thead>' +
    '<tr><th class="rh">' + s.prevDay.slice(0, 4) + '</th><td class="p">' + h(pv['영업시간'] || '') + '</td><td class="p">' + lgF(s.month.p['영업시간']) + '</td><td class="p">' + Number(s.prevDay.slice(8)) + '</td><td class="p ctr">' + h(pv['날씨'] || '') + '</td><td class="p">' + h(pv['최저'] || '') + '</td><td class="p">' + h(pv['최고'] || '') + '</td><td class="p">' + (pv['최고풍속'] ? h(pv['최고풍속']) : '—') + '</td><td class="p">' + h(pv['미세먼지'] || '') + '</td><td class="p ctr">' + h(pv['미세먼지등급'] || '') + '</td></tr>' +
    '<tr><th class="rh">' + dd.slice(0, 4) + '</th><td class="c">' + inp('영업시간') + '</td><td class="c" id="lgHours">' + lgF(lgSum('month', '영업시간')) + '</td><td class="c">' + Number(dd.slice(8)) + '</td><td class="c ctr">' + inp('날씨', 1) + '</td><td class="c">' + inp('최저') + '</td><td class="c">' + inp('최고') + '</td><td class="c">' + inp('최고풍속') + '</td><td class="c">' + inp('미세먼지') + '</td><td class="c ctr">' + grade + '</td></tr></table></div>' +
    '<div><div class="lgsec">전기 일일사용량 <small>kWh</small></div><table class="lgt"><thead><tr><th>' + s.prevDay.slice(0, 4) + '</th><th>' + dd.slice(0, 4) + '</th><th>전년대비</th><th>전일대비</th></tr></thead>' +
    '<tr><td class="p">' + lgF(pE) + '</td><td class="c">' + inp('전기') + '</td><td id="lgE1" class="' + r1[1] + '">' + r1[0] + '</td><td id="lgE2" class="' + r2[1] + '">' + r2[0] + '</td></tr></table></div></div>' +
    '<div><div class="lgsec">에너지 사용량 <small>막대 = 같은 줄 안에서 전년과 비교<span class="lglg"><i style="background:#CBD2DB"></i>' + s.prevDay.slice(0, 4) + '</span><span class="lglg"><i style="background:#1F5FA8"></i>' + dd.slice(0, 4) + '</span> · 증감율 빨강 = 늘어남</small></div>' +
    '<div class="lgegrid">' + LG_METERS.map(([k, nm]) => '<div class="lgmc"><div class="lgmh"><b>' + nm + '</b>' + (edit ? inp(k) : '') + '</div><div data-bars="' + k + '">' + lgBars(k) + '</div></div>').join('') + '</div></div>' +
    lgAc(s.ac) +
    '<div class="lgworks"><div class="lgwk2">' + work('전기방재') + work('기계건축') + '</div></div>' +
    '<div class="lgfoot">- 1 / 1 -</div></div>';
}
function lgState() {
  const g = S.lg;
  return g.dirty ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : g.ver ? '<span class="nwstate">' + ICON.ok + '저장됨 · ' + h(String(g.ver).slice(5, 16).replace('-', '/')) + ' ' + h(g.by) + '</span>' : '<span class="nwstate" style="color:var(--muted)">아직 저장 안 함</span>';
}
function lgZoom() { return Math.min(1, (Math.min(window.innerWidth, 1680) - 34) / 1589); }
function renderLog() {
  const g = S.lg;
  if (!lgPc()) return topbar('서류작업 ›', '종합업무일지') + '<div class="wrap"><div class="card lgpc" style="padding:var(--sp-6)"><b>PC에서 열어 주세요</b><p style="color:var(--sub);margin:var(--sp-2) 0 0">종합업무일지는 B4 한 장 크기라 PC 화면(가로 1024px 이상)에서만 씁니다.</p></div></div>';
  if (!g) return topbar('서류작업 ›', '종합업무일지') + '<div class="wrap list"><div class="banner b-gray">불러오는 중…</div></div>';
  const md = d => Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일 (' + '일월화수목금토'[new Date(d + 'T12:00:00+09:00').getDay()] + ')';
  return topbar('서류작업 ›', '종합업무일지') + '<div class="lgwrap">' +
    '<div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)"><button class="nwdate" data-date="' + h(g.day) + '" onclick="lgCal()" aria-label="일자 바꾸기">' + ICON.cal + md(g.day) + '</button>' +
    (g.day < g.srv.workDay ? '<span style="font-size:var(--size-s);color:var(--muted)">지난 날짜입니다 · 고치면 저장할 수 있습니다</span>' : '') + '</div>' +
    '<div id="lgSheet" style="zoom:' + lgZoom() + '">' + lgSheet(true) + '</div>' +
    '<div class="nwbar" id="lgBar">' + docBar(lgDoc()) + '</div></div>';
}
function lgDoc() { const g = S.lg; return { sid: 'lgState', state: lgState(), print: 'lgPrint()', id: 'lgSave', save: 'lgSave()', busy: g.busy, pdfBusy: g.pdfBusy, pdf: g.pdf && !g.dirty ? { url: g.pdf.url, pv: { name: g.day + '_종합업무일지.pdf', sub: '서류작업 › 종합업무일지 ›' } } : null }; }
function lgDirty() { S.lg.dirty = true; const e = $('lgState'); if (e) e.innerHTML = lgState(); docSlotSet(lgDoc()); }
// 입력 중에는 다시 그리지 않음 (초점 유지) — 계산 칸만 바꿈
function lgIn(el) {
  const k = el.dataset.k; S.lg.f[k] = el.value; lgDirty();
  const s = S.lg.srv;
  document.querySelectorAll('[data-bars]').forEach(b => { const m = b.dataset.bars; if (m === k) b.innerHTML = lgBars(m); });
  if (k === '영업시간') $('lgHours').textContent = lgF(lgSum('month', '영업시간'));
  if (k === '전기') { const c = lgCur('전기'); [['lgE1', s.vals.p['전기']], ['lgE2', s.vals.y['전기']]].forEach(([id, p]) => { const r = lgRate(c, p), e = $(id); e.textContent = r[0]; e.className = r[1]; }); }
}
function lgWork(el) { S.lg.works[el.dataset.d][Number(el.dataset.i)] = el.value; lgDirty(); }
function lgPayload() {
  const g = S.lg, d = Object.assign({}, g.f, { works: {} });
  LG_DEPTS.forEach(x => { d.works[x] = g.works[x].map(t => t.trim()).filter(Boolean); });
  return d;
}
/* 인쇄 = B4 가로 한 장. 종이 틀(1587×1120)을 0.867배 → 364×257mm */
function lgPrint() {
  $('print').innerHTML = '<style>@page{size:364mm 257mm;margin:0}</style><div style="zoom:.8668">' + lgSheet(false) + '</div>';
  setTimeout(() => window.print(), 300);
}
// [저장] = 일지 저장 + PDF 만들기 한 번에 (결정 176)
async function lgSave() {
  const g = S.lg; if (g.busy) return;
  g.busy = true; g.pdfBusy = true; render();
  try {
    await loadH2p();
    const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
    const box = document.createElement('div'); box.style.cssText = 'width:1587px;background:#fff'; box.innerHTML = lgSheet(false);
    wrap.appendChild(box); document.body.appendChild(wrap);
    let uri;
    try {
      try { if (document.fonts) await document.fonts.ready; } catch (e) {}
      const keepY = window.scrollY; window.scrollTo(0, 0);
      try {
        uri = await html2pdf().set({
          margin: 0, filename: g.day + '_종합업무일지.pdf', image: { type: 'jpeg', quality: 0.92 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 1587 },   // 야간 그림이 Supabase 주소여도 PDF에 들어가게
          jsPDF: { unit: 'mm', format: [364, 257], orientation: 'landscape' }, pagebreak: { mode: ['legacy'] }
        }).from(box.firstChild).outputPdf('datauristring');
      } finally { window.scrollTo(0, keepY); }
    } finally { wrap.remove(); }
    const r = await call('logSavePdf', g.day, uri, g.dirty || !g.ver ? lgPayload() : null, g.ver || '');
    if (r.conflict) { lgSet(r); toast(r.error); return; }
    if (!r.ok) { g.busy = false; g.pdfBusy = false; render(); toast(r.error); return; }
    lgSet(r); toast(r.warn || '저장하고 PDF도 만들었습니다');
  } catch (e) { g.busy = false; g.pdfBusy = false; render(); toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
}

