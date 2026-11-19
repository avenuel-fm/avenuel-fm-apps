// 디자인 규칙 검사: 코드(글자 그대로)와 실제 화면(브라우저가 그린 값)을 함께 확인합니다.
import {createRequire} from 'node:module';
import {readFileSync, readdirSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(import.meta.dirname, '..');
const {chromium} = createRequire(resolve(root, '../ws/package.json'))('playwright');
const problems = [];

// 1) 코드 검사: 값 파일(tokens.css, palette.css) 밖에는 색·크기 값이 없어야 함
const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const f of walk(join(root, 'src'))) {
  if (/tokens\.css$|palette\.css$/.test(f)) continue;
  const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  for (const [name, rx] of [['<div>', /<div\b/], ['style 직접 적기', /\bstyle=\{/], ['색 값', /#[0-9a-fA-F]{3,8}\b|rgba?\(/], ['크기 값', /\b\d+(\.\d+)?(px|rem|em)\b/]])
    if (rx.test(code)) problems.push(`코드 ${f.slice(root.length + 1)}: ${name}`);
}

const tokens = readFileSync(join(root, 'src/design/tokens.css'), 'utf8');
const val = n => tokens.match(new RegExp(`--${n}:\\s*([^;]+);`))[1].trim();
const rgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
const COLORS = ['navy', 'white', 'text-sub', 'line', 'tint', 'error'].map(n => rgb(val(n)));
const SIZES = ['s', 'm', 'l', 'xl', 'xxl'].map(n => val(`size-${n}`));
const RADIUS = ['0px', val('radius')];

// 2) 화면 검사
const browser = await chromium.launch();
mkdirSync(join(root, 'shots'), {recursive: true});
for (const [name, width, height] of [['pc', 1440, 900], ['phone', 390, 844]]) {
  const touch = name === 'phone';
  const CONTROL = parseFloat(val(touch ? 'control-h-touch' : 'control-h'));
  const page = await browser.newPage({viewport: {width, height}, hasTouch: touch, isMobile: touch});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(join(root, 'dist/index.html')).href);
  await page.waitForSelector('h1');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  // fullPage 캡처는 터치 흉내를 풀어 버리므로, 창을 페이지 길이로 늘린 뒤 찍음
  const shot = async file => {
    await page.setViewportSize({width, height: await page.evaluate(() => document.documentElement.scrollHeight)});
    await page.screenshot({path: join(root, `shots/${file}.png`)});
  };
  const inputSize = await page.getByLabel('소화기 번호').evaluate(e => getComputedStyle(e).fontSize);
  const wantSize = val(touch ? 'size-input-touch' : 'size-m');
  if (inputSize !== wantSize) problems.push(`화면(${name}) 입력칸 글자 ${inputSize}, 기준 ${wantSize}`);
  console.log(`입력칸 글자(${name}): ${inputSize}`);
  await shot(name);

  const heights = await page.evaluate(() => ({
    터치기기: matchMedia('(pointer: coarse)').matches,
    버튼: [...document.querySelectorAll('.astryx-button')].map(e => e.getBoundingClientRect().height),
    입력칸: document.querySelector('input[type=text]').parentElement.getBoundingClientRect().height,  // 테두리는 바깥 칸에 있음
    층선택: document.querySelector('.astryx-selector').getBoundingClientRect().height,
    결과선택: document.querySelector('.astryx-segmented-control').getBoundingClientRect().height,
    색칸: document.querySelector('.palette-swatch').getBoundingClientRect().height,
  }));
  console.log(`높이(${name}):`, JSON.stringify(heights));
  if (heights.터치기기 !== touch) problems.push(`화면(${name}) 터치 조건이 풀림`);
  for (const [k, h] of Object.entries(heights))
    if (k !== '터치기기' && [h].flat().some(x => Math.round(x) !== CONTROL)) problems.push(`화면(${name}) ${k} 높이 ${h}, 기준 ${CONTROL}`);

  await page.getByRole('button', {name: '저장', exact: true}).click();
  await page.waitForTimeout(150);
  await shot(`${name}_error`);

  const found = await page.evaluate(({COLORS, SIZES, RADIUS, CONTROL}) => {
    const out = new Set();
    const bad = (el, what) => out.add(`${what} <${el.tagName.toLowerCase()} class="${String(el.className.baseVal ?? el.className).slice(0, 40)}"> ${(el.textContent || '').trim().slice(0, 14)}`);
    const okColor = c => COLORS.includes(c) || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    for (const el of document.querySelectorAll('#root *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.opacity === '0') continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (own && !okColor(s.color)) bad(el, `글자색 ${s.color}`);
      if (own && !SIZES.includes(s.fontSize)) bad(el, `글자크기 ${s.fontSize}`);
      if (!el.hasAttribute('data-palette') && !okColor(s.backgroundColor)) bad(el, `바탕색 ${s.backgroundColor}`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left'])
        if (parseFloat(s[`border${side}Width`]) && s[`border${side}Style`] !== 'none' && !okColor(s[`border${side}Color`])) bad(el, `테두리색 ${s[`border${side}Color`]}`);
      for (const c of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'])
        if (!RADIUS.includes(s[`border${c}Radius`]) && !(el instanceof SVGElement)) bad(el, `모서리 ${s[`border${c}Radius`]}`);
      if (s.boxShadow !== 'none') bad(el, `그림자 ${s.boxShadow.slice(0, 40)}`);
      if (el.matches('svg rect, svg path, svg text, svg circle, svg line, svg polygon') && s.fill !== 'none' && !okColor(s.fill)) bad(el, `그림색 ${s.fill}`);
      const isControl = (el.tagName === 'BUTTON' && !el.closest('nav') && el.getAttribute('role') !== 'checkbox') || el.matches('input[type=text]');
      if (isControl && Math.round(r.height) !== CONTROL) {
        const box = el.parentElement.closest('[class*=input],[class*=selector],[class*=segmented]');
        if (!box || Math.round(box.getBoundingClientRect().height) !== CONTROL) bad(el, `높이 ${r.height}`);
      }
    }
    const over = document.documentElement.scrollWidth - innerWidth;
    if (over > 0) out.add(`가로 넘침 ${over}px`);
    return [...out];
  }, {COLORS, SIZES, RADIUS, CONTROL});
  problems.push(...found.map(f => `화면(${name}) ${f}`), ...errors.map(e => `오류(${name}) ${e}`));

  await page.getByLabel('소화기 번호').fill('FE-2F-010');
  await page.getByRole('radio', {name: '보라'}).click();
  await page.getByRole('button', {name: '저장', exact: true}).click();
  await page.getByText('FE-2F-010 점검 결과를 저장했습니다.').waitFor({timeout: 3000});
  if (!(await page.getByRole('cell', {name: 'FE-2F-010'}).count())) problems.push(`동작(${name}) 저장한 줄이 표에 없음`);
  await page.close();
}
await browser.close();

console.log(problems.length ? problems.join('\n') : '디자인 규칙 검사 통과');
process.exit(problems.length ? 1 : 0);
