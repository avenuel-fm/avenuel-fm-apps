"""1.8.4 브라우저 점검: 바로가기 주소가 있으면 출력물 QR이 그 주소(?store=)를, 없으면 지금 주소를 가리킴"""
import asyncio, pathlib, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parent
PORT = 8796
URL = f'http://127.0.0.1:{PORT}/preview.html'
def check(c, m):
    if not c: raise AssertionError(m)
    print('  ✓', m)
async def qr_url(b, shell):
    pg = await b.new_page(viewport={'width': 1280, 'height': 900})
    if shell: await pg.add_init_script(f"window.__mockPublicUrl = '{shell}'")
    await pg.route('**/fonts.g*/**', lambda r: r.abort())
    # qrImg 가 받는 주소를 기록
    await pg.goto(URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
    await pg.fill('#pin', '1234'); await pg.click('#loginForm button[type=submit]')
    await pg.wait_for_selector('[data-act=new]'); await pg.click('[data-act=new]'); await pg.wait_for_selector('#notes')
    await pg.fill('[data-field=tenant]', '바로가기시험'); await pg.click('[data-act=save]')
    await pg.wait_for_function("() => /저장/.test(document.body.innerText) && window.__mockCalls && window.__mockCalls.includes('apiSaveReview')")
    await pg.wait_for_timeout(800)
    await pg.evaluate("""() => new Promise(res => { const sc = document.createElement('script'); sc.src = 'node_modules/qrcode-generator/qrcode.js'; sc.onload = () => {
      const real = window.qrcode; window.__qrData = [];
      window.qrcode = function (a, b) { const q = real(a, b), add = q.addData.bind(q); q.addData = d => { window.__qrData.push(d); return add(d); }; return q; };
      res(); }; document.head.appendChild(sc); })""")
    await pg.click('[data-act=print] >> visible=true')
    await pg.wait_for_function("() => (window.__qrData || []).length > 0", timeout=15000)
    u = await pg.evaluate("() => (window.__qrData || []).filter(x => /store=/.test(x)).pop() || ''")
    await pg.close(); return u
async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            u1 = await qr_url(b, 'https://acct.github.io/fm/dw/')
            check(u1.startswith('https://acct.github.io/fm/dw/?store='), '바로가기 주소가 있으면 QR = 바로가기 주소?store=… ' + u1)
            u2 = await qr_url(b, '')
            check('?store=' in u2 and 'github.io' not in u2, '없으면 지금 주소?store=… ' + u2)
            await b.close()
    finally:
        srv.terminate()
    print('1.8.4 브라우저 점검 통과')
asyncio.run(main())
