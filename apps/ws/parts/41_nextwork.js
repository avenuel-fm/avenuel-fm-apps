/* ── 명일 작업 예정 (WS_서류작업 9장, 결정 62·68) ── */
const NW_WORDS = ['고소작업', '사다리', '용접', '페인트'];   // 비고에 있으면 비고 글자만 빨간색 (결정 158)
const NW_DEPTS = ['전방파트', '기건파트'];
function nwHot(t) { return NW_WORDS.some(w => String(t || '').indexOf(w) !== -1); }
function nwDanger(r) { return nwHot(r.work) || nwHot(r.note); }
function nwBlank() { return { dept: (S.user && NW_DEPTS.indexOf(S.user.part) !== -1) ? S.user.part : NW_DEPTS[0], place: '', work: '', note: '' }; }
function nwLeaveOk() { return !(S.nw && S.nw.dirty) || confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?'); }
async function openNw() { S.nw = null; const p = takePre('nw'); go('nw'); if (p) nwSet(p); await loadNw('', true); }
async function loadNw(date, quiet) {
  const r = await call('nextWorkGet', date);
  if (!r.ok) { toast(r.error); return; }
  if (quiet && S.nw && (S.nw.dirty || S.nw.busy || S.nw.date !== r.date)) return;   // 뒤에서 새로 받는 중 고쳤으면 그대로 (저장 때 겹침은 ver로 알림)
  nwSet(r);
}
function nwSet(r) {
  S.nw = { date: r.date, defaultDate: r.defaultDate || (S.nw && S.nw.defaultDate), workDay: r.workDay || (S.nw && S.nw.workDay), ver: r.ver, by: r.by,
    rows: r.rows.length ? r.rows.map(x => Object.assign({}, x)) : [nwBlank()], dirty: false, busy: false };
  if (S.view === 'nw') render();
}
function nwCal() {
  const n = S.nw, d = n.defaultDate || n.date;
  pickDate({ cur: n.date, home: d, homeLbl: '기본 일자로 (' + Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일)',
    fn: ds => { if (ds !== S.nw.date && nwLeaveOk()) loadNw(ds); } });
}
function nwKo(d, wd) { return new Date(d + 'T12:00:00+09:00').toLocaleDateString('ko-KR', Object.assign({ year: 'numeric', month: 'long', day: 'numeric' }, wd ? { weekday: 'short' } : {})); }
function nwState() {
  const n = S.nw;
  return n.dirty ? '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>' : n.ver ? '<span class="nwstate">' + ICON.ok + '저장됨</span>' : '';
}
function renderNw() {
  const n = S.nw;
  if (!n) return topbar('서류작업 ›', '명일 작업') + '<div class="wrap list"><div class="banner b-gray">불러오는 중…</div></div>';
  const md = d => Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일';
  const meta = md(n.workDay) + ' 작성' + (n.ver ? ' · 마지막 저장 ' + h(String(n.ver).slice(5, 16).replace('-', '/')) + ' ' + h(n.by) : ' · 아직 저장 안 함');
  const wd = new Date(n.date + 'T12:00:00+09:00').toLocaleDateString('ko-KR', { weekday: 'short' });
  const rows = n.rows.map((r, i) => '<div class="nwrow' + (nwDanger(r) ? ' danger' : '') + '" data-i="' + i + '">' +
    '<span class="nwno">' + (i + 1) + '</span>' +
    '<div class="seg" role="group" aria-label="' + (i + 1) + '번 부서">' + NW_DEPTS.map(d => '<button type="button" class="' + (r.dept === d ? 'on' : '') + '" aria-pressed="' + (r.dept === d) + '" onclick="nwDept(' + i + ',\'' + d + '\')">' + d + '</button>').join('') + '</div>' +
    '<label class="f-work"><span>작업 내용</span><input class="inp" maxlength="100" value="' + h(r.work) + '" oninput="nwInput(' + i + ',\'work\',this)"></label>' +
    '<label class="f-place"><span>작업장소</span><input class="inp" maxlength="40" value="' + h(r.place) + '" oninput="nwInput(' + i + ',\'place\',this)"></label>' +
    '<label class="f-note"><span>비고</span><input class="inp' + (nwHot(r.note) ? ' nwhot' : '') + '" maxlength="40" value="' + h(r.note) + '" oninput="nwInput(' + i + ',\'note\',this)"></label>' +
    '<button type="button" class="btn nwdel" onclick="nwDel(' + i + ')" aria-label="' + (i + 1) + '번 줄 지우기">' + ICON.x + '</button></div>').join('');
  return topbar('서류작업 ›', '명일 작업') + '<div class="wrap list">' +
    '<div class="card" style="padding:var(--sp-4)"><div class="nwhead"><b>명일 작업 일정 현황</b>' +
    '<button class="nwdate" data-date="' + h(n.date) + '" onclick="nwCal()" aria-label="일자 바꾸기">' + ICON.cal + md(n.date) + ' (' + wd + ')</button></div>' +
    '<div class="nwmeta">' + meta + '</div></div>' +
    '<div class="nwrows"><div class="nwhd" aria-hidden="true"><span>순번</span><span>부서</span><span>작업장소</span><span>작업 내용</span><span>비고</span><span></span></div>' + rows +
    '<button type="button" class="btn nwadd" onclick="nwAdd()"' + (n.rows.length >= 30 ? ' disabled' : '') + '>' + ICON.plus + '줄 더하기</button></div>' +
    '<div class="nwbar" id="nwBar"><span id="nwState">' + nwState() + '</span>' +
    '<button class="btn" onclick="nwImage()">' + ICON.dl + '그림으로 저장</button>' +
    '<button class="btn pri" id="nwSave" onclick="nwSave()"' + (n.busy ? ' disabled' : '') + '>' + (n.busy ? '<span class="spin"></span>' : '저장') + '</button></div></div>';
}
function nwDirty() { S.nw.dirty = true; const e = $('nwState'); if (e) e.innerHTML = nwState(); }
// 입력 중에는 다시 그리지 않음 (글자 칸 초점 유지) — 빨간색만 바로 바꿈
function nwInput(i, k, el) {
  S.nw.rows[i][k] = el.value; nwDirty();
  el.closest('.nwrow').classList.toggle('danger', nwDanger(S.nw.rows[i]));
  if (k === 'note') el.classList.toggle('nwhot', nwHot(el.value));
}
function nwDept(i, d) { S.nw.rows[i].dept = d; nwDirty(); render(); }
function nwAdd() {
  S.nw.rows.push(nwBlank()); nwDirty(); render();
  const all = document.querySelectorAll('.nwrow .f-work input'); if (all.length) all[all.length - 1].focus();
}
function nwDel(i) {
  const r = S.nw.rows[i];
  if ((r.place || r.work || r.note) && !confirm((i + 1) + '번 줄을 지울까요?')) return;
  S.nw.rows.splice(i, 1); if (!S.nw.rows.length) S.nw.rows.push(nwBlank());
  nwDirty(); render();
}
function nwFilled() { return S.nw.rows.filter(r => (r.place || '').trim() || (r.work || '').trim() || (r.note || '').trim()); }
async function nwSave() {
  const n = S.nw; if (n.busy) return;
  n.busy = true; render();
  try {
    const r = await call('nextWorkSave', n.date, nwFilled(), n.ver || '');
    if (r.conflict) { nwSet(r); toast(r.error); return; }
    if (!r.ok) { n.busy = false; render(); toast(r.error); return; }
    nwSet(r); toast('저장했습니다');
  } catch (e) { n.busy = false; render(); }
}

/* 그림 파일(PNG) — 양식 v2 칸 순서 그대로, 색·글자·모서리는 공통 디자인 값(결정 150). 그림 칸 1000px를 2배(가로 2000px)로 그림 */
function nwDraw() {
  const n = S.nw, rows = nwFilled(), W = 1000, SC = 2, PAD = 32;
  const css = getComputedStyle(document.documentElement), T = k => css.getPropertyValue(k).trim();
  const NAVY = T('--navy'), SUB = T('--text-sub'), LINE = T('--line'), TINT = T('--tint'), ERR = T('--error'), R = parseInt(T('--radius'), 10);
  const COLS = [['구 분', 160], ['순번', 52], ['부 서', 110], ['작업장소', 150], ['작업 내용', 0], ['비 고', 130]];
  COLS[4][1] = W - PAD * 2 - COLS.reduce((a, c) => a + c[1], 0);
  const cv = document.createElement('canvas'), g = cv.getContext('2d');
  const font = (w, px) => { g.font = w + ' ' + px + 'px ' + T('--font'); };
  function wrap(t, maxW) {   // 칸 너비에 맞춰 글자 단위로 줄바꿈
    font(400, 15); const out = []; let line = '';
    for (const ch of String(t || '')) { if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; }
    out.push(line); return out;
  }
  const cells = rows.map((r, i) => [String(i + 1), r.dept, r.place, r.work, r.note].map((t, j) => wrap(t, COLS[j + 1][1] - 24)));
  const rowH = cells.map(c => Math.max(40, 16 + Math.max(...c.map(l => l.length)) * 24));
  const tableY = 120, headH = 40, bodyH = Math.max(rowH.reduce((a, b) => a + b, 0), 80), TW = W - PAD * 2, TH = headH + bodyH, H = tableY + TH + 64;
  cv.width = W * SC; cv.height = H * SC; g.scale(SC, SC);
  g.fillStyle = T('--white'); g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  font(600, 24); g.fillStyle = NAVY; g.fillText('■ 에비뉴엘 시설팀 명일 작업 일정 현황', PAD, 48);
  function rr(x0, y0, w, hh, r) { g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + hh, r); g.arcTo(x0 + w, y0 + hh, x0, y0 + hh, r); g.arcTo(x0, y0 + hh, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath(); }
  const [yy, mm, dd] = n.date.split('-');
  let x = PAD; font(500, 15);
  const put = (t, box) => {
    const w = g.measureText(t).width + (box ? 24 : 0);
    if (box) { g.fillStyle = TINT; rr(x, 76, w, 32, R); g.fill(); g.strokeStyle = LINE; g.lineWidth = 1; g.stroke(); }
    g.fillStyle = NAVY; g.fillText(t, x + (box ? 12 : 0), 92);
    x += w + 8;
  };
  put('일자 :'); put(yy, 1); put('년'); put(String(Number(mm)), 1); put('월'); put(String(Number(dd)), 1); put('일');
  g.save(); rr(PAD, tableY, TW, TH, R); g.clip();
  g.fillStyle = TINT; g.fillRect(PAD, tableY, TW, headH);
  const colX = []; let cx = PAD; COLS.forEach(c => { colX.push(cx); cx += c[1]; });
  font(600, 15); g.fillStyle = NAVY; g.textAlign = 'center';
  COLS.forEach((c, j) => g.fillText(c[0], colX[j] + c[1] / 2, tableY + headH / 2));
  let y = tableY + headH;
  cells.forEach((c, i) => {
    if (nwDanger(rows[i])) { g.fillStyle = TINT; g.fillRect(colX[1], y, TW - COLS[0][1], rowH[i]); }
    if (i) { g.fillStyle = LINE; g.fillRect(colX[1], y, TW - COLS[0][1], 1); }
    font(400, 15);
    c.forEach((lines, j) => {
      const col = j + 1, left = col === 4;
      g.fillStyle = col === 5 && nwHot(rows[i].note) ? ERR : NAVY;   // 위험 낱말이 든 비고만 빨간색 (결정 158)
      g.textAlign = left ? 'left' : 'center';
      const top = y + rowH[i] / 2 - (lines.length - 1) * 12;
      lines.forEach((l, k) => g.fillText(l, left ? colX[col] + 12 : colX[col] + COLS[col][1] / 2, top + k * 24));
    });
    y += rowH[i];
  });
  g.fillStyle = LINE; colX.slice(1).forEach(cx2 => g.fillRect(cx2, tableY, 1, TH));
  g.fillRect(PAD, tableY + headH - 1, TW, 1);
  font(500, 15); g.fillStyle = NAVY; g.textAlign = 'center';
  g.fillText('㈜맥서브', PAD + COLS[0][1] / 2, tableY + headH + bodyH / 2 - 12); g.fillText('에비뉴엘 잠실점', PAD + COLS[0][1] / 2, tableY + headH + bodyH / 2 + 12);
  g.restore();
  g.strokeStyle = LINE; g.lineWidth = 1; rr(PAD + .5, tableY + .5, TW - 1, TH - 1, R); g.stroke();
  g.textAlign = 'left'; font(400, 13); g.fillStyle = SUB;
  g.fillText('※ 사다리, 위험물작업(용접·페인트) 작업은 빨간색으로 표시', PAD, tableY + TH + 28);
  return cv;
}
async function nwImage() {
  if (!nwFilled().length) { toast('작업을 한 줄 이상 입력해 주세요'); return; }
  if (S.nw.dirty) toast('저장하지 않은 내용도 그림에 들어갑니다');
  try { if (document.fonts) await document.fonts.ready; } catch (e) {}
  const url = nwDraw().toDataURL('image/png'), name = S.nw.date + '_명일작업예정.png';
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  // 앱 화면 안에서 내려받기가 막히는 휴대폰도 있어, 그림을 같이 보여 줌 (길게 눌러 저장)
  dialog('<div style="display:flex;align-items:center;margin-bottom:var(--sp-2)"><div class="fname"><b style="font-size:var(--size-l)">그림으로 저장</b><small>' + h(name) + '</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<img class="nwimg" id="nwImg" src="' + url + '" alt="명일 작업 일정 현황 ' + h(S.nw.date) + '">' +
    '<div class="banner b-info" style="margin-top:var(--sp-2)">내려받기가 되지 않으면 위 그림을 <b>길게 눌러 「이미지 저장」</b>을 고르세요.</div>' +
    '<a class="btn pri big" style="width:100%;margin-top:var(--sp-2)" href="' + url + '" download="' + h(name) + '">다시 내려받기</a>');
}

