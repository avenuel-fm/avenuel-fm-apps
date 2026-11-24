const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const GU = 'https://n-test-0lu-script.googleusercontent.com';
const fmFile = require('./fm_serve.js');
(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let slow = 0;
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: QRLIB }));
  await c.route('https://avenuel-fm.github.io/fm/**', r => { const o = fmFile(new URL(r.request().url()).pathname.replace(/^\/fm\//, ''), GU + '/macros/s/TEST/exec', true);   // 저장소 fm/ 그대로
    r.fulfill({ status: 200, contentType: o.type, body: o.body }); });
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
  const t0 = Date.now();
  try { await fr().locator('.grid6').waitFor({ timeout: 2000 }); } catch (e) { console.log('FAIL 3) 지난번 메인 화면이 바로 안 뜸:', (await fr().locator('body').innerText()).slice(0, 200)); throw e; }
  const early = Date.now() - t0;
  console.log((early < 2000 ? '' : 'FAIL ') + '3) 새로고침: 서버 확인(2.5초) 전에 지난번 메인 화면 ' + early + 'ms, PIN 버튼 수 =', await fr().locator('.key').count());
  const inner0 = p.frames().find(f => f.url().startsWith(GU));
  await inner0.waitForFunction(() => S.cached === false, null, { timeout: 8000 });
  console.log('   → 서버 확인 뒤 새 숫자로 (PIN 없이 메인)');
  console.log(((await fr().locator('.tile.on').count()) === 0 ? '' : 'FAIL ') + '3-1) 메인에 미리 선택된 칸 없음');
  await fr().locator('.tile:has(b:text-is("점검"))').click(); await fr().locator('text=소화기/소화전/공기호흡기 점검').first().waitFor();
  await p.waitForTimeout(3500);
  console.log('4) 점검 화면 3.5초 뒤에도 그대로:', await fr().locator('text=소화기/소화전/공기호흡기 점검').count() > 0 && await fr().locator('.grid6').count() === 0);
  slow = 0;
  // 구글 칸 저장소가 지워진 경우 (사파리·삼성 인터넷 흉내)
  const inner = p.frames().find(f => f.url().startsWith(GU));
  await inner.evaluate(() => localStorage.clear());
  await p.reload(); await fr().locator('.grid6').waitFor({ timeout: 8000 });
  console.log('5) 앱 칸 저장소를 지워도 바로가기 페이지 표로 PIN 없이 메인');
  global.FAIL = true; await p.reload(); await fr().locator('text=지난번 화면입니다').waitFor({ timeout: 8000 });
  console.log(((await fr().locator('.grid6').count()) === 1 ? '' : 'FAIL ') + '5-0) 연결 오류 + 기억한 화면 있음 → 지난번 메인 그대로, 알림만');
  await p.frames().find(f => f.url().startsWith(GU)).evaluate(() => localStorage.removeItem('ws_main'));
  global.FAIL = true; await p.reload(); await fr().locator('text=서버에 연결하지 못했습니다').waitFor({ timeout: 8000 });
  console.log('5-1) 연결 오류 + 기억한 화면 없음 → 로그아웃 안 하고 「다시 시도」');
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
