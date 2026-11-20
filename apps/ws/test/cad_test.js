// CAD 뷰어(fm/cad) 시험: 가짜 통로로 목록 → 도면 열기 → 도면 올리기. 서버는 파일만 내줌
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..', 'fm', 'cad');
const TYPE = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
(async () => {
  const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); try { r.setHeader('content-type', TYPE[path.extname(f)] || 'text/plain'); r.end(fs.readFileSync(f)); } catch (e) { r.statusCode = 404; r.end(); } }).listen(8199);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; let bad = 0;
  p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? '' : 'FAIL ') + m); if (!c) bad++; };
  await p.goto('http://localhost:8199/'); await p.waitForSelector('.cad-card');
  ok(await p.locator('.cad-card').count() >= 3, '1) 목록에 도면 카드');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '2) 가로 스크롤 없음 (390px)');
  await p.locator('.cad-card').first().click(); await p.waitForFunction(() => /도형 [1-9]/.test(document.getElementById('elemStat').textContent));
  ok(true, '3) 도면 열림: ' + await p.locator('#elemStat').innerText());
  await p.click('#btnBackToList');
  await p.click('#btnUpload');
  const dxf = '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nA\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n';
  await p.setInputFiles('#upFile', { name: '시험.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  ok(await p.inputValue('#upName') === '시험', '4) 파일 고르면 이름 자동');
  await p.fill('#upFloor', 'B1'); await p.click('#upGo'); await p.waitForTimeout(800);
  ok(await p.locator('.cad-card:has-text("시험")').count() === 1 && await p.locator('.floor-badge:has-text("B1")').count() >= 1, '5) 올린 도면이 목록에 (층 B1)');
  await p.setInputFiles('#upFile', { name: 'a.dwg', buffer: Buffer.from('x') }).catch(() => {});
  await p.click('#btnUpload'); await p.setInputFiles('#upFile', { name: 'a.dwg', buffer: Buffer.from('x') }); await p.fill('#upName', 'dwg'); await p.click('#upGo');
  ok(/dxf/i.test(await p.locator('#upMsg').innerText()), '6) DWG는 막고 안내');
  ok(!errs.length, '7) 화면 오류 없음 ' + errs.join(' | '));
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})();
