/* ── 점검 ── */
function renderInspect() {
  const R = (k, fn, bg, col, ico, name, sm) => subRow('inspect.' + k, fn, bg, col, ico, name, sm);
  return topbar('업무지원 ›', '점검') + '<div class="wrap list">' +
    R('fire', "go('fire')", 'var(--blue-bg)', 'var(--blue)', ICON.fire, '소화기/소화전/공기호흡기 점검', 'QR 관리 · 월별 점검 현황') +
    R('eh', 'openEh()', 'var(--orange-bg)', 'var(--orange)', ICON.plug, '전열필증', '층·매장별 전열기기 관리 · 신고필증' + (CAN_PRINT ? ' 출력' : ' (출력은 PC에서)')) +
    R('thermal', 'openThermal()', 'var(--blue-bg)', 'var(--blue)', ICON.therm, '열화상점검', 'FLIR 열화상 사진 → 점검 보고서(.atr) · PC 전용', !thCanOpen()) +
    R('cs', 'openCs()', 'var(--green-bg)', 'var(--green)', ICON.hat, '공사장 점검', '공사 현장 안전 순찰 · 사진 · 날짜별 현장별 PDF') +
    R('defect', 'openDf()', 'var(--green-bg)', 'var(--green)', ICON.file, '하자점검', '현장·하자내용 · 사진 · 서명 · 인쇄 A4 · PDF') +
    '</div>';
}

/* ── 열화상점검 (결정 262): 업무지원 안에서 만들지 않고, PC 에 둔 오프라인 단독 프로그램을 실행한다. 모바일은 안내만 ──
   브라우저는 .bat 을 직접 못 돌리므로 윈도우에 한 번 등록한 연결(avenuel-thermal://, apps/ws/tools/열화상_실행_등록.bat)로 부른다 */
const thCanOpen = () => !!S.user;
const TH_REG_URL = 'https://avenuel-fm.github.io/fm/ws/thermal_register.bat';   // 등록 파일(apps/ws/tools/열화상_실행_등록.bat 와 같은 내용)
function thermalLaunch() {
  toast('열화상 리포트를 실행합니다');
  location.href = 'avenuel-thermal://run';
}
function thermalGuideClose() { const e = document.getElementById('thguide'); if (e) e.remove(); }
function thermalGo() { store('ws_thermal_reg', '1'); thermalGuideClose(); thermalLaunch(); }
function thermalGuide() {
  thermalGuideClose();
  const d = document.createElement('div');
  d.id = 'thguide'; d.className = 'spsheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.onclick = e => { if (e.target === d) thermalGuideClose(); };
  d.innerHTML = '<div class="card" style="max-width:460px;width:100%;padding:var(--sp-4);line-height:1.7">' +
    '<h3 style="margin:0 0 var(--sp-2);font-size:var(--size-m)">열화상 프로그램 연결 등록</h3>' +
    '<div style="margin-bottom:var(--sp-3)">이 PC에서 <b>처음 한 번만</b> 하면 됩니다. 등록하면 다음부터는 단추만 누르면 열화상 프로그램이 열립니다.</div>' +
    '<ol style="margin:0 0 var(--sp-3);padding-left:1.3em"><li>아래 <b>등록 파일 받기</b>를 누릅니다.</li><li>받은 파일을 <b>두 번 눌러 실행</b>하고 <b>[완료]</b>가 나오면 닫습니다.</li><li><b>등록했어요 · 열화상 실행</b>을 누릅니다. (브라우저가 열기 허용을 물으면 허용)</li></ol>' +
    '<div style="display:flex;gap:var(--sp-2);flex-wrap:wrap">' +
    '<a class="btn" id="thdl" href="' + TH_REG_URL + '" download="thermal_register.bat">등록 파일 받기</a>' +
    '<button class="btn" id="thgo" onclick="thermalGo()">등록했어요 · 열화상 실행</button>' +
    '<button class="btn" id="thx" onclick="thermalGuideClose()">닫기</button></div></div>';
  document.body.appendChild(d);
}
function openThermal() {
  if (!thCanOpen()) return;
  if (!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches)) { toast('PC에서만 작업 가능합니다'); return; }
  if (store('ws_thermal_reg') === '1') thermalLaunch(); else thermalGuide();   // 등록 전이면 안내 팝업
}

/* ── CAD (WS_CAD.md): 변환된 도면(DXF) 뷰어 fm/cad 를 화면 안 창으로. 자료는 18_cad.sql 함수만 · 파일은 ws-files/cad + 구글 드라이브 사본 ── */
function renderCad() {
  return '<div class="mapview">' + topbar('업무지원 ›', 'CAD') + '<iframe class="mapframe" src="../cad/index.html" title="CAD 도면" allow="fullscreen"></iframe>' +
    '<button class="btn mapback" onclick="back()">' + ICON.back + '뒤로</button></div>';
}
const cadOk = r => { if (!r || !r.ok) throw new Error((r && r.error) || '처리하지 못했습니다'); return r; };
window.WS_CAD = {
  me: async () => ({ name: S.user ? S.user.name : '', role: S.user ? S.user.role : '' }),
  list: async () => { const r = cadOk(await call('cadList')); S.cadItems = r.items; S.cadCats = r.cats || []; S.cadCanDel = !!r.can_del_cat; return r.items; },
  cats: async () => ({ cats: S.cadCats || [], canDel: !!S.cadCanDel }),
  catAdd: async name => cadOk(await call('cadCatAdd', name)),
  catDel: async id => cadOk(await call('cadCatDel', Number(id))),
  setCat: async (id, cat) => cadOk(await call('cadSetCat', Number(id), cat ? Number(cat) : null)),
  open: async id => {   // 받은 파일은 이 기기 캐시에 보관 (주소가 올릴 때마다 새로 생겨 같은 주소 = 같은 파일)
    const it = (S.cadItems || []).find(x => x.id === String(id));
    if (!it) throw new Error('도면 목록에 없습니다. 목록을 다시 열어 주세요');
    let c = null; try { c = await caches.open('ws-cad'); } catch (e) {}
    let res = c ? await c.match(it.url) : null;
    if (!res) { res = await fetch(it.url); if (!res.ok) throw new Error('도면 파일을 받지 못했습니다'); if (c) { try { await c.put(it.url, res.clone()); } catch (e) {} } }
    return { name: it.name, dxfBlob: await res.blob() };
  },
  upload: async o => {   // 파일 → 서버(ws-files/cad) → 구글 드라이브 사본(실패해도 올림은 유지) → 목록 기록
    const f = o.file;
    if (!f || !/\.dxf$/i.test(f.name)) throw new Error('.dxf 파일만 올립니다');
    if (f.size > 50 * 1048576) throw new Error('파일이 너무 큽니다 (50MB 넘음)');
    const up = await WS_API.upload('cad', f, 'dxf');
    let drive = '', C = window.WS_CONFIG || {};
    try {
      if (C.WS_GAS_URL) { const j = await (await fetch(C.WS_GAS_URL + '?api=caddrive&path=' + encodeURIComponent(up.path) + '&name=' + encodeURIComponent(o.name || f.name), { credentials: 'omit' })).json(); if (j.ok) drive = j.url; }
    } catch (e) {}
    const r = cadOk(await call('cadSave', { name: o.name, floor: o.floor || '', memo: o.memo || '', path: up.path, url: up.url, size: f.size, drive_url: drive, cat_id: o.cat_id || '' }));
    return { ok: true, id: r.id, drive: !!drive };
  },
  full: on => mapFull(on)
};

/* ── 개선 A: 입력 기간 안내 ── */
function periodBanner(st, counts, u) {   // u = 세는 단위 (소화기 「대」, 소화전·공기호흡기 「곳」)
  u = u || '대';
  if (!st) return '';
  const w = st.window, d = st.day, m = Number(st.ym.slice(5, 7));
  if (!st.isCurrent) return st.ym < st.curYm ? '<div class="banner b-gray">' + ymLabel(st.ym) + ' · 입력 기간 ' + m + '/' + w.start + '~' + m + '/' + w.end + ' · 마감됨</div>' : '';
  if (d < w.start) return '<div class="banner b-gray">이번 달 입력은 ' + m + '월 ' + w.start + '일부터 받습니다.</div>';
  if (d <= w.end) {
    const left = w.end - d;
    if (counts.wait > 0 && left <= 1) return '<div class="banner b-warn"><b>마감 임박</b> · ' + m + '월 ' + w.end + '일까지 · 점검 전 <b>' + counts.wait + u + '</b></div>';
    return '<div class="banner b-info">이번 달 입력 기간 ' + m + '월 ' + w.start + '일 ~ ' + w.end + '일 · ' + (left === 0 ? '오늘 마감' : left + '일 남음') + ' · 점검 전 ' + counts.wait + u + '</div>';
  }
  if (counts.miss > 0) return '<div class="banner b-red"><b>기한 지남</b> · 미입력 ' + counts.miss + u + ' · 지금 입력해도 받고 「기한 후」로 표시합니다</div>';
  return '<div class="banner b-gray">이번 달 입력 기간이 끝났습니다.</div>';
}

/* ── 소화기 점검 메뉴 ── */
function renderFire() {
  const f = S.fire;
  const c = f ? f.counts : { ok: 0, bad: 0, wait: 0, miss: 0, total: 0 };
  const done = c.ok + c.bad;
  const pct = c.total ? Math.round(done / c.total * 100) : 0;
  const st = f ? { ym: f.ym, curYm: f.ym, isCurrent: true, day: f.day, window: f.window } : null;
  return topbar('점검 ›', '소화기/소화전/공기호흡기 점검') + '<div class="wrap list">' +
    '<div class="card" style="padding:var(--sp-3) var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-2)"><div style="display:flex;justify-content:space-between;font-size:var(--size-m)"><span style="color:var(--muted)">이번 달 점검</span><span><b style="color:var(--green)">' + done + '</b> / ' + c.total + '대</span></div>' +
    '<div class="bar" style="height:8px"><span style="width:' + pct + '%;background:var(--green)"></span></div></div>' +
    periodBanner(st, c) + eqNotice() +
    '<button class="row" onclick="openQr()"><span class="ico" style="background:var(--blue-bg);color:var(--blue);width:48px;height:48px">' + ICON.qr + '</span><span class="fname"><b style="font-size:var(--size-l)">① 소화기/소화전/공기호흡기 QR 관리</b><small>소화기 · 소화전 · 공기호흡기 등록 · 삭제 · QR' + (CAN_PRINT ? ' · 출력' : ' (출력은 PC에서)') + '</small></span>' + ICON.chev + '</button>' +
    '<button class="row" onclick="openStatus()"><span class="ico" style="background:var(--green-bg);color:var(--green);width:48px;height:48px">' + ICON.stat + '</span><span class="fname"><b style="font-size:var(--size-l)">② 매장별 소화기 점검 현황</b><small>월별 · 층별(B3~10F) · 매장별</small></span>' + ICON.chev + '</button>' +
    '<button class="row" onclick="openHyd()"><span class="ico" style="background:var(--green-bg);color:var(--green);width:48px;height:48px">' + ICON.stat + '</span><span class="fname"><b style="font-size:var(--size-l)">③ 층별 소화전/공기호흡기 점검 현황</b><small>월별 · 층별(B3~10F) · 소화전 · 공기호흡기 · 조회만</small></span>' + ICON.chev + '</button>' +
    '</div>';
}
/* ── ③ 층별 소화전/공기호흡기 점검 현황 (결정 224 · 230, supabase/23_fire_equip.sql) ──
   앱에서는 조회만. 점검 입력은 붙어 있는 QR을 휴대폰으로 찍어 여는 eq.html 에서만 함 */
const EQ_KIND = { hyd: '소화전', air: '공기호흡기' };
async function openHyd(ym) { go('hyd'); await loadHyd(ym || ''); }
async function loadHyd(ym) { S.hq = null; render(); S.hq = await call('eqStatus', ym); S.hym = S.hq.ym; render(); }
function renderHyd() {
  const st = S.hq, T = topbar('소화기/소화전/공기호흡기 점검 ›', '층별 소화전/공기호흡기 점검 현황');
  if (!st) return T + '<div class="wrap"><div class="banner b-gray">불러오는 중…</div></div>';
  const c = st.counts, idx = st.months.indexOf(st.ym);
  const prev = idx > 0 ? st.months[idx - 1] : '';
  const next = idx >= 0 && idx < st.months.length - 1 ? st.months[idx + 1] : '';
  const nk = (it, k) => it.filter(i => i.kind === k).length;
  const floors = FLOORS.map(fl => {
    const it = st.items.filter(i => i.floor === fl);
    if (!it.length) return '';
    const fc = counts(it);
    const p = n => Math.round(n / fc.total * 100) + '%';
    return '<button class="floor" onclick="openHydFloor(\'' + fl + '\')"><span class="elbow"></span><b style="min-width:34px;font-size:var(--size-m)">' + fl + '</b>' +
      '<span class="fname" style="gap:var(--sp-1)"><span class="bar"><span style="width:' + p(fc.ok) + ';background:var(--green)"></span><span style="width:' + p(fc.bad) + ';background:var(--orange)"></span><span style="width:' + p(fc.miss) + ';background:var(--navy)"></span></span><small>소화전 ' + nk(it, 'hyd') + ' · 공기호흡기 ' + nk(it, 'air') + '</small></span>' +
      (fc.miss ? '<span class="chip c-miss">미입력 ' + fc.miss + '</span>' : '') + (fc.bad ? '<span class="chip c-bad">이상 ' + fc.bad + '</span>' : '') +
      '<b style="font-size:var(--size-s);color:var(--green)">' + (fc.ok + fc.bad) + '/' + fc.total + '</b>' + ICON.chev + '</button>';
  }).join('');
  const m = Number(st.ym.slice(5, 7));
  return T + '<div class="wrap list">' +
    '<div class="mnav"><button class="btn" aria-label="이전 달" ' + (prev ? 'onclick="loadHyd(\'' + prev + '\')"' : 'disabled') + '>‹</button><div><b style="font-size:var(--size-l)">' + ymLabel(st.ym) + '</b><small style="color:var(--muted)">입력 기간 ' + m + '/' + st.window.start + ' ~ ' + m + '/' + st.window.end + '</small></div><button class="btn" aria-label="다음 달" ' + (next ? 'onclick="loadHyd(\'' + next + '\')"' : 'disabled') + '>›</button></div>' +
    periodBanner(st, c, '곳') +
    '<div class="card legend"><span><span class="dot" style="background:var(--green)"></span>점검완료 <b>' + c.ok + '</b></span><span><span class="dot" style="background:var(--orange)"></span>이상 있음 <b>' + c.bad + '</b></span><span><span class="dot" style="background:var(--line)"></span>점검 전 <b>' + c.wait + '</b></span><span><span class="dot" style="background:var(--navy)"></span>미입력 <b>' + c.miss + '</b></span></div>' +
    '<div class="card tree"><div class="tree-root">' + ymLabel(st.ym) + ' · 전체 ' + c.total + '곳 (소화전 ' + nk(st.items, 'hyd') + ' · 공기호흡기 ' + nk(st.items, 'air') + ')</div>' +
    (floors || '<div style="padding:var(--sp-3) 0;color:var(--muted);font-size:var(--size-m)">이 달에 등록된 소화전·공기호흡기가 없습니다. ① QR 관리에서 등록해 주세요.</div>') + '</div>' +
    '<small style="text-align:center;color:var(--muted)">이 화면은 조회만 됩니다. 점검 입력은 소화전·공기호흡기에 붙어 있는 QR을 휴대폰으로 찍어서 합니다.</small>' +
    '<button class="btn" onclick="loadHyd(\'' + st.ym + '\')">새로고침</button></div>';
}
function openHydFloor(fl) { S.hfloor = fl; go('hydfl'); }
function renderHydFloor() {
  const st = S.hq, it = st.items.filter(i => i.floor === S.hfloor), m = Number(st.ym.slice(5, 7));
  const chips = FLOORS.map(f => '<button class="fl' + (f === S.hfloor ? ' on' : '') + '" aria-pressed="' + (f === S.hfloor) + '" onclick="S.hfloor=\'' + f + '\';render()">' + f + '</button>').join('');
  const sect = k => {
    const list = it.filter(i => i.kind === k);
    if (!list.length) return '';
    const done = list.filter(i => i.state === 'ok' || i.state === 'bad').length;
    return '<div class="store"><div class="store-h"><b>' + EQ_KIND[k] + '</b><small style="color:var(--muted)">' + done + ' / ' + list.length + '</small></div>' +
      list.map(i => {
        const has = i.state === 'ok' || i.state === 'bad';
        const sub = has ? h(i.by) + ' · ' + h(String(i.at).slice(5, 16)) + ' 입력' + (i.late ? ' · 기한 후' : '') : (i.state === 'miss' ? m + '월 ' + st.window.end + '일까지 입력 없음' : m + '월 ' + st.window.end + '일까지 입력 받는 중');
        return '<button class="feb" ' + (has ? 'onclick="hydDetail(\'' + i.checkId + '\')"' : 'disabled') + '><span class="fname"><b>' + h(i.name) + '</b><small>' + sub + '</small></span>' +
          (i.late ? '<span class="chip c-wait">기한 후</span>' : '') + '<span class="chip ' + STATE[i.state][1] + '">' + STATE[i.state][0] + '</span></button>';
      }).join('') + '</div>';
  };
  return topbar('층별 점검 현황 › ' + ymLabel(st.ym) + ' ›', S.hfloor + ' · 소화전 ' + it.filter(i => i.kind === 'hyd').length + ' · 공기호흡기 ' + it.filter(i => i.kind === 'air').length) + '<div class="wrap list">' +
    '<div style="display:flex;gap:var(--sp-1);overflow-x:auto;padding-bottom:var(--sp-1)">' + chips + '</div>' +
    (it.length ? sect('hyd') + sect('air') : '<div class="banner b-gray">' + S.hfloor + '에 등록된 소화전·공기호흡기가 없습니다.</div>') +
    '<small style="text-align:center;color:var(--muted)">점검완료 · 이상 있음을 누르면 입력한 사진과 내용을 봅니다 (입력은 QR로)</small></div>';
}
async function hydDetail(id) {
  dialog('<div style="display:flex;justify-content:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue);width:28px;height:28px"></span></div>');
  try {
    const r = await call('eqDetail', id);
    if (!r.ok) { closeDialog(); toast(r.error); return; }
    detSheet(r, r.items.map((i, k) => '<div style="display:flex;flex-direction:column;gap:var(--sp-2);padding:var(--sp-3) 0;' + (k ? 'border-top:1px solid var(--line)' : '') + '"><div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:var(--size-m)">' + h(i.label) + '</b><span class="chip ' + (i.bad ? 'c-bad' : 'c-ok') + '">' + h(i.text) + '</span></div>' +
      (i.memo ? '<div style="font-size:var(--size-m)">' + h(i.memo) + '</div>' : '') +
      '<div class="ph43">' + (i.photo ? '<img src="' + h(i.photo) + '" alt="' + h(i.label) + ' 사진">' : '<small>사진 없음</small>') + '</div></div>').join(''), 'eq', id);
  } catch (e) { closeDialog(); }
}
/* 현황 화면을 열어 두면 1분마다, 다른 화면에서 돌아오면 바로 다시 읽음 (QR로 입력한 점검이 곧 보임) */
let eqBusy = false;
async function quietEq() {
  if (eqBusy || document.hidden || ['hyd', 'hydfl'].indexOf(S.view) === -1 || !S.hq || document.querySelector('.dialog-back')) return;
  eqBusy = true;
  try {
    const v = S.view, r = await run('eqStatus', S.token, S.hq.ym);
    if (r && r.ok && S.view === v && S.hq && r.ym === S.hq.ym) { S.hq = r; render(); }
  } catch (e) { /* 다음 번에 다시 */ } finally { eqBusy = false; }
}
setInterval(quietEq, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) quietEq(); });
window.addEventListener('pageshow', e => { if (e.persisted) quietEq(); });

/** 소화기 점검 메뉴 맨 위: 소화전·공기호흡기 이번 달 진행 + 기한 지남·마감 임박 알림 (결정 224) */
function eqNotice() {
  const e = S.eqc;
  if (!e || !e.counts || !e.counts.total) return '';
  const c = e.counts, d = e.day, w = e.window, done = c.ok + c.bad, m = Number(e.ym.slice(5, 7));
  let msg = '';
  if (c.miss > 0) msg = '<div class="banner b-red"><b>소화전·공기호흡기 기한 지남</b> · 미입력 <b>' + c.miss + '곳</b> · 지금 입력해도 받고 「기한 후」로 표시합니다</div>';
  else if (c.wait > 0 && d <= w.end && w.end - d <= 1) msg = '<div class="banner b-warn"><b>소화전·공기호흡기 마감 임박</b> · ' + m + '월 ' + w.end + '일까지 · 점검 전 <b>' + c.wait + '곳</b></div>';
  return '<div class="card" style="padding:var(--sp-3) var(--sp-4);display:flex;justify-content:space-between;font-size:var(--size-m)"><span style="color:var(--muted)">이번 달 소화전·공기호흡기</span><span><b style="color:var(--green)">' + done + '</b> / ' + c.total + '곳</span></div>' + msg;
}

/* ── ① QR 관리 ── */
const QR_KIND = { fe: '소화기', hyd: '소화전', air: '공기호흡기' };
const KSEP = '<';   // 열림·선택 키 구분 글자 (위치 이름에는 < > 가 못 들어감)
async function openQr() { S.qrKind = 'fe'; S.qr = null; S.qrOpen = {}; S.qrSc = {}; S.q = ''; go('qr'); await loadQr(); }
async function loadQr() {
  const k = S.qrKind || 'fe';
  const r = k === 'fe' ? await call('feList') : await call('eqList', k);
  if ((S.qrKind || 'fe') !== k) return;   // 그 사이 다른 탭을 눌렀으면 이 답은 버림
  S.qr = r; S.sel = {};
  // 방금 등록한 것: 층·위치를 펼치고 미리 골라 둠 (바로 [출력])
  const nw = S.qrNew; S.qrNew = null;
  if (nw && nw.length) r.items.forEach(i => { if (nw.indexOf(i.name) !== -1) { S.sel[i.id] = true; S.qrOpen[[k, i.floor].join(KSEP)] = true; S.qrOpen[[k, i.floor, i.store].join(KSEP)] = true; } });
  render();
}
function qrTab(k) { if ((S.qrKind || 'fe') === k) return; S.qrKind = k; S.qr = null; S.sel = {}; S.q = ''; S.qrSc = {}; render(); loadQr(); }
// 소화기 QR은 ?fe=, 소화전·공기호흡기 QR은 ?eq= (바로가기 index.html 이 eq.html 로 보냄)
function qrUrl(token) { return (S.qr && S.qr.execUrl ? S.qr.execUrl : EXEC_URL) + ((S.qrKind || 'fe') === 'fe' ? '?fe=' : '?eq=') + token; }
/** 층 → 위치 묶음 (결정 228, 서버가 층·위치·번호 순으로 줌). 소화전·공기호흡기는 위치가 place, 소화기는 store_name — 화면에서는 둘 다 i.store */
function qrGroups(items) {
  const out = [];
  FLOORS.forEach(fl => {
    const fi = items.filter(i => i.floor === fl);
    if (!fi.length) return;
    const locs = [];
    fi.forEach(i => { let l = locs.find(x => x.place === i.store); if (!l) locs.push(l = { place: i.store, items: [] }); l.items.push(i); });
    out.push({ fl, locs, items: fi });
  });
  return out;
}
// 열림: 검색 중이면 맞는 것은 자동으로 펼침(눌러서 접으면 그대로), 아니면 눌러 둔 대로 (처음은 모두 접힘)
function qrIsOpen(key) { return S.q.trim() ? !S.qrSc[key] : !!S.qrOpen[key]; }
function qrTog(key) { if (S.q.trim()) S.qrSc[key] = qrIsOpen(key); else S.qrOpen[key] = !S.qrOpen[key]; render(); }
function qrOpenAll(on) {
  const k = S.qrKind || 'fe', searching = !!S.q.trim();
  qrGroups(S.qr.items).forEach(g => [[k, g.fl]].concat(g.locs.map(l => [k, g.fl, l.place])).forEach(a => { const key = a.join(KSEP); if (searching) S.qrSc[key] = !on; else S.qrOpen[key] = on; }));
  render();
}
function qrIdsOf(key) { const p = key.split(KSEP); return S.qr.items.filter(i => i.floor === p[1] && (p[2] === undefined || i.store === p[2])).map(i => i.id); }
function qrSelKey(key, on) { qrIdsOf(key).forEach(id => { S.sel[id] = on; }); render(); }
function qrMarkPartial() { document.querySelectorAll('.ac-h > input[data-part]').forEach(e => { e.indeterminate = true; }); }
function renderQr() {
  const r = S.qr, kind = S.qrKind || 'fe', kn = QR_KIND[kind], unit = kind === 'fe' ? '대' : '개';
  const selN = Object.keys(S.sel).filter(k => S.sel[k]).length;
  const chev = '<svg class="cv" viewBox="0 0 24 24" fill="none" stroke="#5B6573" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  let body = '<div class="banner b-gray">불러오는 중…</div>', expandBar = '';
  const row = i => '<div class="fe"><input type="checkbox" aria-label="' + h(i.name) + ' 고르기" ' + (S.sel[i.id] ? 'checked' : '') + ' onchange="S.sel[\'' + i.id + '\']=this.checked;render()">' +
    '<button class="qrmini" data-qr="' + h(i.token) + '" onclick="bigQr(\'' + i.id + '\')" aria-label="' + h(i.name) + ' QR 크게 보기"></button>' +
    '<span class="fname"><b>' + h(i.name) + '</b><small>' + h(i.id) + '</small></span>' + (i.printed === false ? '<span class="chip c-miss">미인쇄</span>' : '') + '</div>';
  const head = (key, label, cnt, items, big) => {
    const ids = items.map(i => i.id), n = ids.filter(id => S.sel[id]).length, open = qrIsOpen(key), unp = items.filter(i => i.printed === false).length;
    return '<div class="ac-h' + (open ? ' open' : '') + '"><input type="checkbox" data-k="' + h(key) + '" ' + (n === ids.length ? 'checked' : '') + (n && n < ids.length ? ' data-part="1"' : '') + ' onchange="qrSelKey(this.dataset.k,this.checked)" aria-label="' + h(label) + ' 전체 고르기">' +
      '<button class="ac-t' + (big ? ' big' : '') + '" data-k="' + h(key) + '" aria-expanded="' + open + '" onclick="qrTog(this.dataset.k)">' + chev + '<span class="ac-n">' + h(label) + '</span><span class="cnt">' + cnt + (unp ? ' · <span class="unp">미인쇄 ' + unp + '</span>' : '') + '</span></button></div>';
  };
  if (r) {
    const q = S.q.trim().toLowerCase().replace(/\s+/g, '');
    const items = r.items.filter(i => !q || (i.store + i.name + i.floor).toLowerCase().replace(/\s+/g, '').indexOf(q) !== -1);
    if (!items.length) body = '<div class="banner b-gray">' + (r.items.length ? '검색 결과가 없습니다.' : '등록된 ' + kn + '이(가) 없습니다. [+ 등록]으로 추가하세요.') + '</div>';
    else {
      expandBar = '<div style="display:flex;gap:var(--sp-2);justify-content:flex-end"><button class="btn sm" onclick="qrOpenAll(true)">모두 펼치기</button><button class="btn sm" onclick="qrOpenAll(false)">모두 접기</button></div>';
      body = qrGroups(items).map(g => {
        const fk = [kind, g.fl].join(KSEP), fo = qrIsOpen(fk);
        return '<div class="ac">' + head(fk, g.fl, '위치 ' + g.locs.length + '곳 · ' + kn + ' ' + g.items.length + unit, g.items, true) +
          (fo ? '<div class="ac-b">' + g.locs.map(l => {
            const lk = [kind, g.fl, l.place].join(KSEP), lo = qrIsOpen(lk);
            return '<div class="ac">' + head(lk, l.place, kn + ' ' + l.items.length + unit, l.items, false) +
              (lo ? '<div class="ac-b"><div class="ac-act"><button class="btn sm" data-k="' + h(lk) + '" onclick="qrMore(this.dataset.k)">+ 1' + unit + ' 추가</button><button class="btn sm" data-k="' + h(lk) + '" onclick="qrRenameDlg(this.dataset.k)">이름 고치기</button></div>' + l.items.map(row).join('') + '</div>' : '') + '</div>';
          }).join('') + '</div>' : '') + '</div>';
      }).join('');
    }
  }
  const tabs = '<div class="seg" role="group" aria-label="종류">' + ['fe', 'hyd', 'air'].map(k => '<button class="' + (k === kind ? 'on' : '') + '" aria-pressed="' + (k === kind) + '" onclick="qrTab(\'' + k + '\')">' + QR_KIND[k] + '</button>').join('') + '</div>';
  return topbar('소화기/소화전/공기호흡기 점검 ›', '소화기/소화전/공기호흡기 QR 관리') + '<div class="wrap list">' + tabs +
    '<div class="tools"><input class="inp" type="search" placeholder="위치 · 이름 · 층 검색" aria-label="검색" value="' + h(S.q) + '" oninput="S.q=this.value;S.qrSc={};renderKeepFocus(this)">' +
    '<button class="btn pri" onclick="addDialog()">+ 등록</button>' +
    (CAN_PRINT ? '<button class="btn" onclick="printLabels()" ' + (selN ? '' : 'disabled') + '>' + ICON.print + ' 출력 (' + selN + ')</button>' : '') +
    '<button class="btn warn" onclick="delDialog()" ' + (selN ? '' : 'disabled') + '>삭제 (' + selN + ')</button></div>' +
    (CAN_PRINT ? '' : '<div class="banner b-gray">QR 출력은 PC 화면에서 합니다. 휴대폰에서는 등록과 삭제만 됩니다.</div>') +
    expandBar + body + '</div>';
}
function renderKeepFocus(el) { const pos = el.selectionStart; render(); const n = document.querySelector('.tools .inp'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
function drawQrs() {
  if (typeof QRCode === 'undefined') return;
  document.querySelectorAll('[data-qr]').forEach(el => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    new QRCode(el, { text: qrUrl(el.dataset.qr), width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M });
  });
}
function bigQr(id) {
  const i = S.qr.items.find(x => x.id === id);
  dialog('<div style="display:flex;flex-direction:column;align-items:center;gap:var(--sp-3)"><b style="font-size:var(--size-l)">' + h(i.name) + '</b><small style="color:var(--muted)">' + h(i.floor) + ' · ' + h(i.id) + '</small>' +
    '<div id="bigqr" style="background:var(--white);padding:var(--sp-3)"></div>' +
    '<small style="color:var(--muted);text-align:center">휴대폰 카메라로 이 화면을 찍으면 점검 입력 페이지가 열립니다 (테스트용)</small>' +
    '<a class="btn" href="' + h(qrUrl(i.token)) + '" target="_blank" rel="noopener">입력 페이지 열기</a>' +
    '<button class="btn big pri" style="width:100%" onclick="closeDialog()">닫기</button></div>');
  new QRCode($('bigqr'), { text: qrUrl(i.token), width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
}
function addDialog() {
  const cur = S.qrKind || 'fe';
  const lab = 'display:flex;flex-direction:column;gap:var(--sp-1);font-size:var(--size-s);color:var(--sub);margin-bottom:var(--sp-3)';
  dialog('<h2 style="margin:0 0 var(--sp-3);font-size:var(--size-l)">등록</h2>' +
    '<div style="font-size:var(--size-s);color:var(--sub);margin-bottom:var(--sp-1)">종류 (여러 개 골라도 됩니다)</div>' +
    '<div class="ck" style="margin-bottom:var(--sp-3)">' + ['fe', 'hyd', 'air'].map(k => '<label class="ckl' + (k === cur ? ' on' : '') + '"><input type="checkbox" id="ak_' + k + '"' + (k === cur ? ' checked' : '') + ' onchange="addPre()">' + QR_KIND[k] + '</label>').join('') + '</div>' +
    '<label style="' + lab + '">층<select id="aFloor" class="inp">' + FLOORS.map(f => '<option' + (f === S.floor ? ' selected' : '') + '>' + f + '</option>').join('') + '</select></label>' +
    '<label style="' + lab + '">위치<input id="aStore" class="inp" maxlength="30" placeholder="예: 동측 계단 앞" oninput="addPre()"></label>' +
    '<label style="' + lab + ';margin-bottom:var(--sp-2)">몇 대를 추가할까요? (종류마다 같은 대수)<input id="aCount" class="inp" type="number" min="1" max="20" value="1" inputmode="numeric" oninput="addPre()"></label>' +
    '<small style="color:var(--muted)">이름은 「위치-소화기1」처럼 이어서 붙습니다. 같은 위치에 이미 있으면 번호가 이어집니다.</small>' +
    '<div id="aPre" class="pre" style="margin-top:var(--sp-2)"></div>' +
    '<div id="aMsg" role="alert" style="color:var(--red);font-size:var(--size-s);min-height:18px;margin-top:var(--sp-1)"></div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="aBtn" class="btn big pri" style="flex:2" onclick="doAdd()">등록하고 QR 만들기</button></div>');
  addPre();
}
function addPre() {
  const ks = ['fe', 'hyd', 'air'];
  ks.forEach(k => { const c = $('ak_' + k); if (c && c.parentNode) c.parentNode.classList.toggle('on', c.checked); });
  const place = ($('aStore').value || '').trim().replace(/\s+/g, ' ') || '위치', n = Math.max(1, Math.min(20, Math.floor(Number($('aCount').value)) || 1));
  const lines = ks.filter(k => $('ak_' + k).checked).map(k => place + '-' + QR_KIND[k] + '1' + (n > 1 ? ' ~ ' + place + '-' + QR_KIND[k] + n : ''));
  $('aPre').innerHTML = lines.length ? '<b>만들어지는 이름</b><br>' + lines.map(h).join('<br>') : '<span style="color:var(--muted)">종류를 하나 이상 골라 주세요.</span>';
}
async function doAdd() {
  const kinds = ['fe', 'hyd', 'air'].filter(k => $('ak_' + k).checked), msg = $('aMsg');
  if (!kinds.length) { msg.textContent = '종류를 하나 이상 골라 주세요.'; return; }
  const floor = $('aFloor').value, place = $('aStore').value, count = $('aCount').value;
  $('aBtn').disabled = true; $('aBtn').innerHTML = '<span class="spin"></span>';
  const done = {};
  let err = '';
  for (const k of kinds) {   // 종류마다 차례로 (소화기는 fire_ext, 소화전·공기호흡기는 fire_equip)
    try {
      const r = k === 'fe' ? await call('feAdd', { floor, store: place, count }) : await call('eqAdd', { kind: k, floor, place, count });
      if (!r.ok) { err = QR_KIND[k] + ': ' + r.error; break; }
      done[k] = r.added;
    } catch (e) { err = QR_KIND[k] + ': 서버에 연결하지 못했습니다.'; break; }
  }
  const ok = Object.keys(done);
  if (err) {   // 일부만 됐으면 된 종류는 체크를 풀어 다시 만들지 않게
    ok.forEach(k => { const c = $('ak_' + k); if (c) c.checked = false; });
    addPre();
    msg.textContent = (ok.length ? ok.map(k => QR_KIND[k]).join('·') + '은(는) 등록했습니다. ' : '') + err;
    $('aBtn').disabled = false; $('aBtn').textContent = '등록하고 QR 만들기';
  } else closeDialog();
  if (ok.length) afterAdd(done, floor);
}
function afterAdd(done, floor) {
  const cur = S.qrKind || 'fe', ks = Object.keys(done), target = ks.indexOf(cur) !== -1 ? cur : ks[0];
  S.floor = floor;
  // 한 종류만이고 3개 이하면 이름을 그대로, 아니면 종류별 개수
  toast((ks.length === 1 && done[ks[0]].length <= 3 ? done[ks[0]].join(', ') : ks.map(k => QR_KIND[k] + ' ' + done[k].length + (k === 'fe' ? '대' : '개')).join(' · ')) + ' 등록');
  if (target !== cur) { S.qrKind = target; S.qr = null; S.q = ''; S.qrSc = {}; }
  S.qrNew = done[target]; S.sel = {};
  render(); loadQr();
}
/** 위치 아코디언의 [+ 1대 추가]: 같은 층·위치에 한 대 더 (이름 번호는 이어서) */
async function qrMore(key) {
  const p = key.split(KSEP), k = p[0], floor = p[1], place = p[2];
  try {
    const r = k === 'fe' ? await call('feAdd', { floor, store: place, count: 1 }) : await call('eqAdd', { kind: k, floor, place, count: 1 });
    if (!r.ok) { toast(r.error); return; }
    toast(r.added.join(', ') + ' 등록'); S.qrNew = r.added; loadQr();
  } catch (e) { /* call()이 알림을 띄움 */ }
}
function qrRenameDlg(key) {
  const p = key.split(KSEP);
  S.rn = { key, k: p[0], fl: p[1], place: p[2] };
  dialog('<h2 style="margin:0 0 var(--sp-2);font-size:var(--size-l)">위치 이름 고치기</h2><p style="margin:0 0 var(--sp-3);font-size:var(--size-m)">' + h(p[1]) + ' · ' + h(p[2]) + ' <span style="color:var(--muted)">(' + QR_KIND[p[0]] + ')</span></p>' +
    '<label style="display:flex;flex-direction:column;gap:var(--sp-1);font-size:var(--size-s);color:var(--sub);margin-bottom:var(--sp-2)">새 위치 이름<input id="rnNew" class="inp" maxlength="30" value="' + h(p[2]) + '" onkeydown="if(event.key===\'Enter\')doRename()"></label>' +
    '<small style="color:var(--muted)">이 위치 것의 이름이 「새이름-' + QR_KIND[p[0]] + '1」처럼 한꺼번에 바뀝니다. 붙여 둔 QR은 그대로 쓸 수 있습니다.</small>' +
    '<div id="rnMsg" role="alert" style="color:var(--red);font-size:var(--size-s);min-height:18px;margin-top:var(--sp-1)"></div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="rnBtn" class="btn big pri" style="flex:2" onclick="doRename()">이름 고치기</button></div>');
  setTimeout(() => { const e = $('rnNew'); if (e) { e.focus(); e.select(); } }, 50);
}
async function doRename() {
  const R = S.rn, nv = $('rnNew').value;
  $('rnBtn').disabled = true;
  try {
    const r = await call('qrRename', R.k, R.fl, R.place, nv);
    if (!r.ok) { $('rnMsg').textContent = r.error; $('rnBtn').disabled = false; return; }
    const nk = [R.k, R.fl, nv.trim().replace(/\s+/g, ' ')].join(KSEP);
    if (S.qrOpen[R.key] !== undefined) { S.qrOpen[nk] = S.qrOpen[R.key]; delete S.qrOpen[R.key]; }   // 열어 둔 상태를 새 이름으로 옮김
    closeDialog(); toast(r.count + (R.k === 'fe' ? '대' : '개') + ' 이름을 고쳤습니다');
    if ((S.qrKind || 'fe') === R.k) { S.qr = r; S.sel = {}; render(); }
  } catch (e) { $('rnBtn').disabled = false; }
}
function delDialog() {
  const kind = S.qrKind || 'fe', kn = QR_KIND[kind], ids = Object.keys(S.sel).filter(k => S.sel[k]);
  const names = S.qr.items.filter(i => ids.indexOf(i.id) !== -1).map(i => i.name);
  dialog('<h2 style="margin:0 0 var(--sp-2);font-size:var(--size-l)">' + kn + ' ' + ids.length + (kind === 'fe' ? '대' : '개') + ' 삭제</h2><p style="margin:0 0 var(--sp-2);font-size:var(--size-m);line-height:1.6">' + names.map(h).join('<br>') + '</p>' +
    '<p style="margin:0 0 var(--sp-3);font-size:var(--size-s);color:var(--muted)">목록과 현황에서 빠지고, 붙어 있는 QR을 찍으면 「삭제된 QR」로 나옵니다. 지난달까지의 점검 기록은 남습니다.</p>' +
    '<div style="display:flex;gap:var(--sp-2)"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="dBtn" class="btn big warn" style="flex:2" onclick="doDel()">삭제</button></div>');
}
async function doDel() {
  const kind = S.qrKind || 'fe', ids = Object.keys(S.sel).filter(k => S.sel[k]);
  $('dBtn').disabled = true;
  try { const r = kind === 'fe' ? await call('feDelete', ids) : await call('eqDelete', ids, kind); closeDialog(); toast(r.count + (kind === 'fe' ? '대' : '개') + ' 삭제'); S.qr = r; S.sel = {}; render(); } catch (e) { $('dBtn').disabled = false; }
}
const LABEL_PRESETS = [[50, 50], [40, 40], [30, 34], [50, 30]];
// 라벨 프린터: BIXOLON SLP-TX400 (203dpi = 8점/mm). QR 한 칸이 프린터 점(dot) 정수 배가 되게 그려 흐림 없이 찍히게 함
function labelDpi() { return (S.qr && S.qr.label && Number(S.qr.label.dpi)) || (S.eh && Number(S.eh.dpi)) || 203; }
function qrMatrix(token, text, level) {   // text·level: 전열필증은 ?eh= 주소, 작은 칸이라 오류 보정 L (칸 수가 적어 점이 굵음)
  text = text || qrUrl(token);
  S.qrm = S.qrm || {};
  if (S.qrm[text]) return S.qrm[text];
  const tmp = document.createElement('div');
  const q = new QRCode(tmp, { text: text, width: 64, height: 64, correctLevel: QRCode.CorrectLevel[level || 'M'] });
  const m = q._oQRCode, n = m.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(m.isDark(r, c)); rows.push(row); }
  return (S.qrm[text] = rows);
}
// 원하는 크기(mm) 안에서 가장 큰 「점 정수 배」 QR 그림 → {src, mm}
function qrImage(token, maxMm, text, level) {
  const rows = qrMatrix(token, text, level), n = rows.length, quiet = 2, total = n + quiet * 2, dpi = labelDpi();
  const dots = Math.floor(maxMm / 25.4 * dpi);
  const per = Math.max(1, Math.floor(dots / total));
  const scale = 4, cv = document.createElement('canvas');   // 화면 미리보기도 또렷하게 4배로 그림
  cv.width = cv.height = per * total * scale;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
  const u = per * scale;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (rows[r][c]) g.fillRect((c + quiet) * u, (r + quiet) * u, u, u);
  return { src: cv.toDataURL('image/png'), mm: +(per * total / dpi * 25.4).toFixed(3) };
}
function labelHtml(i, L) {
  // 위: 소화기 이름 한 줄(작은 글자) / 아래: QR — 50×50 정사각형 라벨 기준
  const pad = 1.5, gap = 0.8, textMm = 2.8;
  const maxMm = Math.max(10, Math.min(L.w - pad * 2, L.h - pad * 2 - gap - textMm));
  const q = qrImage(i.token, maxMm);
  const name = i.label || (i.store + ' 소화기' + i.no);   // 소화전·공기호흡기는 「3F 동측 계단 앞 소화전」 통째로
  // 글자 수에 맞춰 크기 자동 (최대 7pt, 최소 4.5pt) — 1pt ≈ 0.353mm, 한글 1자 ≈ 1em
  const units = Array.from(name).reduce((n, c) => n + (/[\x00-\x7F]/.test(c) ? 0.55 : 1), 0);
  const pt = Math.max(4.5, Math.min(7, (L.w - pad * 2) / Math.max(units, 1) / 0.353));
  return '<div class="label" style="width:' + L.w + 'mm;height:' + L.h + 'mm"><b style="font-size:' + pt.toFixed(1) + 'pt">' + h(name) + '</b><img src="' + q.src + '" style="width:' + q.mm + 'mm;height:' + q.mm + 'mm" alt=""></div>';
}
// 출력 → 먼저 미리보기 (크기 바꾸기) → 인쇄
function printLabels() {
  const ids = Object.keys(S.sel).filter(k => S.sel[k]);
  S.pv = { items: S.qr.items.filter(i => ids.indexOf(i.id) !== -1), L: { w: S.qr.label.w, h: S.qr.label.h } };
  renderPreview();
}
function renderPreview() {
  const P = S.pv, L = P.L, show = P.items.slice(0, 6);
  dialog('<div style="display:flex;align-items:center;margin-bottom:var(--sp-2)"><div class="fname"><b style="font-size:var(--size-l)">라벨 미리보기</b><small>' + P.items.length + '장 · ' + L.w + '×' + L.h + 'mm (실제 크기) · ' + labelDpi() + 'dpi</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="pvbox">' + show.map(i => labelHtml(i, L)).join('') + (P.items.length > show.length ? '<span class="pvmore">외 ' + (P.items.length - show.length) + '장</span>' : '') + '</div>' +
    '<div style="font-size:var(--size-s);color:var(--sub);margin:var(--sp-3) 0 var(--sp-1)">라벨 크기 (가로 × 세로 mm)</div>' +
    '<div class="pvpre">' + LABEL_PRESETS.map(p => '<button class="btn sm' + (p[0] === L.w && p[1] === L.h ? ' pri' : '') + '" onclick="pvSize(' + p[0] + ',' + p[1] + ')">' + p[0] + '×' + p[1] + (p[0] === 50 && p[1] === 50 ? ' (지금 라벨)' : '') + '</button>').join('') + '</div>' +
    '<div style="display:flex;gap:var(--sp-2);align-items:center;margin-top:var(--sp-2)"><input id="pvW" class="inp" type="number" min="15" max="100" step="0.5" value="' + L.w + '" aria-label="가로 mm" style="width:90px"><span>×</span><input id="pvH" class="inp" type="number" min="15" max="100" step="0.5" value="' + L.h + '" aria-label="세로 mm" style="width:90px"><button class="btn sm" onclick="pvSize($(\'pvW\').value,$(\'pvH\').value)">적용</button></div>' +
    '<details class="pvhelp"><summary>BIXOLON SLP-TX400 인쇄 설정</summary><ol>' +
      '<li>인쇄 창 <b>대상</b>: BIXOLON SLP-TX400</li>' +
      '<li><b>용지 크기</b>: ' + L.w + '×' + L.h + 'mm (없으면 아래 「드라이버에 용지 만들기」 한 번)</li>' +
      '<li><b>여백</b>: 없음 · <b>배율</b>: 기본(100%) · <b>머리글/바닥글</b>: 끔 · <b>배경 그래픽</b>: 켬</li>' +
      '<li>드라이버에 용지 만들기: Windows 설정 → 프린터 → SLP-TX400 → 인쇄 기본 설정 → 용지 <b>새로 만들기</b> → 가로 ' + L.w + ' · 세로 ' + L.h + 'mm, 여백 0 → 용지 종류 <b>갭(Gap, 라벨 사이 틈)</b></li>' +
      '<li>처음 한 번, 또는 라벨지를 바꾼 뒤 프린터 <b>FEED</b> 버튼으로 라벨 위치를 맞춥니다(캘리브레이션)</li></ol></details>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3)"><button class="btn" onclick="closeDialog()">닫기</button><button class="btn" style="flex:1" onclick="doPrint(true)">1장 시험 인쇄</button><button id="pvGo" class="btn pri" style="flex:2" onclick="doPrint()">' + ICON.print + ' 인쇄 (' + P.items.length + '장)</button></div>');
}
function pvSize(w, hh) {
  w = Number(w); hh = Number(hh);
  if (!(w >= 15 && w <= 100 && hh >= 15 && hh <= 100)) { toast('라벨 크기는 15~100mm 사이로 넣어 주세요.'); return; }
  S.pv.L = { w: w, h: hh }; renderPreview();
}
function doPrint(one) {
  const P = S.pv, L = P.L, list = one ? P.items.slice(0, 1) : P.items;
  const box = $('print');
  box.innerHTML = '<style>@page{size:' + L.w + 'mm ' + L.h + 'mm;margin:0}</style>' + list.map(i => labelHtml(i, L)).join('');
  if (L.w !== S.qr.label.w || L.h !== S.qr.label.h) {
    S.qr.label = Object.assign({}, S.qr.label, { w: L.w, h: L.h });
    run('labelSave', S.token, L.w, L.h).then(r => { if (r && !r.ok) toast(r.error); }, () => toast('라벨 크기를 저장하지 못했습니다. 인쇄는 그대로 됩니다.'));   // run = 구글·Supabase 둘 다
  }
  closeDialog();
  if (!one) qrMarkPrinted(list.map(i => i.id));
  setTimeout(() => window.print(), 300);
}
/** 인쇄한 라벨은 「미인쇄」 딱지를 뗌 (서버에도 기록, 시험 인쇄 1장은 제외, 실패해도 인쇄는 그대로) */
function qrMarkPrinted(ids) {
  const k = S.qrKind || 'fe';
  S.qr.items.forEach(i => { if (ids.indexOf(i.id) !== -1 && i.printed === false) i.printed = true; });
  run('qrPrinted', S.token, k, ids).catch(() => {});
  render();
}

/* ── ② 점검 현황 ── */
async function openStatus(ym) { go('status'); await loadStatus(ym || ''); }
async function loadStatus(ym) { S.st = null; render(); S.st = await call('feStatus', ym); S.ym = S.st.ym; render(); }
/* 현황 화면을 열어 두면 1분마다 조용히 다시 읽음 — 휴대폰에서 보낸 점검이 곧 녹색으로 (결정 54) */
let stBusy = false;
async function quietStatus() {
  if (stBusy || !S.st || ['status', 'floor'].indexOf(S.view) === -1 || document.hidden) return;
  stBusy = true;
  try {
    const r = await run('feStatus', S.token, S.st.ym);
    if (r && r.ok && S.st && r.ym === S.st.ym && ['status', 'floor'].indexOf(S.view) !== -1 && !document.querySelector('.dialog-back')) { S.st = r; render(); }
  } catch (e) { /* 다음 번에 다시 */ } finally { stBusy = false; }
}
setInterval(quietStatus, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) quietStatus(); });
function counts(items) { const c = { ok: 0, bad: 0, wait: 0, miss: 0, total: items.length }; items.forEach(i => c[i.state]++); return c; }
function renderStatus() {
  const st = S.st;
  if (!st) return topbar('소화기/소화전/공기호흡기 점검 ›', '월별 점검 현황') + '<div class="wrap"><div class="banner b-gray">불러오는 중…</div></div>';
  const c = st.counts;
  const idx = st.months.indexOf(st.ym);
  const prev = idx > 0 ? st.months[idx - 1] : '';
  const next = idx >= 0 && idx < st.months.length - 1 ? st.months[idx + 1] : '';
  const floors = FLOORS.map(fl => {
    const it = st.items.filter(i => i.floor === fl);
    if (!it.length) return '';
    const fc = counts(it);
    const p = n => Math.round(n / fc.total * 100) + '%';
    const storesN = new Set(it.map(i => i.store)).size;
    return '<button class="floor" onclick="openFloor(\'' + fl + '\')"><span class="elbow"></span><b style="min-width:34px;font-size:var(--size-m)">' + fl + '</b>' +
      '<span class="fname" style="gap:var(--sp-1)"><span class="bar"><span style="width:' + p(fc.ok) + ';background:var(--green)"></span><span style="width:' + p(fc.bad) + ';background:var(--orange)"></span><span style="width:' + p(fc.miss) + ';background:var(--navy)"></span></span><small>매장 ' + storesN + ' · 소화기 ' + fc.total + '대</small></span>' +
      (fc.miss ? '<span class="chip c-miss">미입력 ' + fc.miss + '</span>' : '') + (fc.bad ? '<span class="chip c-bad">이상 ' + fc.bad + '</span>' : '') +
      '<b style="font-size:var(--size-s);color:var(--green)">' + (fc.ok + fc.bad) + '/' + fc.total + '</b>' + ICON.chev + '</button>';
  }).join('');
  return topbar('소화기/소화전/공기호흡기 점검 ›', '월별 점검 현황') + '<div class="wrap list">' +
    '<div class="mnav"><button class="btn" aria-label="이전 달" ' + (prev ? 'onclick="loadStatus(\'' + prev + '\')"' : 'disabled') + '>‹</button><div><b style="font-size:var(--size-l)">' + ymLabel(st.ym) + '</b><small style="color:var(--muted)">입력 기간 ' + Number(st.ym.slice(5, 7)) + '/' + st.window.start + ' ~ ' + Number(st.ym.slice(5, 7)) + '/' + st.window.end + '</small></div><button class="btn" aria-label="다음 달" ' + (next ? 'onclick="loadStatus(\'' + next + '\')"' : 'disabled') + '>›</button></div>' +
    xlBtns('') +
    periodBanner(st, c) +
    '<div class="card legend"><span><span class="dot" style="background:var(--green)"></span>점검완료 <b>' + c.ok + '</b></span><span><span class="dot" style="background:var(--orange)"></span>이상 있음 <b>' + c.bad + '</b></span><span><span class="dot" style="background:var(--line)"></span>점검 전 <b>' + c.wait + '</b></span><span><span class="dot" style="background:var(--navy)"></span>미입력 <b>' + c.miss + '</b></span></div>' +
    '<div class="card tree"><div class="tree-root">' + ymLabel(st.ym) + ' · 전체 ' + c.total + '대</div>' + (floors || '<div style="padding:var(--sp-3) 0;color:var(--muted);font-size:var(--size-m)">이 달에 등록된 소화기가 없습니다.</div>') + '</div>' +
    '<button class="btn" onclick="loadStatus(\'' + st.ym + '\')">새로고침</button></div>';
}
/* ── 매장별 소화기 수량 엑셀 올리기·내려받기 (결정 244) — 시트 이름 = 층, 칸 = NO · 브랜드명 · 소화기 개수.
   올리면 미리보기 뒤 부족한 만큼만 QR 소화기를 새로 등록(feAdd). 많은 것은 지우지 않고 「초과」로만 표시 */
function xlBtns(fl) {
  return '<div style="display:flex;gap:var(--sp-2)"><label class="btn" style="flex:1;min-height:52px;position:relative">' + ICON.clip + ' ' + (fl ? fl + ' ' : '') + '엑셀 올리기<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange="xlFile(this,\'' + (fl || '') + '\')" style="position:absolute;width:1px;height:1px;opacity:0"></label>' +
    '<button class="btn" style="flex:1;min-height:52px" onclick="xlDown(\'' + (fl || '') + '\')">⬇ ' + (fl ? fl + ' ' : '') + '엑셀 내려받기</button></div>';
}
function xlFloor(n) { const s = String(n).trim().toUpperCase().replace(/층$/, ''), m = /^(B[1-3])F?$|^(10|[1-9])F$/.exec(s); return m ? (m[1] || m[2] + 'F') : (s === 'POPUP' || s === '팝업' ? 'POPUP' : ''); }
const xlKey = s => String(s).replace(/\s+/g, '');
/** 시트 표(줄×칸 글자) → [{store, n}] — 「브랜드명」·「개수」 제목 줄이 있으면 그 칸, 없으면 2·3번째 칸. 「계」 줄·수량 없는 줄은 건너뜀 */
function xlRows(aoa) {
  const c = v => String(v == null ? '' : v).trim();
  let hr = -1, cs = 1, cn = 2;
  for (let r = 0; r < Math.min(aoa.length, 10); r++) { const row = aoa[r] || [], a = row.findIndex(v => /브랜드|매장|위치/.test(c(v))), b = row.findIndex(v => /개수|수량|대수/.test(c(v))); if (a >= 0 && b >= 0) { hr = r; cs = a; cn = b; break; } }
  const out = {}, order = [];
  for (let r = hr + 1; r < aoa.length; r++) {
    const row = aoa[r] || [], s = c(row[cs]).replace(/\s+/g, ' ').slice(0, 30), n = parseInt(c(row[cn]).replace(/,/g, ''), 10);
    if (!s || /^(합?계|total)$/i.test(s) || !(n > 0)) continue;
    if (!out[xlKey(s)]) { out[xlKey(s)] = { store: s, n: 0 }; order.push(xlKey(s)); }
    out[xlKey(s)].n += n;
  }
  return order.map(k => out[k]);
}
async function xlFile(el, only) {
  const f = el.files && el.files[0]; el.value = ''; if (!f) return;
  dialog('<div style="display:flex;justify-content:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue);width:28px;height:28px"></span></div>');
  try {
    await loadXlsx();
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }), sheets = [], tbl = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
    wb.SheetNames.forEach(n => { const fl = xlFloor(n); if (fl && (!only || fl === only)) sheets.push([fl, tbl(n)]); });
    if (!sheets.length && wb.SheetNames.length === 1) {   // 시트 이름이 층이 아니면 파일 이름(예: 「5F 소화기 현황.xlsx」)에서 층을 찾음
      const m = /(B[1-3]|10F|[1-9]F|POPUP|팝업)/i.exec(f.name), fl = m ? xlFloor(m[1]) : '';
      if (fl && (!only || fl === only)) sheets.push([fl, tbl(wb.SheetNames[0])]);
    }
    if (!sheets.length) { dialog('<h2 style="margin:0 0 var(--sp-2);font-size:var(--size-l)">엑셀 올리기</h2><div class="banner b-red">' + (only ? only + ' 시트를 찾지 못했습니다. 시트 이름을 「' + only + '」로 해 주세요.' : '층 이름(B3~10F)으로 된 시트를 찾지 못했습니다. 시트 이름을 「5F」처럼 층으로 해 주세요.') + '</div><div style="margin-top:var(--sp-3)"><button class="btn big" style="width:100%" onclick="closeDialog()">닫기</button></div>'); return; }
    const cur = await call('feList'), plan = [];
    sheets.forEach(([fl, aoa]) => xlRows(aoa).forEach(x => {
      const have = cur.items.filter(i => i.floor === fl && xlKey(i.store) === xlKey(x.store));
      plan.push({ floor: fl, store: have.length ? have[0].store : x.store, xl: x.n, cur: have.length, isNew: !have.length });
    }));
    plan.sort((a, b) => FLOORS.indexOf(a.floor) - FLOORS.indexOf(b.floor));
    S.xlPlan = plan; S.xlName = f.name;
    xlPreview();
  } catch (e) { closeDialog(); toast(e && e.message ? e.message : '엑셀을 읽지 못했습니다'); }
}
function xlPreview() {
  const plan = S.xlPlan, add = plan.reduce((s, p) => s + Math.max(p.xl - p.cur, 0), 0), over = plan.filter(p => p.cur > p.xl).length, same = plan.filter(p => p.cur === p.xl).length;
  const fls = [...new Set(plan.map(p => p.floor))];
  let rows = '';
  fls.forEach(fl => {
    if (fls.length > 1) rows += '<tr><td colspan="4" style="padding:8px 4px 4px;font-weight:700;color:var(--navy)">' + fl + '</td></tr>';
    plan.filter(p => p.floor === fl).forEach(p => {
      const d = p.xl - p.cur, tag = d > 0 ? '<span class="chip blue">+' + d + ' 등록</span>' : d < 0 ? '<span class="chip c-miss">' + -d + '대 초과</span>' : '<span class="chip green">그대로</span>';
      rows += '<tr style="border-top:1px solid var(--line)"><td style="padding:6px 4px"><b>' + h(p.store) + '</b>' + (p.isNew ? ' <span class="chip blue" style="height:20px">새 매장</span>' : '') + '</td><td style="padding:6px 4px;text-align:right">' + p.xl + '대</td><td style="padding:6px 4px;text-align:right">' + p.cur + '대</td><td style="padding:6px 0 6px 6px;text-align:right">' + tag + '</td></tr>';
    });
  });
  dialog('<h2 style="margin:0 0 var(--sp-1);font-size:var(--size-l)">엑셀 올리기 — ' + fls.join(' · ') + '</h2>' +
    '<small style="color:var(--muted)">「' + h(S.xlName) + '」 · ' + plan.length + '개 매장 · 합계 ' + plan.reduce((s, p) => s + p.xl, 0) + '대</small>' +
    '<div class="banner b-gray" style="margin:var(--sp-2) 0">아직 저장하지 않았습니다. [등록하기]를 누르면 <b>부족한 소화기만 새로 등록</b>됩니다. 이미 등록된 소화기는 그대로입니다.</div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2);flex-wrap:wrap"><span class="chip blue">새로 등록 +' + add + '대</span><span class="chip blue">그대로 ' + same + '매장</span>' + (over ? '<span class="chip c-miss">확인 필요 ' + over + '매장</span>' : '') + '</div>' +
    '<div style="max-height:300px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:var(--size-m)"><thead><tr style="color:var(--muted);font-size:var(--size-s);text-align:left"><th style="padding:4px">매장</th><th style="padding:4px;text-align:right">엑셀</th><th style="padding:4px;text-align:right">지금</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<small style="display:block;margin:var(--sp-2) 0;color:var(--muted)">초과한 소화기는 자동으로 지우지 않습니다. 「QR 관리」에서 직접 지워 주세요. 엑셀에 없는 매장도 그대로 둡니다.</small>' +
    '<div style="display:flex;gap:var(--sp-2)"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="xlGo" class="btn big pri" style="flex:2" ' + (add ? '' : 'disabled ') + 'onclick="xlSave()">' + (add ? '등록하기 (+' + add + '대)' : '등록할 것 없음') + '</button></div>');
}
async function xlSave() {
  const todo = S.xlPlan.filter(p => p.xl > p.cur), b = $('xlGo');
  if (b) b.disabled = true;
  let done = 0;
  try {
    for (const p of todo) {
      for (let left = p.xl - p.cur; left > 0; left -= 20) {   // 한 번에 20대까지
        if (b) b.textContent = '등록 중… ' + done + '대';
        const r = await call('feAdd', { floor: p.floor, store: p.store, count: Math.min(left, 20) });
        if (!r.ok) throw new Error(r.error || '등록하지 못했습니다');
        done += Math.min(left, 20);
      }
    }
    closeDialog(); toast('소화기 ' + done + '대를 등록했습니다');
  } catch (e) { closeDialog(); toast((done ? done + '대까지 등록했고 ' : '') + (e && e.message ? e.message : '중간에 멈췄습니다') + ' — 같은 파일을 다시 올리면 남은 것만 등록합니다'); }
  S.xlPlan = null;
  await stRefresh();
}
async function xlDown(fl) {
  try {
    await loadXlsx();
    const r = await call('feList'), wb = XLSX.utils.book_new();
    (fl ? [fl] : FLOORS.filter(f => r.items.some(i => i.floor === f))).forEach(f => {
      const by = {}; r.items.filter(i => i.floor === f).forEach(i => { by[i.store] = (by[i.store] || 0) + 1; });
      const aoa = [[], ['NO.', '브랜드명', '소화기 개수']]; Object.keys(by).forEach((s, k) => aoa.push([k + 1, s, by[s]]));
      aoa.push(['', '계', { t: 'n', f: 'SUM(C3:C' + aoa.length + ')', v: Object.values(by).reduce((a, b) => a + b, 0) }]);
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, f);
    });
    if (!wb.SheetNames.length) { toast((fl ? fl + '에 ' : '') + '등록된 소화기가 없습니다'); return; }
    XLSX.writeFile(wb, '소화기 현황_' + (fl || '전체') + '.xlsx');
  } catch (e) { toast(e && e.message ? e.message : '엑셀을 만들지 못했습니다'); }
}
/* ── 층 화면에서 소화기 삭제 (결정 250) — QR 관리와 같은 feDelete. 점검 기록은 남고 지운 달부터 목록에서 빠짐 ── */
async function stRefresh() { if (!S.st) return; const r = await call('feStatus', S.st.ym); if (r && r.ok) { S.st = r; render(); } }
function fdelOn() { S.fdel = true; S.fsel = {}; render(); }
function fdelOff() { S.fdel = false; S.fsel = {}; render(); }
function fdelIds() { return Object.keys(S.fsel || {}).filter(k => S.fsel[k]); }
function fdelPick(id) { S.fsel[id] = !S.fsel[id]; render(); }
function fdelStore(i) {
  const list = S.st.items.filter(x => x.floor === S.floor && x.store === S.fdelStores[i]), all = list.every(x => S.fsel[x.id]);
  list.forEach(x => { S.fsel[x.id] = !all; }); render();
}
function fdelAsk() {
  const ids = fdelIds(), pick = S.st.items.filter(i => S.fsel[i.id]), has = pick.filter(i => i.checkId).length;
  if (!ids.length) return;
  dialog('<h2 style="margin:0 0 var(--sp-2);font-size:var(--size-l)">소화기 ' + ids.length + '대 삭제</h2>' +
    '<div style="max-height:200px;overflow:auto;margin-bottom:var(--sp-2)">' + pick.map(i => '<div style="padding:4px 0;border-top:1px solid var(--line)"><b>' + h(i.name) + '</b></div>').join('') + '</div>' +
    '<div class="banner b-gray">삭제하면 이번 달 점검 목록에서 바로 빠지고, 지난달까지의 점검 기록은 그대로 남습니다.' + (has ? ' 이번 달 점검을 이미 입력한 <b>' + has + '대</b>도 지워집니다.' : '') + ' QR 라벨은 쓸 수 없게 됩니다.</div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3)"><button class="btn big" style="flex:1" onclick="closeDialog()">취소</button><button id="fdBtn" class="btn big pri" style="flex:2" onclick="fdelGo()">삭제</button></div>');
}
async function fdelGo() {
  const ids = fdelIds(), b = $('fdBtn'); if (b) b.disabled = true;
  try {
    const r = await call('feDelete', ids);
    if (!r || !r.ok) throw new Error((r && r.error) || '삭제하지 못했습니다');
    closeDialog(); toast('소화기 ' + r.count + '대를 삭제했습니다'); S.fdel = false; S.fsel = {};
    await stRefresh();
  } catch (e) { if (b) b.disabled = false; toast(e && e.message ? e.message : '삭제하지 못했습니다'); }
}
function openFloor(fl) { S.fdel = false; S.fsel = {}; S.floor = fl; go('floor'); }
function renderFloor() {
  const st = S.st;
  const it = st.items.filter(i => i.floor === S.floor);
  const stores = [...new Set(it.map(i => i.store))];
  const chips = FLOORS.map(f => '<button class="fl' + (f === S.floor ? ' on' : '') + '" aria-pressed="' + (f === S.floor) + '" onclick="S.floor=\'' + f + '\';S.fsel={};render()">' + f + '</button>').join('');
  const m = Number(st.ym.slice(5, 7)), del = !!S.fdel, sel = S.fsel || {};
  S.fdelStores = stores;
  const body = stores.length ? stores.map((s, si) => {
    const list = it.filter(i => i.store === s);
    const done = list.filter(i => i.state === 'ok' || i.state === 'bad').length;
    return '<div class="store"><div class="store-h"><b>' + h(s) + '</b>' + (del ? '<button class="btn sm" onclick="fdelStore(' + si + ')">' + (list.every(x => sel[x.id]) ? '전체 해제' : '전체 선택') + '</button>' : '<small style="color:var(--muted)">' + done + ' / ' + list.length + '</small>') + '</div>' +
      list.map(i => {
        const has = i.state === 'ok' || i.state === 'bad';
        const sub = has ? i.at + ' 입력' + (i.late ? ' · 기한 후' : '') : (i.state === 'miss' ? m + '월 ' + st.window.end + '일까지 입력 없음' : m + '월 ' + st.window.end + '일까지 입력 받는 중');
        if (del) return '<button class="feb" aria-pressed="' + !!sel[i.id] + '" onclick="fdelPick(\'' + i.id + '\')"><span style="font-size:22px;width:28px">' + (sel[i.id] ? '☑' : '☐') + '</span><span class="fname"><b>' + h(i.name) + '</b><small>' + h(has ? '이번 달 점검 입력 있음' : sub) + '</small></span></button>';
        return '<button class="feb" ' + (has ? 'onclick="detail(\'' + i.checkId + '\')"' : 'disabled') + '><span class="fname"><b>' + h(i.name) + '</b><small>' + h(sub) + '</small></span>' +
          (i.late ? '<span class="chip c-wait">기한 후</span>' : '') + '<span class="chip ' + STATE[i.state][1] + '">' + STATE[i.state][0] + '</span></button>';
      }).join('') + '</div>';
  }).join('') : '<div class="banner b-gray">' + S.floor + '에 등록된 소화기가 없습니다.</div>';
  return topbar('월별 점검 현황 › ' + ymLabel(st.ym) + ' ›', S.floor + ' · 소화기 ' + it.length + '대') + '<div class="wrap list">' +
    '<div style="display:flex;gap:var(--sp-1);overflow-x:auto;padding-bottom:var(--sp-1)">' + chips + '</div>' + (del ? '<div class="banner b-gray">지울 소화기를 눌러 고르세요 (매장 이름 옆 [전체 선택]으로 한 매장 모두 선택)</div><div style="display:flex;gap:var(--sp-2)"><button class="btn big" style="flex:1" onclick="fdelOff()">취소</button><button class="btn big pri" style="flex:2" ' + (fdelIds().length ? '' : 'disabled ') + 'onclick="fdelAsk()">선택 ' + fdelIds().length + '대 삭제</button></div>' : xlBtns(S.floor) + (it.length ? '<button class="btn" style="min-height:52px" onclick="fdelOn()">소화기 삭제</button>' : '')) + body +
    '<small style="text-align:center;color:var(--muted)">점검완료 · 이상 있음을 누르면 매장에서 입력한 내용을 봅니다</small></div>';
}
/* 점검 내용 팝업 (②·③ 공통, 결정 290): 제목 줄 · 내용(스크롤) · 아래 [점검 기록 삭제] [닫기]. 앱은 로그인한 직원만 쓰고, 서버도 로그인 표 없으면 거절 */
function detSheet(r, body, kind, id) {
  S.det = { kind, id, name: r.name, ym: r.ym, by: r.by || '', at: r.at };
  dialog('<div class="dh"><div class="fname"><b style="font-size:var(--size-l)">' + h(r.name) + '</b><small>' + h(r.floor) + (r.by ? ' · 점검자 ' + h(r.by) : '') + ' · ' + h(r.at) + ' 입력' + (r.late ? ' · 기한 후' : '') + '</small></div><button class="back" onclick="closeDialog()" aria-label="닫기">✕</button></div>' +
    '<div class="db">' + body + '</div>' +
    '<div class="df"><button class="btn big del" style="flex:1" onclick="detDelAsk()">점검 기록 삭제</button><button class="btn big pri" style="flex:1" onclick="closeDialog()">닫기</button></div>');
  document.querySelector('#layer .dialog').classList.add('dsheet');
}
function detDelAsk() {
  const d = S.det, m = Number(String(d.ym).slice(5, 7)), what = d.kind === 'fe' ? '소화기' : '장비';
  dialog('<h2 style="margin:0 0 var(--sp-2);font-size:var(--size-l)">점검 기록 삭제</h2>' +
    '<div style="font-size:var(--size-m);margin-bottom:var(--sp-2)"><b>' + h(d.name) + '</b> · ' + m + '월 점검 (' + (d.by ? h(d.by) + ' · ' : '') + h(d.at) + ')</div>' +
    '<div class="banner b-gray">삭제하면 이 ' + what + '는 ' + m + '월 「미입력」으로 돌아가고, QR을 찍어 다시 입력할 수 있습니다. 사진도 목록에서 빠집니다.</div>' +
    '<div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-3)"><button class="btn big" style="flex:1" onclick="detBack()">취소</button><button id="ddBtn" class="btn big delpri" style="flex:2" onclick="detDel()">삭제</button></div>');
}
function detBack() { const d = S.det; if (d.kind === 'fe') detail(d.id); else hydDetail(d.id); }
async function detDel() {
  const d = S.det, b = $('ddBtn'); if (b) b.disabled = true;
  try {
    const r = await call(d.kind === 'fe' ? 'feCheckDelete' : 'eqCheckDelete', d.id);
    if (!r || !r.ok) throw new Error((r && r.error) || '삭제하지 못했습니다');
    closeDialog(); toast(d.name + ' 점검 기록을 삭제했습니다');
    if (d.kind === 'fe') await stRefresh();
    else if (S.hq) { const s = await call('eqStatus', S.hq.ym); if (s && s.ok) { S.hq = s; render(); } }
  } catch (e) { if (b) b.disabled = false; toast(e && e.message ? e.message : '삭제하지 못했습니다'); }
}
async function detail(id) {
  dialog('<div style="display:flex;justify-content:center;padding:var(--sp-8)"><span class="spin" style="color:var(--blue);width:28px;height:28px"></span></div>');
  try {
    const r = await call('feDetail', id);
    if (!r.ok) { closeDialog(); toast(r.error); return; }
    const bad = r.state === '이상있음';
    detSheet(r, '<div class="ph43" style="margin-top:var(--sp-3)">' + (r.photo ? '<img src="' + r.photo + '" alt="압력계 사진">' : '<small>사진 없음</small>') + '</div>' +
      '<div style="margin:var(--sp-2) 0"><span class="chip ' + (bad ? 'c-bad' : 'c-ok') + '">' + (bad ? '이상 있음' : '이상 없음') + '</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:var(--sp-2)"><small style="color:var(--muted)">' + (bad ? '이상 내용' : '외관·압력 이상무') + ' (손글씨)</small><div class="sig">' + (r.signA ? '<img src="' + r.signA + '" alt="문구 손글씨">' : '') + '</div>' +
      '<small style="color:var(--muted)">이름 (손글씨)</small><div class="sig">' + (r.signB ? '<img src="' + r.signB + '" alt="이름 손글씨">' : '') + '</div></div>', 'fe', id);
  } catch (e) { closeDialog(); }
}

