"""1.1 브라우저 점검: 지침 검색 필터 · 쪽 미리보기(마우스 올림 / 고정 / 확대 / 태블릿 탭)"""
import asyncio, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
URL = (ROOT / 'preview.html').as_uri()
OUT = ROOT / 'shots'
OUT.mkdir(exist_ok=True)


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        await page.route('**/fonts.g*/**', lambda r: r.abort())
        await page.goto(URL)
        await page.evaluate('localStorage.clear(); sessionStorage.clear()')
        await page.reload()
        await page.fill('#pin', '1234'); await page.click('button[type=submit]')
        await page.wait_for_selector('[data-act=new]')
        await page.click('[data-act=new]')
        await page.wait_for_selector('#notes')
        await page.fill('#f-tenant', '미리보기 시험')
        await page.click('#notes')
        await page.keyboard.type('1. 관통부 방화구획 확인 ')
        await page.keyboard.press('Control+k')
        await page.fill('#gq', '방화구획')
        await page.wait_for_selector('#gres .hit')
        filt = await page.inner_text('#gfilter')
        check('전체' in filt and '시설공사 지침' in filt, '지침 고르기 버튼 표시: ' + filt.replace('\n', ' '))
        check('통합안전관리지침' in filt, '통합안전관리지침도 함께 검색')

        print('통합안전관리지침 결과 · 가로형 쪽 미리보기')
        await page.click('[data-gfilter=s]')
        await page.wait_for_selector('#gres .hit')
        ref_s = await page.inner_text('#gres [data-gins="0"]')
        check('(통합안전관리지침 방화및방염관련, p.91)' in ref_s, '삽입 문구: ' + ref_s)
        await page.hover('#gres .hit >> nth=0')
        await page.wait_for_selector('#gprev.wide .pv-page img')
        await page.wait_for_function("(() => { const i = document.querySelector('#gprev .pv-page img'); return i && i.complete && i.naturalWidth > 0; })()")
        wbox = await page.locator('#gprev .pv-page').bounding_box()
        check(wbox['width'] >= 880, f"가로형 쪽은 넓은 미리보기 ({round(wbox['width'])}px)")
        check(await page.locator('#gprev .pv-hl').count() >= 1, '가로형 쪽에도 노란 표시')
        await page.wait_for_timeout(300)
        await page.screenshot(path=OUT / 'v11_preview_safety.png')
        await page.mouse.move(100, 450); await page.wait_for_timeout(400)
        await page.click('[data-gfilter=all]')
        await page.wait_for_timeout(100)

        print('마우스 올림 미리보기')
        await page.hover('#gres .hit >> nth=0')
        await page.wait_for_selector('#gprev .pv-page img')
        await page.wait_for_function("(() => { const i = document.querySelector('#gprev .pv-page img'); return i && i.complete && i.naturalWidth > 0; })()")
        check(True, '결과에 마우스를 올리면 쪽 이미지 표시')
        hl = await page.locator('#gprev .pv-hl').count()
        check(hl >= 1, f'검색어 줄 노란 표시 {hl}개')
        box = await page.locator('#gprev .pv-page').bounding_box()
        check(box['width'] >= 590, f"미리보기 폭 {round(box['width'])}px (읽을 수 있는 크기)")
        title = await page.inner_text('#gprev .pv-head')
        check('설비공사 지침 6/10' in title and '30쪽' in title, '머리글에 지침 구분과 쪽 표시')
        await page.screenshot(path=OUT / 'v11_preview_hover.png')

        await page.click('[data-pv=in]')
        await page.wait_for_selector('#gprev .pv-page')
        w = (await page.locator('#gprev .pv-page').bounding_box())['width']
        check(abs(w - 750) < 3, f'확대 125% → 폭 {round(w)}px')
        await page.click('[data-pv=out]')

        await page.mouse.move(200, 450)
        await page.wait_for_timeout(500)
        check(await page.locator('#gprev').count() == 0, '고정 안 하면 마우스가 벗어날 때 닫힘')

        await page.hover('#gres .hit >> nth=0')
        await page.wait_for_selector('#gprev .pv-page img')
        await page.click('[data-pv=pin]')
        await page.mouse.move(200, 450)
        await page.wait_for_timeout(500)
        check(await page.locator('#gprev').count() == 1, '고정하면 마우스가 벗어나도 유지')

        n_hits = await page.locator('#gres .hit').count()
        if n_hits > 1:
            await page.hover('#gres .hit >> nth=1')
            await page.wait_for_timeout(400)
            check(await page.locator('#gres .hit.on').get_attribute('data-hit') == '1', '다른 결과에 올리면 미리보기가 그 쪽으로 바뀜')

        await page.press('body', 'Escape')
        check(await page.locator('#gprev').count() == 0, 'Esc로 미리보기 닫기')

        print('미리보기에서 삽입')
        await page.hover('#gres .hit >> nth=0')
        await page.wait_for_selector('#gprev [data-pv=ins]')
        await page.click('#gprev [data-pv=ins]')
        notes = await page.input_value('#notes')
        check('(설비공사 지침 6/10, p.30)' in notes or '(통합안전관리지침' in notes, '미리보기의 삽입 버튼으로 쪽 번호 삽입: ' + notes[-40:])
        check(await page.locator('#gprev').count() == 0 and await page.locator('#gpanel').count() == 0, '삽입 후 검색창·미리보기 닫힘')

        print('#키워드 검색에서도 동작')
        await page.click('#notes'); await page.keyboard.press('End')
        await page.keyboard.type(' #감지기')
        await page.wait_for_selector('#gres .hit')
        await page.hover('#gres .hit >> nth=0')
        await page.wait_for_selector('#gprev .pv-page img')
        check(True, '#감지기 결과도 미리보기 표시')
        await page.press('#notes', 'Escape')

        print('태블릿 (터치)')
        tctx = await b.new_context(viewport={'width': 834, 'height': 1194}, has_touch=True, is_mobile=True)
        tp = await tctx.new_page()
        tp.on('pageerror', lambda e: errors.append('tablet pageerror: ' + str(e)))
        await tp.route('**/fonts.g*/**', lambda r: r.abort())
        await tp.goto(URL)
        await tp.evaluate('localStorage.clear(); sessionStorage.clear()')
        await tp.reload()
        await tp.fill('#pin', '1234'); await tp.tap('button[type=submit]')
        await tp.wait_for_selector('[data-act=new]')
        await tp.tap('[data-act=new]')
        await tp.wait_for_selector('#notes')
        await tp.tap('[data-act=guide]')
        await tp.fill('#gq', '방화구획')
        await tp.wait_for_selector('#gres .pgbtn')
        await tp.tap('#gres .pgbtn >> nth=0')
        await tp.wait_for_selector('#gprev.modal .pv-page img')
        check(True, '태블릿: 쪽 번호를 누르면 전체 화면 미리보기')
        await tp.wait_for_timeout(300)
        await tp.screenshot(path=OUT / 'v11_preview_tablet.png')
        await tp.tap('[data-pv=close]')
        check(await tp.locator('#gprev').count() == 0, '태블릿: 닫기')
        await b.close()
    print('ERRORS:', errors if errors else 'none')
    if errors:
        raise SystemExit(1)

asyncio.run(main())
