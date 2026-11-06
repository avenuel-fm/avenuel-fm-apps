"""1.4 브라우저 점검: 점명 · 첫 로딩(서버 호출 1번, 출력 도구 나중) · 팝업/VP 해당없음 · 특이사항 사진"""
import asyncio, pathlib, subprocess, sys, time, json
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'shots'
PORT = 8790
URL = f'http://127.0.0.1:{PORT}/preview.html'
IMG = ROOT / 'shots' / 'test_photo.jpg'
im = Image.new('RGB', (900, 600), (70, 130, 180)); d = ImageDraw.Draw(im); d.rectangle([0, 0, 450, 300], fill=(240, 180, 60)); im.save(IMG)
IMG2 = ROOT / 'shots' / 'test_photo2.png'
Image.new('RGB', (400, 700), (60, 160, 90)).save(IMG2)


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
        ev = page.evaluate

        print('점명 · 첫 로딩')
        await page.goto(URL)
        await ev('localStorage.clear(); sessionStorage.clear()'); await page.reload()
        check('잠실점 에비뉴엘' in await page.inner_text('body') and await page.title() == '잠실점 에비뉴엘 도면협의', '점명: 잠실점 에비뉴엘')
        check(not await ev('!!window.html2pdf || !!window.qrcode'), '첫 화면에서 PDF·QR 도구를 받지 않음')
        await ev('window.__mockCalls = []')
        await page.fill('#pin', '1234'); await page.click('button[type=submit]')
        await page.wait_for_selector('[data-act=new]')
        await page.wait_for_timeout(300)
        calls = await ev('window.__mockCalls.slice()')
        check(calls[:1] == ['apiStart'] and 'apiBootstrap' not in calls and 'apiListStores' not in calls, '로그인 후 첫 화면까지 서버 호출 1번: ' + ','.join(calls))
        await page.wait_for_function('!!window.html2pdf && !!window.qrcode', timeout=10000)
        check(True, '첫 화면이 뜬 뒤 출력 도구를 미리 받아 둠')

        print('팝업 · VP')
        await page.click('[data-act=new]')
        await page.wait_for_selector('#notes')
        await page.fill('#f-tenant', '사진 시험 매장')
        await page.fill('#f-supplyPipeA', '25'); await page.click('[data-choice=sprReplace][data-value=교체]')
        await page.click('[data-choice=kitchen][data-value="있음"]')
        await page.click('[data-choice=storeType][data-value=팝업]')
        keys = ['kitchen', 'waterproof', 'waterTest', 'supplyPipeA', 'drainPipeA', 'kitchenExt', 'exhaustCmh', 'gasGrade', 'gasAlarm', 'sprReplace', 'detReplace', 'diffReplace']
        vals = await ev(f"{json.dumps(keys)}.map(k => window.__DR.review[k])")
        check(all(v == '해당없음' for v in vals), '팝업 선택 → 12개 항목 해당없음')
        dis = await ev("['#f-supplyPipeA','#f-exhaustCmh','#f-gasGrade'].every(s => !document.querySelector(s) || document.querySelector(s).disabled) && document.querySelectorAll('[data-group=kitchen].na, [data-group=gasAlarm].na').length === 2 && document.querySelectorAll('[data-group=sprReplace].na, [data-group=diffReplace].na').length === 2")
        check(dis, '주방·급배수·가스 입력 막힘, 설비 수량은 해당없음 표시')
        txt = await page.inner_text('#s3') + await page.inner_text('#s4')
        check('팝업 매장 · 주방' in txt and '설비 교체 항목은 해당없음' in txt, '안내 문구 표시')
        await page.click('[data-choice=storeType][data-value=VP]')
        check(await ev("window.__DR.review.diffReplace") == '해당없음', 'VP도 같음')
        await page.click('[data-choice=storeType][data-value=본매장]')
        vals = await ev(f"{json.dumps(keys)}.map(k => window.__DR.review[k])")
        check(all(v == '' for v in vals) and not await ev("document.querySelector('#f-supplyPipeA').disabled"), '본매장으로 바꾸면 다시 입력 가능 (해당없음 지움)')
        await page.click('[data-choice=storeType][data-value=팝업]')

        print('특이사항 사진')
        await page.click('#notes')
        await page.keyboard.type('첫 줄입니다.\n둘째 줄 끝에 사진이 붙어야 합니다')
        await page.set_input_files('#phFile', str(IMG))
        await page.wait_for_function("window.__DR.review.notesPhotos && JSON.parse(window.__DR.review.notesPhotos).length === 1", timeout=10000)
        ph = json.loads(await ev('window.__DR.review.notesPhotos'))[0]
        notes = await ev('window.__DR.review.notes')
        check(ph['a'] == len(notes.rstrip()) and ph['f'], f"사진이 마지막 문장 끝(글자 {ph['a']})에 붙음 · 드라이브에 저장됨")
        check(await ev('!!window.__DR.store'), '사진을 붙이려고 먼저 검토서를 자동 저장 (문서번호 생김)')
        # 문장 앞에 글을 넣으면 사진도 따라감
        await ev("(() => { const t = document.querySelector('#notes'); t.focus(); t.setSelectionRange(0, 0); })()")
        await page.keyboard.type('맨 앞에 넣은 글 ')
        ph2 = json.loads(await ev('window.__DR.review.notesPhotos'))[0]
        check(ph2['a'] == ph['a'] + len('맨 앞에 넣은 글 '), '앞에 글을 넣으면 사진이 붙은 위치도 같이 밀림')
        # 끌어서 옮기기
        el = page.locator('.nph').first
        bx = await el.bounding_box()
        await page.mouse.move(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2)
        await page.mouse.down(); await page.mouse.move(bx['x'] + bx['width'] / 2 - 120, bx['y'] + bx['height'] / 2 + 60, steps=6); await page.mouse.up()
        ph3 = json.loads(await ev('window.__DR.review.notesPhotos'))[0]
        s = await ev("parseFloat(document.querySelector('#npaper').style.transform.slice(6))")
        check(abs((ph3['x'] - ph2['x']) * s + 120) < 6 and abs((ph3['y'] - ph2['y']) * s - 60) < 6, f"마우스로 끌어 옮김 (x {ph2['x']}→{ph3['x']}, y {ph2['y']}→{ph3['y']})")
        # 크기 조절
        await page.wait_for_selector('.nph.picked .nph-rs')
        rs = await page.locator('.nph-rs').bounding_box()
        await page.mouse.move(rs['x'] + rs['width'] / 2, rs['y'] + rs['height'] / 2)
        await page.mouse.down(); await page.mouse.move(rs['x'] - 100, rs['y'] - 40, steps=6); await page.mouse.up()
        ph4 = json.loads(await ev('window.__DR.review.notesPhotos'))[0]
        check(ph4['w'] < ph3['w'] - 50 and abs(ph4['h'] / ph4['w'] - ph3['h'] / ph3['w']) < 0.02, f"모서리로 줄임 (폭 {ph3['w']}→{ph4['w']}, 비율 유지)")
        # 회전
        await page.click('.nph.picked [data-ph-h=rr]')
        ph5 = json.loads(await ev('window.__DR.review.notesPhotos'))[0]
        await page.click('.nph.picked [data-ph-h=rr]')
        await page.click('.nph.picked [data-ph-h=rl]')
        ph6 = json.loads(await ev('window.__DR.review.notesPhotos'))[0]
        bxr = await page.locator('.nph').first.bounding_box()
        check(ph5['r'] == 90 and ph6['r'] == 90 and bxr['height'] > bxr['width'], '아래 가운데 ↻ ↺ 버튼으로 90도씩 돌리기 (가로 사진이 세로로)')
        await page.screenshot(path=OUT / 'v14_photo_edit.png')
        # 두 번째 사진 · 붙여넣기
        await ev("""(async () => {
          const blob = await (await fetch('shots/test_photo2.png')).blob();
          const dt = new DataTransfer(); dt.items.add(new File([blob], 'cap.png', {type: 'image/png'}));
          const e = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
          document.querySelector('#notes').dispatchEvent(e);
        })()""")
        await page.wait_for_function("JSON.parse(window.__DR.review.notesPhotos).length === 2", timeout=10000)
        check(True, 'Ctrl+V 붙여넣기로 사진 추가')
        # 삭제
        await page.click('.nph >> nth=1')
        await page.click('.nph.picked [data-ph-h=del]')
        check(len(json.loads(await ev('window.__DR.review.notesPhotos'))) == 1, '✕ 로 사진 빼기')
        # 10장 제한
        await ev("""(() => { const l = JSON.parse(window.__DR.review.notesPhotos); const f = l[0].f;
          for (let i = 0; i < 9; i++) l.push(Object.assign({}, l[0], {id: 'x' + i, x: 10 * i})); window.__DR.review.notesPhotos = JSON.stringify(l); })()""")
        await page.click('[data-act=photo]')
        await page.wait_for_timeout(200)
        check(await page.locator('.phomenu').count() == 0, '10장이면 더 붙일 수 없음')
        await ev("(() => { const l = JSON.parse(window.__DR.review.notesPhotos); window.__DR.review.notesPhotos = JSON.stringify(l.slice(0, 1)); })()")
        # 저장 · 출력
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('#savestate').textContent)")
        saved = await ev("JSON.parse(localStorage.getItem('dr_mockdb')).reviews.find(r => r.tenant === '사진 시험 매장')")
        check(json.loads(saved['notesPhotos'])[0]['r'] == 90 and saved['kitchen'] == '해당없음', '사진 위치·크기·회전, 해당없음 항목이 시트에 저장')
        await page.evaluate("document.querySelector('[data-act=print]').click()")
        await page.wait_for_selector('.page .pph img')
        npages = await page.locator('.page').count()
        pr = await ev("(() => { const i = document.querySelector('.page .pph img'); return i.complete && i.naturalWidth > 0; })()")
        check(pr, f'출력물에 사진 ({npages}쪽)')
        # 화면과 출력물에서 사진과 글의 상대 위치가 같은지 (편집칸 좌표 = 출력 좌표 × 16/11)
        await page.wait_for_timeout(300)
        await page.locator('.page >> nth=0').screenshot(path=OUT / 'v14_print1.png')
        if npages > 1:
            await page.locator('.page >> nth=1').screenshot(path=OUT / 'v14_print2.png')
        await page.click('[data-act=backEdit]')
        await page.wait_for_selector('#notes')
        epos = await ev("(() => { const ph = JSON.parse(window.__DR.review.notesPhotos)[0]; const el = document.querySelector('.nph'); return [parseFloat(el.style.left), parseFloat(el.style.top)]; })()")
        await page.evaluate("document.querySelector('[data-act=print]').click()")
        await page.wait_for_selector('.page .pph')
        ppos = await ev("(() => { const el = document.querySelector('.page .pph'); const box = el.parentElement; const fp = box.querySelector('p[data-o]'); return [parseFloat(el.style.left), parseFloat(el.style.top), +fp.getAttribute('data-o')]; })()")
        check(abs(epos[0] - ppos[0]) < 1.5, f'사진 가로 위치가 편집칸과 출력물에서 같음 ({round(epos[0])} / {round(ppos[0])})')
        await page.click('[data-act=backEdit]')
        await page.wait_for_selector('#notes')

        print('다음 차수 · 이전 차수 불러오기')
        await page.evaluate("document.querySelector('[data-act=next]').click()")
        await page.wait_for_selector('.dialog .main-act')
        await page.click('.dialog .main-act')
        if await page.locator('.dialog .main-act').count():
            await page.click('.dialog .main-act')
        await page.wait_for_function("window.__DR.round === 2", timeout=10000)
        await page.wait_for_selector('[data-act=prevnotes]')
        check(await ev("!window.__DR.review.notesPhotos && !window.__DR.review.notes"), '다음 차수는 특이사항·사진 비어서 시작')
        await page.click('[data-act=prevnotes]')
        ph7 = json.loads(await ev('window.__DR.review.notesPhotos') or '[]')
        n7 = await ev('window.__DR.review.notes')
        check(len(ph7) == 1 and n7[:ph7[0]['a']].endswith('합니다') and n7.startswith('[1차 특이사항]'), '1차 특이사항 불러오기 → 사진도 같은 문장 끝에 같이 옴')

        print('끊김 · 잠긴 검토서')
        await page.evaluate("window.__mockFailUpload = true")
        await page.set_input_files('#phFile', str(IMG2))
        await page.wait_for_function("/연결이 불안정해 사진을/.test(document.querySelector('#toast') ? document.querySelector('#toast').textContent : '')", timeout=10000)
        check(len(json.loads(await ev('window.__DR.review.notesPhotos') or '[]')) == 1, '사진 올리기 실패 시 안내하고 붙이지 않음')
        await page.evaluate("window.__mockFailUpload = false")
        await page.click('[data-act=save]')
        await page.wait_for_function("/저장됨/.test(document.querySelector('#savestate').textContent)")
        sid = await ev('window.__DR.store.id')
        await page.click('[data-act=dash]')
        await page.wait_for_selector('[data-act=confirm]')
        await page.evaluate(f"document.querySelector('[data-act=confirm][data-id=\"{sid}\"]').click()")
        await page.click('.dialog .main-act')
        await page.wait_for_timeout(300)
        await page.evaluate(f"document.querySelector('[data-act=open][data-id=\"{sid}\"]').click()")
        await page.wait_for_selector('#notes')
        await page.wait_for_selector('.nph img')
        check(await page.locator('[data-act=photo]').count() == 0 and await page.locator('#notes').is_disabled(), '컨펌완료 검토서: 사진은 보이고 고칠 수 없음')
        await page.click('.nph')
        check(await page.locator('.nph-rs').count() == 0, '잠긴 검토서는 사진 조절 손잡이 없음')

        print('휴대폰 화면')
        mctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        mp = await mctx.new_page()
        mp.on('pageerror', lambda e: errors.append('phone pageerror: ' + str(e)))
        await mp.route('**/fonts.g*/**', lambda r: r.abort())
        await mp.goto(URL)
        await mp.fill('#pin', '1234'); await mp.tap('button[type=submit]')
        await mp.wait_for_selector('[data-act=new]')
        await mp.evaluate("window.__mockPhotos = window.__mockPhotos || {}")
        await mp.tap('[data-act=new]')
        await mp.wait_for_selector('#notes')
        await mp.fill('#f-tenant', '휴대폰 사진')
        await mp.fill('#notes', '휴대폰에서 쓴 특이사항')
        await mp.set_input_files('#phFile', str(IMG))
        await mp.wait_for_function("window.__DR.review.notesPhotos && JSON.parse(window.__DR.review.notesPhotos).length === 1", timeout=10000)
        await mp.evaluate("document.getElementById('s6').scrollIntoView()")
        el = mp.locator('.nph').first
        bx = await el.bounding_box()
        cx, cy = bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2
        before = json.loads(await mp.evaluate('window.__DR.review.notesPhotos'))[0]
        await mp.evaluate(f"""(() => {{
          const el = document.querySelector('.nph'); const o = {{bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true}};
          el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({{clientX: {cx}, clientY: {cy}}}, o)));
          const el2 = document.querySelector('.nph');
          el2.dispatchEvent(new PointerEvent('pointermove', Object.assign({{clientX: {cx} - 30, clientY: {cy} + 40}}, o)));
          el2.dispatchEvent(new PointerEvent('pointerup', Object.assign({{clientX: {cx} - 30, clientY: {cy} + 40}}, o)));
        }})()""")
        after = json.loads(await mp.evaluate('window.__DR.review.notesPhotos'))[0]
        check(after['y'] > before['y'] and after['x'] < before['x'], '손가락(터치)으로 끌어 옮김')
        check(await mp.evaluate('document.documentElement.scrollWidth <= innerWidth'), '휴대폰: 화면 가로 넘침 없음 (편집칸 안에서만 좌우 스크롤)')
        await mp.screenshot(path=OUT / 'v14_phone.png')
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
