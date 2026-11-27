// 열화상 리포트 자동 작성 단추 시험 (결정 262): 모바일은 「PC에서만 작업 가능합니다」 토스트, PC는 실행 안내 토스트 + 같은 화면에 머묾
const { chromium } = require('playwright');
const fs = require('fs');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
(async () => {
  await fetch('http://localhost:8123/seed');
  const SG = fs.readFileSync(__dirname + '/sig_b64.txt', 'utf8');
  await run('login', '1234', 'x', SG);
  const b = await chromium.launch();
  const errs = [];
  const open = async (opt) => {
    const c = await b.newContext(opt);
    await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
    for (const k of '1234') await p.click(`.key:text-is("${k}")`);
    await p.waitForSelector('.grid6'); await p.click('.tile:has(b:text-is("점검"))'); await p.waitForSelector('.row:has-text("열화상 리포트 자동 작성")');
    return p;
  };
  const m = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.click('.row:has-text("열화상 리포트 자동 작성")');
  await m.waitForSelector('.toast');
  ok(/PC에서만 작업 가능합니다/.test(await m.locator('.toast').first().innerText()) && await m.locator('.row:has-text("열화상 리포트 자동 작성")').count() === 1, '모바일: 「PC에서만 작업 가능합니다」 토스트, 화면은 점검 메뉴 그대로');
  const d = await open({ viewport: { width: 1280, height: 800 } });
  await d.click('.row:has-text("열화상 리포트 자동 작성")');
  await d.waitForSelector('#thguide');
  ok(/처음 한 번/.test(await d.locator('#thguide').innerText()) && await d.locator('#thdl').getAttribute('href') === 'https://avenuel-fm.github.io/fm/ws/thermal_register.bat' && await d.locator('.row:has-text("열화상 리포트 자동 작성")').count() === 1, 'PC 처음: 등록 안내 팝업 + 등록 파일 받기 · 화면은 점검 메뉴 그대로');
  await d.click('#thx'); ok(await d.locator('#thguide').count() === 0, '닫기: 팝업 닫힘, 등록 표시 없음 (다시 누르면 또 안내)');
  await d.click('.row:has-text("열화상 리포트 자동 작성")'); await d.waitForSelector('#thguide');
  await d.click('#thgo'); await d.waitForSelector('.toast');
  ok(await d.locator('#thguide').count() === 0 && /열화상 리포트를 실행합니다/.test(await d.locator('.toast').last().innerText()) && await d.evaluate(() => localStorage.getItem('ws_thermal_reg')) === '1', '「등록했어요」: 팝업 닫고 실행 안내 · 등록 표시 저장');
  await d.waitForTimeout(300); await d.click('.row:has-text("열화상 리포트 자동 작성")'); await d.waitForTimeout(400);
  ok(await d.locator('#thguide').count() === 0, '등록 뒤: 팝업 없이 바로 실행');
  ok(!errs.length, '화면 오류 없음 ' + errs.join(' / '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
