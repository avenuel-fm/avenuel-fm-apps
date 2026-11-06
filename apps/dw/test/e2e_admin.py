"""1.2 브라우저 점검: 자주 쓰는 문구 삽입 · 서명란 공사 책임자 자동 입력 · 지침 관리(드라이브 PDF → 색인 만들기, 끊김 후 이어서)
http 서버로 dev 폴더를 열어야 PDF를 읽을 수 있습니다 (스크립트가 직접 띄움)."""
import asyncio, pathlib, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'shots'
OUT.mkdir(exist_ok=True)
PORT = 8765
URL = f'http://127.0.0.1:{PORT}/preview.html'


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

        print('자주 쓰는 문구')
        await page.click('[data-act=new]')
        await page.wait_for_selector('#notes')
        await page.fill('#notes', '첫 줄\n')
        await page.click('#notes'); await page.keyboard.press('Control+End')
        await page.click('[data-act=phrases]')
        await page.wait_for_selector('[data-ph]')
        first = await page.evaluate('window.__DR.boot.phrases[0].t')
        await page.click('[data-ph] >> nth=0')
        notes = await page.input_value('#notes')
        check(first.strip() in notes, '문구를 누르면 특이사항에 삽입: ' + first[:20])
        check(await page.locator('[data-ph]').count() == 0, '삽입 후 목록 닫힘')

        print('서명란 공사 책임자 ← 시공업체')
        await page.fill('#f-contractorCompany', '가나인테리어')
        await page.fill('#f-contractorName', '김시공')
        await page.fill('#f-contractorTel', '01012345678')
        check(await page.input_value('#f-respOrg') == '가나인테리어', '소속 = 시공업체 업체명')
        check(await page.input_value('#f-respName') == '김시공', '성명 = 시공업체 담당자')
        check(await page.input_value('#f-respTel') == '010-1234-5678', '연락처 = 시공업체 연락처')
        await page.fill('#f-contractorName', '김시공2')
        check(await page.input_value('#f-respName') == '김시공2', '시공업체 담당자를 고치면 따라 바뀜')
        await page.fill('#f-respName', '박책임')
        await page.fill('#f-contractorName', '이담당')
        check(await page.input_value('#f-respName') == '박책임', '서명란을 직접 고친 값은 유지')
        await page.fill('#f-tenant', '서명 시험')
        await page.click('[data-act=save]')
        await page.wait_for_function("document.querySelector('.savestate') && /저장됨/.test(document.querySelector('.savestate').textContent)", timeout=10000)
        await page.click('[data-act=dash]')
        await page.wait_for_selector('[data-act=gadmin]')

        print('지침 관리')
        await page.click('[data-act=gadmin]')
        await page.wait_for_selector('.gadm')
        txt = await page.inner_text('.gadm')
        check('도면협의_지침' in txt and '통합안전관리지침_26.pdf' in txt, '드라이브 폴더와 PDF 목록 표시')
        check(txt.count('최신') == 2, '검색에 쓰는 지침 2개 · 최신')
        await page.screenshot(path=OUT / 'v12_admin.png', full_page=True)

        # 통합안전관리지침을 검색에서 빼기
        rows = page.locator('.gadm section:nth-of-type(2) .grow')
        await rows.filter(has_text='통합안전관리지침').locator('[data-act=gremove]').click()
        await page.click('.dialog .main-act')
        await page.wait_for_function("document.querySelectorAll('.gadm section:nth-of-type(2) .grow').length === 1")
        check(True, '검색에서 빼기 → 1개 남음')

        # 색인 만들기 (중간에 끊김 → 이어서)
        await page.evaluate('window.__mockFailSaveAfter = 40; window.__mockFailTimes = 2')
        prow = page.locator('.gadm section:nth-of-type(3) .grow').filter(has_text='통합안전관리지침_26.pdf')
        await prow.locator('[data-act=gbuild]').click()
        await page.wait_for_selector('#gfShort')
        check(await page.input_value('#gfTitle') == '통합안전관리지침 26', '지침 이름: 파일 이름으로 미리 채움')
        await page.click('.dialog .main-act')
        check(not await page.locator('#gfErr').is_hidden(), '줄임말 없으면 시작 안 함')
        await page.fill('#gfTitle', '타워&몰 통합안전관리지침 (26년 개정판)')
        await page.fill('#gfShort', '통합안전관리지침')
        t0 = time.time()
        await page.click('.dialog .main-act')
        await page.wait_for_selector('#gbProg')
        await page.wait_for_function("/2\\/3/.test((document.querySelector('#gbStep')||{}).textContent||'')", timeout=120000)
        await page.screenshot(path=OUT / 'v12_building.png')
        for _ in range(600):
            if await page.locator('#gbClose').count(): break
            if _ % 10 == 0: print('    …', await page.evaluate("(document.querySelector('#gbStep')||{}).textContent + ' ' + (document.querySelector('#gbNum')||{}).textContent"))
            await page.wait_for_timeout(1000)
        await page.wait_for_selector('#gbClose', timeout=5000)
        msg = await page.inner_text('.dialog')
        check('멈췄습니다' in msg and '이어서' in msg, '저장 중 끊기면 멈춤 안내')
        await page.click('#gbClose')
        await page.wait_for_selector('.gbuilding')
        check('끝나지 않은 색인 작업' in await page.inner_text('.gbuilding'), '끝나지 않은 작업 표시')
        await page.click('.gbuilding [data-act=gbuild]')
        await page.wait_for_selector('#gfShort')
        check(await page.input_value('#gfShort') == '통합안전관리지침', '이어서 만들기: 입력값 유지')
        await page.click('.dialog .main-act')
        await page.wait_for_function("!document.querySelector('#gbProg') && !document.querySelector('#gbClose')", timeout=400000)
        took = round(time.time() - t0)
        check(await page.locator('.gbuilding').count() == 0, f'색인 완료 (총 {took}초)')
        saved = await page.evaluate("Object.keys(window.__mockGuides.images[window.__mockGuides.sources[1].id]).length")
        check(saved == 132, f'쪽 이미지 {saved}/132 (이어서 만들 때 저장된 쪽은 건너뜀)')
        n_entries = await page.evaluate("window.__mockGuides.sources[1].entries")
        check(n_entries > 700, f'검색 항목 {n_entries}개')
        txt = await page.inner_text('.gadm')
        check(txt.count('최신') == 2 and '검색 항목 ' + str(n_entries) in txt, '다시 2개 · 항목 수 표시')
        await page.screenshot(path=OUT / 'v12_admin_done.png', full_page=True)

        print('새 색인으로 검색')
        await page.click('[data-act=dash]')
        await page.wait_for_selector('[data-act=new]')
        await page.click('[data-act=new]')
        await page.wait_for_selector('#notes')
        await page.click('#notes')
        await page.keyboard.press('Control+k')
        await page.fill('#gq', '방화구획')
        await page.wait_for_selector('#gres .hit')
        new_id = await page.evaluate("window.__mockGuides.sources[1].id")
        await page.click(f'[data-gfilter={new_id}]')
        await page.wait_for_timeout(200)
        refs = await page.locator('#gres [data-gins]').all_inner_texts()
        check(any('(통합안전관리지침 방화및방염관련, p.91)' in r for r in refs), '삽입 문구 (통합안전관리지침 방화및방염관련, p.91)')
        await page.hover('#gres .hit >> nth=0')
        await page.wait_for_selector('#gprev.wide .pv-page img')
        await page.wait_for_function("(() => { const i = document.querySelector('#gprev .pv-page img'); return i && i.complete && i.naturalWidth >= 1300; })()")
        check(await page.locator('#gprev .pv-hl').count() >= 1, '새로 만든 쪽 이미지(1400px) + 노란 표시')
        await page.wait_for_timeout(300)
        await page.screenshot(path=OUT / 'v12_search_new.png')
        await b.close()
    print('ERRORS:', errors if errors else 'none')
    if errors:
        raise SystemExit(1)


srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    asyncio.run(main())
finally:
    srv.terminate()
