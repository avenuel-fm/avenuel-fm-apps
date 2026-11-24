// 길찾기 계산 시험 (결정 246): 직각만 · 입구는 복도 쪽 가장 긴 변의 한가운데 · 복도 중앙선 따라감
// 실행: node test/route_test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = { mapContainer: { addEventListener() {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fm', 'map', 'js', 'cad', 'routeFinder.js'), 'utf8'), ctx);
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const ortho = pts => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.1 || Math.abs(p.y - pts[i - 1].y) < 0.1);
const run = (a, b, others, cor) => JSON.parse(JSON.stringify(ctx.routeCompute(a, b, others, cor)));

// ㄱ자 복도: 가로 0~1000 (y 100~160), 세로 (x 940~1000, y 100~600)
const L = [{ x: 0, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 600 }, { x: 940, y: 600 }, { x: 940, y: 160 }, { x: 0, y: 160 }];
const A = rect(100, 0, 200, 100);      // 복도 위쪽 매장, 아래 변이 복도에 붙음
const B = rect(700, 160, 200, 120);    // 복도 아래쪽 매장
const C = rect(780, 300, 160, 200);    // 세로 복도 왼쪽 매장 (오른쪽 변이 복도)
let r = run(A, B, [C], [L]);
ok(r.ok, '입구 → 복도 → 입구 길을 찾음');
ok(r.ok && ortho(r.points), '선이 가로·세로뿐 (대각선 없음)');
ok(r.ok && Math.abs(r.points[0].x - 200) < 0.1 && Math.abs(r.points[0].y - 100) < 0.1, '출발은 복도 쪽 변의 한가운데(200,100)');
ok(r.ok && r.points.some(p => Math.abs(p.y - 130) < 0.1), '복도 가로 중앙선(y=130)을 따라감');
const e = r.points[r.points.length - 1];
ok(e && Math.abs(e.x - 800) < 0.1 && Math.abs(e.y - 160) < 0.1, '도착은 복도 쪽 변의 한가운데(800,160)');
// 꺾인 복도 지나기: A → C (세로 복도 쪽)
r = run(A, C, [B], [L]);
ok(r.ok && ortho(r.points), 'ㄱ자로 꺾어 지나감');
ok(r.ok && r.points.some(p => Math.abs(p.x - 970) < 0.1), '세로 중앙선(x=970)을 지남');
// 매장 안으로 안 들어감
const inside = (p, poly) => p.x > poly[0].x + 0.5 && p.x < poly[1].x - 0.5 && p.y > poly[0].y + 0.5 && p.y < poly[2].y - 0.5;
ok(r.ok && r.points.every(p => ![A, B, C].some(s => inside(p, s))), '어느 매장 안쪽 점도 지나지 않음');
// 복도 없음 · 끊긴 복도
ok(run(A, B, [], []).ok === false, '복도가 없으면 안내 문구');
const far = rect(3000, 100, 500, 60);
r = run(A, B, [], [L, far]); ok(r.ok, '떨어진 다른 복도가 있어도 길은 찾음');
const D = rect(3100, 160, 100, 100); r = run(A, D, [], [L, far]); ok(r.ok === false && /끊겨/.test(r.error || ''), '이어지지 않은 복도는 「끊겨 있습니다」');
process.exit(fail ? 1 : 0);
