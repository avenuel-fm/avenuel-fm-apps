"""1.5 브라우저 점검: 검토서 삭제 · 출력물 양식(1쪽 서명란까지, 2쪽 특이사항) · 입력 화면 순서 · 1쪽 맞춤"""
import asyncio, pathlib, subprocess, sys, time, json
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'shots'
PORT = 8791
URL = f'http://127.0.0.1:{PORT}/preview.html'
STRESS = "*{font-family:'DejaVu Sans',sans-serif !important;letter-spacing:.03em} .page .f td,.page .prules{font-size:13.5px !important}"


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


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

        print('입력 화면 순서')
        await page.click('[data-act=new]')
        await page.wait_for_selector('#notes')
        order = await ev("[...document.querySelectorAll('section.sec')].map(s => s.id)")
        check(order == ['s1', 's2', 's3', 's4', 's5', 's6', 'sR', 's7', 's9'], '순서: … 제출서류 → 특이사항 → 준수사항 확인 → 서명 → 소장 확인 ' + str(order))
        nav = await page.inner_text('#nav')
        check('준수사항 확인' in nav and nav.index('특이사항') < nav.index('준수사항 확인') < nav.index('담당 확인'), '왼쪽 진행 목록도 같은 순서 (9칸)')
        check('준수사항' not in await page.inner_text('#s5 h2') and await page.locator('#sR [data-field=rulesAck]').count() == 1, '제출서류 칸에서 준수사항이 빠지고, 확인 체크는 7번 칸에')
        await page.fill('#f-tenant', '양식 시험')
        await page.fill('#f-contractorName', '김시공')
        await page.fill('#notes', '2쪽에 들어가야 할 특이사항입니다.\n두 번째 줄')
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('#savestate').textContent)")
        doc1 = await ev('window.__DR.store.docNo')

        print('출력물 양식')
        await page.evaluate("document.querySelector('[data-act=print]').click()")
        await page.wait_for_selector('.page')
        await page.wait_for_timeout(300)
        p1 = await page.locator('.page >> nth=0').inner_text()
        p2 = await page.locator('.page >> nth=1').inner_text()
        check('시설항목' in p1 and '특이사항입니다' not in p1, '1쪽: "시설항목" 칸, 특이사항 내용 없음')
        order1 = await ev("""(() => { const tds = [...document.querySelector('.page').querySelectorAll('td.h')].map(t => t.textContent.trim());
          return [tds.indexOf('시설항목'), tds.indexOf('준수사항'), tds.indexOf('담 당')]; })()""")
        check(order1[0] < order1[1] < order1[2] and order1[0] >= 0, '1쪽 순서: 시설항목 → 준수사항 → 서명란')
        check('특이사항은 2쪽' in p1, '1쪽 서명란 아래 "특이사항은 2쪽" 안내')
        check('공사 도면 검토서 — 특이사항' in p2 and '2쪽에 들어가야 할 특이사항입니다.' in p2 and '(계속)' not in p2, '2쪽: 특이사항 양식에 특이사항 내용')
        sigh = await ev("[...document.querySelectorAll('.page td.psig')].map(td => Math.round(td.getBoundingClientRect().height / (document.querySelector('.page').getBoundingClientRect().width / 794)))")
        check(all(33 <= h <= 37 for h in sigh), f'서명 칸 높이 그대로 {sigh}')
        await page.evaluate("var t=document.getElementById('toast'); if (t) t.remove()")
        await page.locator('.page >> nth=0').screenshot(path=OUT / 'v15_p1.png')
        await page.locator('.page >> nth=1').screenshot(path=OUT / 'v15_p2.png')
        await page.click('[data-act=backEdit]')
        await page.wait_for_selector('#notes')
        await page.fill('#notes', '\n'.join(['긴 특이사항 %d번째 줄입니다. 3쪽으로 넘어가는지 봅니다.' % i for i in range(70)]))
        await page.wait_for_timeout(900)
        brk = await page.locator('.nbrk').all_inner_texts()
        check(brk and brk[0].strip() == '여기부터 3쪽', '편집칸 경계선: "여기부터 3쪽" ' + str(brk))
        await page.evaluate("document.querySelector('[data-act=print]').click()")
        await page.wait_for_selector('.page >> nth=2')
        p3 = await page.locator('.page >> nth=2').inner_text()
        check('특이사항 (계속)' in p3 and '(2쪽에서 계속)' in p3, '넘치면 3쪽 "특이사항 (계속)"')
        await page.click('[data-act=backEdit]')
        await page.wait_for_selector('#notes')

        print('검토서 삭제')
        # 검토서 화면의 삭제 → 취소
        await page.click('[data-act=delStore]')
        await page.wait_for_selector('#delOk')
        await page.click('.dialog .main-act')
        check(not await page.locator('#delErr').is_hidden(), '확인 체크 없이 삭제 누르면 막힘')
        await page.click('.dialog [data-dv="0"]')
        sid = await ev('window.__DR.store.id')
        # 대시보드에서 컨펌완료 매장 삭제 시도
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('#savestate').textContent)")
        await page.click('[data-act=dash]')
        await page.wait_for_selector('[data-act=confirm]')
        await page.evaluate(f"document.querySelector('[data-act=confirm][data-id=\"{sid}\"]').click()")
        await page.click('.dialog .main-act')
        await page.wait_for_timeout(300)
        await page.evaluate(f"document.querySelector('[data-act=delStore][data-id=\"{sid}\"]').click()")
        await page.wait_for_selector('.dialog')
        dtext = await page.inner_text('.dialog')
        print('    팝업:', dtext.replace('\n', ' ')[:80])
        check('컨펌완료' in dtext and '먼저 취소' in dtext and await page.locator('#delOk').count() == 0, '컨펌완료 매장은 삭제 대신 "먼저 취소" 안내')
        await page.click('.dialog .main-act')
        await page.evaluate(f"document.querySelector('[data-act=confirm][data-id=\"{sid}\"]').click()")
        await page.click('.dialog .main-act')
        await page.wait_for_timeout(300)
        await page.evaluate(f"document.querySelector('[data-act=delStore][data-id=\"{sid}\"]').click()")
        await page.wait_for_selector('#delOk')
        dtext = await page.inner_text('.dialog')
        check(doc1 in dtext and '삭제보관' in dtext and '휴지통' in dtext and '다시 쓰지 않습니다' in dtext, '삭제 확인 팝업: 매장·문서번호·차수·보관·휴지통·번호 안내')
        await page.screenshot(path=OUT / 'v15_delete.png')
        await page.check('#delOk')
        await page.click('.dialog .main-act')
        await page.wait_for_function(f"!document.querySelector('[data-id=\"{sid}\"]')", timeout=10000)
        check(not await ev(f"JSON.parse(localStorage.getItem('dr_mockdb')).stores.some(s => s.id === '{sid}')"), '삭제하면 대시보드·시트에서 사라짐')
        await page.click('[data-act=new]')
        await page.wait_for_selector('#notes')
        await page.fill('#f-tenant', '다음 매장')
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('#savestate').textContent)")
        doc2 = await ev('window.__DR.store.docNo')
        check(int(doc2.split('_')[1]) == int(doc1.split('_')[1]) + 1, f'지운 번호를 다시 쓰지 않고 이어감 ({doc1} 삭제 → {doc2})')

        print('1쪽 맞춤 (넓은 글꼴·큰 글자 기기)')
        tp = await b.new_page(viewport={'width': 800, 'height': 1280})
        await tp.route('**/fonts.g*/**', lambda r: r.abort())
        await tp.goto(URL)
        await tp.add_style_tag(content=STRESS)
        await tp.fill('#pin', '1234'); await tp.click('button[type=submit]')
        await tp.wait_for_selector('[data-act=new]')
        await tp.click('[data-act=new]')
        await tp.wait_for_selector('#notes')
        await tp.fill('#f-tenant', '아주 긴 테넌트 이름 프리미엄 라이프스타일 편집숍 팝업')
        await tp.evaluate("document.querySelector('[data-act=print]').click()")
        await tp.wait_for_selector('.page')
        await tp.wait_for_timeout(400)
        r = await tp.evaluate("""(() => { const pg = document.querySelector('.page'); const rows = [...pg.querySelectorAll('td.psig')]; const last = rows[rows.length-1].getBoundingClientRect();
          const foot = pg.querySelector('.pfoot').getBoundingClientRect(); const pr = pg.getBoundingClientRect();
          return {fit: pg.getAttribute('data-fit'), ok: last.bottom <= foot.top && last.bottom <= pr.bottom}; })()""")
        check(r['fit'] and r['ok'], f"글자가 커져 넘치면 1쪽을 {r['fit']}배로 줄여 서명란까지 한 쪽에")
        await tp.evaluate("var t=document.getElementById('toast'); if (t) t.remove()")
        await tp.screenshot(path=OUT / 'v15_tablet_fit.png', full_page=True)
        await b.close()
    print('ERRORS:', errors if errors else 'none')
    if errors:
        raise SystemExit(1)


srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    asyncio.run(main())
finally:
    srv.terminate()
