/* ── 로그인 ── */
function renderLogin() {
  const dots = [0, 1, 2, 3].map(i => '<span class="pin-dot' + (i < S.pin.length ? ' on' : '') + '"></span>').join('');
  const keys = ['1','2','3','4','5','6','7','8','9'].map(n => '<button class="key" onclick="pinKey(\'' + n + '\')">' + n + '</button>').join('');
  return '<div style="max-width:420px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;padding:var(--sp-12) var(--sp-6) var(--sp-6);gap:var(--sp-6)">' +
    '<div style="text-align:center;display:flex;flex-direction:column;gap:var(--sp-1)"><small style="color:var(--muted)">잠실점 에비뉴엘 · 시설팀</small><b style="font-size:var(--size-xl)">업무지원</b>' + (window.WS_API ? '<span class="devchip">' + ICON.ok + '등록된 기기</span>' : '<small style="color:var(--muted)">v0.6 · 테스트판</small>') + '</div>' +
    '<div class="card" style="padding:var(--sp-6) var(--sp-4);display:flex;flex-direction:column;align-items:center;gap:var(--sp-3)"><b>PIN 입력</b><span style="font-size:var(--size-m);color:var(--muted)">본인 휴대폰 번호 뒷 4자리</span>' +
    '<div style="display:flex;gap:var(--sp-4)" aria-label="' + S.pin.length + '자리 입력됨">' + dots + '</div>' +
    '<span id="pinMsg" style="font-size:var(--size-s);color:var(--red);min-height:18px" role="alert"></span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-2);margin-top:auto">' + keys +
    '<button class="key" onclick="pinBack()" aria-label="지우기" style="border:none;background:none">⌫</button>' +
    '<button class="key" onclick="pinKey(\'0\')">0</button>' +
    '<button class="key" onclick="doLogin()" style="background:var(--blue);border-color:var(--blue);color:var(--white);font-size:var(--size-l);font-weight:600">' + (S.busy ? '<span class="spin"></span>' : '로그인') + '</button></div>' +
    '<small style="text-align:center;color:var(--muted);line-height:1.6">하루 첫 로그인 때 본인 서명을 받습니다<br>로그인은 다음 날 오전 6시까지 유지됩니다</small></div>';
}
function pinKey(n) { if (S.pin.length < 4) { S.pin += n; render(); if (S.pin.length === 4) doLogin(); } }
function pinBack() { S.pin = S.pin.slice(0, -1); render(); }
async function doLogin() {
  if (S.busy || S.pin.length !== 4) return;
  S.busy = true; render();
  try {
    const r = await run('login', S.pin, deviceId());
    S.busy = false;
    if (r.needSign) { S.sign = { mode: 'pin', pin: S.pin, name: r.name, part: r.part, busy: false, msg: '' }; S.pin = ''; S.view = 'sign'; render(); return; }
    if (!r.ok) { S.pin = ''; render(); $('pinMsg').textContent = r.error; return; }
    loggedIn(r);
    await boot();
  } catch (e) { S.busy = false; S.pin = ''; render(); $('pinMsg').textContent = '연결 오류: ' + (e.message || e); }
}
/** QR 화면(eq.html)에서 「앱에 로그인하기」로 왔으면 로그인 뒤 그 QR 화면으로 돌려보냄 (같은 사이트 eq.html?eq=고유번호 만) */
function afterLogin() {
  let a = '';
  try { a = sessionStorage.getItem('ws_after') || ''; sessionStorage.removeItem('ws_after'); } catch (e) {}
  try { const u = new URL(a, location.href); if (u.origin === location.origin && /\/eq\.html$/.test(u.pathname) && /^[2-9a-km-np-z]{12}$/.test(u.searchParams.get('eq') || '')) { location.href = u.href; return true; } } catch (e) {}
  return false;
}
function loggedIn(r) { S.token = r.token; store('ws_token', r.token); SHELL.set(r.token); S.user = r.user; S.pin = ''; S.sign = null; }
const OFFMSG = '이 기기에 저장했습니다. 신호가 잡히면 자동으로 보냅니다';   // 서버에 들어가기 전에는 「저장되었습니다」라고 하지 않음 (결정 222)
function logoutAsk() { if (window.WS_OFFLINE && WS_OFFLINE.count() && !confirm('아직 전송되지 않은 저장 대기 ' + WS_OFFLINE.count() + '건이 있습니다. 로그아웃해도 이 기기에 남아 있다가, 본인이 다시 로그인하면 보냅니다. 로그아웃할까요?')) return; logout(); }
if (window.WS_OFFLINE) { WS_OFFLINE.tokenFn = () => S.token; WS_OFFLINE.onSent = n => toast('저장 대기 ' + n + '건을 전송했습니다'); }
function logout(expired) { store('ws_token', null); store('ws_main', null); SHELL.set(''); bootSeq++; S.token = ''; S.user = null; S.sign = null; S.pin = ''; S.view = 'login'; histReset(); render(); if (expired === true) toast('다시 로그인해 주세요.'); }

/* ── 근무일 첫 서명 (결정 56·60) — 서명하지 않으면 로그인되지 않음 ── */
function renderSign() {
  const g = S.sign;
  return '<div style="max-width:560px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;padding:var(--sp-8) var(--sp-4) var(--sp-6);gap:var(--sp-4)">' +
    '<div style="display:flex;flex-direction:column;gap:var(--sp-1)"><small style="color:var(--muted)">오늘 첫 로그인 · 본인 확인</small><b style="font-size:var(--size-xl)">' + h(g.name) + ' 님, 서명해 주세요</b>' +
    '<span style="font-size:var(--size-m);color:var(--sub);line-height:1.6">이 서명은 오늘 TBM 서명란에 로그인한 순서대로 들어갑니다. 오늘(오전 6시 ~ 다음 날 6시)은 다시 묻지 않습니다.</span></div>' +
    '<div class="spad" id="spad"><canvas class="g"></canvas><canvas class="i" aria-label="서명 칸"></canvas></div>' +
    '<div style="display:flex;gap:var(--sp-2);align-items:center"><button class="btn" id="sClr" onclick="SPAD.clear()" disabled>지우기</button><span id="sMsg" role="alert" style="flex:1;font-size:var(--size-s);color:var(--red)">' + h(g.msg) + '</span></div>' +
    '<div style="display:flex;flex-direction:column;gap:var(--sp-2);margin-top:auto">' +
    '<button class="btn pri big" id="sGo" onclick="doSign()" disabled>' + (g.busy ? '<span class="spin"></span>' : '서명하고 로그인') + '</button>' +
    (g.mode === 'pin' ? '<button class="btn" onclick="S.sign=null;S.view=\'login\';render()">PIN 다시 입력</button>' : '<button class="btn" onclick="logout()">다른 사람으로 로그인</button>') +
    '</div></div>';
}
let SPAD = null;
function mountSign() {
  const box = $('spad'); if (!box) return;
  SPAD = makeSignPad(box, S.sign.name, has => { S.sign.msg = ''; $('sMsg').textContent = ''; $('sGo').disabled = !has || S.sign.busy; $('sClr').disabled = !SPAD || SPAD.empty(); });
}
function makeSignPad(box, ghostText, onChange) {
  const g = box.querySelector('canvas.g'), ink = box.querySelector('canvas.i');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let len = 0, drawing = false, last = null;
  function size() { [g, ink].forEach(c => { c.width = Math.round(box.clientWidth * dpr); c.height = Math.round(box.clientHeight * dpr); }); ghost(); }
  function ghost() {   // 이름을 연회색 굵은 글자로 깔아 둠 (결정 46)
    const c = g.getContext('2d'); c.clearRect(0, 0, g.width, g.height);
    let fs = 64 * dpr; c.font = '800 ' + fs + 'px "Noto Sans KR", sans-serif';
    while (c.measureText(ghostText).width > g.width * 0.8 && fs > 18) { fs -= 2; c.font = '800 ' + fs + 'px "Noto Sans KR", sans-serif'; }
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#C5CCD6'; c.fillText(ghostText, g.width / 2, g.height / 2);
  }
  function pos(e) { const r = ink.getBoundingClientRect(); return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }; }
  function dot(p) { const c = ink.getContext('2d'); c.fillStyle = '#18202B'; c.beginPath(); c.arc(p.x, p.y, 1.8 * dpr, 0, Math.PI * 2); c.fill(); }
  function mark() { box.classList.toggle('inked', len > 0); onChange(len > 0); }
  ink.addEventListener('pointerdown', e => { e.preventDefault(); ink.setPointerCapture(e.pointerId); drawing = true; last = pos(e); dot(last); len += 1; mark(); });
  ink.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e), c = ink.getContext('2d');
    c.lineWidth = 3.6 * dpr; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#18202B';
    c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke();
    len += Math.hypot(p.x - last.x, p.y - last.y); last = p; mark();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => ink.addEventListener(t, () => { drawing = false; }));
  window.addEventListener('resize', () => { if (len === 0 && box.isConnected) size(); });
  size();
  return {
    empty: () => len === 0,
    has: () => len > 120 * dpr,   // 너무 짧게 그은 서명은 받지 않음 (개선 A)
    clear: () => { ink.getContext('2d').clearRect(0, 0, ink.width, ink.height); len = 0; ghost(); mark(); },
    // 가로 600px 흑백 PNG — 바탕은 투명, 검은 글씨만 남김 (결정 60, 11-19 바탕 없앰)
    png: () => {
      const W = 600, H = Math.round(600 * ink.height / ink.width);
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.drawImage(ink, 0, 0, W, H);
      const im = c.getImageData(0, 0, W, H), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3 < 170 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = v ? 0 : 255; }
      c.putImageData(im, 0, 0);
      return out.toDataURL('image/png');
    }
  };
}
async function doSign() {
  const g = S.sign;
  if (!g || g.busy || !SPAD) return;
  if (!SPAD.has()) { $('sMsg').textContent = '서명이 너무 짧습니다. 이름을 따라 크게 써 주세요.'; return; }
  const png = SPAD.png();
  g.busy = true; $('sGo').disabled = true; $('sGo').innerHTML = '<span class="spin"></span>';
  try {
    const r = g.mode === 'pin' ? await run('login', g.pin, deviceId(), png) : await run('signToday', S.token, png);
    g.busy = false;
    if (!r.ok) { $('sMsg').textContent = r.error || '저장하지 못했습니다'; $('sGo').disabled = false; $('sGo').textContent = '서명하고 로그인'; if (r.needSign === undefined && g.mode === 'pin' && /PIN|잠|5번/.test(r.error || '')) { S.sign = null; S.view = 'login'; render(); $('pinMsg').textContent = r.error; } return; }
    if (g.mode === 'pin') loggedIn(r); else S.sign = null;
    S.view = 'loading'; render();
    await boot(true);
  } catch (e) {
    g.busy = false; $('sGo').disabled = false; $('sGo').textContent = '서명하고 로그인';
    if (String(e && e.message).indexOf('LOGIN') !== -1) { logout(true); return; }
    $('sMsg').textContent = '연결 오류: ' + (e.message || e) + ' — 다시 눌러 주세요';
  }
}
/* 로그인 확인. 늦게 끝난 확인(앞선 boot)은 무시하고, 이미 다른 화면이면 메인으로 보내지 않음 (결정 48) */
let bootSeq = 0;
async function boot(fromStart) {
  const my = ++bootSeq;
  let r;
  try { r = await run('bootstrap', S.token); }
  catch (e) {
    if (my !== bootSeq) return;
    if (String(e && e.message).indexOf('LOGIN') !== -1) { logout(fromStart !== true); return; }
    if (fromStart && S.view === 'main' && S.cached) { toast('서버에 연결하지 못했습니다. 지난번 화면입니다.'); return; }
    if (fromStart) { S.view = 'retry'; render(); return; }   // 연결 오류는 로그아웃하지 않음
    toast('서버 오류: ' + (e && e.message ? e.message : e)); throw e;
  }
  if (my !== bootSeq) return;
  const wasCached = S.cached && S.view === 'main';
  S.user = r.user; S.fire = r.fire; S.docs = r.docs || null; S.menuOff = r.menuOff || []; S.acTodo = r.acTodo || null; S.cached = false; S.fireAt = Date.now();
  S.ver = r.app && r.app.version; store('ws_ver', S.ver || null);
  if (r.toastSec) store('ws_toast_sec', String(r.toastSec));
  if (wasCached && !r.needSign) toast('최신 내용으로 불러왔습니다');
  if (!r.needSign) setTimeout(prefetch, 0);   // 메인이 뜬 뒤 TBM·명일 작업을 뒤에서 미리 받음
  if (!r.needSign) store('ws_main', JSON.stringify({ sid: r.user.staff_id, user: r.user, fire: r.fire, docs: r.docs, menuOff: S.menuOff }));   // 다음 접속 때 먼저 보여 줄 메인 화면
  if (r.needSign) { S.sign = { mode: 'token', name: r.user.name, part: r.user.part, busy: false, msg: '' }; S.view = 'sign'; render(); return; }   // 표는 있는데 오늘 서명이 없음
  if (afterLogin()) return;
  if (['login', 'loading', 'retry', 'sign'].indexOf(S.view) !== -1) go('main');
  else if (S.view === 'main') render();   // 먼저 보여 준 지난번 화면을 새 숫자로
}
function renderLoading() {
  return '<div class="wrap" style="min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-3)"><span class="spin" style="color:var(--blue);width:32px;height:32px"></span><span style="color:var(--sub)">불러오는 중…</span></div>';
}
function renderRetry() {
  return '<div class="wrap" style="min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-3);text-align:center"><b style="font-size:var(--size-l)">서버에 연결하지 못했습니다</b><span style="color:var(--sub);line-height:1.6">신호를 확인하고 다시 시도해 주세요.<br>로그인은 그대로 유지됩니다.</span><button class="btn pri big" onclick="S.view=\'loading\';render();boot(true)">다시 시도</button><button class="btn" onclick="logout()">다른 사람으로 로그인</button></div>';
}

