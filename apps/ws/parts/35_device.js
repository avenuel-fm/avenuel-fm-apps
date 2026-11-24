/* ── 기기 등록 (Supabase 이관 3-1, 시안 docs/시안/WS-Supabase_로그인) — 기기마다 처음 한 번, 시설팀 공용 계정 ── */
function renderDevice() {
  const d = S.dev || {};
  return '<div class="devwrap"><div style="text-align:center;display:flex;flex-direction:column;gap:var(--sp-1)"><small style="color:var(--muted)">잠실점 에비뉴엘 · 시설팀</small><b style="font-size:var(--size-xl)">업무지원</b></div>' +
    '<form class="card devcard" onsubmit="event.preventDefault();deviceReg()"><b style="font-size:var(--size-l)">기기 등록</b>' +
    '<span class="devlead">이 휴대폰(PC)에서 <b>처음 한 번만</b> 합니다.<br>등록하면 다음부터는 PIN만 누릅니다.</span>' +
    '<label class="devf">시설팀 계정 이메일<input class="inp" id="devE" type="email" autocomplete="username" inputmode="email" required value="' + h(d.email || '') + '"></label>' +
    '<label class="devf">비밀번호<input class="inp" id="devP" type="password" autocomplete="current-password" required></label>' +
    '<span class="devmsg" role="alert">' + h(d.msg || '') + '</span>' +
    '<button class="btn pri big" type="submit" style="width:100%"' + (d.busy ? ' disabled' : '') + '>' + (d.busy ? '<span class="spin"></span>' : '기기 등록') + '</button></form>' +
    '<small style="text-align:center;color:var(--muted);line-height:1.6">계정은 시설팀 관리자에게 받습니다<br>등록은 「환경설정 › 기기 등록 풀기」 전까지 유지됩니다</small></div>';
}
async function deviceReg() {
  const e = $('devE').value, p = $('devP').value;
  S.dev = { email: e, busy: true }; render();
  try {
    await WS_API.register(e, p);
    S.dev = null; S.device = await WS_API.device(); S.view = 'login'; render();
  } catch (err) { S.dev = { email: e, msg: err.message }; render(); }
}
async function deviceOff() {
  if (!confirm('이 기기의 등록을 풀까요? 다시 쓰려면 시설팀 계정으로 기기 등록을 해야 합니다.')) return;
  await WS_API.unregister(S.token);
  store('ws_token', null); store('ws_main', null); S.token = ''; S.user = null; S.device = null; S.view = 'device'; histReset(); render();
}
async function setToastSec(v) {
  const r = await call('adminSetToast', v);
  if (!r.ok) return toast(r.error);
  S.set.toastSec = v; store('ws_toast_sec', String(v)); render(); toast('알림 시간 ' + v + '초로 저장');
}
function staffOf(id) { return S.set.staff.find(x => x.staff_id === id); }
function staffDlg(id) {
  const x = id ? staffOf(id) : null, me = x && x.staff_id === S.user.staff_id;
  const parts = Array.from(new Set(S.set.staff.map(s => s.part).concat(['전방파트', '기건파트'])));
  dialog('<h2 class="ehdh">' + (x ? '직원 편집' : '직원 추가') + '</h2>' +
    '<label class="ehf">이름<input id="sfN" class="inp" maxlength="20" value="' + h(x ? x.name : '') + '"></label>' +
    '<label class="ehf">파트<input id="sfP" class="inp" maxlength="20" list="sfPL" value="' + h(x ? x.part : '전방파트') + '"' + (x && x.role === '옵저버' ? ' disabled' : '') + '><datalist id="sfPL">' + parts.map(p => '<option value="' + h(p) + '">').join('') + '</datalist></label>' +
    '<label class="ehf">역할<select id="sfR" class="inp" onchange="sfRole(this.value)"' + (me ? ' disabled' : '') + '>' + ROLES.map(o => '<option' + ((x ? x.role : '직원') === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>' +
    (me ? '<small style="color:var(--muted)">내 역할은 여기서 바꿀 수 없습니다.</small>' : '') +
    (x ? '' : '<label class="ehf">PIN 4자리<input id="sfX" class="inp" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="휴대폰 뒷 4자리"></label>') +
    '<div id="sfM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="sfB" class="btn big pri" style="flex:2" onclick="staffSaveGo(\'' + (id || '') + '\')">저장</button></div>');
  setTimeout(() => { const n = $('sfN'); if (n) n.focus(); }, 50);
}
function sfRole(v) { const p = $('sfP'); if (v === '옵저버') p.value = '관리'; p.disabled = v === '옵저버'; }   // 옵저버는 파트 「관리」 고정 (결정 138)
async function staffSaveGo(id) {
  const d = { staff_id: id, name: $('sfN').value, part: $('sfP').value, role: $('sfR').value, pin: id ? '' : $('sfX').value };
  $('sfB').disabled = true;
  try {
    const r = await call('adminStaffSave', d);
    if (!r.ok) { $('sfM').textContent = r.error; $('sfB').disabled = false; return; }
    closeDialog(); S.set.staff = r.staff; render(); toast(id ? d.name.trim() + ' 님 정보를 저장했습니다' : d.name.trim() + ' 님을 추가했습니다');
  } catch (e) { $('sfB').disabled = false; }
}
function staffPinDlg(id) {
  const x = staffOf(id);
  dialog('<h2 class="ehdh">PIN 변경</h2><p class="ehdp">' + h(x.name) + ' 님의 새 PIN 4자리. 바꾸면 이 직원이 쓰던 휴대폰은 로그아웃되고 새 PIN으로 다시 로그인합니다.</p>' +
    '<label class="ehf">새 PIN<input id="spX" class="inp" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
    '<div id="spM" role="alert" class="ehmsg"></div>' +
    '<div class="ehda"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="spB" class="btn big pri" style="flex:2" onclick="staffPinGo(\'' + id + '\')">바꾸기</button></div>');
  setTimeout(() => { const n = $('spX'); if (n) n.focus(); }, 50);
}
async function staffPinGo(id) {
  $('spB').disabled = true;
  try {
    const r = await call('adminStaffPin', id, $('spX').value);
    if (!r.ok) { $('spM').textContent = r.error; $('spB').disabled = false; return; }
    closeDialog(); toast(r.name + ' 님의 PIN을 바꿨습니다');
    if (id === S.user.staff_id) logout(true);   // 내 PIN을 바꾸면 이 기기 표도 무효
  } catch (e) { $('spB').disabled = false; }
}
async function staffDel(id) {
  const x = staffOf(id);
  if (!confirm(x.name + ' (' + x.part + ' · ' + x.role + ') 님을 삭제할까요?\n바로 로그인할 수 없게 됩니다. 서명·점검 기록의 이름은 그대로 남습니다.')) return;
  const r = await call('adminStaffRemove', id);
  if (!r.ok) return toast(r.error);
  S.set.staff = r.staff; render(); toast(x.name + ' 님을 삭제했습니다');
}

