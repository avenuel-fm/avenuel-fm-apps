// 시안 전용 (앱 코드 안 고침): Supabase 이관 3-1 기기 등록·PIN·환경설정 화면을 지금 화면 위에 그려 찍음
// 쓰는 법: apps/ws 에서 node test/web.js 를 띄운 뒤  node test/mock_supabase_login.js <저장 폴더>
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const HEAD = '<div style="text-align:center;display:flex;flex-direction:column;gap:6px"><small style="color:var(--muted)">잠실점 에비뉴엘 · 시설팀</small><b style="font-size:24px">업무지원</b></div>';
const LBL = 'style="display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--sub)"';
const reg = err => '<div style="max-width:420px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;padding:48px 24px 28px;gap:24px">' + HEAD +
  '<div class="card" style="padding:22px 20px;display:flex;flex-direction:column;gap:14px">' +
  '<b style="font-size:18px">기기 등록</b>' +
  '<span style="font-size:15px;color:var(--sub);line-height:1.6">이 휴대폰(PC)에서 <b style="color:var(--ink)">처음 한 번만</b> 합니다.<br>등록하면 다음부터는 PIN만 누릅니다.</span>' +
  '<label ' + LBL + '>시설팀 계정 이메일<input class="inp" type="email" value="team@avenuel-fm.app" style="font-size:16px"></label>' +
  '<label ' + LBL + '>비밀번호<input class="inp" type="password" value="12345678" style="font-size:16px"></label>' +
  '<span style="font-size:13px;color:var(--red);min-height:18px" role="alert">' + (err || '') + '</span>' +
  '<button class="btn pri big" style="width:100%">기기 등록</button></div>' +
  '<small style="text-align:center;color:var(--muted);line-height:1.6">계정은 시설팀 관리자에게 받습니다<br>등록은 「환경설정 › 기기 등록 풀기」 전까지 유지됩니다</small></div>';
(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, deviceScaleFactor: 2 });
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage();
  await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
  await p.screenshot({ path: OUT + '/0_지금_PIN.png' });
  await p.evaluate(h => { document.getElementById('app').innerHTML = h; }, reg(''));
  await p.screenshot({ path: OUT + '/1_기기등록.png' });
  await p.evaluate(h => { document.getElementById('app').innerHTML = h; }, reg('이메일 또는 비밀번호가 맞지 않습니다. 관리자에게 확인해 주세요.'));
  await p.screenshot({ path: OUT + '/2_기기등록_틀림.png' });
  // PIN 화면: 버전 줄 대신 「등록된 기기」
  await p.reload(); await p.locator('.key').first().waitFor();
  await p.evaluate(() => { const s = document.querySelectorAll('#app small')[1]; s.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:999px;background:var(--green-bg,#E7F5EC);color:var(--green,#1E7B45);font-size:12px">✓ 등록된 기기</span>'; });
  await p.screenshot({ path: OUT + '/3_PIN_등록된기기.png' });
  // 환경설정 맨 아래: 이 기기
  for (const k of '1234') await p.click(`.key:text-is("${k}")`);
  await p.waitForSelector('.grid6'); await p.click('button:text-is("환경설정")'); await p.waitForSelector('.strow');
  await p.evaluate(() => {
    const w = document.querySelector('.backbar').previousElementSibling || document.querySelector('.wrap');
    const d = document.createElement('div');
    d.innerHTML = '<div class="sec" style="margin-top:20px">이 기기</div><div class="card" style="padding:16px;display:flex;align-items:center;gap:12px"><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><b>등록된 계정</b><small style="color:var(--muted)">team@avenuel-fm.app · 11월 14일 등록</small></span><button class="btn" style="color:var(--red);border-color:#E8B4B4">기기 등록 풀기</button></div><div style="font-size:13px;color:var(--muted);margin-top:6px;line-height:1.5">풀면 이 기기에서는 다시 기기 등록을 해야 합니다. 잃어버리거나 바꾼 기기는 관리자에게 알려 주세요.</div>';
    w.appendChild(d); scrollTo(0, document.body.scrollHeight);
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/4_환경설정_기기등록풀기.png' });
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
