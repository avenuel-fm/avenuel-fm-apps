const { chromium } = require('playwright');
(async () => {
  const items = await (await fetch('http://localhost:8123/seed')).json();
  const tok = items[0].token;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8124/ws/?fe=' + tok);
  await p.waitForSelector('#send');
  console.log('열린 주소:', p.url().replace(tok, '<번호>'));
  console.log('제목:', await p.locator('h1').textContent());
  await p.screenshot({ path: 'shot_gh_form.png' });
  await p.click('.shot');
  await p.waitForFunction(() => { const v = document.getElementById('vid'); return v && v.videoWidth > 0; }, null, { timeout: 8000 });
  console.log('실시간 카메라:', await p.evaluate(() => { const v = document.getElementById('vid'); return v.videoWidth + 'x' + v.videoHeight; }), '/ 원 겹침:', await p.locator('.view svg').count());
  console.log('손전등 버튼(가짜 카메라는 미지원이라 숨김이 정상):', await p.locator('#torch').isVisible());
  await p.screenshot({ path: 'shot_gh_cam.png' });
  await p.click('#shutter');
  await p.waitForSelector('text=이 사진 쓰기');
  await p.screenshot({ path: 'shot_gh_confirm.png' });
  await p.click('button:has-text("이 사진 쓰기")');
  // 손글씨
  for (const id of ['#padA', '#padB']) {
    await p.locator(id).evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(150);
    const bx = await p.locator(id + ' canvas.i').boundingBox();
    await p.mouse.move(bx.x + 30, bx.y + 60); await p.mouse.down();
    for (let k = 0; k < 20; k++) await p.mouse.move(bx.x + 30 + k * 12, bx.y + 50 + (k % 2) * 25);
    await p.mouse.up();
  }
  await p.screenshot({ path: 'shot_gh_filled.png', fullPage: true });
  console.log('전송 버튼 켜짐:', await p.locator('#send').isEnabled());
  await p.click('#send');
  await p.waitForSelector('text=보냈습니다', { timeout: 8000 });
  console.log('전송 결과:', await p.locator('.main b').first().textContent());
  console.log('저장 번호 표시:', await p.locator('text=저장 번호').textContent());
  const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
  const L = await run('login', '1234', 'pc'); const st = await run('feStatus', L.token, '');
  const it = st.items.find(i => i.name === items[0].name);
  console.log('현황 집계:', '전체 ' + st.counts.total + '대 · 점검완료 ' + st.counts.ok + ' ·', it.name, '→', it.state);
  // 구글 웹앱 안 화면(대체 경로)도 그대로 동작하는지
  const p2 = await c.newPage(); await p2.goto('http://localhost:8123/check?fe=' + items[1].token); await p2.waitForSelector('#send');
  console.log('구글 웹앱 안 화면도 열림:', await p2.locator('h1').textContent());
  console.log('오류:', errs.length ? errs : '없음');
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
