// 시안 전용 (앱 코드 안 고침): [서류작업] › [온습도/공조기/에어커튼 입력] 탭 4개 + 메인 미입력 알림
// 업무지원 실제 스타일(fm/ws/app.html 의 <style>) 위에 그림.  실행: node mock_climate.js <출력 폴더>
const { chromium } = require('C:/avenuel/avenuel-fm-apps/apps/ws/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || __dirname;
const STY = (fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fm', 'ws', 'app.html'), 'utf8').match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('');

// 예외 색 2개 (옛 앱 style.css .hv-name[data-tone] 값 그대로)
const TONE = { f6: '#f1e1e6', f5: '#e8e1f5', f4: '#f6ebd3', f3: '#fbf1c2', f2: '#dce7fb', f1: '#dcefe5', b1: '#e3e8f3', b3: '#ece6df', f1out: '#fde2cc', f1in: '#d6ecfa' };
const ico = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  chart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
};
const top = '<header class="top"><div class="top-in"><div class="ttl"><small>서류작업 ›</small><b>온습도/공조기/에어커튼 입력</b></div><span class="me">홍길동 · 기건파트</span><button class="btn sm">로그아웃</button></div></header>';
const TABS = ['AHU 환기온도 점검일지', '온습도', '공조기 가동시간', '에어커튼 가동시간'];
const tabs = on => '<div class="seg tabs4" role="tablist">' + TABS.map((t, i) => '<button role="tab" class="' + (i === on ? 'on' : '') + '">' + t + '</button>').join('') + '</div>';
const bar = (st, extra = '') => '<div class="nwbar"><button class="btn back-in">' + ico.back + '뒤로</button><span>' + st + '</span>' + extra + '<div class="dslot"><button class="btn pri">저장</button></div></div>';
const dirty = '<span class="nwstate dirty"><i class="dot"></i>저장 안 함</span>';
const date = '<button class="nwdate">' + ico.cal + '11월 21일 (토)</button>';
const box = (v, u, lbl) => '<label class="hvin"><input class="inp' + (v === '' ? ' empty' : '') + '" inputmode="decimal" value="' + v + '" aria-label="' + lbl + '"><span>' + u + '</span></label>';
const di = (t, h) => Math.round((0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3) * 10) / 10;
const diTag = (t, h) => { if (t === '' || h === '') return '<span class="ditag none">불쾌지수 —</span>'; const d = di(+t, +h), l = d < 74 ? '쾌적' : d < 78 ? '주의' : '불쾌'; return '<span class="ditag ' + (l === '쾌적' ? '' : l === '주의' ? 'c' : 'd') + '">불쾌지수 <b>' + d + '</b> · ' + l + '</span>'; };
const name = (txt, tone) => '<span class="flname" style="background:' + TONE[tone] + '">' + txt + '</span>';
const navGrid = (items, on) => '<div class="flnav">' + items.map((f, i) => '<button class="' + (i === on ? 'on' : '') + '"><i style="background:' + TONE[f[1]] + '"></i><b>' + f[0] + '</b><small>' + f[2] + '</small></button>').join('') + '</div>';
const repBtn = '<button class="btn sm repbtn">' + ico.chart + '리포트</button>';

const CSS = `<style>
.tabs4{margin-bottom:var(--sp-3)} .tabs4 button{font-size:var(--size-s);line-height:1.3;padding:4px 2px}
.nwbar{position:static!important}
.flnav{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-1);margin-top:var(--sp-3)}
.flnav button{min-height:44px;border:1px solid var(--line);background:var(--white);border-radius:var(--radius);font:inherit;font-size:var(--size-s);color:var(--sub);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;position:relative;padding:4px 0 4px 6px}
.flnav button b{font-size:var(--size-s);color:var(--ink);font-weight:600;text-align:center;line-height:1.25}
.flnav button i{position:absolute;left:0;top:0;bottom:0;width:6px}
.flnav button.on{border:2px solid var(--navy)}
.flname{display:inline-block;padding:2px 8px;border-radius:var(--radius);font-weight:600;color:#18202B}
.flhd{display:flex;align-items:center;justify-content:space-between;margin:var(--sp-4) 0 var(--sp-2)}
.flhd .flname{font-size:var(--size-l)} .flhd small{font-size:var(--size-s);color:var(--muted)}
.zr{display:grid;grid-template-columns:56px 1fr 1fr;gap:var(--sp-2);align-items:center;padding:var(--sp-2) var(--sp-3);border-top:1px solid var(--line)}
.zr:first-child{border-top:none} .zr>b{font-size:var(--size-m);font-weight:600}
.zr .sub{grid-column:2 / 4;display:flex;justify-content:space-between;gap:var(--sp-2);font-size:var(--size-s);color:var(--muted)}
.ditag{font-size:var(--size-s);color:var(--sub);padding:1px 6px;border:1px solid transparent;border-radius:var(--radius)}
.ditag b{font-weight:600;color:var(--ink)} .ditag.c{border-color:var(--navy)} .ditag.d{background:var(--navy);color:#fff} .ditag.d b{color:#fff} .ditag.none{color:var(--muted)}
.adv{font-size:var(--size-s);color:var(--sub);background:var(--tint);padding:var(--sp-2) var(--sp-3);border-top:1px solid var(--line);line-height:1.5}
.secl{font-size:var(--size-s);color:var(--sub);font-weight:500;padding:var(--sp-2) var(--sp-3);background:var(--tint);border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.nextfl{display:flex;gap:var(--sp-2);margin:var(--sp-3) 0} .nextfl .btn{flex:1;justify-content:center}
.hdrow{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-2)}
.repbtn{gap:4px}
.note{font-size:var(--size-s);color:var(--muted);margin:var(--sp-2) 0 0;line-height:1.6}
/* 가동시간 카드 */
.uc{padding:var(--sp-3);border-top:1px solid var(--line)} .uc:first-child{border-top:none}
.uc .h{display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-2)}
.uc .h .flname{font-size:var(--size-m)} .uc .h .flname small{display:block;font-size:12px;font-weight:400;color:#3F4855}
.uc .h .nm small{font-size:var(--size-s);color:var(--muted);margin-left:var(--sp-1)}
.uc .off{display:inline-flex;align-items:center;gap:6px;font-size:var(--size-s);color:var(--ink)}
.uc .off input{width:20px;height:20px;margin:0;accent-color:var(--navy)}
.uc .r{display:grid;grid-template-columns:36px 1fr 1fr 1fr;gap:var(--sp-1);align-items:center;margin-top:var(--sp-1);font-size:var(--size-s);color:var(--sub)}
.uc select{min-height:var(--control-h);border:1px solid var(--line);border-radius:var(--radius);background:var(--white);font:inherit;font-size:16px;padding:0 4px;color:var(--ink)}
.uc .f{display:flex;justify-content:space-between;font-size:var(--size-s);color:var(--sub);margin-top:var(--sp-2)} .uc .f b{color:var(--ink);font-weight:600}
.uc.isoff .r{opacity:.45} .uc.isoff{background:var(--tint)}
/* 메인 알림 */
.todo{border:1px solid var(--line);border-left:4px solid var(--navy);background:var(--white);padding:var(--sp-3)}
.todo-h{font-size:var(--size-m);font-weight:600;color:var(--ink);display:flex;justify-content:space-between;align-items:baseline;gap:var(--sp-2);flex-wrap:wrap}
.todo-h small{font-size:var(--size-s);color:var(--muted);font-weight:400}
.todo-b{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);margin-top:var(--sp-2)}
.todo-b .btn{justify-content:space-between} .todo-b .btn b{font-weight:600;margin-left:auto;margin-right:4px}
</style>`;

/* 1. AHU 환기온도 점검일지 — 지금 [서류작업 › 공조기 환기온도] 휴대폰 화면 그대로, 12:00 → 11:00 */
function ahu() {
  const U = [['7F-39', '공조실-4', '6층 더페어링,와인 라콘차', '22.3', '22.7'], ['6F-36', '공조실-1', '6층 뮤지엄,상품권 스시이세이,목탄장', '22.7', '23.2'], ['6F-35', '공조실-2', '5층 테이스터5.1 채뉴욕,GK언더웨어 아므마니 언더웨어', '23.6', ''], ['6F-34', '공조실-2', '6층 아그라,르지우 JS가든', '21.5', ''], ['6F-33', '공조실-3', '5층 샌프란시스코마켓,수선실,헬렌카렌스키,막스마라위크앤드,이페쎄', '22.4', '']];
  const rows = U.map(u => '<div class="hvr"><div class="nm"><b>' + u[0] + '</b><i>' + u[1] + '</i><small>' + u[2] + '</small><span class="prev">11:00 · ' + u[3] + '℃</span></div>' + box(u[4], '℃', u[0] + ' 환기온도') + '</div>').join('');
  const w = (l, v, u) => '<label>' + l + '<span class="hvin"><input class="inp' + (v ? '' : ' empty') + '" value="' + v + '"><span>' + u + '</span></span></label>';
  return top + '<div class="wrap list">' + tabs(0) +
    '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>AHU 환기온도 점검일지</b>' + date + '</div>' +
    '<div class="hvmeta"><span class="hvchip">연장영업</span>점검자 홍길동</div>' +
    '<div class="seg hvtime" role="group"><button>11:00<small>입력 38/38</small></button><button class="on">16:00<small>입력 2/38</small></button></div>' +
    '<div class="hvw">' + w('외기온도', '11.2', '℃') + w('습도', '48', '%') + w('냉수공급온도', '7.4', '℃') + '</div>' +
    '<div class="hvmeta">날씨 맑음 · 최저 4℃ · 최고 13.5℃ · 습도 45% <span style="color:var(--muted)">(종합업무일지에서 자동)</span></div></div>' +
    '<div class="hvsec">공조기 환기온도 (16:00)</div><div class="hvlist">' + rows + '</div>' +
    '<p class="note">… 아래로 33대 더 (엑셀 순서 7F-39 → B3F-HVU1, 지금 화면과 같음)<br>· 바뀐 것은 <b>12:00 → 11:00</b> 하나. PC는 지금처럼 B4 종이 위에 바로 입력, 인쇄·PDF 종이도 「11:00」</p>' +
    bar(dirty) + '</div>';
}

/* 2. 온습도 — 매장 온도·습도 (층 한 쪽씩, 구역 1·2·3) */
function climate() {
  const F = [['6층', 'f6', '2/3'], ['5층', 'f5', '0/3'], ['4층', 'f4', '0/3'], ['3층', 'f3', '0/3'], ['2층', 'f2', '0/3'], ['1층', 'f1', '0/3'], ['B1층', 'b1', '0/1']];
  const Z = [['1구역', '24.1', '52', '오늘 11:20 · 23.6℃ 49%'], ['2구역', '26.4', '62', '오늘 11:24 · 25.8℃ 58%'], ['3구역', '', '', '오늘 기록 없음']];
  const zr = Z.map(z => '<div class="zr"><b>' + z[0] + '</b>' + box(z[1], '℃', '6층 ' + z[0] + ' 실내온도') + box(z[2], '%', '6층 ' + z[0] + ' 실내습도') + '<div class="sub"><span>' + z[3] + '</span>' + diTag(z[1], z[2]) + '</div></div>').join('');
  return top + '<div class="wrap list">' + tabs(1) +
    '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>매장 온도 · 습도</b>' + repBtn + '</div>' +
    '<div class="hvmeta">측정 시각은 저장한 때 (지금 15:42) · 하루 여러 번 넣어도 모두 남음</div>' +
    '<div class="hvw"><label>실외온도<span class="hvin"><input class="inp" value="11.2"><span>℃</span></span></label><label>실외습도<span class="hvin"><input class="inp" value="48"><span>%</span></span></label></div>' +
    '<div class="hvmeta">실외는 날씨에서 자동 (10분마다, 고칠 수 있음)</div>' +
    navGrid(F, 0) + '</div>' +
    '<div class="flhd">' + name('6층', 'f6') + '<small>층 1/7</small></div>' +
    '<div class="hvlist"><div class="secl"><span>실내 (지금)</span><span>온도 ℃ · 습도 %</span></div>' + zr +
    '<div class="adv">2구역: 온도가 높습니다. 냉방 강화 또는 설정온도를 낮추세요. · 습도가 높습니다. 제습 운전 또는 환기량을 늘리세요.</div></div>' +
    '<div class="nextfl"><button class="btn" disabled>' + ico.back + '이전 층</button><button class="btn">다음 층 · 5층' + ico.next + '</button></div>' +
    '<p class="note">· 불쾌지수 = 0.81T + 0.01H(0.99T−14.3) + 46.3 · 쾌적 &lt;74 · 주의 &lt;78 · 불쾌 ≥78 (단계는 모양으로: 주의 = 테두리, 불쾌 = 남색 바탕)<br>· [리포트] = 최근 5일 그래프 · 일일 기록 · CSV</p>' +
    bar(dirty) + '</div>';
}

/* 가동시간 카드 (공조기·에어커튼 공용) */
const ap = v => '<select><option>' + v + '</option></select>';
function uc(nm, sub, tone, s, e, sum, off) {
  return '<div class="uc' + (off ? ' isoff' : '') + '"><div class="h"><span class="nm">' + (tone ? name(nm + (sub ? '<small>' + sub + '</small>' : ''), tone) : '<b>' + nm + '</b><small>' + sub + '</small>') + '</span>' +
    '<label class="off"><input type="checkbox"' + (off ? ' checked' : '') + '>미가동</label></div>' +
    '<div class="r"><span>시작</span>' + ap(s[0]) + ap(s[1]) + ap(s[2]) + '</div><div class="r"><span>종료</span>' + ap(e[0]) + ap(e[1]) + ap(e[2]) + '</div>' +
    '<div class="f"><span>' + sum + '</span><span>' + (off || s[0] !== '구분' ? '' : '') + '</span></div></div>';
}

/* 3. 공조기 가동시간 — 층 한 쪽씩, 이름 = ahu_unit.no */
function hvac() {
  const F = [['6층', 'f6', '0/5'], ['5층', 'f5', '0/6'], ['4층', 'f4', '0/6'], ['3층', 'f3', '0/6'], ['2층', 'f2', '0/6'], ['1층', 'f1', '0/5'], ['B1층', 'b1', '0/2'], ['B3층', 'b3', '0/2']];
  const S = ['오전', '10시', '00분'], E = ['오후', '8시', '20분'];
  const cards = [['7F-39', '6층 더페어링,와인 라콘차'], ['6F-36', '6층 뮤지엄,상품권 스시이세이'], ['6F-34', '6층 아그라,르지우 JS가든'], ['6F-32', '6층 해남천일관 한우리, TWG'], ['6F-28', '6층 프라이빗 아트홀, 커뮤니티']]
    .map((u, i) => i === 3 ? uc(u[0], u[1], 'f6', S, E, '미가동 · <b>0시간</b>', 1) : uc(u[0], u[1], 'f6', S, ['오후', '9시', '50분'], '가동 <b>11시간 50분</b>')).join('');
  return top + '<div class="wrap list">' + tabs(2) +
    '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>공조기 가동시간</b>' + date + '</div>' +
    '<div class="hdrow"><span class="hvmeta" style="margin:0">미입력 33대 · 기본 10:00 ~ 20:20 (금토일)</span>' + repBtn + '</div>' +
    navGrid(F, 0) + '</div>' +
    '<div class="flhd">' + name('6층', 'f6') + '<small>6층은 매일 21:50 종료 · 층 1/8</small></div>' +
    '<div class="hvlist">' + cards + '</div>' +
    '<div class="nextfl"><button class="btn" disabled>' + ico.back + '이전 층</button><button class="btn">다음 층 · 5층' + ico.next + '</button></div>' +
    '<p class="note">· 시각은 오전/오후 · 시 · 10분 단위. 미가동 체크 = 0시간, 빈 칸 = 통계 제외<br>· 기본: 시작 10:00, 종료 월~목 19:20 · 금~일 20:20, 6층 매일 21:50, B3층 08:30~18:40<br>· PC는 층(줄) × 구역(칸) 표로 38대 한 화면 (옛 앱과 같은 배치)</p>' +
    bar(dirty) + '</div>';
}

/* 4. 에어커튼 가동시간 — 묶음 한 쪽씩, OUT 주황 · IN 하늘 · 후방 연두 */
function curtain() {
  const G = [['지하1층 24G', 'b1', '0/2'], ['1G OUT', 'f1out', '0/7'], ['1G IN', 'f1in', '0/5'], ['2G OUT', 'f1out', '0/3'], ['2G IN', 'f1in', '0/3'], ['6G OUT', 'f1out', '0/3'], ['6G IN', 'f1in', '0/3'], ['후방 피난도어', 'f1', '0/8'], ['4층 브릿지', 'f4', '0/1'], ['6층 브릿지', 'f6', '0/1']];
  const S = ['오전', '10시', '00분'], E = ['오후', '7시', '30분'];
  const cards = [1, 2, 3, 4].map(n => uc(n + '번', '1층 1게이트 OUT', 'f1out', S, E, '가동 <b>9시간 30분</b>')).join('');
  return top + '<div class="wrap list">' + tabs(3) +
    '<div class="card" style="padding:var(--sp-4)"><div class="hvhd"><b>에어커튼 가동시간</b>' + date + '</div>' +
    '<div class="hdrow"><span class="hvmeta" style="margin:0">미입력 32대 · 기본 10:00 ~ 19:30 (금토일)</span>' + repBtn + '</div>' +
    navGrid(G, 1) + '</div>' +
    '<div class="flhd">' + name('1층 1게이트 OUT', 'f1out') + '<small>7대 · 묶음 2/10</small></div>' +
    '<div class="hvlist">' + cards + '</div><p class="note">… 아래로 3대 더</p>' +
    '<div class="nextfl"><button class="btn">' + ico.back + '이전 묶음</button><button class="btn">다음 · 1G IN' + ico.next + '</button></div>' +
    '<p class="note">· 색은 옛 앱 그대로 (예외): OUT 주황 · IN 하늘 · 후방 연두, 층 색<br>· 기본: 10:00 ~ 20:00, 금·토·일 19:30</p>' +
    bar(dirty) + '</div>';
}

/* 5. 메인 화면 「오늘 미입력」 (결정 194) */
function main() {
  const tile = (b, sm, soon) => '<button class="tile' + (soon ? ' soon' : '') + '"><span class="ico">' + ico.cal + '</span><b>' + b + '</b><small>' + sm + '</small></button>';
  return '<header class="top"><div class="top-in"><div class="ttl"><small>잠실점 에비뉴엘 · 11월 21일 (토)</small><b>업무지원</b></div><span class="me">홍길동 · 기건파트</span><button class="btn sm">로그아웃</button></div></header>' +
    '<div class="wrap" style="display:flex;flex-direction:column;gap:var(--sp-3)"><div class="banner b-gray">이 버전은 테스트판 입니다. <b>v0.21.0</b></div>' +
    '<div class="todo"><div class="todo-h">오늘 가동시간 미입력 <small>미가동 체크는 입력한 것으로 셈</small></div>' +
    '<div class="todo-b"><button class="btn">공조기 <b>5대</b>' + ico.next + '</button><button class="btn">에어커튼 <b>3대</b>' + ico.next + '</button></div></div>' +
    '<div class="grid6">' + tile('서류작업', 'TBM · 오늘 서명 3명') + tile('작업중', '준비 중', 1) + tile('점검', '소화기 120 / 160대') + tile('시방서 검색', '도면협의 지침 찾기') + tile('자재현황', '준비중', 1) + tile('지도', '에비뉴엘 도면') + '</div>' +
    '<p class="note">· 오늘(근무일) 공조기 38대 · 에어커튼 36대 중 시작·종료나 미가동을 안 넣은 대수. 0대가 되면 칸이 사라짐<br>· 누르면 [서류작업 › 온습도/공조기/에어커튼 입력]의 「공조기 가동시간」/「에어커튼 가동시간」 탭으로 바로 감</p></div>';
}

(async () => {
  const b = await chromium.launch();
  for (const [file, body] of [['1_AHU환기온도.png', ahu()], ['2_온습도.png', climate()], ['3_공조기가동.png', hvac()], ['4_에어커튼가동.png', curtain()], ['5_메인_미입력알림.png', main()]]) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await c.newPage();
    await p.setContent('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + STY + CSS + '</head><body>' + body + '</body></html>');
    await p.screenshot({ path: path.join(OUT, file), fullPage: true });
    await c.close();
  }
  await b.close();
})();
