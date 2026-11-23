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
    if (pin === '4321') {
      ok(await p.locator('.row').count() === 4 && !(await p.locator('text=일일 점검').count()) && !(await p.locator('text=월간 점검').count()), '점검 메뉴: 소화기·전열필증·열화상점검·공사장 4개 (일일·월간 없음)');
      const th = await p.evaluate(() => { const r = [...document.querySelectorAll('.row')]; const i = r.findIndex(x => /열화상점검/.test(x.textContent)); return { i, off: i >= 0 && r[i].disabled, role: S.user.role }; });
      ok(th.i === 2 && th.off === false, '결정212: 열화상점검은 전열필증 아래, 모든 직원에게 켜짐 (' + th.role + ')');
    }
    await p.click('text=공사장 점검');
    await p.waitForSelector('.cshd'); return p;
  };
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

  const p = await open('4321');
  ok(await p.locator('text=진행 중인 공사 현장이 없습니다').count() === 1, '처음: 현장 없음 안내');
  ok(await p.locator('button:has-text("기본 항목 고치기 (2 / 9)")').count() === 1, '관리자: 기본 항목 고치기 (2 / 9)');
  for (const [n, w, co] of [['5F 리모와', '매장 철거', '대성건설'], ['3F 메종키츠네', '매장 인테리어', '한빛인테리어']]) {
    await p.click('text=새 공사 현장 추가'); await p.fill('#csN', n); await p.fill('#csW', w); await p.fill('#csC', co); await p.click('#csSb');
    await p.waitForSelector(`.csrow:has-text("${n}")`);
  }
  ok(await p.locator('.csrow').count() === 2 && await p.locator('.csrd .wait').count() === 4 && /하루 2번 \(오후점검 · 퇴실점검\)/.test(await p.locator('.cshd').innerText()), '현장 2곳 · 오후점검·퇴실점검 모두 전');
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
  ok(await p.locator('.csbtns button:has-text("새 공사 현장 추가") + button:has-text("공사 완료")').count() === 1 && await p.locator('.csbtns button:has-text("기본 항목 고치기 (2 / 9)")').count() === 1, '[새 공사 현장 추가] 옆에 [공사 완료], 아래 줄에 [기본 항목 고치기 (2 / 9)]');
  // 처음엔 「점검에 넣기」 2개만: 오후점검은 1. 정리정돈·통로 · 2. 안전수칙 위반 (나가도 줄 안 생김)
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit').count() === 2 && /^1\. 정리정돈·통로/.test(await p.locator('.csit h3').first().innerText()) && /^2\. 안전수칙 위반/.test(await p.locator('.csit h3').nth(1).innerText()), '오후점검 = 정리정돈·통로 · 안전수칙 위반 → 1·2번');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: __dirname + '/shot_cs_two.png' });
  await p.evaluate(() => back()); await p.waitForSelector('.cshd');
  // 관리자: 기본 항목에서 「점검에 넣기」 모두 체크 → 9 / 9 (아래 시험은 9개로)
  await p.click('button:has-text("기본 항목 고치기")');
  ok(await p.locator('.csitems .csuse input:checked').count() === 2, '기본 항목: 체크는 2개 (8·9번)');
  await p.locator('.csitems .row').first().screenshot({ path: __dirname + '/shot_cs_use.png' });
  for (const c of await p.locator('.csitems .csuse input').all()) await c.check();
  await p.click('#ciSb'); await p.waitForSelector('button:has-text("기본 항목 고치기 (9 / 9)")');
  ok(true, '「점검에 넣기」 모두 체크 → 기본 항목 고치기 (9 / 9)');

  // 현장 점검
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit').count() === 9, '기본 항목 9개');
  ok(/오후점검/.test(await p.locator('.csrtabs .on').innerText()) && await p.locator('.csrtabs button').count() === 2 && await p.locator('.csrtabs button:disabled').count() === 1, '첫 점검 = 오후점검 (퇴실점검은 아직 못 누름, 칸 2개)');
  ok(/처음 저장할 때/.test(await p.locator('.csmeta').innerText()), '저장 전: 점검 시각은 처음 저장할 때');
  { // 사진 넣기 (사용자 11-24): [카메라](capture) · [파일](여러 장) 버튼 2개, 빈 점선 칸 없음, 최대 6장
    const it0 = p.locator('.csit').nth(0), f0 = it0.locator('.csphb input');
    ok(await it0.locator('label.ph43').count() === 0 && await it0.locator('.csphb label').count() === 2 && /카메라/.test(await it0.locator('.csphb label').nth(0).innerText()) && /파일/.test(await it0.locator('.csphb label').nth(1).innerText()), '사진: [카메라] [파일] 버튼 2개, 빈 점선 칸 없음');
    ok(await f0.nth(0).getAttribute('capture') === 'environment' && await f0.nth(1).getAttribute('capture') === null && await f0.nth(1).getAttribute('multiple') !== null, '카메라는 바로 찍기(capture), 파일은 여러 장 고르기(multiple)');
    ok(/사진 0 \/ 6장/.test(await it0.locator('.csphn').innerText()) && await it0.locator('.csph img').count() === 0, '사진 0 / 6장 · 사진 없으면 사진 줄 없음');
    const it = p.locator('.csit').nth(8);   // 항목 9: 카메라로 4장 → 파일로 3장 고르면 남은 2장만 (6장)
    for (let n = 1; n <= 4; n++) {
      await it.locator('.csphb input').first().setInputFiles(__dirname + '/gauge.jpg');
      await p.waitForFunction(k => document.querySelectorAll('.csit')[8].querySelectorAll('img').length === k, n);
      await p.waitForSelector('.csst.ok', { timeout: 10000 });   // 자동 저장 뒤 다시 그린 다음에 봄
    }
    await it.screenshot({ path: __dirname + '/shot_cs_photos.png' });
    ok(/사진 4 \/ 6장/.test(await it.locator('.csphn').innerText()), '4장: 사진 4 / 6장');
    await p.evaluate(() => { window.__toasts = []; const o = window.toast; window.toast = m => { window.__toasts.push(m); return o(m); }; });   // 알림은 금방 다른 글로 바뀌어 기록해 둠
    await it.locator('.csphb input').nth(1).setInputFiles([__dirname + '/gauge.jpg', __dirname + '/gauge.jpg', __dirname + '/gauge.jpg']);
    await p.waitForFunction(() => document.querySelectorAll('.csit')[8].querySelectorAll('img').length === 6);
    await p.waitForSelector('.csst.ok', { timeout: 10000 });
    ok(await it.locator('img').count() === 6 && await it.locator('.csphb input:disabled').count() === 2, '파일로 3장 고르면 남은 2장만 들어가 6장 · 두 버튼 꺼짐');
    ok((await p.evaluate(() => window.__toasts)).some(m => /6장까지/.test(m)), '넘치면 「한 항목에 6장까지」 알림');
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
  await p.click('.csbar button:has-text("점검 끝")');
  await p.waitForSelector('.csbar a:has-text("PDF 보기")', { timeout: 15000 });
  const pdf = await p.evaluate(() => window.__pdfEl || '');
  ok((pdf.match(/class="pc"/g) || []).length === 10 && /5F 리모와/.test(pdf) && /공사관리/.test(pdf) && /오후점검/.test(pdf), 'PDF 화면: 항목 10칸 · 현장 · 점검자 · 오후점검');
  const pp = await b.newPage({ viewport: { width: 794, height: 1123 } });
  const css = await p.evaluate(() => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
  await pp.setContent('<style>' + css + '</style><div style="padding:30px;background:#fff">' + pdf + '</div>');
  await pp.evaluate(() => document.querySelectorAll('.cell img').forEach(im => { const c = im.parentNode, sc = Math.min(c.clientWidth / im.naturalWidth, c.clientHeight / im.naturalHeight) || 1; im.style.width = Math.floor(im.naturalWidth * sc) + 'px'; im.style.height = Math.floor(im.naturalHeight * sc) + 'px'; }));
  await pp.screenshot({ path: __dirname + '/shot_cs_pdf.png', fullPage: true });

  // 다시 열기 → 저장한 것 그대로
  ok(await p.locator('.backbar').count() === 0 && await p.locator('.csbar-in > .back-in:first-child').count() === 1, '뒤로 버튼은 아래 줄 맨 왼쪽 (WS-25)');
  await p.click('.csbar .back-in'); await p.waitForSelector('.cshd');
  ok(await p.locator('.csrow:has-text("5F 리모와") .csrd .bad').innerText() === '오후점검 미흡 2' && await p.locator('.csrow:has-text("5F 리모와") a:has-text("PDF")').count() === 1, '목록: 오후점검 미흡 2 · PDF 단추');

  // 두 번째 = 오후 (빈 칸에서 시작) → 오전 칸 눌러 오전 그대로 → PDF 한 파일에 오전·오후
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(/퇴실점검/.test(await p.locator('.csrtabs .on').innerText()) && /\d\d:\d\d 공사관리/.test(await p.locator('.csrtabs button').first().innerText()) && await p.locator('.csit').count() === 9 && await p.locator('.csit img').count() === 0 && await p.locator('.csseg .on').count() === 0, '두 번째 점검 = 퇴실점검, 빈 칸에서 시작 (오후점검 시각·점검자)');
  ok(/퇴실점검 시각/.test(await p.locator('.csmeta').innerText()), '퇴실점검 시각 칸');
  await p.locator('.csit').nth(0).locator('.csseg button:text-is("양호")').click();
  await p.waitForSelector('.csst.ok', { timeout: 10000 });
  ok(await p.locator('.csrtabs button:disabled').count() === 0, '퇴실점검 저장 뒤 두 칸 다 누를 수 있음');
  ok(!(await overflow(p)), '회차 칸 · 휴대폰 가로 넘침 없음');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: __dirname + '/shot_cs_round.png' });
  await p.locator('.csrtabs button').first().click();
  await p.waitForFunction(() => /오후점검/.test((document.querySelector('.csrtabs .on') || {}).textContent || '') && document.querySelectorAll('.csit').length === 10);
  ok(await p.locator('.csit').nth(3).locator('img').count() === 2 && /감지기 덮개/.test(await p.locator('.csit').nth(3).locator('textarea').inputValue()), '오후점검 칸 → 사진·메모·추가 항목 그대로');
  ok(!/PDF 보기/.test(await p.locator('.csbar').innerText()) && /점검 끝/.test(await p.locator('.csbar').innerText()), '퇴실점검을 더했으니 옛 PDF 대신 「점검 끝」');
  await p.evaluate(() => { window.__pdfEl = ''; }); await p.click('.csbar button:has-text("점검 끝")');
  await p.waitForSelector('.csbar a:has-text("PDF 보기")', { timeout: 15000 });
  const pdf2 = await p.evaluate(() => window.__pdfEl || '');
  ok((pdf2.match(/class="cspdf"/g) || []).length === 2 && /오후점검[\s\S]*퇴실점검/.test(pdf2) && /page-break-before/.test(pdf2) && (pdf2.match(/class="pc"/g) || []).length === 19, 'PDF 한 파일: 오후점검(10칸) → 새 쪽 퇴실점검(9칸)');
  await p.click('.csbar .back-in'); await p.waitForSelector('.csrow:has-text("5F 리모와") .csrd .ok:text-is("퇴실점검 양호")');
  ok(await p.locator('.csrow:has-text("5F 리모와") .csrd .ok:text-is("퇴실점검 양호")').count() === 1 && await p.locator('.csrow:has-text("5F 리모와") .csrd span').count() === 2, '목록: 오후점검 미흡 2 · 퇴실점검 양호 (딱지 2개)');
  ok(/오후점검\s*1 \/ 2곳/.test(await p.locator('.csrsum').innerText()) && /퇴실점검\s*1 \/ 2곳/.test(await p.locator('.csrsum').innerText()), '위 칸: 오후점검 1/2곳 · 퇴실점검 1/2곳');
  await p.screenshot({ path: __dirname + '/shot_cs_list.png' });

  // 관리자 기본 항목: 하나 지우고 하나 더하기
  await p.click('button:has-text("기본 항목 고치기")');
  await p.locator('.csitems .row').nth(6).locator('button:has-text("지우기")').click();
  await p.fill('#ciT', '양중 작업'); await p.fill('#ciD', '크레인 신호수'); await p.click('text=목록에 더하기');
  ok(await p.locator('.csitems .row').count() === 9 && await p.locator('.csitems .row').last().locator('.csuse input:checked').count() === 1, '항목 지우기·더하기 → 9개 (새 항목은 점검에 넣기 체크)');
  await p.click('#ciSb'); await p.waitForSelector('button:has-text("기본 항목 고치기 (9 / 9)")');
  await p.click('.csrow:has-text("3F 메종키츠네") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit h3:has-text("양중 작업")').count() === 1 && await p.locator('.csit h3:has-text("고소·사다리")').count() === 0, '새 점검은 고친 기본 항목으로');

  // 공사 완료 (결정 174): 골라서 뺌 → 오늘 목록에서 빠지고, 점검 기록은 지난 점검(날짜 아코디언)에 남아 검색됨
  await p.click('.csbar .back-in'); await p.waitForSelector('.csrow:has-text("5F 리모와")');
  await p.click('.csbtns .csdone'); await p.waitForSelector('.csdl');
  ok(await p.locator('.csdl').count() === 2 && await p.locator('#csDb').isDisabled(), '공사 완료 창: 현장 2곳, 고르기 전엔 단추 꺼짐');
  await p.locator('.csdl:has-text("5F 리모와") input').check();
  ok(/선택한 1곳 공사 완료/.test(await p.locator('#csDb').innerText()), '고르면 「선택한 1곳 공사 완료」');
  await p.click('#csDb'); await p.waitForFunction(() => !document.querySelector('.csdl'));
  await p.waitForFunction(() => document.querySelectorAll('#csRes > .cslist:first-child .csrow').length === 1);
  ok(await p.locator('#csRes > .cslist:first-child .csrow:has-text("5F 리모와")').count() === 0 && await p.locator('#csRes > .cslist:first-child .csrow:has-text("3F 메종키츠네")').count() === 1, '오늘 점검할 현장에서 5F 리모와 빠짐');
  ok(/현장 1곳/.test(await p.locator('.cshd').innerText()), '머리 칸: 현장 1곳');
  ok(await p.locator('.csacc').count() === 1 && await p.locator('.csacc').getAttribute('aria-expanded') === 'true' && await p.locator('.csacc ~ .csrow:has-text("5F 리모와")').count() === 1 && await p.locator('.csacc ~ .csrow:has-text("5F 리모와") a:has-text("PDF")').count() === 1, '지난 점검: 오늘 날짜 아코디언(펼침)에 5F 리모와 기록·PDF 남음');
  await p.click('.csacc'); ok(await p.locator('.csacc').getAttribute('aria-expanded') === 'false' && await p.locator('.csacc ~ .csrow').count() === 0, '아코디언 누르면 접힘');
  await p.fill('#csQ', '리모와'); await p.waitForFunction(() => /없음/.test(document.querySelector('#csRes').innerText));
  ok(await p.locator('.csacc').count() === 1 && await p.locator('.csacc').getAttribute('aria-expanded') === 'true' && await p.locator('.csacc ~ .csrow:has-text("5F 리모와")').count() === 1, '검색: 완료한 현장도 찾아지고 찾은 날은 펼쳐짐');
  await p.fill('#csQ', '');
  await p.click('.csrow:has-text("3F 메종키츠네") .ehmore'); await p.click('button:has-text("공사 완료") >> nth=-1'); await p.waitForFunction(() => !document.querySelector('.csrow .ehmore'));
  ok(await p.locator('.csbtns .csdone').isDisabled() && await p.locator('.csacc ~ .csrow').count() === 1, '⋯ 메뉴의 [공사 완료]로도 빠짐 · 현장 없으면 [공사 완료] 꺼짐');
  ok(!(await overflow(p)), '공사 완료·아코디언 · 휴대폰 가로 넘침 없음');
  await p.screenshot({ path: __dirname + '/shot_cs_done.png', fullPage: true });

  // 지난 점검 년도(여러 해 체크) · 월 탭 (결정 180) — 가짜 기록으로 달·해 나눔 시험
  await p.evaluate(() => {
    const mk = (date, site, name, bad) => [1, 2].map(round => ({ date, site, name, work: '', co: '', round, bad: round === 2 ? bad : 0, pdf: null }));
    S.cs.day = '2026-11-20'; S.cs.today = []; S.csYears = null; S.csMon = null; S.csOpen = {}; S.csQ = '';
    S.cs.past = [].concat(mk('2026-11-18', 's1', '5F 리모와', 1), mk('2026-10-30', 's1', '5F 리모와', 0), mk('2026-10-02', 's2', '3F 메종키츠네', 0), mk('2026-09-15', 's1', '5F 리모와', 0), mk('2025-12-20', 's1', '5F 리모와', 0), mk('2025-03-04', 's2', '3F 메종키츠네', 0));
    render();
  });
  const yrs = () => p.locator('.csyr input:checked').evaluateAll(l => l.map(x => x.nextSibling.textContent));
  const tabs = () => p.locator('.csmon').allInnerTexts();
  const days = () => p.locator('.csacc b').allInnerTexts();
  ok(await p.locator('.csyr').count() === 2 && (await yrs()).join() === '2026년', '년도 체크 2개(2026·2025), 처음엔 올해만');
  ok((await days())[0] === '11월 18일 (수)' && (await tabs()).join() === '10월,9월' && (await p.locator('.csmon.on').innerText()) === '10월', '이번 달은 날짜 아코디언, 지난달은 탭(10월 · 9월), 처음엔 가장 최근 달');
  ok((await days()).join('|') === '11월 18일 (수)|10월 30일 (금)|10월 2일 (금)', '10월 탭: 30일 · 2일 (9월 것은 안 보임)');
  await p.click('.csmon:text-is("9월")'); ok((await days()).join('|') === '11월 18일 (수)|9월 15일 (화)' && await p.locator('.csmon.on').innerText() === '9월', '9월 탭 누르면 9월 날짜만');
  await p.locator('.csyr:has-text("2025년") input').check();
  ok((await yrs()).join() === '2026년,2025년' || (await yrs()).join() === '2025년,2026년', '여러 해 동시에 체크');
  ok((await tabs()).join() === '26년 10월,26년 9월,25년 12월,25년 3월', '두 해 이상이면 탭에 「26년 10월」처럼 년도 붙음');
  await p.locator('.csyr:has-text("2026년") input').uncheck();
  ok((await tabs()).join() === '12월,3월' && await p.locator('.cssub:has-text("이번 달")').count() === 0 && (await days()).join('|') === '12월 20일 (토)', '2025만 체크: 12월 · 3월 탭, 이번 달 없음');
  await p.locator('.csyr:has-text("2025년") input').click();
  ok(await p.locator('.csyr input:checked').count() === 1, '마지막 하나는 못 끔');
  await p.fill('#csQ', '리모와'); await p.waitForFunction(() => !document.querySelector('.csyr'));
  ok(await p.locator('.csmon').count() === 0 && await p.locator('.csacc').count() === 4 && await p.locator('.csacc.on').count() === 4, '검색하면 년도·탭 없이 전체 해에서 찾고 모두 펼침 (4일)');
  await p.fill('#csQ', ''); await p.waitForSelector('.csyr');
  ok(!(await overflow(p)), '년도·월 탭 · 휴대폰 가로 넘침 없음');
  await p.screenshot({ path: __dirname + '/shot_cs_year.png', fullPage: true });

  // 소장(홍길동)은 단추 있음, 직원(김철수)은 없음
  const z = await open('1234');
  ok(await z.locator('button:has-text("기본 항목 고치기")').count() === 1, '소장도 기본 항목 단추 있음');
  const q = await open('5678');
  ok(await q.locator('button:has-text("기본 항목 고치기")').count() === 0, '직원은 기본 항목 단추 없음');
  ok(!errs.length, '화면 오류 없음 ' + errs.join(' / '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
