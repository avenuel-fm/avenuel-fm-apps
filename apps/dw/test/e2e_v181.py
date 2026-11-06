"""1.8.1 브라우저 점검: 지침 검색 팝업 전체 스크롤·검색창 고정·키워드 접기·휴대폰 전체 화면 / 저장 버튼 즉시 반응·중복 안내·이어서 저장·포커스 유지·터치 / 서명 후 바로 저장"""
import asyncio, pathlib, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
PORT = 8795
URL = f'http://127.0.0.1:{PORT}/preview.html'


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


async def login_new(page):
    await page.route('**/fonts.g*/**', lambda r: r.abort())
    await page.goto(URL)
    await page.evaluate('localStorage.clear(); sessionStorage.clear()'); await page.reload()
    await page.fill('#pin', '1234'); await page.click('#loginForm button[type=submit]')
    await page.wait_for_selector('[data-act=new]')
    await page.click('[data-act=new]'); await page.wait_for_selector('#notes')


async def calls(page, name):
    return await page.evaluate("(n) => (window.__mockCalls || []).filter(x => x === n).length", name)


async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()

        print('지침 검색 팝업 (태블릿 가로)')
        ctx = await b.new_context(viewport={'width': 1180, 'height': 820})
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await login_new(page)
        await page.click('[data-act=guide]'); await page.wait_for_selector('#gq')
        check(await page.is_visible('#gkw .gchips'), '검색 전: 자주 찾는 키워드 보임')
        await page.fill('#gq', '감지기'); await page.wait_for_selector('#gres .hit')
        check(not await page.is_visible('#gkw') and await page.inner_text('#gkwt') == '자주 찾는 키워드 ▾', '결과가 나오면 키워드·안내를 한 줄로 접음')
        await page.click('#gkwt')
        check(await page.is_visible('#gkw .gchips') and '접기' in await page.inner_text('#gkwt'), '누르면 다시 펼침')
        await page.click('#gkwt')
        m = await page.evaluate("""() => { const p = document.querySelector('#gpanel'); return {over: getComputedStyle(p).overflowY, sh: p.scrollHeight, ch: p.clientHeight, body: getComputedStyle(document.querySelector('#gres')).overflowY} }""")
        check(m['over'] == 'auto' and m['body'] == 'visible' and m['sh'] > m['ch'] * 2, f'팝업 전체가 스크롤 (결과 칸 따로 스크롤 안 함) {m}')
        await page.evaluate("document.querySelector('#gpanel').scrollTop = 1500")
        await page.wait_for_timeout(150)
        pos = await page.evaluate("""() => { const p = document.querySelector('#gpanel').getBoundingClientRect(), s = document.querySelector('.gp-sticky').getBoundingClientRect(), x = document.querySelector('#gpClose').getBoundingClientRect(); return {d: Math.round(s.top - p.top), xs: Math.round(x.top - p.top), sc: document.querySelector('#gpanel').classList.contains('scrolled')} }""")
        check(pos['d'] == 0 and pos['xs'] < 20 and pos['sc'], f'스크롤해도 검색창·✕는 위에 고정, 그림자 표시 {pos}')
        await page.fill('#gq', '방염'); await page.wait_for_timeout(200)
        gap = await page.evaluate("""() => { const s = document.querySelector('.gp-sticky').getBoundingClientRect(), r = document.querySelector('#gres').getBoundingClientRect(); return Math.round(r.top - s.bottom) }""")
        check(-2 <= gap <= 40, f'새 검색어 → 결과 맨 앞이 검색창 바로 아래 ({gap}px)')
        await page.click('#gres [data-gins="0"]')
        check(await page.locator('#gpanel').count() == 0 and '(' in await page.input_value('#notes'), '결과 삽입·팝업 닫힘 정상')
        await ctx.close()

        print('지침 검색 팝업 (휴대폰)')
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await login_new(page)
        await page.click('[data-act=guide]'); await page.fill('#gq', '감지기'); await page.wait_for_selector('#gres .hit')
        r = await page.evaluate("(() => { const b = document.querySelector('#gpanel').getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)] })()")
        check(r[0] == 0 and r[1] >= 840, f'휴대폰은 전체 화면 {r}')
        vis = await page.evaluate("""() => { const p = document.querySelector('#gpanel'); p.scrollTop = 99999; const s = document.querySelector('.gp-sticky').getBoundingClientRect(); return Math.round(p.clientHeight - s.height) }""")
        check(vis > 700, f'결과가 보이는 높이 {vis}px (전: 약 300px)')
        await ctx.close()

        print('저장 버튼 (PC, 서버 응답 1.5초)')
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await login_new(page)
        await page.fill('#f-tenant', '샤넬 뷰티')
        await page.evaluate('window.__mockDelay = 1500; window.__mockCalls = []')
        await page.click('#f-location'); await page.keyboard.type('B1F')
        btn = page.locator('.foot-actions [data-act=save]')
        await btn.click()
        await page.wait_for_timeout(80)
        txt = await btn.inner_text()
        check('저장 중' in txt and await btn.evaluate('b => b.classList.contains("busy") && !!b.querySelector(".spin")'), '한 번 누르면 바로 버튼이 "저장 중…"(회전 표시)')
        check(await page.evaluate("document.activeElement && document.activeElement.id") == 'f-location', '누른 뒤에도 입력칸 포커스 유지 (키보드 안 닫힘)')
        await btn.click()
        await page.wait_for_selector('.toast:has-text("저장 중입니다")')
        check(True, '저장 중에 다시 누르면 "저장 중입니다" 안내')
        await page.wait_for_function("() => /저장됨/.test(document.querySelector('.savestate').textContent)", timeout=6000)
        await page.wait_for_timeout(300)
        check(await calls(page, 'apiSaveReview') == 1, '한 번 누름에 한 번 저장 (두 번째 누름은 중복 저장 안 함)')
        check((await btn.inner_text()).strip() == '임시저장' and not await btn.evaluate('b => b.classList.contains("busy")'), '끝나면 버튼 원래대로')

        await ctx.close()

        print('터치 (아이패드): 키보드가 열린 상태에서 한 번 탭')
        ctx = await b.new_context(viewport={'width': 820, 'height': 1180}, has_touch=True, is_mobile=True)
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await login_new(page)
        await page.fill('#f-tenant', '디올')
        await page.evaluate('window.__mockDelay = 600; window.__mockCalls = []')
        await page.tap('#f-location'); await page.keyboard.type('2F')
        await page.locator('.foot-actions [data-act=save]').evaluate("b => b.scrollIntoView({block: 'center'})")
        bx = await page.locator('.foot-actions [data-act=save]').bounding_box()
        # 첫 터치가 끝나는 순간 아래 막대가 움직이는 상황 흉내: pointerup 직후 레이아웃을 밀어도 저장은 이미 실행됨
        await page.evaluate("""() => document.addEventListener('focusout', () => { document.body.style.paddingTop = '120px' }, {once: true})""")
        await page.touchscreen.tap(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2)
        await page.wait_for_function("() => /저장됨/.test(document.querySelector('.savestate').textContent)", timeout=6000)
        check(await calls(page, 'apiSaveReview') == 1, '탭 한 번에 저장 1번 (뒤따르는 click으로 두 번 저장 안 함)')
        await page.evaluate("document.body.style.paddingTop = ''")
        await page.evaluate('window.__mockCalls = []')
        await page.locator('.foot-actions [data-act=finalize]').evaluate("b => b.scrollIntoView({block: 'center'})")
        bx = await page.locator('.foot-actions [data-act=finalize]').bounding_box()
        await page.touchscreen.tap(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2)
        await page.wait_for_selector('.misslist'); await page.wait_for_timeout(900)
        check(await page.locator('.misslist').count() == 1 and await calls(page, 'apiSaveReview') == 0, '검토 완료 탭 → 빠진 항목 창이 뜨고, 같은 자리 click이 창 버튼을 대신 누르지 않음')
        await page.click('#missBack')
        await ctx.close()

        print('서명 완료 → 바로 저장')
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await login_new(page)
        await page.fill('#f-tenant', '에르메스')
        await page.click('[data-act=save]')
        await page.wait_for_function("() => /저장됨/.test(document.querySelector('.savestate').textContent)")
        await page.evaluate('window.__mockCalls = []')
        sb = page.locator('[data-act=sig]').first
        await sb.scroll_into_view_if_needed(); await sb.click(); await page.wait_for_selector('#sigc')
        c = await page.locator('#sigc').bounding_box()
        await page.mouse.move(c['x'] + 30, c['y'] + 40); await page.mouse.down()
        await page.mouse.move(c['x'] + 160, c['y'] + 80, steps=8); await page.mouse.up()
        await page.click('#sigOk')
        await page.wait_for_selector('.toast:has-text("서명을 저장했습니다")', timeout=5000)
        check(await calls(page, 'apiSaveReview') == 1, '서명 완료 직후 구글시트에 저장 + 안내')
        check('저장됨' in await page.inner_text('.savestate'), '저장 상태 "저장됨"')

        print('조용한 저장(서명 후 저장) 중에 임시저장 누름 → 끝난 뒤 이어서 저장')
        await page.evaluate('window.__mockDelay = 1200; window.__mockCalls = []')
        await sb.click(); await page.wait_for_selector('#sigc')
        c = await page.locator('#sigc').bounding_box()
        await page.mouse.move(c['x'] + 40, c['y'] + 30); await page.mouse.down(); await page.mouse.move(c['x'] + 140, c['y'] + 90, steps=6); await page.mouse.up()
        await page.click('#sigOk'); await page.wait_for_timeout(100)
        await page.fill('#f-location', '3F')
        btn = page.locator('.foot-actions [data-act=save]')
        await btn.click(); await page.wait_for_timeout(60)
        check('저장 중' in await btn.inner_text() and await page.locator('.toast:has-text("끝나면 이어서")').count() == 1, '누르는 즉시 "저장 중…" + "끝나면 이어서 저장" 안내')
        await page.wait_for_function("() => (window.__mockCalls||[]).filter(x => x === 'apiSaveReview').length === 2", timeout=8000)
        await page.wait_for_function("() => /저장됨/.test(document.querySelector('.savestate').textContent)", timeout=6000)
        saved = await page.evaluate("() => JSON.parse(localStorage.getItem('dr_mock_reviews')||'[]').length")
        check(await calls(page, 'apiSaveReview') == 2 and (await btn.inner_text()).strip() == '임시저장', '이어서 한 번 더 저장, 버튼 원래대로')
        await ctx.close()

        print('서명 완료: 테넌트명이 없으면 바로 저장하지 않음 (기존처럼 저장 안 됨 표시)')
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await login_new(page)
        await page.evaluate('window.__mockCalls = []')
        sb = page.locator('[data-act=sig]').first
        await sb.scroll_into_view_if_needed(); await sb.click(); await page.wait_for_selector('#sigc')
        c = await page.locator('#sigc').bounding_box()
        await page.mouse.move(c['x'] + 30, c['y'] + 40); await page.mouse.down(); await page.mouse.move(c['x'] + 120, c['y'] + 70, steps=5); await page.mouse.up()
        await page.click('#sigOk'); await page.wait_for_timeout(600)
        check(await calls(page, 'apiSaveReview') == 0 and await page.locator('.toast:has-text("테넌트명")').count() == 0, '테넌트명 없으면 저장 시도·경고 없음')
        await ctx.close()

        await b.close()
    if errors:
        raise AssertionError('페이지 오류: ' + ' | '.join(errors))
    print('1.8.1 점검 통과')


srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    asyncio.run(main())
finally:
    srv.terminate()
