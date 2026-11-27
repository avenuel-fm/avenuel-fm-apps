/* ── 메인 ── */
function renderMain() {
  const u = S.user;
  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const c = S.fire ? S.fire.counts : null;
  const soon = (b = '작업중', sm = '준비 중', ico = ICON.soon) => '<button class="tile soon" disabled><span class="ico">' + ico + '</span><b>' + b + '</b><small>' + sm + '</small></button>';
  // 환경설정에서 끈 칸: 직원에게는 「작업중」 칸, 소장·관리자·옵저버에게는 평소 칸 (결정 148)
  const t0 = (key, label, sub, ico) => '<button class="tile" onclick="tile(\'' + key + '\')"><span class="ico">' + ico + '</span><b>' + label + '</b><small>' + sub + '</small></button>';
  const t = (key, label, sub, ico) => menuOff(key) && !menuCanOpen() ? soon() : '<button class="tile" onclick="tile(\'' + key + '\')"><span class="ico">' + ico + '</span><b>' + label + '</b><small>' + sub + '</small></button>';
  return topbar('잠실점 에비뉴엘 · ' + today, '업무지원') + '<div class="wrap" style="display:flex;flex-direction:column;gap:var(--sp-3)">' +
    '<div class="banner b-gray">이 버전은 테스트판 입니다.' + (S.ver ? ' <b>v' + h(S.ver) + '</b>' : '') + '</div>' +
    '<div class="grid6">' +
    t('docs', '서류작업', 'TBM' + (S.docs ? ' · 오늘 서명 ' + S.docs.signs + '명' : ' · 명일 작업 예정'), ICON.docs) +
    soon() +
    t('inspect', '점검', c ? '소화기 ' + (c.ok + c.bad) + ' / ' + c.total + '대' : '소화기 점검', ICON.inspect) +
    t('spec', '시방서 검색', '도면협의 지침 찾기', ICON.search) +
    soon('자재현황', '준비중', ICON.box) +   // 자재현황 자리 (결정 168, WS_자재현황.md)
    t('map', '지도', '에비뉴엘 도면', ICON.map) +
    t('cad', 'CAD', '도면 보기 · 올리기', ICON.cad) +   // CAD (WS_CAD.md): 전 직원 열람·업로드. 환경설정에서 끄기 가능 (결정 210)
    '</div>' + mainTodo() +
    '<div class="mainfoot"><button class="btn theme-btn" onclick="toggleTheme()">' + themeLabel() + '</button>' +
    (isBoss() ? '<button class="btn" onclick="openSet()">환경설정</button>' : '') + '</div>' +
    '</div>';
}
/* ── 지도 (결정 130): 도면 앱(fm/map)을 이 화면 안에 띄움 → 주소창은 업무지원 그대로. 자료는 PIN 로그인 표로만 (supabase/13_map.sql) ── */
function renderMap() {
  return '<div class="mapview">' + topbar('업무지원 ›', '지도') + '<iframe class="mapframe" src="../map/index.html?v=0.26.55" title="에비뉴엘 도면" allow="fullscreen"></iframe>' +
    '<button class="btn mapback" onclick="back()">' + ICON.back + '뒤로</button></div>';   // 뒤로는 왼쪽 아래 작은 버튼 (결정 160)
}
/** 지도 전체화면: 지도 칸을 화면 가득 + 되면 기기 전체화면 (아이폰은 기기 전체화면이 없어 화면 가득만) */
function mapFull(on) {
  document.body.classList.toggle('mapfull', !!on);
  const d = document;
  try {
    if (on && !d.fullscreenElement && d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {});
    if (!on && d.fullscreenElement) d.exitFullscreen().catch(() => {});
  } catch (e) { /* 전체화면을 못 해도 화면 가득은 됨 */ }
}
document.addEventListener('fullscreenchange', () => {   // 기기 뒤로 가기로 전체화면이 풀리면 지도 단추도 되돌림
  if (document.fullscreenElement || !document.body.classList.contains('mapfull')) return;
  const fr = document.querySelector('iframe.mapframe');
  if (fr && fr.contentWindow && fr.contentWindow.toggleMapFullscreen) fr.contentWindow.toggleMapFullscreen(false);
  else mapFull(false);
});
window.WS_MAP = { full: on => mapFull(on), load: () => call('mapLoad'), save: (k, v, ver) => call('mapSave', k, v, ver), base: (k, v) => call('mapBase', k, v),
  days: () => call('mapDays'), at: at => call('mapAt', at), restore: day => call('mapRestore', day) };   // 기록·되돌리기 (결정 132)
