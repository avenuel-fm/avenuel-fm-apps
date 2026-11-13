// 공사장 점검 화면 시험 (WS_공사장점검, 결정 100): 현장 추가 → 항목 고르기·사진·메모·항목 추가 → 자동 저장 → PDF → 목록 · 관리자 기본 항목
// PDF 도구(html2pdf)는 흉내 — 넘겨받은 PDF 화면을 보관해 따로 찍어 봄. 현장·업체 이름은 시험용
const { chromium } = require('playwright');
const fs = require('fs');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const H2P = "window.html2pdf=function(){const o={set(){return o},from(el){window.__pdfEl=el.outerHTML;return o},outputPdf(){return Promise.resolve('data:application/pdf;base64,'+btoa('%PDF-1.4 '+'x'.repeat(300)))}};return o};";
const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
(async () => {
  await fetch('http://localhost:8123/seed');
  const SG = fs.readFileSync(__dirname + '/sig_b64.txt', 'utf8');
  await run('addStaff_', '공사관리', '4321', '전방파트', '관리자');
  await run('login', '4321', 'x', SG); await run('login', '5678', 'x', SG);   // 오늘 서명 미리 (PIN만 누르면 들어가게)
  const b = await chromium.launch();
  const errs = [];
  const open = async (pin) => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: /html2pdf/.test(r.request().url()) ? H2P : '' }));
    await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
    for (const k of pin) await p.click(`.key:text-is("${k}")`);
    await p.waitForSelector('.grid6'); await p.click('.tile:has(b:text-is("점검"))'); await p.waitForSelector('text=공사장 점검');
    if (pin === '4321') ok(await p.locator('.row').count() === 3 && !(await p.locator('text=일일 점검').count()) && !(await p.locator('text=월간 점검').count()), '점검 메뉴: 소화기·전열필증·공사장 3개 (일일·월간 없음)');
    await p.click('text=공사장 점검');
    await p.waitForSelector('.cshd'); return p;
  };
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

  const p = await open('4321');
  ok(await p.locator('text=진행 중인 공사 현장이 없습니다').count() === 1, '처음: 현장 없음 안내');
  ok(await p.locator('button:has-text("기본 항목 고치기 (9)")').count() === 1, '관리자: 기본 항목 고치기 (9)');
  for (const [n, w, co] of [['5F 리모와', '매장 철거', '대성건설'], ['3F 메종키츠네', '매장 인테리어', '한빛인테리어']]) {
    await p.click('text=새 공사 현장 추가'); await p.fill('#csN', n); await p.fill('#csW', w); await p.fill('#csC', co); await p.click('#csSb');
    await p.waitForSelector(`.csrow:has-text("${n}")`);
  }
  ok(await p.locator('.csrow').count() === 2 && await p.locator('.csrd .wait').count() === 6, '현장 2곳 · 오전·오후·작업종료 모두 전');
  ok(/^\d+월 \d+일 \(.\) 공사장 점검$/.test(await p.locator('.cshd b').first().innerText()) && !/순찰/.test(await p.locator('.cshd').innerText()), '제목: 「…일 (요일) 공사장 점검」');
  { // 검색: 「오늘 점검할 현장」 오른쪽 칸. 글자 칸은 그대로 두고 목록만 바뀜
    const y = await p.evaluate(() => { const s = document.querySelector('.cssec'), i = document.getElementById('csQ'); const c = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }; return [c(s), c(i), i.getBoundingClientRect().left]; });
    ok(Math.abs(y[1] - y[0]) < 10 && y[2] > 100, '검색창은 「오늘 점검할 현장」 오른쪽 같은 줄');
    const q = async v => { await p.fill('#csQ', v); };
    await p.locator('#csQ').pressSequentially('메종'); ok(await p.locator('.csrow').count() === 1 && await p.locator('.csrow:has-text("3F 메종키츠네")').count() === 1, '검색 「메종」 → 1곳');
    await q('대성'); ok(await p.locator('.csrow').count() === 1 && await p.locator('.csrow:has-text("5F 리모와")').count() === 1, '검색 「대성」(업체) → 리모와');
    const md = await p.evaluate(() => { const d = S.cs.day; return Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일'; });
    await q(md); ok(await p.locator('.csrow').count() === 2, '검색 「' + md + '」(날짜) → 2곳');
    await q('없는현장'); ok(await p.locator('.csrow').count() === 0 && await p.locator('text=없는현장」 없음').count() === 1, '없는 말 → 「없음」 안내');
    await q(''); ok(await p.locator('.csrow').count() === 2, '검색 지우면 다시 2곳');
  }
  ok(await p.locator('.csbtns button:has-text("새 공사 현장 추가") + button:has-text("기본 항목 고치기")').count() === 1, '[기본 항목 고치기]는 [새 공사 현장 추가] 옆');

  // 현장 점검
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit').count() === 9, '기본 항목 9개');
  ok(/오전/.test(await p.locator('.csrtabs .on').innerText()) && await p.locator('.csrtabs button:disabled').count() === 2, '첫 점검 = 오전 (오후·작업종료는 아직 못 누름)');
  ok(/처음 저장할 때/.test(await p.locator('.csmeta').innerText()), '저장 전: 점검 시각은 처음 저장할 때');
  ok(await p.locator('.csit').nth(0).locator('label.ph43').count() === 3, '사진 빈 칸 3개 기본');
  { // 항목 9에 사진 6장: 3장 뒤 「사진 추가」 1칸(두 번째 줄), 6장이면 칸 없음
    const it = p.locator('.csit').nth(8);
    for (let n = 1; n <= 6; n++) {
      await it.locator('input[type=file]').first().setInputFiles(__dirname + '/gauge.jpg');
      await p.waitForFunction(k => document.querySelectorAll('.csit')[8].querySelectorAll('img').length === k, n);
      await p.waitForSelector('.csst.ok', { timeout: 10000 });   // 자동 저장 뒤 다시 그린 다음에 봄
      if (n === 4) await it.screenshot({ path: __dirname + '/shot_cs_photos.png' });
      if (n === 3) ok(await it.locator('label.ph43').count() === 1 && /사진 추가/.test(await it.locator('label.ph43').innerText()), '3장 뒤 「사진 추가」 1칸');
      if (n === 3) { const y = await it.locator('.csph > *').evaluateAll(e => e.map(x => Math.round(x.getBoundingClientRect().top))); ok(y[3] > y[0] && y[0] === y[2], '4번째 칸은 두 번째 줄'); }
    }
    ok(await it.locator('label.ph43').count() === 0 && await it.locator('img').count() === 6, '6장이면 더 넣는 칸 없음');
  }
  const seg = (i, s) => p.locator('.csit').nth(i).locator(`.csseg button:text-is("${s}")`).click();
  for (const i of [0, 1, 2, 4, 5, 8]) await seg(i, '양호');
  await seg(6, '해당없음'); await seg(3, '미흡'); await seg(7, '미흡');
  await p.locator('.csit').nth(3).locator('textarea').fill('3구역 감지기 덮개 씌운 채 퇴근. 업체에 해제 요청.');
  await p.locator('.csit').nth(0).locator('input[type=file]').first().setInputFiles(__dirname + '/gauge.jpg');
  await p.waitForSelector('.csit >> nth=0 >> img');
  await p.locator('.csit').nth(3).locator('input[type=file]').first().setInputFiles(__dirname + '/gauge.jpg');
  await p.locator('.csit').nth(3).locator('img').first().waitFor();
  await p.locator('.csit').nth(3).locator('input[type=file]').first().setInputFiles(__dirname + '/gauge.jpg');
  await p.waitForFunction(() => document.querySelectorAll('.csit')[3].querySelectorAll('img').length === 2);
  ok(/미흡 2 · 양호 6 · 해당없음 1/.test(await p.locator('.csbar').innerText()), '아래 막대 셈: 미흡 2 · 양호 6 · 해당없음 1');
  ok(await p.locator('.csit.bad').count() === 2, '미흡 항목 빨간 테두리 2');
  await p.click('text=이 현장에 점검 항목 추가'); await p.fill('#cxT', '양중 작업'); await p.fill('#cxD', '크레인 신호수 배치'); await p.click('.dialog button:has-text("추가")');
  ok(await p.locator('.csit').count() === 10 && await p.locator('.csit').last().locator('button:has-text("지우기")').count() === 1, '이 현장에만 항목 추가 (지우기 단추)');
  await p.locator('.csit').last().locator('.csseg button:text-is("양호")').click();
  await p.waitForSelector('.csst.ok', { timeout: 10000 });
  ok(/공사관리/.test(await p.locator('.csmeta').innerText()) && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(await p.locator('.csmeta').innerText()), '자동 저장 → 점검자 이름·시각 찍힘');
  ok(!(await overflow(p)), '휴대폰 가로 넘침 없음');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: __dirname + '/shot_cs_check.png' });

  // PDF
  await p.click('.csbar button:has-text("점검 끝 · PDF")');
  await p.waitForSelector('.csbar a:has-text("PDF 열기")', { timeout: 15000 });
  const pdf = await p.evaluate(() => window.__pdfEl || '');
  ok((pdf.match(/class="pc"/g) || []).length === 10 && /5F 리모와/.test(pdf) && /공사관리/.test(pdf) && /오전 점검/.test(pdf), 'PDF 화면: 항목 10칸 · 현장 · 점검자 · 오전');
  const pp = await b.newPage({ viewport: { width: 794, height: 1123 } });
  const css = await p.evaluate(() => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
  await pp.setContent('<style>' + css + '</style><div style="padding:30px;background:#fff">' + pdf + '</div>');
  await pp.evaluate(() => document.querySelectorAll('.cell img').forEach(im => { const c = im.parentNode, sc = Math.min(c.clientWidth / im.naturalWidth, c.clientHeight / im.naturalHeight) || 1; im.style.width = Math.floor(im.naturalWidth * sc) + 'px'; im.style.height = Math.floor(im.naturalHeight * sc) + 'px'; }));
  await pp.screenshot({ path: __dirname + '/shot_cs_pdf.png', fullPage: true });

  // 다시 열기 → 저장한 것 그대로
  ok(await p.locator('.backbar').count() === 0 && await p.locator('.csbar-in > .back-in:first-child').count() === 1, '뒤로 버튼은 아래 줄 맨 왼쪽 (WS-25)');
  await p.click('.csbar .back-in'); await p.waitForSelector('.cshd');
  ok(await p.locator('.csrow:has-text("5F 리모와") .csrd .bad').innerText() === '오전 미흡 2' && await p.locator('.csrow:has-text("5F 리모와") a:has-text("PDF")').count() === 1, '목록: 오전 미흡 2 · PDF 단추');

  // 두 번째 = 오후 (빈 칸에서 시작) → 오전 칸 눌러 오전 그대로 → PDF 한 파일에 오전·오후
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(/오후/.test(await p.locator('.csrtabs .on').innerText()) && /✓ \d\d:\d\d 공사관리/.test(await p.locator('.csrtabs button').first().innerText()) && await p.locator('.csit').count() === 9 && await p.locator('.csit img').count() === 0 && await p.locator('.csseg .on').count() === 0, '두 번째 점검 = 오후, 빈 칸에서 시작 (오전 ✓ 시각·점검자)');
  ok(/오후 점검 시각/.test(await p.locator('.csmeta').innerText()), '오후 점검 시각 칸');
  await p.locator('.csit').nth(0).locator('.csseg button:text-is("양호")').click();
  await p.waitForSelector('.csst.ok', { timeout: 10000 });
  ok(await p.locator('.csrtabs button:disabled').count() === 0, '오후 저장 뒤 작업종료 칸 누를 수 있음');
  ok(!(await overflow(p)), '회차 칸 · 휴대폰 가로 넘침 없음');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: __dirname + '/shot_cs_round.png' });
  await p.locator('.csrtabs button').first().click();
  await p.waitForFunction(() => /오전/.test((document.querySelector('.csrtabs .on') || {}).textContent || '') && document.querySelectorAll('.csit').length === 10);
  ok(await p.locator('.csit').nth(3).locator('img').count() === 2 && /감지기 덮개/.test(await p.locator('.csit').nth(3).locator('textarea').inputValue()), '오전 칸 → 사진·메모·추가 항목 그대로');
  ok(!/PDF 열기/.test(await p.locator('.csbar').innerText()) && /점검 끝 · PDF/.test(await p.locator('.csbar').innerText()), '오후를 더했으니 옛 PDF 대신 「점검 끝 · PDF」');
  await p.evaluate(() => { window.__pdfEl = ''; }); await p.click('.csbar button:has-text("점검 끝 · PDF")');
  await p.waitForSelector('.csbar button:has-text("PDF 다시")', { timeout: 15000 });
  const pdf2 = await p.evaluate(() => window.__pdfEl || '');
  ok((pdf2.match(/class="cspdf"/g) || []).length === 2 && /오전 점검[\s\S]*오후 점검/.test(pdf2) && /page-break-before/.test(pdf2) && (pdf2.match(/class="pc"/g) || []).length === 19, 'PDF 한 파일: 오전(10칸) → 새 쪽 오후(9칸)');
  await p.click('.csbar .back-in'); await p.waitForSelector('.csrow:has-text("5F 리모와") .csrd .ok:text-is("오후 양호")');
  ok(await p.locator('.csrow:has-text("5F 리모와") .csrd .ok:text-is("오후 양호")').count() === 1 && await p.locator('.csrow:has-text("5F 리모와") .csrd .wait:text-is("작업종료 전")').count() === 1, '목록: 오전 미흡 2 · 오후 양호 · 작업종료 전');
  ok(/오전\s*1 \/ 2곳/.test(await p.locator('.csrsum').innerText()) && /오후\s*1 \/ 2곳/.test(await p.locator('.csrsum').innerText()), '위 칸: 오전 1/2곳 · 오후 1/2곳');
  await p.screenshot({ path: __dirname + '/shot_cs_list.png' });

  // 관리자 기본 항목: 하나 지우고 하나 더하기
  await p.click('button:has-text("기본 항목 고치기")');
  await p.locator('.csitems .row').nth(6).locator('button:has-text("지우기")').click();
  await p.fill('#ciT', '양중 작업'); await p.fill('#ciD', '크레인 신호수'); await p.click('text=목록에 더하기');
  ok(await p.locator('.csitems .row').count() === 9, '항목 지우기·더하기 → 9개');
  await p.click('#ciSb'); await p.waitForSelector('button:has-text("기본 항목 고치기 (9)")');
  await p.click('.csrow:has-text("3F 메종키츠네") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit h3:has-text("양중 작업")').count() === 1 && await p.locator('.csit h3:has-text("고소·사다리")').count() === 0, '새 점검은 고친 기본 항목으로');

  // 소장(홍길동)은 단추 있음, 직원(김철수)은 없음
  const z = await open('1234');
  ok(await z.locator('button:has-text("기본 항목 고치기")').count() === 1, '소장도 기본 항목 단추 있음');
  const q = await open('5678');
  ok(await q.locator('button:has-text("기본 항목 고치기")').count() === 0, '직원은 기본 항목 단추 없음');
  ok(!errs.length, '화면 오류 없음 ' + errs.join(' / '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
