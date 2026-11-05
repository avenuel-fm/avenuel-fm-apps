const { chromium } = require('playwright');
(async () => { const items = await (await fetch('http://localhost:8123/seed')).json();
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 600 }, deviceScaleFactor: 2 });
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); await p.goto('http://localhost:8124/ws/?fe=' + items[3].token); await p.waitForSelector('.shot');
  await p.screenshot({ path: 'shot_gh_button.png' }); await b.close(); })();
