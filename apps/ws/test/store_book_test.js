// 지도 매장 대장 규칙 시험 (결정 152) — 화면 없이 계산만. 실행: node test/store_book_test.js
const assert = require('assert');
const B = require('../../../fm/map/js/storage/storeBook.js');
let n = 0;
const t = (name, f) => { f(); n++; console.log('ok   ' + name); };
const shape = (id, name, x = 100, extra) => Object.assign({ shape: id, name, type: 'store', x, y: 100, w: 50, h: 40 }, extra);
const rec = (book, shapes) => B.reconcile(book, shapes, 'avenuel', '1F', true);
const floors = [{ code: '1F', name: '1F' }, { code: 'B1', name: 'B1' }];
const HEAD = [['순번', '매장명', '차단기', '', '', '급수', '배수', '가스'], ['', '', '일반', '비상', 'from', '', '', '']];
const MERGES = [{ s: { r: 0, c: 2 }, e: { r: 0, c: 4 } }];
const sheet = (rows, name = '1층', head = HEAD) => ({ name, merges: MERGES, rows: head.concat(rows) });

t('1) 도형마다 번호 AV-1F-0001 · 층마다 늘어남', () => {
  const r = rec(B.emptyBook(), [shape('a', '아그라'), shape('b', '샤넬', 300)]);
  assert.deepStrictEqual(Object.keys(r.book.items), ['AV-1F-0001', 'AV-1F-0002']);
  assert.strictEqual(r.byShape.b, 'AV-1F-0002');
  assert.strictEqual(B.reconcile(B.emptyBook(), [shape('a', 'x')], 'dept', '01', true).byShape.a, 'DP-01-0001');
  assert.strictEqual(B.reconcile(B.emptyBook(), [shape('a', 'x')], 'castle', 'B1', true).byShape.a, 'CS-B1-0001');
});
t('2) 이름을 바꾸거나 지워도 번호·상세내역 그대로', () => {
  const book = rec(B.emptyBook(), [shape('a', '아그라')]).book;
  book.items['AV-1F-0001'].details = { 급수: '50' };
  book.items['AV-1F-0001'].name = '';
  const r = rec(book, [shape('a', '이름 없음')]);
  assert.strictEqual(r.byShape.a, 'AV-1F-0001');
  assert.strictEqual(r.book.items['AV-1F-0001'].name, '');
  assert.strictEqual(r.book.items['AV-1F-0001'].details.급수, '50');
  assert.strictEqual(r.changed, false);
});
t('3) 도형 삭제: 번호·이름·상세내역 함께 삭제, 번호는 다시 쓰지 않음', () => {
  const book = rec(B.emptyBook(), [shape('a', '아그라'), shape('a#2', '둘째', 120), shape('b', '샤넬', 300)]).book;
  B.removeShape(book, 'a', true);
  assert.deepStrictEqual(Object.keys(book.items), ['AV-1F-0003']);
  assert.deepStrictEqual(book.deleted, ['a']);
  assert.strictEqual(rec(book, [shape('b', '샤넬', 300), shape('n', '새 매장', 700)]).byShape.n, 'AV-1F-0004');
});
t('4) 도면 파일이 바뀌어 도형 값이 달라져도 위치로 찾아 번호 유지', () => {
  const book = rec(B.emptyBook(), [shape('old', '아그라')]).book;
  const r = rec(book, [shape('new', '아그라', 110)]);
  assert.strictEqual(r.byShape.new, 'AV-1F-0001');
  assert.strictEqual(r.book.next, 2);
});
t('5) 도면에서 못 찾은 번호는 지우지 않고 표시만, 다시 나타나면 표시를 뗌', () => {
  const book = rec(B.emptyBook(), [shape('a', '아그라')]).book;
  rec(book, [shape('far', '다른 매장', 2000)]);
  assert.strictEqual(book.items['AV-1F-0001'].lost, true);
  rec(book, [shape('a', '아그라'), shape('far', '다른 매장', 2000)]);
  assert.strictEqual(book.items['AV-1F-0001'].lost, undefined);
});
t('6) 보기 전용이면 대장을 바꾸지 않음', () => {
  const book = B.emptyBook();
  const r = B.reconcile(book, [shape('a', '아그라')], 'avenuel', '1F', false);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(book.items, {});
});
t('7) 예전 상세 값 옮기기 (빈 값·- 는 뺌)', () => {
  const r = rec(B.emptyBook(), [shape('a', 'x', 100, { fields: [{ label: '차단기 규격', value: '3P 75A' }, { label: '수도배관 규격', value: '25A' }, { label: '가스등급 규격', value: '-' }, { label: '비고', value: '메모' }] })]);
  assert.deepStrictEqual(r.book.items['AV-1F-0001'].details, { '차단기|일반': '3P 75A', 급수: '25A', 비고: '메모' });
});
t('8) 엑셀 머리글 2줄·병합 읽기, 순번은 안 읽음', () => {
  const p = B.parseSheet(sheet([[1, '아그라', 50, 30, '1번 EPS', 50, 50, 6]]).rows, MERGES);
  assert.deepStrictEqual(p.columns.map(B.keyOf), ['차단기|일반', '차단기|비상', '차단기|from', '급수', '배수', '가스']);
  assert.strictEqual(p.rows[0].cells['차단기|from'], '1번 EPS');
  assert.strictEqual(p.rows[0].cells.가스, '6');
});
t('9) 머리글 1줄 파일도 읽음 · 매장명 칸이 없으면 오류', () => {
  const p = B.parseSheet([['순번', '매장명', '급수'], [1, '아그라', '50']], []);
  assert.deepStrictEqual(p.rows, [{ name: '아그라', cells: { 급수: '50' } }]);
  assert.ok(B.parseSheet([['이름', '급수']], []).error);
});
const twoStores = () => { const b = rec(B.emptyBook(), [shape('a', '아그라'), shape('b', '샤넬', 300)]).book; b.items['AV-1F-0002'].details = { 급수: '20' }; return b; };
t('10) 값 저장 · 빈 칸은 지움 · 엑셀에 없는 매장은 그대로 · 저장 전 원본은 안 바뀜', () => {
  const book = twoStores(); book.items['AV-1F-0001'].details = { 가스: '9' };
  const plan = B.planUpload([sheet([[1, '아그라', 50, '', '', '', '', '']])], floors, { '1F': book }, B.DEFAULT_ITEMS);
  const it = plan.books['1F'].items;
  assert.deepStrictEqual(it['AV-1F-0001'].details, { '차단기|일반': '50' });
  assert.deepStrictEqual(it['AV-1F-0002'].details, { 급수: '20' });
  assert.deepStrictEqual(book.items['AV-1F-0001'].details, { 가스: '9' });
  assert.strictEqual(plan.changed, 1);
  assert.ok(plan.changes.some(c => c.label === '가스' && c.from === '9' && c.to === ''));
});
t('11) 도면에 없는 이름은 저장 안 하고 목록에', () => {
  const plan = B.planUpload([sheet([[1, '없는 매장', 50, '', '', '', '', '']])], floors, { '1F': twoStores() }, B.DEFAULT_ITEMS);
  assert.deepStrictEqual(plan.missing, [{ floor: '1F', name: '없는 매장' }]);
  assert.strictEqual(plan.changed, 0);
  assert.deepStrictEqual(plan.books, {});
});
t('12) 같은 이름 도형: 1줄은 모두에, 여러 줄은 번호 순서대로, 넘치는 줄은 목록에', () => {
  const mk = () => rec(B.emptyBook(), [shape('a', '화장실'), shape('b', '화장실', 300)]).book;
  let it = B.planUpload([sheet([[1, '화장실', 10, '', '', '', '', '']])], floors, { '1F': mk() }, B.DEFAULT_ITEMS).books['1F'].items;
  assert.strictEqual(it['AV-1F-0001'].details['차단기|일반'], '10');
  assert.strictEqual(it['AV-1F-0002'].details['차단기|일반'], '10');
  const plan = B.planUpload([sheet([[1, '화장실', 10, '', '', '', '', ''], [2, '화장실', 20, '', '', '', '', ''], [3, '화장실', 30, '', '', '', '', '']])], floors, { '1F': mk() }, B.DEFAULT_ITEMS);
  it = plan.books['1F'].items;
  assert.strictEqual(it['AV-1F-0001'].details['차단기|일반'], '10');
  assert.strictEqual(it['AV-1F-0002'].details['차단기|일반'], '20');
  assert.strictEqual(plan.missing.length, 1);
});
t('13) 열을 더하면 항목 추가 · 열을 빼도 있던 값은 남음', () => {
  const head = [['순번', '매장명', '통신'], ['', '', '']];
  const book = twoStores();
  const plan = B.planUpload([sheet([[1, '샤넬', 'LAN 2']], '1층', head)], floors, { '1F': book }, B.DEFAULT_ITEMS);
  assert.deepStrictEqual(plan.added, [{ g: '', l: '통신' }]);
  assert.strictEqual(plan.items.length, B.DEFAULT_ITEMS.length + 1);
  assert.deepStrictEqual(plan.books['1F'].items['AV-1F-0002'].details, { 급수: '20', 통신: 'LAN 2' });
});
t('14) 시트 이름 1층·1F·B1층 찾기 · 없는 층은 알림', () => {
  assert.strictEqual(B.floorWord('1층'), B.floorWord('1F'));
  assert.strictEqual(B.floorWord('B1층'), B.floorWord('B1'));
  assert.strictEqual(B.floorWord('01'), B.floorWord('1층'));
  const plan = B.planUpload([sheet([], '9층')], floors, { '1F': B.emptyBook() }, B.DEFAULT_ITEMS);
  assert.strictEqual(plan.badSheets.length, 1);
});
t('15) 못 찾은 도형은 엑셀 이름과 맞추지 않음', () => {
  const book = twoStores(); book.items['AV-1F-0001'].lost = true;
  const plan = B.planUpload([sheet([[1, '아그라', 50, '', '', '', '', '']])], floors, { '1F': book }, B.DEFAULT_ITEMS);
  assert.strictEqual(plan.missing.length, 1);
});
t('16) 엑셀 받기 → 그대로 다시 올리면 바뀌는 것 없음 (이름 없는 도형은 뺌)', () => {
  const book = twoStores(); book.items['AV-1F-0001'].details = { '차단기|일반': '50', '차단기|from': '1번 EPS' };
  book.items['AV-1F-0003'] = { shape: 'c', name: '', details: {} };
  const s = B.buildSheet(B.DEFAULT_ITEMS, book);
  assert.deepStrictEqual(s.aoa[0], ['순번', '매장명', '차단기', '', '', '급수', '배수', '가스']);
  assert.deepStrictEqual(s.aoa[1], ['', '', '일반', '비상', 'from', '', '', '']);
  assert.strictEqual(s.aoa.length, 4);
  const plan = B.planUpload([{ name: '1층', merges: s.merges, rows: s.aoa }], floors, { '1F': book }, B.DEFAULT_ITEMS);
  assert.strictEqual(plan.changed, 0);
  assert.strictEqual(plan.same, 2);
  assert.deepStrictEqual(plan.added, []);
});
console.log(`\n매장 대장 규칙 시험 통과 (${n}개)`);
