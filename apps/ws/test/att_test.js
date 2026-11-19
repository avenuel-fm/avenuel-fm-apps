// 출근현황 화면 시험 (WS_출근현황, 결정 88): 엑셀 읽기(표 흉내) · 저장 · 조직도 · 상태 고르기 · 기본 휴일 · 달력 · 그림
// 이름은 모두 가짜 (실제 직원 이름은 저장소에 올리지 않음). 엑셀 읽기 도구·그림 도구(cdnjs)는 시험에서 흉내
const { chromium } = require('playwright');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const kst = new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3), Y = kst.getUTCFullYear(), M = kst.getUTCMonth() + 1, TODAY = kst.getUTCDate();
const N = new Date(Date.UTC(Y, M, 0)).getUTCDate();
// 실제 근무 스케줄 엑셀과 같은 모양: 1줄 제목, 5줄 날짜, 6줄 요일, A구역(합친 칸은 첫 줄만)·B직책·C이름·D전월OT·E부터 1일, 합계 줄, 총원 줄, 아래 안내 글
function aoa() {
  const day = (fill, set) => Array.from({ length: N }, (_, i) => (set && set[i + 1]) || fill);
  // 5번째 값 = 엑셀에서 숨긴 줄. 공사장 안전관리는 구역·직책 칸이 합쳐져 직책이 비고, 엑셀 주간근무총원에서 빠짐 (실제 엑셀과 같음)
  const people = [['관 리', '소장', '홍길동', day('', { [TODAY]: '' })], ['', '총무', '총무가짜', day('병가'), 1],
    ['전기\n방재', '파트장', '김철수', day('')], ['', '교대', '야간가짜', day('야')], ['', '기사', '주간가짜', day('', { [TODAY]: '9-7' })],
    ['공사장 안전관리', '', '공사가짜', day('')],
    ['기계\n건축', '기사', '', day('')], ['', '기사', '', day(''), 1], ['', '교대반장', '비번가짜', day('비')]];
  const rows = [['(' + Y + '년 ' + M + '월) 근무스케줄'], [], [], [], ['월 일 구분', '', '', '전월OT'].concat(day(0).map((_, i) => i + 1)), ['', '', '', ''].concat(day('월'))];
  people.forEach(p => rows.push([p[0], p[1], p[2], 0].concat(p[3])));
  rows.push(['', '근무인원합계', '', 3].concat(day(1)));
  const ju = day(0).map((_, i) => people.filter(p => p[2] && p[0] !== '공사장 안전관리' && ['', '9-7'].indexOf(p[3][i]) !== -1).length);
  rows.push(['주간근무총원', '', '', 19].concat(ju), [' 1. 휴무변경은 3일 전 사전 승인']);
  rows.hid = rows.map((_, i) => i >= 6 && i < 6 + people.length && !!people[i - 6][4]);
  return rows;
}
const AOA = () => { const a = aoa(); return { a, hid: a.hid }; };
(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  // 그림 도구(html2pdf)는 진짜를 받아 잘림 없이 그려지는지 봄 — 인터넷이 없으면 흉내로 바꿈
  const REAL_H2P = await fetch('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js').then(r => r.ok ? r.text() : '').catch(() => '');
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: /html2pdf/.test(r.request().url()) ? REAL_H2P : '' }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
  for (const k of '1234') await p.click(`.key:text-is("${k}")`);
  await p.waitForSelector('.grid6'); await p.click('.tile >> text=서류작업'); await p.click('text=출근현황');
  await p.waitForSelector('text=근무 스케줄이 아직 없습니다');
  ok(await p.locator('button:has-text("엑셀 올리기")').count() === 1, '스케줄 없을 때 소장에게 [엑셀 올리기]');
  await p.click('button:has-text("엑셀 올리기")'); await p.waitForSelector('text=엑셀 파일(.xlsx) 고르기');
  // 파일 고르기 대신 읽은 표를 바로 넣음 (SheetJS sheet_to_json(header:1) 결과와 같은 모양)
  await p.evaluate(({ a, hid }) => { S.atup = Object.assign({ name: '시험.xlsx', day: 1, file: '' }, atParse(a, hid)); render(); }, AOA());
  const chk = await p.locator('.atchk').innerText();
  ok(chk.indexOf(Y + '년 ' + M + '월') !== -1 && chk.indexOf('7명 + 공석 1줄 × ' + N + '일') !== -1, '엑셀 읽기: 달·인원·공석 (숨긴 빈 줄 뺌 · 숨긴 이름 줄·공사장 읽음) — ' + chk.split('\n')[1]);
  ok(chk.indexOf('모두 같음') !== -1, '주간근무총원 줄과 앱 계산이 같음 (공사장 안전관리 뺌)');
  ok(/처음 보는 기호 「병가」/.test(chk) === false, '병가는 아는 기호 (경고 없음)');
  await p.evaluate(({ a, hid }) => { a[7][4] = '??'; S.atup = Object.assign({ name: '시험.xlsx', day: 1, file: '' }, atParse(a, hid)); render(); }, AOA());
  ok(/처음 보는 기호 「\?\?」 \(총무가짜 1칸\)/.test(await p.locator('.atchk').innerText()), '모르는 기호는 이름·칸 수와 함께 알림');
  await p.evaluate(({ a, hid }) => { S.atup = Object.assign({ name: '시험.xlsx', day: 1, file: '' }, atParse(a, hid)); render(); }, AOA());
  ok(!(await overflow(p)), '엑셀 올리기 화면 옆 넘침 없음');
  await p.screenshot({ path: 'shot_att_upload.png', fullPage: true });
  await p.click('#atUpSave');
  await p.waitForSelector('.atorg');
  const secs = await p.locator('.atsec h2').allInnerTexts();
  ok(secs.map(s => s.split('\n')[0]).join('|') === '사업소장|관리파트|전기·방재|기계·건축|공사장 안전관리', '조직도 구역 순서 ' + secs.map(s => s.split('\n')[0]).join('|'));
  ok(await p.locator('.atp.vac').count() === 1 && await p.locator('.atp:not(.vac)').count() === 7, '사람 7칸 + 공석 1칸');
  ok(await p.locator('.k4', { hasText: '공사가짜' }).count() === 1, '공사가짜는 공사장 안전관리 구역 (맨 아래)');
  ok(await p.locator('.atav').count() === 0, '이름 왼쪽 성 표시 없음');
  const tagOf = n => p.locator('.atp', { hasText: n }).locator('.attag').innerText();
  ok(await tagOf('주간가짜') === '9-7' && await tagOf('총무가짜') === '병가' && await tagOf('비번가짜') === '비', '오늘 상태 딱지 (9-7 · 병가 · 비)');
  ok(await tagOf('홍길동') === '출', '출근 딱지는 「출」 한 글자');
  ok((await p.locator('.atp', { hasText: '비번가짜' }).locator('.atnm small').innerText()) === '교대', '교대반장 → 교대로 보임');
  ok(await p.locator('.k3 .atppl > *').last().evaluate(e => e.classList.contains('vac')), '화면에서도 공석은 맨 끝');
  ok(await p.evaluate(() => !/\p{Extended_Pictographic}/u.test(document.querySelector('.wrap').innerText) && new Set([...document.querySelectorAll('.atsec h2')].map(e => getComputedStyle(e).backgroundColor)).size === 1), '이모지 없음 · 구역 머리 색 하나 (색은 상태 칸에만, 결정 108)');
  const sums = await p.locator('.atst').nth(1).innerText();
  ok(/합계\s+4명\s+1명/.test(sums) && /공사장 안전관리\s+1명\s+0명/.test(sums), '금일 근무인원 합계 주 4 · 야 1, 공사장 줄 — ' + sums.replace(/\s+/g, ' ').slice(-20));
  ok(/합계\s+8명\s+7명\s+1명/.test(await p.locator('.atst').first().innerText()), '파트별 인원 전체 8 · 현재 7 · 공석 1');
  ok(await p.locator('.atst caption').first().evaluate(e => getComputedStyle(e).textAlign) === 'center', '표 제목 가운데');
  ok(!(await overflow(p)), '휴대폰 옆 넘침 없음');
  await p.screenshot({ path: 'shot_att_phone.png', fullPage: true });
  // 상태 고르기 (소장 = 고칠 수 있음)
  await p.locator('.atp', { hasText: '김철수' }).locator('button.attag').click();
  await p.locator('.atopts button', { hasText: '연' }).click();
  await p.screenshot({ path: 'shot_att_fix.png' });
  await p.click('.dialog button:has-text("(으)로 바꾸기")');
  await p.waitForFunction(() => document.querySelector('.atp .atfix'));
  ok(await tagOf('김철수') === '연' && await p.locator('.atp', { hasText: '김철수' }).locator('.atfix').count() === 1, '딱지 눌러 「연」으로 고침 · 고침 점');
  // 기본 휴일
  await p.locator('.atp', { hasText: '주간가짜' }).locator('.atnm').click();
  await p.click('.atwk button:text-is("일")'); await p.click('.atwk button:text-is("월")');
  ok((await p.locator('.dialog .atchk').innerText()).indexOf('일 · 월') !== -1, '기본 휴일 일·월 고름');
  await p.screenshot({ path: 'shot_att_holiday.png' });
  await p.click('.dialog button:text-is("저장")');
  await p.waitForFunction(() => S.at.r.people.find(x => x.name === '주간가짜').hol).catch(() => {});
  const hol = await p.evaluate(() => S.at.r.people.find(x => x.name === '주간가짜').hol);
  ok(hol === '일,월', '기본 휴일 저장 → ' + hol);
  // 달력
  await p.click('button:has-text("날짜 바꾸기")');
  ok(await p.locator('.atcal button').count() === N && (await p.locator('.atcal button.on').innerText()).indexOf('주 ') !== -1, '달력: 그 달 ' + N + '일 · 주간 인원 표시');
  await p.click('.dialog .back');
  // 그림: 1200px 판을 그리는지 (그림 도구는 흉내)
  if (!REAL_H2P) { console.log('(인터넷 없음: 그림 도구 흉내)'); await p.evaluate(() => { window.html2pdf = () => ({ set() { return this; }, from(el) { return this; }, outputImg: async () => { const c = document.createElement('canvas'); c.width = 2400; c.height = document.querySelector('.atimg').offsetHeight * 2; return c.toDataURL(); } }); }); }
  const dl = p.waitForEvent('download');
  await p.click('#atImgBtn');
  const f = await dl;
  await f.saveAs('shot_att_download.png');
  const wh = await p.evaluate(() => new Promise(ok => { const im = document.getElementById('atImg'); const go = () => ok([im.naturalWidth, im.naturalHeight]); im.complete ? go() : im.onload = go; }));
  ok(/_출근현황\.png$/.test(f.suggestedFilename()) && wh[0] === 2400 && wh[1] > 900, '그림 저장: ' + f.suggestedFilename() + ' · ' + wh.join('×') + ' (1200px 판 2배)');
  ok(await p.locator('#atImg').count() === 1, '그림도 화면에 보여 줌 (길게 눌러 저장)');
  await p.click('.dialog .back');
  // 그림 모양 찍기
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'imgShot'; d.innerHTML = atImgHtml(S.at.r); document.body.appendChild(d); });
  await p.locator('#imgShot .atimg').screenshot({ path: 'shot_att_image.png' });
  const it = await p.locator('#imgShot').innerText();
  ok(it.indexOf('잠실점 에비뉴엘 시설관리') !== -1 && it.indexOf('월드타워') === -1 && it.indexOf('만듦') === -1, '그림 글: 잠실점 에비뉴엘 시설관리 · 「만듦」 뺌');
  ok(await p.evaluate(() => [...document.querySelectorAll('#imgShot .attag')].every(e => { const r = e.getBoundingClientRect(), g = document.createRange(); g.selectNodeContents(e); const t = g.getBoundingClientRect(); return Math.abs((t.top + t.bottom) / 2 - (r.top + r.bottom) / 2) <= 1.5 && Math.abs((t.left + t.right) / 2 - (r.left + r.right) / 2) <= 1.5; })), '딱지 글자 가운데 (위아래·좌우 1.5px 안)');
  ok(await p.evaluate(() => [...document.querySelectorAll('#imgShot .atnm b, .wrap .atnm b')].every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= b.closest('.atp').querySelector('.attag').getBoundingClientRect().left + 1)), '이름이 잘리거나 딱지와 겹치지 않음 (화면·그림)');
  ok(await p.evaluate(() => [...document.querySelectorAll('#imgShot .atppl')].every(g => { const c = [...g.children]; const v = c.findIndex(x => x.classList.contains('vac')); return v === -1 || c.slice(v).every(x => x.classList.contains('vac')); })), '공석은 구역 맨 끝');
  // PC
  await p.setViewportSize({ width: 1280, height: 900 }); await p.evaluate(() => { document.getElementById('imgShot').remove(); render(); });
  ok(!(await overflow(p)), 'PC 옆 넘침 없음');
  await p.screenshot({ path: 'shot_att_pc.png', fullPage: true });
  // 직원(고칠 권한 없음): 딱지가 버튼이 아님
  const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
  const lg = await run('login', '5678', 'att-kim', require('fs').readFileSync(__dirname + '/sig_b64.txt', 'utf8'));
  const g = await run('attGet', lg.token, '');
  ok(g.ok && !g.canFix && !g.canBoss, '김철수(주간 직원): 고치기·엑셀 권한 없음');
  ok(!errs.length, '화면 오류 없음 ' + errs.join(' / '));
  await b.close();
})();
