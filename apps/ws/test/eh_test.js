// 전열필증 화면 시험 (WS_전열필증, 결정 96): PC 엑셀 가져오기 → 표 · 필증 출력(50×50, QR·로고) / 휴대폰 매장 추가 · 기기 추가·편집 · 검색 · 선택 삭제
// 엑셀 읽기 도구(cdnjs xlsx)는 흉내 — 관리대장과 같은 모양의 표를 돌려줌. 매장·기기 이름은 시험용
const { chromium } = require('playwright');
const fs = require('fs');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const blk = (floor, store, rows) => [['', '', '', '', '', '', '', '층 : ' + floor], ['', '', '', '', '', '', '', store], [],
  ['No', '관리번호', '기기명', '사용처', '용량(W)', '제조사', '관리책임자', '', '승인일자 '], ['', '', '', '', '', '', '정', '부']].concat(rows.map((r, i) => [String(i + 1)].concat(r)));
const many = (pre, n) => Array.from({ length: n }, (_, i) => [pre + (i + 1), ['선풍기', '에스프레소머신', '4도어 냉장/냉동고', '공기청정기'][i % 4], '', String([45, 1200, 546, 70][i % 4]) + 'W', i % 3 ? '삼성전자' : '', '1층파트리더', '매장관리자', '2019.11.' + String(10 + i % 20)]);
const XL = {
  '전열기 관리대장(원본)': [['No']],
  '1F': blk('1', '발렌티노', many('1F-1-', 12)).concat(blk('1', '매장명 : 아주아주긴이름의매장 알렉산드르 드 파리 월드타워', many('1F-2-', 3))).concat(blk('1', '까르띠에', [['', '라지에이터', '', '3000', '', '1층파트리더', '매장관리자', '23.02.01']])),
  'B1F': blk('B1', '고디바', [['B1F-13-1', '온수기', '', '3200W', 'FETCO', '지하1층파트리더', '매장관리자', '2019.11.30']]),
  '팝업': blk('5', '필리포 피아나', [['5F-1', '스팀다리미', '', '1600', '', '5F 파트리더', '매장관리자', '25.11.01']])
};
const FAKE_XLSX = 'window.XLSX={read:()=>({SheetNames:' + JSON.stringify(Object.keys(XL)) + ',Sheets:' + JSON.stringify(XL) + '}),utils:{sheet_to_json:ws=>ws}};';
(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  const ctx = async o => { const c = await b.newContext(o);
    await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: /xlsx/.test(r.request().url()) ? FAKE_XLSX : QRLIB }));
    await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' })); return c; };
  const errs = [];
  const open = async c => { const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
    for (const k of '1234') await p.click(`.key:text-is("${k}")`);
    await p.waitForSelector('.grid6'); await p.click('.tile:has(b:text-is("점검"))'); await p.click('text=전열필증'); return p; };

  // ── PC: 엑셀 가져오기 → 표 → 필증 출력
  const pc = await open(await ctx({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1.5 }));
  await pc.waitForSelector('text=아직 전열기기가 없습니다');
  await pc.click('button:has-text("엑셀 가져오기")');
  await pc.setInputFiles('.dialog input[type=file]', { name: '관리대장.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await pc.waitForSelector('#ehXb');
  const chk = await pc.locator('.dialog').innerText();
  ok(/합계\s+5\s+18/.test(chk), '가져오기 미리 셈: 매장 5 · 기기 18');
  ok(/새 번호 2대/.test(chk) && /B1- 1대/.test(chk), '새 번호 2 · B1F→B1 1 — ' + chk.split('\n').filter(l => /새 번호|B1-/.test(l)).join(' / '));
  await pc.screenshot({ path: 'shot_eh_import.png' });
  await pc.click('#ehXb'); await pc.waitForSelector('.ehtbl');
  ok((await pc.locator('.ehsrow').count()) === 3, 'PC: 1F 매장 3곳 왼쪽 목록');
  ok((await pc.locator('.ehfl.on').innerText()).replace(/\s+/g, ' ') === '1F 3곳 · 16', '층 단추: 1F 3곳 · 16');
  await pc.click('.ehsrow:has-text("까르띠에")');
  ok((await pc.locator('.ehtbl tbody .ehno').innerText()) === '1F-3-1', '번호 없던 기기 → 새 매장번호 1F-3-1');
  await pc.click('.ehsrow:has-text("발렌티노")');
  const rows = pc.locator('.ehtbl tbody input[type=checkbox]');
  for (const i of [0, 2]) await rows.nth(i).check();
  await pc.click('.ehsrow:has-text("아주아주긴")');
  await pc.locator('.ehtbl tbody input[type=checkbox]').first().check();
  ok(/필증 출력 \(3\)/.test(await pc.locator('.ehph').innerText()), '매장을 옮겨도 고른 것 유지 (3)');
  ok(!(await overflow(pc)), 'PC 옆 넘침 없음');
  ok(!/매장명\s*:/.test(await pc.locator('.ehph').innerText()), '엑셀 칸 서식 「매장명 :」 빠짐');
  const npc = await pc.locator('.ehtbl .c-bad').first().evaluate(e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, c: s.color, navy: (d => { d.style.color = 'var(--navy)'; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; })(document.createElement('i')) }; });
  ok(npc.bg === 'rgba(0, 0, 0, 0)' && npc.c === npc.navy, '필증 칸 「미출력」: 배경 없음 · 남색 글자 ' + JSON.stringify(npc));
  const bad = await pc.evaluate(() => { const d = document.createElement('span'); d.className = 'chip c-bad'; document.body.append(d); const s = getComputedStyle(d), v = [s.color, s.backgroundColor]; d.remove(); return v; });
  ok(bad[0] === 'rgb(255, 255, 255)' && bad[1] === 'rgb(30, 58, 95)', '공통 「문제」 표시: 남색 배경에 흰 글자 ' + bad);
  await pc.locator('.ehtbl').screenshot({ path: 'shot_eh_chip.png' });
  await pc.screenshot({ path: 'shot_eh_pc.png' });
  // 여러 PC 해상도: 표·단추가 잘리지 않음 (긴 매장명). 1024보다 좁으면 매장 상자 화면
  for (const w of [1024, 1152, 1280, 1440, 1920]) {
    await pc.setViewportSize({ width: w, height: 800 }); await pc.waitForSelector('.ehtbl');
    const cut = await pc.evaluate(() => { const p = document.querySelector('.ehpanel').getBoundingClientRect(), t = document.querySelector('.ehtw');
      return [...document.querySelectorAll('.ehph button, .ehtbl th')].some(e => e.getBoundingClientRect().right > p.right + 1) || t.scrollWidth > t.clientWidth + 1; });
    ok(!cut && !(await overflow(pc)), 'PC ' + w + 'px: 표·단추 잘림 없음');
    if (w === 1024) await pc.screenshot({ path: 'shot_eh_pc1024.png' });
  }
  await pc.setViewportSize({ width: 960, height: 800 }); await pc.waitForSelector('.ehst');
  ok(!(await overflow(pc)) && /출력/.test(await pc.locator('.nwbar').innerText()), '960px: 매장 상자 화면 · 아래 막대에 출력 단추');
  await pc.setViewportSize({ width: 1366, height: 900 }); await pc.waitForSelector('.ehtbl');
  // 검색창: 글자를 칠 때 입력칸을 새로 만들지 않음 (새로 만들면 한글 조합이 끊겨 ㄱㅏ처럼 따로 들어감)
  await pc.evaluate(() => { window.__q = document.getElementById('ehQ'); });
  await pc.click('#ehQ'); await pc.keyboard.insertText('알렉');
  ok(await pc.evaluate(() => window.__q === document.getElementById('ehQ') && document.activeElement === window.__q && window.__q.value === '알렉'), '검색창 그대로 (한글 조합 안 끊김)');
  await pc.waitForSelector('.row:has-text("알렉산드르")'); await pc.fill('#ehQ', ''); await pc.waitForSelector('.ehtbl');
  await pc.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await pc.click('button:has-text("필증 출력")'); await pc.waitForSelector('text=필증 미리보기');
  const lab = await pc.$$eval('.ehpv .ehl', ls => ls.map(l => {
    const r = l.getBoundingClientRect(), mm = r.width / 50, q = l.querySelector('.q img').getBoundingClientRect(), g = l.querySelector('.ehlogo').getBoundingClientRect();
    const cut = [...l.querySelectorAll('.v,.k')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
    const qrIn = q.bottom <= l.querySelector('.ehg').getBoundingClientRect().bottom + 0.5;
    return { w: Math.round(r.width), h: Math.round(r.height), qr: +(q.width / mm).toFixed(1), logo: +(g.width / mm).toFixed(1), cut, qrIn, text: l.innerText.replace(/\s+/g, ' ') };
  }));
  ok(lab.length === 3 && lab.every(x => x.w === x.h), '미리보기 3장 정사각형 ' + lab.map(x => x.w + 'x' + x.h));
  ok(lab.every(x => x.logo === 6), '로고 6mm ' + lab.map(x => x.logo));
  ok(lab.every(x => x.qr >= 15 && x.qrIn), 'QR 15mm 이상 · 칸 안에 ' + lab.map(x => x.qr));
  ok(lab.every(x => !x.cut.length), '글자 잘림 없음 ' + JSON.stringify(lab.map(x => x.cut)));
  ok(/1F-1-1/.test(lab[0].text) && /시설소장/.test(lab[0].text) && /1,200 W|45 W/.test(lab.map(x => x.text).join()), '필증 내용: 관리번호 · 용량 · 승인 시설소장');
  ok(/아주아주긴이름/.test(lab[2].text), '긴 매장명도 한 줄 (글자 줄임)');
  const qrText = await pc.evaluate(() => { const i = ehItem(S.ehPv[0]); return ehUrl(i.token); });
  ok(/\?eh=[2-9a-km-np-z]{12}$/.test(qrText), 'QR 주소 ?eh= ' + qrText);
  await pc.screenshot({ path: 'shot_eh_preview.png' });
  await pc.click('#ehGo'); await pc.waitForTimeout(800);
  ok(await pc.evaluate(() => window.__printed === 1), '인쇄 호출');
  ok((await pc.locator('.ehtbl .chip.c-ok').count()) === 1 && (await pc.locator('#print .ehl').count()) === 3, '인쇄 뒤 「출력함」 표시 · 인쇄 칸 3장');
  await pc.emulateMedia({ media: 'print' });
  await pc.evaluate(() => { const pr = document.getElementById('print'); pr.style.cssText = 'display:flex;flex-wrap:wrap;gap:4mm;padding:4mm;background:#ccc'; });
  await pc.locator('#print').screenshot({ path: 'shot_eh_label.png' });
  await pc.emulateMedia({ media: 'screen' });

  // ── 휴대폰: 검색 · 매장 추가 · 기기 추가·편집 · 선택 삭제
  const ph = await open(await ctx({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 }));
  await ph.waitForSelector('.ehst');
  ok(!(await ph.locator('button:has-text("엑셀 가져오기")').count()) && !(await ph.locator('button:has-text("필증 출력")').count()), '휴대폰: 가져오기·출력 단추 없음');
  await ph.fill('#ehQ', '고디'); await ph.waitForSelector('.row:has-text("고디바")');
  await ph.click('.row:has-text("고디바")'); await ph.waitForSelector('.ehfl.on:has-text("B1")');
  ok((await ph.locator('.ehit .ehno').first().innerText()) === 'B1-13-1', '검색 → B1 고디바 펼침 · B1F- → B1-');
  await ph.fill('#ehQ', '온수'); await ph.waitForSelector('.row:has-text("고디바")');
  ok((await ph.locator('.row').count()) === 1 && (await ph.locator('.row .ehdv').innerText()) === '온수기', '기기명 검색: 다른 층 고디바 · 맞은 기기명 「온수기」');
  await ph.screenshot({ path: 'shot_eh_search_dev.png' });
  await ph.fill('#ehQ', '');
  await ph.click('.ehfl:has-text("팝업")'); await ph.waitForSelector('.ehst:has-text("필리포 피아나")');
  await ph.click('.ehsn:has-text("필리포")');
  ok((await ph.locator('.ehit .ehno').first().innerText()) === '팝업-1-1', '팝업 매장 번호 팝업-1-1');
  await ph.click('.ehfl:has-text("1F")'); await ph.waitForSelector('.ehst:has-text("발렌티노")');
  await ph.click('button:has-text("＋ 매장 추가")'); await ph.fill('#esN', '시험매장'); await ph.click('#esB');
  await ph.waitForSelector('.ehst:has-text("시험매장") .ehadd');
  await ph.click('.ehst:has-text("시험매장") .ehadd button');
  ok((await ph.locator('.ehro').innerText()).indexOf('1F-4-') === 0, '새 매장번호 4 · 관리번호 자동 표시');
  await ph.fill('#eiN', '전기포트'); await ph.fill('#eiW', '1,500');
  ok(!(await overflow(ph)), '입력 창 옆 넘침 없음');
  await ph.screenshot({ path: 'shot_eh_form.png' });
  await ph.click('#eiS'); await ph.waitForSelector('.ehst:has-text("시험매장") .ehit');
  ok((await ph.locator('.ehst:has-text("시험매장") .ehno').innerText()) === '1F-4-1', '기기 추가 1F-4-1 (책임자는 앞 기기 값)');
  await ph.click('.ehst:has-text("시험매장") .ehed'); await ph.fill('#eiW', '1800'); await ph.click('#eiS');
  await ph.waitForSelector('.ehst:has-text("시험매장") .ehw:has-text("1,800")');
  ok(true, '기기 편집 (용량 1,800)');
  await ph.click('.ehsn:has-text("발렌티노")');
  await ph.locator('.ehst:has-text("발렌티노") .ehit input').nth(1).check();
  await ph.locator('.ehst:has-text("시험매장") .ehsh input').check();
  ok(/2대 선택/.test(await ph.locator('.nwbar').innerText()), '아래 막대: 2대 선택 · 필증 삭제');
  ok(!(await overflow(ph)), '휴대폰 옆 넘침 없음');
  await ph.screenshot({ path: 'shot_eh_phone.png' });
  await ph.click('.nwbar button:has-text("필증 삭제")'); await ph.click('#edB');
  await ph.waitForSelector('.ehst:has-text("시험매장") .ehcnt:has-text("0대")');
  ok(!(await ph.locator('.nwbar').count()), '필증 2장 삭제 → 선택 풀림');
  await ph.click('.ehst:has-text("시험매장") .ehmore'); await ph.click('button:has-text("매장 삭제")'); await ph.click('#sdB');
  await ph.waitForTimeout(500);
  ok(!(await ph.locator('.ehst:has-text("시험매장")').count()), '매장 삭제');
  ok(!errs.length, '화면 오류 없음 ' + errs.join(' | '));
  await b.close();
})();
