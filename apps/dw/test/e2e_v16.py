"""1.6 브라우저 점검: 소방 점검 예정일 · 자동 제안 · 출력물 줄 · 달력 탭 · 해당없음 가운데 · 연락처 자동완성 끄기 · 시방서 발송"""
import asyncio, pathlib, subprocess, sys, time, datetime
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'shots'
OUT.mkdir(exist_ok=True)
PORT = 8792
URL = f'http://127.0.0.1:{PORT}/preview.html'


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


def d(n):
    return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()


async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        await page.route('**/fonts.g*/**', lambda r: r.abort())
        ev = page.evaluate
        await page.goto(URL)
        await ev('localStorage.clear(); sessionStorage.clear()'); await page.reload()
        await page.fill('#pin', '1234'); await page.click('button[type=submit]')
        await page.wait_for_selector('[data-act=new]')

        print('소방 점검 예정일')
        await page.click('[data-act=new]'); await page.wait_for_selector('#notes')
        check(await page.locator('#f-fireCheckDate').count() == 1, '공사 기간 아래 소방 점검 예정일 칸')
        check('합동점검' not in await page.inner_text('#s1'), '회색 "소방 합동점검 예정일" 문구 없음')
        check(await page.locator('#fireSug button').count() == 0, '공사 종료일이 없으면 제안 없음')
        await page.fill('#f-tenant', '샤넬 뷰티')
        await page.fill('#f-openDate', d(5))
        await page.fill('#f-periodEnd', d(3))
        check(await page.locator('#fireSug button').count() == 1 and d(3) in await page.inner_text('#fireSug'), '공사 종료일 제안 표시 (1.8.2) ' + d(3))
        check(await page.input_value('#f-fireCheckDate') == '', '제안은 저절로 채우지 않음')
        await page.click('#fireSug button')
        check(await page.input_value('#f-fireCheckDate') == d(3) and await page.locator('#fireSug button').count() == 0, '누르면 칸에 들어가고 제안은 사라짐')
        await page.fill('#f-periodStart', d(-5)); await page.fill('#f-periodEnd', d(2))
        check('공사기간' in await page.inner_text('#inspect') and '소방 점검 예정일' in await page.inner_text('#inspect'), '공사 기간 밖이면 경고')
        await page.fill('#f-periodEnd', d(4))
        check(await page.inner_text('#inspect') == '', '기간 안이면 경고 없음')
        await page.fill('#f-fireCheckDate', d(6))
        check('오픈 예정일' in await page.inner_text('#inspect'), '오픈일보다 늦으면 경고')
        await page.fill('#f-fireCheckDate', d(3))

        print('해당없음 가운데 · 연락처 자동완성')
        await page.click('[data-choice=kitchen][data-value=없음]')
        ta = await ev("getComputedStyle(document.querySelector('#f-exhaustCmh')).textAlign")
        tb = await ev("getComputedStyle(document.querySelector('.seg.na button')).justifyContent")
        check(ta == 'center' and tb == 'center', f'해당없음 칸 가운데 (입력칸 {ta}, 버튼 {tb})')
        ac = await ev("['safetyTel','salesTel','respTel'].map(k => document.querySelector('#f-' + k).getAttribute('autocomplete'))")
        check(ac == ['off', 'off', 'off'], '서명란 연락처 자동완성 끔')
        await page.fill('#f-contractorCompany', '대한인테리어'); await page.fill('#f-contractorTel', '01012345678')
        check(await page.input_value('#f-respTel') == '010-1234-5678', '시공업체 연락처 → 서명란 자동 옮김은 유지')
        await page.fill('#f-contractorName', '김시공')
        await page.fill('#f-location', 'B1F')

        print('시방서 발송 — 저장 전, 이메일 없음')
        check(await page.locator('[data-act=specOpen]').count() == 1, '아래 막대에 ✉ 시방서 발송')
        check('아직 보낸 메일이 없습니다' in await page.inner_text('#specRec'), '기본 정보 아래 발송 기록: 없음 안내')
        await page.click('[data-act=specOpen]')
        await page.wait_for_selector('[data-spk=tenant]')
        check(await page.locator('#specGo').is_disabled(), '체크 전 발송하기 꺼짐')
        await page.click('label.sfile:has([data-spk=tenant])')
        check('비어 있습니다' in await page.inner_text('.dialog') and await page.locator('#specGo').is_disabled(), '이메일 없으면 안내 + 꺼짐')
        await page.click('#specJump')
        await page.wait_for_timeout(500)
        check(await ev("document.activeElement && document.activeElement.id") == 'f-contractorEmail', '입력하러 가기 → 이메일 칸')
        await page.fill('#f-contractorEmail', 'kim@daehan.co.kr')

        print('시방서 발송 — 미리보기 · 발송')
        await page.click('[data-act=specOpen]'); await page.wait_for_selector('[data-spk=tenant]')
        check('01_Tenant 시방서.zip' in await page.inner_text('.dialog') and '02_B1F The Crown 시방서.zip' in await page.inner_text('.dialog'), 'ZIP 파일 이름 표시')
        await page.click('label.sfile:has([data-spk=crown])')
        await page.click('label.sfile:has([data-spk=tenant])')
        txt = await page.inner_text('.dialog')
        check('max2122@nate.com' in txt and 'kim@daehan.co.kr' in txt and '[잠실점 에비뉴엘] 샤넬 뷰티 시방서 송부' in txt, '메일 미리보기: 보낸·받는 사람·제목')
        check(txt.index('Tenant 시방서 :') < txt.index('The Crown 시방서 :'), '본문에 두 시방서 링크 (Tenant 먼저)')
        await page.fill('#specExtra', '착공 전 검토 부탁드립니다.')
        await page.screenshot(path=OUT / 'v16_send.png')
        await page.click('#specGo')
        await page.wait_for_function("document.querySelector('#specRec .sendlog')", timeout=10000)
        mails = await ev('window.__mockMails')
        check(len(mails) == 1 and mails[0]['to'] == 'kim@daehan.co.kr' and mails[0]['from'] == 'max2122@nate.com', '저장 후 발송: 시공업체에게 nate 주소로')
        check('착공 전 검토 부탁드립니다.' in mails[0]['body'] and 'drive.google.com' in mails[0]['body'], '본문: 링크 + 덧붙일 말')
        rec = await page.inner_text('#specRec')
        check('Tenant 시방서' in rec and 'The Crown 시방서' in rec and 'kim@daehan.co.kr' in rec, '발송 기록: 시방서별 날짜·시간·주소')
        check(await ev('window.__DR.store && !!window.__DR.store.docNo'), '처음 보낼 때 검토서 자동 저장')
        await page.locator('#s1').screenshot(path=OUT / 'v16_record.png')

        print('다시 보내기 · 파일 없음 · 끊김')
        await page.click('[data-act=specOpen]'); await page.wait_for_selector('[data-spk=tenant]')
        check('보냄' in await page.inner_text('label.sfile:has([data-spk=tenant])'), '이미 보낸 시방서 표시')
        await page.click('label.sfile:has([data-spk=tenant])')
        await page.click('#specGo')
        await page.wait_for_selector('.dialog >> text=다시 보낼까요?')
        await page.click('.dialog [data-dv="0"]')
        await page.wait_for_selector('#specGo')
        check(len(await ev('window.__mockMails')) == 1, '다시 보내기 취소 → 안 보냄, 발송 창으로 돌아감')
        await page.click('#specGo'); await page.click('.dialog .main-act')
        await page.wait_for_function('window.__mockMails.length === 2')
        check(True, '다시 보내기 확인 → 발송')
        await ev('window.__mockSpecMissing = ["crown"]')
        await page.click('[data-act=specOpen]'); await page.wait_for_selector('[data-spk=crown]')
        check(await page.locator('[data-spk=crown]').is_disabled() and 'ZIP 파일이 없습니다' in await page.inner_text('.dialog'), '파일 없으면 흐리게 + 안내')
        await page.locator('.dialog').screenshot(path=OUT / 'v16_state.png')
        await page.click('#specCancel')
        await ev('window.__mockSpecMissing = []; window.__mockOffline = true')
        await page.click('[data-act=specOpen]')
        await page.wait_for_selector('.dialog >> text=보내지 못했습니다')
        check('저절로 보내지지 않습니다' in await page.inner_text('.dialog'), '끊기면 안내만, 나중에 보내지 않음')
        await page.click('.dialog .main-act')
        await ev('window.__mockOffline = false')

        print('출력물 줄')
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('.savestate').textContent)")
        await page.evaluate("document.querySelector('[data-act=print]').click()")
        await page.wait_for_selector('.page'); await page.wait_for_timeout(300)
        row = await ev("[...document.querySelectorAll('.page tr')].map(t => t.innerText.replace(/\\s+/g,' ')).filter(t => t.indexOf('공사 기간') === 0)[0]")
        check(row and '소방 점검' in row and '오픈 예정일' in row and row.index('소방 점검') < row.index('오픈 예정일'), '공사 기간 | 소방 점검 예정일 | 오픈 예정일: ' + row)
        r1 = await ev("[...document.querySelectorAll('.page tr')].map(t => t.innerText).filter(t => t.indexOf('검토 차수') === 0)[0]")
        check('오픈' not in r1, '검토 차수 줄에서 오픈 예정일 빠짐')
        await page.click('[data-act=backEdit]'); await page.wait_for_selector('#notes')

        print('대시보드 · 달력')
        await page.click('[data-act=dash]'); await page.wait_for_selector('[data-act=new]')
        call = "(n, ...a) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(no)[n](...a))"
        await ev("""async () => { const call = """ + call + """; const A = {role:'소장',pin:'1234'};
          await call('apiSaveReview', A, {tenant:'디올 VP', storeType:'VP', periodStart:'""" + d(1) + """', periodEnd:'""" + d(9) + """', fireCheckDate:'""" + d(8) + """', openDate:'""" + d(10) + """'}, false); }""")
        await page.click('[data-act=refresh]'); await page.wait_for_timeout(500)
        body = await page.inner_text('#dashBody')
        check('시방서 ✓' in body and '시방서 미발송' in body, '매장 목록: 시방서 ✓ / 미발송')
        check('합동점검 D-3' in body, '합동점검 D-n: 입력한 소방 점검일 기준')
        await page.click('[data-act=tab][data-tab=cal]')
        await page.wait_for_selector('.cal')
        now_title = await page.inner_text('.calnav h3')
        await ev("window.__DR.dash.cal = '" + d(3)[:7] + "'; document.querySelector('[data-act=tab][data-tab=cal]').click()")
        await page.wait_for_timeout(100)
        cal = await page.inner_text('.cal')
        check('샤넬 뷰티' in cal and '디올 VP' in cal and '소방점검' in cal and '오픈' in cal, '달력: 공사 기간 막대·소방 점검·오픈')
        title = await page.inner_text('.calnav h3')
        await page.screenshot(path=OUT / 'v16_calendar.png', full_page=True)
        await page.click('.calnav [aria-label="다음 달"]')
        check(await page.inner_text('.calnav h3') != title, '다음 달로 이동')
        await page.click('.calnav >> text=오늘')
        check(await page.inner_text('.calnav h3') == now_title, '오늘로 돌아옴')
        await ev("window.__DR.dash.cal = '" + d(3)[:7] + "'; document.querySelector('[data-act=tab][data-tab=cal]').click()")
        await page.wait_for_timeout(100)
        await page.click('.cev.fire >> nth=0')
        await page.wait_for_selector('#notes')
        check(True, '달력 표시를 누르면 검토서 열림')

        print('휴대폰 달력')
        await page.click('[data-act=dash]'); await page.wait_for_selector('[data-act=new]')
        await page.set_viewport_size({'width': 375, 'height': 800})
        await page.click('[data-act=tab][data-tab=cal]'); await page.wait_for_selector('.calagenda')
        await ev("window.__DR.dash.cal = '" + d(3)[:7] + "'; document.querySelector('[data-act=tab][data-tab=cal]').click()")
        await page.wait_for_timeout(100)
        check(await page.locator('.calagenda').is_visible() and await page.locator('.agi').count() >= 4, '좁은 화면: 이번 달 일정 목록')
        sw = await ev('document.documentElement.scrollWidth')
        check(sw <= 375, f'가로 넘침 없음 ({sw})')
        await page.screenshot(path=OUT / 'v16_calendar_phone.png', full_page=True)
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
