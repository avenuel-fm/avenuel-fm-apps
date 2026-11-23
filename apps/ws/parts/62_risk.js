/* ── 서류작업 › 위험작업신청서 (WS_위험작업신청서, 결정 236): 손으로 쓴 신청서를 찍는 대로 저장 · 일자별 4열 · 검색 · 확대 · 인쇄 A4 ── */
const RW_FLOORS = ['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '10F', '외곽'];   // 서버 ws_rw_floors 와 같게
function rwToday() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function rwCid() { return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); }   // 사진마다 고유 번호 — 다시 보내도 한 번만 저장
async function openRw() {
  S.rw = S.rw || { list: null, q: '', qv: '', day: rwToday(), co: '', floor: '', pend: [], open: {}, keys: [], admin: false };
  go('rw'); await loadRw();
}
async function loadRw() {
  const k = S.rw, r = await call('rwList', k.q, '', '');
  if (!r.ok) return toast(r.error || '불러오지 못했습니다');
  k.list = r.list; k.admin = r.admin; if (S.view === 'rw') render();
  rwFlush();
}
function rwDays(list) { const g = []; list.forEach(x => { const l = g[g.length - 1]; if (l && l.day === x.day) l.list.push(x); else g.push({ day: x.day, list: [x] }); }); return g; }
function rwDay(d) { return d.slice(0, 4) + '-' + d.slice(5, 7) + '-' + d.slice(8, 10); }
function rwCap(x) { return '<div class="rwcap">' + (x.co ? h(x.co) : '<span class="rwno">(업체 미입력)</span>') + (x.floor ? ' · ' + h(x.floor) : '') + '<br>' + h(x.at) + '</div>'; }
function rwTile(x) {
  return '<div class="rwt"><button type="button" class="ph43 rwim" onclick="rwView(\'' + x.id + '\')" aria-label="사진 크게 보기"><img src="' + h(x.src) + '" loading="lazy" alt="위험작업신청서 ' + h(x.day) + '"></button>' +
    (S.rw.admin ? '<button type="button" class="rwx" onclick="rwDel(\'' + x.id + '\')" aria-label="사진 지우기">✕</button>' : '') + rwCap(x) + '</div>';
}
function rwResHtml() {
  const k = S.rw; if (!k.list) return '<div class="banner b-gray">불러오는 중…</div>';
  if (!k.list.length) return '<div class="banner b-gray">' + (k.q ? '찾는 사진이 없습니다' : '저장된 사진이 없습니다. 위 버튼으로 신청서를 찍어 주세요') + '</div>';
  return rwDays(k.list).map((d, i) => {
    const open = d.day in k.open ? k.open[d.day] : i === 0;
    return '<button class="csacc' + (open ? ' on' : '') + '" aria-expanded="' + open + '" onclick="rwAcc(\'' + d.day + '\')"><b>' + rwDay(d.day) + '</b><span class="csn">' + d.list.length + '장</span><span class="csar" aria-hidden="true"></span></button>' +
      (open ? '<div class="rwg">' + d.list.map(rwTile).join('') + '</div>' : '');
  }).join('');
}
function rwPendHtml() { const n = S.rw.pend.length; return n ? '<div class="banner b-warn rwpend">올리기 대기 중 ' + n + '장 — 연결되면 자동으로 올라갑니다 <button class="btn sm" onclick="rwFlush()">지금 올리기</button></div>' : ''; }
function rwRedraw() { const k = S.rw, a = $('rwRes'), b = $('rwPend'); if (a) a.innerHTML = rwResHtml(); if (b) b.innerHTML = rwPendHtml(); const c = $('rwN'); if (c && k.list) c.textContent = k.list.length; }
function rwAcc(d) { const k = S.rw, cur = d in k.open ? k.open[d] : (k.list[0] && k.list[0].day === d); k.open[d] = !cur; rwRedraw(); }
function renderRw() {
  const k = S.rw, fl = RW_FLOORS.map(f => '<button type="button" class="rwfl' + (k.floor === f ? ' on' : '') + '" aria-pressed="' + (k.floor === f) + '" onclick="rwFloor(\'' + f + '\')">' + f + '</button>').join('');
  const pick = cam => '<label class="btn' + (cam ? ' pri' : '') + '">' + (cam ? ICON.cam + ' 사진찍기' : ICON.folder + ' 갤러리에서 선택') + '<input type="file" accept="image/*"' + (cam ? ' capture="environment"' : ' multiple') + ' hidden onchange="rwAdd(this)"></label>';
  return topbar('서류작업 ›', '위험작업신청서') + '<div class="wrap list">' +
    '<div class="cssec"><label class="cssrch"><input id="rwQ" type="search" enterkeyhint="search" placeholder="날짜 · 업체명 · 위치 검색" aria-label="날짜 업체명 위치 검색" value="' + h(k.qv) + '" oninput="S.rw.qv=this.value" onkeydown="if(event.key===\'Enter\')rwSearch()"></label><button class="btn pri" onclick="rwSearch()">검색하기</button></div>' +
    '<div class="card rwadd"><div class="tbpb">' + pick(true) + pick(false) + '</div><small class="rwhint">찍거나 고르면 바로 저장됩니다. 날짜 태그 <input id="rwDay" type="date" value="' + h(k.day) + '" onchange="S.rw.day=this.value||rwToday()" aria-label="날짜 태그"> (기본: 오늘)</small>' +
    '<label class="rwlb">업체명 · 매장명 (직접 입력, 선택)</label><input id="rwCo" class="inp" maxlength="30" placeholder="예: OO인테리어" value="' + h(k.co) + '" oninput="S.rw.co=this.value">' +
    '<label class="rwlb">위치 (선택)</label><div class="rwfls">' + fl + '</div><small class="rwhint">비워 둬도 저장됩니다. 이후 저장하는 사진에 같은 값이 붙습니다.</small></div>' +
    '<div id="rwPend">' + rwPendHtml() + '</div>' +
    '<div class="cssec">' + (k.q ? '「' + h(k.q) + '」 검색 결과' : '최근 60일') + ' · <span id="rwN">' + (k.list ? k.list.length : '…') + '</span>장</div>' +
    '<div id="rwRes" class="card rwres">' + rwResHtml() + '</div>' +
    '<div class="nwbar"><button class="btn" onclick="rwPrint()">' + ICON.print + '인쇄 A4</button></div></div>';
}
function rwFloor(f) { const k = S.rw; k.floor = k.floor === f ? '' : f; render(); }
function rwSearch() { const k = S.rw; k.q = k.qv.trim(); k.open = {}; loadRw(); }
/* 사진 넣기: 글자가 읽히게 2400px·85%로 줄임(일반 현장 사진 1600px·70%보다 덜 줄임). 같은 사진을 연달아 고르면 건너뜀 */
async function rwAdd(el) {
  const fs = Array.from(el.files || []); el.value = ''; if (!fs.length) return;
  const k = S.rw; let dup = 0;
  for (const f of fs) {
    const key = f.name + '|' + f.size + '|' + f.lastModified;
    if (k.keys.indexOf(key) !== -1) { dup++; continue; }
    try { k.pend.push({ cid: rwCid(), data: await shrinkJpeg(f, 2400, 0.85), day: k.day || rwToday(), co: k.co.trim(), floor: k.floor }); k.keys.push(key); if (k.keys.length > 60) k.keys.shift(); } catch (e) { toast(e.message); }
  }
  if (dup) toast(dup + '장은 이미 저장한 사진이라 건너뜁니다');
  rwRedraw(); rwFlush();
}
const RW_NET = /fetch|network|load failed|연결|timeout|offline/i;
let RW_T = 0;
async function rwFlush() {
  const k = S.rw; if (!k || k.sending || !S.token) return;
  k.sending = true;
  try {
    while (k.pend.length) {
      const p = k.pend[0]; let r;
      try { r = await run('rwAdd', S.token, p.day, p.co, p.floor, p.data, p.cid); }
      catch (e) {
        const m = String(e && e.message);
        if (m.indexOf('LOGIN') !== -1) { logout(true); return; }
        if (RW_NET.test(m)) break;   // 통신 불량: 기기에 두고 나중에 다시 (shortcut: 앱을 닫으면 대기분은 사라짐 — 필요하면 IndexedDB 보관으로)
        k.pend.shift(); toast(m || '저장하지 못했습니다'); continue;
      }
      k.pend.shift();
      if (!r || !r.ok) { toast((r && r.error) || '저장하지 못했습니다'); continue; }
      if (k.list && !k.list.some(x => x.id === r.item.id)) { k.list.push(r.item); k.list.sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0); }
    }
  } finally { k.sending = false; }
  if (S.view === 'rw') rwRedraw();
  clearTimeout(RW_T); if (k.pend.length) RW_T = setTimeout(rwFlush, 20000);
}
window.addEventListener('online', () => { if (S.rw && S.rw.pend.length) rwFlush(); });
async function rwDel(id) {
  if (!confirm('이 사진을 지울까요?')) return;
  const r = await call('rwDelete', id); if (!r.ok) return toast(r.error);
  const k = S.rw; k.list = k.list.filter(x => x.id !== id); rwRedraw(); toast('지웠습니다');
}
/* 사진 크게 보기: 이전·다음 · 확대 100~400% (스크롤로 이동) */
function rwView(id) { const k = S.rw, i = k.list.findIndex(x => x.id === id); if (i < 0) return; k.v = { i, z: 1 }; rwViewDraw(); }
function rwViewDraw() {
  const k = S.rw, v = k.v, x = k.list[v.i];
  $('layer').innerHTML = '<div class="rwv" role="dialog" aria-modal="true"><div class="rwvh"><span>' + h(rwDay(x.day)) + ' · ' + h(x.co || '(업체 미입력)') + (x.floor ? ' · ' + h(x.floor) : '') + ' · ' + h(x.at) + '</span><button class="btn sm" onclick="rwClose()">닫기</button></div>' +
    '<div class="rwvb"><img src="' + h(x.src) + '" style="width:' + v.z * 100 + '%" alt="신청서 사진"></div>' +
    '<div class="rwvf"><button class="btn sm" onclick="rwNav(-1)"' + (v.i ? '' : ' disabled') + '>이전</button><button class="btn sm" onclick="rwZoom(-0.5)" aria-label="작게">−</button><b>' + Math.round(v.z * 100) + '%</b><button class="btn sm" onclick="rwZoom(0.5)" aria-label="크게">＋</button><button class="btn sm" onclick="rwNav(1)"' + (v.i < k.list.length - 1 ? '' : ' disabled') + '>다음</button></div></div>';
}
function rwClose() { S.rw.v = null; closeDialog(); }
function rwNav(d) { const v = S.rw.v; v.i = Math.max(0, Math.min(S.rw.list.length - 1, v.i + d)); v.z = 1; rwViewDraw(); }
function rwZoom(d) { const v = S.rw.v; v.z = Math.max(1, Math.min(4, v.z + d)); rwViewDraw(); }
/* 인쇄 = A4 세로. 지금 화면에 보이는 사진(검색 결과)을 일자별로, 한 줄 4장 */
function rwPrint() {
  const k = S.rw; if (!k.list || !k.list.length) return toast('인쇄할 사진이 없습니다');
  $('print').innerHTML = '<style>@page{size:A4;margin:10mm}.rwpr{font-family:"Noto Sans KR",sans-serif;color:#000}.rwpr h1{font-size:15pt;margin:0 0 1mm}.rwpr h2{font-size:11pt;margin:4mm 0 2mm;border-bottom:.3mm solid #000}' +
    '.rwpr .g{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.rwpr .t{break-inside:avoid;font-size:7pt;line-height:1.3}.rwpr .b{aspect-ratio:4/3;background:#eceff3;display:flex;align-items:center;justify-content:center}.rwpr img{max-width:100%;max-height:100%;display:block}</style>' +
    '<div class="rwpr"><h1>위험작업신청서</h1><div style="font-size:8pt">에비뉴엘 잠실점 시설팀 · ' + (k.q ? '검색: ' + h(k.q) + ' · ' : '') + '출력 ' + rwToday() + ' · ' + k.list.length + '장</div>' +
    rwDays(k.list).map(d => '<h2>' + rwDay(d.day) + ' (' + d.list.length + '장)</h2><div class="g">' + d.list.map(x => '<div class="t"><div class="b"><img src="' + h(x.src) + '" alt=""></div>' + (x.co ? h(x.co) : '(업체 미입력)') + (x.floor ? ' · ' + h(x.floor) : '') + ' ' + h(x.at.slice(6)) + '</div>').join('') + '</div>').join('') + '</div>';
  const im = [...$('print').querySelectorAll('img')];
  Promise.all(im.map(i => i.decode ? i.decode().catch(() => {}) : null)).then(() => setTimeout(() => window.print(), 100));
}
