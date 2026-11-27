/* ── 점검 › 매장 하자 점검 (WS_하자점검, 결정 266·340): 하자 칸(현장명·하자내용·사진 1장) 여러 개 → 인쇄 A4 / PDF + 현장책임자 손글씨 서명. 여러 직원이 같은 날·같은 매장을 함께 적으면 「＋」·저장 때 합침. 처리 기한 = 작성일 + 10일 자동 ── */
const DF_MAX = 40;
function dfKey() { return Math.random().toString(36).slice(2, 10); }   // 칸 고유 번호 (여러 직원 칸 합치기)
function dfNew() { return { id: '', day: rwToday(), items: [{ k: dfKey(), n: '', t: '', photo: null }], signSite: null }; }
function dfDue(day) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 10); return d.toISOString().slice(0, 10); }
async function openDf() {
  if (!window.WS_API) return toast('하자점검은 바로가기 앱(Supabase)에서만 열립니다');
  S.df = S.df || { list: null, f: dfNew(), dirty: false, busy: false, pdfBusy: false, pdfUrl: null, keys: [], open: {}, q: '', rm: [] };
  Object.assign(S.df, { f: dfNew(), dirty: false, pdfUrl: null, keys: [], q: '', rm: [] });   // 메뉴를 누르면 늘 빈 양식 (전에 열었던 점검서 안 남음)
  go('df'); await dfLoad();
}
async function dfLoad() {
  const q = S.df.q;
  let r; try { r = await call('hjList', q, q ? '' : new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10), ''); } catch (e) { return; }
  if (!r.ok) return toast(r.error || '불러오지 못했습니다');
  if (q !== S.df.q) return;   // 그사이 검색어가 바뀜
  S.df.list = r.list;
  if (S.view !== 'df') return;
  const L = $('dfList'); if (L) { L.innerHTML = dfListHtml(); const c = $('dfCnt'); if (c) c.textContent = dfCnt(); } else render();   // 검색 중에는 입력칸을 다시 그리지 않음 (글자 입력 끊김 방지)
}
let DFQT = null;
function dfSearch(el) { const o = S.df; o.q = el.value.trim(); clearTimeout(DFQT); DFQT = setTimeout(dfLoad, 300); }
function dfCnt() { const o = S.df; return (o.q ? '검색 결과 · ' : '저장된 하자점검서 · ') + (o.list ? o.list.length : '…') + '건'; }
function dfDirty() {
  const o = S.df; o.dirty = true; o.pdfUrl = null;
  const e = $('dfState'); if (e) e.innerHTML = dfState();
  const b = $('dfPdfB'); if (b && !o.pdfBusy) b.innerHTML = ICON.file + 'PDF 생성';
}
function dfState() { const o = S.df; return o.dirty ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : o.f.id ? '<span class="nwstate">' + ICON.ok + '저장됨</span>' : ''; }
function dfIn(i, fld, el) { const x = S.df.f.items[i]; x[fld] = el.value; x.e = 1; dfDirty(); }   // e = 내가 고친 칸 (합칠 때 내 것이 이김)
function dfBase(n) { return (n || '').replace(/\s*\d+$/, '').trim(); }
function dfNext(L, base) { return L.reduce((m, x) => dfBase(x.n) !== base ? m : Math.max(m, +((x.n.match(/\s(\d+)$/) || [])[1] || 1)), 0) + 1; }   // 같은 매장명 칸의 가장 큰 순서 숫자 + 1
/** 같은 날 + 같은 매장명(첫 칸 현장명, 뒤 숫자 뺌) 점검서를 서버에서 불러와 내 칸과 합침 (결정 340). 칸 고유 번호 k 로 맞추고, 내가 고친 칸·새 칸은 내 것, 내가 지운 칸은 뺌 */
async function dfSync() {
  const o = S.df, f = o.f, base = dfBase(f.items[0] && f.items[0].n); if (!base && !f.id) return;
  let r; try { r = await call('hjList', '', f.day, f.day); } catch (e) { return; }
  if (!r.ok || o.f !== f) return;
  const D = r.list.find(x => f.id ? x.id === f.id : x.items[0] && dfBase(x.items[0].n) === base); if (!D) return;
  const mine = {}; f.items.forEach(x => { mine[x.k] = x; });
  const out = D.items.filter(x => o.rm.indexOf(x.k) === -1).map(x => mine[x.k] && mine[x.k].e ? mine[x.k] : x), has = {}; out.forEach(x => { has[x.k] = 1; });
  f.items.filter(x => !has[x.k] && (x.t || x.photo || x.n && x.n !== base)).forEach(x => {   // 내가 새로 넣은 칸 (매장명만 적은 빈 첫 칸은 뺌): 남의 칸과 현장명이 겹치면 다음 숫자로
    if (dfBase(x.n) === base && out.some(y => y.n === x.n)) x.n = base + ' ' + dfNext(out, base);
    out.push(x);
  });
  f.id = D.id; if (out.length) f.items = out; if (!f.signSite) f.signSite = D.signSite;
}
async function dfAdd() {
  const o = S.df; if (o.adding) return; o.adding = true;
  try { await dfSync(); } finally { o.adding = false; }   // 「＋」 = 먼저 다른 직원 입력을 불러옴
  const L = o.f.items; if (L.length >= DF_MAX) { render(); return toast('하자 칸은 ' + DF_MAX + '개까지 넣을 수 있습니다'); }
  const base = dfBase(L[0].n);   // 첫 칸 현장명 뒤에 순서 숫자 (고쳐 쓸 수 있음)
  L.push({ k: dfKey(), n: base ? base + ' ' + dfNext(L, base) : '', t: '', photo: null, e: 1 }); dfDirty(); render();
}
function dfRm(i) { const o = S.df, L = o.f.items; if (L.length < 2) return; const x = L[i]; if ((x.n || x.t || x.photo) && !confirm('이 하자 칸을 지울까요?')) return; L.splice(i, 1); o.rm.push(x.k); dfDirty(); render(); }
async function dfPhoto(i, el) {
  const f = (el.files || [])[0]; el.value = ''; if (!f) return;
  const o = S.df, key = f.name + '|' + f.size + '|' + f.lastModified;
  if (o.keys.indexOf(key) !== -1 && !confirm('이미 넣은 사진 같습니다. 그래도 넣을까요?')) return;
  try { const data = await shrinkJpeg(f, 1600, 0.7); o.f.items[i].photo = { data, src: data }; o.f.items[i].e = 1; o.keys.push(key); if (o.keys.length > 80) o.keys.shift(); dfDirty(); render(); } catch (e) { toast(e.message); }
}
function dfPhotoRm(i) { if (!confirm('이 사진을 지울까요?')) return; S.df.f.items[i].photo = null; S.df.f.items[i].e = 1; dfDirty(); render(); }
function dfCard(x, i, n) {
  const pick = cam => '<label class="btn dfbt' + (cam ? ' dfcam' : '') + '">' + (cam ? ICON.cam + ' 카메라' : ICON.folder + ' 파일') + '<input type="file" accept="image/*"' + (cam ? ' capture="environment"' : '') + ' hidden onchange="dfPhoto(' + i + ',this)"></label>';
  return '<div class="whpc dfc"><div class="dfh"><input class="inp" maxlength="40" placeholder="현장명" aria-label="현장명 ' + (i + 1) + '" value="' + h(x.n) + '" oninput="dfIn(' + i + ',\'n\',this)">' +
    (n > 1 ? '<button type="button" class="btn sm" onclick="dfRm(' + i + ')" aria-label="하자 칸 지우기">' + ICON.x + '</button>' : '') + '</div>' +
    '<textarea class="inp" rows="3" maxlength="300" placeholder="하자내용" aria-label="하자내용 ' + (i + 1) + '" oninput="dfIn(' + i + ',\'t\',this)">' + h(x.t) + '</textarea>' +
    '<div class="whim dfph">' + (x.photo ? '<img src="' + h(x.photo.src) + '" alt="하자 사진 ' + (i + 1) + '"><button type="button" class="whx" onclick="dfPhotoRm(' + i + ')" aria-label="사진 지우기">' + ICON.x + '</button>' : pick(1)) + '</div>' +
    '<div class="whbs">' + pick(0) + '</div></div>';
}
function dfSignBox(key, label) {
  const s = S.df.f[key];
  return '<div class="dfsg"><small>' + label + '</small><button type="button" class="sig dfsb" onclick="dfSign(\'' + key + '\')" aria-label="' + label + ' 서명하기">' + (s ? '<img src="' + h(s.src) + '" alt="' + label + ' 서명">' : '<span>눌러서 서명</span>') + '</button></div>';
}
function dfSign(key) {
  const label = '현장책임자';
  dialog('<h2 class="ehdh">' + label + ' 서명</h2><div class="spad" id="dfsp"><canvas class="g"></canvas><canvas class="i" aria-label="서명 칸"></canvas></div>' +
    '<div id="dfsm" role="alert" class="ehmsg"></div><div class="ehda"><button class="btn big" onclick="closeDialog()">취소</button><button class="btn big" onclick="DFPAD.clear()">지우기</button><button class="btn big pri" onclick="dfSignOk(\'' + key + '\')">확인</button></div>');
  DFPAD = makeSignPad($('dfsp'), label, () => { const m = $('dfsm'); if (m) m.textContent = ''; });
}
let DFPAD = null;
function dfSignOk(key) {
  if (!DFPAD || !DFPAD.has()) { $('dfsm').textContent = '서명이 너무 짧습니다. 크게 써 주세요.'; return; }
  const data = DFPAD.png(); S.df.f[key] = { data, src: data }; closeDialog(); dfDirty(); render();
}
function dfAcc(key) { const o = S.df; const cur = key in o.open ? o.open[key] : key === o.dflt; o.open[key] = !cur; render(); }
function dfListHtml() {
  const o = S.df; if (!o.list) return '<div class="banner b-gray">불러오는 중…</div>';
  if (!o.list.length) return '<div class="banner b-gray">' + (o.q ? '찾는 하자점검서가 없습니다' : '저장된 하자점검서가 없습니다') + '</div>';
  const mons = []; o.list.forEach(x => { const m = x.day.slice(0, 7); let M = mons.find(y => y.m === m); if (!M) mons.push(M = { m, list: [] }); M.list.push(x); });   // 최근 날짜가 위
  o.dflt = 'm:' + mons[0].m;
  const row = x => '<button type="button" class="whrow dfrow' + (o.f.id === x.id ? ' on' : '') + '" onclick="dfEdit(&quot;' + x.id + '&quot;)"><b>' + h(x.day.slice(5).replace('-', '/')) + ' · ' + h(x.items[0] ? x.items[0].n : '') + '</b>' +
    '<span>' + h(x.items[0] ? x.items[0].t : '') + '</span><small>하자 ' + x.items.length + '건 · 처리 기한 ' + h(x.due.slice(5).replace('-', '/')) + '</small></button>';
  return '<div class="card rwres">' + mons.map(M => { const key = 'm:' + M.m, on = key in o.open ? o.open[key] : key === o.dflt;
    return '<button type="button" class="csacc whmo' + (on ? ' on' : '') + '" aria-expanded="' + on + '" onclick="dfAcc(&quot;' + key + '&quot;)"><b>' + M.m.slice(0, 4) + '년 ' + Number(M.m.slice(5)) + '월</b><span class="csn">' + M.list.length + '건</span><span class="csar" aria-hidden="true"></span></button>' + (on ? M.list.map(row).join('') : ''); }).join('') + '</div>';
}
function dfEdit(id) {
  const o = S.df, x = o.list.find(y => y.id === id); if (!x) return;
  if (o.dirty && !confirm('저장하지 않은 내용이 있습니다. 다른 하자점검서를 열까요?')) return;
  o.f = JSON.parse(JSON.stringify(x)); o.dirty = false; o.pdfUrl = null; o.rm = []; render(); window.scrollTo(0, 0);
}
function dfDel() {
  const o = S.df; if (!o.f.id || !confirm('이 하자점검서를 지울까요?')) return;
  call('hjDelete', o.f.id).then(r => { if (!r.ok) return toast(r.error); o.list = o.list.filter(x => x.id !== o.f.id); o.f = dfNew(); o.dirty = false; o.pdfUrl = null; render(); toast('지웠습니다'); }).catch(() => {});
}
function renderDf() {
  const o = S.df, f = o.f, n = f.items.length;
  const bar = '<div class="nwbar" id="dfBar"><span id="dfState">' + dfState() + '</span><button class="btn" onclick="dfPrint()">' + ICON.print + '인쇄 A4</button>' +
    '<button class="btn" id="dfPdfB" onclick="dfPdf()"' + (o.pdfBusy ? ' disabled' : '') + '>' + (o.pdfBusy ? '<span class="spin"></span>' : ICON.file + (o.pdfUrl ? 'PDF 보기' : 'PDF 생성')) + '</button>' +
    '<button class="btn pri" onclick="dfSave()"' + (o.busy ? ' disabled' : '') + '>' + (o.busy ? '<span class="spin"></span>' : '저장') + '</button></div>';
  return topbar('점검 ›', '매장 하자 점검') + '<div class="wrap list"><div class="card whf">' +
    '<div class="whg dfg">' + f.items.map((x, i) => dfCard(x, i, n)).join('') + '<button type="button" class="dfplus" onclick="dfAdd()"' + (n >= DF_MAX ? ' disabled' : '') + ' aria-label="하자 칸 추가 (' + n + ' / ' + DF_MAX + ')">+</button></div>' +
    '<div class="dfsgs">' + dfSignBox('signSite', '현장책임자 서명') + '</div>' +
    '<small class="rwhint">처리 기한은 작성일(' + h(whDay(f.day)) + ') + 10일 = <b>' + h(whDay(dfDue(f.day))) + '</b> 로 자동 기입됩니다. PDF 생성을 누르면 먼저 저장합니다.</small>' +
    (f.id ? '<div class="dfact"><button type="button" class="btn sm whdel" onclick="dfDel()">이 하자점검서 삭제</button><button type="button" class="btn sm dfdlb" onclick="dfPdf(true)">PDF 내려받기</button></div>' : '') + '</div>' +
    '<input class="inp dfq" type="search" maxlength="40" placeholder="날짜·현장명·하자내용으로 찾기" value="' + h(o.q) + '" oninput="dfSearch(this)" aria-label="하자점검서 검색">' +
    '<div class="cssec" id="dfCnt">' + dfCnt() + '</div><div id="dfList">' + dfListHtml() + '</div>' + bar + '</div>';
}
function dfCheck() {
  const f = S.df.f; if (!f.items.some(x => x.t.trim())) { toast('하자내용을 입력해 주세요'); return false; } return true;
}
/** 저장. stay = PDF 만들기 직전 저장이라 화면에 그대로 둠 (아니면 빈 양식으로) */
async function dfSave(stay) {
  const o = S.df; if (o.busy || !dfCheck()) return false;
  o.busy = true; if (!stay) render();
  try {
    await dfSync(); const f = o.f;   // 저장 직전에도 다른 직원 칸을 합침 (서버도 칸 번호로 한 번 더 합침)
    const r = await call('hjSave', { id: f.id, day: f.day, removed: o.rm, items: f.items.map(x => ({ k: x.k, n: x.n, t: x.t, photo: x.photo && x.photo.id ? { id: x.photo.id } : x.photo && x.photo.data ? { data: x.photo.data } : null })),
      signSite: f.signSite && f.signSite.id ? { id: f.signSite.id } : f.signSite && f.signSite.data ? { data: f.signSite.data } : null });
    o.busy = false;
    if (!r.ok) { render(); toast(r.error || '저장하지 못했습니다'); return false; }
    if (o.list) { const i = o.list.findIndex(x => x.id === r.item.id); if (i >= 0) o.list[i] = r.item; else o.list.unshift(r.item); o.list.sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0); }
    o.f = stay ? JSON.parse(JSON.stringify(r.item)) : dfNew(); o.keys = []; o.rm = []; o.dirty = false;
    if (!stay) o.pdfUrl = null;
    render(); if (!stay) { window.scrollTo(0, 0); toast('저장했습니다'); }
    return true;
  } catch (e) { o.busy = false; render(); return false; }
}

/* 인쇄 · PDF: 사진 4열 · 하자내용 표 · 확인 문구 · 처리 기한 · 서명. 한 쪽에 하자 8칸 (shortcut: 하자내용이 아주 길면 한 쪽을 넘칠 수 있음 — 현장에서 써 보고 칸 수 조정) */
const DF_CSS = '.whp .cap{font-size:11px;line-height:1.3;margin-top:2px;word-break:break-all;min-height:14px}.whp .dfn{text-align:center;font-size:12px;color:#666}' +
  '.whp .ok{text-align:center;font-size:15px;font-weight:600;margin:26px 0 8px}.whp .due{text-align:center;font-size:13px;margin-bottom:18px}' +
  '.whp .sgs{display:flex;gap:12px}.whp .sgb{flex:1;border:1px solid #888;height:104px;padding:6px 8px;position:relative}.whp .sgb b{font-size:12px}.whp .sgb img{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);max-width:88%;max-height:70px}';
function dfPages() {
  const f = S.df.f, L = f.items.filter(x => x.n.trim() || x.t.trim() || x.photo), P = 8, np = Math.max(1, Math.ceil(L.length / P)), who = (S.user && S.user.name) || '';
  return Array.from({ length: np }, (_, k) => {
    const c = L.slice(k * P, k * P + P), last = k === np - 1;
    const cells = c.map(x => '<div><div class="cell" style="height:129px">' + (x.photo ? '<img src="' + h(x.photo.src) + '" alt="">' : '<span class="dfn">사진 없음</span>') + '</div><div class="cap">' + h(x.n) + '</div></div>').join('');
    const sg = (s, t) => '<div class="sgb"><b>' + t + ' (서명)</b>' + (s ? '<img src="' + h(s.src) + '" alt="">' : '') + '</div>';
    return '<div class="pg"><h1>하자 점검 확인서</h1><div class="sub">에비뉴엘 잠실점 시설팀 · 작성일 ' + h(whDay(f.day)) + (who ? ' · 작성자 ' + h(who) : '') + (np > 1 ? ' · ' + (k + 1) + '/' + np + '쪽' : '') + '</div>' +
      '<div class="gr" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">' + cells + '</div>' +
      '<table><tr><th style="width:34px">No</th><th style="width:130px">현장명</th><th style="width:auto">하자내용</th></tr>' + c.map((x, i) => '<tr><td>' + (k * P + i + 1) + '</td><td>' + h(x.n) + '</td><td style="white-space:pre-wrap">' + h(x.t) + '</td></tr>').join('') + '</table>' +
      (last ? '<div class="ok">위 하자 내용을 확인했으며 기한 내 처리하겠습니다.</div><div class="due">처리 기한 : ' + h(whDay(dfDue(f.day))) + '</div><div class="sgs">' + sg(f.signSite, '현장책임자') + '</div>' : '') +
      whFt('하자 점검 확인서') + '</div>';
  }).join('');
}
async function dfPrint() {
  if (!dfCheck()) return;
  $('print').innerHTML = '<style>@page{size:A4;margin:0}' + WH_CSS + DF_CSS + '</style><div class="whp">' + dfPages() + '</div>';
  await whFit($('print')); setTimeout(() => window.print(), 100);
}
function dfPdfShow() { const a = document.createElement('a'); a.href = S.df.pdfUrl; a.dataset.pv = JSON.stringify({ name: '하자 점검 확인서', sub: S.df.f.day }); pdfOpen(a); }
function dfPdfDl() { const o = S.df, a = document.createElement('a'); a.href = o.pdfUrl; a.download = o.f.day + '_하자점검.pdf'; document.body.appendChild(a); a.click(); a.remove(); }
async function dfPdf(dl) {   // dl = 「PDF 내려받기」: PC·휴대폰에 파일로 저장
  const o = S.df; if (o.pdfBusy || !dfCheck()) return;
  if (o.pdfUrl) return dl ? dfPdfDl() : dfPdfShow();   // 이미 만든 PDF (고친 곳이 없을 때)
  o.pdfBusy = true; render();
  if (!await dfSave(true)) { o.pdfBusy = false; render(); return; }   // PDF 생성 = 먼저 자동 저장
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
  wrap.innerHTML = '<style>' + WH_CSS + DF_CSS + '</style><div class="whp" style="width:794px">' + dfPages() + '</div>'; document.body.appendChild(wrap);
  try {
    await loadH2p(); await whFit(wrap);
    const keepY = window.scrollY; window.scrollTo(0, 0);
    let blob; try {
      blob = await html2pdf().set({ margin: 0, filename: o.f.day + '_하자점검.pdf', image: { type: 'jpeg', quality: 0.9 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 794 },
        jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait', hotfixes: ['px_scaling'] }, pagebreak: { mode: ['css'] } }).from(wrap.querySelector('.whp')).outputPdf('blob');
    } finally { window.scrollTo(0, keepY); }
    o.pdfUrl = URL.createObjectURL(blob); o.pdfBusy = false;
    if (dl) { render(); dfPdfDl(); toast('PDF를 내려받았습니다'); } else dfPdfShow();
  } catch (e) { o.pdfBusy = false; render(); toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
  wrap.remove();
}
