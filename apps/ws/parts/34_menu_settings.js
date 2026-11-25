/* ── 메인 메뉴 켜기·끄기 (결정 148): 설정 표 「메인메뉴끄기」, 소장·관리자·옵저버는 꺼진 칸도 엶 ── */
const MENU = [
  ['docs', '서류작업', [['tbm', 'TBM'], ['nw', '명일 작업 예정'], ['att', '출근현황'], ['ahu', '온습도/공조기/에어커튼 입력'], ['log', '종합업무일지'], ['risk', '위험작업신청서'], ['work', '주간/야간 작업내역']]],
  ['inspect', '점검', [['fire', '소화기/소화전/공기호흡기 점검'], ['eh', '전열필증'], ['thermal', '열화상점검'], ['cs', '공사장 점검'], ['defect', '하자점검']]],
  ['spec', '시방서 검색', null], ['mat', '자재현황', null], ['map', '지도', null], ['cad', 'CAD', null]];   // 자재현황은 준비중이라 켜고 끄기 없음
const menuOff = k => (S.menuOff || []).indexOf(k) !== -1;
const menuCanOpen = () => !!S.user && ['소장', '관리자', '옵저버'].indexOf(S.user.role) !== -1;
/** 하위 메뉴 한 줄: 꺼졌거나(직원) 윗 메뉴가 꺼졌으면 이름만 흐리게 · 눌리지 않음 (결정 210). dis = 이 줄만 따로 막을 때 */
function subRow(key, fn, bg, col, ico, name, sm, dis) {
  const st = 'background:' + bg + ';color:' + col;
  const off = dis || (!menuCanOpen() && (menuOff(key) || menuOff(key.split('.')[0])));
  if (off) return '<button class="row" disabled style="opacity:.5;cursor:default"><span class="ico" style="' + st + '">' + ico + '</span><span class="fname"><b style="font-size:var(--size-m)">' + name + '</b></span></button>';
  return '<button class="row" onclick="' + fn + '"><span class="ico" style="' + st + '">' + ico + '</span><span class="fname"><b style="font-size:var(--size-m)">' + name + '</b><small>' + sm + '</small></span>' + ICON.chev + '</button>';
}
const menuLabel = k => { for (const m of MENU) { if (m[0] === k) return m[1]; const x = (m[2] || []).find(y => m[0] + '.' + y[0] === k); if (x) return x[1]; } return k; };
async function setMenu(k, on) {
  const r = await call('adminSetMenu', (S.menuOff || []).filter(x => x !== k).concat(on ? [] : [k]));
  if (!r.ok) return toast(r.error);
  S.menuOff = r.off; render(); toast(menuLabel(k) + (on ? ' 켬' : ' 끔 (직원에게 안 열림)'));
}
function menuAcc(k) { S.menuOpen = S.menuOpen || {}; S.menuOpen[k] = !S.menuOpen[k]; render(); }
const menuSeg = (k, label, off) => '<div class="seg setseg menuseg" role="group" aria-label="' + label + ' 켜기·끄기">' +
  '<button type="button" class="' + (off ? '' : 'on') + '" aria-pressed="' + !off + '" onclick="setMenu(\'' + k + '\',1)">켜짐</button><button type="button" class="' + (off ? 'on' : '') + '" aria-pressed="' + off + '" onclick="setMenu(\'' + k + '\',0)">꺼짐</button></div>';
function menuSetHtml() {
  return MENU.map(m => {
    const k = m[0], subs = m[2], off = menuOff(k);
    if (k === 'mat') return '<div class="strow"><span class="fname"><b>자재현황</b><small>준비중 · 항상 「작업중」 칸</small></span></div>';
    if (!subs) return '<div class="strow"><span class="fname"><b>' + m[1] + '</b></span>' + menuSeg(k, m[1], off) + '</div>';
    const open = !!(S.menuOpen && S.menuOpen[k]), on = subs.filter(x => !menuOff(k + '.' + x[0])).length;
    return '<div class="strow"><button type="button" class="menuacc" aria-expanded="' + open + '" onclick="menuAcc(\'' + k + '\')"><span class="chev' + (open ? ' open' : '') + '">' + ICON.chev + '</span><span class="fname"><b>' + m[1] + '</b><small>하위 ' + subs.length + '개 중 ' + on + '개 켜짐</small></span></button>' + menuSeg(k, m[1], off) + '</div>' +
      (open ? subs.map(x => '<div class="strow menusub"><span class="fname"><b>' + x[1] + '</b></span>' + menuSeg(k + '.' + x[0], x[1], menuOff(k + '.' + x[0])) + '</div>').join('') : '');
  }).join('');
}
function tile(k) { if (k === 'inspect') go('inspect'); else if (k === 'docs') go('docs'); else if (k === 'spec') { if (window.WS_API) openSpec(); else toast('시방서 검색은 바로가기 앱(Supabase)에서만 열립니다'); } else if (k === 'cad') { if (window.WS_API) go('cad'); else toast('CAD는 바로가기 앱(Supabase)에서만 열립니다'); } else if (k === 'map') { if (window.WS_API) go('map'); else toast('지도는 바로가기 앱(Supabase)에서만 열립니다'); } }

/* ── 환경설정 (소장만, 결정 102): 알림 시간, 직원 추가·편집·삭제·PIN ── */
const ROLES = ['소장', '부소장', '파트장', '직원', '관리자', '옵저버'];   // 옵저버: 파트 「관리」 고정 (결정 138)
function isBoss() { return !!S.user && S.user.role === '소장'; }
async function openSet() {
  S.set = null; go('set');
  try {
    const r = await call('adminStaff'); if (!r.ok) { toast(r.error); return back(); }
    if (window.WS_API) { const k = await call('riskGet'); r.riskN = k && k.ok ? k.rows.length : null; }   // 위험성 목록은 Supabase 판에서만 (구글 판은 시트에서)
    S.set = r; if (S.view === 'set') render();
  } catch (e) {}
}
function renderSet() {
  const r = S.set;
  if (!r) return topbar('업무지원 ›', '환경설정') + '<div class="wrap" style="text-align:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue)"></span></div>';
  const secs = [1, 1.5, 2, 2.6, 3, 4, 5];
  return topbar('업무지원 ›', '환경설정') + '<div class="wrap list">' +
    '<h3 class="sth">알림 표시 시간</h3><div class="card" style="padding:var(--sp-3) var(--sp-4)"><small style="color:var(--muted)">저장·동기화가 끝나면 아래에 뜨는 알림이 보이는 시간입니다. 알림이 여러 개면 0.5초 쉬고 다음 알림을 보여 줍니다.</small>' +
    '<div class="seg setseg" role="group" aria-label="알림 표시 시간" style="margin-top:var(--sp-2)">' + secs.map(v => '<button type="button" class="' + (Number(r.toastSec) === v ? 'on' : '') + '" aria-pressed="' + (Number(r.toastSec) === v) + '" onclick="setToastSec(' + v + ')">' + v + '초</button>').join('') + '</div></div>' +
    (window.WS_API ? '<h3 class="sth" style="margin-top:var(--sp-2)">장비 전력 · 단가</h3><div class="card strow"><span class="fname"><b>공조기·에어커튼 kW · 전기 단가</b><small>가동시간 리포트의 전력량(kWh)·예상 요금에 씀 · 빈 칸은 환산에서 뺌</small></span><button class="btn sm pri" onclick="openKw()">고치기</button></div>' : '') +
    (window.WS_API ? '<h3 class="sth" style="margin-top:var(--sp-2)">TBM 위험성 목록</h3><div class="card strow"><span class="fname"><b>위험성 목록' + (r.riskN != null ? ' ' + r.riskN + '줄' : '') + '</b><small>TBM 작업 내용의 낱말로 위험요인·개선조치를 고르는 표</small></span><button class="btn sm pri" onclick="openRisk()">고치기</button></div>' : '') +
    '<h3 class="sth" style="margin-top:var(--sp-2)">메인 메뉴</h3><div class="card">' + menuSetHtml() +
    '</div><small style="color:var(--muted);line-height:1.6">메뉴 이름을 누르면 하위 메뉴가 펼쳐집니다. 꺼진 메뉴는 직원 화면에서 「작업중」 칸(하위 메뉴는 이름만)으로 보이고 눌리지 않으며, 윗 메뉴를 끄면 하위 메뉴도 모두 막힙니다. <b>소장·관리자·옵저버</b>는 꺼진 메뉴도 열 수 있습니다.</small>' +
    '<div style="display:flex;align-items:center;margin-top:var(--sp-2)"><h3 class="sth" style="flex:1">직원 ' + r.staff.length + '명</h3><button class="btn sm pri" onclick="staffDlg()">+ 직원 추가</button></div>' +
    '<div class="card">' + r.staff.map(x => '<div class="strow"><span class="fname"><b>' + h(x.name) + '</b><small>' + h(x.part) + ' · ' + h(x.role) + ' · ' + h(x.staff_id) + '</small></span>' +
      '<button class="btn sm" onclick="staffDlg(\'' + x.staff_id + '\')">편집</button><button class="btn sm" onclick="staffPinDlg(\'' + x.staff_id + '\')">PIN 변경</button>' +
      (x.staff_id === S.user.staff_id ? '' : '<button class="btn sm warn" onclick="staffDel(\'' + x.staff_id + '\')">삭제</button>') + '</div>').join('') + '</div>' +
    (window.WS_API && S.device ? '<h3 class="sth" style="margin-top:var(--sp-2)">이 기기</h3><div class="card strow"><span class="fname"><b>등록된 계정</b><small>' + h(S.device.email) + (S.device.at ? ' · ' + Number(S.device.at.slice(5, 7)) + '월 ' + Number(S.device.at.slice(8, 10)) + '일 등록' : '') + '</small></span>' +
      '<button class="btn sm warn" onclick="deviceOff()">기기 등록 풀기</button></div><small class="devnote">풀면 이 기기에서는 다시 기기 등록을 해야 합니다. 잃어버리거나 바꾼 기기는 관리자에게 알려 주세요.</small>' : '') + '</div>';
}
/* ── TBM 위험성 목록 편집 (Supabase 이관 3-6, 시안 docs/시안/WS-Supabase_위험성목록) — 목록 전체를 한 번에 저장 ── */
async function openRisk() {
  S.rk = null; go('risk');
  const r = await call('riskGet'); if (!r.ok) { toast(r.error); return back(); }
  S.rk = { rows: r.rows, open: -1, dirty: false, busy: false }; if (S.view === 'risk') render();
}
function renderRisk() {
  const k = S.rk, lv = (p, s) => { const v = p * s; return '<b class="tblv ' + (v >= 6 ? 'hi' : v >= 3 ? 'mid' : 'lo') + '">' + (v >= 6 ? '상' : v >= 3 ? '중' : '하') + ' · ' + v + '</b>'; };
  if (!k) return topbar('환경설정 ›', 'TBM 위험성 목록') + '<div class="wrap" style="text-align:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue)"></span></div>';
  const card = (r, i) => {
    const ed = k.open === i, seg = c => '<div class="seg tbseg" role="group" aria-label="' + (c === 'p' ? '가능성' : '중대성') + '">' + [1, 2, 3].map(n => '<button type="button" class="' + (r[c] === n ? 'on' : '') + '" aria-pressed="' + (r[c] === n) + '" onclick="rkSet(' + i + ',\'' + c + '\',' + n + ')">' + n + '</button>').join('') + '</div>';
    return '<div class="card tbw"><div class="tbh"><span class="nwno">' + (i + 1) + '</span><span class="fname"><b>' + h(r.risk || '(위험요인 없음)') + '</b><small>' + h(r.words) + '</small></span>' +
      '<button class="btn sm" aria-label="위로" onclick="rkMove(' + i + ',-1)"' + (i ? '' : ' disabled') + '>↑</button><button class="btn sm" aria-label="아래로" onclick="rkMove(' + i + ',1)"' + (i < k.rows.length - 1 ? '' : ' disabled') + '>↓</button>' +
      '<button class="btn sm" onclick="rkOpen(' + i + ')">' + (ed ? '닫기' : '고치기') + '</button></div>' +
      (ed ? '<div class="tbedit">' +
        '<label class="tbf"><span>낱말 <em>쉼표로 · 작업 내용에 이 낱말이 있으면 이 줄을 고름</em></span><input class="inp" maxlength="200" value="' + h(r.words) + '" oninput="rkIn(' + i + ',\'words\',this)"></label>' +
        '<label class="tbf"><span>위험요인</span><input class="inp" maxlength="100" value="' + h(r.risk) + '" oninput="rkIn(' + i + ',\'risk\',this)"></label>' +
        '<label class="tbf"><span>재해형태</span><input class="inp" maxlength="30" value="' + h(r.kind) + '" oninput="rkIn(' + i + ',\'kind\',this)"></label>' +
        '<div class="tbf"><span>위험성 <em>가능성 × 중대성</em></span><div class="tbrisk"><small>가능성</small>' + seg('p') + '<small>중대성</small>' + seg('s') + lv(r.p, r.s) + '</div></div>' +
        '<div class="tbf"><span>개선조치 <em>4개까지 · ✓ = TBM에서 미리 체크</em></span><div class="tbfx">' +
          [0, 1, 2, 3].map(j => { const f = r.fixes[j] || { t: '', on: false }; return '<div class="tbown" style="align-items:center"><label style="display:flex;align-items:center;gap:var(--sp-1);white-space:nowrap"><input type="checkbox" aria-label="미리 체크"' + (f.on ? ' checked' : '') + ' onchange="rkFix(' + i + ',' + j + ',\'on\',this)">✓</label><input class="inp" maxlength="100" placeholder="개선조치 ' + (j + 1) + '" value="' + h(f.t) + '" oninput="rkFix(' + i + ',' + j + ',\'t\',this)"></div>'; }).join('') +
        '</div></div><button class="btn warn" onclick="rkDel(' + i + ')">이 줄 지우기</button></div>'
       : '<div class="tbf"><span>위험성</span><div class="tbrisk">' + h(r.kind) + ' ' + lv(r.p, r.s) + '</div></div>' +
         '<div class="tbf"><span>개선조치</span><small style="color:var(--sub)">' + r.fixes.filter(f => f.t).map(f => (f.on ? '✓ ' : '') + h(f.t)).join(' · ') + '</small></div>') + '</div>';
  };
  return topbar('환경설정 ›', 'TBM 위험성 목록') + '<div class="wrap list"><div class="banner b-gray" style="line-height:1.6">맨 위 「(기본)」 줄은 낱말이 맞는 줄이 없을 때 씁니다. 순서는 ↑↓ 로 바꿉니다 (위에 있는 줄을 먼저 찾음).</div>' +
    k.rows.map(card).join('') +
    '<div class="nwbar"><span id="rkSt">' + (k.dirty ? '고친 내용 있음' : '저장됨') + '</span><button class="btn" onclick="rkAdd()"' + (k.rows.length >= 200 ? ' disabled' : '') + '>+ 줄 추가</button>' +
    '<button class="btn pri" onclick="rkSave()"' + (k.busy ? ' disabled' : '') + '>' + (k.busy ? '<span class="spin"></span>' : '저장') + '</button></div></div>';
}
function rkDirty() { S.rk.dirty = true; const e = $('rkSt'); if (e) e.textContent = '고친 내용 있음'; }
function rkIn(i, c, el) { S.rk.rows[i][c] = el.value; rkDirty(); }
function rkSet(i, c, n) { S.rk.rows[i][c] = n; rkDirty(); render(); }
function rkFix(i, j, c, el) { const f = S.rk.rows[i].fixes; while (f.length <= j) f.push({ t: '', on: false }); f[j][c] = c === 'on' ? el.checked : el.value; rkDirty(); }
function rkOpen(i) { S.rk.open = S.rk.open === i ? -1 : i; render(); }
function rkMove(i, d) { const L = S.rk.rows, j = i + d; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; if (S.rk.open === i) S.rk.open = j; else if (S.rk.open === j) S.rk.open = i; rkDirty(); render(); }
function rkDel(i) { if (!confirm('「' + (S.rk.rows[i].risk || (i + 1) + '번') + '」 줄을 지울까요? (저장해야 반영)')) return; S.rk.rows.splice(i, 1); S.rk.open = -1; rkDirty(); render(); }
function rkAdd() { S.rk.rows.push({ words: '', risk: '', kind: '', p: 1, s: 1, fixes: [] }); S.rk.open = S.rk.rows.length - 1; rkDirty(); render(); window.scrollTo(0, document.body.scrollHeight); }
async function rkSave() {
  const k = S.rk; k.busy = true; render();
  try {
    const r = await call('riskSave', k.rows);
    if (!r.ok) return toast(r.error);
    k.rows = r.rows; k.dirty = false; k.open = -1; if (S.set) S.set.riskN = r.rows.length; toast('위험성 목록 ' + r.rows.length + '줄 저장');
  } finally { k.busy = false; if (S.rk === k) render(); }
}
