/* ── 서류작업 › 주간/야간 작업내역 (WS_주야간작업내역, 결정 240): 주간작업 = 사진 전·후 + 사용자재 → 종합업무일지 금일작업 · 야간작업 = 현장·방염서류·각서 사진 → 인쇄 A4 / PDF ── */
const WH_PARTS = [['전기방재', '전기·방재'], ['기계건축', '기계·건축']];
const WH_API = { d: ['dwList', 'dwSave', 'dwDelete'], n: ['dnList', 'dnSave', 'dnDelete'] };
const WH_TITLE = { d: '주간 작업내역', n: '야간 작업내역' };
function whNew(k) {
  const u = S.user || {}, part = u.part === '전방파트' ? ['전기방재'] : u.part === '기건파트' ? ['기계건축'] : [];
  return k === 'n' ? { id: '', day: rwToday(), co: '', floor: '', content: '', note: '', photos: [], fire: [], pledge: [] }
    : { id: '', day: rwToday(), parts: part, workers: u.name || '', floor: '', content: '', mats: [{ n: '', q: '', u: '' }], note: '', before: [], after: [] };
}
async function openWh() {
  S.wh = S.wh || { tab: 'd', v: null, d: { list: null, q: '', qv: '', f: whNew('d'), dirty: false, busy: false, keys: [], open: {}, dflt: [] }, n: { list: null, q: '', qv: '', f: whNew('n'), dirty: false, busy: false, keys: [], open: {}, dflt: [] } };
  go('wh'); await whLoad(S.wh.tab);
}
async function whLoad(k) {
  const o = S.wh[k]; let r;
  try { r = await call(WH_API[k][0], o.q, '', ''); } catch (e) { return; }
  if (!r.ok) return toast(r.error || '불러오지 못했습니다');
  o.list = r.list; if (S.view === 'wh') render();
}
function whTab(k) { const w = S.wh; if (w.tab === k) return; w.tab = k; if (!w[k].list) whLoad(k); render(); }
function whSearch() { const o = S.wh[S.wh.tab]; o.q = o.qv.trim(); whLoad(S.wh.tab); }
function whNewForm() { const o = S.wh.n; if (o.dirty && !confirm('저장하지 않은 내용이 있습니다. 새로 쓸까요?')) return; o.f = whNew('n'); o.sl = {}; o.dirty = false; render(); window.scrollTo(0, 0); }
function whEdit(id) {
  const k = S.wh.tab, o = S.wh[k], x = o.list.find(y => y.id === id); if (!x) return;
  if (o.dirty && !confirm('저장하지 않은 내용이 있습니다. 다른 작업을 열까요?')) return;
  o.sl = {}; o.f = JSON.parse(JSON.stringify(x)); if (k === 'd' && !o.f.mats.length) o.f.mats.push({ n: '', q: '', u: '' });
  o.dirty = false; render(); window.scrollTo(0, 0);
}
function whDirty() { const o = S.wh[S.wh.tab]; o.dirty = true; const e = $('whState'); if (e) e.innerHTML = whState(); }
function whState() { const o = S.wh[S.wh.tab]; return o.dirty ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : o.f && o.f.id ? '<span class="nwstate">' + ICON.ok + '저장됨</span>' : ''; }
function whIn(fld, el) { S.wh[S.wh.tab].f[fld] = el.value; whDirty(); }
function whPart(key, el) { const f = S.wh.d.f, i = f.parts.indexOf(key); if (el.checked && i < 0) f.parts.push(key); if (!el.checked && i >= 0) f.parts.splice(i, 1); whDirty(); }
function whFloor(fl) { const f = S.wh[S.wh.tab].f; f.floor = f.floor === fl ? '' : fl; whDirty(); render(); }
function whMat(i, key, el) { S.wh.d.f.mats[i][key] = el.value; whDirty(); }
function whMatAdd() { const m = S.wh.d.f.mats; if (m.length >= 20) return toast('자재는 20줄까지 넣을 수 있습니다'); m.push({ n: '', q: '', u: '' }); whDirty(); render(); }
function whMatRm(i) { const m = S.wh.d.f.mats; m.splice(i, 1); if (!m.length) m.push({ n: '', q: '', u: '' }); whDirty(); render(); }

/* 사진 칸 (스크린샷의 「회의 사진」 칸 모양): 제목 · 큰 4:3 칸 · 아래 카메라/파일 버튼 */
function whBtns(k, fld, i, multi) {
  const pick = cam => '<label class="btn whbt">' + (cam ? ICON.cam + ' 카메라' : ICON.folder + ' 파일') + '<input type="file" accept="image/*"' + (cam ? ' capture="environment"' : multi ? ' multiple' : '') + ' hidden onchange="whAdd(\'' + k + '\',\'' + fld + '\',this,' + i + ')"></label>';
  return '<div class="whbs">' + pick(1) + pick(0) + '</div>';
}
function whTile(k, fld, p, i) {
  return '<div class="wht"><button type="button" class="whim" onclick="whView(\'' + k + '\',\'' + fld + '\',' + i + ')" aria-label="사진 ' + (i + 1) + ' 크게 보기"><img src="' + h(p.src) + '" alt=""></button>' +
    '<button type="button" class="whx" onclick="whRm(\'' + k + '\',\'' + fld + '\',' + i + ')" aria-label="사진 지우기">' + ICON.x + '</button></div>';
}
function whSlots(k, fld, title, max) {   // 주간: 칸 하나에 사진 한 장, 칸마다 카메라/파일 (예전에 더 넣어 둔 사진은 칸을 더 보여 줌)
  const L = S.wh[k].f[fld], n = Math.max(max, L.length);
  return '<div class="whcol">' + Array.from({ length: n }, (_, i) => '<div class="whpc"><h4>' + title + ' ' + (i + 1) + '</h4>' + (L[i] ? whTile(k, fld, L[i], i) : '<div class="whim empty">사진 없음</div>') + whBtns(k, fld, i, false) + '</div>').join('') + '</div>';
}
const WH_MAX = 20;
function whMulti(k, fld, title) {   // 야간: 주간과 같은 칸 모양, 처음 2칸 · ＋ 버튼으로 20칸까지, 휴대폰 2열 · PC 4열
  const o = S.wh[k], L = o.f[fld], n = Math.max(2, L.length, (o.sl && o.sl[fld]) || 0);
  return '<div class="whsec"><h4>' + title + '<small>' + L.length + '장 / ' + WH_MAX + '장</small></h4><div class="whg">' +
    Array.from({ length: n }, (_, i) => '<div class="whpc"><h4>' + title + ' ' + (i + 1) + '</h4>' + (L[i] ? whTile(k, fld, L[i], i) : '<div class="whim empty">사진 없음</div>') + whBtns(k, fld, i, true) + '</div>').join('') + '</div>' +
    '<button type="button" class="btn whplus" onclick="whPlus(\'' + k + '\',\'' + fld + '\')"' + (n >= WH_MAX ? ' disabled' : '') + '>' + ICON.plus + ' 사진 칸 추가 (' + n + ' / ' + WH_MAX + ')</button></div>';
}
function whPlus(k, fld) { const o = S.wh[k]; o.sl = o.sl || {}; o.sl[fld] = Math.min(WH_MAX, Math.max(2, o.f[fld].length, o.sl[fld] || 0) + 1); render(); }
function whFloors(f) { return '<div class="rwfls">' + RW_FLOORS.map(x => '<button type="button" class="rwfl' + (f.floor === x ? ' on' : '') + '" aria-pressed="' + (f.floor === x) + '" onclick="whFloor(\'' + x + '\')">' + x + '</button>').join('') + '</div>'; }
function whFormD(f) {
  return '<div class="card whf"><label class="rwlb">일자</label><input class="inp" type="date" max="' + rwToday() + '" value="' + h(f.day) + '" onchange="whIn(\'day\',this)" aria-label="일자">' +
    '<div class="rwlb">파트 (일지 금일작업에 들어갈 곳)</div><div class="whck">' + WH_PARTS.map(p => '<label><input type="checkbox"' + (f.parts.indexOf(p[0]) >= 0 ? ' checked' : '') + ' onchange="whPart(\'' + p[0] + '\',this)"> ' + p[1] + '</label>').join('') + '</div>' +
    '<label class="rwlb">작업자</label><input class="inp" maxlength="60" placeholder="예: 홍길동, 김철수" value="' + h(f.workers) + '" oninput="whIn(\'workers\',this)">' +
    '<div class="rwlb">작업위치 (버튼으로 선택)</div>' + whFloors(f) +
    '<label class="rwlb">작업내용</label><textarea class="inp" rows="3" maxlength="300" oninput="whIn(\'content\',this)">' + h(f.content) + '</textarea>' +
    '<div class="whsplit">' + whSlots('d', 'before', '작업 전', 2) + whSlots('d', 'after', '작업 후', 2) + '</div>' +
    '<div class="rwlb">사용자재 (이름 · 수량 · 단위)</div>' + f.mats.map((m, i) => '<div class="whmat"><input class="inp" maxlength="30" placeholder="자재 이름" value="' + h(m.n) + '" oninput="whMat(' + i + ',\'n\',this)" aria-label="자재 이름">' +
      '<input class="inp" maxlength="10" inputmode="decimal" placeholder="수량" value="' + h(m.q) + '" oninput="whMat(' + i + ',\'q\',this)" aria-label="수량"><input class="inp" maxlength="10" placeholder="단위" value="' + h(m.u) + '" oninput="whMat(' + i + ',\'u\',this)" aria-label="단위">' +
      '<button type="button" class="btn sm" onclick="whMatRm(' + i + ')" aria-label="자재 줄 지우기">' + ICON.x + '</button></div>').join('') +
    '<button type="button" class="btn sm" onclick="whMatAdd()">' + ICON.plus + ' 자재 추가</button>' +
    '<label class="rwlb">비고</label><textarea class="inp" rows="2" maxlength="300" oninput="whIn(\'note\',this)">' + h(f.note) + '</textarea>' + whDelBtn(f) + '</div>';
}
function whFormN(f) {
  return '<div class="card whf">' + whMulti('n', 'photos', '현장 사진') +
    '<div class="whtwo"><div><label class="rwlb">일자</label><input class="inp" type="date" max="' + rwToday() + '" value="' + h(f.day) + '" onchange="whIn(\'day\',this)" aria-label="일자"></div>' +
    '<div><label class="rwlb">업체명 (직접 입력)</label><input class="inp" maxlength="30" placeholder="예: OO인테리어" value="' + h(f.co) + '" oninput="whIn(\'co\',this)"></div></div>' +
    '<div class="rwlb">작업위치 (버튼으로 선택)</div>' + whFloors(f) +
    '<label class="rwlb">작업내용</label><textarea class="inp" rows="3" maxlength="300" oninput="whIn(\'content\',this)">' + h(f.content) + '</textarea>' +
    whMulti('n', 'fire', '방염서류') + whMulti('n', 'pledge', '각서') +
    '<small class="rwhint">서류 사진은 누르면 크게 볼 수 있습니다. 흐리거나 어두우면 「다시 찍으세요」 안내가 나옵니다. 서류 사진은 일반 사진보다 덜 줄여 저장합니다.</small>' +
    '<label class="rwlb">기타사항</label><textarea class="inp" rows="2" maxlength="300" oninput="whIn(\'note\',this)">' + h(f.note) + '</textarea>' + whDelBtn(f) + '</div>';
}
function whDelBtn(f) { return f.id ? '<button type="button" class="btn sm whdel" onclick="whDel()">이 작업 삭제</button>' : ''; }
/* 목록 묶기: 월 → 주(일~토) → 일. 가장 최근 달·주만 펼침, 머리줄을 누르면 열고 닫음 */
function whWeek(day) { const d = new Date(day + 'T00:00:00Z'), a = new Date(d - d.getUTCDay() * 864e5), z = new Date(+a + 6 * 864e5), f = x => x.toISOString().slice(0, 10); return [f(a), f(z)]; }
function whAcc(key) { const o = S.wh[S.wh.tab]; const cur = key in o.open ? o.open[key] : o.dflt.indexOf(key) !== -1; o.open[key] = !cur; render(); }
function whListHtml(k) {
  const o = S.wh[k]; if (!o.list) return '<div class="banner b-gray">불러오는 중…</div>';
  if (!o.list.length) return '<div class="banner b-gray">' + (o.q ? '찾는 작업이 없습니다' : k === 'd' ? '저장된 주간작업이 없습니다' : '저장된 야간작업이 없습니다') + '</div>';
  const bad = (t, n) => n ? '' : '<span class="whb">' + t + ' 없음</span>';
  const row = x => '<button type="button" class="whrow' + (o.f && o.f.id === x.id ? ' on' : '') + '" onclick="whEdit(&quot;' + x.id + '&quot;)"><b>' + h(x.day.slice(5).replace('-', '/')) + (x.floor ? ' · ' + h(x.floor) : '') + (k === 'n' ? ' · ' + h(x.co) : '') + '</b>' +
    '<span>' + h(x.content) + '</span><small>' + (k === 'd' ? h(x.workers) + ' · ' + x.parts.map(p => (WH_PARTS.find(y => y[0] === p) || [0, p])[1]).join('·') + ' · 사진 ' + (x.before.length + x.after.length) + '장'
      : '현장 ' + x.photos.length + '장 ' + bad('방염서류', x.fire.length) + bad('각서', x.pledge.length)) + '</small></button>';
  const mons = []; o.list.forEach(x => {   // 목록은 최근 날짜가 위
    const m = x.day.slice(0, 7), w = whWeek(x.day)[0]; let M = mons.find(y => y.m === m); if (!M) mons.push(M = { m, n: 0, wk: [] });
    let W = M.wk.find(y => y.w === w); if (!W) M.wk.push(W = { w, list: [] }); W.list.push(x); M.n++;
  });
  o.dflt = ['m:' + mons[0].m, 'w:' + mons[0].m + ':' + mons[0].wk[0].w];
  const on = key => key in o.open ? o.open[key] : o.dflt.indexOf(key) !== -1;
  const hd = (key, cls, t, n) => '<button type="button" class="csacc ' + cls + (on(key) ? ' on' : '') + '" aria-expanded="' + on(key) + '" onclick="whAcc(&quot;' + key + '&quot;)"><b>' + t + '</b><span class="csn">' + n + '건</span><span class="csar" aria-hidden="true"></span></button>';
  const f = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));
  return '<div class="card rwres">' + mons.map(M => hd('m:' + M.m, 'whmo', M.m.slice(0, 4) + '년 ' + Number(M.m.slice(5)) + '월', M.n) + (on('m:' + M.m) ? M.wk.map(W => {
    const key = 'w:' + M.m + ':' + W.w, r = whWeek(W.w);
    return hd(key, 'whwk', f(r[0]) + '(일) ~ ' + f(r[1]) + '(토)', W.list.length) + (on(key) ? W.list.map(row).join('') : '');
  }).join('') : '')).join('') + '</div>';
}
/* 주간보고 (엑셀): 기준일이 있는 주(일~토)의 고른 파트 작업내용 + 전·후 사진을 한 파일로 PC에 내려받음. 엑셀 도구(ExcelJS)는 처음 쓸 때 불러옴 */
let XJ = null;
function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve();
  return XJ || (XJ = new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    sc.onload = ok; sc.onerror = () => { XJ = null; no(new Error('엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.appendChild(sc);
  }));
}
function whRepToggle() { const w = S.wh; w.rep = w.rep || { open: false, day: rwToday(), parts: w.d.f.parts.slice(), busy: false }; w.rep.open = !w.rep.open; render(); }
function whRepPart(key, el) { const r = S.wh.rep, i = r.parts.indexOf(key); if (el.checked && i < 0) r.parts.push(key); if (!el.checked && i >= 0) r.parts.splice(i, 1); }
function whRepDay(el) { S.wh.rep.day = el.value || rwToday(); render(); }
function whRepHtml() {
  const r = S.wh.rep; if (!r || !r.open) return '';
  const w = whWeek(r.day);
  return '<div class="card whrep"><b>주간보고작성</b><div class="whrl"><label>기준일 <input class="inp" type="date" value="' + h(r.day) + '" onchange="whRepDay(this)"></label><small>' + w[0].slice(5).replace('-', '/') + '(일) ~ ' + w[1].slice(5).replace('-', '/') + '(토) 작업을 모읍니다</small></div>' +
    '<div class="whrl whck">' + WH_PARTS.map(p => '<label><input type="checkbox"' + (r.parts.indexOf(p[0]) >= 0 ? ' checked' : '') + ' onchange="whRepPart(&quot;' + p[0] + '&quot;,this)"> ' + p[1] + '</label>').join('') + '</div>' +
    '<button class="btn pri" onclick="whRepGo()"' + (r.busy ? ' disabled' : '') + '>' + (r.busy ? '<span class="spin"></span>' : ICON.dl + '엑셀 저장') + '</button></div>';
}
async function whImg(src) {
  const rs = await fetch(src); if (!rs.ok) throw new Error('사진을 가져오지 못했습니다');
  const b = await rs.blob(), u = URL.createObjectURL(b);
  const d = await new Promise(ok => { const im = new Image(); im.onload = () => ok([im.naturalWidth, im.naturalHeight]); im.onerror = () => ok([4, 3]); im.src = u; });
  URL.revokeObjectURL(u); return { buf: await b.arrayBuffer(), w: d[0], h: d[1] };
}
async function whExcel(list, from, to, parts) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('주간보고'), lab = parts.map(p => (WH_PARTS.find(y => y[0] === p) || [0, p])[1]).join('·');
  const bd = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  ws.columns = [12, 12, 14, 8, 40, 26, 20, 27, 27, 27, 27].map(width => ({ width }));
  ws.mergeCells('A1:K1'); ws.getCell('A1').value = '주간 작업 보고 (' + from + ' ~ ' + to + ')'; ws.getCell('A1').font = { bold: true, size: 16 };
  ws.mergeCells('A2:K2'); ws.getCell('A2').value = '에비뉴엘 잠실점 시설팀 · ' + lab + ' · ' + list.length + '건';
  const hr = ws.getRow(4); hr.values = ['일자', '파트', '작업자', '위치', '작업내용', '사용자재', '비고', '작업 전 1', '작업 전 2', '작업 후 1', '작업 후 2'];
  hr.font = { bold: true }; hr.alignment = { horizontal: 'center', vertical: 'middle' };
  hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } }; c.border = bd; });
  let r = 5;
  for (const x of list) {
    const dw = '일월화수목금토'[new Date(x.day + 'T00:00:00Z').getUTCDay()], row = ws.getRow(r); row.height = 112;
    row.values = [x.day.slice(5).replace('-', '/') + '(' + dw + ')', x.parts.map(p => (WH_PARTS.find(y => y[0] === p) || [0, p])[1]).join('·'), x.workers, x.floor, x.content,
      x.mats.map(m => m.n + (m.q ? ' ' + m.q : '') + (m.u || '')).join(String.fromCharCode(10)), x.note];
    for (let c = 1; c <= 11; c++) { const cell = row.getCell(c); cell.alignment = { vertical: 'top', wrapText: true }; cell.border = bd; }
    const pics = x.before.slice(0, 2).map((p, i) => [7 + i, p]).concat(x.after.slice(0, 2).map((p, i) => [9 + i, p]));
    for (const [col, p] of pics) {
      try {
        const im = await whImg(p.src), sc = Math.min(184 / im.w, 139 / im.h, 1), id = wb.addImage({ buffer: im.buf, extension: 'jpeg' });
        ws.addImage(id, { tl: { col: col + 0.04, row: r - 1 + 0.04 }, ext: { width: Math.round(im.w * sc), height: Math.round(im.h * sc) } });
      } catch (e) { ws.getCell(r, col + 1).value = '(사진을 가져오지 못함)'; }
    }
    r++;
  }
  const buf = await wb.xlsx.writeBuffer(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = '주간보고_' + from + '~' + to + '_' + lab + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function whRepGo() {
  const rp = S.wh.rep; if (rp.busy) return;
  if (!rp.parts.length) return toast('파트를 하나 이상 골라 주세요');
  const w = whWeek(rp.day); rp.busy = true; render();
  try {
    const r = await call('dwList', '', w[0], w[1]); if (!r.ok) throw new Error(r.error || '불러오지 못했습니다');
    const L = r.list.filter(x => x.day >= w[0] && x.day <= w[1] && x.parts.some(p => rp.parts.indexOf(p) !== -1)).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
    if (!L.length) { rp.busy = false; render(); return toast('그 주에 고른 파트의 작업이 없습니다'); }
    await loadExcelJs(); await whExcel(L, w[0], w[1], rp.parts);
    rp.busy = false; render(); toast('엑셀을 저장했습니다 (' + L.length + '건)');
  } catch (e) { rp.busy = false; render(); toast('엑셀을 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
}
function renderWh() {
  const w = S.wh, k = w.tab, o = w[k];
  const tabs = '<div class="seg cltabs" role="tablist" aria-label="작업내역 종류">' + [['d', '주간작업'], ['n', '야간작업']].map(t => '<button type="button" role="tab" aria-selected="' + (t[0] === k) + '" class="' + (t[0] === k ? 'on' : '') + '" onclick="whTab(\'' + t[0] + '\')">' + t[1] + '</button>').join('') + '</div>';
  const srch = '<div class="cssec"><label class="cssrch"><input id="whQ" type="search" enterkeyhint="search" placeholder="' + (k === 'd' ? '일자 · 위치 · 내용 · 작업자' : '층 · 업체 · 작업내용') + '" aria-label="검색" value="' + h(o.qv) + '" oninput="S.wh.' + k + '.qv=this.value" onkeydown="if(event.key===\'Enter\')whSearch()"></label>' +
    '<button class="btn pri" onclick="whSearch()">검색하기</button>' + (k === 'n' ? '<button class="btn" onclick="whNewForm()">신규작성</button>' : '') + '</div>';
  const form = o.f ? (k === 'd' ? whFormD(o.f) : whFormN(o.f)) : '';
  const bar = o.f ? '<div class="nwbar" id="whBar"><span id="whState">' + whState() + '</span><button class="btn" onclick="whPrint()">' + ICON.print + '인쇄 A4</button>' +
    '<button class="btn" onclick="whPdf()"' + (o.pdfBusy ? ' disabled' : '') + '>' + (o.pdfBusy ? '<span class="spin"></span>' : ICON.file + 'PDF 보기') + '</button>' +
    '<button class="btn pri" onclick="whSave()"' + (o.busy ? ' disabled' : '') + '>' + (o.busy ? '<span class="spin"></span>' : '저장') + '</button></div>' : '';
  return topbar('서류작업 ›', '주간/야간 작업내역') + '<div class="wrap list">' + tabs + (k === 'd' ? form + srch : srch + form) +
    '<div class="cssec">' + (o.q ? '「' + h(o.q) + '」 검색 결과' : '최근 60일') + ' · ' + (o.list ? o.list.length : '…') + '건' + (k === 'd' ? '<button class="btn" onclick="whRepToggle()">주간보고작성</button>' : '') + '</div>' + (k === 'd' ? whRepHtml() : '') + whListHtml(k) + bar + '</div>';
}

/* 사진 넣기: 현장·작업 사진 1600px·70%, 서류(방염·각서)는 글자가 읽히게 2400px·85%. 서류가 흐리거나 어두우면 다시 찍으라고 알림 */
function whQuality(uri) {
  return new Promise(ok => {
    const im = new Image();
    im.onload = () => {
      const w = 320, hh = Math.max(1, Math.round(w * im.naturalHeight / im.naturalWidth)), c = document.createElement('canvas'); c.width = w; c.height = hh;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, w, hh); const p = g.getImageData(0, 0, w, hh).data, L = [];
      for (let i = 0; i < p.length; i += 4) L.push(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]);
      if (L.reduce((a, b) => a + b, 0) / L.length < 45) return ok('어둡습니다');
      let d = 0, n = 0; for (let y = 0; y < hh; y++) for (let x = 1; x < w; x++) { d += Math.abs(L[y * w + x] - L[y * w + x - 1]); n++; }
      ok(d / n < 1.2 ? '흐립니다' : '');   // shortcut: 대충 거르는 기준 — 현장에서 써 보고 숫자 조정
    };
    im.onerror = () => ok(''); im.src = uri;
  });
}
async function whAdd(k, fld, el, at) {
  const fs = Array.from(el.files || []); el.value = ''; if (!fs.length) return;
  const o = S.wh[k], L = o.f[fld], max = k === 'd' ? 2 : WH_MAX, doc = fld === 'fire' || fld === 'pledge'; let dup = 0, cut = 0, bad = '';
  for (const f of fs) {
    if (L.length >= max && !(at >= 0 && at < L.length)) { cut++; continue; }
    const key = f.name + '|' + f.size + '|' + f.lastModified;
    if (o.keys.indexOf(key) !== -1) { dup++; continue; }
    try {
      const data = await (doc ? shrinkJpeg(f, 2400, 0.85) : shrinkJpeg(f, 1600, 0.7));
      if (at >= 0 && at < L.length) L[at] = { data, src: data }; else L.push({ data, src: data }); o.keys.push(key); at = -1; if (o.keys.length > 80) o.keys.shift();
      if (doc && !bad) bad = await whQuality(data);
    } catch (e) { toast(e.message); }
  }
  if (cut) toast('사진은 ' + max + '장까지 넣을 수 있습니다');
  else if (dup) toast(dup + '장은 이미 넣은 사진이라 건너뜁니다');
  if (bad) toast('서류 사진이 ' + bad + '. 다시 찍어 주세요');
  whDirty(); render();
}
function whRm(k, fld, i) { if (!confirm('이 사진을 지울까요?')) return; S.wh[k].f[fld].splice(i, 1); whDirty(); render(); }
function whView(k, fld, i) { S.wh.v = { list: S.wh[k].f[fld].map(p => p.src), i, z: 1 }; whVDraw(); }
function whVDraw() {
  const v = S.wh.v;
  $('layer').innerHTML = '<div class="rwv" role="dialog" aria-modal="true"><div class="rwvh"><span>' + (v.i + 1) + ' / ' + v.list.length + '</span><button class="btn sm" onclick="whVClose()">닫기</button></div>' +
    '<div class="rwvb"><img src="' + h(v.list[v.i]) + '" style="width:' + v.z * 100 + '%" alt="확대 사진"></div>' +
    '<div class="rwvf"><button class="btn sm" onclick="whVNav(-1)"' + (v.i ? '' : ' disabled') + '>이전</button><button class="btn sm" onclick="whVZoom(-0.5)" aria-label="작게">−</button><b>' + Math.round(v.z * 100) + '%</b><button class="btn sm" onclick="whVZoom(0.5)" aria-label="크게">＋</button><button class="btn sm" onclick="whVNav(1)"' + (v.i < v.list.length - 1 ? '' : ' disabled') + '>다음</button></div></div>';
}
function whVClose() { S.wh.v = null; closeDialog(); }
function whVNav(d) { const v = S.wh.v; v.i = Math.max(0, Math.min(v.list.length - 1, v.i + d)); v.z = 1; whVDraw(); }
function whVZoom(d) { const v = S.wh.v; v.z = Math.max(1, Math.min(4, v.z + d)); whVDraw(); }

/* 저장 / 삭제 */
function whPics4(l) { return l.map(p => p.id ? { id: p.id } : { data: p.data }); }
async function whSave() {
  const k = S.wh.tab, o = S.wh[k], f = o.f; if (o.busy) return;
  if (k === 'd' && !f.parts.length) return toast('파트를 하나 이상 골라 주세요');
  if (k === 'n' && !f.co.trim()) return toast('업체명을 입력해 주세요');
  if (!f.content.trim()) return toast('작업내용을 입력해 주세요');
  const d = k === 'd' ? { id: f.id, day: f.day, parts: f.parts, workers: f.workers, floor: f.floor, content: f.content, mats: f.mats, note: f.note, before: whPics4(f.before), after: whPics4(f.after) }
    : { id: f.id, day: f.day, co: f.co, floor: f.floor, content: f.content, note: f.note, photos: whPics4(f.photos), fire: whPics4(f.fire), pledge: whPics4(f.pledge) };
  o.busy = true; render();
  try {
    const r = await call(WH_API[k][1], d); o.busy = false;
    if (!r.ok) { render(); return toast(r.error || '저장하지 못했습니다'); }
    if (o.list) { const i = o.list.findIndex(x => x.id === r.item.id); if (i >= 0) o.list[i] = r.item; else o.list.unshift(r.item); o.list.sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0); }
    o.f = whNew(k); o.sl = {}; o.keys = [];   // 저장하면 빈 양식 (저장한 작업은 아래 목록에서 눌러 다시 고침)
    o.dirty = false; render(); window.scrollTo(0, 0); toast(k === 'd' ? '저장했습니다 · 종합업무일지 금일작업에도 들어갑니다' : '저장했습니다');
  } catch (e) { o.busy = false; render(); }
}
async function whDel() {
  const k = S.wh.tab, o = S.wh[k]; if (!o.f.id || !confirm('이 작업을 지울까요?' + (k === 'd' ? ' (종합업무일지 금일작업에서도 빠집니다)' : ''))) return;
  try {
    const r = await call(WH_API[k][2], o.f.id); if (!r.ok) return toast(r.error);
    if (o.list) o.list = o.list.filter(x => x.id !== o.f.id);
    o.f = whNew(k); o.dirty = false; render(); toast('지웠습니다');
  } catch (e) { /* call() 이 알림 */ }
}

/* 인쇄 · PDF 쪽 만들기. 주간 = 1쪽. 야간 = ① 내용+현장 사진 쪽 · 각서 쪽 (양면으로 붙임, 항상 2쪽) → ② 방염서류 사진 한 장 = 한 쪽 (단면, 맨 뒤) */
const WH_CSS = '.whp{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#000;background:#fff}.whp *{box-sizing:border-box}' +
  '.whp .pg{width:794px;height:1122px;padding:40px 44px;overflow:hidden;background:#fff;page-break-after:always;break-after:page;position:relative}.whp .pg:last-child{page-break-after:auto;break-after:auto}' +
  '.whp h1{font-size:22px;margin:0 0 4px}.whp .sub{font-size:11px;color:#444;margin-bottom:12px}.whp table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:10px}' +
  '.whp td,.whp th{border:1px solid #888;font-size:12px;padding:5px 7px;text-align:left;vertical-align:top;line-height:1.45;word-break:break-all}.whp th{background:#e8edf3;width:72px;font-weight:600}' +
  '.whp .bx{border:1px solid #888;padding:7px 9px;font-size:12px;line-height:1.5;min-height:48px;margin-bottom:10px;white-space:pre-wrap;word-break:break-all}.whp .bx b{display:block;font-size:11px;color:#444;margin-bottom:2px}' +
  '.whp .ph{display:flex;gap:0;border:1px solid #888}.whp .col{flex:1;min-width:0;padding:6px}.whp .col+.col{border-left:1px solid #888}.whp .col h4{margin:0 0 5px;font-size:12px}' +
  '.whp .gr{display:grid;gap:5px}.whp .cell{background:#f1f3f6;display:flex;align-items:center;justify-content:center;overflow:hidden}.whp .cell img{display:block}' +
  '.whp .none{font-size:12px;color:#666;padding:10px 0}.whp .full{position:absolute;left:44px;right:44px;top:70px;bottom:44px;display:flex;align-items:center;justify-content:center}.whp .full img{display:block}' +
  '.whp .ft{position:absolute;left:44px;right:44px;bottom:16px;font-size:10px;color:#666;display:flex;justify-content:space-between}.whp .pdfonly{color:#999}@media print{.whp .pdfonly{display:none}}';
function whGrid(l, W, H) {   // 장수에 맞춰 칸 수·크기를 정함 (많으면 줄여서 한 쪽에 모음). 칸이 모자라면 빈 칸은 안 그림
  if (!l.length) return '';
  const n = l.length, cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5, rows = Math.ceil(n / cols), gap = 5;
  const ch = Math.floor((H - gap * (rows - 1)) / rows), cw = Math.floor((W - gap * (cols - 1)) / cols), s = Math.min(ch, Math.round(cw * 0.75));
  return '<div class="gr" style="grid-template-columns:repeat(' + cols + ',1fr)">' + l.map(p => '<div class="cell" style="height:' + s + 'px"><img src="' + h(p.src) + '" alt=""></div>').join('') + '</div>';
}
function whDay(d) { return d.slice(0, 4) + '년 ' + Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일'; }
function whFt(t) { return '<div class="ft"><span>에비뉴엘 잠실점 시설팀 · 출력 ' + rwToday() + '</span><span>' + h(t) + '</span></div>'; }
function whPages(k) {
  const f = S.wh[k].f;
  if (k === 'd') {
    const mats = f.mats.filter(m => m.n.trim()), part = f.parts.map(p => (WH_PARTS.find(y => y[0] === p) || [0, p])[1]).join(' · ');
    return '<div class="pg"><h1>주간 작업내역</h1><div class="sub">에비뉴엘 잠실점 시설팀</div>' +
      '<table><tr><th>일자</th><td>' + h(whDay(f.day)) + '</td><th>파트</th><td>' + h(part) + '</td></tr><tr><th>작업자</th><td>' + h(f.workers) + '</td><th>작업위치</th><td>' + h(f.floor) + '</td></tr></table>' +
      '<div class="bx"><b>작업내용</b>' + h(f.content) + '</div>' +
      ((f.before.length || f.after.length) ? '<div class="ph"><div class="col"><h4>작업 전</h4>' + whGrid(f.before, 340, 560) + '</div><div class="col"><h4>작업 후</h4>' + whGrid(f.after, 340, 560) + '</div></div>' : '') +
      (mats.length ? '<table style="margin-top:10px"><tr><th>사용자재</th><th style="width:auto">이름</th><th style="width:90px">수량</th><th style="width:90px">단위</th></tr>' + mats.map(m => '<tr><td></td><td>' + h(m.n) + '</td><td>' + h(m.q) + '</td><td>' + h(m.u) + '</td></tr>').join('') + '</table>' : '') +
      (f.note.trim() ? '<div class="bx"><b>비고</b>' + h(f.note) + '</div>' : '') + whFt('주간 작업내역') + '</div>';
  }
  const head = '<h1>야간 작업내역</h1><div class="sub">에비뉴엘 잠실점 시설팀</div>';
  const p1 = '<div class="pg">' + head + '<table><tr><th>일자</th><td>' + h(whDay(f.day)) + '</td><th>업체명</th><td>' + h(f.co) + '</td></tr><tr><th>작업위치</th><td colspan="3">' + h(f.floor) + '</td></tr></table>' +
    '<div class="bx"><b>작업내용</b>' + h(f.content) + '</div>' + (f.note.trim() ? '<div class="bx"><b>기타사항</b>' + h(f.note) + '</div>' : '') +
    '<div class="bx" style="padding:6px"><b>현장 사진 (' + f.photos.length + '장)</b>' + (f.photos.length ? whGrid(f.photos, 690, 640) : '<div class="none">미첨부</div>') + '</div>' + whFt('야간 작업내역 ①') + '</div>';
  const p2 = '<div class="pg"><h1>각서</h1><div class="sub">' + h(f.co) + ' · ' + h(whDay(f.day)) + '</div>' + (f.pledge.length ? whGrid(f.pledge, 706, 940) : '<div class="none">각서 미첨부</div>') + whFt('야간 작업내역 ② 각서') + '</div>';
  const fire = f.fire.length ? f.fire.map((p, i) => '<div class="pg"><div class="sub">방염서류 ' + (i + 1) + '/' + f.fire.length + ' · ' + h(f.co) + ' · ' + h(whDay(f.day)) + ' <span class="pdfonly">· 이 쪽부터 단면 인쇄</span></div><div class="full"><img src="' + h(p.src) + '" alt=""></div></div>').join('')
    : '<div class="pg"><h1>방염서류</h1><div class="sub">' + h(f.co) + ' · ' + h(whDay(f.day)) + '</div><div class="none">방염서류 미첨부</div></div>';
  return p1 + p2 + fire;
}
/* 사진은 자르지 않고 칸에 맞춰 줄임 — PDF 도구가 object-fit 을 못 읽어 크기를 직접 정함 */
async function whFit(box) {
  try { if (document.fonts) await document.fonts.ready; } catch (e) {}
  const im = [...box.querySelectorAll('img')]; await Promise.all(im.map(i => i.decode ? i.decode().catch(() => {}) : null));
  box.querySelectorAll('.cell img,.full img').forEach(i => {
    const c = i.parentNode, sc = Math.min(c.clientWidth / i.naturalWidth, c.clientHeight / i.naturalHeight) || 1;
    i.style.width = Math.floor(i.naturalWidth * sc) + 'px'; i.style.height = Math.floor(i.naturalHeight * sc) + 'px';
  });
}
function whCheck() { const k = S.wh.tab, f = S.wh[k].f; if (!f.content.trim()) { toast('작업내용을 입력해 주세요'); return false; } return true; }
async function whPrint() {
  if (!whCheck()) return;
  const k = S.wh.tab; $('print').innerHTML = '<style>@page{size:A4;margin:0}' + WH_CSS + '</style><div class="whp">' + whPages(k) + '</div>';
  await whFit($('print')); setTimeout(() => window.print(), 100);
}
async function whPdf() {
  if (!whCheck()) return;
  const k = S.wh.tab, o = S.wh[k]; if (o.pdfBusy) return;
  o.pdfBusy = true; render();
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
  wrap.innerHTML = '<style>' + WH_CSS + '</style><div class="whp" style="width:794px">' + whPages(k) + '</div>'; document.body.appendChild(wrap);
  try {
    await loadH2p(); await whFit(wrap);
    const keepY = window.scrollY; window.scrollTo(0, 0);
    let blob; try {
      blob = await html2pdf().set({ margin: 0, filename: o.f.day + '_' + WH_TITLE[k] + '.pdf', image: { type: 'jpeg', quality: 0.9 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 794 },
        jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait', hotfixes: ['px_scaling'] }, pagebreak: { mode: ['css'] } }).from(wrap.querySelector('.whp')).outputPdf('blob');
    } finally { window.scrollTo(0, keepY); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.dataset.pv = JSON.stringify({ name: WH_TITLE[k], sub: o.f.day });
    o.pdfBusy = false; pdfOpen(a);
  } catch (e) { o.pdfBusy = false; render(); toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
  wrap.remove();
}
