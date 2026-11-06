// TBM 화면 시험 (WS_서류작업 4-1~5장, 결정 66·70): 명일 작업 가져오기 · 위험성 미리 고르기 · 고치기 · 사진 2장 · 저장 · PDF 2쪽
const { chromium } = require('playwright');
const fs = require('fs');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
// PDF 도구(html2pdf) 대신: 넘겨받은 PDF 화면을 보관하고 가짜 PDF를 돌려줌
const H2P = "window.html2pdf=function(){const o={set(){return o},from(el){window.__pdfEl=el.cloneNode(true);return o},outputPdf(){return Promise.resolve('data:application/pdf;filename=generated.pdf;base64,'+btoa('%PDF-1.4 '+'x'.repeat(300)))}};return o};";
const SIG = fs.readFileSync(__dirname + '/sig_b64.txt', 'utf8');
const ok = (c, m) => console.log((c ? 'ok   ' : 'FAIL ') + m);
const run = (fn, ...args) => fetch('http://localhost:8123/run', { method: 'POST', body: JSON.stringify({ fn, args }) }).then(r => r.json());
(async () => {
  await fetch('http://localhost:8123/seed');
  const day = new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3).toISOString().slice(0, 10);
  const hong = await run('login', '1234', 'srv');
  await run('login', '5678', 'srv2', SIG);   // 김철수(기건파트) 서명
  await run('nextWorkSave', hong.token, day, [
    { dept: '기건파트', place: '2층,3층,4층', work: '층별 전 공조기 구리스 주입', note: '사다리' },
    { dept: '전방파트', place: '1층', work: '분전반 열화상 점검', note: '' },
    { dept: '전방파트', place: '전층', work: '직무고시', note: '' }], '');
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: r.request().url().indexOf('html2pdf') !== -1 ? H2P : QRLIB }));
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/index'); await p.locator('.key').first().waitFor();
  for (const k of '1234') await p.click(`.key:text-is("${k}")`);
  await p.waitForSelector('.grid6'); await p.click('.tile >> text=서류작업'); await p.click('.row >> text=TBM');
  await p.waitForSelector('.tbw');
  ok(await p.locator('.tbw').count() === 3, '작업 표 3줄 = 오늘 날짜의 명일 작업 예정');
  ok((await p.locator('.tbsum').innerText()).indexOf('관리감독자 홍길동') !== -1, '관리감독자 = 소장 홍길동');
  const sel = i => p.locator('.tbw').nth(i).locator('select').inputValue();
  ok(await sel(0) === 'A형 사다리 미끄러짐·상부 균형 상실', '비고 「사다리」 → 사다리 위험요인 미리 고름');
  ok(await sel(1) === '전기 흐르는 부분 노출·접촉' && await p.locator('.tbw').nth(1).locator('.tbf input').first().inputValue() === '감전', '「분전반」 → 감전 자동');
  ok(await sel(2) === '공구·자재 다루다 손 다침', '맞는 낱말 없으면 (기본)');
  ok((await p.locator('.tbw').nth(0).locator('.tblv').innerText()) === '6 · 상', '위험성 2×3 = 6 · 상');
  ok((await p.locator('.tbw').nth(0).locator('.tbh small').innerText()).indexOf('인원 1 (자동)') !== -1, '인원 = 기건파트 서명 1명 (소장 빼고)');
  ok(await p.locator('.tbck button.on').count() === 1 && (await p.locator('.tbck button.on').innerText()).indexOf('사다리') !== -1, '체크 칸: 사다리만 자동 ○');
  ok(await p.locator('.tbw').nth(0).locator('.tbfx label.on').count() === 2, '개선조치: ✓ 문구 2개 미리 체크');
  await p.locator('.tbw').nth(0).locator('.tbseg').first().locator('button', { hasText: '3' }).click();
  ok((await p.locator('.tbw').nth(0).locator('.tblv').innerText()) === '9 · 상', '가능성 3 누르면 9 · 상');
  await p.locator('.tbw').nth(0).locator('.tbfx label').nth(2).click();
  await p.locator('#fx0').fill('작업 구역 칸막이 설치'); await p.locator('.tbw').nth(0).locator('.tbown button').click();
  ok(await p.locator('.tbw').nth(0).locator('.tbfx label.on').count() === 4, '개선조치 더 고르고 직접 쓰기');
  ok((await p.locator('#tbState').innerText()).indexOf('저장 안 함') !== -1, '고치면 「저장 안 함」');
  await p.click('.nwadd');
  await p.locator('.tbedit input').first().fill('천장 점검구 배선 정리');
  await p.locator('.tbedit input').nth(1).fill('3층');
  await p.locator('.tbw').nth(3).locator('select').selectOption({ label: '천장 안 튀어나온 철골에 머리 부딪힘' });
  ok((await p.locator('.tbw').nth(3).locator('.tblv').innerText()) === '2 · 하', '줄 추가 → 고르면 재해형태·위험성 채움');
  await p.locator('.tbw').nth(0).locator('.tbh button').click();
  await p.locator('.tbedit input').nth(2).fill('3');
  await p.locator('.tbw').nth(0).locator('.tbh button').click();
  ok((await p.locator('.tbw').nth(0).locator('.tbh small').innerText()).indexOf('인원 3') !== -1 && (await p.locator('.tbw').nth(0).locator('.tbh small').innerText()).indexOf('자동') === -1, '인원 직접 고침');
  const files = p.locator('.tbph input[type=file]');
  ok(await files.count() === 4 && await files.nth(0).getAttribute('capture') === 'environment' && await files.nth(1).getAttribute('capture') === null, '사진 칸마다 카메라·파일');
  await files.nth(1).setInputFiles(__dirname + '/gauge.jpg');
  await p.waitForFunction(() => S.tbm.up.meet);
  await files.nth(3).setInputFiles(__dirname + '/gauge.jpg');
  await p.waitForFunction(() => S.tbm.up.chant);
  ok(await p.locator('.tbph img').count() === 2, '사진 2장 미리보기');
  const box = await p.locator('.tbw select').first().evaluate(e => [getComputedStyle(e).fontSize, e.getBoundingClientRect().height]);
  ok(box[0] === '16px' && box[1] >= 44, '고르기 칸 16px · 높이 ' + box[1]);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '휴대폰 옆으로 넘침 없음');
  await p.screenshot({ path: 'shot_tbm.png', fullPage: true });
  await p.click('.nwbar button:text-is("저장")'); await p.waitForFunction(() => S.tbm && S.tbm.saved && !S.tbm.dirty && !S.tbm.busy);
  const g = await run('tbmGet', hong.token);
  ok(g.saved && g.works.length === 4 && g.works[0].p === 3 && g.works[0].n === '3' && g.works[0].fixes.length === 4 && g.photos.meet && g.photos.chant, '저장 → 작업 표 4줄 · 사진 2장');
  await p.click('.nwbar button:text-is("PDF로 저장")'); await p.waitForFunction(() => S.tbm && S.tbm.pdf && !S.tbm.pdfBusy);
  ok((await p.locator('.banner.b-info').first().innerText()).indexOf('PDF 저장됨') !== -1, 'PDF 저장 → 「PDF 저장됨」 표시');
  const openBtn = p.locator('.nwbar a.btn.pri');
  ok(await openBtn.innerText() === 'PDF 열기' && /drive\.google\.com\/file\/d\/.+\/view/.test(await openBtn.getAttribute('href')) && await openBtn.getAttribute('target') === '_blank', 'PDF 저장 뒤 버튼 = [PDF 열기] (새 창)');
  ok((await p.locator('.tbpb').first().innerText()).replace(/\s+/g, ' ') === '📷 카메라 📂 파일', '사진 버튼 아이콘');
  await p.locator('.tbck button').nth(1).click();
  ok(await p.locator('.nwbar button.pri').innerText() === 'PDF로 저장', '고치면 다시 [PDF로 저장]');
  const pdf = await p.evaluate(() => {
    const e = window.__pdfEl, t = e.innerText;
    return { pages: e.querySelectorAll('.pg').length, rows: e.querySelectorAll('.wk tr').length - 1, signs: e.querySelectorAll('.sg img').length, inn: (t.match(/\(인\)/g) || []).length,
      mgr: e.querySelector('.hd td:last-child').innerText, n: e.querySelector('.hd td:nth-child(3)').innerText, date: e.querySelector('.hd td:nth-child(2)').innerText,
      lv: t.indexOf('9 (상)') !== -1, ck: e.querySelector('.ck .on').innerText, pn: [...e.querySelectorAll('.pn')].map(x => x.innerText).join(),
      photo: [...e.querySelectorAll('.cell img')].map(i => i.style.width + 'x' + i.style.height).join() };
  });
  ok(pdf.pages === 2 && pdf.pn === '- 1 / 2 -,- 2 / 2 -', 'PDF 2쪽 · 쪽 번호');
  ok(pdf.rows === 8, 'PDF 작업 표 기본 8줄 (4줄 + 빈 4줄)');
  ok(pdf.signs === 2 && pdf.inn === 18 && /홍길동/.test(pdf.mgr) && /2 명/.test(pdf.n), 'PDF 서명란 20칸: 서명 2명 · 빈 칸 (인) 18 · 관리감독자 · 작업인원 2명');
  ok(pdf.date.indexOf(day.slice(2).replace(/-/g, '.')) !== -1 && pdf.lv && pdf.ck === '○', 'PDF 작업 일시 YY.MM.DD · 위험성 9 (상) · 사다리 ○');
  ok(pdf.photo.split(',').length === 2 && pdf.photo.split(',').every(v => /^\d+pxx\d+px$/.test(v)), 'PDF 사진 2장 칸에 맞춰 줄임 ' + pdf.photo);
  const used = (await run('readTable_', '서명')).rows.filter(r => r['근무일'] === day).every(r => r['TBM사용'] === 'Y');
  ok(used, 'PDF에 쓰인 서명 TBM사용=Y');
  const r8 = await p.evaluate(() => { const keep = S.tbm.works.slice(); for (let i = 0; i < 6; i++) S.tbm.works.push(Object.assign({}, keep[0])); const hh = tbmPdfHtml(); S.tbm.works = keep; return (hh.match(/<tr style="height:8\.20mm;font-size:7\.20pt"/g) || []).length; });
  ok(r8 === 10, '작업 10줄이면 줄 높이·글자 줄여 10줄 (8.2mm · 7.2pt)');
  await p.setViewportSize({ width: 1180, height: 900 });
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'pdfview'; d.style.cssText = 'position:absolute;left:0;top:0;z-index:999;background:#fff'; d.appendChild(window.__pdfEl); document.body.appendChild(d); window.scrollTo(0, 0); });
  await p.locator('#pdfview .pg').nth(0).screenshot({ path: 'shot_tbm_pdf_1.png' });
  await p.locator('#pdfview .pg').nth(1).screenshot({ path: 'shot_tbm_pdf_2.png' });
  ok(!errs.length, '화면 오류 없음' + (errs.length ? ': ' + errs.join(' / ') : ''));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
