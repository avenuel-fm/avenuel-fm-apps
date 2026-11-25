/* ── 점검 › 하자점검 (WS_하자점검, 결정 266): 하자 칸(현장명·하자내용·사진 1장) 여러 개 → 인쇄 A4 / PDF + 현장책임자·시설팀 손글씨 서명. 처리 기한 = 작성일 + 10일 자동 ── */
const DF_MAX = 40;
function dfNew() { return { id: '', day: rwToday(), items: [{ n: '', t: '', photo: null }], signSite: null, signFm: null }; }
function dfDue(day) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 10); return d.toISOString().slice(0, 10); }
async function openDf() {
  if (!window.WS_API) return toast('하자점검은 바로가기 앱(Supabase)에서만 열립니다');
  S.df = S.df || { list: null, f: dfNew(), dirty: false, busy: false, pdfBusy: false, pdfUrl: null, keys: [] };
  go('df'); await dfLoad();
}
async function dfLoad() {
  let r; try { r = await call('hjList', '', '', ''); } catch (e) { return; }
  if (!r.ok) return toast(r.error || '불러오지 못했습니다');
  S.df.list = r.list; if (S.view === 'df') render();
}
function dfDirty() {
  const o = S.df; o.dirty = true; o.pdfUrl = null;
  const e = $('dfState'); if (e) e.innerHTML = dfState();
  const b = $('dfPdfB'); if (b && !o.pdfBusy) b.innerHTML = ICON.file + 'PDF 생성';
}
function dfState() { const o = S.df; return o.dirty ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : o.f.id ? '<span class="nwstate">' + ICON.ok + '저장됨</span>' : ''; }
function dfIn(i, fld, el) { S.df.f.items[i][fld] = el.value; dfDirty(); }
function dfAdd() {
  const L = S.df.f.items; if (L.length >= DF_MAX) return toast('하자 칸은 ' + DF_MAX + '개까지 넣을 수 있습니다');
  const base = (L[0].n || '').replace(/\s*\d+$/, '').trim();   // 첫 칸 현장명 뒤에 순서 숫자 (고쳐 쓸 수 있음)
  L.push({ n: base ? base + ' ' + (L.length + 1) : '', t: '', photo: null }); dfDirty(); render();
}
function dfRm(i) { const L = S.df.f.items; if (L.length < 2) return; const x = L[i]; if ((x.n || x.t || x.photo) && !confirm('이 하자 칸을 지울까요?')) return; L.splice(i, 1); dfDirty(); render(); }
async function dfPhoto(i, el) {
  const f = (el.files || [])[0]; el.value = ''; if (!f) return;
  const o = S.df, key = f.name + '|' + f.size + '|' + f.lastModified;
  if (o.keys.indexOf(key) !== -1 && !confirm('이미 넣은 사진 같습니다. 그래도 넣을까요?')) return;
  try { const data = await shrinkJpeg(f, 1600, 0.7); o.f.items[i].photo = { data, src: data }; o.keys.push(key); if (o.keys.length > 80) o.keys.shift(); dfDirty(); render(); } catch (e) { toast(e.message); }
}
function dfPhotoRm(i) { if (!confirm('이 사진을 지울까요?')) return; S.df.f.items[i].photo = null; dfDirty(); render(); }
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
  const label = key === 'signSite' ? '현장책임자' : '시설팀';
  dialog('<h2 class="ehdh">' + label + ' 서명</h2><div class="spad" id="dfsp"><canvas class="g"></canvas><canvas class="i" aria-label="서명 칸"></canvas></div>' +
    '<div id="dfsm" role="alert" class="ehmsg"></div><div class="ehda"><button class="btn big" onclick="closeDialog()">취소</button><button class="btn big" onclick="DFPAD.clear()">지우기</button><button class="btn big pri" onclick="dfSignOk(\'' + key + '\')">확인</button></div>');
  DFPAD = makeSignPad($('dfsp'), label, () => { const m = $('dfsm'); if (m) m.textContent = ''; });
}
let DFPAD = null;
function dfSignOk(key) {
  if (!DFPAD || !DFPAD.has()) { $('dfsm').textContent = '서명이 너무 짧습니다. 크게 써 주세요.'; return; }
  const data = DFPAD.png(); S.df.f[key] = { data, src: data }; closeDialog(); dfDirty(); render();
}
function dfListHtml() {
  const o = S.df; if (!o.list) return '<div class="banner b-gray">불러오는 중…</div>';
  if (!o.list.length) return '<div class="banner b-gray">저장된 하자점검서가 없습니다</div>';
  return '<div class="card rwres">' + o.list.map(x => '<button type="button" class="whrow' + (o.f.id === x.id ? ' on' : '') + '" onclick="dfEdit(&quot;' + x.id + '&quot;)"><b>' + h(x.day.slice(5).replace('-', '/')) + ' · ' + h(x.items[0] ? x.items[0].n : '') + (x.items.length > 1 ? ' 외 ' + (x.items.length - 1) + '곳' : '') + '</b>' +
    '<span>' + h(x.items[0] ? x.items[0].t : '') + '</span><small>하자 ' + x.items.length + '건 · 처리 기한 ' + h(x.due.slice(5).replace('-', '/')) + '</small></button>').join('') + '</div>';
}
function dfEdit(id) {
  const o = S.df, x = o.list.find(y => y.id === id); if (!x) return;
  if (o.dirty && !confirm('저장하지 않은 내용이 있습니다. 다른 하자점검서를 열까요?')) return;
  o.f = JSON.parse(JSON.stringify(x)); o.dirty = false; o.pdfUrl = null; render(); window.scrollTo(0, 0);
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
  return topbar('점검 ›', '하자점검') + '<div class="wrap list"><div class="card whf">' +
    '<div class="whg dfg">' + f.items.map((x, i) => dfCard(x, i, n)).join('') + '<button type="button" class="dfplus" onclick="dfAdd()"' + (n >= DF_MAX ? ' disabled' : '') + ' aria-label="하자 칸 추가 (' + n + ' / ' + DF_MAX + ')">+</button></div>' +
    '<div class="dfsgs">' + dfSignBox('signSite', '현장책임자 서명') + dfSignBox('signFm', '시설팀 서명') + '</div>' +
    '<small class="rwhint">처리 기한은 작성일(' + h(whDay(f.day)) + ') + 10일 = <b>' + h(whDay(dfDue(f.day))) + '</b> 로 자동 기입됩니다. PDF 생성을 누르면 먼저 저장합니다.</small>' +
    (f.id ? '<button type="button" class="btn sm whdel" onclick="dfDel()">이 하자점검서 삭제</button>' : '') + '</div>' +
    '<div class="cssec">최근 60일 · ' + (o.list ? o.list.length : '…') + '건</div>' + dfListHtml() + bar + '</div>';
}
function dfCheck() {
  const f = S.df.f; if (!f.items.some(x => x.t.trim())) { toast('하자내용을 입력해 주세요'); return false; } return true;
}
/** 저장. stay = PDF 만들기 직전 저장이라 화면에 그대로 둠 (아니면 빈 양식으로) */
async function dfSave(stay) {
  const o = S.df, f = o.f; if (o.busy || !dfCheck()) return false;
  o.busy = true; if (!stay) render();
  try {
    const r = await call('hjSave', { id: f.id, day: f.day, items: f.items.map(x => ({ n: x.n, t: x.t, photo: x.photo && x.photo.id ? { id: x.photo.id } : x.photo && x.photo.data ? { data: x.photo.data } : null })),
      signSite: f.signSite && f.signSite.id ? { id: f.signSite.id } : f.signSite && f.signSite.data ? { data: f.signSite.data } : null,
      signFm: f.signFm && f.signFm.id ? { id: f.signFm.id } : f.signFm && f.signFm.data ? { data: f.signFm.data } : null });
    o.busy = false;
    if (!r.ok) { render(); toast(r.error || '저장하지 못했습니다'); return false; }
    if (o.list) { const i = o.list.findIndex(x => x.id === r.item.id); if (i >= 0) o.list[i] = r.item; else o.list.unshift(r.item); o.list.sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0); }
    o.f = stay ? JSON.parse(JSON.stringify(r.item)) : dfNew(); o.keys = []; o.dirty = false;
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
      (last ? '<div class="ok">위 하자 내용을 확인했으며 기한 내 처리하겠습니다.</div><div class="due">처리 기한 : ' + h(whDay(dfDue(f.day))) + '</div><div class="sgs">' + sg(f.signSite, '현장책임자') + sg(f.signFm, '시설팀') + '</div>' : '') +
      whFt('하자 점검 확인서') + '</div>';
  }).join('');
}
async function dfPrint() {
  if (!dfCheck()) return;
  $('print').innerHTML = '<style>@page{size:A4;margin:0}' + WH_CSS + DF_CSS + '</style><div class="whp">' + dfPages() + '</div>';
  await whFit($('print')); setTimeout(() => window.print(), 100);
}
function dfPdfShow() { const a = document.createElement('a'); a.href = S.df.pdfUrl; a.dataset.pv = JSON.stringify({ name: '하자 점검 확인서', sub: S.df.f.day }); pdfOpen(a); }
async function dfPdf() {
  const o = S.df; if (o.pdfBusy || !dfCheck()) return;
  if (o.pdfUrl) return dfPdfShow();   // 이미 만든 PDF (고친 곳이 없을 때)
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
    o.pdfUrl = URL.createObjectURL(blob); o.pdfBusy = false; dfPdfShow();
  } catch (e) { o.pdfBusy = false; render(); toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
  wrap.remove();
}
