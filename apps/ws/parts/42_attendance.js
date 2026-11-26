/* ── 출근현황 (WS_출근현황 15.3.19, 결정 88) ── */
const AT_CODES = ['', '9-7', '휴', '연', '법', '야', '비', '병가', 'A반', 'P반', 'A검진', 'P검진'];
const AT_KNOWN = AT_CODES.concat(['전반', '후반', '대', '경', '.']);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function atCls(v) { return { '': 'on', '9-7': '97', '휴': 'hu', '연': 'yeon', '법': 'beop', '야': 'ya', '비': 'bi', '병가': 'sick', 'A반': 'ban', 'P반': 'ban', '전반': 'ban', '후반': 'ban', 'A검진': 'gj', 'P검진': 'gj' }[v] || 'etc'; }
function atLbl(v) { return v === '' ? '출' : v; }
function atRole(r) { return r === '교대반장' ? '교대' : r; }   // 교대반장이라는 직급은 없음 (사용자 11-07)
function atIsDay(v) { return v === '' || v === '9-7' || /^[AP](반|검진)$|^[전후]반$/.test(v); }   // 서버 atIsDay_와 같음
function atGrp(v) { return atIsDay(v) ? '주' : v === '야' ? '야' : v === '비' ? '비번' : '휴무'; }
function atWd(d) { return WEEK[new Date(d + 'T12:00:00+09:00').getDay()]; }
function atKo(d) { return Number(d.slice(0, 4)) + '년 ' + Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일 (' + atWd(d) + ')'; }
function atTitle(sec) { return sec.indexOf('관') === 0 ? '관리파트' : /^공사장/.test(sec) ? sec.replace(/^공사장(?=\S)/, '공사장 ') : /^[가-힣]{4}$/.test(sec) ? sec.slice(0, 2) + '·' + sec.slice(2) : sec; }
const AT_PART = { '전방파트': '전기·방재', '기건파트': '기계·건축' };   // 직원 파트가 엑셀 구역보다 먼저 (사용자 11-26)
/* 엑셀 줄 → 조직도 구역: 소장 = 사업소장, 나머지는 엑셀 구역 순서대로 (5장) */
function atGroups(people) {
  const out = [{ t: '사업소장', p: [] }];
  people.forEach(x => { const t = atTitle(x.sec); if (x.role !== '소장' && !out.some(o => o.t === t)) out.push({ t, p: [] }); });   // 구역 순서는 엑셀 순서 (파트로 옮겨도)
  people.forEach((x, i) => {
    if (x.role === '소장') return out[0].p.push(Object.assign({ i }, x));
    const t0 = atTitle(x.sec), t = (!/^관리파트$|^공사장/.test(t0) && AT_PART[x.part]) || t0; let g = out.find(o => o.t === t);
    if (!g) { g = { t, p: [] }; out.push(g); }
    g.p.push(Object.assign({ i }, x));
  });
  out.sort((a, b) => /^공사장/.test(a.t) - /^공사장/.test(b.t));   // 공사장 안전관리는 맨 아래 (엑셀에선 가운데, 사용자 11-13)
  out.forEach(g => g.p.sort((a, b) => !a.name - !b.name));   // 공석은 구역 맨 끝 (sort는 같은 값끼리 순서 유지)
  return out.filter(g => g.p.length);
}
function atOrg(people, ed) {
  const a = S.at || {};
  return '<div class="atorg">' + atGroups(people).map((g, k) => '<section class="atsec k' + Math.min(k, 4) + '"><h2>' + h(g.t) + '<small>' + g.p.filter(x => x.name).length + '명</small></h2><div class="atppl">' +
    g.p.map(x => x.name ? '<div class="atp">' +
      (ed ? '<button class="atnm" onclick="atHolOpen(' + x.i + ')" aria-label="' + h(x.name) + ' 기본 휴일"><small>' + h(atRole(x.role)) + '</small><b>' + h(x.name) + '</b></button>' : '<span class="atnm"><small>' + h(atRole(x.role)) + '</small><b>' + h(x.name) + '</b></span>') +
      (ed && x.fix ? '<span class="atfix" title="고침: ' + h(x.fix.by) + ' ' + h(x.fix.at) + '"></span>' : '') +
      (ed && a.r && a.r.canFix ? '<button class="attag s-' + atCls(x.v) + '" onclick="atFixOpen(' + x.i + ')" aria-label="' + h(x.name) + ' 상태 ' + h(atLbl(x.v)) + ' 바꾸기">' + h(atLbl(x.v)) + '</button>' : '<span class="attag s-' + atCls(x.v) + '">' + h(atLbl(x.v)) + '</span>') +
      '</div>' : '<div class="atp vac">공석</div>').join('') + '</div></section>').join('') + '</div>';
}
function atSums(people) {
  const parts = [];
  atGroups(people).forEach(g => { const t = g.t === '사업소장' || g.t === '관리파트' ? '관리' : g.t; let p = parts.find(x => x.n === t); if (!p) parts.push(p = { n: t, p: [] }); p.p = p.p.concat(g.p); });
  const K = ['a', 'b', 'v', '주', '야', '휴무', '비번'], T = { n: '합계' }; K.forEach(k => T[k] = 0);
  const rows = parts.map(x => { const q = x.p.filter(y => y.name), r = { n: x.n, a: x.p.length, b: q.length, v: x.p.length - q.length };
    ['주', '야', '휴무', '비번'].forEach(gk => r[gk] = q.filter(y => atGrp(y.v) === gk).length); K.forEach(k => T[k] += r[k]); return r; });
  const num = v => v ? v + '명' : '<span class="z">0명</span>';
  const tb = (cap, cols, names) => '<table class="atst"><caption>' + cap + '</caption><tr><th>파트</th>' + names.map(n => '<th>' + n + '</th>').join('') + '</tr>' +
    rows.concat([T]).map((r, i) => '<tr' + (i === rows.length ? ' class="sum"' : '') + '><td>' + h(r.n) + '</td>' + cols.map(k => '<td>' + num(r[k]) + '</td>').join('') + '</tr>').join('') + '</table>';
  return '<div class="atsums">' + tb('파트별 인원현황', ['a', 'b', 'v'], ['전체', '현재', '공석']) +
    '<div class="atduo">' + tb('금일 근무인원 현황', ['주', '야'], ['주', '야']) + tb('금일 휴무인원 현황', ['휴무', '비번'], ['휴무', '비번']) + '</div></div>';
}
async function openAtt() { S.at = null; go('att'); await loadAtt(''); }
async function loadAtt(date) {
  try {
    const r = await call('attGet', date);
    if (!r.ok) { toast(r.error); return; }
    S.at = { r }; S.atToday = r.today; if (S.view === 'att') render();
  } catch (e) {}
}
function renderAtt() {
  const a = S.at;
  if (!a) return topbar('서류작업 ›', '출근현황') + '<div class="wrap list"><div class="banner b-gray">불러오는 중…</div></div>';
  const r = a.r, up = r.canBoss;
  const head = '<div class="card" style="padding:var(--sp-4)"><div class="nwhead"><b>출근현황</b><button class="nwdate" onclick="atCal()" style="border:0;cursor:pointer;padding:0 var(--sp-3);gap:var(--sp-2);font-weight:600">' + ICON.cal + h(atKo(r.date)) + '</button></div>' +
    '<div class="nwmeta">' + (r.people.length ? h(Number(r.date.slice(5, 7))) + '월 스케줄 · ' + h(r.upAt) + ' ' + h(r.upBy) + ' 올림' : '이 달 근무 스케줄이 아직 없습니다') +
    (up ? ' · <button class="btn sm" onclick="S.atup=null;go(\'attup\')" style="margin-left:var(--sp-1)">엑셀 올리기</button>' : '') + '</div></div>';
  if (!r.people.length) return topbar('서류작업 ›', '출근현황') + '<div class="wrap list">' + head + '<div class="banner b-gray">' + (up ? '[엑셀 올리기]로 이 달 근무 스케줄 파일을 넣어 주세요.' : '소장·부소장·총무가 이 달 근무 스케줄 엑셀을 올리면 보입니다.') + '</div>' +
    '<div class="nwbar"><button class="btn" onclick="atCal()">날짜 바꾸기</button></div></div>';
  return topbar('서류작업 ›', '출근현황') + '<div class="wrap list">' + head +
    '<div class="atwho">' + (r.canFix ? '상태 칸을 눌러 이날 상태를 고릅니다 · ' : '') + '이름을 누르면 기본 휴일을 봅니다</div>' +
    atOrg(r.people, true) + atSums(r.people) +
    '<div class="nwbar"><button class="btn" onclick="atCal()">날짜 바꾸기</button><button class="btn" id="atImgBtn" onclick="atImage()">' + ICON.dl + '그림으로 저장</button></div></div>';
}
/* 달력: 그 달 날짜별 주간 인원 (엑셀 「주간근무총원」과 같은 셈). ‹ ›로 앞뒤 달 */
function atCal() {
  const r = S.at.r, ym = r.date.slice(0, 7), y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(), first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  let g = WEEK.map((w, i) => '<span class="w">' + w + '</span>').join('') + '<span></span>'.repeat(first);
  for (let d = 1; d <= last; d++) {
    const ds = ym + '-' + String(d).padStart(2, '0'), wd = (first + d - 1) % 7;
    g += '<button class="' + (wd === 0 ? 'sun ' : wd === 6 ? 'sat ' : '') + (ds === r.date ? 'on ' : '') + (ds === r.today ? 'today' : '') + '" onclick="closeDialog();S.at=null;render();loadAtt(\'' + ds + '\')" aria-label="' + d + '일"><b>' + d + '</b><small>' + (r.ju.length ? '주 ' + r.ju[d - 1] : '') + '</small></button>';
  }
  const mv = k => { const t = new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10); return 'closeDialog();S.at=null;render();loadAtt(\'' + t + '\').then(()=>S.at&&atCal())'; };
  dialog('<div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)"><button class="btn sm" onclick="' + mv(-1) + '" aria-label="앞 달">‹</button><b style="flex:1;text-align:center;font-size:var(--size-l)">' + y + '년 ' + m + '월</b><button class="btn sm" onclick="' + mv(1) + '" aria-label="다음 달">›</button><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="atcal">' + g + '</div>' +
    (r.months.length ? '<div class="nwmeta">스케줄이 있는 달: ' + r.months.map(h).join(', ') + ' · 「주 n」 = 그날 주간 근무 인원</div>' : '') +
    '<button class="btn" style="width:100%;margin-top:var(--sp-2)" onclick="closeDialog();S.at=null;render();loadAtt(\'\')">오늘 근무일로</button>');
}
