// 명일 작업 예정 화면 시험 (WS_서류작업 9장): 휴대폰 카드 입력 · 빨간 줄 · 저장 · 그림 내려받기 · PC 표 · 겹침 저장
const { chromium } = require('playwright');
const fs = require('fs');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
async function open(b, opt) {
  const c = await b.newContext(Object.assign({ acceptDownloads: true }, opt));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: QRLIB }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
  for (const k of '1234') await p.click(`.key:text-is("${k}")`);
  await p.waitForSelector('.grid6'); await p.click('.tile >> text=서류작업'); await p.click('text=명일 작업 예정');
  await p.waitForSelector('.nwrow');
  return p;
}
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  // 1) 휴대폰
  const p = await open(b, { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });   // isMobile은 시험 페이지에 viewport 줄이 없어 980px로 그려져서 뺌
  const date = await p.inputValue('.nwdate input');
  const tomorrow = new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3 + 864e5).toISOString().slice(0, 10);
  ok(date === tomorrow, '일자 = 근무일 다음 날 ' + date);
  const DATA = [['전방파트', '전층', 'EPS실 순찰 및 공사장 안전점검', ''], ['전방파트', '전층', '직무고시', ''], ['기건파트', '전층', '식당가 및 공조실 순찰', ''],
    ['기건파트', '전층', '미세먼지 측정', ''], ['기건파트', '전층', '일일계량기 검침', ''], ['기건파트', '2층,3층,4층', '층별 전 공조기 구리스 주입', '사다리'], ['기건파트', '전층', '미세먼지 측정', '']];
  for (let i = 0; i < DATA.length; i++) {
    if (i) await p.click('.nwadd');
    const row = p.locator('.nwrow').nth(i), [d, pl, w, n] = DATA[i];
    await row.locator('.seg button', { hasText: d }).click();
    await p.locator('.nwrow').nth(i).locator('.f-work input').fill(w);
    await p.locator('.nwrow').nth(i).locator('.f-place input').fill(pl);
    if (n) await p.locator('.nwrow').nth(i).locator('.f-note input').fill(n);
  }
  ok(await p.locator('.nwrow.danger').count() === 1 && await p.locator('.nwrow').nth(5).evaluate(e => e.classList.contains('danger')), '「사다리」 줄만 빨간색');
  await p.locator('.nwrow').nth(1).locator('.f-note input').fill('용접');
  ok(await p.locator('.nwrow').nth(1).evaluate(e => e.classList.contains('danger')), '비고에 「용접」 입력하면 바로 빨간색');
  await p.locator('.nwrow').nth(1).locator('.f-note input').fill('');
  ok(!(await p.locator('.nwrow').nth(1).evaluate(e => e.classList.contains('danger'))), '지우면 다시 검정');
  const box = await p.locator('.nwrow .f-work input').first().evaluate(e => [getComputedStyle(e).fontSize, e.getBoundingClientRect().height]);
  ok(box[0] === '16px' && box[1] >= 44, '입력칸 16px · 높이 ' + box[1]);
  ok(!(await overflow(p)), '휴대폰 옆으로 넘침 없음');
  ok((await p.locator('#nwState').innerText()).indexOf('저장 안 함') !== -1, '고치면 「저장 안 함」 표시');
  await p.screenshot({ path: 'shot_nw_phone.png', fullPage: true });
  await p.click('#nwSave'); await p.waitForFunction(() => S.nw && !S.nw.busy && !S.nw.dirty);
  const g = await run('nextWorkGet', await p.evaluate(() => S.token), date);
  ok(g.rows.length === 7 && g.rows[5].note === '사다리' && g.by === '홍길동', '저장 → 시트 7줄');
  const dl = p.waitForEvent('download');
  await p.click('.nwbar button.green');
  const file = await dl; const path = 'shot_nw_image.png'; await file.saveAs(path);
  const buf = fs.readFileSync(path); const w = buf.readUInt32BE(16), hh = buf.readUInt32BE(20);
  ok(file.suggestedFilename() === date + '_명일작업예정.png' && w === 2000, '그림 내려받기 ' + file.suggestedFilename() + ' ' + w + '×' + hh);
  ok(await p.locator('#nwImg').isVisible(), '그림도 함께 보여 줌 (길게 눌러 저장용)');
  await p.click('.dialog .back');
  // 2) PC — 같은 장을 열어 표로 보임, 휴대폰이 먼저 저장하면 덮어쓰지 않음
  const q = await open(b, { viewport: { width: 1280, height: 900 } });
  ok(await q.locator('.nwhd').isVisible() && await q.locator('.nwrow').count() === 7, 'PC: 표 머리줄 · 7줄 이어서 고침');
  const rowH = await q.locator('.nwrow').first().evaluate(e => e.getBoundingClientRect().height);
  ok(rowH < 70, 'PC: 한 줄 높이 ' + Math.round(rowH) + 'px (표 모양)');
  ok(!(await overflow(q)), 'PC 옆으로 넘침 없음');
  await q.screenshot({ path: 'shot_nw_pc.png', fullPage: true });
  await p.locator('.nwrow').nth(0).locator('.f-note input').fill('휴대폰에서 고침'); await p.click('#nwSave');
  await p.waitForFunction(() => S.nw && !S.nw.busy && !S.nw.dirty);
  await q.locator('.nwrow').nth(1).locator('.f-note input').fill('PC에서 고침'); await q.click('#nwSave');
  await q.waitForFunction(() => S.nw && !S.nw.busy && !S.nw.dirty);
  const t = await q.locator('.toast').innerText();
  ok(/먼저 고쳤어요/.test(t) && await q.inputValue('.nwrow >> nth=0 >> .f-note input') === '휴대폰에서 고침', '겹침: 알리고 새 내용 다시 불러옴 — ' + t);
  // 3) 줄 지우기 → 순번 다시
  await q.locator('.nwdel').first().click(); await q.click('#nwSave'); await q.waitForFunction(() => S.nw && !S.nw.busy && !S.nw.dirty);
  ok(await q.locator('.nwrow').count() === 6 && (await q.locator('.nwno').first().innerText()) === '1', '줄 지우고 저장 → 6줄, 순번 1부터');
  const errs = p.errs.concat(q.errs);
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
