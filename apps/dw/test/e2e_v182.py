"""1.8.2 브라우저 점검: 종합방재실 협의서 (입력 버튼 → 찍기/고르기 → 확인하기 → A4 팝업·회전 기억 → 다시 올리기·지우기),
소방 점검 예정일 제안(공사 종료일), 대시보드 「방재실 협의 ✓」·할 일 「방재실 협의서 미첨부」"""
import asyncio, base64, pathlib, subprocess, sys, time, datetime
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'shots'
PORT = 8796
URL = f'http://127.0.0.1:{PORT}/preview.html'
DOC = pathlib.Path('/tmp/claude-0/-home-claude/201049d4-e65c-5994-92af-6bfa4bbd73d4/scratchpad/fake_doc_landscape.jpg')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


def day(n):
    return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()


async def setv(page, key, v):
    await page.evaluate("([k,v])=>{const i=document.querySelector('#f-'+k);i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))}", [key, v])


async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.route('**/fonts.g*/**', lambda r: r.abort())
        await page.goto(URL)
        await page.evaluate('localStorage.clear(); sessionStorage.clear()'); await page.reload()
        await page.fill('#pin', '1234'); await page.click('#loginForm button[type=submit]')
        await page.wait_for_selector('[data-act=new]')
        await page.click('[data-act=new]'); await page.wait_for_selector('#notes')

        print('소방 점검 예정일 제안')
        check(await page.inner_text('#fireSug') == '', '공사 종료일이 없으면 제안 없음')
        await setv(page, 'openDate', day(6))
        check(await page.inner_text('#fireSug') == '', '오픈 예정일만으로는 제안하지 않음 (예전: 오픈 2일 전)')
        await setv(page, 'periodStart', day(-10)); await setv(page, 'periodEnd', day(4))
        sug = await page.inner_text('#fireSug')
        check('공사 종료일' in sug and day(4) in sug, f'제안 = 공사 종료일 {day(4)}')
        await page.click('#fireSug [data-act=fireSug]')
        check(await page.input_value('#f-fireCheckDate') == day(4) and await page.inner_text('#fireSug') == '', '누르면 날짜 칸에 들어가고 제안은 사라짐')
        await page.fill('#f-fireCheckDate', day(3))
        check(await page.evaluate('window.__DR.review.fireCheckDate') == day(3), '넣은 뒤에도 날짜 칸에서 고칠 수 있음')

        print('협의서 버튼 위치')
        pos = await page.evaluate("""() => { const i = document.querySelector('#f-fireCheckDate').getBoundingClientRect(), b = document.querySelector('#fdSlot .fdbtn').getBoundingClientRect();
          return {same: Math.abs(i.top - b.top) < 3, right: b.left > i.right, txt: document.querySelector('#fdSlot .fdbtn').textContent} }""")
        check(pos['same'] and pos['right'] and '종합방재실 협의서 입력' in pos['txt'], '날짜 칸 바로 오른쪽에 [종합방재실 협의서 입력]')

        print('테넌트명 없이 누르면 안내')
        await page.click('#fdSlot [data-act=fdAdd]')
        check(await page.locator('.fdpick').count() == 1, '찍기 / 고르기 창')
        labels = await page.locator('.fdpick .fdbig').all_inner_texts()
        check(any('카메라' in t for t in labels) and any('사진 파일' in t for t in labels), '카메라로 찍기 · 사진 파일 고르기')
        check(await page.get_attribute('#fdCam', 'capture') == 'environment' and await page.get_attribute('#fdFile', 'capture') is None, '카메라는 capture, 파일은 앨범')
        await page.set_input_files('#fdFile', str(DOC))
        await page.wait_for_selector('.toast:has-text("테넌트명")')
        check(await page.evaluate('window.__mockCalls.filter(x=>x==="apiFireDocUpload").length') == 0, '테넌트명이 없으면 올리지 않음')

        print('올리기 (새 매장은 먼저 저장)')
        await page.fill('#f-tenant', '샤넬 뷰티')
        await page.evaluate('window.__mockCalls = []')
        await page.click('#fdSlot [data-act=fdAdd]')
        await page.set_input_files('#fdFile', str(DOC))
        await page.wait_for_selector('#fdSlot [data-act=fdView]', timeout=8000)
        calls = await page.evaluate('window.__mockCalls')
        check(calls.index('apiSaveReview') < calls.index('apiFireDocUpload'), '저장 안 된 새 매장은 먼저 저장한 뒤 올림')
        check('종합방재실 협의서 확인하기' in await page.inner_text('#fdSlot'), '버튼이 [종합방재실 협의서 확인하기]로 바뀜')
        check('부소장' in await page.inner_text('#fdMeta') or '소장' in await page.inner_text('#fdMeta'), '올린 일시·사람 + 다시 올리기·지우기')
        dims = await page.evaluate("""() => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = window.__mockPhotos[JSON.parse(window.__DR.store.fireDoc).f]; })""")
        check(max(dims) == 1600 or max(dims) <= 2400, f'문서 사진은 최대 2400px로 저장 (원본 1600x1200 → {dims})')
        big = base64.b64encode(DOC.read_bytes()).decode()

        print('확인하기 팝업 (A4 비율 · 회전)')
        await page.click('#fdSlot [data-act=fdView]')
        await page.wait_for_selector('#fdvImg')
        await page.wait_for_function("document.querySelector('#fdvImg').style.width !== ''")
        box = await page.evaluate("(() => { const r = document.querySelector('.fdview').getBoundingClientRect(); return [r.width, r.height] })()")
        check(0.6 < box[0] / box[1] < 0.75 and box[1] > 800, f'A4 세로에 가까운 팝업 {box}')
        ft = await page.locator('.fdv-ft button').all_inner_texts()
        check(ft == ['↺ 왼쪽으로 돌리기', '↻ 오른쪽으로 돌리기'], '사진 아래 좌우 회전 버튼')
        await page.click('#fdvL'); await page.wait_for_timeout(250)
        tr = await page.evaluate("document.querySelector('#fdvImg').style.transform")
        check('rotate(270deg)' in tr, '왼쪽으로 돌리기 → 270도')
        fits = await page.evaluate("""() => { const b = document.querySelector('#fdvBd').getBoundingClientRect(), i = document.querySelector('#fdvImg').getBoundingClientRect(); return i.width <= b.width + 1 && i.height <= b.height + 1 && i.height > i.width }""")
        check(fits, '돌린 뒤에도 칸 안에 꽉 맞게 (세로로 섬)')
        await page.wait_for_timeout(900)
        check(await page.evaluate('window.__mockCalls.filter(x=>x==="apiFireDocRotate").length') == 1, '돌린 방향을 서버에 저장 (잠깐 뒤 1번)')
        await page.screenshot(path=str(OUT / 'v182_fdview.png'))
        await page.keyboard.press('Escape')
        check(await page.locator('.fdview').count() == 0, 'Esc로 닫힘')
        # 다른 기기에서 열어도 그 방향: 캐시 지우고 다시 열기
        await page.evaluate('window.__DR.fdImg = null')
        await page.click('#fdSlot [data-act=fdView]'); await page.wait_for_selector('#fdvImg')
        await page.wait_for_function("document.querySelector('#fdvImg').style.width !== ''")
        check('rotate(270deg)' in await page.evaluate("document.querySelector('#fdvImg').style.transform"), '다시 열어도 돌린 방향 그대로 (기억)')
        await page.click('#fdvX')

        print('대시보드')
        await page.click('[data-act=dash]'); await page.wait_for_selector('#todos')
        check('방재실 협의 ✓' in await page.inner_text('#dashBody'), '매장 이름 아래 「방재실 협의 ✓」')
        t = await page.inner_text('#todos')
        check('방재실 협의서 미첨부 0' in t.replace('\n', ' '), '협의서가 있으면 미첨부 0')

        print('지우기 → 할 일에 미첨부')
        await page.click('.store-link'); await page.wait_for_selector('#fdSlot')
        await page.click('#fdMeta [data-act=fdDel]')
        await page.click('.dialog .btn.warn')
        await page.wait_for_selector('#fdSlot [data-act=fdAdd]')
        check(await page.inner_text('#fdMeta') == '', '지우면 [입력] 버튼으로 돌아감')
        await page.click('[data-act=dash]'); await page.wait_for_selector('#todos')
        t = await page.inner_text('#todos')
        check('방재실 협의서 미첨부 1' in t.replace('\n', ' '), '소방 점검 3일 전·협의서 없음 → 할 일 1')
        await page.click('[data-act=todo][data-k=fd]')
        check(await page.locator('#dashBody .store-link').count() == 1 and '방재실 협의서 미첨부' in await page.inner_text('#todoChip'), '눌러서 그 매장만 걸러 보기')

        print('잠긴(컨펌완료) 검토서에서도 올리기 가능')
        await page.click('[data-act=todo][data-k=fd]')
        await page.click('[data-act=confirm]'); await page.wait_for_selector('.dialog .main-act'); await page.click('.dialog .main-act'); await page.wait_for_timeout(500)
        await page.click('.store-link'); await page.wait_for_selector('#fdSlot')
        check(await page.locator('#fdSlot [data-act=fdAdd]').count() == 1, '컨펌완료 뒤에도 협의서 버튼 보임')
        await ctx.close()

        print('휴대폰')
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await page.route('**/fonts.g*/**', lambda r: r.abort())
        await page.goto(URL); await page.evaluate('localStorage.clear()'); await page.reload()
        await page.fill('#pin', '1234'); await page.click('#loginForm button[type=submit]')
        await page.wait_for_selector('[data-act=new]')
        await page.click('[data-act=new]'); await page.wait_for_selector('#fdSlot')
        await page.fill('#f-tenant', '디올')
        over = await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
        check(not over, '가로 넘침 없음 (390)')
        await page.click('#fdSlot [data-act=fdAdd]')
        await page.set_input_files('#fdFile', str(DOC))
        await page.wait_for_selector('#fdSlot [data-act=fdView]', timeout=8000)
        await page.click('#fdSlot [data-act=fdView]'); await page.wait_for_selector('#fdvImg')
        await page.wait_for_function("document.querySelector('#fdvImg').style.width !== ''")
        r = await page.evaluate("(() => { const v = document.querySelector('.fdview').getBoundingClientRect(); const f = document.querySelector('.fdv-ft').getBoundingClientRect(); return [v.left, v.right, f.bottom, innerWidth, innerHeight] })()")
        check(r[0] >= 0 and r[1] <= r[3] and r[2] <= r[4], f'휴대폰 팝업이 화면 안, 회전 버튼 보임 {r}')
        await page.screenshot(path=str(OUT / 'v182_fdview_phone.png'))
        await ctx.close()
        await b.close()
    if errors:
        raise AssertionError('페이지 오류: ' + ' | '.join(errors))
    print('1.8.2 점검 통과')


srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    asyncio.run(main())
finally:
    srv.terminate()
