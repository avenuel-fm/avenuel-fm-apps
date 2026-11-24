/* ── 서류작업 (WS_서류작업.md) ── */
function renderDocs() {
  const n = S.docs ? S.docs.signs : null;
  const R = (k, fn, bg, col, ico, name, sm) => subRow('docs.' + k, fn, bg, col, ico, name, sm);
  return topbar('업무지원 ›', '서류작업') + '<div class="wrap list">' +
    R('tbm', 'openTbm()', 'var(--green-bg)', 'var(--green)', ICON.tbm, 'TBM', '오늘 서명 ' + (n == null ? '…' : n + '명') + ' · 작업 표 · 사진 · PDF') +
    R('nw', 'openNw()', 'var(--blue-bg)', 'var(--blue)', ICON.nw, '명일 작업 예정', '내일 작업 입력 · 그림으로 저장') +
    R('att', 'openAtt()', 'var(--tint)', 'var(--navy)', ICON.att, '출근현황', '근무 스케줄 엑셀 → 날짜별 조직도 · 그림으로 저장') +
    R('ahu', 'openAhu()', 'var(--blue-bg)', 'var(--blue)', ICON.ahu, '온습도/공조기/에어커튼 입력', 'AHU 환기온도 11:00 · 16:00 · 매장 온습도 · 가동시간 · 리포트') +
    R('log', 'openLog()', 'var(--tint)', 'var(--sub)', ICON.log, '종합업무일지', '에너지 사용량 · 날씨 · 금일작업 · B4 인쇄 (PC)') +
    R('risk', 'openRw()', 'var(--orange-bg)', 'var(--orange)', ICON.hat, '위험작업신청서', '신청서 사진 · 날짜 · 업체 · 위치 · 검색 · 인쇄 A4') +
    '</div>';
}
/* 미리 받기 (결정 78): 메인이 뜬 뒤 자주 여는 화면 내용을 뒤에서 받아 두고, 열 때 바로 보여 준 뒤 새로 받음 */
const PRE = {};
function prefetch() {
  if (!S.token) return;
  run('tbmGet', S.token).then(r => { if (r && r.ok) PRE.tbm = { at: Date.now(), r }; }).catch(() => {});
  run('nextWorkGet', S.token, '').then(r => { if (r && r.ok) PRE.nw = { at: Date.now(), r }; }).catch(() => {});
}
function takePre(k) { const p = PRE[k]; delete PRE[k]; return p && Date.now() - p.at < 600000 ? p.r : null; }   // 10분 넘은 것은 버림
async function openTbm() { S.tbm = null; const p = takePre('tbm'); go('tbm'); if (p) tbmUse(p); await loadTbm(true); }

/* ── TBM 작성 · PDF (WS_서류작업 4-1~5장, 결정 58·66·70) ── */
const TBM_CHECKS = ['사다리', '비계', '우마', '테이블리프트', '크레인', '스카이', '달비계', '용접기'];
const TBM_CHECK_WORDS = { '사다리': ['사다리'], '비계': ['비계'], '우마': ['우마', '말비계'], '테이블리프트': ['테이블리프트', '고소작업대', '렌탈'], '크레인': ['크레인'], '스카이': ['스카이'], '달비계': ['달비계'], '용접기': ['용접'] };
function tbmText(w) { return (w.work || '') + ' ' + (w.note || ''); }
function tbmHas(t, k) { if (k === '비계') t = t.replace(/[달말]비계/g, ''); return TBM_CHECK_WORDS[k].some(x => t.indexOf(x) !== -1); }
function tbmAutoChecks(works) { const t = works.map(tbmText).join(' '), o = {}; TBM_CHECKS.forEach(k => { if (tbmHas(t, k)) o[k] = true; }); return o; }
// 작업내용(+명일 비고)에서 목록을 위에서부터 보고 처음 맞는 위험요인, 없으면 「(기본)」 (4-2)
function tbmRiskFor(t) { const L = S.tbm.risks; return L.find(r => r.words.some(x => x !== '(기본)' && t.indexOf(x) !== -1)) || L.find(r => r.words.indexOf('(기본)') !== -1) || null; }
function tbmApply(w, r) { Object.assign(w, r ? { risk: r.risk, kind: r.kind, p: r.p, s: r.s, fixes: r.fixes.filter(f => f.on).map(f => f.t) } : { risk: '', kind: '', p: '', s: '', fixes: [] }); }
function tbmLv(p, s) { const v = p * s; return v ? v + ' (' + (v >= 6 ? '상' : v >= 3 ? '중' : '하') + ')' : ''; }
// 인원 = 그 줄 부서(=파트)의 오늘 서명 인원, 소장·부소장 빼고. 직접 넣으면 그 숫자
function tbmAutoN(w) { return S.tbm.signs.filter(x => x.part === w.dept && x.role !== '소장' && x.role !== '부소장').length; }
function tbmN(w) { return w.n !== '' && w.n != null ? Number(w.n) : tbmAutoN(w); }
async function loadTbm(quiet, day) {
  if (!quiet && S.tbm && S.tbm.dirty && !confirm('저장하지 않은 내용이 있습니다. 버리고 새로 불러올까요?')) return;
  const r = await call('tbmGet', day || (S.tbm ? S.tbm.day : ''));
  const t = S.tbm;
  // 뒤에서 새로 받는 중에 고치거나 저장 중이면, 고친 것은 두고 서명만 새로
  if (quiet && t && t.day === r.day && (t.dirty || t.busy || t.pdfBusy)) { Object.assign(t, { signs: r.signs, manager: r.manager }); if (S.view === 'tbm') render(); return; }
  tbmUse(r);
}
/** TBM 날짜 바꾸기 — 지난 날짜도 열어서 고치고 저장·PDF 가능 (11-13, 사용자) */
function tbmCal() {
  const r = S.tbm;
  pickDate({ cur: r.day, home: r.today || r.day, max: r.today || r.day, homeLbl: '오늘 TBM으로', fn: ds => {
    if (ds === S.tbm.day || (S.tbm.dirty && !confirm('저장하지 않은 내용이 있습니다. 버리고 다른 날짜를 열까요?'))) return;
    S.tbm = null; render(); loadTbm(true, ds);
  } });
}
function tbmUse(r) {
  const keep = S.tbm;
  S.tbm = Object.assign(r, { dirty: false, busy: false, pdfBusy: false, edit: keep ? keep.edit : -1, up: {}, showSigns: keep ? keep.showSigns : false, pdfStale: !!(r.pdf && r.at > r.pdf.at) });
  r.works.forEach(w => { w.fixes = w.fixes || []; if (w.risk === undefined) tbmApply(w, tbmRiskFor(tbmText(w))); });
  if (!r.checks) r.checks = tbmAutoChecks(r.works);
  if (S.docs) S.docs.signs = r.signs.length;
  if (S.view === 'tbm') render();
}
function tbmState() { const r = S.tbm; return r.dirty ? '<span class="nwstate dirty">● 저장 안 함</span>' : r.saved ? '<span class="nwstate">✓ 저장됨</span>' : ''; }
function tbmDirty() { S.tbm.dirty = true; S.tbm.pdfStale = true; const e = $('tbState'); if (e) e.innerHTML = tbmState(); docSlotSet(tbmDoc()); }
// PDF를 만든 뒤 고친 것·새 서명이 없으면 [PDF 보기], 아니면 [저장] = 저장 + PDF (결정 72·176)
function tbmDoc() { const r = S.tbm; return { sid: 'tbState', state: tbmState(), save: 'tbmPdf()', busy: r.busy || r.pdfBusy, pdfBusy: r.pdfBusy, pdf: r.pdf && !r.dirty && !r.pdfStale && r.signs.length <= r.pdf.signs ? { url: r.pdf.url, pv: tbmPv(r) } : null }; }
function tbmCard(w, i) {
  const r = S.tbm, ed = r.edit === i, cur = r.risks.find(x => x.risk === w.risk);
  const seg = (k) => '<div class="seg tbseg" role="group" aria-label="' + (k === 'p' ? '가능성' : '중대성') + '">' + [1, 2, 3].map(n => '<button type="button" class="' + (Number(w[k]) === n ? 'on' : '') + '" aria-pressed="' + (Number(w[k]) === n) + '" onclick="tbmSet(' + i + ',\'' + k + '\',' + n + ')">' + n + '</button>').join('') + '</div>';
  const all = cur ? cur.fixes.map(f => f.t) : [];
  w.fixes.forEach(f => { if (all.indexOf(f) === -1) all.push(f); });
  const v = w.p * w.s;
  return '<div class="card tbw">' +
    '<div class="tbh"><span class="nwno">' + (i + 1) + '</span><span class="fname"><b>' + h(w.work || '(작업 내용 없음)') + '</b><small>' + h([w.place, w.dept, '인원 ' + tbmN(w) + (w.n === '' || w.n == null ? ' (자동)' : '')].filter(Boolean).join(' · ')) + '</small></span>' +
    '<button class="btn sm" onclick="tbmEdit(' + i + ')">' + (ed ? '닫기' : '고치기') + '</button></div>' +
    (ed ? '<div class="tbedit">' +
      '<label class="tbf"><span>작업 내용</span><input class="inp" maxlength="100" value="' + h(w.work) + '" oninput="tbmIn(' + i + ',\'work\',this)"></label>' +
      '<label class="tbf"><span>작업위치</span><input class="inp" maxlength="40" value="' + h(w.place) + '" oninput="tbmIn(' + i + ',\'place\',this)"></label>' +
      '<div class="tbf"><span>부서</span><div class="seg">' + NW_DEPTS.map(d => '<button type="button" class="' + (w.dept === d ? 'on' : '') + '" onclick="tbmDept(' + i + ',\'' + d + '\')">' + d + '</button>').join('') + '</div></div>' +
      '<label class="tbf"><span>인원 (비우면 자동 ' + tbmAutoN(w) + '명)</span><input class="inp" inputmode="numeric" maxlength="3" value="' + h(w.n) + '" oninput="this.value=this.value.replace(/\\D/g,\'\');tbmIn(' + i + ',\'n\',this)"></label>' +
      '<button class="btn warn" onclick="tbmDel(' + i + ')">이 줄 지우기</button></div>' : '') +
    '<div class="tbf"><span>위험요인</span><select class="inp" onchange="tbmPick(' + i + ',this)"><option value="">위험요인 고르기</option>' +
      r.risks.map(x => '<option' + (x.risk === w.risk ? ' selected' : '') + '>' + h(x.risk) + '</option>').join('') + (w.risk && !cur ? '<option selected>' + h(w.risk) + '</option>' : '') + '</select></div>' +
    '<label class="tbf"><span>재해형태 <em>자동 · 고칠 수 있음</em></span><input class="inp" maxlength="20" value="' + h(w.kind) + '" oninput="tbmIn(' + i + ',\'kind\',this)"></label>' +
    '<div class="tbf"><span>위험성 <em>가능성 × 중대성 · 눌러서 바꿈</em></span><div class="tbrisk"><small>가능성</small>' + seg('p') + '<small>중대성</small>' + seg('s') +
      '<b class="tblv ' + (v >= 6 ? 'hi' : v >= 3 ? 'mid' : v ? 'lo' : '') + '">' + (v ? tbmLv(w.p, w.s).replace(' (', ' · ').replace(')', '') : '—') + '</b></div></div>' +
    '<div class="tbf"><span>안전보건 개선조치 <em>여러 개 고르기</em></span><div class="tbfx">' +
      all.map(t => { const on = w.fixes.indexOf(t) !== -1; return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox"' + (on ? ' checked' : '') + ' value="' + h(t) + '" onchange="tbmFix(' + i + ',this)">' + h(t) + '</label>'; }).join('') +
      '<div class="tbown"><input class="inp" id="fx' + i + '" maxlength="80" placeholder="직접 쓰기"><button class="btn" onclick="tbmFixAdd(' + i + ')">더하기</button></div></div></div>' +
    '</div>';
}
function tbmPhotoCell(k, label) {
  const src = S.tbm.up[k] || S.tbm.photos[k];
  const pick = (cam) => '<label class="btn sm">' + (cam ? ICON.cam + ' 카메라' : ICON.folder + ' 파일') + '<input type="file" accept="image/*"' + (cam ? ' capture="environment"' : '') + ' hidden onchange="tbmPhoto(\'' + k + '\',this)"></label>';
  return '<div class="tbph"><b>' + label + '</b><div class="ph43">' + (src ? '<img src="' + src + '" alt="' + label + '">' : '<small>사진 없음</small>') + '</div><div class="tbpb">' + pick(true) + pick(false) + '</div></div>';
}
function renderTbm() {
  const r = S.tbm;
  if (!r) return topbar('서류작업 ›', 'TBM') + '<div class="wrap list"><div class="banner b-gray">불러오는 중…</div></div>';
  const d = new Date(r.day + 'T12:00:00+09:00');
  const dl = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const more = r.pdf && r.signs.length > r.pdf.signs ? r.signs.length - r.pdf.signs : 0;
  const list = !r.signs.length ? '<div class="banner b-gray">아직 서명한 직원이 없습니다.</div>' :
    '<div class="card">' + r.signs.map(x => '<div class="sgrow"><span class="sgno">' + x.no + '</span><span class="fname"><b>' + h(x.name) + '</b><small>' + h(x.part) + (x.role === '소장' || x.role === '부소장' ? ' · ' + h(x.role) : '') + '</small></span>' +
      '<span class="sgimg">' + (x.img ? '<img src="' + x.img + '" alt="' + h(x.name) + ' 서명">' : '') + '<small>' + h(x.at) + '</small></span></div>').join('') + '</div>';
  const past = r.today && r.day < r.today;
  return topbar('서류작업 ›', 'TBM') + '<div class="wrap list">' +
    '<div class="card" style="padding:var(--sp-4)"><div class="nwhead"><b>TBM</b><button class="nwdate" data-date="' + h(r.day) + '" onclick="tbmCal()" aria-label="날짜 바꾸기">' + ICON.cal + dl + '</button></div>' +
    (past ? '<div class="nwmeta">지난 날짜입니다. 고쳐서 저장하면 이 날짜 TBM이 바뀝니다.</div>' : '') + '</div>' +
    '<div class="card tbsum"><span class="fname"><b>서명 ' + r.signs.length + '명</b><small>관리감독자 ' + (r.manager ? h(r.manager.name) : '없음 (소장·부소장 서명 전)') + ' · 로그인 순서대로</small></span>' +
    '<button class="btn sm" onclick="loadTbm()">새로고침</button><button class="btn sm" onclick="S.tbm.showSigns=!S.tbm.showSigns;render()">' + (r.showSigns ? '목록 닫기' : '서명 목록') + '</button></div>' +
    (r.showSigns ? list : '') +
    (r.pdf && r.pdf.shared === false ? '<div class="banner b-red">이 PDF는 <b>공유가 안 되어</b> 구글 로그인을 안 한 휴대폰·PC에서는 열리지 않습니다. 시설팀 공용 계정의 드라이브에서 파일 공유를 「링크가 있는 모든 사용자」로 바꾸거나 관리자에게 알려 주세요.</div>' : '') +
    (r.pdf ? '<div class="banner ' + (more ? 'b-warn' : 'b-info') + '">PDF 저장됨 ' + h(String(r.pdf.at).slice(11, 16)) + ' · 서명 ' + r.pdf.signs + '명' + (more ? ' — <b>PDF 뒤 서명 ' + more + '명 추가</b>. [저장]을 다시 누르면 PDF를 새로 만듭니다.' : '') + ' ' + pdfBtn(null, 'PDF 보기', r.pdf.url, tbmPv(r)) + '</div>' : '') +
    '<div class="sec">작업 표 — ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 명일 작업 예정에서 가져옴</div>' +
    (r.works.length ? r.works.map(tbmCard).join('') : '<div class="banner b-gray">이 날짜의 명일 작업 예정이 없습니다. 아래 [+ 작업 줄 추가]로 넣어 주세요.</div>') +
    '<button class="btn nwadd" onclick="tbmAdd()"' + (r.works.length >= 30 ? ' disabled' : '') + '>+ 작업 줄 추가</button>' +
    '<div class="sec">위쪽 체크 칸 — 작업 내용 낱말로 자동, 눌러서 바꿈</div>' +
    '<div class="card tbck">' + TBM_CHECKS.map(k => '<button type="button" class="' + (r.checks[k] ? 'on' : '') + '" aria-pressed="' + !!r.checks[k] + '" onclick="tbmCheck(\'' + k + '\')">' + k + (r.checks[k] ? ' ○' : '') + '</button>').join('') + '</div>' +
    '<div class="sec">사진</div>' +
    '<div class="card tbphs">' + tbmPhotoCell('meet', '회의 사진') + tbmPhotoCell('chant', '구호 사진') + '</div>' +
    '<div class="nwbar">' + docBar(tbmDoc()) +
    '</div></div>';
}
function tbmPv(r) { return { name: r.day + '_TBM.pdf', sub: '서류작업 › TBM ›', meta: '서명 ' + r.pdf.signs + '명 · ' + String(r.pdf.at).slice(11, 16) + ' 만듦' }; }
function tbmW(i) { return S.tbm.works[i]; }
function tbmIn(i, k, el) { tbmW(i)[k] = el.value; tbmDirty(); }
function tbmDept(i, d) { tbmW(i).dept = d; tbmDirty(); render(); }
function tbmPick(i, el) { tbmApply(tbmW(i), S.tbm.risks.find(x => x.risk === el.value)); tbmDirty(); render(); }
function tbmSet(i, k, n) { tbmW(i)[k] = n; tbmDirty(); render(); }
function tbmFix(i, el) { const f = tbmW(i).fixes; if (el.checked) { if (f.indexOf(el.value) === -1) f.push(el.value); } else f.splice(f.indexOf(el.value), 1); tbmDirty(); render(); }
function tbmFixAdd(i) { const t = ($('fx' + i).value || '').trim(); if (!t) return; const f = tbmW(i).fixes; if (f.indexOf(t) === -1) f.push(t); tbmDirty(); render(); }
function tbmEdit(i) { S.tbm.edit = S.tbm.edit === i ? -1 : i; render(); }
function tbmAdd() {
  S.tbm.works.push({ place: '', work: '', dept: (S.user && NW_DEPTS.indexOf(S.user.part) !== -1) ? S.user.part : NW_DEPTS[0], n: '', risk: '', kind: '', p: '', s: '', fixes: [] });
  S.tbm.edit = S.tbm.works.length - 1; tbmDirty(); render();
  const el = document.querySelector('.tbedit input'); if (el) el.focus();
}
function tbmDel(i) { if (!confirm((i + 1) + '번 줄을 지울까요?')) return; S.tbm.works.splice(i, 1); S.tbm.edit = -1; tbmDirty(); render(); }
function tbmCheck(k) { S.tbm.checks[k] = !S.tbm.checks[k]; tbmDirty(); render(); }
// 사진: 카메라·파일 둘 다, 긴 변 1600px·70% JPEG로 줄여 보냄 (03 9장)
function shrinkJpeg(file, max, q, gray) {
  return new Promise((ok, no) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      if (gray) { const d = g.getImageData(0, 0, c.width, c.height), p = d.data; for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]); g.putImageData(d, 0, 0); }
      URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', q));
    };
    im.onerror = () => { URL.revokeObjectURL(u); no(new Error('사진을 읽지 못했습니다')); };
    im.src = u;
  });
}
async function tbmPhoto(k, el) {
  const f = el.files && el.files[0]; if (!f) return;
  try { S.tbm.up[k] = await shrinkJpeg(f, 1600, 0.7); tbmDirty(); render(); } catch (e) { toast(e.message); }
}
async function tbmSaveBtn(quiet) {
  const r = S.tbm; if (r.busy) return false;
  r.busy = true; render();
  try {
    const res = await call('tbmSave', { day: r.day, works: r.works, checks: r.checks, meet: r.up.meet || '', chant: r.up.chant || '' });
    r.busy = false;
    if (!res.ok) { render(); toast(res.error); return false; }
    Object.assign(r.photos, r.up); r.up = {}; r.saved = true; r.dirty = false; r.at = res.at;
    render(); if (!quiet) toast('저장했습니다');
    return true;
  } catch (e) { r.busy = false; render(); return false; }
}
let H2P = null;
function loadH2p() {
  if (window.html2pdf) return Promise.resolve();
  return H2P || (H2P = new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    sc.onload = ok; sc.onerror = () => { H2P = null; no(new Error('PDF 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.appendChild(sc);
  }));
}
async function tbmPdf() {
  const r = S.tbm; if (r.busy || r.pdfBusy) return;
  if (!(r.up.meet || r.photos.meet) || !(r.up.chant || r.photos.chant)) { if (!confirm('사진이 비어 있습니다. 그래도 저장할까요?')) return; }
  const save = r.dirty || !r.saved ? { day: r.day, works: r.works, checks: r.checks, meet: r.up.meet || '', chant: r.up.chant || '' } : null;
  r.pdfBusy = true; render();
  try {
    await loadH2p();
    const uri = await tbmMakePdf();
    const res = await call('tbmSavePdf', uri, r.signs.slice(0, 20).map(x => x.id), save, r.day);   // 저장 + PDF를 서버 한 번에
    r.pdfBusy = false;
    if (!res.ok) { render(); toast(res.error); return; }
    if (save) { Object.assign(r.photos, r.up); r.up = {}; r.saved = true; r.dirty = false; }
    r.pdf = res.pdf; r.pdfStale = false; render(); toast(res.warn || '저장하고 PDF도 만들었습니다');
  } catch (e) { r.pdfBusy = false; render(); toast('PDF를 만들지 못했습니다: ' + (e && e.message ? e.message : e)); }
}
/* PDF = A4 가로 2쪽 (1123×794px). 1쪽 평가표, 2쪽 사진. 양식: docs/양식/WS_TBM_양식_*, 시안: WS_TBM_시안_* */
const TBM_PDF_CSS = '.tbp{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#111;background:#fff}' +
  '.tbp *{box-sizing:border-box}.tbp .pg{width:1123px;height:794px;padding:6mm;background:#fff;overflow:hidden}' +
  '.tbp .fr{position:relative;width:100%;height:100%;border:1.6mm solid #7f7f7f;padding:3.5mm 4mm}' +
  '.tbp h1{margin:0;height:13mm;line-height:13mm;text-align:center;font-size:22pt;font-weight:800;letter-spacing:1.2mm}' +
  '.tbp table{width:100%;border-collapse:collapse;table-layout:fixed}' +
  '.tbp td,.tbp th{border:.25mm solid #a6a6a6;font-size:8.5pt;text-align:center;vertical-align:middle;padding:0 1mm;font-weight:400;line-height:1.25;word-break:keep-all;overflow-wrap:anywhere}' +
  '.tbp .hd td{height:9mm;text-align:left;padding-left:2.5mm;white-space:nowrap}.tbp .hd .v{font-size:10pt;font-weight:700;margin-left:1.5mm}' +
  '.tbp .hd .mg{display:flex;align-items:center;justify-content:space-between;padding-right:6mm}' +
  '.tbp .hd .sgn{width:32mm;display:flex;align-items:center;justify-content:center}.tbp .hd .sgn img{max-height:9mm;max-width:32mm}.tbp .hd .tag{color:#555}' +
  '.tbp .ck td{height:8.5mm;padding:0}.tbp .ck .lb{background:#dce6f1}.tbp .ck .on{font-size:12pt;font-weight:700}' +
  '.tbp .wk{margin-top:2mm}.tbp .wk th{background:#dce6f1;height:10mm}.tbp .wk .l{text-align:left}.tbp .wk .s{text-align:left}' +
  '.tbp .sg{margin-top:2mm}.tbp .sg td{height:10.4mm}.tbp .sg .nm{font-size:10pt}.tbp .sg img{max-height:9.6mm;max-width:95%;vertical-align:middle}' +
  '.tbp .pn{position:absolute;left:0;right:0;bottom:1.5mm;text-align:center;font-size:9pt;color:#333}' +
  '.tbp .t1{font-size:11pt;font-weight:700;margin:4mm 0 0 3mm}.tbp .t2{font-size:14pt;font-weight:800;margin:1.5mm 0 0 3mm}' +
  '.tbp .photos{display:flex;margin-top:18mm;height:116mm;border:.25mm solid #a6a6a6}' +
  '.tbp .cell{flex:1;width:50%;border-right:.25mm solid #a6a6a6;background:#eee;display:flex;align-items:center;justify-content:center;overflow:hidden}.tbp .cell:last-child{border-right:0}';
function tbmPdfHtml() {
  const r = S.tbm, [y, m, d] = r.day.split('-'), signs = r.signs.slice(0, 20);
  const n = Math.max(8, r.works.length), rh = 82 / n, fs = Math.max(6.5, 9 * 8 / n), fs2 = (fs * 0.9).toFixed(2);
  const img = (src, alt) => src ? '<img src="' + src + '" alt="' + h(alt) + '">' : '';
  const works = Array.from({ length: n }, (_, i) => {
    const w = r.works[i], st = ' style="height:' + rh.toFixed(2) + 'mm;font-size:' + fs.toFixed(2) + 'pt"';
    if (!w) return '<tr' + st + '><td>' + (i + 1) + '.</td>' + '<td></td>'.repeat(7) + '</tr>';
    return '<tr' + st + '><td>' + (i + 1) + '.</td><td>' + h(w.place) + '</td><td class="l">' + h(w.work) + '</td><td>' + (w.work || w.place ? tbmN(w) : '') + '</td>' +
      '<td class="s" style="font-size:' + fs2 + 'pt">' + h(w.risk) + '</td><td>' + h(w.kind) + '</td><td>' + tbmLv(w.p, w.s) + '</td><td class="s" style="font-size:' + fs2 + 'pt">' + h((w.fixes || []).join(' / ')) + '</td></tr>';
  }).join('');
  let sg = '';
  for (let row = 0; row < 5; row++) {   // 세로 먼저: 1줄 위→아래 5칸, 다음 줄 — 4줄×5칸 20명 (결정 66·72)
    sg += '<tr>' + (row ? '' : '<td rowspan="5" style="font-size:9pt">서명란</td>');
    for (let col = 0; col < 4; col++) { const x = signs[col * 5 + row]; sg += '<td class="nm">' + (x ? h(x.name) : '') + '</td><td>' + (x && x.img ? img(x.img, x.name + ' 서명') : '(인)') + '</td>'; }
    sg += '</tr>';
  }
  const mg = r.manager;
  return '<style>' + TBM_PDF_CSS + '</style><div class="tbp">' +
    '<div class="pg"><div class="fr"><h1>[ TBM 실시 및 위험성 평가표 ]</h1>' +
    '<table class="hd"><colgroup><col style="width:24.5%"><col style="width:23.8%"><col style="width:14.3%"><col style="width:37.4%"></colgroup><tr>' +
    '<td>* 사업소명 :<span class="v">잠실점 에비뉴엘</span></td><td>* 작업 일시 :<span class="v">' + y.slice(2) + '.' + m + '.' + d + '</span></td>' +
    '<td>* 작업인원 :<span class="v">' + signs.length + ' 명</span></td>' +
    // 서명 그림은 양식의 「(서명)」 자리에, 서명이 있으면 「(서명)」 글자는 지움
    '<td><div class="mg"><span>* 관리감독자/책임자 :' + (mg ? '<span class="v">' + h(mg.name) + '</span>' : '') + '</span>' +
    '<span class="sgn">' + (mg && mg.img ? img(mg.img, mg.name + ' 서명') : '<span class="tag">(서명)</span>') + '</span></div></td></tr></table>' +
    '<table class="ck"><tr>' + TBM_CHECKS.map(k => '<td class="lb"' + (k === '테이블리프트' ? ' style="font-size:7.5pt;line-height:1.1">테이블리프트<br>(렌탈)' : '>' + k) + '</td><td class="on">' + (r.checks[k] ? '○' : '') + '</td>').join('') + '</tr></table>' +
    '<table class="wk"><colgroup><col style="width:5%"><col style="width:11.1%"><col style="width:19.8%"><col style="width:5.2%"><col style="width:19.6%"><col style="width:6.4%"><col style="width:6.2%"><col style="width:26.7%"></colgroup>' +
    '<tr><th>NO.</th><th>작업위치</th><th>작업내용</th><th>인원</th><th>위험요인</th><th>재해<br>형태</th><th>위험성</th><th>안전보건 개선조치</th></tr>' + works + '</table>' +
    '<table class="sg"><colgroup><col style="width:7.3%">' + '<col><col style="width:7.3%">'.repeat(4) + '</colgroup>' + sg + '</table>' +
    '<div class="pn">- 1 / 2 -</div></div></div>' +
    '<div class="pg"><div class="fr"><div class="t1">■ &nbsp;「TBM 실시 사진」</div><div class="t2">' + y + '년 &nbsp;' + Number(m) + ' 월 &nbsp;' + Number(d) + ' 일</div>' +
    '<div class="photos"><div class="cell">' + img(r.up.meet || r.photos.meet, '회의 사진') + '</div><div class="cell">' + img(r.up.chant || r.photos.chant, '구호 사진') + '</div></div>' +
    '<div class="pn">- 2 / 2 -</div></div></div></div>';
}
async function tbmMakePdf() {
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
  const box = document.createElement('div'); box.style.cssText = 'width:1123px;background:#fff'; box.innerHTML = tbmPdfHtml();
  wrap.appendChild(box); document.body.appendChild(wrap);
  try {
    try { if (document.fonts) await document.fonts.ready; } catch (e) {}
    await Promise.all([...box.querySelectorAll('img')].map(im => im.decode ? im.decode().catch(() => {}) : null));
    // 사진은 자르지 않고 칸에 맞춰 줄임, 남는 곳 연회색 (9.3) — PDF 도구가 object-fit을 못 읽어 크기를 직접 정함
    box.querySelectorAll('.cell img').forEach(im => {
      const c = im.parentNode, sc = Math.min(c.clientWidth / im.naturalWidth, c.clientHeight / im.naturalHeight) || 1;
      im.style.width = Math.floor(im.naturalWidth * sc) + 'px'; im.style.height = Math.floor(im.naturalHeight * sc) + 'px';
    });
    const keepY = window.scrollY; window.scrollTo(0, 0);
    try {
      return await html2pdf().set({
        margin: 0, filename: S.tbm.day + '_TBM.pdf', image: { type: 'jpeg', quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 1123 },
        jsPDF: { unit: 'px', format: [1123, 794], orientation: 'landscape', hotfixes: ['px_scaling'] },
        pagebreak: { mode: ['legacy'] }
      }).from(box).outputPdf('datauristring');
    } finally { window.scrollTo(0, keepY); }
  } finally { wrap.remove(); }
}

