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
    await p.waitForSelector('.grid6'); await p.click('.tile:has(b:text-is("점검"))'); await p.click('text=공사장 점검');
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
  ok(await p.locator('.csrow').count() === 2 && await p.locator('.cschip.wait').count() === 2, '현장 2곳 · 모두 점검 전');

  // 현장 점검
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit').count() === 9, '기본 항목 9개');
  ok(/처음 저장할 때/.test(await p.locator('.csmeta').innerText()), '저장 전: 점검 시각은 처음 저장할 때');
  const seg = (i, s) => p.locator('.csit').nth(i).locator(`.csseg button:text-is("${s}")`).click();
  for (const i of [0, 1, 2, 4, 5, 8]) await seg(i, '양호');
  await seg(6, '해당없음'); await seg(3, '미흡'); await seg(7, '미흡');
  await p.locator('.csit').nth(3).locator('textarea').fill('3구역 감지기 덮개 씌운 채 퇴근. 업체에 해제 요청.');
  await p.locator('.csit').nth(0).locator('input[type=file]').setInputFiles(__dirname + '/gauge.jpg');
  await p.waitForSelector('.csit >> nth=0 >> img');
  await p.locator('.csit').nth(3).locator('input[type=file]').setInputFiles(__dirname + '/gauge.jpg');
  await p.locator('.csit').nth(3).locator('img').first().waitFor();
  await p.locator('.csit').nth(3).locator('input[type=file]').setInputFiles(__dirname + '/gauge.jpg');
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
  ok((pdf.match(/class="pc"/g) || []).length === 10 && /5F 리모와/.test(pdf) && /공사관리/.test(pdf), 'PDF 화면: 항목 10칸 · 현장 · 점검자');
  const pp = await b.newPage({ viewport: { width: 794, height: 1123 } });
  const css = await p.evaluate(() => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
  await pp.setContent('<style>' + css + '</style><div style="padding:30px;background:#fff">' + pdf + '</div>');
  await pp.evaluate(() => document.querySelectorAll('.cell img').forEach(im => { const c = im.parentNode, sc = Math.min(c.clientWidth / im.naturalWidth, c.clientHeight / im.naturalHeight) || 1; im.style.width = Math.floor(im.naturalWidth * sc) + 'px'; im.style.height = Math.floor(im.naturalHeight * sc) + 'px'; }));
  await pp.screenshot({ path: __dirname + '/shot_cs_pdf.png', fullPage: true });

  // 다시 열기 → 저장한 것 그대로
  await p.click('.backbar button'); await p.waitForSelector('.cshd');
  ok(await p.locator('.csrow:has-text("5F 리모와") .cschip.bad').innerText() === '미흡 2' && await p.locator('.csrow:has-text("5F 리모와") a:has-text("PDF")').count() === 1, '목록: 미흡 2 · PDF 단추');
  await p.screenshot({ path: __dirname + '/shot_cs_list.png' });
  await p.click('.csrow:has-text("5F 리모와") .csgo'); await p.waitForSelector('.csit');
  ok(await p.locator('.csit').count() === 10 && await p.locator('.csit').nth(3).locator('img').count() === 2 && /감지기 덮개/.test(await p.locator('.csit').nth(3).locator('textarea').inputValue()), '다시 열면 사진·메모·추가 항목 그대로');
  await p.click('.backbar button'); await p.waitForSelector('.cshd');

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
