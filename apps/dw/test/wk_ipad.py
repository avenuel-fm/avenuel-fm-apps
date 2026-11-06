"""iPad(사파리·크롬 = WebKit) 점검: WebKitGTK 엔진 + iPad 화면 크기·사용자 에이전트로 주요 기능 실행"""
import subprocess, sys, time, json, pathlib
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

ROOT = pathlib.Path(__file__).resolve().parent
PORT = 8770
URL = f'http://127.0.0.1:{PORT}/preview_wk.html'
UA_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
UA_CHROME = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1'
OUT = ROOT / 'shots'
import re as _re
AUDIT_JS = _re.search(r'AUDIT_JS = r"""(.*?)"""', (ROOT / 'ui_audit.py').read_text(), _re.S).group(1)
UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('  ✓', msg)


def run(name, ua, w, h, heavy):
    print(f'\n[{name}] {w}x{h}')
    opts = webdriver.WebKitGTKOptions()
    opts.binary_location = '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser'
    opts.add_argument('--automation')
    opts.add_argument('--user-agent=' + ua)
    d = webdriver.WebKitGTK(options=opts)
    d.set_window_size(w, h + 80)
    js = d.execute_script
    wait = lambda cond, t=30: WebDriverWait(d, t).until(lambda _: js('return ' + cond))
    def audit(where):
        found = js('return (' + AUDIT_JS + ')()')
        check(not found, f'{where}: 화면 넘침·벗어남 없음' + (' ' + str(found[:5]) if found else ''))
    try:
        d.get(URL)
        js('localStorage.clear(); sessionStorage.clear();'); d.get(URL)
        check(any(k in js('return navigator.userAgent') for k in ('iPad', 'Macintosh', 'iPhone')), '사용자 에이전트: ' + js('return navigator.userAgent')[:60])
        d.find_element(By.ID, 'pin').send_keys('1234')
        d.find_element(By.CSS_SELECTOR, 'button[type=submit]').click()
        wait("!!document.querySelector('[data-act=new]')")
        audit('대시보드')
        d.find_element(By.CSS_SELECTOR, '[data-act=new]').click()
        wait("!!document.querySelector('#notes')")
        d.find_element(By.ID, 'f-tenant').send_keys('아이패드 시험')
        d.find_element(By.ID, 'f-location').send_keys('2')
        d.find_element(By.ID, 'f-contractorName').send_keys('김시공')
        tel = d.find_element(By.ID, 'f-contractorTel'); tel.send_keys('01098765432')
        check(tel.get_attribute('value') == '010-9876-5432' and js("return document.querySelector('#f-respTel').value") == '010-9876-5432', '전화번호 하이픈 · 서명란 자동 입력')
        js("document.querySelector('[data-choice=kitchen][data-value=없음]').click()")
        check(js("return document.querySelector('#f-exhaustCmh').disabled"), '주방공사 없음 → 해당없음 비활성')
        audit('검토서')
        js("document.getElementById('s7').scrollIntoView()"); time.sleep(0.2)
        audit('서명란')

        # 서명 (펜·손가락 = pointer 이벤트)
        js("document.querySelector('[data-act=sig][data-key=respSig]').click()")
        wait("!!document.querySelector('#sigPad, .sigpad canvas')")
        c = d.find_element(By.CSS_SELECTOR, '.sigpad canvas')
        ActionChains(d).move_to_element_with_offset(c, -100, 0).click_and_hold().move_by_offset(60, 30).move_by_offset(80, -40).move_by_offset(60, 50).release().perform()
        js("document.querySelector('#sigOk').click()")
        time.sleep(0.5)
        check(str(js('return window.__DR.review.respSig')).startswith('data:image/png'), '서명 패드 (pointer 이벤트) → 서명 이미지')

        # 자주 쓰는 문구
        js("document.querySelector('[data-act=phrases]').scrollIntoView({block: 'center'})"); time.sleep(0.2)
        js("document.querySelector('[data-act=phrases]').click()")
        wait("!!document.querySelector('[data-ph]')")
        d.find_element(By.CSS_SELECTOR, '[data-ph]').click()
        check(js("return document.querySelector('#notes').value.length > 10"), '자주 쓰는 문구 삽입')

        # 특이사항 사진 (파일 선택 → 끌어 옮기기 → 돌리기)
        d.find_element(By.ID, 'phFile').send_keys(str(ROOT / 'shots' / 'test_photo.jpg'))
        wait("window.__DR.review.notesPhotos && JSON.parse(window.__DR.review.notesPhotos).length === 1", 20)
        js("document.getElementById('s6').scrollIntoView()"); time.sleep(0.3)
        ph = d.find_element(By.CSS_SELECTOR, '.nph')
        x0 = json.loads(js('return window.__DR.review.notesPhotos'))[0]
        ActionChains(d).move_to_element(ph).click_and_hold().move_by_offset(-40, 30).release().perform()
        time.sleep(0.3)
        x1 = json.loads(js('return window.__DR.review.notesPhotos'))[0]
        check(x1['x'] < x0['x'] and x1['y'] > x0['y'], '사진 붙이기 · 끌어 옮기기')
        js("var b=document.querySelector('.nph.picked [data-ph-h=rr]'); if (b) b.click()")
        time.sleep(0.2)
        check(json.loads(js('return window.__DR.review.notesPhotos'))[0]['r'] == 90, '사진 돌리기')
        audit('특이사항 편집칸')
        # 지침 검색 · 미리보기
        js("document.querySelector('[data-act=guide]').click()")
        wait("!!document.querySelector('#gq')")
        d.find_element(By.ID, 'gq').send_keys('방화구획')
        wait("!!document.querySelector('#gres .pgbtn')")
        js("document.querySelector('#gres .pgbtn').click()")
        wait("(() => { const i = document.querySelector('#gprev .pv-page img'); return i && i.complete && i.naturalWidth > 0; })()")
        check(js("return !!document.querySelector('#gprev.modal') || innerWidth >= 1080"), '쪽 미리보기 (태블릿은 전체 화면)')
        d.save_screenshot(str(OUT / f'wk_{name}_preview.png'))
        js("var x=document.querySelector('[data-pv=ins]'); if (x) x.click(); else document.querySelector('#gres [data-gins]').click()")
        check('p.' in js("return document.querySelector('#notes').value"), '쪽 번호 삽입')

        # 저장 · 출력 미리보기 · QR · PDF 만들기
        js("document.querySelector('[data-act=save]').click()")
        wait("/저장됨/.test(document.querySelector('#savestate').textContent)")
        check(True, '구글시트(모의) 저장')
        js("document.querySelector('[data-act=print]').click()")
        wait("!!document.querySelector('.page .pver')")
        wait("(() => { const i = document.querySelector('.pqr img'); return i && i.complete && i.naturalWidth > 0; })()")
        wait("(() => { const i = document.querySelector('.page .pph img'); return i && i.complete && i.naturalWidth > 0; })()")
        check(True, '출력물에 사진')
        check(js("return document.querySelectorAll('.page').length") >= 1, f"A4 출력 화면 {js('return document.querySelectorAll(\".page\").length')}쪽 · 적용 지침 · QR")
        d.save_screenshot(str(OUT / f'wk_{name}_print.png'))
        audit('출력 화면')
        js("window.__pdf = null; html2pdf().set({ margin: 0, html2canvas: { scale: 1.5 }, jsPDF: { unit: 'px', format: [794, 1123], hotfixes: ['px_scaling'] } }).from(document.querySelector('.page')).outputPdf('blob').then(function (b) { window.__pdf = b.size; }, function (e) { window.__pdf = 'ERR ' + e; })")
        wait("window.__pdf != null", 90)
        size = js('return window.__pdf')
        check(isinstance(size, int) and size > 20000, f'PDF 만들기 (html2pdf) {size} 바이트')
        if 'iPad' in ua:
            check(js("return !!document.querySelector('.ios-tip')"), '아이패드 안내 문구 표시')
        js("document.querySelector('[data-act=drivePdf]').click()")
        wait("!!document.querySelector('.dialog') && /드라이브에 저장했습니다/.test(document.querySelector('.dialog').innerText)", 90)
        pb = js('return window.__mockPdf.bytes')
        check(pb > 20000 and js("return !!document.querySelector('.dialog a[href]')"), f'드라이브에 PDF 저장 ({pb} 바이트) → PDF 열기 링크')
        d.save_screenshot(str(OUT / f'wk_{name}_drive.png'))
        js("document.querySelector('.dialog [data-dv]').click()")
        js("document.querySelector('[data-act=backEdit]').click()")
        wait("!!document.querySelector('#notes')")

        # 끊김 대비
        js("window.__mockOffline = true; document.querySelector('[data-act=save]').click()")
        wait("/저장 대기/.test(document.querySelector('#savestate').textContent)")
        js("window.__mockOffline = false")
        check(len(json.loads(js("return localStorage.getItem('dr_pending')") or '{}')) == 1, '끊김 → 이 기기에 보관 (localStorage)')

        if heavy:
            # 지침 색인 만들기 (pdf.js · canvas)
            js("document.querySelector('[data-act=dash]').click()")
            wait("!!document.querySelector('[data-act=gadmin]')")
            js("document.querySelector('[data-act=gadmin]').click()")
            wait("!!document.querySelector('.gadm')")
            js("Array.from(document.querySelectorAll('.gadm .grow')).filter(r => r.textContent.includes('시설공사지침_2024.07.09.pdf'))[0].querySelector('[data-act=gbuild]').click()")
            wait("!!document.querySelector('#gfShort')")
            js("document.querySelector('.dialog .main-act').click()")
            t0 = time.time()
            wait("!document.querySelector('#gbProg') || !!document.querySelector('#gbClose')", 600)
            err = js("var x=document.querySelector('#gbClose'); return x ? document.querySelector('.dialog').innerText : ''")
            check(not err, f'지침 색인 만들기 47쪽 ({round(time.time() - t0)}초) ' + (err or ''))
            g = js("return window.__mockGuides.sources.filter(s => s.fileName && s.fileName.indexOf('시설공사') === 0)[0]")
            check(g['entries'] > 500, f"검색 항목 {g['entries']}개")
            d.save_screenshot(str(OUT / f'wk_{name}_admin.png'))
        errs = js('return window.__errs')
        check(not errs, '자바스크립트 오류 없음' + (': ' + str(errs) if errs else ''))
    finally:
        d.quit()


srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    if '--only-phone' not in sys.argv:
        run('safari_landscape', UA_SAFARI, 1180, 820, True)
        run('chrome_portrait', UA_CHROME, 820, 1180, False)
    run('iphone_safari', UA_IPHONE, 390, 844, False)
finally:
    srv.terminate()
