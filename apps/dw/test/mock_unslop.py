"""시안 전용 (앱 코드 안 고침): 도면협의 대시보드에 다듬기를 덧입혀 전·후를 찍음."""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
URL = (ROOT / 'preview.html').as_uri()
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')

ICONS = {  # 이모지 → 선 아이콘 (lucide 계열)
    '📷': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    '📄': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    '📅': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    '🔥': '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 3 2 0-2-1-4 0-6z"/>',
    '💡': '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>',
    '📡': '<path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="12" r="1"/><path d="M12 13v8"/>',
    '🔒': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    '🖼': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
    '✉': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    '⚠': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    '★': '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
}
CSS = """
body, body *{word-break:keep-all}
.ui-ico{display:inline-block;vertical-align:-3px;margin-right:2px}
"""
JS = """(icons) => {
  const st = document.createElement('style'); st.textContent = %s; document.head.appendChild(st);
  document.querySelectorAll('body *').forEach(e => {
    const w = Number(getComputedStyle(e).fontWeight);
    if (w >= 700) e.style.fontWeight = /^(H1|H2|H3)$/.test(e.tagName) ? '600' : '500';
  });
  const re = new RegExp('(' + Object.keys(icons).join('|') + ')\\uFE0F?', 'g');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = []; while (walk.nextNode()) if (re.test(walk.currentNode.data)) hits.push(walk.currentNode);
  hits.forEach(n => { const s = document.createElement('span');
    s.innerHTML = n.data.replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;').replace(re, (m, k) => '<svg class="ui-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + icons[k] + '</svg>');
    n.replaceWith(...s.childNodes); });
  return hits.length;
}""" % repr(CSS)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 860}, device_scale_factor=1.5)
        page = await ctx.new_page()
        await page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await page.goto(URL)
        await page.evaluate('localStorage.clear(); sessionStorage.clear()')
        await page.reload()
        await page.fill('#pin', '1234'); await page.click('button[type=submit]')
        await page.wait_for_selector('text=도면협의 대시보드'); await page.wait_for_timeout(600)
        await page.screenshot(path=str(OUT / 'dw_dash_before.png'))
        n = await page.evaluate(JS, ICONS)
        await page.screenshot(path=str(OUT / 'dw_dash_after.png'))
        print('dashboard emoji replaced:', n)
        # 첫 매장 상세
        await page.reload(); await page.wait_for_selector('text=도면협의 대시보드')
        row = page.locator('[data-act=open], tr[data-id], .store-row').first
        if await row.count():
            await row.click(); await page.wait_for_timeout(800)
            await page.screenshot(path=str(OUT / 'dw_detail_before.png'))
            n = await page.evaluate(JS, ICONS)
            await page.screenshot(path=str(OUT / 'dw_detail_after.png'))
            print('detail emoji replaced:', n)
        await b.close()

asyncio.run(main())
