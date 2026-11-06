"""1.7 브라우저 점검: PIN 팝업만 · 기기 기억 · PIN으로 소장/부소장 · 9번 소장 확인 · 대시보드 표시 · 기준 연도 · 메일 서명"""
import asyncio, pathlib, subprocess, sys, time, datetime
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'shots'
OUT.mkdir(exist_ok=True)
PORT = 8793
URL = f'http://127.0.0.1:{PORT}/preview.html'
Y = datetime.date.today().year


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


async def login(page, pin):
    await page.wait_for_selector('#pin')
    await page.fill('#pin', pin); await page.click('#loginForm button[type=submit]')


async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={'width': 1280, 'height': 900})
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        await page.route('**/fonts.g*/**', lambda r: r.abort())
        ev = page.evaluate
        await page.goto(URL)
        await ev('localStorage.clear(); sessionStorage.clear()'); await page.reload()

        print('PIN 팝업')
        await page.wait_for_selector('#loginForm')
        txt = await page.inner_text('#loginForm')
        check(await page.locator('[data-act=loginrole]').count() == 0 and '소장' not in txt and '자동 구분' not in txt, '사람 고르기 없이 PIN 칸만 (안내 문장 없음)')
        await page.screenshot(path=OUT / 'v17_login.png')
        await login(page, '0000')
        await page.wait_for_function("/PIN이 맞지 않습니다/.test(document.querySelector('#loginErr').textContent)")
        check(True, '틀린 PIN 안내')
        await login(page, '5678')
        await page.wait_for_selector('[data-act=new]')
        check('부소장 접속 중' in await page.inner_text('.whoami') and await page.locator('[data-act=switchrole]').count() == 0, '부소장 PIN → 부소장 접속 중 (전환 버튼 없음)')

        print('9번 소장 확인 — 부소장')
        await page.click('[data-act=new]'); await page.wait_for_selector('#notes')
        await page.fill('#f-tenant', '소장확인 매장'); await page.fill('#f-location', '2')
        nav = await page.inner_text('#nav')
        check('0 / 9' in nav and nav.index('담당 확인') < nav.index('소장 확인'), '작성 진행 n / 9, 8번 아래 9 소장 확인')
        check(await page.locator('#s9 #chiefOk').is_disabled(), '부소장은 체크 못 함')
        check(await page.inner_text('#s9 .sh') == '9\n소장 확인' or (await page.locator('#s9 .sh p').count()) == 0, '9번 칸에 안내 문장 없음')
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('.savestate').textContent)")
        await page.click('[data-act=dash]'); await page.wait_for_selector('[data-act=new]')
        await page.click('[data-act=logout]')

        print('기기 기억')
        await login(page, '1234')
        await page.wait_for_selector('[data-act=new]')
        check('소장 접속 중' in await page.inner_text('.whoami'), '소장 PIN → 소장 접속 중')
        saved = await ev("JSON.parse(localStorage.getItem('dr_auth'))")
        check(saved.get('token') and 'pin' not in saved, '기기에 PIN 대신 표(token)만 기억')
        await page.reload()
        await page.wait_for_selector('[data-act=new]')
        check(await page.locator('#pin').count() == 0, '다시 열면 PIN 없이 바로 대시보드')

        print('대시보드 소장 확인 표시')
        row = page.locator('.tbl tbody tr').filter(has_text='소장확인 매장')
        chief = row.locator('.cf.chief')
        check(await chief.count() == 1 and 'on' not in await chief.get_attribute('class'), '미확인: 회색')
        hb = await ev("""(() => { const r = [...document.querySelectorAll('.tbl tbody tr')].find(t => t.innerText.includes('소장확인 매장'));
          const a = r.querySelector('.steps').getBoundingClientRect(), c = r.querySelector('.cf[data-act=confirm]').getBoundingClientRect(), d = r.querySelector('.cf.chief').getBoundingClientRect();
          return [Math.round(a.top + a.height / 2), Math.round(c.top + c.height / 2), Math.round(d.top + d.height / 2), Math.round(c.width), Math.round(d.width), Math.round(c.height), Math.round(d.height), a.right <= c.left]; })()""")
        check(abs(hb[0] - hb[1]) <= 2 and abs(hb[1] - hb[2]) <= 2 and hb[7], f'차수 오른쪽 같은 줄에 컨펌완료·소장 확인 {hb}')
        check(hb[3] == hb[4] and hb[5] == hb[6], '두 버튼 같은 크기')
        check(await ev("document.documentElement.scrollWidth <= innerWidth"), '표가 화면 밖으로 안 넘침')

        print('9번 소장 확인 — 소장')
        await row.locator('[data-act=open]').first.click(); await page.wait_for_selector('#notes')
        check(not await page.locator('#chiefOk').is_disabled(), '소장은 체크 가능')
        await page.click('#s9 .chiefbox')
        await page.wait_for_function("window.__DR.review.chiefOk === true && document.querySelector('#chiefOk').checked")
        check('1 / 9' in await page.inner_text('#nav'), '작성 진행에 반영')
        await page.locator('#s9').scroll_into_view_if_needed()
        await page.screenshot(path=OUT / 'v17_chief.png')
        await page.click('[data-act=dash]'); await page.wait_for_selector('[data-act=new]')
        row = page.locator('.tbl tbody tr').filter(has_text='소장확인 매장')
        check('on' in await row.locator('.cf.chief').get_attribute('class'), '대시보드: 소장 확인 녹색')
        await row.locator('[data-act=confirm]').click(); await page.click('.dialog .main-act'); await page.wait_for_timeout(400)
        await row.locator('[data-act=open]').first.click(); await page.wait_for_selector('#notes')
        check(await page.locator('.lockbar').count() == 1 and not await page.locator('#chiefOk').is_disabled(), '컨펌완료로 잠겨도 소장 확인은 누를 수 있음')
        await page.click('#s9 .chiefbox')
        await page.wait_for_function("window.__DR.review.chiefOk === false")
        await page.click('#s9 .chiefbox')
        await page.wait_for_function("window.__DR.review.chiefOk === true")
        check(True, '잠긴 검토서에서 취소·다시 확인')
        await page.click('[data-act=dash]'); await page.wait_for_selector('[data-act=new]')
        await page.screenshot(path=OUT / 'v17_dash.png')

        print('기준 연도')
        call = "(n, ...a) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(no)[n](...a))"
        await ev("async () => { const call = " + call + "; await call('apiSaveReview', {pin:'1234', role:'소장'}, {tenant:'내년 매장', reviewDate:'" + str(Y + 1) + "-01-05'}, false); }")
        await page.click('[data-act=refresh]'); await page.wait_for_timeout(500)
        chips = await page.locator('.ychip').all_inner_texts()
        check(f'{Y}년' in chips and f'{Y + 1}년' in chips, '연도 버튼: ' + ', '.join(chips))
        body = await page.inner_text('#dashBody')
        check('내년 매장' not in body, '처음엔 올해만 → 내년 매장 숨김')
        n1 = int((await page.inner_text('.kpi .n >> nth=0')).strip())
        await page.click(f'.ychip[data-y="{Y + 1}"]')
        n2 = int((await page.inner_text('.kpi .n >> nth=0')).strip())
        check(n2 == n1 + 1 and '내년 매장' in await page.inner_text('#dashBody'), f'두 해 고르면 합쳐서 ({n1} → {n2})')
        await page.click(f'.ychip[data-y="{Y}"]')
        n3 = int((await page.inner_text('.kpi .n >> nth=0')).strip())
        check(n3 == 1 and '소장확인 매장' not in await page.inner_text('#dashBody'), '내년만 고르면 내년 숫자·목록만')
        await page.click(f'.ychip[data-y="{Y + 1}"]')
        check(await page.locator(f'.ychip.on[data-y="{Y + 1}"]').count() == 1, '마지막 하나는 해제 안 됨')
        await page.reload(); await page.wait_for_selector('.ychip')
        check(await page.locator('.ychip.on').count() == 1 and await page.locator(f'.ychip.on[data-y="{Y + 1}"]').count() == 1, '고른 연도는 기기에 기억')
        await page.click(f'.ychip[data-y="{Y}"]')

        print('메일 서명')
        row = page.locator('.tbl tbody tr').filter(has_text='소장확인 매장')
        await row.locator('[data-act=confirm]').click(); await page.click('.dialog .main-act'); await page.wait_for_timeout(300)
        await row.locator('[data-act=open]').first.click(); await page.wait_for_selector('#notes')
        await page.fill('#f-contractorEmail', 'kim@daehan.co.kr')
        await page.click('[data-act=specOpen]'); await page.wait_for_selector('[data-spk=tenant]')
        await page.click('label.sfile:has([data-spk=tenant])')
        sig = await page.inner_text('.mailpv .msig')
        check(sig.splitlines() == ['에비뉴엘 시설팀', 'T. 02-3213-2456 / 02-3213-2119 / 02-3213-2122', 'E. max2122@nate.com', 'W. http://www.maxerve.co.kr/'], '발송 창 미리보기 맨 아래 서명 4줄')
        await page.click('#specGo')
        await page.wait_for_function('(window.__mockMails || []).length === 1')
        body = await ev('window.__mockMails[0].body')
        check(body.rstrip().endswith('W. http://www.maxerve.co.kr/'), '보낸 메일 끝에 서명')
        await page.click('[data-act=dash]'); await page.wait_for_selector('[data-act=new]')

        print('PIN을 바꾸면 다시 PIN')
        await page.add_init_script('window.__mockPinVer = "2"')
        await page.reload()
        await page.wait_for_selector('#loginForm')
        check('PIN이 바뀌었습니다' in await page.inner_text('#loginErr'), '기억된 기기도 새 PIN 입력 안내')
        await login(page, '1234'); await page.wait_for_selector('[data-act=new]')
        check(True, '새로 로그인')

        print('휴대폰 크기')
        await page.set_viewport_size({'width': 375, 'height': 800})
        await page.reload(); await page.wait_for_selector('[data-act=new]')
        sw = await ev('document.documentElement.scrollWidth')
        check(sw <= 375, f'대시보드 넘침 없음 ({sw})')
        await page.screenshot(path=OUT / 'v17_dash_phone.png', full_page=True)
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
