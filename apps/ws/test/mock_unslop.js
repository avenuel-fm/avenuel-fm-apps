// 시안 전용 (앱 코드 안 고침): 화면에 다듬기를 덧입혀 전·후를 찍음 → unslop_*.png
const { chromium } = require('playwright');
const fs = require('fs');
const QRLIB = fs.readFileSync(require.resolve('qrcodejs2/qrcode.min.js'), 'utf8');
const GU = 'https://n-test-0lu-script.googleusercontent.com';
const fmFile = require('./fm_serve.js');
const OUT = process.argv[2] || '.';

// 선 아이콘 (lucide 계열, 18px·굵기 1.75)
const P = {
  docs: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  inspect: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  soon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const svg = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${P[k]}</svg>`;

const CSS = `
body, body *{word-break:keep-all;overflow-wrap:anywhere}
.top .ttl small{white-space:nowrap}
.tile{gap:4px}
.tile .ico{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#E8F0FA!important;color:#1F5FA8!important}
.tile b{font-size:16px}
.tile.soon{background:transparent;border-style:dashed;cursor:default}
.tile.soon .ico{background:var(--line3,#EDF0F3)!important;color:#7A8494!important}
.tile.soon b{color:#5B6573}
.tile.soon small{color:#7A8494}
.me{font-weight:500}
`;
async function polish(fr) {
  await fr.evaluate(({ CSS, ic }) => {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    // 굵기: 700 이상 → 제목 600, 나머지 500
    document.querySelectorAll('body *').forEach(e => {
      const w = Number(getComputedStyle(e).fontWeight);
      if (w >= 700) e.style.fontWeight = /^(B|H1|H2|H3)$/.test(e.tagName) || e.closest('.ttl') ? '600' : '500';
    });
    // 날짜 한 줄로: "2026. 11. 13. (금)" → "11월 13일 (금)"
    const sm = document.querySelector('.top .ttl small');
    if (sm) sm.textContent = sm.textContent.replace(/(\d{4})\.\s*(\d+)\.\s*(\d+)\.\s*\((.)\)/, (m, y, mo, d, w) => Number(mo) + '월 ' + Number(d) + '일 (' + w + ')');
    // 타일 아이콘
    document.querySelectorAll('.tile').forEach(t => {
      const b = t.querySelector('b').textContent, ico = t.querySelector('.ico');
      if (b === '서류작업') ico.innerHTML = ic.docs;
      else if (b === '점검') ico.innerHTML = ic.inspect;
      else { t.classList.add('soon'); ico.innerHTML = ic.soon; }
    });
  }, { CSS, ic: { docs: svg('docs'), inspect: svg('inspect'), soon: svg('soon') } });
}

(async () => {
  await fetch('http://localhost:8123/seed');
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await c.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: QRLIB }));
  await c.route('https://avenuel-fm.github.io/fm/**', r => { const o = fmFile(new URL(r.request().url()).pathname.replace(/^\/fm\//, ''), GU + '/macros/s/TEST/exec', true);
    r.fulfill({ status: 200, contentType: o.type, body: o.body }); });
  await c.route(GU + '/**', async r => { const u = new URL(r.request().url());
    const target = u.pathname.startsWith('/macros/') ? '/index?exec=' + encodeURIComponent('https://avenuel-fm.github.io/fm/ws/') : u.pathname + u.search;
    r.fulfill({ response: await r.fetch({ url: 'http://localhost:8123' + target }) }); });
  const p = await c.newPage();
  const fr = () => p.frameLocator('iframe');
  const inner = () => p.frames().find(f => f.url().startsWith(GU));
  await p.goto('https://avenuel-fm.github.io/fm/ws/');
  await fr().locator('.key').first().waitFor();
  for (const k of '1234') await fr().locator(`.key:text-is("${k}")`).click();
  await fr().locator('.grid6').waitFor(); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/ws_main_before.png' });
  await polish(inner()); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/ws_main_after.png' });
  await p.reload(); await fr().locator('.grid6').waitFor();
  await fr().locator('button:text-is("환경설정")').click(); await fr().locator('.strow').first().waitFor();
  await inner().evaluate(() => toast('홍길동 님의 PIN을 바꿨습니다'));
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/ws_set_before.png' });
  await polish(inner()); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/ws_set_after.png' });
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
