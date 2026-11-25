// 시험 한 번에 돌리기: npm run test:all
// 1) 서버 시험(가짜 구글 시트) 2) 화면 시험 — 시험마다 가짜 서버를 새로 띄워 서로 섞이지 않게 함
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const T = __dirname;
const UI = ['sign_test.js', 'login_test.js', 'status_test.js', 'label_test.js', 'cam_test.js', 'torch_test.js', 'nw_test.js', 'tbm_test.js', 'att_test.js', 'eh_test.js', 'theme_test.js', 'cs_test.js', 'thermal_launch_test.js', 'cad_test.js', 'set_test.js', 'log_test.js'];
let fail = 0;
// 바로가기 페이지(저장소 fm/ 그대로, fm_serve.js) — http://localhost:8124 (카메라·손전등 시험용)
const http = require('http');
const fmFile = require('./fm_serve.js');
http.createServer((req, res) => {
  let out;
  try { out = fmFile(decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, ''), 'http://localhost:8123/exec'); }
  catch (e) { if (/fm_serve/.test(e.message)) { console.log('ERR ' + e.message); fail++; } res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', out.type); res.end(out.body);
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
