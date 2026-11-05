// 시험 한 번에 돌리기: npm run test:all
// 1) 서버 시험(가짜 구글 시트) 2) 화면 시험 — 시험마다 가짜 서버를 새로 띄워 서로 섞이지 않게 함
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const T = __dirname;
const UI = ['sign_test.js', 'login_test.js', 'status_test.js', 'label_test.js', 'cam_test.js', 'torch_test.js'];
let fail = 0;
// 바로가기 페이지(test/fmtest) 흉내 — http://localhost:8124 (카메라·손전등 시험용)
const http = require('http'), fs = require('fs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(T, 'fmtest', path.normalize(p).replace(/^([\\/]*\.\.)+/, ''));
  fs.readFile(f, (e, b) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); res.end(b); });
}).listen(8124);
function runNode(file) {   // 따로 띄워 돌림 (그동안 위의 바로가기 페이지 흉내가 응답할 수 있게)
  return new Promise(done => {
    const c = spawn(process.execPath, [path.join(T, file)], { cwd: T });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    const timer = setTimeout(() => c.kill(), 180000);
    c.on('close', code => {
      clearTimeout(timer);
      const bad = code !== 0 || /^(FAIL|ERR)\b/m.test(out);
      console.log((bad ? '✗ ' : '✓ ') + file);
      if (bad) { fail++; console.log(out.split('\n').filter(l => /FAIL|ERR|Error|오류:/.test(l)).slice(0, 15).join('\n')); }
      done();
    });
  });
}
(async () => {
  await runNode('server_test.js');
  for (const f of UI) {
    const srv = spawn(process.execPath, [path.join(T, 'web.js')], { cwd: T, env: Object.assign({}, process.env, { REAL_CLOCK: '1' }) });
    await new Promise(ok => { srv.stdout.on('data', d => { if (String(d).indexOf('listening') !== -1) ok(); }); setTimeout(ok, 4000); });
    await runNode(f);
    srv.kill();
    await new Promise(ok => setTimeout(ok, 300));
  }
  console.log(fail ? '\n실패 ' + fail + '개' : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
