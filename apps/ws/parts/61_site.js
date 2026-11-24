/* ── 공사장 점검 (WS_공사장점검, 결정 100): 현장 목록 → 현장 점검(자동 저장) → 날짜별·현장별 PDF ── */
const CS_ST = [['양호', 'ok'], ['미흡', 'bad'], ['해당없음', 'na']];
const CS_MAX_PHOTOS = 4;   // 새로 넣는 한도: 휴대폰 2열×2줄 · PC 4열 한 줄 (사용자 11-24, 결정 238). 서버는 예전 기록(6장)도 받도록 6장 그대로
// 사진 넣기 (사용자 11-24, TBM 사진칸과 같게): [카메라] 바로 찍기 · [파일] 갤러리에서 여러 장 고르기, 최대 6장
function csPhBar(x, i) {
  const n = x.photos.length, full = n >= CS_MAX_PHOTOS;
  const pick = cam => '<label class="btn sm' + (full ? ' off' : '') + '">' + (cam ? ICON.cam + ' 카메라' : ICON.folder + ' 파일') + '<input type="file" accept="image/*"' + (cam ? ' capture="environment"' : ' multiple') + (full ? ' disabled' : '') + ' hidden onchange="csPhAdd(' + i + ',this)"></label>';
  return '<div class="tbpb csphb">' + pick(true) + pick(false) + '</div><small class="csphn">사진 ' + (n > CS_MAX_PHOTOS ? n + '장' : n + ' / ' + CS_MAX_PHOTOS + '장') + '</small>';
}
function csDay(d) { return Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일 (' + '일월화수목금토'[new Date(d + 'T00:00:00').getDay()] + ')'; }
function csNow(dateToo) { const d = new Date(), p = n => String(n).padStart(2, '0'); return (dateToo ? d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' : '') + p(d.getHours()) + ':' + p(d.getMinutes()); }
function csCnt(k) { const c = { '양호': 0, '미흡': 0, '해당없음': 0 }; k.items.forEach(x => { if (c[x.st] !== undefined) c[x.st]++; }); return c; }
const CS_RD = ['오후점검', '퇴실점검', '추가 점검'];   // 하루 2번 (사용자 11-13, 결정 112). 3회차는 하루 3번 하던 11-11~12 기록만
const csRds = has3 => has3 ? [1, 2, 3] : [1, 2];
function csRdChip(c, n) {
  const L = CS_RD[n - 1];
  if (!c) return '<span class="wait">' + L + ' 전</span>';
  return c.bad ? '<span class="bad">' + L + ' 미흡 ' + c.bad + '</span>' : '<span class="ok">' + L + ' 양호</span>';
}
// 점검 줄들을 날짜·현장별로 묶음 (회차 1·2·3 → r)
function csGroups(list) {
  const out = [], by = {};
  list.forEach(c => { const key = c.date + '|' + c.site; let g = by[key]; if (!g) out.push(g = by[key] = { date: c.date, site: c.site, name: c.name, work: c.work, co: c.co, r: {}, list: [] }); g.r[c.round] = c; g.list.push(c); });
  return out;
}
// 현장·하루 PDF 1개: 세 회차 줄에 같은 PDF. 그 뒤 고치거나 새 회차를 하면 옛 판
function csDayPdf(list) {
  const p = (list || []).find(c => c.pdf);
  return p ? { url: p.pdf.url, stale: list.some(c => !c.pdf || c.stale) } : null;
}
// 검색: 현장명·업체·공사 내용·날짜 (2026-11-11, 11-11, 11/11, 11.11, 11월 11일, 11월). 띄어쓰기 무시
function csHit(q, g) {
  if (!q) return true;
  const d = g.date, m = Number(d.slice(5, 7)), dd = Number(d.slice(8, 10));
  return [g.name, g.co, g.work, d, m + '-' + dd, m + '/' + dd, m + '.' + dd, m + '월' + dd + '일', m + '월'].join('|').replace(/\s/g, '').toLowerCase().indexOf(q) !== -1;
}
async function openCs() { go('cs'); await loadCs(); }
async function loadCs() { const r = await call('csHome'); S.cs = r; if (S.view === 'cs') render(); }
function renderCs() {
  const r = S.cs;
  if (!r) return topbar('점검 ›', '공사장 점검') + '<div class="wrap list"><div class="banner b-gray">불러오는 중…</div></div>';
  const sites = csSitesToday(), today = csGroups(r.today), bad = r.today.reduce((a, c) => a + c.bad, 0);
  const sum = [1, 2].map(n => '<div>' + CS_RD[n - 1] + '<b>' + sites.filter(s => today.some(g => g.site === s.id && g.r[n])).length + ' / ' + sites.length + '곳</b></div>').join('');
  return topbar('점검 ›', '공사장 점검') + '<div class="wrap list">' +
    '<div class="card cshd"><div style="display:flex;align-items:center;gap:var(--sp-2)"><div style="flex:1;min-width:0"><b>' + csDay(r.day) + ' 공사장 점검</b><small>현장 ' + sites.length + '곳 · 하루 2번 (오후점검 · 퇴실점검)</small></div>' +
    (bad ? '<span class="cschip bad">미흡 ' + bad + '건</span>' : '') + '</div><div class="csrsum">' + sum + '</div></div>' +
    '<div class="cssec">오늘 점검할 현장<label class="cssrch"><input id="csQ" type="search" enterkeyhint="search" placeholder="현장명·업체·날짜 검색" aria-label="현장명·업체·날짜 검색" value="' + h(S.csQ || '') + '" oninput="csSearch(this.value)"></label></div>' +
    '<div id="csRes" class="list">' + csResHtml() + '</div></div>';
}
function csSitesToday() {
  const r = S.cs, sites = r.sites.map(s => Object.assign({ live: true }, s));
  return sites;
}
// 검색하면 이 칸만 다시 그림 (글자 칸은 그대로 — 한글 입력 끊기지 않게)
function csSearch(v) { S.csQ = v; S.csOpen = {}; const e = $('csRes'); if (e) e.innerHTML = csResHtml(); }
function csResHtml() {
  const r = S.cs, q = String(S.csQ || '').replace(/\s/g, '').toLowerCase();
  const by = {}; csGroups(r.today).forEach(g => { by[g.site] = g; });
  const sites = csSitesToday().filter(s => csHit(q, Object.assign({ date: r.day }, s)));
  const past = csGroups(r.past.concat(r.today.filter(c => !r.sites.some(x => x.id === c.site)))).filter(g => csHit(q, g));   // 공사 완료한 현장의 오늘 점검도 지난 점검으로
  const days = [];
  past.forEach(g => { let d = days.find(x => x.date === g.date); if (!d) days.push(d = { date: g.date, g: [] }); d.g.push(g); });
  days.sort((a, b) => a.date < b.date ? 1 : -1);
  return (sites.length ? '<div class="card cslist">' + sites.map((s, i) => csRowHtml(s, by[s.id], r.day, i + 1)).join('') + '</div>'
    : '<div class="banner b-gray">' + (q ? '오늘 현장 중 「' + h(S.csQ) + '」 없음' : '진행 중인 공사 현장이 없습니다. 아래에서 현장을 추가해 주세요.') + '</div>') +
    '<div class="csbtns"><button class="btn big csadd" onclick="csSiteOpen()">＋ 새 공사 현장 추가</button><button class="btn big csdone" onclick="csDoneOpen()"' + (r.sites.length ? '' : ' disabled') + '>공사 완료</button>' + (r.admin ? '<button class="btn csitb" onclick="csItemsOpen()">기본 항목 고치기 (' + r.items.filter(x => x.use).length + ' / ' + r.items.length + ')</button>' : '') + '</div>' +
    csPastHtml(days, past.length, q);
}
function csRedraw() { const e = $('csRes'); if (e) e.innerHTML = csResHtml(); }
function csAcc(d, el) { S.csOpen = S.csOpen || {}; S.csOpen[d] = el.getAttribute('aria-expanded') !== 'true'; csRedraw(); }
// 날짜 아코디언 줄들 (all = 검색 중이라 모두 펼침, 아니면 첫 날만 펼침)
function csAccHtml(list, all) {
  return list.map((d, i) => {
    const open = S.csOpen && d.date in S.csOpen ? S.csOpen[d.date] : (all ? true : i === 0), bad = d.g.reduce((a, g) => a + g.list.reduce((b, c) => b + (c.bad || 0), 0), 0);
    return '<button class="csacc' + (open ? ' on' : '') + '" aria-expanded="' + open + '" onclick="csAcc(\'' + d.date + '\',this)"><b>' + csDay(d.date) + '</b><span class="csn">' + d.g.length + '곳</span>' + (bad ? '<span class="cschip bad">미흡 ' + bad + '건</span>' : '') + '<span class="csar" aria-hidden="true"></span></button>' +
      (open ? d.g.map(g => csRowHtml({ id: g.site, name: g.name }, g, g.date, 0)).join('') : '');
  }).join('');
}
// 지난 점검 (결정 180): 년도 체크(여러 해 가능) → 이번 달은 날짜 아코디언, 지난달들은 월 탭. 검색하면 년도·탭 없이 전체에서 찾음
function csPastHtml(days, n, q) {
  if (!days.length) return q ? '<div class="cssec">지난 점검</div><div class="banner b-gray">「' + h(S.csQ) + '」 지난 점검 없음</div>' : '';
  if (q) return '<div class="cssec">지난 점검 · ' + n + '건</div><div class="card cslist">' + csAccHtml(days, true) + '</div>';
  const cur = S.cs.day.slice(0, 7), all = days.map(d => d.date.slice(0, 4)).filter((y, i, a) => a.indexOf(y) === i);   // days는 새것부터
  let ys = (S.csYears || []).filter(y => all.indexOf(y) !== -1); if (!ys.length) ys = [all.indexOf(cur.slice(0, 4)) !== -1 ? cur.slice(0, 4) : all[0]];
  S.csYears = ys;
  const sel = days.filter(d => ys.indexOf(d.date.slice(0, 4)) !== -1), now = sel.filter(d => d.date.slice(0, 7) === cur), mons = [];
  sel.forEach(d => { const m = d.date.slice(0, 7); if (m !== cur && mons.indexOf(m) === -1) mons.push(m); });
  const mon = mons.indexOf(S.csMon) !== -1 ? S.csMon : mons[0];
  return '<div class="cssec">지난 점검</div><div class="csyrs" role="group" aria-label="년도 고르기">' +
    all.map(y => '<label class="csyr"><input type="checkbox"' + (ys.indexOf(y) !== -1 ? ' checked' : '') + ' onchange="csYear(\'' + y + '\',this)"><span>' + y + '년</span></label>').join('') + '</div>' +
    (now.length ? '<div class="cssec cssub">이번 달</div><div class="card cslist">' + csAccHtml(now, false) + '</div>' : '') +
    (mons.length ? '<div class="cssec cssub">지난달</div><div class="csmons" role="tablist" aria-label="지난달 고르기">' +
      mons.map(m => '<button class="csmon' + (m === mon ? ' on' : '') + '" role="tab" aria-selected="' + (m === mon) + '" onclick="csMon(\'' + m + '\')">' + (ys.length > 1 ? m.slice(2, 4) + '년 ' : '') + Number(m.slice(5)) + '월</button>').join('') +
      '</div><div class="card cslist">' + csAccHtml(sel.filter(d => d.date.slice(0, 7) === mon), false) + '</div>' : '');
}
function csYear(y, el) {
  const set = (S.csYears || []).filter(x => x !== y); if (el.checked) set.push(y);
  if (!set.length) { el.checked = true; return toast('년도는 하나 이상 골라야 합니다'); }   // 다 끄면 볼 게 없으니 마지막 하나는 못 끔
  S.csYears = set.sort().reverse(); S.csOpen = {}; csRedraw();
}
function csMon(m) { S.csMon = m; S.csOpen = {}; csRedraw(); }
function csRowHtml(s, g, date, no) {
  const pdf = g && csDayPdf(g.list), sub = no ? [s.work, s.co].filter(Boolean).join(' · ') : '';
  const round = no ? '' : ',' + Math.min.apply(null, g.list.map(c => c.round));   // 지난 점검은 첫 회차부터 (위 칸으로 다른 회차)
  return '<div class="csrow"><button class="csgo" onclick="csOpen(\'' + date + '\',\'' + h(s.id) + '\'' + round + ')">' + (no ? '<span class="csno">' + no + '</span>' : '') +
    '<span class="fname"><b>' + h(s.name) + '</b>' + (sub ? '<small>' + h(sub) + '</small>' : '') +
    '<span class="csrd">' + csRds(g && g.r[3]).map(n => csRdChip(g && g.r[n], n)).join('') + '</span></span></button>' +
    (pdf ? pdfBtn('sm', 'PDF', pdf.url, { name: date + '_공사장점검-' + s.name + '.pdf', sub: '공사장 점검 ›' }) : '') +
    (no && s.live ? '<button class="btn sm ehmore" onclick="csSiteMenu(\'' + h(s.id) + '\')" aria-label="' + h(s.name) + ' 고치기·공사 완료">⋯</button>' : '') + '</div>';
}
function csSiteOpen(id) {
  const s = (id && S.cs.sites.find(x => x.id === id)) || { name: '', work: '', co: '' };
  dialog('<h3 class="ehdh">' + (id ? '현장 고치기' : '새 공사 현장') + '</h3>' +
    '<label class="ehf">현장 이름 (층 + 매장)<input class="inp" id="csN" maxlength="30" placeholder="예: 5F 리모와" value="' + h(s.name) + '"></label>' +
    '<label class="ehf">공사 내용<input class="inp" id="csW" maxlength="30" placeholder="예: 매장 인테리어" value="' + h(s.work) + '"></label>' +
    '<label class="ehf">업체<input class="inp" id="csC" maxlength="30" placeholder="예: ○○인테리어" value="' + h(s.co) + '"></label>' +
    '<div id="csM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button class="btn big pri" style="flex:2" id="csSb" onclick="csSiteSaveBtn(\'' + h(id || '') + '\')">저장</button></div>');
  $('csN').focus();
}
async function csSiteSaveBtn(id) {
  $('csSb').disabled = true;
  try {
    const r = await call('csSiteSave', { id: id, name: $('csN').value, work: $('csW').value, co: $('csC').value });
    if (!r.ok) { $('csM').textContent = r.error; $('csSb').disabled = false; return; }
    S.cs.sites = r.sites; closeDialog(); render(); toast(id ? '고쳤습니다' : '현장을 추가했습니다');
  } catch (e) { $('csSb').disabled = false; }
}
function csSiteMenu(id) {
  const s = S.cs.sites.find(x => x.id === id); if (!s) return;
  dialog('<h3 class="ehdh">' + h(s.name) + '</h3><p class="ehdp">공사가 끝나면 「공사 완료」로 목록에서 뺍니다. 지난 점검과 PDF는 그대로 남습니다.</p>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="csSiteOpen(\'' + h(id) + '\')">고치기</button><button class="btn big warn" style="flex:1" onclick="csSiteEndBtn(\'' + h(id) + '\')">공사 완료</button></div>');
}
async function csSiteEndBtn(id) {
  if (!confirm('이 현장을 목록에서 뺄까요?')) return;
  const r = await call('csSiteEnd', id);
  if (!r.ok) return toast(r.error);
  closeDialog(); await loadCs(); toast('공사 완료 — 목록에서 뺐습니다');
}
// 공사 완료: 끝난 현장을 여러 곳 골라 한 번에 뺌 (점검 기록·PDF는 지난 점검에 남음)
function csDoneOpen() {
  const sites = S.cs.sites; if (!sites.length) return toast('공사 완료할 현장이 없습니다');
  dialog('<h3 class="ehdh">공사 완료</h3><p class="ehdp">끝난 현장을 고르세요. 오늘 점검할 현장에서 빠지고, 지난 점검 기록·PDF는 그대로 남아 검색됩니다.</p><div class="card cslist">' +
    sites.map(s => '<label class="csdl"><input type="checkbox" value="' + h(s.id) + '" onchange="csDoneCnt()"><span><b>' + h(s.name) + '</b><small>' + h([s.work, s.co].filter(Boolean).join(' · ')) + '</small></span></label>').join('') + '</div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button class="btn big pri" style="flex:2" id="csDb" disabled onclick="csDoneGo()">현장을 고르세요</button></div>');
}
function csDoneCnt() { const n = document.querySelectorAll('.csdl input:checked').length, b = $('csDb'); b.disabled = !n; b.textContent = n ? '선택한 ' + n + '곳 공사 완료' : '현장을 고르세요'; }
async function csDoneGo() {
  const ids = [...document.querySelectorAll('.csdl input:checked')].map(x => x.value); if (!ids.length) return;
  if (!confirm(ids.length + '곳을 공사 완료로 목록에서 뺄까요?\n지난 점검 기록·PDF는 남습니다.')) return;
  $('csDb').disabled = true; let n = 0, err = '';
  for (const id of ids) { const r = await call('csSiteEnd', id); if (!r.ok) { err = r.error; break; } n++; }
  closeDialog(); await loadCs(); toast(err ? '공사 완료 ' + n + '곳 · ' + err : '공사 완료 ' + n + '곳 — 목록에서 뺐습니다');
}
/* 기본 항목 (관리자만, 사용자 11-11): 더하기·지우기 → 새로 시작하는 점검부터 씀 */
function csItemsOpen() { S.csIt = S.cs.items.map(x => ({ t: x.t, d: x.d, use: !!x.use })); csItemsDraw(); }
function csItemUse(i, el) { S.csIt[i].use = el.checked; }
function csItemsDraw() {
  const L = S.csIt;
  dialog('<h3 class="ehdh">기본 점검 항목 (' + L.length + '개)</h3><p class="ehdp">「점검에 넣기」를 체크한 항목만 오후점검·퇴실점검에 1번부터 차례로 들어갑니다. 새로 시작하는 점검부터 쓰고, 이미 저장한 점검은 그대로입니다.</p>' +
    '<div class="list csitems">' + L.map((x, i) => '<div class="row"><span class="csno">' + (i + 1) + '</span><span class="fname"><b>' + h(x.t) + '</b><small>' + h(x.d) + '</small><label class="csuse"><input type="checkbox"' + (x.use ? ' checked' : '') + ' onchange="csItemUse(' + i + ',this)">점검에 넣기</label></span><button class="btn sm warn" onclick="csItemDel(' + i + ')">지우기</button></div>').join('') + '</div>' +
    '<div class="card" style="padding:var(--sp-3);margin-top:var(--sp-2)"><label class="ehf">새 항목 이름<input class="inp" id="ciT" maxlength="30"></label><label class="ehf">설명 (점검 기준)<input class="inp" id="ciD" maxlength="100"></label><button class="btn" style="width:100%" onclick="csItemAdd()">＋ 목록에 더하기</button></div>' +
    '<div id="ciM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button class="btn big pri" style="flex:2" id="ciSb" onclick="csItemsSaveBtn()">저장</button></div>');
}
function csItemAdd() { const t = $('ciT').value.trim(), d = $('ciD').value.trim(); if (!t) { $('ciM').textContent = '항목 이름을 넣어 주세요'; return; } S.csIt.push({ t: t, d: d, use: true }); csItemsDraw(); }
function csItemDel(i) { if (S.csIt.length <= 1) return toast('항목은 1개 이상 있어야 합니다'); S.csIt.splice(i, 1); csItemsDraw(); }
async function csItemsSaveBtn() {
  $('ciSb').disabled = true;
  try {
    const r = await call('csItemsSave', S.csIt);
    if (!r.ok) { $('ciM').textContent = r.error; $('ciSb').disabled = false; return; }
    S.cs.items = r.items; closeDialog(); render(); toast('기본 항목 ' + r.items.length + '개 저장');
  } catch (e) { $('ciSb').disabled = false; }
}
/* 현장 점검: 고칠 때마다 1.5초 뒤 자동 저장, 사진은 고르면 바로 저장. 저장은 한 번에 하나씩 (같은 사진 두 번 안 올림) */
async function csOpen(date, id, round, same) {
  S.ck = null; go('csck', !same);
  const r = await call('csGet', date, id, round);
  if (!r.ok) { toast(r.error); go('cs'); return; }
  S.ck = Object.assign(r, { ver: 0, dirty: false, saving: null, err: false, pdfBusy: false });
  if (S.view === 'csck') render();
}
// 회차 칸: 저장한 회차와 그다음 회차만 누를 수 있음 (오후점검 → 퇴실점검)
function csTabsHtml(k) {
  const by = {}; (k.rounds || []).forEach(c => { by[c.round] = c; });
  return '<div class="csrtabs" role="tablist" aria-label="점검 회차">' + csRds(by[3]).map(n => {
    const c = by[n], on = n === k.round, can = !!(c || n === 1 || by[n - 1]);
    const sub = c ? '✓ ' + String(c.at).slice(11, 16) + ' ' + c.by : on ? '지금 점검' : '점검 전';
    return '<button type="button" role="tab" aria-selected="' + on + '"' + (on ? ' class="on"' : can ? ' onclick="csRound(' + n + ')"' : ' disabled') + '>' + CS_RD[n - 1] + '<small>' + h(sub) + '</small></button>';
  }).join('') + '</div>';
}
async function csRound(n) {
  const k = S.ck; if (!k || k.pdfBusy) return;
  if ((k.dirty || k.saving) && !(await csFlush()) && !confirm('저장하지 못했습니다. 그래도 넘어갈까요? (고친 내용이 사라질 수 있습니다)')) return;
  csOpen(k.date, k.site.id, n, true);
}
function csStateHtml() {
  const k = S.ck;
  if (k.saving) return '<span class="csst">저장 중…</span>';
  if (k.err) return '<span class="csst err">● 저장 못 함</span> <button class="btn sm" onclick="csDirty(true)">다시 저장</button>';
  if (k.dirty) return '<span class="csst dirty">● 곧 자동 저장</span>';
  return k.check ? '<span class="csst ok">● 저장됨 ' + h(String(k.check.saved).slice(11, 16)) + '</span>' : '<span class="csst">아직 저장 전</span>';
}
function renderCsCk() {
  const k = S.ck;
  if (!k) return topbar('공사장 점검 ›', '불러오는 중') + '<div class="wrap list"><div class="banner b-gray">불러오는 중…</div></div>';
  const c = csCnt(k), left = k.items.length - c['양호'] - c['미흡'] - c['해당없음'];
  const R = CS_RD[k.round - 1];
  return topbar(csDay(k.date) + ' 공사장 점검', k.site.name) + '<div class="wrap list" style="padding-bottom:120px">' + csTabsHtml(k) +
    '<div class="card csmeta"><div><small>현장</small><b>' + h(k.site.name) + '</b></div><div><small>공사 내용 · 업체</small><b>' + h([k.site.work, k.site.co].filter(Boolean).join(' · ') || '-') + '</b></div>' +
    '<div><small>점검자 <em>자동</em></small><b>' + h(k.check ? k.check.by : S.user.name) + '</b></div><div><small>' + R + ' 시각 <em>자동</em></small><b>' + h(k.check ? k.check.at : '처음 저장할 때') + '</b></div></div>' +
    k.items.map(csItemHtml).join('') +
    '<button class="btn big csadd" onclick="csExtraOpen()">＋ 이 현장에 점검 항목 추가</button></div>' +
    '<div class="csbar"><div class="csbar-in"><div><b>미흡 ' + c['미흡'] + ' · 양호 ' + c['양호'] + (c['해당없음'] ? ' · 해당없음 ' + c['해당없음'] : '') + '</b>' + (left ? ' · 안 고름 ' + left : '') + '<br><span id="csSt">' + csStateHtml() + '</span></div>' +
    '<div class="dslot" id="csSlot">' + csSlotHtml(k) + '</div></div></div>';
}
function csItemHtml(x, i) {
  return '<div class="card csit' + (x.st === '미흡' ? ' bad' : '') + '"><h3><span>' + (i + 1) + '. ' + h(x.t) + '</span>' + (x.extra ? '<button class="btn sm warn" onclick="csExtraDel(' + i + ')">지우기</button>' : '') + '</h3>' +
    '<p>' + h(x.d) + '</p>' +
    '<div class="seg csseg" role="group" aria-label="' + h(x.t) + ' 결과">' + CS_ST.map(s => '<button type="button" class="' + s[1] + (x.st === s[0] ? ' on' : '') + '" aria-pressed="' + (x.st === s[0]) + '" onclick="csSt(' + i + ',\'' + s[0] + '\')">' + s[0] + '</button>').join('') + '</div>' +
    '<div class="csph">' + x.photos.map((p, j) => '<div class="ph43"><img src="' + h(p.src) + '" alt="' + h(x.t) + ' 사진 ' + (j + 1) + '"><span class="tm">' + h(p.at) + ' 촬영</span><button class="x" onclick="csPhDel(' + i + ',' + j + ')" aria-label="사진 지우기">✕</button></div>').join('') +
    '</div>' + csPhBar(x, i) +
    '<textarea class="inp csmemo" maxlength="300" placeholder="특이사항 (미흡이면 꼭 적기)" oninput="csMemo(' + i + ',this)">' + h(x.memo) + '</textarea></div>';
}
function csSt(i, s) { const x = S.ck.items[i]; x.st = x.st === s ? '' : s; csDirty(); render(); }
function csMemo(i, el) { S.ck.items[i].memo = el.value; csDirty(); }
async function csPhAdd(i, el) {
  const fs = Array.from(el.files || []); el.value = ''; if (!fs.length) return;   // 같은 파일을 또 골라도 다시 들어오게 비움
  const x = S.ck.items[i], room = Math.max(0, CS_MAX_PHOTOS - x.photos.length);   // 예전에 5~6장 넣은 항목은 그대로 두고 더 못 넣음
  try { for (const f of fs.slice(0, room)) x.photos.push({ id: '', src: await shrinkJpeg(f, 1600, 0.7), at: csNow() }); } catch (e) { toast(e.message); }
  csDirty(true); render();
  if (fs.length > room) toast('사진은 한 항목에 ' + CS_MAX_PHOTOS + '장까지입니다');
}
function csPhDel(i, j) { if (!confirm('이 사진을 지울까요?')) return; S.ck.items[i].photos.splice(j, 1); csDirty(); render(); }
function csExtraOpen() {
  dialog('<h3 class="ehdh">이 현장에 항목 추가</h3><p class="ehdp">이번 점검의 이 현장에만 들어갑니다. 모든 현장에 넣으려면 관리자에게 「기본 항목」을 고쳐 달라고 해 주세요.</p>' +
    '<label class="ehf">항목 이름<input class="inp" id="cxT" maxlength="30"></label><label class="ehf">설명 (점검 기준, 없어도 됨)<input class="inp" id="cxD" maxlength="100"></label>' +
    '<div id="cxM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button class="btn big pri" style="flex:2" onclick="csExtraAdd()">추가</button></div>');
  $('cxT').focus();
}
function csExtraAdd() {
  const t = $('cxT').value.trim(); if (!t) { $('cxM').textContent = '항목 이름을 넣어 주세요'; return; }
  S.ck.items.push({ t: t, d: $('cxD').value.trim(), st: '', memo: '', photos: [], extra: true });
  closeDialog(); csDirty(); render(); window.scrollTo(0, document.body.scrollHeight);
}
function csExtraDel(i) { if (!confirm('「' + S.ck.items[i].t + '」 항목을 지울까요?')) return; S.ck.items.splice(i, 1); csDirty(); render(); }
let CS_T = null;
function csDirty(now) { const k = S.ck; k.ver++; k.dirty = true; k.err = false; csStRefresh(); clearTimeout(CS_T); CS_T = setTimeout(csFlush, now ? 0 : 1500); }
function csStRefresh() { const e = $('csSt'); if (e && S.ck) e.innerHTML = csStateHtml(); const b = $('csSlot'); if (b && S.ck) b.innerHTML = csSlotHtml(S.ck); }
// [점검 끝] = 저장 + PDF, 끝나면 [PDF 보기], 고치면 다시 [점검 끝] (결정 176)
function csSlotHtml(k) {
  const dp = csDayPdf(k.rounds);
  return dp && !dp.stale && !k.dirty && !k.pdfBusy ? pdfBtn('big', 'PDF 보기', dp.url, { name: k.date + '_공사장점검-' + k.site.name + '.pdf', sub: '공사장 점검 ›' }) :
    '<button class="btn big pri" onclick="csPdf()"' + (k.pdfBusy ? ' disabled' : '') + '>' + (k.pdfBusy ? '<span class="spin"></span> PDF 만드는 중' : '점검 끝') + '</button>';
}
function csFlush() {
  const k = S.ck;
  if (!k) return Promise.resolve(true);
  if (k.saving) return k.saving.then(() => csFlush());
  if (!k.dirty) return Promise.resolve(!k.err);
  clearTimeout(CS_T);
  const ver = k.ver, sent = k.items.map(x => x.photos.slice());
  const body = k.items.map(x => ({ t: x.t, d: x.d, st: x.st, memo: x.memo, extra: !!x.extra, photos: x.photos.map(p => ({ id: p.id, at: p.at, data: p.id ? '' : p.src })) }));
  k.saving = call('csSave', k.date, k.site.id, body, k.round).then(r => {
    if (!r.ok) { k.err = true; toast(r.error); return false; }
    r.items.forEach((ids, i) => ids.forEach((id, j) => { if (sent[i] && sent[i][j]) sent[i][j].id = id; }));
    k.check = r.check; k.rounds = r.rounds; if (k.ver === ver) k.dirty = false;
    toast('자동 저장했습니다');
    return true;
  }, () => { k.err = true; return false; }).then(ok => {
    k.saving = null;
    if (S.ck === k && S.view === 'csck') { const a = document.activeElement; if (a && a.tagName === 'TEXTAREA') csStRefresh(); else render(); }   // 쓰는 중이면 글자 칸을 다시 그리지 않음
    return ok;
  });
  csStRefresh();
  return k.saving;
}
async function csLeave() {
  const k = S.ck;
  if (k && (k.dirty || k.saving)) {
    toast('저장하는 중…');
    if (!(await csFlush()) && !confirm('저장하지 못했습니다. 그래도 나갈까요? (고친 내용이 사라질 수 있습니다)')) return;
  }
  S.ck = null; go('cs'); loadCs();
}
async function csPdf() {
  const k = S.ck; if (k.pdfBusy) return;
  const left = k.items.filter(x => !x.st).length;
  if (left && !confirm('결과(양호·미흡·해당없음)를 고르지 않은 항목이 ' + left + '개 있습니다. 그래도 PDF를 만들까요?')) return;
  if (k.items.some(x => x.st === '미흡' && !x.memo.trim()) && !confirm('미흡인데 특이사항이 빈 항목이 있습니다. 그래도 PDF를 만들까요?')) return;
  if (!k.check) k.dirty = true;   // 한 번도 저장 안 했으면 먼저 저장 (점검자·시각이 찍힘)
  k.pdfBusy = true; render();
  try {
    if (!(await csFlush()) || !k.check) throw new Error('저장하지 못했습니다');
    await loadH2p();
    // 현장·하루 1개: 저장한 회차를 오전 → 오후 → 작업종료 순으로 (지금 회차는 화면 것, 나머지는 불러옴)
    const secs = [];
    for (const c of k.rounds) {
      if (c.round === k.round) { secs.push(k); continue; }
      const g = await call('csGet', k.date, k.site.id, c.round);
      if (!g.ok || !g.check) throw new Error(g.error || CS_RD[c.round - 1] + ' 점검을 불러오지 못했습니다');
      secs.push(g);
    }
    const r = await call('csSavePdf', k.check.id, await csMakePdf(k, secs));
    if (!r.ok) throw new Error(r.error);
    k.check = r.check; k.rounds = r.rounds; toast(r.warn || 'PDF를 저장했습니다' + (secs.length > 1 ? ' (' + secs.map(x => CS_RD[x.round - 1]).join('·') + ')' : ''));
  } catch (e) { toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
  k.pdfBusy = false; if (S.ck === k) render();
}
/* PDF = A4 세로, 현장·하루 1파일, 회차마다 새 쪽 (항목이 많으면 다음 쪽으로). 시안 docs/양식/WS_공사장점검_시안_pdf.png */
function csPdfHtml(k, i) {
  const c = csCnt(k), L = { '양호': 'ok', '미흡': 'bad', '해당없음': 'na' };
  return '<div class="cspdf"' + (i ? ' style="page-break-before:always"' : '') + '><div class="pt">공사장 안전점검 보고서</div><div class="ps">에비뉴엘 잠실점 시설팀 · ' + k.date.slice(0, 4) + '년 ' + csDay(k.date) + ' · <b>' + CS_RD[k.round - 1] + '</b></div>' +
    '<table><tr><th>현장</th><td>' + h(k.site.name) + '</td><th>공사 내용</th><td>' + h(k.site.work || '-') + '</td><th>업체</th><td>' + h(k.site.co || '-') + '</td></tr>' +
    '<tr><th>점검자</th><td>' + h(k.check.by) + '</td><th>점검 시각</th><td>' + h(k.check.at) + '</td><th>결과</th><td>' + (c['미흡'] ? '<b style="color:var(--error)">미흡 ' + c['미흡'] + '</b> · ' : '') + '양호 ' + c['양호'] + ' · 해당없음 ' + c['해당없음'] + '</td></tr></table>' +
    '<div class="g">' + k.items.map((x, i) => '<div class="pc"><h4><span>' + (i + 1) + '. ' + h(x.t) + '</span><em class="' + (L[x.st] || '') + '">' + (x.st || '안 고름') + '</em></h4><p>' + h(x.d) + '</p>' +
      '<div class="pp n' + x.photos.length + '">' + (x.photos.length ? x.photos.map(p => '<div class="cell"><img src="' + h(p.src) + '" alt=""></div>').join('') : '사진 없음') + '</div>' +
      '<div class="cm">' + h(x.memo) + '</div></div>').join('') + '</div>' +
    '<div class="ft"><span>출력 ' + csNow(true) + ' · 업무지원 앱</span><span>' + h(k.site.name) + ' · ' + CS_RD[k.round - 1] + '</span></div></div>';
}
async function csMakePdf(k, secs) {
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
  wrap.innerHTML = '<div style="width:734px">' + secs.map(csPdfHtml).join('') + '</div>'; document.body.appendChild(wrap);
  const pg = wrap.firstChild;
  try {
    try { if (document.fonts) await document.fonts.ready; } catch (e) {}
    await Promise.all([...pg.querySelectorAll('img')].map(im => im.decode ? im.decode().catch(() => {}) : null));
    // 사진은 자르지 않고 칸에 맞춰 줄임 (03 9장) — PDF 도구가 object-fit을 못 읽어 크기를 직접 정함
    pg.querySelectorAll('.cell img').forEach(im => {
      const c = im.parentNode, sc = Math.min(c.clientWidth / im.naturalWidth, c.clientHeight / im.naturalHeight) || 1;
      im.style.width = Math.floor(im.naturalWidth * sc) + 'px'; im.style.height = Math.floor(im.naturalHeight * sc) + 'px';
    });
    const keepY = window.scrollY; window.scrollTo(0, 0);
    try {
      return await html2pdf().set({
        margin: [30, 30, 30, 30], filename: k.date + '_공사장점검.pdf', image: { type: 'jpeg', quality: 0.9 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 734 },
        jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait', hotfixes: ['px_scaling'] },
        pagebreak: { mode: ['css'], avoid: ['.pc', 'tr'] }
      }).from(pg).outputPdf('datauristring');
    } finally { window.scrollTo(0, keepY); }
  } finally { wrap.remove(); }
}

