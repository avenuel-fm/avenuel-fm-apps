/* ── 앱 안 PDF 보기: [PDF 열기]가 휴대폰의 드라이브·PDF 앱으로 넘어가면 구글 계정을 물음 → 앱 안에서 pdf.js 로 그림 (Supabase 판만) ──
   Supabase 저장소 PDF는 바로 받고, 드라이브로 옮긴 PDF는 구글 웹앱 ?api=pdf 가 대신 받아 줌(「링크가 있는 사람 보기」 파일만). 구글 판은 예전처럼 새 창 */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PV_Z = [1, 1.5, 2, 3];
/* 서류 화면 아래 줄 공통 (결정 176) — 왼쪽 상태 글자, 오른쪽 아래 [인쇄] + [저장 ⇄ PDF 보기]. 남색은 「저장」 하나.
   저장하면 PDF도 같이 만들고, 끝나면 그 자리가 [PDF 보기]. 고치면 다시 [저장]. o = { sid, state, print, id, save, label, busy, pdfBusy, pdf: { url, pv } | null } */
function docSlot(o) {
  return o.pdf ? pdfBtn('', 'PDF 보기', o.pdf.url, o.pdf.pv) :
    '<button class="btn pri"' + (o.id ? ' id="' + o.id + '"' : '') + ' onclick="' + o.save + '"' + (o.busy ? ' disabled' : '') + '>' + (o.busy ? '<span class="spin"></span> ' + (o.pdfBusy ? 'PDF 만드는 중…' : '저장 중…') : o.label || '저장') + '</button>';
}
function docBar(o) { return '<span id="' + o.sid + '">' + o.state + '</span>' + (o.print ? '<button class="btn" onclick="' + o.print + '">' + ICON.print + '인쇄 (B4)</button>' : '') + '<div class="dslot" id="' + o.sid + 'Slot">' + docSlot(o) + '</div>'; }
function docSlotSet(o) { const e = $(o.sid + 'Slot'); if (e) e.innerHTML = docSlot(o); }
function pdfBtn(cls, label, url, o) {   // o = { name, sub, meta } — 돌아갈 화면은 지금 화면, cls = null 이면 글자 링크
  return '<a' + (cls == null ? '' : ' class="btn ' + cls + '"') + ' href="' + h(url) + '" target="_blank" rel="noopener" data-pv="' + h(JSON.stringify(o)) + '" onclick="return pdfOpen(this)">' + label + '</a>';
}
function pdfOpen(a) {
  if (!window.WS_API) return true;   // 구글 판: 새 창
  const o = JSON.parse(a.dataset.pv || '{}');
  S.pdf = { url: a.getAttribute('href'), name: o.name || 'PDF', sub: o.sub || '', meta: o.meta || '', from: S.view === 'pdf' && S.pdf ? S.pdf.from : S.view, z: 1, st: 'load', n: 0 };
  S.pdfDoc = null;
  go('pdf');
  pdfLoad();
  return false;
}
function pdfLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = PDFJS + 'pdf.min.js';
    sc.onload = () => { if (!window.pdfjsLib) return no(new Error('PDF 도구를 불러오지 못했습니다')); pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    sc.onerror = () => no(new Error('PDF 도구를 불러오지 못했습니다'));
    document.head.appendChild(sc);
  });
}
async function pdfBytes(url) {
  const d = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
  if (d) {   // 드라이브로 옮긴 PDF: 브라우저가 직접 못 받음(CORS) → 구글 웹앱이 대신
    const j = await (await fetch(WS_CONFIG.WS_GAS_URL + '?api=pdf&id=' + encodeURIComponent(d[1]))).json();
    if (!j.ok) throw new Error(j.error || 'PDF를 받지 못했습니다');
    const s = atob(j.b64), b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('PDF를 받지 못했습니다 (' + r.status + ')');
  return new Uint8Array(await r.arrayBuffer());
}
async function pdfLoad() {
  const me = S.pdf;
  me.st = 'load'; me.err = ''; if (S.view === 'pdf') render();
  try {
    const [lib, bytes] = await Promise.all([pdfLib(), pdfBytes(me.url)]);
    me.bytes = bytes;
    const doc = await lib.getDocument({ data: bytes.slice() }).promise;   // pdf.js 가 넘긴 배열을 비우므로 복사본을 줌 (내려받기용 원본 보존)
    if (S.pdf !== me) return;
    S.pdfDoc = doc; me.n = doc.numPages; me.st = 'ok';
  } catch (e) {
    if (S.pdf !== me) return;
    me.st = 'err'; me.err = String(e.message || e);
  }
  if (S.view === 'pdf') render();
}
function pvZoomLabel(z) { return z === 1 ? (window.innerWidth < 700 ? '쪽 맞춤' : '100%') : Math.round(z * 100) + '%'; }
function renderPdf() {
  const p = S.pdf;
  const tool = '<div class="pv-tool"><span class="fname"><b>' + h(p.name) + '</b><small>' + h([p.n ? p.n + '쪽' : '', p.meta].filter(Boolean).join(' · ') || 'PDF') + '</small></span>' +
    '<div class="pv-zoom" role="group" aria-label="크기"><button onclick="pvZoom(-1)" aria-label="작게"' + (p.z <= PV_Z[0] || p.st !== 'ok' ? ' disabled' : '') + '>−</button>' +
    '<span id="pvZ">' + pvZoomLabel(p.z) + '</span><button onclick="pvZoom(1)" aria-label="크게"' + (p.z >= PV_Z[PV_Z.length - 1] || p.st !== 'ok' ? ' disabled' : '') + '>+</button></div></div>';
  const body = p.st === 'err'
    ? '<div class="pv-state" role="alert"><b>PDF를 불러오지 못했습니다</b><span>' + h(p.err && !/fetch|network/i.test(p.err) ? p.err : '인터넷 연결을 확인하고 다시 시도해 주세요.') + '</span>' +
      '<button class="btn pri" onclick="pdfLoad()">다시 시도</button><a class="btn" href="' + h(p.url) + '" target="_blank" rel="noopener">새 창에서 열기</a>' +
      '<small style="color:var(--muted)">새 창에서 열면 휴대폰이 구글 계정을 물을 수 있습니다.</small></div>'
    : p.st === 'load' ? '<div class="pv-state"><div class="pv-spin" aria-hidden="true"></div><span>PDF 불러오는 중…</span></div>'
    : '<div class="pv-pages' + (p.z > 1 ? ' big' : '') + '" id="pvPages">' + Array.from({ length: p.n }, (_, i) => '<canvas class="pv-page" id="pvC' + (i + 1) + '" aria-label="' + (i + 1) + '쪽"></canvas><div class="pv-no">' + (i + 1) + ' / ' + p.n + '</div>').join('') + '</div>';
  return topbar(p.sub, 'PDF 보기') + tool + body +
    '<div class="backbar pv-bar"><button class="btn back-in" onclick="back()">' + ICON.back + '뒤로</button>' +
    '<button class="btn" onclick="pvDown()"' + (p.bytes ? '' : ' disabled') + '>' + ICON.file + '내려받기</button><button class="btn pri" onclick="pvShare()">공유</button></div>';
}
async function pvDraw() {
  const p = S.pdf, doc = S.pdfDoc, box = $('pvPages');
  if (!doc || !box) return;
  const fit = Math.min(960, box.clientWidth - 20), dpr = Math.min(window.devicePixelRatio || 1, 3), z = p.z;
  for (let i = 1; i <= p.n; i++) {
    const pg = await doc.getPage(i);
    if (S.pdf !== p || p.z !== z || S.view !== 'pdf') return;   // 그리는 중에 크기를 바꾸거나 나감
    const cv = $('pvC' + i); if (!cv) return;
    const w = fit * z, sc = w / pg.getViewport({ scale: 1 }).width;
    const k = Math.min(dpr, 4096 / w);   // 캔버스가 너무 크면 휴대폰이 못 그림
    const vp = pg.getViewport({ scale: sc * k });
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    cv.style.width = Math.floor(w) + 'px'; cv.style.height = Math.floor(vp.height / k) + 'px';
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  }
}
function pvZoom(d) {
  const p = S.pdf, i = PV_Z.indexOf(p.z) + d;
  if (i < 0 || i >= PV_Z.length) return;
  p.z = PV_Z[i]; render();
}
function pvDown() {
  const p = S.pdf; if (!p || !p.bytes) return;
  const u = URL.createObjectURL(new Blob([p.bytes], { type: 'application/pdf' })), a = document.createElement('a');
  a.href = u; a.download = p.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
async function pvShare() {
  const p = S.pdf; if (!p) return;
  if (navigator.share) { try { await navigator.share({ title: p.name, url: p.url }); } catch (e) {} return; }   // 취소해도 조용히
  try { await navigator.clipboard.writeText(p.url); toast('PDF 링크를 복사했습니다. 받는 사람은 로그인 없이 볼 수 있습니다.'); } catch (e) { prompt('PDF 링크 (복사해서 보내세요)', p.url); }
}

function renderEh() {
  ehWas = ehWide();
  return topbar('점검 ›', '전열필증') + '<div class="wrap">' +
    '<input id="ehQ" class="inp" type="search" placeholder="매장명 검색 (모든 층)" aria-label="매장명 검색" value="' + h(S.ehQ || '') + '" oninput="ehSearch(this)">' +
    '<div id="ehBody">' + ehBody() + '</div></div>';
}
function ehBody() {
  const r = S.eh, selN = ehSelIds().length;
  let body = '<div class="banner b-gray">불러오는 중…</div>';
  if (r) {
    const q = (S.ehQ || '').trim().toLowerCase().replace(/\s+/g, '');
    const hits = q ? r.names.filter(n => n[1].toLowerCase().replace(/\s+/g, '').indexOf(q) !== -1) : null;
    const fl = r.floors.find(f => f.code === r.floor);
    body = '<div class="ehfls" role="tablist">' + r.floors.map(f => '<button class="ehfl' + (f.code === r.floor ? ' on' : '') + '" role="tab" aria-selected="' + (f.code === r.floor) + '" onclick="ehFloorGo(\'' + f.code + '\')"><b>' + f.code + '</b><small>' + f.stores + '곳 · ' + f.items + '</small></button>').join('') + '</div>';
    if (hits) {
      body += '<div class="list" style="margin-top:var(--sp-2)">' + (hits.length ? hits.slice(0, 50).map(n => '<button class="row" onclick="ehJump(\'' + n[0] + '\',\'' + n[2] + '\')"><span class="ehcnt">' + h(n[0]) + '</span><span class="fname"><b style="font-size:var(--size-m)">' + h(n[1]) + '</b></span>' + ICON.chev + '</button>').join('') : '<div class="banner b-gray">「' + h(S.ehQ) + '」 매장이 없습니다.</div>') + '</div>';
    } else {
      body += '<div class="ehsum"><span><b>' + h(r.floor) + '</b> 매장 ' + fl.stores + '곳 · 기기 ' + fl.items + '대</span>' +
        (CAN_PRINT ? '<button class="btn sm" onclick="ehImportDlg(' + !r.empty + ')">' + (r.empty ? '엑셀 가져오기' : '엑셀 다시 가져오기') + '</button>' : '') +
        '<button class="btn sm" onclick="ehStoreDlg()">＋ 매장 추가</button></div>';
      if (!r.stores.length) body += '<div class="banner b-gray">' + (r.empty ? '아직 전열기기가 없습니다. ' + (CAN_PRINT ? '[엑셀 가져오기]로 관리대장을 옮기거나 ' : 'PC에서 관리대장 엑셀을 가져오거나 ') + '[＋ 매장 추가]로 시작하세요.' : '이 층에 매장이 없습니다.') + '</div>';
      else body += ehWide() ? ehPc(r) : r.stores.map(ehCard).join('');
    }
  }
  const bar = !ehWide() && selN ? '<div class="nwbar"><b style="flex:1;color:var(--blue-d)">' + selN + '대 선택</b>' +
    (CAN_PRINT ? '<button class="btn pri" style="flex:none" onclick="ehPrint()">' + ICON.print + ' 출력</button>' : '') + '<button class="btn warn" style="flex:none;min-width:120px" onclick="ehDelDlg()">필증 삭제</button><button class="btn" style="flex:none;min-width:90px" onclick="S.ehSel={};render()">선택 풀기</button></div>' : '';
  return body + bar;
}
function ehRowM(i) {
  return '<div class="ehit' + (S.ehSel[i.id] ? ' sel' : '') + '"><input type="checkbox" aria-label="' + h(i.no) + ' 고르기" ' + (S.ehSel[i.id] ? 'checked' : '') + ' onchange="ehPick(\'' + i.id + '\',this.checked)">' +
    '<span class="fname"><span class="ehl1"><span class="ehno">' + h(i.no) + '</span><b>' + h(i.name) + '</b></span><small>' + h(i.maker || '제조사 없음') + ' · 승인 ' + h(ehDate(i.date) || '없음') + (i.printed ? '' : ' · <em class="ehnp">미출력</em>') + '</small></span>' +
    '<span class="ehw">' + ehW(i.w) + '<small> W</small></span><button class="btn sm ehed" onclick="ehItemDlg(\'' + i.id + '\')" aria-label="' + h(i.no) + ' 편집">✎</button></div>';
}
function ehCard(s) {
  const open = !!S.ehOpen[s.id], all = s.items.length && s.items.every(i => S.ehSel[i.id]);
  return '<div class="store ehst" id="st_' + s.id + '"><div class="ehsh"><input type="checkbox" aria-label="' + h(s.name) + ' 기기 모두 고르기" ' + (all ? 'checked' : '') + ' onchange="ehPickStore(\'' + s.id + '\')"' + (s.items.length ? '' : ' disabled') + '>' +
    '<button class="ehsn" onclick="ehTog(\'' + s.id + '\')" aria-expanded="' + open + '"><b>' + h(s.name) + '</b><span class="ehcnt">' + s.items.length + '대</span><span class="ehchev' + (open ? ' up' : '') + '"></span></button>' +
    '<button class="btn sm ehmore" onclick="ehStoreMenu(\'' + s.id + '\')" aria-label="' + h(s.name) + ' 매장 메뉴">⋯</button></div>' +
    (open ? s.items.map(ehRowM).join('') + '<div class="ehadd"><button class="btn" onclick="ehItemDlg(\'\',\'' + s.id + '\')">＋ 이 매장에 기기 추가</button></div>' : '') + '</div>';
}
function ehPc(r) {
  const s = ehStore(S.ehCur) || r.stores[0], selN = ehSelIds().length, all = s.items.length && s.items.every(i => S.ehSel[i.id]);
  return '<div class="ehpc"><div class="card ehside">' + r.stores.map(x => '<button class="ehsrow' + (x.id === s.id ? ' on' : '') + '" onclick="S.ehCur=\'' + x.id + '\';render()" title="' + h(x.name) + '"><span>' + h(x.name) + '</span><small>' + x.items.length + '대</small></button>').join('') + '</div>' +
    '<div class="card ehpanel"><div class="ehph"><div class="fname"><small>' + h(r.floor) + ' · 매장번호 ' + s.no + '</small><b>' + h(s.name) + ' <span class="ehcnt">' + s.items.length + '대</span></b></div>' +
    '<div class="ehacts"><button class="btn" onclick="ehItemDlg(\'\',\'' + s.id + '\')">＋ 기기 추가</button>' +
    '<button class="btn pri" onclick="ehPrint()"' + (selN ? '' : ' disabled') + '>' + ICON.print + ' 필증 출력 (' + selN + ')</button>' +
    '<button class="btn warn" onclick="ehDelDlg()"' + (selN ? '' : ' disabled') + '>필증 삭제 (' + selN + ')</button>' +
    '<button class="btn ehmore" onclick="ehStoreMenu(\'' + s.id + '\')" aria-label="매장 메뉴" title="매장 이름 바꾸기 · 매장 삭제">⋯</button></div></div>' +
    (s.items.length ? '<div class="ehtw"><table class="ehtbl"><thead><tr><th><input type="checkbox" aria-label="모두 고르기" ' + (all ? 'checked' : '') + ' onchange="ehPickStore(\'' + s.id + '\')"></th><th>관리번호</th><th>기기명 · 제조사</th><th class="r">용량(W)</th><th>책임자 (정 · 부)</th><th>승인일자</th><th>필증</th><th></th></tr></thead><tbody>' +
      s.items.map(i => '<tr class="' + (S.ehSel[i.id] ? 'sel' : '') + '"><td><input type="checkbox" aria-label="' + h(i.no) + ' 고르기" ' + (S.ehSel[i.id] ? 'checked' : '') + ' onchange="ehPick(\'' + i.id + '\',this.checked)"></td><td class="ehno">' + h(i.no) + '</td><td class="wr"><b>' + h(i.name) + '</b>' + (i.maker ? '<small>' + h(i.maker) + '</small>' : '') + '</td><td class="r">' + ehW(i.w) + '</td><td class="wr">' + h(i.m1) + (i.m2 ? '<small>' + h(i.m2) + '</small>' : '') + '</td><td>' + h(ehDate(i.date)) + '</td><td>' + (i.printed ? '<span class="chip c-ok">출력함</span>' : '<span class="chip c-bad">미출력</span>') + '</td>' +
        '<td><button class="btn sm ehed" onclick="ehItemDlg(\'' + i.id + '\')" aria-label="' + h(i.no) + ' 편집">✎</button></td></tr>').join('') + '</tbody></table></div>'
      : '<div class="banner b-gray">기기가 없습니다. [＋ 기기 추가]로 넣으세요.</div>') + '</div></div>';
}

/* 매장 추가 · 이름 바꾸기 · 삭제 */
function ehStoreDlg(id) {
  const s = id ? ehStore(id) : null;
  dialog('<h2 class="ehdh">' + (s ? '매장 이름 바꾸기' : '매장 추가') + '</h2>' +
    (s ? '<p class="ehdp">' + h(S.eh.floor) + ' · 매장번호 ' + s.no + ' (관리번호는 그대로)</p>' : '<label class="ehf">층<select id="esF" class="inp">' + EH_FLOORS.map(f => '<option' + (f === S.eh.floor ? ' selected' : '') + '>' + f + '</option>').join('') + '</select></label>') +
    '<label class="ehf">매장명<input id="esN" class="inp" maxlength="30" value="' + h(s ? s.name : '') + '" placeholder="예: 발렌티노"></label>' +
    '<small style="color:var(--muted)">' + (s ? '' : '매장번호는 그 층의 다음 번호로 자동으로 붙습니다.') + '</small>' +
    '<div id="esM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="esB" class="btn big pri" style="flex:2" onclick="ehStoreSaveGo(\'' + (id || '') + '\')">저장</button></div>');
  setTimeout(() => { const n = $('esN'); if (n) n.focus(); }, 50);
}
async function ehStoreSaveGo(id) {
  const d = { id: id, name: $('esN').value, floor: id ? '' : $('esF').value };
  $('esB').disabled = true;
  try {
    const r = await call('ehStoreSave', d);
    if (!r.ok) { $('esM').textContent = r.error; $('esB').disabled = false; return; }
    closeDialog(); const s = r.stores.find(x => x.name === d.name.trim().replace(/\s+/g, ' '));
    if (s) { S.ehCur = s.id; S.ehOpen[s.id] = true; }
    ehSet(r); toast(id ? '매장 이름을 바꿨습니다' : '「' + d.name.trim() + '」 매장 추가');
  } catch (e) { $('esB').disabled = false; }
}
function ehStoreMenu(id) {
  const s = ehStore(id);
  dialog('<h2 class="ehdh">' + h(s.name) + '</h2><p class="ehdp">' + h(S.eh.floor) + ' · 매장번호 ' + s.no + ' · 기기 ' + s.items.length + '대</p>' +
    '<div class="list"><button class="btn big" onclick="ehStoreDlg(\'' + id + '\')">매장 이름 바꾸기</button>' +
    '<button class="btn big warn" onclick="ehStoreDelDlg(\'' + id + '\')">매장 삭제</button>' +
    '<button class="btn big" onclick="closeDialog()">닫기</button></div>');
}
function ehStoreDelDlg(id) {
  const s = ehStore(id);
  dialog('<h2 class="ehdh">「' + h(s.name) + '」 매장 삭제</h2><p class="ehdp">이 매장과 <b>기기 ' + s.items.length + '대의 필증</b>이 목록에서 빠집니다. 붙어 있는 필증 QR을 찍으면 「삭제된 필증」으로 나옵니다. 시트 기록은 남습니다.</p>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="sdB" class="btn big warn" style="flex:2" onclick="ehStoreDelGo(\'' + id + '\')">매장 삭제</button></div>');
}
async function ehStoreDelGo(id) {
  $('sdB').disabled = true;
  try { const r = await call('ehStoreDelete', id); closeDialog(); if (!r.ok) return toast(r.error); toast('매장 삭제 · 기기 ' + r.count + '대'); ehSet(r); } catch (e) { $('sdB').disabled = false; }
}

/* 기기 추가 · 편집 (관리번호 자동) */
function ehItemDlg(itemId, storeId) {
  const i = itemId ? ehItem(itemId) : null, s = i ? i.store : ehStore(storeId);
  const last = s.items[s.items.length - 1] || S.eh.stores.map(x => x.items[0]).find(Boolean) || {};
  const v = i || { name: '', w: '', maker: '', m1: last.m1 || '', m2: last.m2 || '매장관리자', date: ehToday() };
  const f = (id, label, val, extra) => '<label class="ehf">' + label + '<input id="' + id + '" class="inp" value="' + h(val) + '" ' + (extra || '') + '></label>';
  dialog('<h2 class="ehdh">' + (i ? '전열기기 편집' : '전열기기 추가') + '</h2><p class="ehdp">' + h(S.eh.floor) + ' · ' + h(s.name) + '</p>' +
    '<div class="ehf">관리번호 (자동)<div class="ehro">' + (i ? h(i.no) : h(S.eh.floor) + '-' + s.no + '-<i>다음 번호</i>') + '<small>층-매장번호-순번</small></div></div>' +
    f('eiN', '기기명', v.name, 'maxlength="40" placeholder="예: 커피머신"') +
    '<div class="ehtwo">' + f('eiW', '용량 (W)', v.w, 'inputmode="decimal" maxlength="7" placeholder="예: 1500"') + f('eiK', '제조사', v.maker, 'maxlength="40"') + '</div>' +
    '<div class="ehtwo">' + f('eiA', '책임자 (정)', v.m1, 'maxlength="30"') + f('eiB', '책임자 (부)', v.m2, 'maxlength="30"') + '</div>' +
    f('eiD', '승인일자', v.date, 'type="date"') +
    '<div id="eiM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda">' + (i ? '<button class="btn big warn" onclick="ehDelDlg([\'' + i.id + '\'])">삭제</button>' : '') + '<button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="eiS" class="btn big pri" style="flex:2" onclick="ehItemSave(\'' + (i ? i.id : '') + '\',\'' + s.id + '\')">저장</button></div>');
  if (!i) setTimeout(() => { const n = $('eiN'); if (n) n.focus(); }, 50);
}
async function ehItemSave(id, esId) {
  const d = { id: id, esId: esId, name: $('eiN').value, w: $('eiW').value, maker: $('eiK').value, m1: $('eiA').value, m2: $('eiB').value, date: $('eiD').value };
  $('eiS').disabled = true;
  try {
    const r = await call('ehSave', d);
    if (!r.ok) { $('eiM').textContent = r.error; $('eiS').disabled = false; return; }
    closeDialog(); S.ehOpen[esId] = true; ehSet(r); toast((id ? '저장 · ' : '추가 · ') + r.saved);
  } catch (e) { $('eiS').disabled = false; }
}
function ehDelDlg(ids) {
  ids = ids || ehSelIds();
  const list = ids.map(ehItem).filter(Boolean);
  dialog('<h2 class="ehdh">필증 ' + list.length + '장 삭제</h2><p class="ehdp" style="max-height:30vh;overflow:auto">' + list.map(i => h(i.no) + ' · ' + h(i.name)).join('<br>') + '</p>' +
    '<p class="ehdp" style="color:var(--muted)">목록에서 빠지고, 붙어 있는 필증 QR을 찍으면 「삭제된 필증」으로 나옵니다. 지운 관리번호는 다시 쓰지 않습니다.</p>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="edB" class="btn big warn" style="flex:2" onclick="ehDelGo(' + h(JSON.stringify(ids)) + ')">삭제</button></div>');
}
async function ehDelGo(ids) {
  $('edB').disabled = true;
  try { const r = await call('ehDelete', ids, S.eh.floor); closeDialog(); if (!r.ok) return toast(r.error); ids.forEach(k => delete S.ehSel[k]); toast('필증 ' + r.count + '장 삭제'); ehSet(r); } catch (e) { $('edB').disabled = false; }
}

/* 필증 라벨 50×50mm (4장) — 오른쪽 아래 QR은 프린터 점에 맞춤 */
function ehFit(text, mm, max) { const u = Array.from(String(text)).reduce((n, c) => n + (/[\x00-\x7F]/.test(c) ? 0.56 : 1), 0); return Math.max(4.5, Math.min(max, (mm - 1.6) / Math.max(u, 1) / 0.353)).toFixed(1); }
function ehUrl(token) { return ((S.eh && S.eh.execUrl) || EXEC_URL) + '?eh=' + token; }
function ehLabel(i) {
  const q = qrImage(i.token, 16.6, ehUrl(i.token), 'L');
  const v = (t, mm, max, wide) => '<div class="v' + (wide ? ' wd' : '') + '" style="font-size:' + ehFit(t, mm, max) + 'pt">' + h(t) + '</div>';
  return '<div class="ehl"><div class="ehlh"><img class="ehlogo" src="' + EH_LOGO + '" alt=""><div class="ehlt"><b>전열기기 신고필증</b><span>롯데백화점 에비뉴엘 월드타워점</span></div></div>' +
    '<div class="ehg"><div class="k">관리번호</div>' + v(i.no, 32, 9, 1) + '<div class="k">사용장소</div>' + v(i.store.name, 32, 7.6, 1) + '<div class="k">책임자</div>' + v(i.m1, 32, 7.6, 1) +
    '<div class="k">승인일자</div>' + v(ehDate(i.date), 15.4, 7.6) + '<div class="q"><img src="' + q.src + '" style="width:' + q.mm + 'mm;height:' + q.mm + 'mm" alt=""></div>' +
    '<div class="k">용량(W)</div>' + v(ehW(i.w) + ' W', 15.4, 7.6) + '<div class="k">승인</div>' + v('시설소장', 15.4, 7.6) + '</div></div>';
}
function ehPrint() {
  if (typeof QRCode === 'undefined') return toast('QR 도구를 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요.');
  const list = ehSelIds().map(ehItem).filter(Boolean);
  if (!list.length) return;
  S.ehPv = list.map(i => i.id);
  dialog('<div style="display:flex;align-items:center;margin-bottom:var(--sp-2)"><div class="fname"><b style="font-size:var(--size-l)">필증 미리보기</b><small>' + list.length + '장 · 50×50mm (실제 크기) · ' + labelDpi() + 'dpi · 흑백</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="pvbox ehpv">' + list.slice(0, 6).map(ehLabel).join('') + (list.length > 6 ? '<span class="pvmore">외 ' + (list.length - 6) + '장</span>' : '') + '</div>' +
    '<details class="pvhelp"><summary>BIXOLON SLP-TX400 인쇄 설정</summary><ol>' +
      '<li>인쇄 창 <b>대상</b>: BIXOLON SLP-TX400 · <b>용지 크기</b>: 50×50mm (소화기 라벨과 같음)</li>' +
      '<li><b>여백</b>: 없음 · <b>배율</b>: 기본(100%) · <b>머리글/바닥글</b>: 끔 · <b>배경 그래픽</b>: 켬</li>' +
      '<li>처음 한 번, 또는 라벨지를 바꾼 뒤 프린터 <b>FEED</b> 버튼으로 라벨 위치를 맞춥니다</li></ol></details>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3)"><button class="btn" onclick="closeDialog()">닫기</button><button class="btn" style="flex:1" onclick="ehDoPrint(true)">1장 시험 인쇄</button><button id="ehGo" class="btn pri" style="flex:2" onclick="ehDoPrint()">' + ICON.print + ' 인쇄 (' + list.length + '장)</button></div>');
}
function ehDoPrint(one) {
  const ids = one ? S.ehPv.slice(0, 1) : S.ehPv;
  $('print').innerHTML = '<style>@page{size:50mm 50mm;margin:0}</style>' + ids.map(ehItem).filter(Boolean).map(ehLabel).join('');
  closeDialog();
  setTimeout(() => window.print(), 300);
  if (!one) call('ehPrinted', ids, S.eh.floor).then(r => { if (r && r.ok) ehSet(r); }).catch(() => {});
}

/* 엑셀 「전열기 관리대장」 가져오기 (처음 한 번, PC) */
function ehImportDlg(re) {
  S.ehX = null; S.ehRe = !!re;
  dialog('<h2 class="ehdh">' + (re ? '엑셀 다시 가져오기' : '엑셀 가져오기 (처음 한 번)') + '</h2><p class="ehdp">「전열기 관리대장.xlsx」를 고르면 층 시트(B3F~6F·팝업)의 매장·기기를 읽습니다. 파일은 올리지 않고 읽은 내용만 저장합니다.</p>' +
    (re ? '<div class="banner b-red" style="margin-bottom:var(--sp-2)">지금 들어 있는 매장·기기를 <b>모두 지우고</b> 새 엑셀 내용으로 바꿉니다. 앱에서 따로 추가·수정한 것도 엑셀에 없으면 사라집니다. 관리번호가 같은 기기는 QR이 그대로라 붙은 필증은 계속 씁니다.</div>' : '') +
    '<label class="btn" style="width:100%;min-height:64px;border-style:dashed;color:var(--blue);position:relative">' + ICON.clip + ' 엑셀 파일(.xlsx) 고르기<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange="ehXFile(this)" style="position:absolute;width:1px;height:1px;opacity:0"></label>' +
    '<div id="ehXo" style="margin-top:var(--sp-3)"></div>');
}
async function ehXFile(el) {
  const f = el.files && el.files[0]; if (!f) return;
  $('ehXo').innerHTML = '<div class="banner b-gray">읽는 중…</div>';
  try {
    await loadXlsx();
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }), sheets = {};
    wb.SheetNames.filter(n => /^(B[1-3]F?|[1-6]F|팝업)$/.test(n.trim())).forEach(n => {
      sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).map(r => r.slice(0, 12).some(x => String(x).trim()) ? r.slice(0, 12).map(x => String(x)) : []);
    });
    const r = await call('ehImport', sheets, false);
    if (!r.ok) { $('ehXo').innerHTML = '<div class="banner b-red">' + h(r.error) + '</div>'; return; }
    S.ehX = sheets; const c = r.check;
    $('ehXo').innerHTML = '<table class="atst"><tr><th>층</th><th>매장</th><th>기기</th></tr>' + c.floors.filter(x => x[1]).map(x => '<tr><td>' + x[0] + '</td><td>' + x[1] + '</td><td>' + x[2] + '</td></tr>').join('') +
      '<tr class="sum"><td>합계</td><td>' + c.stores + '</td><td>' + c.items + '</td></tr></table>' +
      '<p class="ehdp" style="margin-top:var(--sp-2)">· 관리번호 그대로 ' + (c.items - c.renumbered) + '대 (지하 B1F- → B1- ' + c.bfix + '대)<br>· 번호 없음·겹침 → <b>새 번호 ' + c.renumbered + '대</b><br>· 「폐기·매장철수」 표시 <b>' + c.gone + '대</b>는 삭제 상태로 넣음<br>· 승인일자 빈칸 ' + c.noDate + '대</p>' +
      '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="ehXb" class="btn big ' + (S.ehRe ? 'warn' : 'pri') + '" style="flex:2" onclick="ehXSave()">' + (S.ehRe ? '모두 바꿔 넣기' : '가져오기') + '</button></div>';
  } catch (e) { $('ehXo').innerHTML = '<div class="banner b-red">' + h(e && e.message ? e.message : e) + '</div>'; }
}
async function ehXSave() {
  $('ehXb').disabled = true; $('ehXb').innerHTML = '<span class="spin"></span> 저장 중 (1~2분)';
  const back = () => { $('ehXb').disabled = false; $('ehXb').textContent = S.ehRe ? '모두 바꿔 넣기' : '가져오기'; };
  try { const r = await call('ehImport', S.ehX, true, S.ehRe); if (!r.ok) { toast(r.error); back(); return; } closeDialog(); S.ehX = null; S.ehSel = {}; toast('매장 ' + r.check.stores + '곳 · 기기 ' + r.check.items + '대 가져옴' + (r.kept != null && S.ehRe ? ' (QR 그대로 ' + r.kept + '대)' : '')); ehSet(r); }
  catch (e) { back(); }
}

