/* ── 그리기 ── */
function render() {
  let html;
  if (S.view === 'loading') html = renderLoading();
  else if (S.view === 'retry') html = renderRetry();
  else if (S.view === 'device') html = renderDevice();
  else if (S.view === 'sign' && S.sign) html = renderSign();
  else if (!S.token || S.view === 'login') html = renderLogin();
  else if (S.view === 'pdf' && S.pdf) html = renderPdf();
  else if (S.view === 'docs') html = renderDocs();
  else if (S.view === 'tbm') html = renderTbm();
  else if (S.view === 'nw') html = renderNw();
  else if (S.view === 'log') html = renderLog();
  else if (S.view === 'ahu') html = renderAhu();
  else if (S.view === 'clim') html = renderClim();
  else if (S.view === 'use') html = renderUse();
  else if (S.view === 'rep' && S.rep) html = renderRep();
  else if (S.view === 'kw' && isBoss()) html = renderKw();
  else if (S.view === 'uhr') html = renderUhr();   // 전 직원 (결정 218)
  else if (S.view === 'map') html = renderMap();
  else if (S.view === 'spec') html = S.sp ? renderSpec() : renderMain();
  else if (S.view === 'att') html = renderAtt();
  else if (S.view === 'attup') html = renderAttUp();
  else if (S.view === 'inspect') html = renderInspect();
  else if (S.view === 'cad') html = renderCad();
  else if (S.view === 'fire') html = renderFire();
  else if (S.view === 'qr') html = renderQr();
  else if (S.view === 'hyd') html = renderHyd();
  else if (S.view === 'hydfl') html = S.hq ? renderHydFloor() : renderHyd();
  else if (S.view === 'eh') html = renderEh();
  else if (S.view === 'cs') html = renderCs();
  else if (S.view === 'csck') html = renderCsCk();
  else if (S.view === 'rw') html = renderRw();
  else if (S.view === 'wh') html = renderWh();
  else if (S.view === 'df') html = renderDf();
  else if (S.view === 'status') html = renderStatus();
  else if (S.view === 'floor') html = S.st ? renderFloor() : renderStatus();
  else if (S.view === 'set' && isBoss()) html = renderSet();
  else if (S.view === 'risk' && isBoss()) html = renderRisk();
  else html = renderMain();
  if (S.view !== 'map') document.body.classList.remove('mapfull');
  if (PARENT[S.view] && S.token && S.user && S.view !== 'map') {   // 아래 뒤로 버튼 (위 < 는 뺌, 결정 102). 저장 줄이 있으면 그 줄 맨 왼쪽에 (WS-25)
    const h2 = withBack(html);
    html = h2 !== html ? h2 : html + '<div class="wrap backbar"><button class="btn big" onclick="back()">' + ICON.back + '뒤로</button></div>';
  }
  $('app').innerHTML = html;
  if (S.view === 'spec' && S.sp && S.sp.boot) spDraw();
  if (S.view === 'qr') { drawQrs(); qrMarkPartial(); }
  if (S.view === 'sign') mountSign();
  if (S.view === 'pdf') pvDraw();
}

(async function start() {
  render();   // 「불러오는 중」 — 저장된 표를 확인하는 동안 PIN 화면을 보이지 않음 (결정 48)
  if (window.WS_API) {   // 바로가기 앱: 기기 등록(시설팀 공용 계정 Supabase 로그인)이 먼저 (Supabase 이관 3-1)
    for (;;) {   // 등록 기록을 새로 받다 실패하면 등록 화면 대신 3초마다 다시 시도 (결정 286)
      try { S.device = await WS_API.device(); break; }
      catch (e) { S.device = null; if (e.message !== 'RETRY') break; S.dev = { wait: true }; S.view = 'device'; render(); await new Promise(r => setTimeout(r, 3000)); }
    }
    S.dev = null;
    if (!S.device) { S.view = 'device'; render(); return; }
    S.view = 'loading';
  }
  if (!tokenAlive(S.token)) {
    store('ws_token', null); S.token = '';
    const t = await SHELL.get();
    if (tokenAlive(t)) { S.token = t; store('ws_token', t); }
  } else SHELL.set(S.token);
  if (!S.token) { S.view = 'login'; render(); return; }
  // 이 기기에 기억한 지난번 메인 화면을 먼저 보여 주고, 서버 확인은 뒤에서 (로딩 개선, 결정 76). 표의 주인이 같을 때만
  let m = null; try { m = JSON.parse(store('ws_main') || 'null'); } catch (e) {}
  if (m && m.user && m.sid === String(S.token).split('.')[0]) { S.user = m.user; S.fire = m.fire; S.docs = m.docs; S.menuOff = m.menuOff || []; S.cached = true; S.view = 'main'; render(); }
  await boot(true);
})();
