const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const GU = 'https://n-test-0lu-script.googleusercontent.com';
(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let slow = 0;
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: QRLIB }));
  await c.route('https://avenuel-fm.github.io/fm/**', r => { const p = new URL(r.request().url()).pathname.replace(/^\/fm\//, ''); const f = path.join(__dirname, 'fmtest2', p.endsWith('/') || p === '' ? p + 'index.html' : p);
    r.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'application/javascript' : f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', body: fs.readFileSync(f) }); });
    await c.route(GU + '/**', async r => { const u = new URL(r.request().url());
    if (u.pathname === '/run' && global.FAIL && (r.request().postData() || '').indexOf('bootstrap') !== -1) { global.FAIL = false; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ __error: '네트워크 끊김' }) }); }
    if (u.pathname === '/run' && slow) { const body = r.request().postData() || ''; if (body.indexOf('bootstrap') !== -1) await new Promise(z => setTimeout(z, slow)); }
    const target = u.pathname.startsWith('/macros/') ? '/index?exec=' + encodeURIComponent('https://avenuel-fm.github.io/fm/ws/') : u.pathname + u.search;
    const res = await r.fetch({ url: 'http://localhost:8123' + target }); r.fulfill({ response: res }); });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const fr = () => p.frameLocator('iframe');
  await p.goto('https://avenuel-fm.github.io/fm/ws/');
  await fr().locator('.key').first().waitFor();
  for (const k of '1234') await fr().locator(`.key:text-is("${k}")`).click();
  await fr().locator('.grid6').waitFor();
  console.log('1) PIN 로그인 → 메인');
  const shellTok = await p.evaluate(() => localStorage.getItem('fm_ws_token'));
  console.log('2) 바로가기 페이지에도 표 보관:', !!shellTok, shellTok ? '만료 ' + new Date(Number(shellTok.split('.')[1])).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '');
  slow = 2500; await p.reload();
  await fr().locator('text=불러오는 중').waitFor();
  console.log('3) 새로고침: 확인 중에는 「불러오는 중」, PIN 버튼 수 =', await fr().locator('.key').count());
  try { await fr().locator('.grid6').waitFor({ timeout: 8000 }); } catch (e) { console.log('   화면:', (await fr().locator('body').innerText()).slice(0, 200)); throw e; }
  console.log('   → PIN 없이 메인');
  await fr().locator('.tile.on').click(); await fr().locator('text=소화기 점검').first().waitFor();
  await p.waitForTimeout(3500);
  console.log('4) 점검 화면 3.5초 뒤에도 그대로:', await fr().locator('text=소화기 점검').count() > 0 && await fr().locator('.grid6').count() === 0);
  slow = 0;
  // 구글 칸 저장소가 지워진 경우 (사파리·삼성 인터넷 흉내)
  const inner = p.frames().find(f => f.url().startsWith(GU));
  await inner.evaluate(() => localStorage.clear());
  await p.reload(); await fr().locator('.grid6').waitFor({ timeout: 8000 });
  console.log('5) 앱 칸 저장소를 지워도 바로가기 페이지 표로 PIN 없이 메인');
  global.FAIL = true; await p.reload(); await fr().locator('text=서버에 연결하지 못했습니다').waitFor({ timeout: 8000 });
  console.log('5-1) 연결 오류 → 로그아웃 안 하고 「다시 시도」');
  await fr().locator('button:has-text("다시 시도")').click(); await fr().locator('.grid6').waitFor({ timeout: 8000 });
  console.log('5-2) 다시 시도 → PIN 없이 메인');
  // 로그아웃하면 두 곳 다 지움
  await fr().locator('button:has-text("로그아웃")').click(); await fr().locator('.key').first().waitFor();
  await p.waitForTimeout(300);
  console.log('6) 로그아웃 → 바로가기 페이지 표 지움:', await p.evaluate(() => localStorage.getItem('fm_ws_token')) === null);
  // 다른 사이트가 표를 달라고 하면 답하지 않음
  const leaked = await p.evaluate(() => new Promise(ok => { let got = false; window.addEventListener('message', e => { if (e.data && e.data.fm === 'ws-token') got = true; }); window.postMessage({ fm: 'ws-token-get' }, '*'); setTimeout(() => ok(got), 500); }));
  console.log('7) 구글 칸이 아닌 곳의 요청에는 답 안 함:', !leaked);
  console.log('오류:', errs.length ? errs : '없음'); await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
