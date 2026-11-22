/* ── 온습도/공조기/에어커튼 입력 (WS_온습도공조기, 결정 212·194·196) — 옛 [구역별 온습도 확인] 앱 이관. 탭 4개, 자료는 19_climate.sql ── */
const CL_TITLE = '온습도/공조기/에어커튼 입력';
const CL_TABS = [['ahu', 'AHU 환기온도 점검일지'], ['clim', '온습도'], ['hvac', '공조기 가동시간'], ['curtain', '에어커튼 가동시간']];
// 예외 색 2가지 (사용자 11-21): 층 색 · 에어커튼 OUT 주황·IN 하늘·후방 연두 — 옛 앱 style.css .hv-name[data-tone] 값 그대로
const CL_TONE = { f6: '#f1e1e6', f5: '#e8e1f5', f4: '#f6ebd3', f3: '#fbf1c2', f2: '#dce7fb', f1: '#dcefe5', b1: '#e3e8f3', b3: '#ece6df', f1out: '#fde2cc', f1in: '#d6ecfa' };
const CL_FL = { '6F': ['6층', 'f6'], '5F': ['5층', 'f5'], '4F': ['4층', 'f4'], '3F': ['3층', 'f3'], '2F': ['2층', 'f2'], '1F': ['1층', 'f1'], 'B1F': ['B1층', 'b1'] };
const CL_LV = [[74, '쾌적', '현재 공조 설정을 유지하세요.'], [78, '주의', '불쾌감이 올라가는 구간입니다. 공조기 설정을 점검하세요.'], [1e9, '불쾌', '고객 불쾌 구간입니다. 공조기 가동을 즉시 조정하세요.']];
const CL_RG = { t: [23, 26], h: [40, 60] };   // 쾌적 범위 (옛 config ranges)
const CL_ADV = { tH: '온도가 높습니다. 냉방 강화 또는 설정온도를 낮추세요.', tL: '온도가 낮습니다. 과냉방 가능성이 있어요. 설정온도를 올리면 에너지를 절감할 수 있습니다.',
  hH: '습도가 높습니다. 제습 운전 또는 환기량을 늘리세요.', hL: '습도가 낮습니다. 가습을 검토하세요.' };
const CL_KIND = { hvac: '공조기', curtain: '에어커튼' };
function clTop() { return topbar('서류작업 ›', CL_TITLE); }
function clTabs(on) {
  return '<div class="seg cltabs" role="tablist" aria-label="입력 종류">' + CL_TABS.map(t => '<button type="button" role="tab" aria-selected="' + (t[0] === on) + '" class="' + (t[0] === on ? 'on' : '') + '" onclick="clTab(\'' + t[0] + '\')">' + t[1] + '</button>').join('') + '</div>';
}
function clCur() { return S.view === 'use' ? S.use && S.use.kind : S.view; }
function clLeaveOk() { return S.view === 'ahu' ? ahuLeaveOk() : S.view === 'clim' ? climLeaveOk() : S.view === 'use' ? useLeaveOk() : true; }
function clTab(k) { if (k === clCur() || !clLeaveOk()) return; if (k === 'ahu') openAhu(); else if (k === 'clim') openClim(); else openUse(k); }
function clName(txt, tone, sub) { return '<span class="flname">' + h(txt) + (sub ? '<small>' + h(sub) + '</small>' : '') + '</span>'; }   // 층·묶음 색은 뺌 (사용자 11-21) — tone 은 안 씀
function clNav(items, on, fn) {   // items = [[이름, 색, 입력 수 글]]
  return '<div class="flnav">' + items.map((f, i) => '<button type="button" class="' + (i === on ? 'on' : '') + '" aria-pressed="' + (i === on) + '" onclick="' + fn + '(' + i + ')"><b>' + h(f[0]) + '</b><small>' + f[2] + '</small></button>').join('') + '</div>';
}
function clPager(i, items, fn, word) {
  return '<div class="nextfl"><button class="btn" onclick="' + fn + '(' + (i - 1) + ')"' + (i ? '' : ' disabled') + '>' + ICON.back + '이전 ' + word + '</button>' +
    '<button class="btn" onclick="' + fn + '(' + (i + 1) + ')"' + (i < items.length - 1 ? '' : ' disabled') + '>' + (i < items.length - 1 ? '다음 · ' + h(items[i + 1][0]) : '마지막 ' + word) + ICON.next + '</button></div>';
}
function clRepBtn(kind) { return '<button class="btn sm" onclick="openRep(\'' + kind + '\')">' + ICON.chart + '리포트</button>'; }
function clDi(t, hm) { return Math.round((0.81 * t + 0.01 * hm * (0.99 * t - 14.3) + 46.3) * 10) / 10; }
function clLv(d) { return CL_LV.find(x => d < x[0]); }
function clDiTag(t, hm) {   // 단계는 모양으로 (주의 = 테두리, 불쾌 = 남색 바탕). 옛 초록·주황·빨강은 안 씀
  if (t === '' || hm === '' || isNaN(t) || isNaN(hm)) return '<span class="ditag none">불쾌지수 —</span>';
  const d = clDi(Number(t), Number(hm)), l = clLv(d)[1];
  return '<span class="ditag' + (l === '주의' ? ' c' : l === '불쾌' ? ' d' : '') + '">불쾌지수 <b>' + d + '</b> · ' + l + '</span>';
}
function clAdvice(t, hm) {
  const a = [];
  if (t > CL_RG.t[1]) a.push(CL_ADV.tH); else if (t < CL_RG.t[0]) a.push(CL_ADV.tL);
  if (hm > CL_RG.h[1]) a.push(CL_ADV.hH); else if (hm < CL_RG.h[0]) a.push(CL_ADV.hL);
  if (!a.length) { const l = clLv(clDi(t, hm)); if (l[1] !== '쾌적') a.push(l[2]); }
  return a;
}
function clNum(x) { return String(x == null ? '' : x).replace(/[℃%\s]/g, '').replace(/,/g, '.'); }
function clBad(v, lo, hi) { return v !== '' && !(/^-?\d+(\.\d+)?$/.test(v) && Number(v) >= lo && Number(v) <= hi); }
function clMd(d) { return Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일 (' + '일월화수목금토'[new Date(d + 'T12:00:00+09:00').getDay()] + ')'; }
function clKst() { const k = new Date(Date.now() + 9 * 3600e3); return k.toISOString().slice(11, 16); }

/* ── 실외 날씨 (옛 앱과 같은 Open-Meteo, 10분 기억). 빈 칸만 채움, 고치면 그대로 (Q2) ── */
let CL_WX = null;
async function clWeather() {
  if (CL_WX && Date.now() - CL_WX.at < 600e3) return CL_WX;
  try {
    const j = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.5131&longitude=127.1043&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FSeoul', { cache: 'no-store' })).json();
    const c = j && j.current;
    if (c && typeof c.temperature_2m === 'number') CL_WX = { at: Date.now(), t: c.temperature_2m.toFixed(1), h: String(Math.round(c.relative_humidity_2m)) };
  } catch (e) { /* 인터넷이 안 되면 실외는 빈 칸 (직접 넣거나 비워도 저장됨) */ }
  return CL_WX;
}

/* ── 탭 ② 온습도: 층 한 쪽씩, 구역마다 온도·습도. 저장한 때가 측정 시각, 쌓기만 (옛 앱과 같음) ── */
async function openClim() {
  S.clim = { srv: null, v: {}, out: { t: '', h: '', auto: false }, fi: S.climFi || 0, busy: false, err: '' };
  go('clim');
  const r = await call('climateGet'); if (!r.ok) { toast(r.error); return; }
  S.clim.srv = r; if (S.view === 'clim') render();
  const w = await clWeather(), g = S.clim;
  if (w && g && g.out.t === '' && g.out.h === '') { g.out = { t: w.t, h: w.h, auto: true }; if (S.view === 'clim') render(); }
}
function climFloors() {
  const fl = [];
  (S.clim.srv.zones || []).forEach(([f, z]) => { let x = fl.find(a => a.f === f); if (!x) fl.push(x = { f, zs: [] }); x.zs.push(z); });
  return fl;
}
function climLast(f, z) { const a = S.clim.srv.recs.filter(r => r.floor === f && r.zone === z); return a[a.length - 1]; }
function climBase(k) { const p = k.split('|'), l = climLast(p[0], p[1]); return l ? { t: String(l.t), h: String(l.h) } : { t: '', h: '' }; }   // 오늘 마지막 저장값 (결정 226)
function climNew(k) { const v = S.clim.v[k], b = climBase(k); return !!v && (v.t !== '' || v.h !== '') && (v.t !== b.t || v.h !== b.h); }   // 고쳐서 새로 저장할 구역
function climDirty() { return Object.keys(S.clim.v).some(climNew); }
function climLeaveOk() { return !(S.clim && S.clim.srv && climDirty()) || confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?'); }
function climGo(i) { const fl = climFloors(); S.clim.fi = S.climFi = Math.max(0, Math.min(fl.length - 1, i)); render(); window.scrollTo(0, 0); }
function climVal(k) { return S.clim.v[k] || climBase(k); }
function climIn(el) {
  const g = S.clim, k = el.dataset.z, f = el.dataset.f, val = clNum(el.value); g.err = '';
  if (k) { (g.v[k] = g.v[k] || climBase(k))[f] = val; el.classList.remove('saved'); }
  else { g.out[f] = val; g.out.auto = false; }
  el.classList.toggle('bad', f === 't' ? clBad(val, k ? -10 : -30, 50) : clBad(val, 0, 100));
  el.classList.toggle('empty', !val);
  if (k) { const v = g.v[k], e = $('di-' + k.replace('|', '-')); if (e) e.innerHTML = clDiTag(v.t, v.h); const a = $('climAdv'); if (a) a.outerHTML = climAdvBox(); }
  const st = $('climState'); if (st) st.innerHTML = climState();
}
function climBox(attrs, val, unit, cls) { return '<label class="hvin"><input class="inp' + (val === '' ? ' empty' : '') + (cls || '') + '" inputmode="decimal" maxlength="6" value="' + h(val) + '" ' + attrs + ' oninput="climIn(this)" onchange="this.value=clNum(this.value)"><span>' + unit + '</span></label>'; }
function climAdvBox() {
  const g = S.clim, f = climFloors()[g.fi], out = [];
  f.zs.forEach(z => { const v = climVal(f.f + '|' + z); if (v.t !== '' && v.h !== '' && !clBad(v.t, -10, 50) && !clBad(v.h, 0, 100)) { const a = clAdvice(Number(v.t), Number(v.h)); if (a.length) out.push(z + ': ' + a.join(' · ')); } });
  return '<div id="climAdv"' + (out.length ? ' class="adv"' : '') + '>' + out.map(h).join('<br>') + '</div>';
}
function climState() {
  const g = S.clim;
  if (g.err) return '<span class="nwstate dirty"><i class="dot"></i>저장 안 함<small class="hverr"> · ' + h(g.err) + '</small></span>';
  return climDirty() ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : '<span class="nwstate" style="color:var(--muted)">' + (g.srv.recs.length ? '오늘 ' + g.srv.recs.length + '건 저장됨' : '오늘 기록 없음') + '</span>';
}
function renderClim() {
  const g = S.clim;
  if (!g || !g.srv) return clTop() + '<div class="wrap list">' + clTabs('clim') + '<div class="banner b-gray">불러오는 중…</div></div>';
  const fl = climFloors(), pc = lgPc(), done = f => f.zs.filter(z => climLast(f.f, z)).length + '/' + f.zs.length;
  const zoneRow = (f, z) => {
    const k = f.f + '|' + z, v = climVal(k), sv = !g.v[k] && climLast(f.f, z) ? ' saved' : '';   // 저장값 그대로면 회색 (결정 226)
    return '<div class="zr"><b>' + z + '</b>' + climBox('data-z="' + k + '" data-f="t" aria-label="' + CL_FL[f.f][0] + ' ' + z + ' 실내온도"', v.t, '℃', (clBad(v.t, -10, 50) ? ' bad' : '') + sv) +
      climBox('data-z="' + k + '" data-f="h" aria-label="' + CL_FL[f.f][0] + ' ' + z + ' 실내습도"', v.h, '%', (clBad(v.h, 0, 100) ? ' bad' : '') + sv) +
      '<div class="sub"><span></span><span id="di-' + k.replace('|', '-') + '">' + clDiTag(v.t, v.h) + '</span></div></div>';
  };
  const head = '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>매장 온도 · 습도</b>' + clRepBtn('climate') + '</div>' +
    '<div class="hvmeta">측정 시각은 저장한 때 (지금 ' + clKst() + ') · 하루 여러 번 넣어도 모두 남음</div>' +
    '<div class="hvw">' + [['t', '실외온도', '℃'], ['h', '실외습도', '%']].map(x => '<label>' + x[1] + climBox('data-f="' + x[0] + '" aria-label="' + x[1] + '"', g.out[x[0]], x[2], (x[0] === 't' ? clBad(g.out.t, -30, 50) : clBad(g.out.h, 0, 100)) ? ' bad' : '') + '</label>').join('') + '</div>' +
    '<div class="hvmeta">실외는 날씨에서 자동 (10분마다, 고칠 수 있음)' + (g.out.auto ? '' : '') + '</div>' +
    (pc ? '' : clNav(fl.map(f => [CL_FL[f.f][0], CL_FL[f.f][1], done(f)]), g.fi, 'climGo')) + '</div>';
  const bar = '<div class="nwbar"><span id="climState">' + climState() + '</span><div class="dslot"><button class="btn pri" id="climSave" onclick="climSave()"' + (g.busy ? ' disabled' : '') + '>' + (g.busy ? '<span class="spin"></span> 저장 중…' : '저장') + '</button></div></div>';
  if (pc) return clTop() + '<div class="lgwrap">' + clTabs('clim') + head +
    '<table class="cltbl"><thead><tr><th style="width:80px">층</th><th>1구역 · 온도 / 습도</th><th>2구역 · 온도 / 습도</th><th>3구역 · 온도 / 습도</th></tr></thead><tbody>' +
    fl.map(f => '<tr><td class="ctr">' + clName(CL_FL[f.f][0], CL_FL[f.f][1]) + '</td>' + ['1구역', '2구역', '3구역'].map(z => f.zs.indexOf(z) === -1 ? '<td class="ctr na">—</td>' : '<td>' + zoneRow(f, z) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>' + clLegend() + bar + '</div>';
  const f = fl[g.fi];
  return clTop() + '<div class="wrap list">' + clTabs('clim') + head +
    '<div class="flhd">' + clName(CL_FL[f.f][0], CL_FL[f.f][1]) + '<small>층 ' + (g.fi + 1) + '/' + fl.length + '</small></div>' +
    '<div class="hvlist"><div class="secl"><span>실내 (지금)</span><span>온도 ℃ · 습도 %</span></div>' + f.zs.map(z => zoneRow(f, z)).join('') + climAdvBox() + '</div>' +
    clPager(g.fi, fl.map(x => [CL_FL[x.f][0]]), 'climGo', '층') + clLegend() + bar + '</div>';
}
function clLegend() { return '<p class="clnote">불쾌지수 = 0.81T + 0.01H(0.99T−14.3) + 46.3 · 쾌적 74 미만 · 주의 78 미만 · 불쾌 78 이상 · 쾌적 범위 23~26℃, 40~60%</p>'; }
async function climSave() {
  const g = S.clim; if (g.busy) return;
  const rows = [], fl = climFloors();
  let bad = '';
  fl.forEach(f => f.zs.forEach(z => {
    const v = climVal(f.f + '|' + z); if (!climNew(f.f + '|' + z)) return;   // 고친 구역만 (저장값 그대로는 다시 안 보냄)
    const nm = CL_FL[f.f][0] + ' ' + z;
    if (!bad && (v.t === '' || v.h === '')) bad = nm + ': 온도와 습도를 둘 다 넣어 주세요';
    if (!bad && clBad(v.t, -10, 50)) bad = nm + ' 온도는 -10 ~ 50 숫자로 넣어 주세요';
    if (!bad && clBad(v.h, 0, 100)) bad = nm + ' 습도는 0 ~ 100 숫자로 넣어 주세요';
    if (!bad) rows.push({ floor: f.f, zone: z, t: v.t, h: v.h });
  }));
  if (!bad && clBad(g.out.t, -30, 50)) bad = '실외온도는 -30 ~ 50 숫자로 넣어 주세요';
  if (!bad && clBad(g.out.h, 0, 100)) bad = '실외습도는 0 ~ 100 숫자로 넣어 주세요';
  if (!bad && !rows.length) bad = '온도·습도를 넣은 구역이 없습니다';
  if (bad) { g.err = bad; render(); toast(bad); return; }
  g.busy = true; render();
  try {
    const r = await call('climateAdd', rows, { t: g.out.t, h: g.out.h });
    g.busy = false;
    if (!r.ok) { g.err = r.error; render(); toast(r.error); return; }
    g.srv = r; g.v = {}; g.err = ''; render(); toast(r.queued ? OFFMSG : rows.length + '곳 저장했습니다');
  } catch (e) { g.busy = false; g.err = '서버에 닿지 않았습니다. 다시 눌러 주세요'; render(); }
}

/* ── 탭 ③④ 공조기·에어커튼 가동시간: 시각 = 오전/오후·시·10분. 미가동 = 0시간, 빈 칸 = 통계 제외 (옛 앱 규칙) ── */
function useParts(m) { if (m == null || m === '') return ['', '', '']; if (m >= 1440) return ['am', '12', '0']; const h24 = Math.floor(m / 60); return [h24 < 12 ? 'am' : 'pm', String(h24 % 12 || 12), String(m % 60)]; }
function useMin(ap, hh, mm) { if (!ap || !hh || mm === '') return null; if (hh === '24') return 1440 + Number(mm); return (Number(hh) % 12 + (ap === 'pm' ? 12 : 0)) * 60 + Number(mm); }
function useDur(m) { return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') + '분' : ''); }
function useHm(m) { const p = useParts(m); return (p[0] === 'am' ? '오전 ' : '오후 ') + p[1] + ':' + String(p[2]).padStart(2, '0'); }
async function openUse(kind, day) {
  S.use = { kind, srv: null, v: {}, ch: {}, pg: 0, busy: false, err: '' };
  go('use');
  await loadUse(day || '');
}
async function loadUse(day) {
  const r = await call('usageGet', S.use.kind, day); if (!r.ok) { toast(r.error); return; }
  useSet(r);
}
function useSet(r) {
  const g = S.use; g.srv = r; g.day = r.day; g.v = {}; g.ch = {}; g.err = '';
  r.units.forEach(u => { const x = r.recs[u.u]; g.v[u.u] = x ? { s: x.s, e: x.e, off: !!x.off, saved: true } : { s: u.s, e: r.wkend ? u.ew : u.e, off: false, saved: false }; });
  if (S.view === 'use') render();
}
function useGroups() { const out = []; S.use.srv.units.forEach(u => { let x = out.find(a => a.g === u.grp); if (!x) out.push(x = { g: u.grp, tone: u.tone, us: [] }); x.us.push(u); }); return out; }
function useDirty() { return Object.keys(S.use.ch).length > 0; }
function useLeaveOk() { return !(S.use && S.use.srv && useDirty()) || confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?'); }
// 휴대폰 층(묶음) 버튼 = 그 칸으로 이동 (한 화면에 차례로, 결정 200)
function useJump(i) { S.use.pg = i; const e = $('ug-' + i); if (e) e.scrollIntoView({ behavior: 'smooth' }); document.querySelectorAll('.flnav button').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', j === i); }); }
function useCal() {
  const g = S.use, t = g.srv.workDay;
  pickDate({ cur: g.day, home: t, max: t, homeLbl: '오늘로 (' + Number(t.slice(5, 7)) + '월 ' + Number(t.slice(8, 10)) + '일)', fn: ds => { if (ds !== g.day && useLeaveOk()) loadUse(ds); } });
}
// 카드 하나의 값 → { s, e, off, err } (err 가 있으면 저장 안 함)
function useParse(v) {
  if (v.off) return { s: null, e: null, off: true };
  if (v.s == null && v.e == null) return { s: null, e: null, off: false, empty: true };
  if (v.s == null || v.e == null) return { err: '시작과 종료의 시·분을 모두 고르세요' };
  let e = v.e; if (e <= v.s) { if (e === 0) e = 1440; else return { err: '종료가 시작보다 빠릅니다' }; }
  return { s: v.s, e, off: false };
}
function useSel(u, f, val, nm, part) {
  const p = val == null && part ? ['', part[0], part[1]] : f === 'e' && val >= 1440 ? ['pm', '24', String(val - 1440)] : useParts(val), ap = p[0] || (f === 's' ? 'am' : 'pm');
  const o = (k, opts) => '<select data-u="' + h(u.u) + '" data-f="' + f + k + '" aria-label="' + h(nm) + (k === 'h' ? ' 시' : ' 분') + '" onchange="useIn(this)">' + opts.map(x => '<option value="' + x[0] + '"' + (String(x[0]) === String(p[k === 'h' ? 1 : 2]) ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>';
  const hrs = [['', '시']].concat(Array.from({ length: 12 }, (_, i) => [String(i + 1), (i + 1) + '시']), f === 'e' ? [['24', '12시(자정)']] : []), mins = [['', '분']].concat([0, 10, 20, 30, 40, 50].map(m => [String(m), String(m).padStart(2, '0') + '분']));
  return '<span class="ap" data-f="' + f + 'a" data-ap="' + ap + '">' + (ap === 'am' ? '오전' : '오후') + '</span>' + o('h', hrs) + o('m', mins);   // 시작 오전 · 종료 오후 고정 (결정 204)
}
function useCard(u) {
  const g = S.use, v = g.v[u.u], p = useParse(v), nm = (u.sub ? u.sub + ' ' : '') + u.name;
  // 공조기는 가동시간 글자 없음(리포트에서 봄) · 「기본 시각」 글자 없음 (결정 206)
  const foot = p.err ? '<span class="hverr">' + p.err + '</span>' : g.kind === 'hvac' ? '' : p.off ? '미가동 · <b>0시간</b>' : p.empty ? '입력 없음' : '가동 <b>' + useDur(p.e - p.s) + '</b>';
  const st = g.ch[u.u] ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : v.saved ? '<span class="nwstate">' + ICON.ok + '저장됨</span>' : '';
  return '<div class="uc' + (u.name.length > 6 ? ' long' : '') + (v.saved && !g.ch[u.u] && !v.off ? ' saved' : '') + (v.off ? ' isoff' : '') + (p.err ? ' bad' : '') + '" data-card="' + h(u.u) + '"><div class="h">' + clName(u.name, u.tone, u.sub) +
    '<label class="off"><input type="checkbox" data-u="' + h(u.u) + '" data-f="off"' + (v.off ? ' checked' : '') + ' onchange="useIn(this)" aria-label="' + h(nm) + ' 미가동">미가동</label></div>' +
    '<div class="r"><span>시작</span>' + useSel(u, 's', v.s, nm + ' 시작', v.sp) + '</div><div class="r"><span>종료</span>' + useSel(u, 'e', v.e, nm + ' 종료', v.ep) + '</div>' +
    '<div class="f"><span>' + foot + '</span>' + st + '</div></div>';
}
function useIn(el) {
  const g = S.use, u = el.dataset.u, f = el.dataset.f, v = g.v[u];
  if (f === 'off') v.off = el.checked;
  else {
    const c = el.closest('.uc'), q = k => c.querySelector('[data-f="' + f[0] + k + '"]').value;
    v[f[0] + 'p'] = [q('h'), q('m')];
    v[f[0]] = useMin(c.querySelector('[data-f="' + f[0] + 'a"]').dataset.ap, q('h'), q('m'));
  }
  g.ch[u] = 1; g.err = '';
  const unit = g.srv.units.find(x => x.u === u), c = document.querySelector('[data-card="' + CSS.escape(u) + '"]');
  if (c) c.outerHTML = useCard(unit);
  const st = $('useState'); if (st) st.innerHTML = useState();
}
function useState() {
  const g = S.use, n = Object.keys(g.ch).length;
  if (g.err) return '<span class="nwstate dirty"><i class="dot"></i>저장 안 함<small class="hverr"> · ' + h(g.err) + '</small></span>';
  return n ? '<span class="nwstate dirty"><i class="dot"></i>' + n + '대 저장 안 함</span>' : '<span class="nwstate" style="color:var(--muted)">' + useMiss() + '</span>';
}
function useMiss() { const g = S.use, n = g.srv.units.filter(u => !(g.srv.recs[u.u] && (g.srv.recs[u.u].off || g.srv.recs[u.u].s != null))).length; return n ? '미입력 ' + n + '대' : '모두 입력함'; }
function renderUse() {
  const g = S.use, kn = CL_KIND[g && g.kind] || '';
  if (!g || !g.srv) return clTop() + '<div class="wrap list">' + clTabs(g ? g.kind : 'hvac') + '<div class="banner b-gray">불러오는 중…</div></div>';
  const gs = useGroups(), pc = lgPc(), r = g.srv, zoned = g.kind === 'hvac', Z = ['1구역', '2구역', '3구역'];
  const hm = u => useHm(u.s) + ' ~ ' + useHm(r.wkend ? u.ew : u.e), n0 = {};
  gs.forEach(x => { const k = hm(x.us[0]); n0[k] = (n0[k] || 0) + 1; });
  const d0 = Object.keys(n0).sort((a, b) => n0[b] - n0[a])[0] || '';   // 가장 많은 층·묶음의 기본 시각
  const ex = gs.filter(x => hm(x.us[0]) !== d0).map(x => x.g + ' ' + hm(x.us[0])).join(' · ');   // 기본과 다른 층·묶음
  const cnt = x => x.us.filter(u => r.recs[u.u] && (r.recs[u.u].off || r.recs[u.u].s != null)).length + '/' + x.us.length;
  const past = g.day < r.workDay ? '<br>지난 날짜입니다 · 31일 안은 고칠 수 있습니다' : '';
  const meta = useMiss() + ' · 기본 ' + d0 + (ex ? ' · ' + ex : '') + past;
  const date = '<button class="nwdate" data-date="' + h(g.day) + '" onclick="useCal()" aria-label="일자 바꾸기">' + ICON.cal + clMd(g.day) + '</button>';
  const btns = '<div class="hdbtns"><button class="btn sm" id="uhrBtn" onclick="openUhr(\'' + g.kind + '\')">' + ICON.clock + '가동시간 설정</button>' + clRepBtn(g.kind) + '</div>';
  const bar = '<div class="nwbar"><span id="useState">' + useState() + '</span><div class="dslot"><button class="btn pri" id="useSave" onclick="useSave()"' + (g.busy ? ' disabled' : '') + '>' + (g.busy ? '<span class="spin"></span> 저장 중…' : '저장') + '</button></div></div>';
  const note = '<p class="clnote">시각은 오전/오후 · 시 · 10분 단위. 미가동 체크 = 0시간, 빈 칸 = 통계에서 뺌. [저장]은 고친 장비와 화면의 아직 저장 안 한 장비(기본 시각)를 함께 저장합니다.</p>';
  if (pc) {
    const head = '<div class="card" style="padding:var(--sp-2) var(--sp-4)"><div class="uchd"><b>' + kn + ' 가동시간</b><span class="hvmeta">' + meta + '</span>' + date + btns + '</div></div>';
    const rows = gs.map(x => {
      const nm = '<td class="ctr">' + clName(x.g) + '</td>';
      if (!zoned) return '<tr>' + nm + '<td><div class="ucg ucg3">' + x.us.map(useCard).join('') + '</div></td></tr>';
      const noz = x.us.every(u => !u.zone);   // 구역 없는 B3층: 구역 칸에 차례로 (다른 층 칸과 같은 크기)
      return '<tr>' + nm + Z.map((z, i) => '<td><div class="ucg">' + x.us.filter((u, j) => noz ? j % 3 === i : u.zone === z).map(useCard).join('') + '</div></td>').join('') + '</tr>';
    }).join('');
    return clTop() + '<div class="lgwrap">' + clTabs(g.kind) + head + '<table class="cltbl ucpc' + (zoned ? ' zoned' : '') + '"><thead><tr><th style="width:' + (zoned ? 58 : 72) + 'px">' + (zoned ? '층' : '묶음') + '</th>' + (zoned ? Z.map(z => '<th>' + z + '</th>').join('') : '<th>' + kn + '</th>') + '</tr></thead><tbody>' + rows + '</tbody></table>' + note + bar + '</div>';
  }
  const head = '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>' + kn + ' 가동시간</b>' + date + '</div>' +
    '<div class="hdrow"><span class="hvmeta" style="margin:0">' + meta + '</span>' + btns + '</div>' + clNav(gs.map(x => [x.g, x.tone, cnt(x)]), g.pg, 'useJump') + '</div>';
  // 휴대폰: 층 → 1·2·3구역 차례로 한 화면에 (결정 200)
  const secs = gs.map((x, i) => {
    const parts = !zoned || x.us.every(u => !u.zone) ? [['', x.us]] : Z.map(z => [z, x.us.filter(u => u.zone === z)]).filter(a => a[1].length);
    return '<div class="flsec" id="ug-' + i + '"><div class="flhd">' + clName(x.g) + '<small>' + x.us.length + '대</small></div>' +
      parts.map(p => (p[0] ? '<div class="ucz">' + p[0] + '</div>' : '') + '<div class="hvlist">' + p[1].map(useCard).join('') + '</div>').join('') + '</div>';
  }).join('');
  return clTop() + '<div class="wrap list">' + clTabs(g.kind) + head + secs + note + bar + '</div>';
}
async function useSave() {
  const g = S.use; if (g.busy) return;
  const rows = [];
  let bad = null;
  g.srv.units.forEach(u => {
    const v = g.v[u.u]; if (!g.ch[u.u] && v.saved) return;
    const p = useParse(v);
    if (p.err) { if (!bad) bad = { u, msg: (u.sub ? u.sub + ' ' : '') + u.name + ': ' + p.err }; return; }
    if (p.empty && !v.saved) return;
    rows.push({ u: u.u, s: p.s, e: p.e, off: p.off });
  });
  if (bad) { g.err = bad.msg; render(); toast(bad.msg); const c = document.querySelector('[data-card="' + CSS.escape(bad.u.u) + '"]'); if (c) c.scrollIntoView({ block: 'center' }); return; }
  if (!rows.length) { toast('저장할 변경 내용이 없습니다'); return; }
  g.busy = true; render();
  try {
    const r = await call('usageSave', g.kind, g.day, rows);
    g.busy = false;
    if (!r.ok) { g.err = r.error; render(); toast(r.error); return; }
    useSet(r); toast(r.queued ? OFFMSG : rows.length + '대 저장했습니다 (' + clMd(g.day) + ')');
  } catch (e) { g.busy = false; g.err = '서버에 닿지 않았습니다. 다시 눌러 주세요'; render(); }
}

/* ── 리포트 (각 탭의 [리포트]): 공조기·에어커튼 = 옛 앱 사용시간 리포트 + 전력(kWh)·예상 요금 (결정 194), 온습도 = 옛 실내 온습도 리포트 ── */
const REP_PER = [['30', '30일', 30], ['90', '90일', 90], ['365', '1년', 365], ['all', '전체', 0]];
let CHARTJS = null;
function loadChart() {
  if (window.Chart) return Promise.resolve();
  return CHARTJS || (CHARTJS = new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    sc.onload = ok; sc.onerror = () => { CHARTJS = null; no(new Error('그래프 도구를 불러오지 못했습니다')); };
    document.head.appendChild(sc);
  }));
}
function repDay(d, k) { return new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10); }
async function openRep(kind) {
  const from = S.view === 'use' ? 'use' : S.view;
  if (!clLeaveOk()) return;
  S.rep = { kind, per: (S.rep && S.rep.per) || '30', srv: null, from, fromKind: S.use && S.use.kind };
  go('rep'); await loadRep();
}
async function loadRep() {
  const p = S.rep, wd = (S.docs && S.docs.day) || new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), per = REP_PER.find(x => x[0] === p.per);
  let from = per[2] ? repDay(wd, -(per[2] - 1)) : '';
  if (p.kind !== 'climate' && from) { const pm = repDay(wd.slice(0, 8) + '01', -1).slice(0, 8) + '01'; if (pm < from) from = pm; }   // 지난달 대비용
  p.srv = null; p.busy = true; if (S.view === 'rep') render();
  const r = p.kind === 'climate' ? await call('climateReport', from, wd) : await call('usageReport', p.kind, from, wd);
  p.busy = false; if (!r.ok) { toast(r.error); return; }
  p.srv = r; p.day = wd; p.from0 = per[2] ? repDay(wd, -(per[2] - 1)) : r.from;
  if (S.view === 'rep') { render(); repChart(); }
}
function repBack() { const p = S.rep; if (p.from === 'use') openUse(p.fromKind); else if (p.from === 'clim') openClim(); else go(p.from || 'docs'); }
function repPer(k) { S.rep.per = k; loadRep(); }
function repKpi(l, v, sub) { return '<div class="kpi"><span>' + l + '</span><strong>' + v + '</strong>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
function repArrow(c, p, unit, dg) { if (c == null || p == null) return '—'; const d = c - p, t = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d).toLocaleString('ko-KR', { minimumFractionDigits: dg == null ? 1 : dg, maximumFractionDigits: dg == null ? 1 : dg }) + unit; return '<span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + t + '</span>'; }
// 기간 안 장비별 하루 분 → 묶음 계산 (옛 computeStats 와 같은 식)
function repStats() {
  const p = S.rep, r = p.srv, kwOf = {}, price = r.price == null ? null : Number(r.price);
  r.units.forEach(u => { kwOf[u.u] = u.kw == null ? null : Number(u.kw); });
  const day = {}, per = {}, from = p.from0, to = p.day, last3 = [-4, -3, -2, -1].map(k => repDay(to, k));
  r.rows.forEach(([d, u, m]) => {
    if (!(u in kwOf)) return;   // 옛 3·37·38번은 통계에서 뺌
    const x = day[d] = day[d] || { n: 0, min: 0, kwh: 0 }; x.n++; x.min += m; if (kwOf[u] != null) x.kwh += m / 60 * kwOf[u];
    const q = per[u] = per[u] || { days: 0, min: 0, cmp: [null, null, null, null] };
    if (d >= from && d <= to) { q.days++; q.min += m; }
    const i = last3.indexOf(d); if (i !== -1) q.cmp[i] = m;
  });
  const sum = (a, b, f) => Object.keys(day).filter(d => d >= a && d <= b).reduce((s, d) => s + day[d][f], 0);
  const ms = to.slice(0, 8) + '01', pms = repDay(ms, -1).slice(0, 8) + '01', pTo = pms.slice(0, 8) + String(Math.min(Number(to.slice(8)), Number(repDay(ms, -1).slice(8)))).padStart(2, '0');
  return { day, per, last3, price, kwOf, noKw: r.units.filter(u => u.kw == null).length, sum, ms, pms, pTo };
}
function renderRep() {
  const p = S.rep, kn = p.kind === 'climate' ? '온습도' : CL_KIND[p.kind];
  const seg = '<div class="seg" role="group" aria-label="기간" style="max-width:360px">' + REP_PER.map(x => '<button type="button" class="' + (x[0] === p.per ? 'on' : '') + '" aria-pressed="' + (x[0] === p.per) + '" onclick="repPer(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>';
  const bar = '<div class="nwbar"><span></span>' + (p.srv ? '<button class="btn" onclick="repCsv()">' + ICON.dl + 'CSV</button><button class="btn" onclick="repPrint()">' + ICON.print + '인쇄</button>' : '') + '</div>';
  const top = topbar(CL_TITLE + ' ›', kn + ' 리포트');
  if (!p.srv) return top + '<div class="wrap list">' + seg + '<div class="banner b-gray">불러오는 중…</div>' + bar + '</div>';
  return top + '<div class="wrap list clrep">' + seg + '<div id="repBody">' + (p.kind === 'climate' ? repClimHtml() : repUseHtml()) + '</div>' + bar + '</div>';
}
function repUseHtml() {
  const p = S.rep, r = p.srv, st = repStats(), kn = CL_KIND[p.kind], to = p.day, tot = r.units.length, H = m => (m / 60).toFixed(1);
  const today = st.day[to], miss = tot - (today ? today.n : 0), pd = st.day;
  const inP = Object.keys(pd).filter(d => d >= p.from0 && d <= to), nRec = inP.reduce((s, d) => s + pd[d].n, 0), tMin = inP.reduce((s, d) => s + pd[d].min, 0);
  const won = k => st.price == null ? null : k * st.price, fW = x => x == null ? '—' : Math.round(x).toLocaleString('ko-KR') + '원', fK = x => x.toFixed(1) + 'kWh';
  const mMin = st.sum(st.ms, to, 'min'), pmMin = st.sum(st.pms, st.pTo, 'min'), mK = st.sum(st.ms, to, 'kwh'), pmK = st.sum(st.pms, st.pTo, 'kwh');
  let html = '<h3>요약 <small>' + (p.per === 'all' ? r.from : p.from0) + ' ~ ' + to + '</small></h3><div class="kpis">' +
    repKpi('오늘 미입력', miss ? miss + '대 / ' + tot + '대' : '전체 입력 완료') + repKpi('오늘 가동시간 합계', today ? H(today.min) + '시간' : '—') +
    repKpi('1대 1일 평균', nRec ? H(tMin / nRec) + '시간' : '—') + repKpi(REP_PER.find(x => x[0] === p.per)[1] + ' 합계', H(tMin) + '시간') + repKpi('기록된 날', inP.length + '일') + '</div>';
  html += '<h3>전력 · 예상 요금 <small>' + (st.price == null ? '단가 미입력' : '단가 ' + st.price + '원/kWh') + (st.noKw ? ' · kW 미입력 ' + st.noKw + '대 (환산에서 뺌)' : '') + '</small></h3><div class="kpis">' +
    repKpi('오늘', today ? fK(today.kwh) : '—', today ? fW(won(today.kwh)) : '') + repKpi('이달 (' + Number(st.ms.slice(5, 7)) + '월 1일~)', fK(mK), fW(won(mK))) +
    repKpi('지난달 같은 날까지', fK(pmK), fW(won(pmK))) +
    repKpi('지난달 대비', repArrow(mMin / 60, pmMin / 60, '시간'), repArrow(mK, pmK, 'kWh') + (st.price == null ? '' : ' · ' + repArrow(won(mK), won(pmK), '원', 0))) + '</div>' +
    '<p class="clnote">예상 요금 = kWh × 단가 (기본요금·누진·부가세 없음). kW·단가는 환경설정 › 장비 전력·단가에서 넣습니다.</p>';
  const rows = r.units.map(u => ({ u, q: st.per[u.u] || { days: 0, min: 0, cmp: [null, null, null, null] } }));
  const dl = st.last3.slice(1), tc = [0, 1, 2, 3].map(i => { const v = rows.reduce((s, x) => x.q.cmp[i] == null ? s : (s || 0) + x.q.cmp[i], null); return v; });
  const cmp = (a, i) => { const v = a[i], pv = a[i - 1]; if (v == null) return '—'; const t = H(v) + 'h'; return pv != null && v > pv ? '<span class="up">▲ ' + t + '</span>' : pv != null && v < pv ? '<span class="down">▼ ' + t + '</span>' : t; };
  html += '<h3>' + kn + ' 사용시간 <small>오늘 뺀 최근 3일 · ▲ 전날보다 길어짐 · ▼ 짧아짐 · — 미입력</small></h3><div class="scroll"><table class="cltbl rep"><thead><tr><th class="l">' + kn + '</th><th>입력일</th><th>1일 평균</th><th>기간 합계</th><th>kW</th>' +
    dl.map((d, i) => '<th>' + (3 - i) + '일 전<br><small>' + Number(d.slice(5, 7)) + '/' + Number(d.slice(8)) + '</small></th>').join('') + '</tr></thead><tbody>' +
    '<tr class="tot"><td class="l">전체 합계</td><td>' + inP.length + '</td><td>' + (nRec ? H(tMin / nRec) + 'h' : '—') + '</td><td>' + H(tMin) + 'h</td><td></td>' + [1, 2, 3].map(i => '<td>' + cmp(tc, i) + '</td>').join('') + '</tr>' +
    rows.map(x => '<tr' + (x.q.days ? '' : ' class="dim"') + '><td class="l">' + h((x.u.sub ? x.u.sub + ' ' : '') + x.u.name) + '</td><td>' + x.q.days + '</td><td>' + (x.q.days ? useDur(Math.round(x.q.min / x.q.days)) : '—') + '</td><td>' + (x.q.days ? H(x.q.min) + 'h' : '—') + '</td><td>' + (x.u.kw == null ? '<span class="clmuted">—</span>' : h(x.u.kw)) + '</td>' +
      [1, 2, 3].map(i => '<td>' + cmp(x.q.cmp, i) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  html += '<h3>일별 사용시간 추이</h3><div class="repchart"><canvas id="repCv" height="300"></canvas></div>';
  let dr = ''; for (let i = 0; i < 31; i++) { const d = repDay(to, -i), a = pd[d]; dr += '<tr' + (a ? '' : ' class="dim"') + '><td class="l">' + d + '</td><td>' + (a ? a.n + ' / ' + tot : '미입력') + '</td><td>' + (a ? H(a.min) + 'h' : '—') + '</td><td>' + (a ? H(a.min / a.n) + 'h' : '—') + '</td><td>' + (a ? fK(a.kwh) : '—') + '</td><td>' + (a ? fW(won(a.kwh)) : '—') + '</td></tr>'; }
  html += '<h3>일일 기록 <small>최근 31일</small></h3><div class="scroll"><table class="cltbl rep"><thead><tr><th class="l">날짜</th><th>입력 대수</th><th>합계</th><th>1대 평균</th><th>전력량</th><th>예상 요금</th></tr></thead><tbody>' + dr + '</tbody></table></div>' +
    '<p class="clnote">미가동은 0시간으로 계산합니다. 기록은 기간 제한 없이 보관됩니다 (첫 기록 ' + (r.first || '—') + ').</p>';
  return html;
}
function repClimHtml() {
  const p = S.rep, r = p.srv, rows = r.rows.filter(x => x[0].slice(0, 10) >= p.from0);
  if (!rows.length) return '<p class="clnote">이 기간에 저장된 기록이 없습니다</p>';
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length, T = rows.map(x => Number(x[3])), Hm = rows.map(x => Number(x[4])), D = rows.map(x => Number(x[5]));
  const cnt = [0, 0, 0]; D.forEach(d => { cnt[CL_LV.indexOf(clLv(d))]++; });
  const wo = rows.filter(x => x[6] != null), dT = wo.length ? avg(wo.map(x => x[3] - x[6])) : null;
  let html = '<h3>요약 <small>' + (p.per === 'all' ? r.from : p.from0) + ' ~ ' + p.day + '</small></h3><div class="kpis">' +
    repKpi('측정 건수', rows.length + '건') + repKpi('평균 온도', avg(T).toFixed(1) + '℃') + repKpi('평균 습도', avg(Hm).toFixed(0) + '%') + repKpi('평균 불쾌지수', avg(D).toFixed(1)) +
    repKpi('최고 / 최저 온도', Math.max(...T).toFixed(1) + ' / ' + Math.min(...T).toFixed(1) + '℃') + repKpi('쾌적 비율', Math.round(cnt[0] / rows.length * 100) + '%', '주의 ' + cnt[1] + '건 · 불쾌 ' + cnt[2] + '건') +
    repKpi('실내외 평균 온도차', dT == null ? '—' : (dT > 0 ? '+' : '') + dT.toFixed(1) + '℃') + '</div>';
  const fl = []; r.zones.forEach(([f, z]) => { let x = fl.find(a => a.f === f); if (!x) fl.push(x = { f, zs: [] }); x.zs.push(z); });
  const adv = [];
  html += '<h3>층·구역별 평균 불쾌지수</h3><div class="scroll"><table class="cltbl rep"><thead><tr><th class="l">층</th><th>1구역</th><th>2구역</th><th>3구역</th></tr></thead><tbody>' +
    fl.map(f => '<tr><td class="l">' + clName(CL_FL[f.f][0], CL_FL[f.f][1]) + '</td>' + ['1구역', '2구역', '3구역'].map(z => {
      if (f.zs.indexOf(z) === -1) return '<td class="clmuted">해당 없음</td>';
      const g = rows.filter(x => x[1] === f.f && x[2] === z); if (!g.length) return '<td>—</td>';
      const t = avg(g.map(x => Number(x[3]))), hm = avg(g.map(x => Number(x[4]))), d = avg(g.map(x => Number(x[5]))), l = clLv(d)[1];
      clAdvice(t, hm).forEach(a => adv.push([CL_FL[f.f][0], z + ' (평균 ' + t.toFixed(1) + '℃, ' + hm.toFixed(0) + '%): ' + a]));
      return '<td><b class="ditag' + (l === '주의' ? ' c' : l === '불쾌' ? ' d' : '') + '">' + d.toFixed(1) + ' ' + l + '</b><br><small>' + t.toFixed(1) + '℃ · ' + hm.toFixed(0) + '% · ' + g.length + '건</small></td>';
    }).join('') + '</tr>').join('') + '</tbody></table></div>';
  html += '<h3>조치 권고</h3>' + (adv.length ? '<div class="cladv">' + [...new Set(adv.map(a => a[0]))].map((fn, i) => { const a = adv.filter(x => x[0] === fn);
    return '<details' + (i ? '' : ' open') + '><summary><b>' + fn + '</b><small>' + a.length + '건</small></summary><ul>' + a.map(x => '<li>' + h(x[1]) + '</li>').join('') + '</ul></details>'; }).join('') + '</div>' : '<p class="clnote">평균 기준으로 조정이 필요한 구역이 없습니다.</p>');
  html += '<h3>추이 그래프 <small>일별 평균 온도·습도</small></h3><div class="repchart"><canvas id="repCv" height="300"></canvas></div>';
  html += '<h3>상세 기록 <small>최근 ' + Math.min(200, rows.length) + '건</small></h3><div class="scroll"><table class="cltbl rep"><thead><tr><th class="l">시각</th><th>층</th><th>구역</th><th>온도</th><th>습도</th><th>불쾌지수</th><th>실외 온도</th><th>실외 습도</th></tr></thead><tbody>' +
    rows.slice(-200).reverse().map(x => '<tr><td class="l">' + h(x[0]) + '</td><td>' + h(CL_FL[x[1]] ? CL_FL[x[1]][0] : x[1]) + '</td><td>' + h(x[2]) + '</td><td>' + x[3] + '</td><td>' + x[4] + '</td><td>' + x[5] + ' ' + clLv(Number(x[5]))[1] + '</td><td>' + (x[6] == null ? '—' : x[6]) + '</td><td>' + (x[7] == null ? '—' : x[7]) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="clnote">불쾌지수 = 0.81×T + 0.01×H×(0.99×T−14.3) + 46.3 · 쾌적 74 미만 · 주의 78 미만 · 불쾌 78 이상 · 쾌적 범위 23~26℃, 40~60%</p>';
  return html;
}
async function repChart() {
  const cv = $('repCv'); if (!cv) return;
  try { await loadChart(); } catch (e) { cv.outerHTML = '<p class="clnote">그래프 도구를 불러오지 못했습니다 (인터넷 연결 확인).</p>'; return; }
  const p = S.rep, el = $('repCv'); if (!el || !window.Chart) return;
  const navy = '#1E3A5F', sub = '#5F6B7A', ORANGE = '#E87722';   // 쾌적 범위 강조만 주황 (사용자 11-21)
  let cfg;
  if (p.kind === 'climate') {
    const by = {}; p.srv.rows.filter(x => x[0].slice(0, 10) >= p.from0).forEach(x => { const d = x[0].slice(0, 10), a = by[d] = by[d] || { t: 0, h: 0, n: 0 }; a.t += Number(x[3]); a.h += Number(x[4]); a.n++; });
    const ds = Object.keys(by).sort();
    cfg = { type: 'line', data: { labels: ds.map(d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8))), datasets: [
      { label: '평균 온도(℃)', data: ds.map(d => +(by[d].t / by[d].n).toFixed(1)), borderColor: navy, backgroundColor: navy, yAxisID: 'y', tension: .2 },
      { label: '쾌적 온도 ' + CL_RG.t[0] + '~' + CL_RG.t[1] + '℃', data: ds.map(() => CL_RG.t[1]), borderColor: ORANGE, borderWidth: 1, borderDash: [2, 2], pointRadius: 0, backgroundColor: 'rgba(232,119,34,.16)', fill: '+1', yAxisID: 'y' },
      { label: '', data: ds.map(() => CL_RG.t[0]), borderColor: ORANGE, borderWidth: 1, borderDash: [2, 2], pointRadius: 0, fill: false, yAxisID: 'y' },
      { label: '평균 습도(%)', data: ds.map(d => +(by[d].h / by[d].n).toFixed(0)), borderColor: sub, backgroundColor: sub, borderDash: [4, 3], yAxisID: 'y2', tension: .2 }] },
      options: { animation: false, maintainAspectRatio: false, plugins: { legend: { labels: { filter: x => !!x.text } } }, scales: { y: { suggestedMin: CL_RG.t[0] - 1, suggestedMax: CL_RG.t[1] + 1, title: { display: true, text: '℃' } }, y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%' } } } } };
  } else {
    const st = repStats(), to = p.day, n = Math.round((Date.parse(to) - Date.parse(p.from0)) / 864e5) + 1, monthly = p.per === 'all' || n > 120;
    let lab = [], tot = [], av = [];
    if (monthly) { const mm = {}; Object.keys(st.day).filter(d => d >= p.from0).forEach(d => { const k = d.slice(0, 7), a = mm[k] = mm[k] || { min: 0, n: 0 }; a.min += st.day[d].min; a.n += st.day[d].n; }); Object.keys(mm).sort().forEach(k => { lab.push(k); tot.push(+(mm[k].min / 60).toFixed(1)); av.push(+(mm[k].min / mm[k].n / 60).toFixed(1)); }); }
    else for (let i = n - 1; i >= 0; i--) { const d = repDay(to, -i), a = st.day[d]; lab.push(Number(d.slice(5, 7)) + '/' + Number(d.slice(8))); tot.push(a ? +(a.min / 60).toFixed(1) : 0); av.push(a ? +(a.min / a.n / 60).toFixed(1) : null); }
    cfg = { type: 'bar', data: { labels: lab, datasets: [
      { type: 'bar', label: monthly ? '월 합계(시간)' : '일 합계(시간)', data: tot, backgroundColor: navy, yAxisID: 'y' },
      { type: 'line', label: '1대 평균(시간)', data: av, borderColor: sub, backgroundColor: sub, borderDash: [4, 3], yAxisID: 'y2', spanGaps: true }] },
      options: { animation: false, maintainAspectRatio: false, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 } }, y: { beginAtZero: true, suggestedMax: monthly ? undefined : 500, title: { display: true, text: '합계(시간)' } }, y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: '1대 평균(시간)' } } } } };
  }
  if (S.repChartObj) try { S.repChartObj.destroy(); } catch (e) {}
  S.repChartObj = new window.Chart(el, cfg);
}
function repCsv() {
  const p = S.rep, r = p.srv, cell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  let head, out;
  if (p.kind === 'climate') { head = ['측정시각', '층', '구역', '실내온도', '실내습도', '불쾌지수', '실외온도', '실외습도']; out = r.rows; }
  else {
    const U = {}; r.units.forEach(u => { U[u.u] = u; });
    head = ['날짜', CL_KIND[p.kind], '가동시간(시간)', 'kW', '전력량(kWh)', '예상 요금(원)'];
    out = r.rows.filter(x => U[x[1]]).map(([d, u, m]) => { const kw = U[u].kw == null ? null : Number(U[u].kw), k = kw == null ? null : m / 60 * kw;
      return [d, (U[u].sub ? U[u].sub + ' ' : '') + U[u].name, (m / 60).toFixed(1), kw, k == null ? '' : k.toFixed(1), k == null || r.price == null ? '' : Math.round(k * Number(r.price))]; });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + [head].concat(out).map(x => x.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = (p.kind === 'climate' ? '온습도' : CL_KIND[p.kind]) + '_기록_' + (p.per === 'all' ? r.from : p.from0) + '_' + p.day + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('CSV 저장: ' + out.length + '줄');
}
function repPrint() {
  const p = S.rep, cv = $('repCv'), img = cv && cv.toDataURL ? '<img src="' + cv.toDataURL('image/png') + '" style="width:100%" alt="추이 그래프">' : '';
  const body = $('repBody').innerHTML.replace(/<canvas[^>]*><\/canvas>/, img);
  $('print').innerHTML = '<style>@page{size:A4;margin:12mm}</style><div class="clrep clprint"><h2>에비뉴엘 ' + (p.kind === 'climate' ? '실내 온습도' : CL_KIND[p.kind] + ' 사용시간') + ' 리포트</h2>' + body + '</div>';
  setTimeout(() => window.print(), 50);
}

/* ── 환경설정 › 장비 전력(kW)·단가 (소장만, 결정 194). 빈 칸 = 모름 → 리포트 환산에서 뺌 ── */
/* ── 가동시간 설정: 층(묶음) × 요일 기본 시작·종료 (21_equip_hours.sql, 결정 200). 전 직원 (결정 218) ── */
const UH_DOW = ['월', '화', '수', '목', '금', '토', '일'];
function uhHm(m) { return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function uhMin(t, end) { const x = /^(\d\d):(\d\d)/.exec(t || ''); if (!x) return null; const m = Number(x[1]) * 60 + Number(x[2]); return end && m === 0 ? 1440 : m; }
function uhBad(d) { return d[0] == null || d[1] == null || d[0] % 10 > 0 || d[1] % 10 > 0 || d[1] <= d[0]; }
async function openUhr(kind) {
  if (!useLeaveOk()) return;
  S.uh = null; go('uhr');
  const r = await call('equipHoursGet', kind); if (!r.ok) { toast(r.error); return go('use'); }
  uhSet(kind, r); if (S.view === 'uhr') render();
}
function uhSet(kind, r) { S.uh = { kind, srv: r, v: r.groups.map(x => x.days.map(d => [d[0], d[1]])), ch: {}, busy: false }; }
function uhIn(el) {
  const k = S.uh, gi = +el.dataset.gi, w = +el.dataset.w, i = +el.dataset.i, d = k.v[gi][w];
  d[i] = uhMin(el.value, i === 1); k.ch[gi + '|' + w] = 1;
  el.closest('.uhc').querySelectorAll('input').forEach(x => { x.classList.add('ch'); x.classList.toggle('bad', uhBad(d)); });
  const e = $('uhSt'); if (e) e.innerHTML = uhState();
}
function uhState() { const n = Object.keys(S.uh.ch).length; return n ? '<span class="nwstate dirty"><i class="dot"></i>' + n + '칸 저장 안 함</span>' : ''; }
function uhBack() { if (S.uh && Object.keys(S.uh.ch).length && !confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?')) return; go('use'); if (S.use) loadUse(S.use.day); }
function renderUhr() {
  const k = S.uh, kn = CL_KIND[k ? k.kind : S.use && S.use.kind] || '', top = topbar('서류작업 ›', kn + ' 가동시간 설정');
  if (!k) return top + '<div class="wrap" style="text-align:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue)"></span></div>';
  const inp = (gi, w, i, m, nm, cls) => '<input type="time" step="600" class="' + cls + '" data-gi="' + gi + '" data-w="' + w + '" data-i="' + i + '" value="' + (m == null ? '' : uhHm(m)) + '" onchange="uhIn(this)" aria-label="' + h(nm) + '">';
  const rows = k.srv.groups.map((x, gi) => '<div class="uhg">' + clName(x.g) + '<div class="uhd">' + UH_DOW.map((dn, w) => {
    const d = k.v[gi][w], cls = (k.ch[gi + '|' + w] ? 'ch' : '') + (uhBad(d) ? ' bad' : '');
    return '<div class="uhc' + (w > 3 ? ' we' : '') + '"><b>' + dn + '</b>' + inp(gi, w, 0, d[0], x.g + ' ' + dn + '요일 시작', cls) + '<span>~</span>' + inp(gi, w, 1, d[1], x.g + ' ' + dn + '요일 종료', cls) + '</div>';
  }).join('') + '</div></div>').join('');
  return top + '<div class="' + (lgPc() ? 'lgwrap' : 'wrap list') + '"><div class="banner b-gray" style="line-height:1.6">' + (k.kind === 'hvac' ? '층' : '묶음') + '마다 요일별 기본 시작 · 종료 시각입니다. [' + kn + ' 가동시간] 입력 화면의 처음 값(기본 시각)으로 쓰이고, 이미 저장한 기록은 바뀌지 않습니다. 10분 단위 · 종료 00:00 = 자정.</div>' +
    '<div class="card" style="padding:0;margin-top:var(--sp-3)">' + rows + '</div>' +
    '<div class="nwbar"><span id="uhSt">' + uhState() + '</span><div class="dslot"><button class="btn pri" id="uhSave" onclick="uhSave()"' + (k.busy ? ' disabled' : '') + '>' + (k.busy ? '<span class="spin"></span> 저장 중…' : '저장') + '</button></div></div></div>';
}
async function uhSave() {
  const k = S.uh; if (k.busy) return;
  const keys = Object.keys(k.ch); if (!keys.length) { toast('바뀐 것이 없습니다'); return; }
  const rows = keys.map(x => { const [gi, w] = x.split('|').map(Number), d = k.v[gi][w]; return { g: k.srv.groups[gi].g, w: w + 1, s: d[0], e: d[1], bad: uhBad(d) }; });
  const bad = rows.find(x => x.bad);
  if (bad) { toast(bad.g + ' ' + UH_DOW[bad.w - 1] + '요일: 시작·종료를 10분 단위로, 종료가 시작보다 늦게 넣어 주세요'); return; }
  k.busy = true; render();
  try {
    const r = await call('equipHoursSave', k.kind, rows.map(x => ({ g: x.g, w: x.w, s: x.s, e: x.e })));
    k.busy = false; if (!r.ok) { render(); toast(r.error); return; }
    uhSet(k.kind, r); render(); toast(rows.length + '칸 저장했습니다 · 입력 화면 기본 시각에 반영');
  } catch (e) { k.busy = false; render(); toast('서버에 닿지 않았습니다. 다시 눌러 주세요'); }
}

async function openKw() {
  S.kw = null; go('kw');
  const r = await call('equipKwGet'); if (!r.ok) { toast(r.error); return back(); }
  S.kw = { srv: r, ch: {}, busy: false }; if (S.view === 'kw') render();
}
function kwIn(el) { const k = el.dataset.k; S.kw.ch[k] = clNum(el.value); el.classList.toggle('bad', S.kw.ch[k] !== '' && clBad(S.kw.ch[k], 0, k === 'price' ? 10000 : 1000)); const e = $('kwSt'); if (e) e.textContent = '고친 내용 있음'; }
function renderKw() {
  const k = S.kw;
  if (!k) return topbar('환경설정 ›', '장비 전력 · 단가') + '<div class="wrap" style="text-align:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue)"></span></div>';
  const r = k.srv, box = (key, val, unit, lbl) => '<label class="hvin kwin"><input class="inp' + (val == null || val === '' ? ' empty' : '') + '" inputmode="decimal" maxlength="8" data-k="' + h(key) + '" value="' + h(key in k.ch ? k.ch[key] : val == null ? '' : val) + '" oninput="kwIn(this)" aria-label="' + h(lbl) + '"><span>' + unit + '</span></label>';
  const list = (kind, us) => '<h3 class="sth" style="margin-top:var(--sp-2)">' + CL_KIND[kind] + ' ' + us.length + '대 <small style="color:var(--muted);font-weight:400">kW 미입력 ' + us.filter(u => u.kw == null).length + '대</small></h3><div class="card">' +
    us.map(u => '<div class="strow"><span class="fname">' + clName(u.name, u.tone) + '<small>' + h(u.sub || u.grp) + '</small></span>' + box('u:' + u.u, u.kw, 'kW', (u.sub ? u.sub + ' ' : '') + u.name + ' 전력') + '</div>').join('') + '</div>';
  return topbar('환경설정 ›', '장비 전력 · 단가') + '<div class="wrap list"><div class="banner b-gray" style="line-height:1.6">모르는 칸은 비워 두세요. 빈 장비는 리포트의 전력량·요금 환산에서 빠지고 「kW 미입력 n대」로 보입니다.</div>' +
    '<h3 class="sth">전력 단가</h3><div class="card strow"><span class="fname"><b>단가</b><small>원/kWh · 예상 요금 = kWh × 단가</small></span>' + box('price', r.price, '원', '전력 단가') + '</div>' +
    list('hvac', r.hvac) + list('curtain', r.curtain) +
    '<div class="nwbar"><span id="kwSt">' + (Object.keys(k.ch).length ? '고친 내용 있음' : '') + '</span><button class="btn pri" onclick="kwSave()"' + (k.busy ? ' disabled' : '') + '>' + (k.busy ? '<span class="spin"></span>' : '저장') + '</button></div></div>';
}
async function kwSave() {
  const k = S.kw; if (k.busy) return;
  const d = { hvac: {}, curtain: {} }, bad = Object.keys(k.ch).find(x => k.ch[x] !== '' && clBad(k.ch[x], 0, x === 'price' ? 10000 : 1000));
  if (bad) { toast((bad === 'price' ? '단가는 0 ~ 10000' : '전력은 0 ~ 1000') + ' 숫자로 넣어 주세요'); return; }
  Object.keys(k.ch).forEach(x => { if (x === 'price') d.price = k.ch[x]; else { const u = x.slice(2); d[k.srv.hvac.some(a => a.u === u) ? 'hvac' : 'curtain'][u] = k.ch[x]; } });
  if (!Object.keys(k.ch).length) { toast('바뀐 것이 없습니다'); return; }
  k.busy = true; render();
  try { const r = await call('equipKwSave', d); k.busy = false; if (!r.ok) { render(); toast(r.error); return; } S.kw = { srv: r, ch: {}, busy: false }; render(); toast('저장했습니다'); }
  catch (e) { k.busy = false; render(); }
}

/* ── 메인 「오늘 가동시간 미입력」 (결정 194): 기본 종료 시각 뒤부터 오늘, 그 전에는 어제 남은 것. 미가동 = 입력 ── */
function mainTodo() {
  const t = S.acTodo;
  if (!t || !t.ok || (!t.hvac && !t.curtain) || (menuOff('docs') && !menuCanOpen())) return '';
  const b = (k, n) => n ? '<button class="btn" onclick="openUse(\'' + k + '\', \'' + t.day + '\')">' + CL_KIND[k] + ' <b>' + n + '대</b>' + ICON.next + '</button>' : '';
  return '<div class="todo"><div class="todo-h">' + t.when + ' 가동시간 미입력 <small>미가동 체크는 입력한 것으로 셈</small></div><div class="todo-b">' + b('hvac', t.hvac) + b('curtain', t.curtain) + '</div></div>';
}

function withBack(html) { return html.replace(/<div class="(nwbar|csbar-in)"( id="\w+")?>/, m => m + '<button class="btn back-in" onclick="back()">' + ICON.back + '뒤로</button>'); }

