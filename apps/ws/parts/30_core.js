/* ── 도우미 ── */
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
function deviceId() { let d = store('ws_dev'); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); store('ws_dev', d); } return d; }
/* 기기 표를 바로가기 페이지(GitHub) 저장소에도 보관 (결정 50) — 브라우저가 이 칸 저장소를 지워도 다시 PIN을 묻지 않게 */
const SHELL_ORIGIN = (function () { try { const o = new URL(EXEC_URL).origin; return /\.github\.io$/.test(o) ? o : ''; } catch (e) { return ''; } })();
const SHELL = {
  get() {
    return new Promise(ok => {
      if (!SHELL_ORIGIN || window.top === window) return ok('');
      let done = false;
      const onMsg = e => { const d = e.data || {}; if (e.origin === SHELL_ORIGIN && d.fm === 'ws-token') { done = true; window.removeEventListener('message', onMsg); ok(d.token || ''); } };
      window.addEventListener('message', onMsg);
      try { window.top.postMessage({ fm: 'ws-token-get' }, SHELL_ORIGIN); } catch (e) { return ok(''); }
      setTimeout(() => { if (!done) { window.removeEventListener('message', onMsg); ok(''); } }, 800);
    });
  },
  set(t) { try { if (SHELL_ORIGIN && window.top !== window) window.top.postMessage({ fm: 'ws-token-set', token: t || '' }, SHELL_ORIGIN); } catch (e) {} }
};
function tokenAlive(t) { const p = String(t || '').split('.'); return p.length === 3 && Number(p[1]) > Date.now(); }
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(id) { return document.getElementById(id); }
function run(fn, ...args) {
  if (window.WS_API) return WS_API.run(fn, ...args);   // 바로가기 앱(Supabase 이관): fm/ws/ws-api.js
  return new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(no)[fn](...args));
}
async function call(fn, ...args) {
  try {
    return await run(fn, S.token, ...args);
  } catch (e) {
    if (String(e && e.message).indexOf('LOGIN') !== -1) { logout(true); throw e; }
    toast('서버 오류: ' + (e && e.message ? e.message : e));
    throw e;
  }
}
/* 알림은 줄을 세워 하나씩: 보이는 시간(환경설정, 기본 2.6초) → 0.5초 쉬고 다음 (결정 102) */
const TOASTQ = [];
let toastBusy = false;
function toastMs() { const v = Number(store('ws_toast_sec')); return (v >= 0.5 && v <= 10 ? v : 2.6) * 1000; }
function toast(msg) {
  if (TOASTQ[TOASTQ.length - 1] === msg) return;   // 같은 글이 바로 이어 들어오면 한 번만
  TOASTQ.push(msg); if (!toastBusy) toastNext();
}
function toastNext() {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast hide'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  if (!TOASTQ.length) { toastBusy = false; return; }
  toastBusy = true; t.textContent = TOASTQ.shift(); t.classList.remove('hide');
  setTimeout(() => { t.classList.add('hide'); setTimeout(toastNext, 500); }, toastMs());
}
function dialog(html) { $('layer').innerHTML = '<div class="dialog-back" onclick="if(event.target===this)closeDialog()"><div class="dialog" role="dialog" aria-modal="true">' + html + '</div></div>'; }
function closeDialog() { $('layer').innerHTML = ''; }
// 메뉴 줄 아이콘(결정 186): 22px 선 그림, 칸 색은 줄마다 style 로 (06 문서 「메뉴 줄 아이콘 규칙」)
const _pi = (b, z = 22) => '<svg width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b + '</svg>';
const ICON = {
  tbm: _pi('<circle cx="9" cy="8.5" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14c2.5 0 4.5 1.9 4.5 4.5"/>'),
  nw: _pi('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 15.5h8M13.5 13l2.5 2.5-2.5 2.5"/>'),
  att: _pi('<circle cx="10" cy="8" r="3.2"/><path d="M3.5 20c0-3.6 2.9-6 6.5-6 1.3 0 2.4.3 3.4.9"/><path d="M15 18.5l2.5 2.5 4.5-5"/>'),
  log: _pi('<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11M9 8h6"/>'),
  ahu: _pi('<path d="M7 14V5a2 2 0 014 0v9a4 4 0 11-4 0z"/><path d="M14.5 8h3.8a2.2 2.2 0 10-2.2-2.2M14.5 13h5a2.2 2.2 0 11-2.2 2.2"/>'),
  fire: _pi('<rect x="6.5" y="9" width="9" height="12" rx="2.5"/><path d="M6.5 14h9M11 9V5M8.5 5h5.5l3-1.5M14.5 6.5c3 0 5 1.5 5 4.5v4"/>'),
  plug: _pi('<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 01-12 0z"/><path d="M12 17v4"/>'),
  therm: _pi('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/><path d="M10.5 13.5q.75-1.2 1.5 0t1.5 0"/>'),
  work: _pi('<circle cx="8.5" cy="12" r="3"/><path d="M8.5 4.5v2M8.5 17.5v2M1.5 12h2M13.5 12h1M3.6 7.1l1.4 1.4M12 15.5l-1.4-1.4M3.6 16.9L5 15.5"/><path d="M21 14.2A5.2 5.2 0 0116.3 9a5.2 5.2 0 013.9-5 6.4 6.4 0 00.8 10.2z"/>'),
  hat: _pi('<path d="M4 16a8 8 0 0116 0"/><rect x="2.5" y="16" width="19" height="3" rx="1"/><path d="M12 8v8"/>'),
  qr: _pi('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4h-1.5"/>', 24),
  stat: _pi('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>', 24),
  hyd: _pi('<path d="M8 21V11a4 4 0 018 0v10M5.5 21h13M4 13.5h4M16 13.5h4M10 8h4M12 7V3.5"/>', 24),
  air: _pi('<rect x="8" y="4" width="8" height="17" rx="4"/><path d="M10.5 4V2.5h3V4M8 9h8M12 12v3"/>', 24),
  box: _pi('<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>'),
  docs: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  inspect: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  map: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  cad: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V9l12 12z"/><path d="M4 4h16M4 2v4M20 2v4"/><path d="M20 9v12"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  soon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  cam: '<svg class="ui-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  folder: '<svg class="ui-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  dl: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  clip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6573" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  print: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>'
};
const STATE = { ok: ['점검완료', 'c-ok'], bad: ['이상 있음', 'c-bad'], wait: ['점검 전', 'c-wait'], miss: ['미입력', 'c-miss'] };
function ymLabel(ym) { return Number(ym.slice(0, 4)) + '년 ' + Number(ym.slice(5, 7)) + '월'; }

/* ── 화면 이동 (뒤로 가기 지원) ── */
function go(view, push) {
  S.view = view;
  if (push !== false) { try { google.script.history.push({ v: view }, { }); } catch (e) {} }
  render();
  window.scrollTo(0, 0);
  if (view === 'fire' && !(S.fireAt && Date.now() - S.fireAt < 60000)) refreshFire();
  if (view === 'fire' && !(S.eqAt && Date.now() - S.eqAt < 60000)) refreshEq();   // 1분 안에 받은 숫자면 그대로 (결정 78)
}
async function refreshFire() { try { const r = await call('bootstrap'); S.fire = r.fire; S.user = r.user; S.fireAt = Date.now(); if (S.view === 'fire') render(); } catch (e) {} }
// 소화전·공기호흡기 이번 달 숫자 (실패해도 메뉴는 그대로)
async function refreshEq() { try { const e = await run('eqStatus', S.token, ''); if (e && e.ok) { S.eqc = e; S.eqAt = Date.now(); if (S.view === 'fire') render(); } } catch (e) {} }
try { google.script.history.setChangeHandler(e => { const v = e.state && e.state.v; if (v && S.token) { S.view = v; render(); } }); } catch (e) {}
const PARENT = { inspect: 'main', fire: 'inspect', eh: 'inspect', thermal: 'inspect', cs: 'inspect', csck: 'cs', qr: 'fire', hyd: 'fire', hydfl: 'hyd', status: 'fire', floor: 'status', docs: 'main', set: 'main', risk: 'set', map: 'main', cad: 'main', spec: 'main', tbm: 'docs', nw: 'docs', log: 'docs', rw: 'docs', wh: 'docs', ahu: 'docs', clim: 'docs', use: 'docs', rep: 'docs', kw: 'set', uhr: 'use', att: 'docs', attup: 'att' };
function back() { if (S.view === 'pdf') return go((S.pdf && S.pdf.from) || 'main'); if (S.view === 'csck') return csLeave(); if (S.view === 'risk' && S.rk && S.rk.dirty && !confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?')) return; if (S.view === 'wh' && S.wh && (S.wh.d.dirty || S.wh.n.dirty) && !confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?')) return; if (S.view === 'nw' && !nwLeaveOk()) return; if (S.view === 'log' && !lgLeaveOk()) return; if (S.view === 'ahu' && !ahuLeaveOk()) return; if ((S.view === 'clim' || S.view === 'use') && !clLeaveOk()) return; if (S.view === 'rep') return repBack(); if (S.view === 'uhr') return uhBack(); if (S.view === 'tbm' && S.tbm && S.tbm.dirty && !confirm('저장하지 않은 내용이 있습니다. 저장하지 않고 나갈까요?')) return; go(PARENT[S.view] || 'main'); }

function topbar(sub, title) {
  const u = S.user || {};
  return '<header class="top"><div class="top-in">' +
    '<div class="ttl"><small>' + h(sub) + '</small><b>' + h(title) + '</b></div>' +
    '<span class="me">' + h(u.name) + ' · ' + h(u.part) + '</span>' +
    (window.WS_OFFLINE ? WS_OFFLINE.chip() : '') +   // 「저장 대기 n건」 (오프라인 임시 저장, 결정 222) — 없으면 숨김
    '<button class="btn sm" onclick="logoutAsk()">로그아웃</button>' +
    '</div></header>';
}

