const { chromium } = require('playwright');
(async () => {
  const items = await (await fetch('http://localhost:8123/seed')).json();
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.addInitScript(() => {  // 손전등 되는 휴대폰 흉내
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (o) => { const s = await orig(o); const t = s.getVideoTracks()[0];
      t.getCapabilities = () => ({ torch: true }); t.applyConstraints = async (x) => { window.__torch = x.advanced[0].torch; }; return s; };
  });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8124/ws/?fe=' + items[2].token); await p.waitForSelector('.shot');
  await p.click('.shot'); await p.waitForSelector('#torch:not(.hide)');
  await p.click('#torch'); console.log('손전등 켬:', await p.evaluate(() => window.__torch), await p.locator('#torch').getAttribute('aria-label'));
  await p.screenshot({ path: 'shot_gh_torch.png' });
  await p.click('#torch'); console.log('손전등 끔:', await p.evaluate(() => window.__torch));
  console.log('오류:', errs.length ? errs : '없음'); await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
