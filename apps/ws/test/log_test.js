// 종합업무일지 화면 시험 (WS_종합업무일지 15.3.22, 결정 116): PC 화면 · 입력하면 막대·누계 바로 · 저장 · 겹침 · B4 인쇄 · PDF · 휴대폰 안내
const { chromium } = require('playwright');
const fs = require('fs');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const H2P = "window.html2pdf=function(){const o={set(c){window.__pdfSet=c;return o},from(el){window.__pdfEl=el.cloneNode(true);return o},outputPdf(){return Promise.resolve('data:application/pdf;filename=generated.pdf;base64,'+btoa('%PDF-1.4 '+'x'.repeat(300)))}};return o};";
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
async function open(b, opt) {
  const c = await b.newContext(opt);
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: r.request().url().indexOf('html2pdf') !== -1 ? H2P : QRLIB }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
  for (const k of '1234') await p.click(`.key:text-is("${k}")`);
  await p.waitForSelector('.grid6'); await p.click('.tile >> text=서류작업'); await p.click('text=종합업무일지');
  return p;
}
(async () => {
  await fetch('http://localhost:8123/seed');
  const today0 = new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3).toISOString().slice(0, 10);
  await run('appendRow_', 'TBM', { 'tbm_id': 'T1', '근무일': today0, '삭제여부': 'N', '작업표': JSON.stringify([{ place: '2층', work: '자동문 재결선', dept: '전방파트', risk: '감전' }, { place: '옥상', work: '배수구 청소', dept: '기건파트' }]
    .concat(Array.from({ length: 11 }, (_, i) => ({ place: 'B' + (i + 1), work: '순찰', dept: '전방파트' })))) });   // 전기방재 12줄 → 10줄만
  await run('eval', 'AC.hvac = [{date:"' + today0 + '",unit:28,startMin:600,endMin:1220,off:false},{date:"' + today0 + '",unit:12,startMin:null,endMin:null,off:true},{date:"' + today0 + '",unit:3,startMin:600,endMin:1200,off:false}]; AC.curtain = [{date:"' + today0 + '",unit:"1REAR-1",startMin:600,endMin:1170,off:false}]');   // 온습도 앱 기록 흉내
  const b = await chromium.launch();
  const p = await open(b, { viewport: { width: 1600, height: 1000 } });
  await p.waitForSelector('.lgs');
  const day = await p.getAttribute('.nwdate', 'data-date');
  const today = new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3).toISOString().slice(0, 10);
  ok(day === today, '오늘 근무일로 열림 ' + day);
  ok(await p.locator('.lgs h1').innerText() === '에비뉴엘 종합업무일지' && await p.locator('.lgsign th').count() === 4, '제목 · 서명란 4칸');
  ok(await p.locator('.lgmc').count() === 8 && await p.locator('.lgmh .lgin').count() === 8 && !(await p.locator('[data-bars="급탕"],[data-bars="실온수"]').count()), '에너지 막대 칸 8개 (급탕·환탕·급탕탱크·실온수 뺌)');
  ok(await p.locator('.lgwork li').count() === 20 && !(await p.locator('textarea[data-k="비고"]').count()), '금일작업 10줄씩 · 비고 칸 없음');
  const ac = await p.locator('.lgac .acerr').innerText();
  ok(/불러오지 못했습니다/.test(ac) && !(await p.locator('.lgac .acb').count()), '공조기·에어커튼 가동: 구글 판은 「불러오지 못함」 (기록은 Supabase 로 옮김, 결정 194) — ' + ac);
  const ly = await p.evaluate(() => { const e = document.querySelector('.lgegrid'), a = document.querySelector('.lgac'), w = document.querySelector('.lgworks'); return e.getBoundingClientRect().bottom <= a.getBoundingClientRect().top && a.getBoundingClientRect().bottom <= w.getBoundingClientRect().top; });
  ok(ly, '가동 칸 = 에너지 사용량 아래, 금일작업 위');
  ok(!(await p.locator('.lgtools,.lgchip').count()), '종이 위 문구·TBM 줄 없음');
  const wv = (d, i) => p.inputValue('.lgin[data-d="' + d + '"][data-i="' + i + '"]');
  ok(await wv('전기방재', 0) === '2층 자동문 재결선' && await wv('전기방재', 9) === 'B9 순찰' && await wv('기계건축', 0) === '옥상 배수구 청소' && (await p.locator('#lgState').innerText()).indexOf('저장 안 함') !== -1, '새 날: TBM 작업 표로 금일작업 채워 둠 (10줄까지, 11번부터 뺌)');
  ok(await p.locator('#lgNight').count() === 0 && !/야간 일일 작업 현황/.test(await p.locator('.lgwrap').innerText()), '야간 일일 작업 현황 칸(그림 올리기)은 없음 (결정 240)');
  const set = (k, v) => p.locator('.lgin[data-k="' + k + '"]').fill(v);
  await set('영업시간', '9.5'); await set('날씨', '흐림'); await set('최저', '8'); await set('최고', '16'); await set('미세먼지', '38');
  await p.selectOption('select.lgin', '보통');
  await set('시수', '102'); await set('전기', '17906');
  const bars = k => p.locator('[data-bars="' + k + '"] .lgbv .c').allInnerTexts();
  ok((await bars('시수')).join('|') === '102|102|102', '입력하면 일일·월누계·년누계 바로 바뀜 ' + (await bars('시수')).join('|'));
  ok(await p.locator('#lgHours').innerText() === '9.5', '영업시간 월누계 바로 바뀜');
  ok((await p.locator('#lgState').innerText()).indexOf('저장 안 함') !== -1, '고치면 「저장 안 함」');
  await p.locator('.lgin[data-d="전기방재"][data-i="0"]').fill('공사장 안전 점검');
  await p.locator('.lgin[data-d="기계건축"][data-i="0"]').fill('미세먼지 측정');
  await p.click('#lgSave'); await p.waitForFunction(() => S.lg && !S.lg.busy && !S.lg.dirty);
  const tk = await p.evaluate(() => S.token);
  let g = await run('logGet', tk, day);
  ok(g.cur && g.cur['시수'] === '102' && g.cur.works['전기방재'][0] === '공사장 안전 점검' && g.cur.works['전기방재'].length === 10, '저장 → 일지 시트 (10줄)');
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '옆으로 넘침 없음 (1600px)');
  await p.screenshot({ path: 'shot_log_pc.png', fullPage: true });
  // 다른 PC에서 먼저 고치면 덮어쓰지 않음
  const q = await open(b, { viewport: { width: 1366, height: 900 } });
  await q.waitForSelector('.lgs');
  const z = await q.evaluate(() => Number($('lgSheet').style.zoom));
  ok(z > 0.8 && z < 0.9 && !(await q.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '1366px PC: 종이를 줄여 한 화면 폭 (' + z.toFixed(2) + ')');
  ok(await q.inputValue('.lgin[data-k="시수"]') === '102', '다른 PC에서도 저장한 값');
  await p.locator('.lgin[data-k="중수"]').fill('63'); await p.click('#lgSave'); await p.waitForFunction(() => S.lg && !S.lg.busy && !S.lg.dirty);
  await q.locator('.lgin[data-k="식당가스"]').fill('96'); await q.click('#lgSave'); await q.waitForFunction(() => S.lg && !S.lg.busy && !S.lg.dirty);
  const t = await q.locator('.toast').innerText();
  ok(/먼저 고쳤어요/.test(t) && await q.inputValue('.lgin[data-k="중수"]') === '63', '겹침: 알리고 새 내용 다시 불러옴 — ' + t);
  // B4 인쇄
  await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await p.click('#lgBar button:has-text("인쇄")'); await p.waitForFunction(() => window.__printed);
  const pr = await p.evaluate(() => ({ css: $('print').innerHTML.indexOf('size:364mm 257mm') !== -1, inputs: $('print').querySelectorAll('input,button,.lgchip').length, v: $('print').innerText.indexOf('102') !== -1, ac: $('print').querySelectorAll('.lgac .acb').length }));
  ok(pr.css && pr.inputs === 0 && pr.v && pr.ac === 0, '인쇄: B4 가로(364×257mm) · 입력칸·버튼 없이 값·가동 칸만');
  await p.emulateMedia({ media: 'print' });
  const sz = await p.evaluate(() => { const r = $('print').querySelector('.lgs').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  ok(Math.abs(sz[0] - 1376) <= 2 && sz[1] <= 972, '인쇄 크기 ' + sz.join('×') + 'px = 364×257mm 안');
  await p.screenshot({ path: 'shot_log_print.png' });
  await p.emulateMedia({ media: 'screen' });
  // PDF
  await p.locator('.lgin[data-k="중수"]').fill('62.5'); await p.click('#lgSave'); await p.waitForFunction(() => S.lg && !S.lg.busy && !S.lg.dirty && S.lg.pdf);
  const ps = await p.evaluate(() => [window.__pdfSet.jsPDF.format.join('x'), window.__pdfEl.querySelectorAll('input').length, window.__pdfEl.offsetWidth === 0]);
  g = await run('logGet', tk, day);
  ok(ps[0] === '364x257' && ps[1] === 0 && g.pdf && g.pdf.id, 'PDF: B4 크기 · 입력칸 없음 · 드라이브 저장');
  ok(await p.locator('#lgBar a:has-text("PDF 보기")').count() === 1 && await p.locator('#lgBar button.pri').count() === 0, '저장 뒤 [저장] 자리가 [PDF 보기]');
  await p.locator('.lgin[data-k="중수"]').fill('64');
  ok(await p.locator('#lgBar a:has-text("PDF 보기")').count() === 0 && await p.locator('#lgSave').innerText() === '저장', '고치면 다시 [저장] (남색은 저장 하나)');
  await p.click('#lgSave'); await p.waitForFunction(() => S.lg && !S.lg.busy && !S.lg.dirty && S.lg.pdf);
  // 지난 날짜 · 앞날 막힘
  await p.click('.nwdate');
  ok(await p.locator('.dialog .atcal button:disabled').count() > 0 || day.slice(8) >= '28', '달력: 앞날은 못 고름');
  await p.click('.dialog button[aria-label="닫기"]');
  // 휴대폰은 안내만
  const m = await open(b, { viewport: { width: 390, height: 844 } });
  ok(await m.locator('.lgpc').isVisible() && await m.locator('.lgs').count() === 0, '휴대폰: 「PC에서 열어 주세요」');
  const errs = p.errs.concat(q.errs, m.errs);
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
