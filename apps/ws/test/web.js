const http = require('http'); const fs = require('fs'); const path = require('path');
const env = require('./mock_env.js');
if (process.env.REAL_CLOCK) { const RealDate = Object.getPrototypeOf(Date); env.NOW.d = new RealDate(RealDate.now()); }  // 로그인 시험: 브라우저 시계와 맞춤
const SRC = path.join(__dirname, '..', 'src');
const styles = fs.readFileSync(path.join(SRC, 'Styles.html'), 'utf8');
const shim = `<script>window.google={script:{history:{push(){},setChangeHandler(){}},run:null}};
function mk(st){return new Proxy({},{get(_,k){if(k==='withSuccessHandler')return f=>mk({...st,ok:f});if(k==='withFailureHandler')return f=>mk({...st,no:f});
return (...args)=>fetch('/run',{method:'POST',body:JSON.stringify({fn:k,args})}).then(r=>r.json()).then(j=>{if(j&&j.__error){st.no&&st.no(new Error(j.__error))}else st.ok&&st.ok(j)}).catch(e=>st.no&&st.no(e));}})}window.google.script.run=mk({});</script>`;
function page(name, vars) {
  let s = fs.readFileSync(path.join(SRC, name + '.html'), 'utf8').replace("<?!= include('Styles'); ?>", styles);
  s = s.replace('<?!= JSON.stringify(execUrl) ?>', JSON.stringify(vars.execUrl || '')).replace('<?!= JSON.stringify(qr) ?>', JSON.stringify(vars.qr || ''));
  return s.replace('<head>', '<head>' + shim);
}
global.ScriptApp = { getService: () => ({ getUrl: () => 'http://localhost:8123/check-base' }) };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/index') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(page('Index', { execUrl: u.searchParams.get('exec') || 'http://localhost:8123/check-base' })); }
  if (u.pathname === '/check-base' || u.pathname === '/check') { const fe = u.searchParams.get('fe') || ''; res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(page('Check', { qr: isQrToken_(fe) ? fe : '' })); }
  if (u.pathname === '/exec') {  // 구글 웹앱 /exec 흉내: GET ?api=check, POST(text/plain JSON) — GitHub check.html 시험용
    res.setHeader('access-control-allow-origin', '*'); res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => { let out; try { const j = JSON.parse(b); out = j.action === 'checkSubmit' ? checkSubmit(j.qr, j.d) : { ok: false, error: '알 수 없는 요청' }; } catch (e) { out = { ok: false, error: String(e.message || e) }; } res.end(JSON.stringify(out)); }); return; }
    if (u.searchParams.get('api') === 'check') return res.end(JSON.stringify(checkInit(u.searchParams.get('fe'))));
    res.statusCode = 404; return res.end('{}');
  }
  if (u.pathname === '/run') { let b = ''; req.on('data', c => b += c); req.on('end', () => { const { fn, args } = JSON.parse(b); let out; try { out = global[fn](...args); } catch (e) { out = { __error: String(e.message || e) }; } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out === undefined ? null : out)); }); return; }
  if (u.pathname === '/seed') { const SG = fs.readFileSync(path.join(__dirname, 'sig_b64.txt'), 'utf8'); setup_(); addStaff_('홍길동', '1234', '전방파트', '소장'); addStaff_('김철수', '5678', '기건파트', '직원'); const tk = login('1234','x', SG).token; feAdd(tk, { floor: '3F', store: '샤넬 뷰티', count: 2 }); feAdd(tk, { floor: 'B1', store: '공용부', count: 1 });
    res.end(JSON.stringify(feList(tk).items)); return; }
  res.statusCode = 404; res.end();
}).listen(8123, () => console.log('listening'));
