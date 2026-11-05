const { chromium } = require('playwright');
(async () => {
  const items = await (await fetch('http://localhost:8123/seed')).json();
  const tok = items[0].token;
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8124/ws/?fe=' + tok);
  const fr = p.frameLocator('iframe');
  await fr.locator('#send').waitFor();
  console.log('껍데기 안 QR 페이지 제목:', await fr.locator('h1').textContent());
  console.log('넘긴 주소:', await p.locator('iframe').getAttribute('src'));
  await p.screenshot({ path: 'shot_shell.png' });
  const p2 = await c.newPage(); await p2.goto('http://localhost:8124/');
  console.log('앱 모음:', (await p2.locator('a.app').allTextContents()).join(' | '));
  console.log('오류:', errs.length ? errs : '없음');
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
