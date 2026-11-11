/**
 * 잠실점 에비뉴엘 공사 도면 검토서 — 서버 코드 (Google Apps Script)
 *
 * 이 스크립트는 구글시트에 "확장 프로그램 > Apps Script"로 붙여서 사용합니다.
 * 시트 메뉴 [도면협의] 에서 초기 설정과 PIN 설정을 한 뒤 웹앱으로 배포하세요.
 */

var APP = {
  VERSION: '1.8.12',
  STORE_LABEL: '잠실점 에비뉴엘',
  DOC_PREFIX: '에비뉴엘컨펌',
  ROLES: ['소장', '부소장'],
  SHEETS: {
    STORES: '매장',
    REVIEWS: '검토서',
    RULES: '준수사항',
    PHRASES: '자주쓰는문구',
    SYNONYMS: '비슷한말',
    LOG: '변경기록',
    DELETED: '삭제보관',
    SETTINGS: '설정'
  },
  SIG_MAX_CHARS: 45000, // 시트 한 칸 최대 50,000자 이내로 서명 이미지 저장
  BACKUP_FOLDER: '도면협의_백업',
  PDF_FOLDER: '도면협의_출력',
  PHOTO_FOLDER: '도면협의_사진',
  PHOTO_MAX: 10,
  BACKUP_KEEP_DAYS: 30,
  // 시방서 발송: 보내는 주소는 웹앱 주인 Gmail의 "다른 주소에서 메일 보내기"에 등록돼 있어야 함
  SPEC_FROM: 'max2122@nate.com',
  SPEC_FROM_NAME: '잠실점 에비뉴엘 시설팀',
  // 시방서 메일 맨 아래 서명 (줄마다 하나, 바꾸려면 여기만 고침)
  SPEC_SIGNATURE: [
    '에비뉴엘 시설팀',
    'T. 02-3213-2456 / 02-3213-2119 / 02-3213-2122',
    'E. max2122@nate.com',
    'W. http://www.maxerve.co.kr/'
  ]
};

/** 시방서: 지침 폴더(도면협의_지침)에서 이름에 표시 글자가 들어간 .zip 파일 */
var SPECS = [
  { k: 'tenant', l: 'Tenant 시방서', re: /tenant/i },
  { k: 'crown', l: 'The Crown 시방서', re: /crown/i }
];

/** 매장(목록) 시트 열 */
var STORE_COLS = [
  ['id', '매장ID'],
  ['seq', '일련번호'],
  ['docNo', '문서번호'],
  ['firstDate', '최초등록일'],
  ['tenant', '테넌트명'],
  ['location', '공사위치'],
  ['storeType', '매장형태'],
  ['contractor', '시공업체'],
  ['openDate', '오픈예정일'],
  ['currentRound', '현재차수'],
  ['lastReviewDate', '최근검토일'],
  ['status', '상태'],
  ['confirmedBy', '컨펌처리자'],
  ['confirmedAt', '컨펌일시'],
  ['updatedAt', '수정일시'],
  ['periodStart', '공사시작일'],
  ['periodEnd', '공사종료일'],
  ['fireCheckDate', '소방점검예정일'],
  ['specSent', '시방서발송'],
  ['chiefOk', '소장확인'],
  ['docMissing', '미제출서류'],
  ['sendLog', '발송기록'],
  ['defectSent', '하자발송'],
  ['sigPending', '서명요청'],
  ['fireDoc', '방재실협의서']
];

/**
 * 검토서 입력 항목. [키, 시트 헤더, 종류, 선택지]
 * 종류: text / date / num / email / tel / choice / bool / long / sig
 */
var FIELDS = [
  ['reviewDate', '검토일', 'date'],
  ['openDate', '오픈예정일', 'date'],
  ['tenant', '테넌트명', 'text'],
  ['storeType', '매장형태', 'choice', ['본매장', '팝업', 'VP']],
  ['location', '공사위치', 'text'],
  ['periodStart', '공사시작일', 'date'],
  ['periodEnd', '공사종료일', 'date'],
  ['fireCheckDate', '소방점검예정일', 'date'],

  ['ownerCompany', '발주처_업체명', 'text'],
  ['ownerName', '발주처_담당자', 'text'],
  ['ownerTel', '발주처_연락처', 'tel'],
  ['ownerEmail', '발주처_이메일', 'email'],
  ['contractorCompany', '시공업체_업체명', 'text'],
  ['contractorName', '시공업체_담당자', 'text'],
  ['contractorTel', '시공업체_연락처', 'tel'],
  ['contractorEmail', '시공업체_이메일', 'email'],

  ['ceiling', '천장', 'choice', ['신설', '재사용']],
  ['floor', '바닥', 'choice', ['신설', '재사용']],
  ['wall', '벽면', 'choice', ['신설', '재사용']],
  ['elecKw', '전기용량_kW', 'num'],
  ['powerPhase', '전원방식', 'choice', ['단상 220V', '삼상 380V', '화재예방단자함']],
  ['mainBreakerA', '메인차단기_A', 'num'],
  ['kitchen', '주방공사', 'choice', ['있음', '없음']],
  ['waterproof', '방수', 'choice', ['시공', '해당없음']],
  ['waterTest', '담수테스트_72시간', 'choice', ['예정', '해당없음']],
  ['supplyPipeA', '급수배관_A', 'num'],
  ['drainPipeA', '배수배관_A', 'num'],
  ['kitchenExt', '주방자동소화장치', 'choice', ['있음', '없음']],
  ['exhaustCmh', '주방배기용량_CMH', 'num'],
  ['gasGrade', '도시가스등급', 'text'],
  ['gasAlarm', '가스경보설비', 'choice', ['있음', '없음']],

  ['broadcast', '자체방송', 'choice', ['설치', '미설치']],
  ['wanbi', '완비대상', 'choice', ['해당', '비해당']],
  ['tempPartition', '가설칸막이', 'choice', ['설치', '미설치']],
  ['shutter', '방화셔터_방범셔터', 'choice', ['있음', '없음']],
  ['smokeCurtain', '제연커튼', 'choice', ['있음', '없음']],
  ['controller', '연동제어기_수동조작함', 'choice', ['있음', '없음']],
  // 1.8: 설비 추가·이설 수량(EA) → 설비 교체. 예전 수량 열은 시트에 그대로 남음
  ['sprReplace', '스프링클러_교체', 'choice', ['교체', '미교체']],
  ['detReplace', '감지기_교체', 'choice', ['교체', '미교체']],
  ['diffReplace', '디퓨져_교체', 'choice', ['교체', '미교체']],
  ['preFR', '선처리방염', 'choice', ['있음', '없음']],
  ['postFR', '후처리방염', 'choice', ['있음', '없음']],

  ['docInsurance', '제출_영업배상책임보험', 'choice', ['제출', '미제출']],
  ['docCad', '제출_설계도면CAD', 'choice', ['제출', '미제출']],
  ['docFR', '제출_방염서류', 'choice', ['제출', '미제출']],
  ['docFRPlan', '제출_방염계획도', 'choice', ['제출', '미제출']],

  ['rulesAck', '준수사항확인', 'bool'],
  ['notes', '특이사항', 'long'],
  ['notesPhotos', '특이사항_사진', 'long'],
  ['guideVer', '적용지침', 'long'],

  ['safetyName', '안전관리팀_성명', 'text'],
  ['safetyTel', '안전관리팀_연락처', 'tel'],
  ['safetySig', '안전관리팀_서명', 'sig'],
  ['safetySigDate', '안전관리팀_서명일', 'date'],
  ['salesName', '영업팀_성명', 'text'],
  ['salesTel', '영업팀_연락처', 'tel'],
  ['salesSig', '영업팀_서명', 'sig'],
  ['salesSigDate', '영업팀_서명일', 'date'],
  ['respOrg', '공사책임자_소속', 'text'],
  ['respName', '공사책임자_성명', 'text'],
  ['respTel', '공사책임자_연락처', 'tel'],
  ['respSig', '공사책임자_서명', 'sig'],
  ['respSigDate', '공사책임자_서명일', 'date'],
  // 1.8.9 안전관리규정 준수 동의서 (DW-6): 해당여부는 9칸 0/1 글자, 서명 2개
  ['agreeChecks', '안전동의서_해당여부', 'text'],
  ['agreeRespSig', '안전동의서_책임자서명', 'sig'],
  ['agreeRespSigDate', '안전동의서_책임자서명일', 'date'],
  ['agreeLotteSig', '안전동의서_롯데담당자서명', 'sig'],
  ['agreeLotteSigDate', '안전동의서_롯데담당자서명일', 'date']
];

/** 주방공사가 "없음"이면 자동으로 "해당없음"이 되는 항목 */
var KITCHEN_DEPENDENT = ['waterproof', 'waterTest', 'kitchenExt', 'exhaustCmh', 'gasGrade', 'gasAlarm'];
var NOT_APPLICABLE = '해당없음';
/** 매장형태가 팝업·VP 이면 "해당없음"이 되는 항목: 주방·급배수·가스 전부 + 설비 추가·이설 수량 */
var POPUP_TYPES = ['팝업', 'VP'];
var POPUP_DEPENDENT = ['kitchen', 'waterproof', 'waterTest', 'supplyPipeA', 'drainPipeA', 'kitchenExt', 'exhaustCmh', 'gasGrade', 'gasAlarm',
  'sprReplace', 'detReplace', 'diffReplace'];
/** 이 검토서에서 해당없음 처리할 항목 */
function naKeys_(review) {
  if (POPUP_TYPES.indexOf(review.storeType) >= 0) return POPUP_DEPENDENT;
  if (review.kitchen === '없음') return KITCHEN_DEPENDENT;
  return [];
}

var REVIEW_META_COLS = [
  ['id', '검토ID'],
  ['storeId', '매장ID'],
  ['round', '차수'],
  ['status', '작성상태'],
  ['savedAt', '저장일시'],
  ['savedBy', '저장자'],
  ['chiefOk', '소장확인'],
  ['chiefOkBy', '소장확인자'],
  ['chiefOkAt', '소장확인일시']
];
/** 소장 확인은 검토서 저장과 따로 (저장할 때 지워지지 않게) */
var CHIEF_KEYS = ['chiefOk', 'chiefOkBy', 'chiefOkAt'];

var DEFAULT_RULES = [
  '공사전 **롯데 Tenant 시설공사지침, 국가화재안전기준(NFSC), 한국전기설비규정(KEC)** 등 국내 법규에 맞도록 설계 및 시공한다. 공사 완료후 상기 기준에 맞지 않게 시공된 경우 **해당 브랜드 및 공사업체에서 수정 보완**한다.',
  '공사전 **영업배상 책임보험, 설계도면 (AUTO CAD 파일), 방염서류** 제출한다. **(미제출시 준공 불가)**\n- 시설도면 : 건축평면도, 전등·전열 평면도, 전기부하계산서, 분전반 상세도, 감지기·유도등 평면도, 스프링클러 평면도, 제연설비 평면도, 공조설비 평면도, 주방배기, 도시가스, 가스경보설비 평면도\n- 방염계획도 : 평면도 및 입면도에 선처리 후처리 범위 표기, 인테리어 및 방염업체 명기',
  '**산업안전보건법 기준으로 작업**을 진행하며, 현장소장 외 별도의 안전관리자(상주) 배치후 안전 및 현장 정리정돈 청소 관리 진행한다. **용접·불티 작업시** 현장소장, 안전관리자, 불티감시자 배치후 백화점 안전팀, 시설팀 승인후 안전하게 시공한다.',
  '**공사시 발생된 폐기물 및 건축폐수(톱밥에 개워 포대에 넣어 반출)는 전량 외부 반출한다(1회/1일)**',
  '공사장 내 영상촬영이 불가하며, 미협의된 영상 무단배포시 모든 법적책임은 공사업체에서 진다.',
  '안전모 ABE형 사용, 창고 50㎡이상 제연설비 설치, 감지기 벽 또는 보에서 0.6m이상 이격 설치',
  '**매장 open일 2일 전 방재실과 소방시설 합동점검 진행한다. (방재실 사전협의 일정 조율 必)**'
];

/** 자주 쓰는 문구 분류 (시트 "자주쓰는문구" B열) */
var PHRASE_CATS = ['전기', '설비', '소방', '방염', '서류', '안전', '기타'];
var DEFAULT_PHRASES = [
  { t: '방염계획도(선처리·후처리 범위 표기) 제출 후 공사 진행할 것', c: '방염' },
  { t: '용접·불티 작업 시 불티감시자 배치 및 안전팀·시설팀 승인 후 작업할 것', c: '안전' },
  { t: '감지기는 벽 또는 보에서 0.6m 이상 이격하여 설치할 것', c: '소방' },
  { t: '오픈 2일 전 방재실과 소방시설 합동점검 일정 협의할 것', c: '소방' },
  { t: '다음 차수 검토 시 보완 도면 지참할 것', c: '서류' }
];

/** 지침 검색 비슷한 말 (시트 "비슷한말": 한 줄에 서로 같은 뜻의 말) */
var DEFAULT_SYNONYMS = [
  ['스프링클러', 'SP, 헤드, 살수'],
  ['감지기', '감지, 디텍터'],
  ['분전반', '분전함, 판넬, 패널'],
  ['방화셔터', '셔터'],
  ['유도등', '피난구유도등, 통로유도등'],
  ['방염', '방염처리, 선처리, 후처리'],
  ['차단기', 'MCCB, ELB, 브레이커'],
  ['비상방송', '스피커, 방송'],
  ['배기', '후드, 덕트']
];

/* ───────────────────────── 웹앱 진입점 ───────────────────────── */

function doGet(e) {
  if (e && e.parameter && e.parameter.api) return blockApi_(e.parameter, null);
  var t = HtmlService.createTemplateFromFile('Index');
  // 출력물 QR: ?store=매장ID 로 열면 로그인 후 그 매장 검토서를 엶
  var store = String((e && e.parameter && e.parameter.store) || '');
  t.startStore = /^[-\w]{6,60}$/.test(store) ? store : '';
  // 원격 서명 링크: ?sign=표 → PIN 없이 그 서명 칸만
  var sign = String((e && e.parameter && e.parameter.sign) || '');
  t.signToken = /^[0-9a-f]{40,80}$/.test(sign) ? sign : '';
  return t.evaluate()
    .setTitle(APP.STORE_LABEL + ' 도면협의')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ───────── 블럭 연동 (docs/블럭_연동규칙.md) ─────────
 * 다른 블럭(업무지원 앱·전체 대시보드)이 서버끼리 부르는 통로. 웹앱 주소 + 연결 키.
 *   GET  ?api=ping                       → 블럭 이름·버전 (키 없이)
 *   GET  ?api=summary&key=…[&year=2026]   → 대시보드 카드 숫자
 *   GET  ?api=stores&key=…[&year=2026]    → 매장 목록 (하자점검 등)
 *   POST {"api":"defect","key":…,"storeId":…,"count":3,"note":"…","by":"…"} → 하자 발송 기록
 */
var BLOCK = { NAME: 'drawing-review', TITLE: '도면협의' };
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}; } catch (x) { return jsonOut_({ ok: false, error: 'JSON 형식이 아닙니다.' }); }
  return blockApi_(body, body);
}
function jsonOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function linkKey_() { return props_().getProperty('LINK_KEY') || ''; }
function sameKey_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function blockApi_(p, post) {
  try {
    var api = String(p.api || '');
    if (api === 'ping') return jsonOut_({ ok: true, block: BLOCK.NAME, title: BLOCK.TITLE, version: APP.VERSION, label: APP.STORE_LABEL });
    if (!linkKey_()) return jsonOut_({ ok: false, error: '연결 키가 아직 없습니다. 시트 메뉴 ⑥에서 만들어 주세요.' });
    if (!sameKey_(p.key, linkKey_())) return jsonOut_({ ok: false, error: '연결 키가 맞지 않습니다.' });
    if (api === 'summary') return jsonOut_(blockSummary_(p.year));
    if (api === 'stores') return jsonOut_(blockStores_(p.year));
    if (api === 'defect') {
      if (!post) return jsonOut_({ ok: false, error: '하자 발송 기록은 POST로 보내 주세요.' });
      return jsonOut_(blockDefect_(p));
    }
    return jsonOut_({ ok: false, error: '모르는 요청입니다: ' + api });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}
function storeYear_(s) {
  var m = String(s.firstDate || '').match(/^(\d{4})/); if (m) return m[1];
  m = String(s.docNo || '').match(/_(\d{2})\d{4}$/); return m ? '20' + m[1] : '';
}
function blockStoresRaw_(year) {
  var ys = String(year || '').split(',').map(function (y) { return y.trim(); }).filter(function (y) { return /^\d{4}$/.test(y); });
  return readTable_(APP.SHEETS.STORES, STORE_COLS).map(cleanStore_).filter(function (s) { return !ys.length || ys.indexOf(storeYear_(s)) >= 0; });
}
function blockSummary_(year) {
  var list = blockStoresRaw_(year), today = todayText_();
  var in7 = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), 'Asia/Seoul', 'yyyy-MM-dd');
  var spec = function (s) { try { return JSON.parse(s.specSent || '[]').length > 0; } catch (e) { return false; } };
  return {
    ok: true, block: BLOCK.NAME, title: BLOCK.TITLE, version: APP.VERSION, url: appUrl_(), link: publicUrl_(), year: year || '',
    counts: {
      total: list.length,
      ongoing: list.filter(function (s) { return s.status !== '컨펌완료'; }).length,
      confirmed: list.filter(function (s) { return s.status === '컨펌완료'; }).length,
      openIn7Days: list.filter(function (s) { return s.openDate && s.openDate >= today && s.openDate <= in7; }).length,
      chiefWaiting: list.filter(function (s) { return s.chiefOk !== 'Y'; }).length,
      specUnsent: list.filter(function (s) { return !spec(s); }).length,
      docMissing: list.filter(function (s) { return !!s.docMissing; }).length,
      defectSent: list.filter(function (s) { return !!s.defectSent; }).length,
      fireDocMissing: list.filter(fireDocMissing_).length
    },
    labels: { total: '전체 매장', ongoing: '협의중', confirmed: '컨펌완료', openIn7Days: '7일 내 오픈', chiefWaiting: '시설 소장 확인 대기', specUnsent: '시방서 미발송', docMissing: '서류 미제출', defectSent: '하자 발송', fireDocMissing: '방재실 협의서 미첨부' }
  };
}
function blockStores_(year) {
  var last = {};
  readReviews_().forEach(function (r) { if (!last[r.storeId] || r.round > last[r.storeId].round) last[r.storeId] = r; });
  var url = publicUrl_();
  return {
    ok: true, block: BLOCK.NAME, version: APP.VERSION,
    stores: blockStoresRaw_(year).map(function (s) {
      var r = last[s.id] || {};
      return {
        storeId: s.id, docNo: s.docNo, tenant: s.tenant, location: s.location, storeType: s.storeType,
        contractor: s.contractor, contractorName: r.contractorName || '', contractorTel: r.contractorTel || '', contractorEmail: r.contractorEmail || '',
        ownerCompany: r.ownerCompany || '', periodStart: s.periodStart, periodEnd: s.periodEnd, openDate: s.openDate,
        status: s.status, currentRound: s.currentRound, firstDate: s.firstDate, defectSent: s.defectSent || '',
        url: url ? publicLink_('store=' + encodeURIComponent(s.id)) : ''
      };
    })
  };
}
function blockDefect_(p) {
  var storeId = String(p.storeId || '');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    if (!found) return { ok: false, error: '매장을 찾을 수 없습니다: ' + storeId };
    var n = Number(p.count) || 0, note = String(p.note || '').slice(0, 300), by = String(p.by || '업무지원 앱').slice(0, 40);
    addSendLog_(storeId, { t: 'defect', by: by, d: '업무지원 앱 하자점검에서 발송' + (n ? ' (' + n + '건)' : '') + (note ? ' · ' + note : ''), to: String(p.to || '').slice(0, 200) });
    log_(by, '하자 발송', storeId, found.row.docNo, (n ? n + '건 ' : '') + note);
    return { ok: true, storeId: storeId, defectSent: findStore_(storeId).row.defectSent };
  } finally { lock.releaseLock(); }
}
/** 시트 메뉴 ⑥: 연결 키 보기 (없으면 만듦). 업무지원 앱·전체 대시보드 설정에 웹앱 주소와 함께 넣음 */
function showLinkKey_() {
  var ui = SpreadsheetApp.getUi(), key = linkKey_();
  if (key) {
    var r = ui.alert('블럭 연결 키', '연결 키: ' + key + '\n웹앱 주소: ' + (appUrl_() || '(배포 후 표시)') + '\n\n키를 새로 만들까요? (예를 누르면 예전 키를 쓰던 앱은 새 키로 바꿔야 합니다)', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  key = newToken_().slice(0, 40);
  props_().setProperty('LINK_KEY', key);
  ui.alert('블럭 연결 키', '새 연결 키: ' + key + '\n웹앱 주소: ' + (appUrl_() || '(배포 후 표시)') + '\n\n업무지원 앱·전체 대시보드 설정에 이 두 값을 넣어 주세요.', ui.ButtonSet.OK);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ───────────────────────── 시트 메뉴 / 초기 설정 ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('도면협의')
    .addItem('① 초기 설정 (시트 만들기)', 'setupMenu_')
    .addSeparator()
    .addItem('② PIN 설정 – 소장', 'setPinChief_')
    .addItem('② PIN 설정 – 부소장', 'setPinDeputy_')
    .addSeparator()
    .addItem('③ 자동 백업 켜기 (매일 새벽 2시)', 'enableDailyBackup_')
    .addItem('③ 자동 백업 끄기', 'backupOffMenu_')
    .addItem('지금 백업하기', 'backupNowMenu_')
    .addSeparator()
    .addItem('④ 지침 폴더 열기', 'openGuideFolder_')
    .addItem('⑤ 시방서 발송 준비 확인', 'checkSpecSetup_')
    .addSeparator()
    .addItem('⑥ 블럭 연결 키 보기 (업무지원 앱 연동)', 'showLinkKey_')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('⑦ 계정 옮기기')
      .addItem('1. [기존 계정] 소유권 넘기기 요청', 'migrateSend_')
      .addItem('2. [새 계정] 소유권 받기', 'migrateAccept_')
      .addItem('3. 이전 점검 (파일이 어느 계정 것인지)', 'migrateCheck_')
      .addItem('이어하기 예약 멈추기', 'migrateStop_'))
    .addItem('⑧ 웹앱 주소 · 바로가기 주소', 'showAddresses_')
    .addToUi();
}

function setupMenu_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  ensureSheet_(ss, APP.SHEETS.STORES, STORE_COLS.map(function (c) { return c[1]; }));
  settingsSheet_();
  ensureSheet_(ss, APP.SHEETS.REVIEWS, reviewHeaders_());
  var rules = ensureSheet_(ss, APP.SHEETS.RULES, ['순번', '문구']);
  if (rules.getLastRow() < 2) {
    rules.getRange(2, 1, DEFAULT_RULES.length, 2)
      .setValues(DEFAULT_RULES.map(function (r, i) { return [i + 1, r]; }));
  }
  rules.getRange('A1').setNote('문구 안에서 **강조할 부분**을 별표 두 개로 감싸면 빨간 굵은 글씨로 나옵니다. 줄바꿈은 셀 안에서 Alt+Enter(맥: ⌥+Enter).');
  var phr = ensureSheet_(ss, APP.SHEETS.PHRASES, ['문구', '분류']);
  if (phr.getLastRow() < 2) {
    phr.getRange(2, 1, DEFAULT_PHRASES.length, 2).setValues(DEFAULT_PHRASES.map(function (p) { return [p.t, p.c]; }));
  }
  ensureSynonyms_(ss);
  ensureSheet_(ss, APP.SHEETS.LOG, ['일시', '처리자', '작업', '매장ID', '문서번호', '내용']);
  ensureSheet_(ss, APP.SHEETS.DELETED, deletedHeaders_());

  SpreadsheetApp.getUi().alert('초기 설정이 끝났습니다.\n\n다음으로 [도면협의] 메뉴에서 소장·부소장 PIN을 설정한 뒤 웹앱으로 배포하세요.');
}

function setPinChief_() { setPinFor_('소장'); }
function setPinDeputy_() { setPinFor_('부소장'); }

function setPinFor_(role) {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(role + ' PIN 설정', '숫자 4~8자리 PIN을 입력하세요. (웹앱 로그인에 사용)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pin = String(res.getResponseText() || '').trim();
  if (!/^\d{4,8}$/.test(pin)) {
    ui.alert('PIN은 숫자 4~8자리로 입력해 주세요.');
    return;
  }
  // PIN으로 사람을 구분하므로 소장·부소장 PIN은 서로 달라야 함
  var other = APP.ROLES.filter(function (r) { return r !== role; })[0];
  if (other && PropertiesService.getScriptProperties().getProperty('PIN_' + other) === hash_(pin)) {
    ui.alert(other + ' PIN과 같습니다. PIN으로 소장·부소장을 구분하므로 다른 PIN을 정해 주세요.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('PIN_' + role, hash_(pin));
  ui.alert(role + ' PIN이 설정되었습니다. 이 PIN으로 기억해 둔 기기는 다음 접속 때 새 PIN을 한 번 입력합니다.');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  ensureSize_(sh, 1, headers.length + 2);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].filter(String);
  if (existing.length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // 새로 추가된 열만 뒤에 덧붙임 (기존 데이터 보존)
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#EEF1F4');
  // 날짜·번호를 글자 그대로 저장
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  return sh;
}

/** 코드에 새 항목이 생기면 이미 쓰고 있는 시트 끝에 열을 자동으로 추가 */
function ensureHeaders_(name, headers) {
  var sh = ss_().getSheetByName(name);
  if (!sh) return;
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
  if (!missing.length) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSize_(sh, 1, lastCol + missing.length);
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#EEF1F4');
    sh.getRange(1, lastCol + 1, sh.getMaxRows(), missing.length).setNumberFormat('@');
  } finally {
    lock.releaseLock();
  }
}

/** 시트의 행·열 수가 모자라면 늘림 (구글시트 기본 1000행 × 26열) */
function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows() + 200);
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

function reviewHeaders_() {
  return REVIEW_META_COLS.map(function (c) { return c[1]; })
    .concat(FIELDS.map(function (f) { return f[1]; }));
}

/* ───────────────────────── 인증 ───────────────────────── */

function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'drawing-review:' + s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* 1.8.5 PIN 틀린 횟수 (결정 39): 기기와 상관없이 10분 안에 20번 틀리면 10분 동안 PIN 입력을 모두 막음.
   1.8.6 (결정 41): 6시간 안에 3번째 잠금부터는 1시간 — 잠금이 풀릴 때마다 다시 20번씩 시도하는 것을 늦춤.
   기기에 기억된 로그인(token)은 막지 않음 → 남이 일부러 틀려도 소장·부소장 기기는 그대로 열림 */
var PIN_FAIL_MAX = 20, PIN_FAIL_MS = 600000, PIN_LOCK_LONG_MS = 3600000, PIN_LOCK_WINDOW_MS = 6 * 3600000;
function pinGate_() {
  var v = {}; try { v = JSON.parse(props_().getProperty('PIN_FAIL') || '{}') || {}; } catch (e) { v = {}; }
  if (v.lock && v.lock > Date.now()) throw new Error('PIN이 여러 번 틀려 ' + Math.ceil((v.lock - Date.now()) / 60000) + '분 동안 PIN 입력을 막았습니다. 잠시 뒤 다시 해 주세요.');
  return v;
}
function pinFail_(v, msg) {
  var now = Date.now();
  var locks = v.lt && now - v.lt < PIN_LOCK_WINDOW_MS ? v.locks || 0 : 0, lt = locks ? v.lt : 0;
  if (!v.t || now - v.t > PIN_FAIL_MS) v = { n: 0, t: now };
  v.n = (v.n || 0) + 1;
  v.locks = locks; v.lt = lt;
  if (v.n >= PIN_FAIL_MAX) {
    locks++;
    var ms = locks >= 3 ? PIN_LOCK_LONG_MS : PIN_FAIL_MS;
    v = { n: 0, t: now, lock: now + ms, locks: locks, lt: lt || now };
    log_('보안', 'PIN 입력 잠금', '', '', '10분 안에 ' + PIN_FAIL_MAX + '번 틀림 · ' + (ms / 60000) + '분 잠금 (6시간 안 ' + locks + '번째)');
  }
  props_().setProperty('PIN_FAIL', JSON.stringify(v));
  return new Error(msg);
}

function auth_(a) {
  if (a && !a.role && !a.token && a.pin != null) {
    // 1.7: PIN만 입력 → 맞는 사람(소장/부소장)을 찾음
    var gate = pinGate_();
    var props = PropertiesService.getScriptProperties(), h = hash_(String(a.pin)), any = false;
    for (var i = 0; i < APP.ROLES.length; i++) {
      var sv = props.getProperty('PIN_' + APP.ROLES[i]);
      if (sv) any = true;
      if (sv && sv === h) { a.role = APP.ROLES[i]; return a.role; }
    }
    if (any) throw pinFail_(gate, 'PIN이 맞지 않습니다.');
    throw new Error('PIN이 아직 설정되지 않았습니다. 시트의 [도면협의] 메뉴에서 PIN을 설정해 주세요.');
  }
  if (!a || APP.ROLES.indexOf(a.role) < 0) throw new Error('로그인이 필요합니다.');
  var saved = PropertiesService.getScriptProperties().getProperty('PIN_' + a.role);
  if (!saved) throw new Error(a.role + ' PIN이 아직 설정되지 않았습니다. 시트의 [도면협의] 메뉴에서 PIN을 설정해 주세요.');
  if (a.token) {
    // 기기에 기억한 로그인: PIN을 바꾸면 예전 기억은 더 이상 통하지 않음
    if (String(a.token) !== loginToken_(a.role, saved)) throw new Error('PIN이 바뀌었습니다. 새 PIN으로 다시 로그인해 주세요.');
    return a.role;
  }
  var g = pinGate_();
  if (hash_(String(a.pin || '')) !== saved) throw pinFail_(g, 'PIN이 맞지 않습니다.');
  return a.role;
}

/** 이 기기 기억용 표: 역할 + 저장된 PIN으로 만듦 (PIN 자체는 기기에 남기지 않음) */
function loginToken_(role, saved) {
  return hash_('token:' + role + ':' + saved);
}
function tokenFor_(role) {
  return loginToken_(role, PropertiesService.getScriptProperties().getProperty('PIN_' + role));
}

/* ───────────────────────── 공용 API (웹앱에서 호출) ───────────────────────── */

function apiLogin(a) {
  var role = auth_(a);
  return { role: role, token: tokenFor_(role) };
}

/** 첫 화면에 필요한 것 한 번에: 로그인 확인 + 설정 + 매장 목록 (서버 왕복 3번 → 1번) */
function apiStart(a) {
  var role = auth_(a);
  var boot = apiBootstrap(a);
  return { role: role, token: tokenFor_(role), boot: boot, stores: readTable_(APP.SHEETS.STORES, STORE_COLS).map(cleanStore_) };
}

/** 시트 열 추가·문구 변경 같은 준비 작업은 버전이 바뀔 때 한 번만 */
function ensureSchema_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA_VER') === APP.VERSION) return;
  ensureHeaders_(APP.SHEETS.REVIEWS, reviewHeaders_());
  ensureHeaders_(APP.SHEETS.STORES, STORE_COLS.map(function (c) { return c[1]; }));
  ensureHeaders_(APP.SHEETS.DELETED, deletedHeaders_());
  migrateRules_();
  ensureHeaders_(APP.SHEETS.PHRASES, ['문구', '분류']);
  ensureSynonyms_(ss_());
  backfillStores_();
  props.setProperty('SCHEMA_VER', APP.VERSION);
}

function apiBootstrap(a) {
  auth_(a);
  ensureSchema_();
  return {
    version: APP.VERSION,
    appUrl: appUrl_(),
    publicUrl: publicUrl_(),
    guide: guideUrls_(),
    phraseCats: PHRASE_CATS,
    synonyms: readSynonyms_(),
    storeLabel: APP.STORE_LABEL,
    docPrefix: APP.DOC_PREFIX,
    fields: FIELDS,
    rules: readRules_(),
    phrases: readPhrases_(),
    guides: guidesForClient_(),
    signature: APP.SPEC_SIGNATURE || [],
    specFrom: APP.SPEC_FROM,
    specFromName: APP.SPEC_FROM_NAME,
    sigEmails: (function () { try { return JSON.parse(props_().getProperty('SIG_EMAILS') || '{}') || {}; } catch (e) { return {}; } })()
  };
}

/** 업체명 자동완성 목록 (검토서를 열 때마다 최신으로) */
function apiCompanies(a) {
  auth_(a);
  return readCompanies_();
}

/** 검색 결과 미리보기용 지침 쪽 이미지 (data URL). 이미지가 없으면 null */
function apiGuidePage(a, guideId, page) {
  auth_(a);
  var map = guidePageMap_(guideId);
  var id = map && map[String(Number(page))];
  if (!id) return null;
  var blob = DriveApp.getFileById(id).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/** 지침 검색 색인 — 드라이브 지침 폴더의 _검색색인 (웹앱 지침 관리에서 만듦) */
function apiGuideIndex(a) {
  auth_(a);
  var data = guideData_();
  return data ? data.index : [];
}

function apiListStores(a) {
  auth_(a);
  return readTable_(APP.SHEETS.STORES, STORE_COLS).map(cleanStore_);
}

/** 매장 정보 + 모든 차수 검토서 */
function apiGetStore(a, storeId) {
  auth_(a);
  var store = findStore_(storeId);
  if (!store) throw new Error('매장을 찾을 수 없습니다.');
  var reviews = readReviews_().filter(function (r) { return r.storeId === storeId; })
    .sort(function (x, y) { return x.round - y.round; });
  return { store: cleanStore_(store.row), reviews: reviews };
}

/**
 * 검토서 저장. review.storeId 가 비어 있으면 새 매장(1차)을 만들고 문서번호를 부여합니다.
 * finalize=true 이면 작성상태를 "검토완료"로 저장합니다.
 */
function apiSaveReview(a, review, finalize) {
  var role = auth_(a);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = nowText_();
    var data = sanitizeReview_(review);
    var store;
    var cid = /^c-[\w-]{6,60}$/.test(String(review.clientId || '')) ? String(review.clientId) : '';
    var storeId = review.storeId || (cid && findStore_(cid) ? cid : '');
    if (!storeId) {
      store = createStore_(data, now, cid);
      data.round = 1;
    } else {
      var found = findStore_(storeId);
      if (!found) throw new Error('매장을 찾을 수 없습니다.');
      store = found.row;
      if (store.status === '컨펌완료') throw new Error('컨펌완료된 매장입니다. 대시보드에서 컨펌완료를 취소한 뒤 수정해 주세요.');
      data.round = Number(review.round) || 1;
    }
    keepRemoteSigs_(data, store.id, review._sigCleared);
    data.storeId = store.id;
    data.status = finalize ? '검토완료' : (review.status === '검토완료' ? '검토완료' : '작성중');
    data.savedAt = now;
    data.savedBy = role;
    upsertReview_(data);
    syncStoreFromReviews_(store.id, now);
    log_(role, finalize ? '검토완료 저장' : '저장', store.id, store.docNo, data.round + '차');
    return apiGetStore(a, store.id);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 출력물 PDF를 드라이브 "도면협의_출력/문서번호" 폴더에 저장 (아이패드 인쇄·공유용).
 * 같은 이름이 있으면 새 파일로 바꿈. dataUri = 'data:application/pdf;...base64,...'
 */
function apiSavePdf(a, storeId, round, name, dataUri, auto) {
  var role = auth_(a);
  var found = findStore_(storeId);
  if (!found) throw new Error('매장을 찾을 수 없습니다.');
  var file = savePdfFile_(found, round, name, dataUri);
  log_(role, auto ? 'PDF 자동 보관' : 'PDF 드라이브 저장', storeId, found.row.docNo, file.getName());
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { addSendLog_(storeId, { t: 'pdf', by: role, round: Number(round), d: Number(round) + '차 ' + (auto ? '검토 완료 → 드라이브 자동 보관' : '드라이브 저장'), url: file.getUrl() }); }
  finally { lock.releaseLock(); }
  return { url: file.getUrl(), name: file.getName(), folder: APP.PDF_FOLDER + '/' + found.row.docNo, store: cleanStore_(findStore_(storeId).row) };
}

/* ───────────────────────── 특이사항 사진 ───────────────────────── */

/** 사진 목록(JSON) 검사: 최대 10장, 숫자·파일 ID 형식만 */
function sanitizePhotos_(v) {
  if (!v) return '';
  var list;
  try { list = JSON.parse(v); } catch (e) { return ''; }
  if (!Array.isArray(list)) return '';
  var num = function (x, lo, hi) { x = Number(x); return isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x * 10) / 10)) : 0; };
  var out = list.filter(function (p) { return p && /^[-\w]{10,80}$/.test(String(p.f || '')); }).slice(0, APP.PHOTO_MAX).map(function (p) {
    return { id: String(p.id || '').replace(/[^\w-]/g, '').slice(0, 24), f: String(p.f), a: num(p.a, 0, 20000), x: num(p.x, -5000, 5000), y: num(p.y, -5000, 20000),
      w: num(p.w, 20, 2000), h: num(p.h, 20, 4000), r: [0, 90, 180, 270].indexOf(Number(p.r)) >= 0 ? Number(p.r) : 0 };
  });
  return out.length ? JSON.stringify(out) : '';
}

function photoRoot_() { return appFolder_('photo'); }

/* ───────── 앱 폴더 4개: ID로 찾기 (1.8.3) ─────────
 * 처음 한 번만 이름으로 찾고(내 소유 폴더 우선), 찾은 폴더 ID를 스크립트 속성에 기억합니다.
 * 그 뒤로는 ID로 찾으므로 폴더를 옮기거나 이름이 같은 폴더가 더 생겨도 헷갈리지 않습니다. */
function folderDef_(k) {
  return { photo: ['FOLDER_PHOTO', APP.PHOTO_FOLDER], pdf: ['FOLDER_PDF', APP.PDF_FOLDER],
    backup: ['FOLDER_BACKUP', APP.BACKUP_FOLDER], guide: ['GUIDE_FOLDER', GUIDE.FOLDER] }[k];
}
function myEmail_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}
function ownerEmail_(item) {
  try { var o = item.getOwner(); return o ? String(o.getEmail() || '').toLowerCase() : ''; } catch (e) { return ''; }
}
/** noCreate = true 이면 없을 때 만들지 않고 null */
function appFolder_(k, noCreate) {
  var d = folderDef_(k), p = props_(), id = p.getProperty(d[0]);
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 지워졌거나 권한 없음 → 이름으로 다시 찾기 */ }
  }
  var it = DriveApp.getFoldersByName(d[1]), me = myEmail_(), mine = null, other = null;
  while (it.hasNext()) {
    var c = it.next();
    if (c.isTrashed()) continue;
    if (me && ownerEmail_(c) === me) { if (!mine) mine = c; } else if (!other) other = c;
  }
  var folder = mine || other;
  if (!folder) { if (noCreate) return null; folder = DriveApp.createFolder(d[1]); }
  p.setProperty(d[0], folder.getId());
  return folder;
}

/** 사진 올리기: 드라이브 "도면협의_사진/문서번호" 폴더. dataUrl = 'data:image/jpeg;base64,...' (브라우저에서 줄여서 보냄) */
function apiUploadPhoto(a, storeId, round, dataUrl) {
  var role = auth_(a);
  var found = findStore_(storeId);
  if (!found) throw new Error('먼저 검토서를 저장해 주세요.');
  var m = String(dataUrl || '').match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) throw new Error('사진 형식이 올바르지 않습니다.');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('사진이 너무 큽니다.');
  var root = photoRoot_();
  var subIt = root.getFoldersByName(found.row.docNo), sub = subIt.hasNext() ? subIt.next() : root.createFolder(found.row.docNo);
  var name = (Number(round) || 1) + '차_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000) + (m[1] === 'png' ? '.png' : '.jpg');
  var file = sub.createFile(Utilities.newBlob(bytes, 'image/' + m[1], name));
  log_(role, '사진 첨부', storeId, found.row.docNo, name);
  return { fileId: file.getId(), name: name };
}

/** 사진 보기 (data URL). 도면협의_사진 폴더 안의 파일만 */
function apiPhoto(a, fileId) {
  auth_(a);
  var file;
  try { file = DriveApp.getFileById(String(fileId)); } catch (e) { return null; }
  var rootId = photoRoot_().getId(), ok = false, ps = file.getParents();
  while (ps.hasNext() && !ok) {
    var sub = ps.next(); if (sub.getId() === rootId) ok = true;
    var gp = sub.getParents();
    while (gp.hasNext()) if (gp.next().getId() === rootId) ok = true;
  }
  if (!ok) throw new Error('도면협의 사진만 볼 수 있습니다.');
  var blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ───────── 종합방재실 협의서 (매장마다 1장, 1.8.2) ───────── */
var FIRE_DOC_ROT = [0, 90, 180, 270];
function fireDocOf_(s) {
  try { var d = JSON.parse(String((s && s.fireDoc) || '')); return d && d.f ? d : null; } catch (e) { return null; }
}
/** 대시보드 할 일: 소방 점검 7일 전부터, 오픈 전까지, 협의서가 없으면 */
function fireDocMissing_(s) {
  if (fireDocOf_(s) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.fireCheckDate || ''))) return false;
  var today = todayText_(), in7 = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), 'Asia/Seoul', 'yyyy-MM-dd');
  if (s.fireCheckDate > in7) return false;
  return !(s.openDate && s.openDate < today);
}
/** 올리기: 드라이브 도면협의_사진/문서번호/YYYY-MM-DD_방재실협의서-테넌트명_001.jpg. 다시 올리면 예전 파일은 휴지통 */
function apiFireDocUpload(a, storeId, dataUrl) {
  var role = auth_(a);
  var m = String(dataUrl || '').match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) throw new Error('사진 형식이 올바르지 않습니다.');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('사진이 너무 큽니다.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    if (!found) throw new Error('먼저 검토서를 저장해 주세요.');
    var old = fireDocOf_(found.row);
    var root = photoRoot_();
    var subIt = root.getFoldersByName(found.row.docNo), sub = subIt.hasNext() ? subIt.next() : root.createFolder(found.row.docNo);
    var work = ('방재실협의서-' + String(found.row.tenant || '매장')).replace(/[\s\/\\:*?"<>|_#%&{}$!'@+`=]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    var name = todayText_() + '_' + work + '_001' + (m[1] === 'png' ? '.png' : '.jpg');
    var file = sub.createFile(Utilities.newBlob(bytes, 'image/' + m[1], name));
    try { file.setDescription('종합방재실 협의서 · ' + (found.row.tenant || '') + ' · ' + found.row.docNo); } catch (e) { /* 설명은 없어도 됨 */ }
    var info = { f: file.getId(), at: nowText_(), by: role, r: 0, name: name };
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, { fireDoc: JSON.stringify(info) });
    if (old) { try { DriveApp.getFileById(old.f).setTrashed(true); } catch (e) { /* 이미 없음 */ } }   // 시트를 고친 뒤 옛 파일을 버림
    log_(role, old ? '방재실 협의서 다시 올림' : '방재실 협의서 올림', storeId, found.row.docNo, name);
  } finally {
    lock.releaseLock();
  }
  return apiGetStore(a, storeId);
}
/** 보기: 그 매장의 협의서만 (data URL + 돌린 방향) */
function apiFireDoc(a, storeId) {
  auth_(a);
  var found = findStore_(storeId);
  var d = found && fireDocOf_(found.row);
  if (!d) throw new Error('올린 종합방재실 협의서가 없습니다.');
  var blob;
  try { blob = DriveApp.getFileById(d.f).getBlob(); } catch (e) { throw new Error('협의서 파일을 찾을 수 없습니다. 다시 올려 주세요.'); }
  return { url: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()), r: FIRE_DOC_ROT.indexOf(Number(d.r)) >= 0 ? Number(d.r) : 0, f: d.f };
}
/** 돌린 방향 기억 */
function apiFireDocRotate(a, storeId, r) {
  auth_(a);
  r = Number(r);
  if (FIRE_DOC_ROT.indexOf(r) < 0) throw new Error('방향 값이 올바르지 않습니다.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    var d = found && fireDocOf_(found.row);
    if (!d) throw new Error('올린 종합방재실 협의서가 없습니다.');
    d.r = r;
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, { fireDoc: JSON.stringify(d) });
  } finally {
    lock.releaseLock();
  }
  return { r: r };
}
/** 지우기: 파일은 휴지통, 매장 칸 비움 */
function apiFireDocDelete(a, storeId) {
  var role = auth_(a);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    var d = found && fireDocOf_(found.row);
    if (!d) throw new Error('올린 종합방재실 협의서가 없습니다.');
    try { DriveApp.getFileById(d.f).setTrashed(true); } catch (e) { /* 이미 없음 */ }
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, { fireDoc: '' });
    log_(role, '방재실 협의서 지움', storeId, found.row.docNo, d.name || '');
  } finally {
    lock.releaseLock();
  }
  return apiGetStore(a, storeId);
}

/** 다음 차수 만들기: 직전 차수 내용을 복사(특이사항·서명·검토일 제외) */
function apiNextRound(a, storeId) {
  var role = auth_(a);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    if (!found) throw new Error('매장을 찾을 수 없습니다.');
    if (found.row.status === '컨펌완료') throw new Error('컨펌완료된 매장은 다음 차수를 만들 수 없습니다.');
    var reviews = readReviews_().filter(function (r) { return r.storeId === storeId; })
      .sort(function (x, y) { return x.round - y.round; });
    var last = reviews[reviews.length - 1] || {};
    var next = {};
    FIELDS.forEach(function (f) { next[f[0]] = last[f[0]] || ''; });
    ['notes', 'notesPhotos', 'rulesAck', 'safetySig', 'salesSig', 'respSig', 'safetySigDate', 'salesSigDate', 'respSigDate',
      'agreeChecks', 'agreeRespSig', 'agreeRespSigDate', 'agreeLotteSig', 'agreeLotteSigDate'].forEach(function (k) { next[k] = ''; });
    next.reviewDate = todayText_();
    next.id = Utilities.getUuid();
    next.storeId = storeId;
    next.round = (Number(last.round) || 0) + 1;
    next.status = '작성중';
    next.savedAt = nowText_();
    next.savedBy = role;
    upsertReview_(next);
    syncStoreFromReviews_(storeId, next.savedAt);
    log_(role, '다음 차수 생성', storeId, found.row.docNo, next.round + '차');
    return apiGetStore(a, storeId);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 검토서(매장) 통째로 삭제. 컨펌완료된 매장은 먼저 컨펌완료를 취소해야 합니다.
 * 모든 차수는 "삭제보관" 탭으로 옮기고, 드라이브의 이 매장 사진·PDF 폴더는 휴지통으로 보냅니다(30일 안에 되살리기 가능).
 * 문서번호 일련번호는 다시 쓰지 않습니다.
 */
function apiDeleteStore(a, storeId) {
  var role = auth_(a);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var docNo;
  try {
    var found = findStore_(storeId);
    if (!found) throw new Error('이미 삭제된 검토서입니다.');
    if (found.row.status === '컨펌완료') throw new Error('컨펌완료된 매장은 삭제할 수 없습니다. 대시보드에서 컨펌완료를 먼저 취소해 주세요.');
    docNo = found.row.docNo;
    // 번호를 다시 쓰지 않도록 지금까지의 가장 큰 번호를 기억
    var props = PropertiesService.getScriptProperties();
    var maxSeq = readTable_(APP.SHEETS.STORES, STORE_COLS).reduce(function (m, r) { return Math.max(m, Number(r.seq) || 0); }, 0);
    props.setProperty('LAST_SEQ', String(Math.max(maxSeq, Number(props.getProperty('LAST_SEQ')) || 0)));
    var reviews = readReviews_().filter(function (r) { return r.storeId === storeId; }).sort(function (x, y) { return y._row - x._row; });
    var src = sheet_(APP.SHEETS.REVIEWS), hi = headerIndex_(src);
    var dst = ss_().getSheetByName(APP.SHEETS.DELETED) || ensureSheet_(ss_(), APP.SHEETS.DELETED, deletedHeaders_());
    var dhi = headerIndex_(dst);
    var when = nowText_();
    reviews.slice().reverse().forEach(function (rv) {
      var vals = src.getRange(rv._row, 1, 1, hi.headers.length).getValues()[0];
      var out = dhi.headers.map(function () { return ''; });
      hi.headers.forEach(function (h, i) { if (h && dhi.map[h] != null) out[dhi.map[h]] = vals[i]; });
      out[dhi.map['삭제일시']] = when;
      out[dhi.map['삭제자']] = role + ' (검토서 삭제)';
      var target = dst.getLastRow() + 1;
      ensureSize_(dst, target, out.length);
      dst.getRange(target, 1, 1, out.length).setNumberFormat('@').setValues([out.map(String)]);
    });
    reviews.forEach(function (rv) { src.deleteRow(rv._row); }); // 아래 줄부터 지워야 줄 번호가 안 밀림
    sheet_(APP.SHEETS.STORES).deleteRow(found.rowIndex);
    log_(role, '검토서 삭제', storeId, docNo, (found.row.tenant || '') + ' · ' + reviews.length + '개 차수 → 삭제보관 탭');
  } finally {
    lock.releaseLock();
  }
  // 드라이브의 이 매장 사진·PDF 폴더 → 휴지통
  ['photo', 'pdf'].forEach(function (k) {
    try {
      var root = appFolder_(k, true);
      if (!root) return;
      var subs = root.getFoldersByName(docNo);
      while (subs.hasNext()) subs.next().setTrashed(true);
    } catch (e) { /* 폴더 없음 */ }
  });
  return readTable_(APP.SHEETS.STORES, STORE_COLS).map(cleanStore_);
}

/**
 * 마지막 차수 삭제. 1차만 남았거나 컨펌완료된 매장은 삭제할 수 없습니다.
 * 삭제한 차수는 "삭제보관" 탭으로 옮겨 보관하고 변경기록을 남깁니다.
 */
function apiDeleteLastRound(a, storeId) {
  var role = auth_(a);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    if (!found) throw new Error('매장을 찾을 수 없습니다.');
    if (found.row.status === '컨펌완료') throw new Error('컨펌완료된 매장은 차수를 삭제할 수 없습니다.');
    var reviews = readReviews_().filter(function (r) { return r.storeId === storeId; })
      .sort(function (x, y) { return x.round - y.round; });
    if (reviews.length <= 1) throw new Error('1차만 남은 매장은 차수를 삭제할 수 없습니다.');
    var last = reviews[reviews.length - 1];
    var src = sheet_(APP.SHEETS.REVIEWS);
    var hi = headerIndex_(src);
    var rowValues = src.getRange(last._row, 1, 1, hi.headers.length).getValues()[0];
    var dst = ss_().getSheetByName(APP.SHEETS.DELETED) || ensureSheet_(ss_(), APP.SHEETS.DELETED, deletedHeaders_());
    var dhi = headerIndex_(dst);
    var out = dhi.headers.map(function () { return ''; });
    hi.headers.forEach(function (h, i) { if (h && dhi.map[h] != null) out[dhi.map[h]] = rowValues[i]; });
    out[dhi.map['삭제일시']] = nowText_();
    out[dhi.map['삭제자']] = role;
    var target = dst.getLastRow() + 1;
    ensureSize_(dst, target, out.length);
    dst.getRange(target, 1, 1, out.length).setNumberFormat('@').setValues([out.map(String)]);
    src.deleteRow(last._row);
    syncStoreFromReviews_(storeId, nowText_());
    log_(role, '차수 삭제', storeId, found.row.docNo, last.round + '차 (검토일 ' + (last.reviewDate || '-') + ') → 삭제보관 탭');
    return apiGetStore(a, storeId);
  } finally {
    lock.releaseLock();
  }
}

/** 컨펌완료 처리 / 취소 (소장·부소장 로그인 필요) */
/** 9번 소장 확인: 소장만, 차수마다, 컨펌완료로 잠긴 검토서도 가능 */
function apiSetChiefOk(a, storeId, round, on) {
  var role = auth_(a);
  if (role !== '소장') throw new Error('소장 확인은 소장 PIN으로 접속했을 때만 할 수 있습니다.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    if (!found) throw new Error('매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.');
    var rv = readReviews_().filter(function (r) { return r.storeId === storeId && Number(r.round) === Number(round); })[0];
    if (!rv) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
    var now = nowText_();
    writeRowPatch_(APP.SHEETS.REVIEWS, reviewCols_(), rv._row, on ? { chiefOk: 'Y', chiefOkBy: role, chiefOkAt: now } : { chiefOk: '', chiefOkBy: '', chiefOkAt: '' });
    syncStoreFromReviews_(storeId, now);
    log_(role, on ? '소장 확인' : '소장 확인 취소', storeId, found.row.docNo, Number(round) + '차');
    return apiGetStore(a, storeId);
  } finally {
    lock.releaseLock();
  }
}

function apiSetConfirmed(a, storeId, confirmed) {
  var role = auth_(a);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findStore_(storeId);
    if (!found) throw new Error('매장을 찾을 수 없습니다.');
    var now = nowText_();
    var patch = confirmed
      ? { status: '컨펌완료', confirmedBy: role, confirmedAt: now, updatedAt: now }
      : { status: '협의중', confirmedBy: '', confirmedAt: '', updatedAt: now };
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, patch);
    log_(role, confirmed ? '컨펌완료' : '컨펌완료 취소', storeId, found.row.docNo, '');
    return apiListStores(a);
  } finally {
    lock.releaseLock();
  }
}

/* ───────────────────────── 내부 처리 ───────────────────────── */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" 시트가 없습니다. 시트의 [도면협의 > 초기 설정]을 먼저 실행해 주세요.');
  return sh;
}

function headerIndex_(sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) { if (h) map[String(h)] = i; });
  return { headers: headers, map: map };
}

/** cols: [[키, 헤더]] 목록으로 시트 전체를 객체 배열로 읽음 */
function readTable_(name, cols) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var hi = headerIndex_(sh);
  var values = sh.getRange(2, 1, last - 1, hi.headers.length).getDisplayValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c) {
      var idx = hi.map[c[1]];
      o[c[0]] = idx == null ? '' : row[idx];
    });
    return o;
  }).filter(function (o) { return o.id; });
}

function writeRowPatch_(name, cols, rowIndex, patch) {
  var sh = sheet_(name);
  var hi = headerIndex_(sh);
  cols.forEach(function (c) {
    if (!(c[0] in patch)) return;
    var idx = hi.map[c[1]];
    if (idx == null) return;
    sh.getRange(rowIndex, idx + 1).setValue(noFormula_(patch[c[0]]));
  });
}

/** 시트에 쓰는 글자가 = + - @ 로 시작하면 앞에 ' 를 붙여 수식이 되지 않게 함 (읽을 때 ' 는 안 보임).
 *  원격 서명 링크를 받은 바깥 사람이 이름 칸에 수식을 넣어 시트 내용을 빼 가는 것을 막음 (결정 41, DW-4 일부) */
function noFormula_(v) {
  v = v == null ? '' : String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function writeFullRow_(name, cols, rowIndex, obj) {
  var sh = sheet_(name);
  ensureSize_(sh, rowIndex, 1);
  var hi = headerIndex_(sh);
  var row = rowIndex <= sh.getLastRow()
    ? sh.getRange(rowIndex, 1, 1, hi.headers.length).getValues()[0]
    : hi.headers.map(function () { return ''; });
  cols.forEach(function (c) {
    var idx = hi.map[c[1]];
    if (idx == null || !(c[0] in obj)) return;
    row[idx] = noFormula_(obj[c[0]]);
  });
  sh.getRange(rowIndex, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

function reviewCols_() {
  return REVIEW_META_COLS.concat(FIELDS.map(function (f) { return [f[0], f[1]]; }));
}

function readReviews_() {
  return readTable_(APP.SHEETS.REVIEWS, reviewCols_()).map(function (r) {
    r.round = Number(r.round) || 1;
    r.rulesAck = r.rulesAck === 'Y';
    r.chiefOk = r.chiefOk === 'Y';
    return r;
  });
}

function upsertReview_(data) {
  var existing = readReviews_().filter(function (r) {
    return r.storeId === data.storeId && Number(r.round) === Number(data.round);
  })[0];
  var obj = {};
  reviewCols_().forEach(function (c) { obj[c[0]] = data[c[0]]; });
  obj.rulesAck = data.rulesAck ? 'Y' : '';
  CHIEF_KEYS.forEach(function (k) {
    if (data[k] !== undefined) return;
    if (existing) obj[k] = k === 'chiefOk' ? (existing.chiefOk ? 'Y' : '') : existing[k]; else delete obj[k];
  });
  if (existing) {
    obj.id = existing.id;
    writeFullRow_(APP.SHEETS.REVIEWS, reviewCols_(), existing._row, obj);
  } else {
    obj.id = data.id || Utilities.getUuid();
    var sh = sheet_(APP.SHEETS.REVIEWS);
    writeFullRow_(APP.SHEETS.REVIEWS, reviewCols_(), sh.getLastRow() + 1, obj);
  }
}

function findStore_(storeId) {
  var rows = readTable_(APP.SHEETS.STORES, STORE_COLS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === storeId) return { row: rows[i], rowIndex: rows[i]._row };
  }
  return null;
}

/** 새 매장: 매장마다 일련번호 1개, 문서번호 = 에비뉴엘컨펌_###_최초등록일(YYMMDD) */
function createStore_(data, now, id) {
  var rows = readTable_(APP.SHEETS.STORES, STORE_COLS);
  var maxSeq = rows.reduce(function (m, r) { return Math.max(m, Number(r.seq) || 0); }, 0);
  // 삭제한 매장 번호는 다시 쓰지 않음: 마지막으로 발급한 번호를 따로 기억
  var props = PropertiesService.getScriptProperties();
  var seq = Math.max(maxSeq, Number(props.getProperty('LAST_SEQ')) || 0) + 1;
  props.setProperty('LAST_SEQ', String(seq));
  var firstDate = data.reviewDate || todayText_();
  var yymmdd = firstDate.replace(/-/g, '').slice(2, 8);
  var store = {
    id: id || Utilities.getUuid(),
    seq: seq,
    docNo: APP.DOC_PREFIX + '_' + String(seq).padStart(3, '0') + '_' + yymmdd,
    firstDate: firstDate,
    status: '협의중',
    updatedAt: now
  };
  var sh = sheet_(APP.SHEETS.STORES);
  writeFullRow_(APP.SHEETS.STORES, STORE_COLS, sh.getLastRow() + 1, store);
  return store;
}

/** 매장 목록에 보이는 요약 정보를 최신 차수 기준으로 갱신 */
function syncStoreFromReviews_(storeId, now) {
  var found = findStore_(storeId);
  if (!found) return;
  var reviews = readReviews_().filter(function (r) { return r.storeId === storeId; })
    .sort(function (x, y) { return x.round - y.round; });
  var last = reviews[reviews.length - 1];
  if (!last) return;
  writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, {
    tenant: last.tenant,
    location: last.location,
    storeType: last.storeType,
    contractor: last.contractorCompany,
    openDate: last.openDate,
    periodStart: last.periodStart,
    periodEnd: last.periodEnd,
    fireCheckDate: last.fireCheckDate,
    chiefOk: last.chiefOk ? 'Y' : '',
    docMissing: docMissing_(last).join(', '),
    currentRound: last.round,
    lastReviewDate: last.reviewDate,
    updatedAt: now
  });
}

/* ───────── 원격 서명 ───────── */
var SIG_WHO = {
  safety: { l: '안전관리팀', name: 'safetyName', tel: 'safetyTel', sig: 'safetySig', date: 'safetySigDate', org: '롯데쇼핑' },
  sales: { l: '영업팀', name: 'salesName', tel: 'salesTel', sig: 'salesSig', date: 'salesSigDate', org: '롯데쇼핑' },
  resp: { l: '인테리어 공사 책임자', name: 'respName', tel: 'respTel', sig: 'respSig', date: 'respSigDate', orgKey: 'respOrg' }
};
var SIG_DAYS = 7;
/**
 * 화면을 열어 둔 사이에 원격 서명이 들어왔을 수 있음: 보낸 값이 비어 있으면 시트의 서명·성명·연락처를 지우지 않음
 * (화면에서 「서명 삭제」를 누른 칸은 cleared 에 들어와서 지움)
 */
function keepRemoteSigs_(data, storeId, cleared) {
  var ex = reviewOf_(storeId, data.round); if (!ex) return;
  cleared = Array.isArray(cleared) ? cleared : [];
  Object.keys(SIG_WHO).forEach(function (w) {
    var c = SIG_WHO[w];
    if (!data[c.sig] && ex[c.sig] && cleared.indexOf(c.sig) < 0) { data[c.sig] = ex[c.sig]; data[c.date] = ex[c.date]; }
    if (!data[c.name] && ex[c.name]) data[c.name] = ex[c.name];
    if (!data[c.tel] && ex[c.tel]) data[c.tel] = ex[c.tel];
  });
}
function sigPendingMap_(store) {
  try { var v = JSON.parse(store.sigPending || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function sigKey_(token) { return 'SIGT_' + hash_('sig:' + token).slice(0, 40); }
function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase(); }
function cleanSigTokens_() {
  var props = props_(), all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('SIGT_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}
/** 드라이브 도면협의_출력/문서번호 폴더에 PDF 저장 (같은 이름은 새 파일로 바꿈) */
function savePdfFile_(found, round, name, dataUri) {
  var m = String(dataUri || '').match(/^data:application\/pdf[^,]*;base64,(.+)$/);
  if (!m) throw new Error('PDF 내용이 올바르지 않습니다.');
  var bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 40 * 1024 * 1024) throw new Error('PDF가 너무 큽니다.');
  var fname = String(name || found.row.docNo + '_' + round + '차.pdf').replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.pdf$/i.test(fname)) fname += '.pdf';
  var root = appFolder_('pdf');
  var subIt = root.getFoldersByName(found.row.docNo), sub = subIt.hasNext() ? subIt.next() : root.createFolder(found.row.docNo);
  var old = [], it = sub.getFilesByName(fname);
  while (it.hasNext()) old.push(it.next());
  var file = sub.createFile(Utilities.newBlob(bytes, 'application/pdf', fname));   // 새 파일을 먼저 만든 뒤 옛 파일을 버림 (중간 오류에도 PDF가 남음)
  old.forEach(function (f) { f.setTrashed(true); });
  return file;
}

/**
 * 원격 서명 요청: reqs = [{who:'safety'|'sales'|'resp', email}], pdf = 지금 검토서 PDF (data URI)
 * 사람마다 링크(표)를 만들어 메일로 보냄. 표는 그 서명 칸 하나만 열고, 한 번 쓰면 끝, 7일 후 만료
 */
function apiSigRequest(a, storeId, round, reqs, pdfUri, pdfName) {
  var role = auth_(a);
  var found = findStore_(storeId);
  if (!found) throw new Error('매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.');
  var review = reviewOf_(storeId, round);
  if (!review) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
  reqs = (reqs || []).filter(function (r, i, arr) { return r && SIG_WHO[r.who] && arr.map(function (x) { return x && x.who; }).indexOf(r.who) === i; })
    .map(function (r) { return { who: r.who, email: String(r.email || '').trim() }; });
  if (!reqs.length) throw new Error('서명받을 사람을 골라 주세요.');
  reqs.forEach(function (r) { if (!okEmail_(r.email)) throw new Error(SIG_WHO[r.who].l + ' 이메일 형식이 맞지 않습니다.'); });
  if (MailApp.getRemainingDailyQuota() < reqs.length) throw new Error('오늘 보낼 수 있는 메일 수가 모자랍니다. 내일 다시 보내 주세요.');
  if (!publicUrl_()) throw new Error('웹앱 주소를 알 수 없습니다. 웹앱으로 배포한 뒤 사용해 주세요.');
  // 검토서 PDF: 드라이브에 올리고 보기 전용 링크
  var file = savePdfFile_(found, round, pdfName, pdfUri);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { throw new Error('검토서 PDF를 "링크가 있는 모든 사용자"로 공유하지 못했습니다. 드라이브 공유 설정을 확인해 주세요.'); }
  var pdfUrl = file.getUrl();
  cleanSigTokens_();
  var exp = Date.now() + SIG_DAYS * 86400000;
  var expText = Utilities.formatDate(new Date(exp), 'Asia/Seoul', 'M/d');
  var t = review.tenant || '', fromOk = true, sent = [];
  var pending = sigPendingMap_(found.row);
  reqs.forEach(function (r) {
    var c = SIG_WHO[r.who], token = newToken_(), k = round + ':' + r.who;
    if (pending[k] && pending[k].h) props_().deleteProperty(pending[k].h); // 같은 칸의 예전 링크는 끝냄
    props_().setProperty(sigKey_(token), JSON.stringify({ storeId: storeId, round: Number(round), who: r.who, email: r.email, exp: exp, pdfUrl: pdfUrl, by: role }));
    var mail = mailMake_('[' + APP.STORE_LABEL + '] ' + t + ' 공사 도면 검토서 서명 요청', [
      { t: '안녕하세요, ' + APP.STORE_LABEL + ' 시설팀입니다.' },
      { t: t + ' 공사 도면 검토서(' + Number(round) + '차) ' + c.l + ' 서명을 요청드립니다.' },
      { gap: true },
      { t: '1. 검토서 보기 :', url: pdfUrl, link: file.getName() },
      { t: '2. 서명하기 :', button: '여기를 눌러 서명하기', url: publicLink_('sign=' + token) },
      { gap: true },
      { t: '서명은 휴대폰으로 진행 가능합니다. PC에서는 마우스로 서명할 수 있습니다.', bold: true },
      { t: '링크는 ' + expText + '까지 사용할 수 있습니다.' }
    ], '');
    fromOk = mailSend_(r.email, mail) && fromOk;
    pending[k] = { at: nowText_(), to: r.email, exp: exp, h: sigKey_(token), by: role };
    sent.push(c.l + ' ' + r.email);
  });
  // 안전관리팀·영업팀 주소는 다음에 미리 채움
  var em = {}; try { em = JSON.parse(props_().getProperty('SIG_EMAILS') || '{}') || {}; } catch (e) { em = {}; }
  reqs.forEach(function (r) { if (r.who !== 'resp') em[r.who] = r.email; });
  props_().setProperty('SIG_EMAILS', JSON.stringify(em));
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var fresh = findStore_(storeId);
    var pm = sigPendingMap_(fresh.row); Object.keys(pending).forEach(function (k) { pm[k] = pending[k]; });
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, fresh.rowIndex, { sigPending: JSON.stringify(pm) });
    addSendLog_(storeId, { t: 'sigreq', by: role, round: Number(round), d: sent.join(' · ') });
    log_(role, '원격 서명 요청', storeId, fresh.row.docNo, Number(round) + '차 ' + sent.join(', '));
  } finally { lock.releaseLock(); }
  var out = apiGetStore(a, storeId); out.fromOk = fromOk; out.sigEmails = em; return out;
}

/** 서명 페이지 (PIN 없음): 표가 맞으면 그 칸 정보만 */
function signTicket_(token) {
  if (!/^[0-9a-f]{40,80}$/.test(String(token || ''))) throw new Error('서명 링크가 올바르지 않습니다.');
  var raw = props_().getProperty(sigKey_(token));
  if (!raw) throw new Error('이미 서명했거나 더 이상 쓸 수 없는 링크입니다. 시설팀에 새 링크를 요청해 주세요.');
  var tk = JSON.parse(raw);
  if (tk.exp < Date.now()) { props_().deleteProperty(sigKey_(token)); throw new Error('링크 사용 기간(7일)이 지났습니다. 시설팀에 새 링크를 요청해 주세요.'); }
  return tk;
}
function apiSignInfo(token) {
  var tk = signTicket_(token), c = SIG_WHO[tk.who];
  var found = findStore_(tk.storeId), rv = reviewOf_(tk.storeId, tk.round);
  if (!found || !rv) throw new Error('검토서를 찾을 수 없습니다. 시설팀에 문의해 주세요.');
  return {
    label: APP.STORE_LABEL, tenant: rv.tenant || '', round: tk.round, docNo: found.row.docNo, who: c.l,
    org: c.org || rv[c.orgKey] || rv.contractorCompany || '', name: rv[c.name] || '', tel: rv[c.tel] || '',
    pdfUrl: tk.pdfUrl, until: Utilities.formatDate(new Date(tk.exp), 'Asia/Seoul', 'M/d'),
    guide: guideUrls_()
  };
}
function apiSignSubmit(token, data) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var tk = signTicket_(token), c = SIG_WHO[tk.who];
    data = data || {};
    var name = String(data.name || '').trim().slice(0, 40), tel = String(data.tel || '').replace(/[^\d-]/g, '').slice(0, 13), sig = String(data.sig || '');
    if (!name) throw new Error('성명을 입력해 주세요.');
    if (tel.replace(/\D/g, '').length < 9) throw new Error('연락처를 입력해 주세요.');
    if (sig.indexOf('data:image/png;base64,') !== 0) throw new Error('서명을 그려 주세요.');
    if (sig.length > APP.SIG_MAX_CHARS) throw new Error('서명 이미지가 너무 큽니다. 다시 써 주세요.');
    var rv = reviewOf_(tk.storeId, tk.round), found = findStore_(tk.storeId);
    if (!rv || !found) throw new Error('검토서를 찾을 수 없습니다. 시설팀에 문의해 주세요.');
    var patch = {}; patch[c.name] = name; patch[c.tel] = tel; patch[c.sig] = sig; patch[c.date] = todayText_();
    writeRowPatch_(APP.SHEETS.REVIEWS, reviewCols_(), rv._row, patch);
    props_().deleteProperty(sigKey_(token));
    var pm = sigPendingMap_(found.row); delete pm[tk.round + ':' + tk.who];
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, { sigPending: JSON.stringify(pm) });
    addSendLog_(tk.storeId, { t: 'sig', round: tk.round, d: c.l + ' ' + name + ' · ' + tel + ' (원격 서명)' });
    log_('원격 서명', c.l + ' 서명', tk.storeId, found.row.docNo, tk.round + '차 ' + name + ' · ' + tel + ' · ' + tk.email);
    return { ok: true, who: c.l, tenant: rv.tenant || '' };
  } finally { lock.releaseLock(); }
}

/** 1.6: 매장 목록에 공사 기간·소방 점검일 채우기 (달력용, 버전이 바뀔 때 한 번) */
function backfillStores_() {
  var stores = readTable_(APP.SHEETS.STORES, STORE_COLS);
  if (!stores.length) return;
  var last = {};
  readReviews_().forEach(function (r) { if (!last[r.storeId] || Number(r.round) > Number(last[r.storeId].round)) last[r.storeId] = r; });
  stores.forEach(function (s) {
    var r = last[s.id];
    var dm = r ? docMissing_(r).join(', ') : '';
    if (!r || (s.periodStart === r.periodStart && s.periodEnd === r.periodEnd && s.fireCheckDate === r.fireCheckDate && s.docMissing === dm)) return;
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, s._row, { periodStart: r.periodStart || '', periodEnd: r.periodEnd || '', fireCheckDate: r.fireCheckDate || '', docMissing: dm });
  });
}

/** 제출서류 중 미제출 (대시보드 "서류 미제출"용) */
var DOC_NAMES = [['docInsurance', '영업배상 책임보험'], ['docCad', '설계도면(CAD)'], ['docFR', '방염서류'], ['docFRPlan', '방염계획도']];
/** 서류 요청 메일로 보낼 수 있는 서류 (영업배상 책임보험 제외) */
var DOC_REQ_KEYS = ['docCad', 'docFR', 'docFRPlan'];
function docMissing_(r) {
  return DOC_NAMES.filter(function (d) { return r && r[d[0]] === '미제출'; }).map(function (d) { return d[1]; });
}

function sanitizeReview_(review) {
  var out = {};
  var na = naKeys_(review);
  FIELDS.forEach(function (f) {
    var key = f[0], type = f[2], v = review[key];
    if (na.indexOf(key) >= 0) { out[key] = NOT_APPLICABLE; return; }
    if (type === 'bool') { out[key] = !!v; return; }
    v = v == null ? '' : String(v);
    if (type === 'choice' && v && f[3].indexOf(v) < 0 && !(v === NOT_APPLICABLE && POPUP_DEPENDENT.indexOf(key) >= 0)) v = '';
    if (type === 'sig') {
      if (v && v.indexOf('data:image/png;base64,') !== 0) v = '';
      if (v.length > APP.SIG_MAX_CHARS) throw new Error('서명 이미지가 너무 큽니다. 다시 서명해 주세요.');
    } else if (key === 'notesPhotos') {
      v = sanitizePhotos_(v);
    } else if (type !== 'long') {
      v = v.slice(0, 500);
    } else {
      v = v.slice(0, 20000);
    }
    out[key] = v;
  });
  return out;
}

function cleanStore_(s) {
  var o = {};
  STORE_COLS.forEach(function (c) { o[c[0]] = s[c[0]]; });
  o.currentRound = Number(o.currentRound) || 1;
  o.seq = Number(o.seq) || 0;
  return o;
}

function readRules_() {
  var sh = ss_().getSheetByName(APP.SHEETS.RULES);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_RULES;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues()
    .filter(function (r) { return r[1]; })
    .sort(function (x, y) { return Number(x[0]) - Number(y[0]); })
    .map(function (r) { return r[1]; });
}

/** 자주 쓰는 문구 [{t: 문구, c: 분류}] */
function readPhrases_() {
  var sh = ss_().getSheetByName(APP.SHEETS.PHRASES);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_PHRASES;
  var cols = Math.max(2, Math.min(sh.getLastColumn(), 2));
  ensureSize_(sh, 1, 2);
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols).getDisplayValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { var c = String(r[1] || '').trim(); return { t: String(r[0]).trim(), c: PHRASE_CATS.indexOf(c) >= 0 ? c : '기타' }; });
}

/** 웹앱에서 문구 목록 저장 (순서·분류 포함, 시트 내용을 통째로 바꿈) */
function apiSavePhrases(a, list) {
  var role = auth_(a);
  if (!Array.isArray(list)) throw new Error('문구 목록이 올바르지 않습니다.');
  var rows = list.map(function (p) {
    var t = String((p && p.t) || '').replace(/\s+$/, '').slice(0, 500), c = String((p && p.c) || '');
    return [t, PHRASE_CATS.indexOf(c) >= 0 ? c : '기타'];
  }).filter(function (r) { return r[0].trim(); });
  if (rows.length > 300) throw new Error('문구는 300개까지 저장할 수 있습니다.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = ss_().getSheetByName(APP.SHEETS.PHRASES) || ensureSheet_(ss_(), APP.SHEETS.PHRASES, ['문구', '분류']);
    ensureSize_(sh, rows.length + 1, 2);
    sh.getRange(1, 1, 1, 2).setValues([['문구', '분류']]);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 2).setValues(Array.apply(null, Array(last - 1)).map(function () { return ['', '']; }));
    if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  } finally { lock.releaseLock(); }
  log_(role, '자주 쓰는 문구 저장', '', '', rows.length + '개');
  return readPhrases_();
}

function ensureSynonyms_(ss) {
  if (ss.getSheetByName(APP.SHEETS.SYNONYMS)) return;
  var sh = ensureSheet_(ss, APP.SHEETS.SYNONYMS, ['단어', '비슷한 말 (쉼표로 구분)']);
  sh.getRange(2, 1, DEFAULT_SYNONYMS.length, 2).setValues(DEFAULT_SYNONYMS);
  sh.getRange('A1').setNote('지침 검색에서 한 줄에 있는 말은 모두 같이 찾습니다. 예: 스프링클러 | SP, 헤드');
}
/** [['스프링클러','SP','헤드'], ...] */
function readSynonyms_() {
  var sh = ss_().getSheetByName(APP.SHEETS.SYNONYMS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().map(function (r) {
    return [r[0]].concat(String(r[1]).split(/[,，、\n]/)).map(function (w) { return String(w).trim(); }).filter(String);
  }).filter(function (g) { return g.length > 1; });
}

function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/* ───────── 바로가기 주소 (1.8.4, 07 문서 14.1 · WS-15) ─────────
 * `설정` 탭 「바로가기주소」에 껍데기 주소(예: https://계정이름.github.io/fm/dw/)를 넣으면
 * 검토서 QR(?store=), 원격 서명 메일(?sign=), 다른 앱에 주는 매장 링크를 그 주소로 만듭니다.
 * 비어 있으면 지금처럼 웹앱 /exec 주소. 앱끼리 서버로 부르는 주소(ping의 url)는 계속 /exec. */
var SETTING_KEYS = [
  ['바로가기주소', '', '껍데기 주소. 예: https://계정이름.github.io/fm/dw/ — 비우면 웹앱 /exec 주소를 씀. 시트 메뉴 ⑧에서 넣는 것을 권장']
];
function settingsSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(APP.SHEETS.SETTINGS);
  if (!sh) {
    sh = ensureSheet_(ss, APP.SHEETS.SETTINGS, ['항목', '값', '설명']);
  }
  var have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  SETTING_KEYS.forEach(function (k) { if (have.indexOf(k[0]) < 0) sh.appendRow(k); });
  return sh;
}
function setting_(key) {
  var sh = ss_().getSheetByName(APP.SHEETS.SETTINGS);
  if (!sh || sh.getLastRow() < 2) return '';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === key) return String(rows[i][1] || '').trim();
  return '';
}
function setSetting_(key, value) {
  var sh = settingsSheet_(), rows = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === key) { sh.getRange(i + 2, 2).setNumberFormat('@').setValue(value); return; }
}
/** 껍데기 주소 형식: https:// 로 시작, 공백·#·? 없음 */
function okShortcut_(u) { return /^https:\/\/[^\s?#]+$/.test(String(u || '')); }
function shortcutUrl_() {
  var u = setting_('바로가기주소');
  return okShortcut_(u) ? u : '';
}
/** 서명창 안내 영상 (1.8.5, DW-4): 바로가기주소 폴더의 sign_guide.mp4 (안 나오면 sign_guide.gif). 바로가기주소가 없으면 영상 없음 */
function guideUrls_() {
  var b = shortcutUrl_();
  if (!b) return { mp4: '', gif: '' };
  if (b.charAt(b.length - 1) !== '/') b += '/';
  return { mp4: b + 'sign_guide.mp4', gif: b + 'sign_guide.gif' };
}
/** 사람이 여는 링크의 기준 주소: 바로가기주소가 있으면 그것, 없으면 /exec */
function publicUrl_() { return shortcutUrl_() || appUrl_(); }
/** 기준 주소 + ?키=값 (바로가기주소에 이미 ?가 있으면 &로 이음) */
function publicLink_(query) {
  var base = publicUrl_();
  return base ? base + (base.indexOf('?') >= 0 ? '&' : '?') + query : '';
}

/** 시트 메뉴 ⑧: 웹앱 주소 · 바로가기 주소 보기 / 넣기 */
function showAddresses_() {
  var ui = SpreadsheetApp.getUi(), exec = appUrl_(), cur = setting_('바로가기주소');
  var bad = cur && !okShortcut_(cur);
  var msg = [
    '웹앱 주소 (/exec): ' + (exec || '(아직 배포 전 — 배포 후 표시)'),
    '   → 껍데기 fm/apps.js 의 도면협의(dw) 줄에 이 주소를 넣습니다.',
    '',
    '바로가기 주소: ' + (cur ? cur + (bad ? '  ✗ 형식이 맞지 않아 쓰지 않음' : '') : '(비어 있음)'),
    '',
    '지금 QR·서명 메일 링크가 쓰는 주소:',
    '   ' + (publicLink_('store=매장ID') || '(배포 후 표시)'),
    '',
    '바로가기 주소를 넣거나 바꾸려면 아래 칸에 넣고 [확인]을 누르세요.',
    '예: https://계정이름.github.io/fm/dw/',
    '비우고 [확인] = 바로가기 주소 지우기(/exec 사용) · [취소] = 그대로'
  ].join('\n');
  var r = ui.prompt('⑧ 웹앱 주소 · 바로가기 주소', msg, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() != ui.Button.OK) return;
  var v = String(r.getResponseText() || '').trim();
  if (v && !okShortcut_(v)) { ui.alert('주소 형식이 맞지 않습니다.\nhttps:// 로 시작하고, 공백·?·# 없이 넣어 주세요.\n예: https://계정이름.github.io/fm/dw/'); return; }
  setSetting_('바로가기주소', v);
  log_('관리', '바로가기 주소', '', '', v || '(지움 → /exec)');
  ui.alert('⑧ 웹앱 주소 · 바로가기 주소', (v ? '바로가기 주소를 저장했습니다.\n\n' : '바로가기 주소를 지웠습니다. 링크는 웹앱 /exec 주소로 만듭니다.\n\n') +
    '시험해 보기 (새 창에서 열어 로그인 화면이 뜨는지 확인):\n' + (publicLink_('store=시험') || '(배포 후)') +
    '\n\n이미 출력한 QR·보낸 메일의 링크는 바뀌지 않습니다. 이제부터 만드는 것부터 새 주소를 씁니다.', ui.ButtonSet.OK);
}

function deletedHeaders_() {
  return reviewHeaders_().concat(['삭제일시', '삭제자']);
}

/** 준수사항 2번 문구 변경: "미제출시 공사진행 불가" → "미제출시 준공 불가" (이미 쓰던 시트도 한 번만 고침) */
function migrateRules_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MIGRATED_RULES_V1')) return;
  var sh = ss_().getSheetByName(APP.SHEETS.RULES);
  if (sh && sh.getLastRow() >= 2) {
    var rng = sh.getRange(2, 2, sh.getLastRow() - 1, 1);
    var vals = rng.getValues().map(function (r) {
      return [String(r[0]).replace(/미제출\s*시\s*공사\s*진행\s*불가/g, '미제출시 준공 불가')];
    });
    rng.setValues(vals);
  }
  props.setProperty('MIGRATED_RULES_V1', 'Y');
}

/** 업체명 자동완성 목록: 업체명별 최근 담당자·연락처·이메일 */
function readCompanies_() {
  var map = {};
  readReviews_().sort(function (x, y) { return String(x.savedAt).localeCompare(String(y.savedAt)); }).forEach(function (r) {
    [['owner', '발주처'], ['contractor', '시공업체']].forEach(function (p) {
      var name = String(r[p[0] + 'Company'] || '').trim();
      if (!name) return;
      map[name] = { name: name, kind: p[1], person: r[p[0] + 'Name'] || '', tel: r[p[0] + 'Tel'] || '', email: r[p[0] + 'Email'] || '' };
    });
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}

/* ───────────────────────── 자동 백업 ───────────────────────── */

function enableDailyBackup_() {
  disableDailyBackup_(true);
  ScriptApp.newTrigger('backupDaily').timeBased().everyDays(1).atHour(2).create();
  backupNow_();
  SpreadsheetApp.getUi().alert('자동 백업을 켰습니다.\n\n매일 새벽 2시경 드라이브 "' + APP.BACKUP_FOLDER + '" 폴더에 시트 사본이 만들어지고, ' + APP.BACKUP_KEEP_DAYS + '일이 지난 사본은 휴지통으로 옮겨집니다.\n방금 첫 백업도 만들었습니다.');
}

function backupOffMenu_() {
  disableDailyBackup_(false);
}

function disableDailyBackup_(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupDaily') ScriptApp.deleteTrigger(t);
  });
  if (!silent) SpreadsheetApp.getUi().alert('자동 백업을 껐습니다.');
}

/* ───────────────────────── 지침 (드라이브 폴더 · 색인) ─────────────────────────
 * 드라이브 "도면협의_지침" 폴더에 지침 PDF를 넣고, 웹앱의 [지침 관리 → 색인 만들기]를 누르면
 * 브라우저가 PDF를 읽어 검색 색인과 쪽 이미지를 만들어 이 폴더 안 "_검색색인" 폴더에 저장합니다.
 *
 * 스크립트 속성
 *   GUIDE_FOLDER       지침 폴더 ID
 *   GUIDE_SOURCES      검색에 쓰는 지침 목록 [{id,title,short,pages,landscape,localPages,fileId,fileName,fileUpdated,indexFile,pagesFolder,entries,builtAt,builtBy}]
 *   GUIDE_PAGES_<id>   쪽 번호 → 쪽 이미지 파일 ID (길면 여러 속성에 나눠 저장)
 *   GUIDE_BUILDING     만들고 있는(끊긴) 색인 작업
 */
var GUIDE = { FOLDER: '도면협의_지침', WORK: '_검색색인 (자동 생성 · 지우지 마세요)', CHUNK: 5 * 1024 * 1024 };

function props_() { return PropertiesService.getScriptProperties(); }

/** 9KB를 넘는 속성 값은 나눠 저장 */
function propSetBig_(key, str) {
  var p = props_(), n = Math.ceil(str.length / 8000) || 1;
  propDelBig_(key);
  if (n === 1) { p.setProperty(key, str); return; }
  for (var i = 0; i < n; i++) p.setProperty(key + '__' + i, str.slice(i * 8000, (i + 1) * 8000));
  p.setProperty(key, '#parts:' + n);
}
function propGetBig_(key) {
  var p = props_(), v = p.getProperty(key);
  if (!v) return null;
  var m = v.match(/^#parts:(\d+)$/);
  if (!m) return v;
  var out = '';
  for (var i = 0; i < Number(m[1]); i++) out += p.getProperty(key + '__' + i) || '';
  return out;
}
function propDelBig_(key) {
  var p = props_(), v = p.getProperty(key), m = v && v.match(/^#parts:(\d+)$/);
  if (m) for (var i = 0; i < Number(m[1]); i++) p.deleteProperty(key + '__' + i);
  p.deleteProperty(key);
}

function guidePageMap_(guideId) {
  var raw = propGetBig_('GUIDE_PAGES_' + guideId);
  return raw ? JSON.parse(raw) : null;
}

function guideSources_() {
  var raw = props_().getProperty('GUIDE_SOURCES');
  return raw ? JSON.parse(raw) : [];
}
function saveGuideSources_(list) { props_().setProperty('GUIDE_SOURCES', JSON.stringify(list)); }
/** 개정판으로 바뀐 이전 판 (검색 "이전 판 포함"에서만 나옴) */
function guideArchive_() {
  var raw = propGetBig_('GUIDE_ARCHIVE');
  return raw ? JSON.parse(raw) : [];
}
function saveGuideArchive_(list) { propSetBig_('GUIDE_ARCHIVE', JSON.stringify(list)); }

/** 웹앱에 내려보내는 지침 목록 */
function guidesForClient_() {
  var one = function (g, old) {
    var o = { id: g.id, title: g.title, short: g.short, pages: g.pages, landscape: !!g.landscape, images: !!guidePageMap_(g.id) };
    if (old) { o.archived = true; o.archivedAt = g.archivedAt || ''; }
    return o;
  };
  return guideSources_().map(function (g) { return one(g, false); })
    .concat(guideArchive_().map(function (g) { return one(g, true); }));
}

var GUIDE_DATA_CACHE_ = null;
/** 모든 지침의 검색 항목을 합침 */
function guideData_() {
  if (GUIDE_DATA_CACHE_) return GUIDE_DATA_CACHE_;
  var index = [], legacy = null;
  guideSources_().concat(guideArchive_()).forEach(function (g) {
    try {
      if (g.indexFile) {
        index = index.concat(JSON.parse(DriveApp.getFileById(g.indexFile).getBlob().getDataAsString('UTF-8')));
      } else {
        // 1.1 방식(guide_pages/index.json 하나에 모든 지침)
        if (!legacy) {
          var lid = props_().getProperty('GUIDE_INDEX_FILE');
          legacy = lid ? JSON.parse(DriveApp.getFileById(lid).getBlob().getDataAsString('UTF-8')).index || [] : [];
        }
        index = index.concat(legacy.filter(function (e) { return e.d === g.id; }));
      }
    } catch (e) { /* 지워진 색인 파일은 건너뜀 */ }
  });
  GUIDE_DATA_CACHE_ = { index: index };
  return GUIDE_DATA_CACHE_;
}

/** 지침 폴더 (없으면 내 드라이브에 만듦) */
function guideRoot_() { return appFolder_('guide'); }
function guideWork_(root) {
  var it = root.getFoldersByName(GUIDE.WORK);
  return it.hasNext() ? it.next() : root.createFolder(GUIDE.WORK);
}
function trashQuietly_(getter) { try { getter().setTrashed(true); } catch (e) { /* 이미 없음 */ } }

/** 지침 폴더 안의 PDF인지 확인 (다른 드라이브 파일은 읽지 않음) */
function guidePdf_(fileId) {
  var root = guideRoot_(), file = DriveApp.getFileById(fileId), parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === root.getId()) return file;
  throw new Error('지침 폴더에 있는 PDF만 색인할 수 있습니다.');
}
function fileStamp_(file) { return Utilities.formatDate(file.getLastUpdated(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss"); }

function guideAdminState_() {
  var root = guideRoot_(), pdfs = [], it = root.getFilesByType(MimeType.PDF);
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    pdfs.push({ fileId: f.getId(), name: f.getName(), size: f.getSize(), updated: fileStamp_(f) });
  }
  pdfs.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var b = props_().getProperty('GUIDE_BUILDING');
  return {
    folderUrl: root.getUrl(), folderName: root.getName(), pdfs: pdfs,
    sources: guideSources_().map(function (g) {
      return { id: g.id, title: g.title, short: g.short, pages: g.pages, landscape: !!g.landscape, localPages: !!g.localPages,
        fileId: g.fileId || '', fileName: g.fileName || '', fileUpdated: g.fileUpdated || '', entries: g.entries || 0,
        builtAt: g.builtAt || '', builtBy: g.builtBy || '', legacy: !g.indexFile, images: !!guidePageMap_(g.id) };
    }),
    archive: guideArchive_().map(function (g) {
      return { id: g.id, title: g.title, short: g.short, pages: g.pages, entries: g.entries || 0, fileName: g.fileName || '', builtAt: g.builtAt || '', archivedAt: g.archivedAt || '' };
    }),
    building: b ? JSON.parse(b) : null,
    guides: guidesForClient_()
  };
}

/** 지침 관리 화면 */
function apiGuideAdmin(a) {
  auth_(a);
  return guideAdminState_();
}

/** PDF를 조각으로 내려받음 (브라우저가 이어 붙여 읽음) */
function apiGuidePdfChunk(a, fileId, offset) {
  auth_(a);
  var bytes = guidePdf_(fileId).getBlob().getBytes();
  var start = Math.max(0, Number(offset) || 0), end = Math.min(bytes.length, start + GUIDE.CHUNK);
  return { size: bytes.length, offset: start, data: Utilities.base64Encode(bytes.slice(start, end)) };
}

/** 색인 만들기 시작 (같은 PDF로 끊긴 작업이 있으면 이어서) */
function apiGuideBegin(a, info) {
  var role = auth_(a);
  info = info || {};
  var title = String(info.title || '').trim(), short = String(info.short || '').trim();
  if (!title || !short) throw new Error('지침 이름과 줄임말을 입력해 주세요.');
  var file = guidePdf_(info.fileId), stamp = fileStamp_(file);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var work = guideWork_(guideRoot_());
    var b = props_().getProperty('GUIDE_BUILDING');
    b = b ? JSON.parse(b) : null;
    var resume = b && b.fileId === file.getId() && b.fileUpdated === stamp && !!b.localPages === !!info.localPages;
    if (b && !resume) trashQuietly_(function () { return DriveApp.getFolderById(b.pagesFolder); });
    if (!resume) {
      var id = 'g' + Date.now().toString(36);
      b = { id: id, fileId: file.getId(), fileName: file.getName(), fileUpdated: stamp, localPages: !!info.localPages,
        pagesFolder: work.createFolder(id).getId(), startedAt: nowText_(), startedBy: role };
    }
    b.title = title; b.short = short; b.replaces = String(info.replaces || '');
    props_().setProperty('GUIDE_BUILDING', JSON.stringify(b));
  } finally { lock.releaseLock(); }
  var have = [], files = DriveApp.getFolderById(b.pagesFolder).getFiles();
  while (files.hasNext()) {
    var m = files.next().getName().match(/^p(\d+)\.jpg$/);
    if (m) have.push(Number(m[1]));
  }
  return { id: b.id, have: have, resumed: !!resume };
}

function building_(id) {
  var b = props_().getProperty('GUIDE_BUILDING');
  b = b ? JSON.parse(b) : null;
  if (!b || b.id !== id) throw new Error('색인 작업 정보가 없습니다. 지침 관리 화면에서 다시 시작해 주세요.');
  return b;
}

/** 쪽 이미지 저장 [{p, data:'data:image/jpeg;base64,...'}] */
function apiGuideSavePages(a, id, pages) {
  auth_(a);
  var b = building_(id), folder = DriveApp.getFolderById(b.pagesFolder), n = 0;
  (pages || []).forEach(function (pg) {
    var p = Number(pg.p);
    if (!(p >= 1) || !/^data:image\/jpeg;base64,/.test(pg.data || '')) return;
    var name = 'p' + ('00' + p).slice(-3) + '.jpg';
    var old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    folder.createFile(Utilities.newBlob(Utilities.base64Decode(pg.data.split(',')[1]), 'image/jpeg', name));
    n++;
  });
  return { saved: n };
}

/** 색인 저장 · 검색에 추가 (같은 PDF나 바꿀 지침의 이전 색인은 휴지통으로) */
function apiGuideFinish(a, id, meta, entries) {
  var role = auth_(a), b = building_(id);
  meta = meta || {};
  var pages = Number(meta.pages) || 0;
  if (!pages || !Array.isArray(entries) || !entries.length) throw new Error('PDF에서 글자를 찾지 못했습니다. 스캔(사진) PDF는 검색할 수 없습니다.');
  var map = {}, count = 0, files = DriveApp.getFolderById(b.pagesFolder).getFiles();
  while (files.hasNext()) {
    var f = files.next(), m = f.getName().match(/^p(\d+)\.jpg$/);
    if (m && !f.isTrashed()) { map[String(Number(m[1]))] = f.getId(); count++; }
  }
  if (count < pages) throw new Error('쪽 이미지가 ' + count + ' / ' + pages + '쪽만 저장되었습니다. "이어서 만들기"를 눌러 주세요.');
  entries.forEach(function (e) { e.d = id; });
  var work = guideWork_(guideRoot_());
  var idx = work.createFile(Utilities.newBlob(JSON.stringify(entries), 'application/json', id + '.json'));
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var list = guideSources_(), pos = -1, archive = guideArchive_();
    list = list.filter(function (g, i) {
      var gone = g.id === b.replaces || (g.fileId && g.fileId === b.fileId);
      if (!gone) return true;
      if (pos < 0) pos = i;
      // 같은 PDF를 그대로 다시 만든 경우만 지우고, 내용이 바뀐 판은 "이전 판"으로 보관
      if (g.fileId === b.fileId && g.fileUpdated === b.fileUpdated) removeGuideFiles_(g);
      else archive.unshift(Object.assign({}, g, { archivedAt: nowText_() }));
      return false;
    });
    saveGuideArchive_(archive);
    var src = { id: id, title: b.title, short: b.short, pages: pages, landscape: !!meta.landscape, localPages: !!b.localPages,
      fileId: b.fileId, fileName: b.fileName, fileUpdated: b.fileUpdated, indexFile: idx.getId(), pagesFolder: b.pagesFolder,
      entries: entries.length, builtAt: nowText_(), builtBy: role };
    if (pos < 0) list.push(src); else list.splice(pos, 0, src);
    propSetBig_('GUIDE_PAGES_' + id, JSON.stringify(map));
    saveGuideSources_(list);
    props_().deleteProperty('GUIDE_BUILDING');
  } finally { lock.releaseLock(); }
  GUIDE_DATA_CACHE_ = null;
  log_(role, '지침 색인', '', '', b.title + ' · ' + pages + '쪽 · ' + entries.length + '개 항목');
  return guideAdminState_();
}

function removeGuideFiles_(g) {
  if (g.indexFile) trashQuietly_(function () { return DriveApp.getFileById(g.indexFile); });
  if (g.pagesFolder) trashQuietly_(function () { return DriveApp.getFolderById(g.pagesFolder); });
  propDelBig_('GUIDE_PAGES_' + g.id);
}

/** 지침을 검색에서 뺌 (색인·쪽 이미지는 휴지통으로, 원본 PDF는 그대로) */
function apiGuideRemove(a, id) {
  var role = auth_(a);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var list = guideSources_(), g = list.filter(function (x) { return x.id === id; })[0];
    if (!g) throw new Error('이미 삭제된 지침입니다.');
    removeGuideFiles_(g);
    saveGuideSources_(list.filter(function (x) { return x.id !== id; }));
    log_(role, '지침 삭제', '', '', g.title);
  } finally { lock.releaseLock(); }
  GUIDE_DATA_CACHE_ = null;
  return guideAdminState_();
}

/** 이전 판 완전히 삭제 (색인·쪽 이미지는 휴지통으로) */
function apiGuideRemoveArchived(a, id) {
  var role = auth_(a);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var list = guideArchive_(), g = list.filter(function (x) { return x.id === id; })[0];
    if (!g) throw new Error('이미 삭제된 이전 판입니다.');
    removeGuideFiles_(g);
    saveGuideArchive_(list.filter(function (x) { return x.id !== id; }));
    log_(role, '지침 이전 판 삭제', '', '', g.title);
  } finally { lock.releaseLock(); }
  GUIDE_DATA_CACHE_ = null;
  return guideAdminState_();
}

/** 지침 이름·줄임말 바꾸기 */
function apiGuideRename(a, id, info) {
  auth_(a);
  var title = String((info || {}).title || '').trim(), short = String((info || {}).short || '').trim();
  if (!title || !short) throw new Error('지침 이름과 줄임말을 입력해 주세요.');
  var list = guideSources_();
  list.forEach(function (g) { if (g.id === id) { g.title = title; g.short = short; } });
  saveGuideSources_(list);
  return guideAdminState_();
}

/** 끊긴 색인 작업 버리기 */
function apiGuideCancel(a) {
  auth_(a);
  var b = props_().getProperty('GUIDE_BUILDING');
  if (b) {
    b = JSON.parse(b);
    trashQuietly_(function () { return DriveApp.getFolderById(b.pagesFolder); });
    props_().deleteProperty('GUIDE_BUILDING');
  }
  return guideAdminState_();
}

/** 시트 메뉴: 지침 폴더 주소 보기 */
function openGuideFolder_() {
  var root = guideRoot_();
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px sans-serif;line-height:1.6">' +
    '<p>이 폴더에 검색할 지침 PDF를 넣은 뒤, 웹앱 대시보드의 <b>지침 관리</b>에서 <b>색인 만들기</b>를 누르세요.</p>' +
    '<p><a href="' + root.getUrl() + '" target="_blank">' + root.getName() + ' 폴더 열기</a></p></div>')
    .setWidth(420).setHeight(160);
  SpreadsheetApp.getUi().showModalDialog(html, '지침 폴더');
}

function backupNowMenu_() {
  var name = backupNow_();
  SpreadsheetApp.getUi().alert('백업했습니다: ' + name);
}

/** 시간 트리거가 매일 실행 */
function backupDaily(e) {
  if (fromTrigger_(e)) backupNow_();
}

/** 예약(트리거)이 부른 것인지 확인. 이름이 _로 안 끝나는 함수는 웹앱 화면에서 누구나 부를 수 있어서,
 *  이 프로젝트에 실제로 있는 예약 번호와 맞을 때만 실행 (결정 41) */
function fromTrigger_(e) {
  var uid = String(e && e.triggerUid || '');
  return !!uid && ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; });
}

function backupNow_() {
  var ss = ss_();
  var folder = appFolder_('backup');
  var name = ss.getName() + '_백업_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd_HHmm');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  var limit = new Date(Date.now() - APP.BACKUP_KEEP_DAYS * 24 * 3600 * 1000);
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated() < limit) f.setTrashed(true);
  }
  log_('자동', '백업', '', '', name);
  return name;
}

/* ───────── 시방서 발송 ───────── */
/** 시트 메뉴 ⑤: 메일 권한 승인 + 보내는 주소·ZIP 파일 확인 */
function checkSpecSetup_() {
  var files = specFiles_(), ok = fromAliasOk_();
  var lines = ['보내는 주소 ' + APP.SPEC_FROM + ' : ' + (ok ? '✓ Gmail에 등록됨' : '✗ Gmail "다른 주소에서 메일 보내기"에 없음 (구글 계정 주소로 보내고 답장은 nate로 받음)')];
  SPECS.forEach(function (sp) { lines.push(sp.l + ' : ' + (files[sp.k] ? '✓ ' + files[sp.k].getName() : '✗ 지침 폴더에 이름에 "' + (sp.k === 'tenant' ? 'Tenant' : 'Crown') + '"이 들어간 .zip 없음')); });
  lines.push('오늘 남은 발송 가능 수: ' + MailApp.getRemainingDailyQuota());
  SpreadsheetApp.getUi().alert('시방서 발송 준비', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
function specFiles_() {
  var root = guideRoot_(), found = {};
  var it = root.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || !/\.zip$/i.test(f.getName())) continue;
    SPECS.forEach(function (sp) {
      if (!sp.re.test(f.getName())) return;
      var cur = found[sp.k];
      if (!cur || f.getLastUpdated() > cur.getLastUpdated()) found[sp.k] = f;
    });
  }
  return found;
}

function fromAliasOk_() {
  try { return GmailApp.getAliases().map(function (x) { return String(x).toLowerCase(); }).indexOf(APP.SPEC_FROM.toLowerCase()) >= 0; }
  catch (e) { return false; }
}

/** 발송 창에 보여줄 정보: 시방서 파일 있음/없음, 보내는 주소 */
function apiSpecInfo(a) {
  auth_(a);
  var files = specFiles_();
  return {
    from: APP.SPEC_FROM, fromName: APP.SPEC_FROM_NAME, fromOk: fromAliasOk_(), label: APP.STORE_LABEL, signature: APP.SPEC_SIGNATURE,
    specs: SPECS.map(function (sp) {
      var f = files[sp.k];
      return f ? { k: sp.k, l: sp.l, name: f.getName(), size: f.getSize() } : { k: sp.k, l: sp.l, missing: true };
    })
  };
}

function specSentList_(store) {
  try { var v = JSON.parse(store.specSent || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function specMail_(tenant, items, extra) {
  var subject = '[' + APP.STORE_LABEL + '] ' + (tenant || '') + ' 시방서 송부';
  var lines = ['안녕하세요, ' + APP.STORE_LABEL + ' 시설팀입니다.', (tenant || '') + ' 공사 관련 시방서를 아래 링크로 보내드립니다.', ''];
  items.forEach(function (it) { lines.push('· ' + it.l + ' : ' + it.url); });
  if (extra) { lines.push(''); lines.push(extra); }
  var sig = APP.SPEC_SIGNATURE || [];
  if (sig.length) { lines.push(''); lines.push('──────────'); sig.forEach(function (l) { lines.push(l); }); }
  var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  // 서명의 메일 주소·홈페이지는 눌러지는 링크로
  var sigLine = function (l, i) {
    var h = esc(l)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
      .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
    return i === 0 ? '<b>' + h + '</b>' : h;
  };
  var html = '<div style="font-family:sans-serif;font-size:14px;line-height:1.7">' +
    esc(lines[0]) + '<br>' + esc(lines[1]) + '<br><br>' +
    items.map(function (it) { return '· ' + esc(it.l) + ' : <a href="' + esc(it.url) + '">' + esc(it.name) + '</a>'; }).join('<br>') +
    (extra ? '<br><br>' + esc(extra).replace(/\n/g, '<br>') : '') +
    (sig.length ? '<div style="margin-top:20px;padding-top:10px;border-top:1px solid #ddd;color:#333">' + sig.map(sigLine).join('<br>') + '</div>' : '') +
    '</div>';
  return { subject: subject, body: lines.join('\n'), html: html };
}

/* ───────── 공용: 메일 본문 · 발송 기록 ───────── */
function escH_(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** 서명 4줄 (메일·홈페이지는 링크) */
function sigParts_() {
  var sig = APP.SPEC_SIGNATURE || [];
  var html = sig.map(function (l, i) {
    var h = escH_(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
    return i === 0 ? '<b>' + h + '</b>' : h;
  }).join('<br>');
  return { text: sig.length ? '\n\n──────────\n' + sig.join('\n') : '', html: sig.length ? '<div style="margin-top:20px;padding-top:10px;border-top:1px solid #ddd;color:#333">' + html + '</div>' : '' };
}
/** 메일 한 통: blocks = [{t:'글'} | {t:'글', url:'주소', link:'링크 글자'} | {t:'글', button:'버튼 글자', url} | {gap:true} | {t:'글', bold:true}] */
function mailMake_(subject, blocks, extra) {
  var text = [], html = [];
  blocks.forEach(function (b) {
    if (b.gap) { text.push(''); html.push(''); return; }
    if (b.button) { text.push(b.t + ' ' + b.url); html.push(escH_(b.t) + ' <a href="' + escH_(b.url) + '" style="display:inline-block;margin-top:6px;background:#1F5FAE;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:700">' + escH_(b.button) + '</a>'); return; }
    if (b.url) { text.push(b.t + ' ' + b.url); html.push(escH_(b.t) + ' <a href="' + escH_(b.url) + '">' + escH_(b.link || b.url) + '</a>'); return; }
    text.push(b.t); html.push(b.bold ? '<b>' + escH_(b.t) + '</b>' : escH_(b.t));
  });
  if (extra) { text.push(''); text.push(extra); html.push(''); html.push(escH_(extra).replace(/\n/g, '<br>')); }
  var sg = sigParts_();
  return { subject: subject, body: text.join('\n') + sg.text, html: '<div style="font-family:sans-serif;font-size:14px;line-height:1.7">' + html.join('<br>') + sg.html + '</div>' };
}
/** 보내기 (nate 보내기 주소가 Gmail에 있으면 그 주소로, 없으면 답장만 nate로) */
function mailSend_(to, mail) {
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('오늘 보낼 수 있는 메일 수를 다 썼습니다. 내일 다시 보내 주세요.');
  var opts = { htmlBody: mail.html, name: APP.SPEC_FROM_NAME };
  if (fromAliasOk_()) opts.from = APP.SPEC_FROM; else opts.replyTo = APP.SPEC_FROM;
  GmailApp.sendEmail(to, mail.subject, mail.body, opts);
  return !!opts.from;
}
function sendLogList_(store) {
  try { var v = JSON.parse(store.sendLog || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
/** 발송 기록 한 줄 더하기: t = doc(서류 요청) / sigreq(서명 요청) / sig(서명 완료) / pdf(PDF 보관) / defect(하자 발송) */
function addSendLog_(storeId, entry) {
  var found = findStore_(storeId); if (!found) return;
  var list = sendLogList_(found.row);
  entry.at = entry.at || nowText_();
  list.push(entry);
  // 시트 한 칸 크기 제한: 오래된 것부터 정리
  while (list.length > 1 && JSON.stringify(list).length > 40000) list.shift();
  var patch = { sendLog: JSON.stringify(list.slice(-150)) };
  if (entry.t === 'defect') patch.defectSent = entry.at;
  writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, found.rowIndex, patch);
}
function reviewOf_(storeId, round) {
  return readReviews_().filter(function (r) { return r.storeId === storeId && Number(r.round) === Number(round); })[0];
}
function okEmail_(v) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(v || '').trim()); }

/**
 * 미제출 서류 요청: 설계도면(CAD)·방염서류·방염계획도 중 그 차수에서 "미제출"인 것만 시공업체에 (영업배상 책임보험 제외)
 */
function apiSendDocReq(a, storeId, round, keys, extra) {
  var role = auth_(a);
  var found = findStore_(storeId);
  if (!found) throw new Error('매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.');
  var review = reviewOf_(storeId, round);
  if (!review) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
  var to = String(review.contractorEmail || '').trim();
  if (!okEmail_(to)) throw new Error('시공업체 이메일이 비어 있거나 형식이 맞지 않습니다.');
  var names = {}; DOC_NAMES.forEach(function (d) { names[d[0]] = d[1]; });
  keys = (keys || []).filter(function (k, i, arr) { return arr.indexOf(k) === i && DOC_REQ_KEYS.indexOf(k) >= 0 && review[k] === '미제출'; });
  if (!keys.length) throw new Error('요청할 미제출 서류가 없습니다. 제출서류에서 「미제출」을 먼저 저장해 주세요.');
  extra = String(extra || '').trim().slice(0, 1000);
  var t = review.tenant || '';
  var blocks = [{ t: '안녕하세요, ' + APP.STORE_LABEL + ' 시설팀입니다.' }, { t: t + ' 공사 도면 검토(' + Number(round) + '차) 결과 아래 서류가 아직 제출되지 않았습니다.' }, { t: '미제출 시 준공이 불가하니 제출 부탁드립니다.' }, { gap: true }]
    .concat(keys.map(function (k) { return { t: '· ' + names[k] }; }));
  var fromOk = mailSend_(to, mailMake_('[' + APP.STORE_LABEL + '] ' + t + ' 미제출 서류 제출 요청', blocks, extra));
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    addSendLog_(storeId, { t: 'doc', to: to, by: role, round: Number(round), d: keys.map(function (k) { return names[k]; }).join(', ') });
    log_(role, '서류 요청', storeId, found.row.docNo, keys.map(function (k) { return names[k]; }).join(', ') + ' → ' + to);
  } finally { lock.releaseLock(); }
  var out = apiGetStore(a, storeId); out.fromOk = fromOk; return out;
}

/**
 * 시방서 발송: 그 차수 검토서의 시공업체 이메일로 드라이브 공유 링크를 보냄.
 * keys = ['tenant', 'crown'] 중 선택, extra = 덧붙일 말. 발송 기록은 매장 "시방서발송" 칸(JSON)에.
 */
function apiSendSpec(a, storeId, round, keys, extra) {
  var role = auth_(a);
  var found = findStore_(storeId);
  if (!found) throw new Error('매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.');
  var review = readReviews_().filter(function (r) { return r.storeId === storeId && Number(r.round) === Number(round); })[0];
  if (!review) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
  var to = String(review.contractorEmail || '').trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new Error('시공업체 이메일이 비어 있거나 형식이 맞지 않습니다.');
  keys = (keys || []).filter(function (k, i, arr) { return arr.indexOf(k) === i && SPECS.some(function (sp) { return sp.k === k; }); });
  if (!keys.length) throw new Error('보낼 시방서를 골라 주세요.');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('오늘 보낼 수 있는 메일 수를 다 썼습니다. 내일 다시 보내 주세요.');
  var files = specFiles_(), items = [];
  keys.forEach(function (k) {
    var sp = SPECS.filter(function (x) { return x.k === k; })[0], f = files[k];
    if (!f) throw new Error('지침 폴더에 ' + sp.l + ' ZIP 파일이 없습니다.');
    try {
      if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      throw new Error(sp.l + ' 파일을 "링크가 있는 모든 사용자"로 공유하지 못했습니다. 드라이브에서 직접 공유 설정을 바꿔 주세요.');
    }
    items.push({ k: k, l: sp.l, name: f.getName(), url: f.getUrl() });
  });
  extra = String(extra || '').trim().slice(0, 1000);
  var mail = specMail_(review.tenant, items, extra);
  var opts = { htmlBody: mail.html, name: APP.SPEC_FROM_NAME };
  if (fromAliasOk_()) opts.from = APP.SPEC_FROM; else opts.replyTo = APP.SPEC_FROM;
  GmailApp.sendEmail(to, mail.subject, mail.body, opts);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = nowText_();
    var fresh = findStore_(storeId);
    var list = specSentList_(fresh.row);
    items.forEach(function (it) { list.push({ k: it.k, l: it.l, at: now, to: to, by: role, round: Number(round) }); });
    writeRowPatch_(APP.SHEETS.STORES, STORE_COLS, fresh.rowIndex, { specSent: JSON.stringify(list.slice(-40)) });
    log_(role, '시방서 발송', storeId, fresh.row.docNo, items.map(function (x) { return x.l; }).join(', ') + ' → ' + to + (opts.from ? '' : ' (보낸 주소: 구글 계정, 회신: ' + APP.SPEC_FROM + ')'));
  } finally {
    lock.releaseLock();
  }
  var out = apiGetStore(a, storeId);
  out.fromOk = !!opts.from;
  return out;
}

function log_(role, action, storeId, docNo, detail) {
  try {
    sheet_(APP.SHEETS.LOG).appendRow([nowText_(), role, action, storeId, docNo || '', detail || ''].map(noFormula_));
  } catch (e) { /* 기록 실패는 무시 */ }
}

function todayText_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function nowText_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}

/* ───────────────────────── 계정 옮기기 (1.8.3) ─────────────────────────
 * 기존 계정 → 새 계정으로 시트와 폴더 4개(사진·출력·지침·백업), 그 안 모든 파일의 소유권을 넘깁니다.
 * 개인 Gmail끼리는 「소유권 이전 요청 → 받는 쪽 수락」 두 단계라서 메뉴도 두 개입니다.
 *  1. [기존 계정] 소유권 넘기기 요청 : 목록을 _계정이전 탭에 만들고, 하나씩 편집자 공유 + 이전 요청
 *  2. [새 계정]  소유권 받기         : _계정이전 탭의 요청을 하나씩 수락
 *  3. 이전 점검                       : 시트에 적힌 파일 ID가 어느 계정 것인지 _이전점검 탭에 보여 줌
 * 한 번에 4분 30초까지 하고, 남으면 1분 뒤 이어서 하도록 예약합니다 (Apps Script 6분 제한).
 * 파일 ID가 바뀌지 않으므로 앱 자료·보낸 메일 링크·PIN이 그대로입니다. */
var MIG = {
  TAB: '_계정이전', CHECK_TAB: '_이전점검', BUDGET: 270000,
  HEAD: ['ID', '종류', '이름', '위치', '상태', '메모', '처리일시', '펼침'],
  CHECK_HEAD: ['ID', '어디에 쓰임', '이름', '소유 계정', '판정']
};

function migTab_(name, head, fresh) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (fresh) sh.clearContents();
  if (!sh.getLastRow()) {
    ensureSize_(sh, 1, head.length);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#EEF1F4');
    sh.setFrozenRows(1);
  }
  return sh;
}
function migRows_(sh) {
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, MIG.HEAD.length).getValues().map(function (r) { return r.map(String); }) : [];
}
function migWrite_(sh, rows) {
  if (!rows.length) return;
  ensureSize_(sh, rows.length + 1, MIG.HEAD.length);
  sh.getRange(2, 1, rows.length, MIG.HEAD.length).setNumberFormat('@').setValues(rows);
}
function migUi_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }

/** Drive API v3 (소유권 이전은 DriveApp에 없어서 직접 부름) */
function driveApi_(method, path, body, query) {
  var opt = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/' + path + (query ? '?' + query : ''), opt);
  var code = res.getResponseCode(), txt = res.getContentText(), json = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch (e) { /* 빈 응답 */ }
  if (code >= 300) throw new Error((json.error && json.error.message) || ('Drive 오류 ' + code));
  return json;
}
function migPerms_(id) {
  return driveApi_('get', 'files/' + encodeURIComponent(id) + '/permissions', null,
    'fields=' + encodeURIComponent('permissions(id,emailAddress,role,pendingOwner)')).permissions || [];
}
function migPermOf_(perms, email) {
  return perms.filter(function (x) { return String(x.emailAddress || '').toLowerCase() === email; })[0] || null;
}

/** 기존 계정: 한 항목 → 편집자로 공유(알림 메일 없음) + 이전 요청 */
function migrateRequest_(id, to) {
  var base = 'files/' + encodeURIComponent(id) + '/permissions';
  var p = migPermOf_(migPerms_(id), to);
  if (p && p.role === 'owner') return '이미 넘어감';
  if (!p) p = driveApi_('post', base, { type: 'user', role: 'writer', emailAddress: to }, 'sendNotificationEmail=false&fields=id,role,pendingOwner');
  if (p.role !== 'writer' || !p.pendingOwner) driveApi_('patch', base + '/' + p.id, { role: 'writer', pendingOwner: true }, 'fields=id');
  return '요청함';
}
/** 새 계정: 한 항목 → 요청이 와 있으면 수락 */
function migrateTake_(id, me) {
  var p = migPermOf_(migPerms_(id), me);
  if (!p) return '이 계정에 공유되지 않음';
  if (p.role === 'owner') return '받음';
  if (!p.pendingOwner) return '이전 요청 없음';
  driveApi_('patch', 'files/' + encodeURIComponent(id) + '/permissions/' + p.id, { role: 'owner' }, 'transferOwnership=true&fields=id');
  return '받음';
}

function migrateSchedule_(fn, on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger(fn).timeBased().after(60 * 1000).create();
}
function migrateStop_() {
  migrateSchedule_('migrateSendResume', false);
  migrateSchedule_('migrateAcceptResume', false);
  var ui = migUi_(); if (ui) ui.alert('이어하기 예약을 멈췄습니다. 메뉴를 다시 누르면 남은 것부터 이어서 합니다.');
}
function migCount_(rows) {
  var c = {};
  rows.forEach(function (r) { c[r[4]] = (c[r[4]] || 0) + 1; });
  return c;
}
function migCountText_(c) {
  return Object.keys(c).map(function (k) { return k + ' ' + c[k]; }).join(' · ');
}

/* ── 1. 기존 계정: 소유권 넘기기 요청 ── */
function migrateSend_() {
  var ui = SpreadsheetApp.getUi(), p = props_(), me = myEmail_();
  var to = p.getProperty('MIGRATE_TO') || '', sh = ss_().getSheetByName(MIG.TAB), resume = false;
  if (to && sh && sh.getLastRow() > 1) {
    var ans = ui.alert('계정 옮기기', to + ' 로 넘기는 작업이 이미 있습니다.\n\n[예] 남은 것부터 이어서\n[아니요] 처음부터 다시', ui.ButtonSet.YES_NO_CANCEL);
    if (ans == ui.Button.CANCEL) return;
    resume = ans == ui.Button.YES;
  }
  if (!resume) {
    var r = ui.prompt('계정 옮기기 1/2 (기존 계정)',
      '도면협의 시트와 폴더 4개(사진·출력·지침·백업), 그 안 모든 파일의 소유권을 넘겨받을 새 계정 이메일을 넣어 주세요.\n지금 계정: ' + (me || '(알 수 없음)'),
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() != ui.Button.OK) return;
    to = String(r.getResponseText() || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { ui.alert('이메일 형식이 올바르지 않습니다.'); return; }
    if (to === me) { ui.alert('지금 계정과 같은 주소입니다. 새 계정 주소를 넣어 주세요.'); return; }
    p.setProperty('MIGRATE_TO', to);
    migrateInitSend_(me);
  }
  var c = migrateSendRun_();
  ui.alert('계정 옮기기 1/2 (기존 계정)', migrateSendMsg_(c, to), ui.ButtonSet.OK);
}
function migrateSendResume(e) { if (fromTrigger_(e)) migrateSendRun_(); }

function migrateInitSend_(me) {
  var sh = migTab_(MIG.TAB, MIG.HEAD, true), rows = [];
  ['photo', 'pdf', 'guide', 'backup'].forEach(function (k) {
    var f = appFolder_(k, true);
    if (!f) return;
    var own = ownerEmail_(f), mine = !me || own === me;
    rows.push([f.getId(), '폴더', f.getName(), f.getName(), mine ? '대기' : '건너뜀', mine ? '' : '다른 계정 소유 (' + own + ')', '', '']);
  });
  // 시트는 맨 마지막에 넘김 (이 탭이 시트 안에 있어서)
  var ss = ss_();
  rows.push([ss.getId(), '시트', ss.getName(), '(이 시트 · Apps Script 포함)', '마지막', '', '', '-']);
  migWrite_(sh, rows);
}

function migrateSendRun_() {
  var t0 = Date.now(), to = props_().getProperty('MIGRATE_TO'), me = myEmail_();
  var sh = migTab_(MIG.TAB, MIG.HEAD, false), rows = migRows_(sh), seen = {}, done = false;
  rows.forEach(function (r) {
    seen[r[0]] = 1;
    if (r[4] === '오류') { r[4] = r[1] === '시트' ? '마지막' : '대기'; if (r[1] === '폴더') r[7] = ''; }
  });
  var fi = 0, qi = 0;
  while (Date.now() - t0 < MIG.BUDGET) {
    // ① 아직 펼치지 않은 폴더 → 안의 폴더·파일을 목록에 추가
    while (fi < rows.length && !(rows[fi][1] === '폴더' && rows[fi][7] !== 'Y' && rows[fi][4] !== '건너뜀')) fi++;
    if (fi < rows.length) {
      var row = rows[fi], folder = null;
      try { folder = DriveApp.getFolderById(row[0]); } catch (e) {
        row[4] = '오류'; row[5] = '폴더를 열 수 없음: ' + String(e.message || e).slice(0, 150); row[7] = 'Y';
        continue;
      }
      var add = function (item, kind) {
        var id = item.getId();
        if (seen[id]) return;
        seen[id] = 1;
        var own = ownerEmail_(item), mine = !me || own === me;
        rows.push([id, kind, item.getName(), row[3] + '/' + item.getName(), mine ? '대기' : '건너뜀', mine ? '' : '다른 계정 소유 (' + own + ')', '', kind === '폴더' ? '' : '-']);
      };
      var subs = folder.getFolders(); while (subs.hasNext()) add(subs.next(), '폴더');
      var files = folder.getFiles(); while (files.hasNext()) add(files.next(), '파일');
      row[7] = 'Y';
      continue;
    }
    // ② 요청 보내기 (시트는 다른 것이 모두 끝난 뒤)
    while (qi < rows.length && rows[qi][4] !== '대기') qi++;
    var k = qi;
    if (k >= rows.length) {
      k = -1;
      for (var j = 0; j < rows.length; j++) if (rows[j][4] === '마지막') { k = j; break; }
      if (k < 0) { done = true; break; }
    }
    try {
      var res = migrateRequest_(rows[k][0], to);
      rows[k][4] = res === '이미 넘어감' ? '받음' : '요청함';
      rows[k][5] = res === '이미 넘어감' ? '이미 새 계정 소유' : '';
    } catch (e) {
      rows[k][4] = '오류'; rows[k][5] = String(e.message || e).slice(0, 200);
    }
    rows[k][6] = nowText_();
  }
  migWrite_(sh, rows);
  migrateSchedule_('migrateSendResume', !done);
  var c = migCount_(rows); c._done = done;
  if (done) log_('관리', '계정 옮기기 요청', '', '', to + ' · ' + migCountText_(migCount_(rows)));
  return c;
}
function migrateSendMsg_(c, to) {
  var done = c._done; delete c._done;
  var lines = [done ? '넘기기 요청을 모두 보냈습니다.' : '아직 남았습니다. 1분 뒤 자동으로 이어서 합니다 (시트를 닫아도 됩니다).',
    '', '받는 계정: ' + to, '지금 상태: ' + migCountText_(c), '자세한 목록: 「' + MIG.TAB + '」 탭'];
  if (c['오류']) lines.push('', '오류가 난 항목은 이 메뉴를 다시 누르면 다시 시도합니다.');
  if (done) lines.push('', '다음: 새 계정으로 이 시트를 열고 [도면협의 → ⑦ 계정 옮기기 → 2. 소유권 받기]를 누르세요.',
    '(새 계정에 「소유권 이전」 알림 메일이 여러 통 갈 수 있습니다. 메일은 무시하고 메뉴로 받으면 됩니다.)');
  return lines.join('\n');
}

/* ── 2. 새 계정: 소유권 받기 ── */
function migrateAccept_() {
  var ui = SpreadsheetApp.getUi(), me = myEmail_(), to = props_().getProperty('MIGRATE_TO') || '';
  var sh = ss_().getSheetByName(MIG.TAB);
  if (!sh || sh.getLastRow() < 2) { ui.alert('먼저 기존 계정에서 [⑦ 계정 옮기기 → 1. 소유권 넘기기 요청]을 해 주세요.'); return; }
  if (to && me && to !== me) { ui.alert('이 메뉴는 새 계정(' + to + ')으로 시트를 열어서 눌러 주세요.\n지금 계정: ' + me); return; }
  var rows = migRows_(sh);
  var waiting = rows.some(function (r) { return r[4] === '대기' || r[4] === '마지막' || (r[1] === '폴더' && r[7] !== 'Y' && r[4] !== '건너뜀'); });
  if (waiting) { ui.alert('기존 계정의 넘기기 요청이 아직 끝나지 않았습니다.\n「' + MIG.TAB + '」 탭에 「대기」가 없어진 뒤 다시 눌러 주세요.'); return; }
  var c = migrateAcceptRun_();
  var done = c._done; delete c._done;
  ui.alert('계정 옮기기 2/2 (새 계정)', [done ? '소유권을 모두 받았습니다.' : '아직 남았습니다. 1분 뒤 자동으로 이어서 합니다.',
    '', '지금 상태: ' + migCountText_(c), '자세한 목록: 「' + MIG.TAB + '」 탭',
    done ? '\n다음: [3. 이전 점검]으로 빠진 파일이 없는지 확인한 뒤, 이 계정에서 새 배포를 만드세요 (설치 안내 「계정 옮기기」).' : ''].join('\n'), ui.ButtonSet.OK);
}
function migrateAcceptResume(e) { if (fromTrigger_(e)) migrateAcceptRun_(); }

function migrateAcceptRun_() {
  var t0 = Date.now(), me = myEmail_(), sh = migTab_(MIG.TAB, MIG.HEAD, false), rows = migRows_(sh), done = true;
  var todo = function (r) { return r[4] === '요청함' || r[4] === '받기 오류'; };
  // 시트는 맨 마지막에 받음
  var order = [];
  rows.forEach(function (r, i) { if (todo(r) && r[1] !== '시트') order.push(i); });
  rows.forEach(function (r, i) { if (todo(r) && r[1] === '시트') order.push(i); });
  for (var n = 0; n < order.length; n++) {
    if (Date.now() - t0 >= MIG.BUDGET) { done = false; break; }
    var r = rows[order[n]];
    try {
      var res = migrateTake_(r[0], me);
      r[4] = res === '받음' ? '받음' : '받지 못함'; r[5] = res === '받음' ? '' : res;
    } catch (e) {
      r[4] = '받기 오류'; r[5] = String(e.message || e).slice(0, 200);
    }
    r[6] = nowText_();
  }
  migWrite_(sh, rows);
  migrateSchedule_('migrateAcceptResume', !done);
  if (done) log_('관리', '계정 옮기기 받기', '', '', me + ' · ' + migCountText_(migCount_(rows)));
  var c = migCount_(rows); c._done = done;
  return c;
}

/* ── 3. 이전 점검 ── */
/** 시트에 적힌 드라이브 ID 모으기: 사진 {"f":…}, 링크 /d/…, ?id=…, "fileId":… */
function migrateRefs_() {
  var refs = {}, ss = ss_();
  [APP.SHEETS.STORES, APP.SHEETS.REVIEWS, APP.SHEETS.DELETED].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
    var head = vals[0];
    for (var i = 1; i < vals.length; i++) for (var j = 0; j < vals[i].length; j++) {
      var v = String(vals[i][j] || '');
      if (v.length < 20) continue;
      var re = /"f"\s*:\s*"([-\w]{20,})"|"fileId"\s*:\s*"([-\w]{20,})"|\/d\/([-\w]{20,})|[?&]id=([-\w]{20,})/g, m;
      while ((m = re.exec(v))) {
        var id = m[1] || m[2] || m[3] || m[4];
        if (!refs[id]) refs[id] = name + ' · ' + head[j];
      }
    }
  });
  return refs;
}

function migrateCheck_() {
  var t0 = Date.now(), me = myEmail_(), ss = ss_(), list = [];
  list.push([ss.getId(), '시트 (Apps Script 포함)']);
  ['photo', 'pdf', 'guide', 'backup'].forEach(function (k) {
    var f = appFolder_(k, true);
    if (f) list.push([f.getId(), '앱 폴더']);
  });
  var refs = migrateRefs_();
  Object.keys(refs).forEach(function (id) { list.push([id, refs[id]]); });
  var out = [], c = { '이 계정 소유': 0, '다른 계정 소유': 0, '휴지통': 0, '찾을 수 없음': 0, '시간 부족으로 확인 못 함': 0 }, others = {};
  list.forEach(function (it) {
    if (Date.now() - t0 > MIG.BUDGET) { c['시간 부족으로 확인 못 함']++; out.push([it[0], it[1], '', '', '시간 부족으로 확인 못 함']); return; }
    var item = null;
    try { item = DriveApp.getFileById(it[0]); } catch (e) { try { item = DriveApp.getFolderById(it[0]); } catch (e2) { item = null; } }
    if (!item) { c['찾을 수 없음']++; out.push([it[0], it[1], '', '', '찾을 수 없음']); return; }
    var own = ownerEmail_(item), verdict;
    if (item.isTrashed()) verdict = '휴지통';
    else if (me && own === me) verdict = '이 계정 소유';
    else { verdict = '다른 계정 소유'; others[own || '(알 수 없음)'] = 1; }
    c[verdict]++;
    out.push([it[0], it[1], item.getName(), own, verdict]);
  });
  var sh = migTab_(MIG.CHECK_TAB, MIG.CHECK_HEAD, true);
  if (out.length) {
    ensureSize_(sh, out.length + 1, MIG.CHECK_HEAD.length);
    sh.getRange(2, 1, out.length, MIG.CHECK_HEAD.length).setNumberFormat('@').setValues(out);
  }
  var hasBackup = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'backupDaily'; });
  var lines = ['지금 계정: ' + (me || '(알 수 없음)'), '',
    '확인한 항목 ' + out.length + '개 (시트에 적힌 사진·협의서·PDF 링크 + 앱 폴더 4개 + 시트)'];
  Object.keys(c).forEach(function (k) { if (c[k] || k === '이 계정 소유') lines.push(' · ' + k + ': ' + c[k]); });
  if (Object.keys(others).length) lines.push('   다른 계정: ' + Object.keys(others).join(', '));
  lines.push('', '자동 백업 예약 (이 계정): ' + (hasBackup ? '✓ 있음' : '✗ 없음 → [③ 자동 백업 켜기]'));
  lines.push('시방서 보내는 주소 ' + APP.SPEC_FROM + ': ' + (fromAliasOk_() ? '✓ 이 계정 Gmail에 등록됨' : '✗ 등록 안 됨 (계정 주소로 보내고 답장은 nate로 받음)'));
  var msh = ss.getSheetByName(MIG.TAB);
  if (msh && msh.getLastRow() > 1) lines.push('계정이전 탭: ' + migCountText_(migCount_(migRows_(msh))));
  lines.push('', '자세한 목록: 「' + MIG.CHECK_TAB + '」 탭');
  var ui = migUi_(); if (ui) ui.alert('이전 점검', lines.join('\n'), ui.ButtonSet.OK);
  return { counts: c, rows: out.length, others: Object.keys(others), hasBackup: hasBackup };
}
