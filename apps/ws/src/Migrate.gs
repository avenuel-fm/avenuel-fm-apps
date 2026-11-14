/* ───────────────────────── Supabase 이관 4단계: 시트 → DB 한 번 옮기기 (docs/설계/WS_Supabase이관.md 4.15) ─────────────────────────
   바꿔 타는 날 시트 메뉴 「⑩ Supabase로 옮기기」로 돌림. 다시 돌리면 DB를 비우고 처음부터 다시 옮김 (그래서 바꿔 탄 뒤에는 돌리지 않음).
   필요: 스크립트 속성 SUPABASE_URL · SUPABASE_SERVICE_KEY (service_role 키 — 사용자가 직접 넣음, 화면·채팅에 쓰지 않음)
         Supabase에서 supabase/09_migrate.sql 실행 (ws_migrate_clear)
   파일: 드라이브에 있는 그대로 두고 files 표에 드라이브 주소 · is_archived = true 로 적음 (5단계 옮기기 대상 아님).
         앱이 로그인 없이 보이게 하려면 메뉴 「⑪ 옛 파일 링크 공유」를 끝까지 돌림 (지금 PDF처럼 「링크가 있는 사람 보기」) */

const MIG_BATCH = 500;

function migrateMenu_() {
  const ui = SpreadsheetApp.getUi();
  const yes = ui.alert('Supabase로 옮기기', '시트의 모든 자료를 Supabase DB로 옮깁니다.\n\nDB에 있던 자료는 지우고 다시 씁니다 — 바꿔 타는 날 한 번만 돌리세요.\n(시트는 그대로 남습니다)\n\n계속할까요?', ui.ButtonSet.YES_NO);
  if (yes !== ui.Button.YES) return;
  const r = migrateSheetToSupabase();
  ui.alert('Supabase로 옮기기', '끝났습니다.\n\n' + r.lines.join('\n') + '\n\n다음: 메뉴 「⑪ 옛 파일 링크 공유」를 「끝」이 나올 때까지 돌리세요.', ui.ButtonSet.OK);
}

function migrateSheetToSupabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const T = migrateBuild_();
    migrateRpc_('ws_migrate_clear', {});
    const lines = [];
    T.forEach(function (t) {
      for (let i = 0; i < t[1].length; i += MIG_BATCH) migratePost_(t[0], t[1].slice(i, i + MIG_BATCH));
      lines.push(t[0] + ' ' + t[1].length);
    });
    log_('관리자(시트)', 'Supabase로 옮기기', '', lines.join(', '));
    return { ok: true, lines: lines };
  } finally {
    lock.releaseLock();
  }
}

/* ── 보내기 (service_role: 보안 규칙(RLS)을 건너뜀 — 그래서 키는 스크립트 속성에만) ── */
function migrateConf_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''), key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !key) throw new Error('스크립트 속성 SUPABASE_URL · SUPABASE_SERVICE_KEY 를 먼저 넣어 주세요.');
  return { url: url, key: key };
}
/* Supabase 부르기 (관리자 열쇠). 2xx 가 아니면 멈춤 — 5단계(Archive.gs)도 씀 */
function sbReq_(method, path, body, headers) {
  const c = migrateConf_();
  const o = { method: method, muteHttpExceptions: true, headers: Object.assign({ apikey: c.key, Authorization: 'Bearer ' + c.key }, headers || {}) };
  if (body !== undefined) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(c.url + path, o);
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(path.split('?')[0] + ' 실패 (' + code + '): ' + String(res.getContentText()).slice(0, 300));
  return res;
}
function migrateFetch_(path, body, prefer) { sbReq_('post', path, body, { Prefer: prefer || 'return=minimal' }); }
/* 드라이브 파일 → 앱이 쓰는 주소 (사진·서명은 그림 주소, PDF·엑셀은 보기 주소) */
function driveFileUrl_(kind, id) { return /_pdf$|_xlsx$/.test(kind) ? driveUrl_(id) : 'https://lh3.googleusercontent.com/d/' + id; }
function migrateRpc_(fn, args) { migrateFetch_('/rest/v1/rpc/' + fn, args); }
function migratePost_(table, rows) { if (rows.length) migrateFetch_('/rest/v1/' + table, rows); }

/* ── 값 바꾸기: 시트 글자(한국 시각) → DB ── */
function migTs_(s) {
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s || '').trim());
  return m ? m[1] + 'T' + (m[2] || '00') + ':' + (m[3] || '00') + ':' + (m[4] || '00') + '+09:00' : null;
}
function migDate_(s) { const m = /^\d{4}-\d{2}-\d{2}/.exec(String(s || '').trim()); return m ? m[0] : null; }
function migNum_(s) { const v = String(s == null ? '' : s).replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null; }
function migInt_(s, d) { const n = migNum_(s); return n === null ? (d === undefined ? null : d) : Math.round(n); }
function migYes_(s) { return String(s || '').trim().toUpperCase() === 'Y'; }
function migLive_(s) { return String(s || '').trim().toUpperCase() !== 'N'; }
function migText_(s) { const v = String(s == null ? '' : s); return v === '' ? null : v; }
/* 드라이브 파일 번호 → files 표 줄 번호 (같은 번호면 늘 같은 uuid — 다시 돌려도 같음) */
function migUuid_(id) {
  const h = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ws-file:' + id)).slice(0, 32);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32);
}

/** 시트 전체 → [[표 이름, 줄들], …] (넣는 순서대로: files 먼저, 그다음 files·staff를 가리키는 표) */
function migrateBuild_() {
  const files = {};
  const file = function (id, kind) {
    id = String(id || '').trim();
    if (!/^[\w-]{4,}$/.test(id)) return null;
    if (!files[id]) {
      files[id] = { id: migUuid_(id), kind: kind, file_url: driveFileUrl_(kind, id), storage_path: null,
        mime: /_pdf$/.test(kind) ? 'application/pdf' : /_xlsx$/.test(kind) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : (kind === 'sign' || /_(memo|name)$/.test(kind)) ? 'image/png' : 'image/jpeg',
        drive_id: id, is_archived: true, created_by: '시트에서 옮김' };
    }
    return files[id].id;
  };
  const tab = function (name) { const sh = db_().getSheetByName(name); return sh ? readTable_(name).rows : []; };
  // 같은 열쇠(PK·unique)가 두 줄이면 하나만: 쓰는 줄(live) 먼저, 같으면 뒤 줄
  const uniq = function (rows, key, live) {
    const m = {};
    rows.forEach(function (r) { const k = key(r), o = m[k]; if (!o || (live(r) || !live(o))) m[k] = r; });
    return rows.filter(function (r) { return m[key(r)] === r; });
  };
  const all = function () { return true; };

  const settings = uniq(tab('설정').filter(function (r) { return r['키']; }), function (r) { return r['키']; }, all)
    .map(function (r) { return { key: r['키'], value: String(r['값']), note: migText_(r['설명']) }; });
  const staff = uniq(tab('직원').filter(function (r) { return r['staff_id']; }), function (r) { return r['staff_id']; }, function (r) { return migLive_(r['사용여부']); })
    .map(function (r) { return { staff_id: r['staff_id'], name: r['이름'], part: migText_(r['파트명']), role: r['역할'], pin_hash: migText_(r['pin_hash']), pin_salt: migText_(r['pin_salt']),
      active: migLive_(r['사용여부']), updated_at: migTs_(r['수정일시']) || migTs_(now_()) }; });
  const ids = {}; staff.forEach(function (s) { ids[s.staff_id] = 1; });
  const sid = function (v) { return ids[v] ? v : null; };   // 없는 직원 번호는 비움 (가리킬 줄이 없으면 DB가 거부)
  const changeLog = tab('변경기록').map(function (r) { return { at: migTs_(r['일시']) || migTs_(now_()), who: migText_(r['누가']), what: migText_(r['무엇을']), target_id: migText_(r['대상ID']), detail: migText_(r['내용']) }; });

  const signs = uniq(tab('서명').filter(function (r) { return r['sign_id'] && migDate_(r['근무일']); }), function (r) { return r['sign_id']; }, function (r) { return !migYes_(r['삭제여부']); });
  const oneDay = {};   // 같은 근무일·같은 사람 서명은 한 줄만 쓰는 중 (DB 규칙)
  const signRows = signs.map(function (r) {
    let del = migYes_(r['삭제여부']);
    const k = migDate_(r['근무일']) + '|' + r['staff_id'];
    if (!del) { if (oneDay[k]) del = true; oneDay[k] = 1; }
    return { sign_id: r['sign_id'], work_day: migDate_(r['근무일']), staff_id: sid(r['staff_id']), name: migText_(r['이름']), part: migText_(r['파트명']), sign_file_id: file(r['서명_id'], 'sign'),
      signed_at: migTs_(r['서명시각']) || migTs_(r['근무일']), via: migText_(r['들어온길']), tbm_used: migYes_(r['TBM사용']), deleted: del };
  });

  const nextWork = uniq(tab('명일작업').filter(function (r) { return migDate_(r['일자']) && migInt_(r['순번']) !== null; }), function (r) { return migDate_(r['일자']) + '|' + migInt_(r['순번']); }, all)
    .map(function (r) { return { work_date: migDate_(r['일자']), seq: migInt_(r['순번']), dept: migText_(r['부서']), place: migText_(r['작업장소']), work: migText_(r['작업내용']), note: migText_(r['비고']),
      edited_by: migText_(r['고친사람']), edited_at: migTs_(r['고친시각']) }; });

  const tbm = uniq(tab('TBM').filter(function (r) { return r['tbm_id'] && migDate_(r['근무일']); }), function (r) { return migDate_(r['근무일']); }, function (r) { return !migYes_(r['삭제여부']); })
    .map(function (r) { return { tbm_id: r['tbm_id'], work_day: migDate_(r['근무일']), author_id: migText_(r['작성자_id']), author_name: migText_(r['작성자명']),
      meet_file_id: file(r['회의사진_id'], 'tbm_meet'), chant_file_id: file(r['구호사진_id'], 'tbm_chant'), works: jsonOr_(r['작업표'], []), checks: jsonOr_(r['체크칸'], {}),
      sign_count: migInt_(r['서명수'], 0), pdf_file_id: file(r['pdf_id'], 'tbm_pdf'), pdf_at: migTs_(r['PDF만든시각']),
      created_at: migTs_(r['작성시각']) || migTs_(r['근무일']), updated_at: migTs_(r['수정시각']), deleted: migYes_(r['삭제여부']) }; });

  const risk = tab('위험성목록').filter(function (r) { return r['위험요인']; })
    .map(function (r, i) { return { r: r, o: migNum_(r['순서']), i: i }; })
    .sort(function (a, b) { return (a.o === null ? 1e9 : a.o) - (b.o === null ? 1e9 : b.o) || a.i - b.i; })
    .map(function (x, i) { const r = x.r; return { seq: i + 1, words: migText_(r['낱말']), risk: r['위험요인'], kind: migText_(r['재해형태']), likelihood: migInt_(r['가능성']), severity: migInt_(r['중대성']),
      fix1: migText_(r['개선조치1']), fix2: migText_(r['개선조치2']), fix3: migText_(r['개선조치3']), fix4: migText_(r['개선조치4']), active: migLive_(r['사용여부']) }; });

  // 종합업무일지: 과거자료 시트 → 새로 쓴 시트 (같은 날이면 새 것)
  const LOGMAP = { '영업시간': 'business_hours', '최저': 't_min', '최고': 't_max', '최고풍속': 'wind_max', '미세먼지': 'pm', '시수': 'm_city_water', '중수': 'm_grey_water',
    '식당시수': 'm_food_water', '식당온수': 'm_food_hot', '식당가스': 'm_food_gas', '식당분전반': 'm_food_panel', '식기세척분전반': 'm_dish_panel', '매점분전반': 'm_shop_panel',
    '급탕': 'm_hot_supply', '환탕': 'm_hot_return', '급탕탱크': 'm_hot_tank', '전기': 'electricity' };
  const logDays = {};
  [['일지과거시트ID', '종합업무일지_과거자료'], ['일지시트ID', '종합업무일지']].forEach(function (b) {
    if (!setting_(b[0])) return;
    logRows_(logBook_(b[0], b[1])).forEach(function (r) {
      const d = migDate_(r['일자']); if (!d) return;
      const o = { log_date: d, weather: migText_(r['날씨']), pm_grade: migText_(r['미세먼지등급']), weather_source: migText_(r['날씨출처']),
        work_elec: jsonOr_(r['작업_전기방재'], []), work_mech: jsonOr_(r['작업_기계건축'], []), night_file_id: file(r['야간그림_id'], 'log_night'),
        pdf_file_id: file(r['pdf_id'], 'log_pdf'), pdf_at: migTs_(r['PDF만든시각']), author: migText_(r['작성자']), editor: migText_(r['수정자']),
        updated_at: migTs_(r['수정시각']), deleted: migYes_(r['삭제여부']), note: migText_(r['비고']) };
      Object.keys(LOGMAP).forEach(function (k) { o[LOGMAP[k]] = migNum_(r[k]); });
      logDays[d] = o;
    });
  });

  const roster = uniq(tab('근무표').filter(function (r) { return /^\d{4}-\d{2}$/.test(r['월']) && migInt_(r['순서']) !== null; }), function (r) { return r['월'] + '|' + migInt_(r['순서']); }, function (r) { return !migYes_(r['삭제여부']); })
    .map(function (r) { return { ym: r['월'], seq: migInt_(r['순서']), section: migText_(r['구역']), role: migText_(r['직책']), name: migText_(r['이름']), days: jsonOr_(r['일별'], []),
      uploaded_by: migText_(r['올린사람']), uploaded_at: migTs_(r['올린시각']), deleted: migYes_(r['삭제여부']) }; });
  const rosterChanges = tab('근무변경').filter(function (r) { return migDate_(r['날짜']) && r['이름']; })
    .map(function (r) { return { day: migDate_(r['날짜']), name: r['이름'], old_value: migText_(r['원래값']), new_value: String(r['바꾼값'] == null ? '' : r['바꾼값']), changed_by: migText_(r['바꾼사람']),
      changed_at: migTs_(r['바꾼시각']) || migTs_(r['날짜']), deleted: migYes_(r['삭제여부']) }; });
  const holidays = uniq(tab('기본휴일').filter(function (r) { return r['이름']; }), function (r) { return r['이름']; }, all)
    .map(function (r) { return { name: r['이름'], weekday: migText_(r['요일']), changed_by: migText_(r['바꾼사람']), changed_at: migTs_(r['바꾼시각']) }; });

  const fire = uniq(uniq(tab('소화기').filter(function (r) { return r['fe_id']; }), function (r) { return r['fe_id']; }, function (r) { return migLive_(r['사용여부']); }),
    function (r) { return r['qr_token'] || r['fe_id']; }, function (r) { return migLive_(r['사용여부']); })
    .map(function (r) { return { fe_id: r['fe_id'], floor: migText_(r['층']), store_name: migText_(r['매장명']), store_id: migText_(r['store_id']), no: migText_(r['번호']), name: migText_(r['이름']),
      qr_token: migText_(r['qr_token']), active: migLive_(r['사용여부']), created_at: migTs_(r['등록일시']), created_by: migText_(r['등록자']), deleted_at: migTs_(r['삭제일시']) }; });
  const feIds = {}; fire.forEach(function (f) { feIds[f.fe_id] = 1; });
  const fireChecks = uniq(tab('소화기점검').filter(function (r) { return r['check_id'] && /^\d{4}-\d{2}/.test(r['연월']); }), function (r) { return r['check_id']; }, function (r) { return !migYes_(r['삭제여부']); })
    .map(function (r) { return { check_id: r['check_id'], ym: String(r['연월']).slice(0, 7), fe_id: feIds[r['fe_id']] ? r['fe_id'] : null, floor: migText_(r['층']), store_name: migText_(r['매장명']),
      fe_name: migText_(r['소화기이름']), state: migText_(r['상태']), photo_file_id: file(r['사진_id'], 'fire_photo'), memo_file_id: file(r['문구_id'], 'fire_memo'), name_file_id: file(r['이름_id'], 'fire_name'),
      entered_at: migTs_(r['입력일시']), late: migYes_(r['기한후입력']), overwrite_count: migInt_(r['덮어쓴횟수'], 0), deleted: migYes_(r['삭제여부']) }; });

  const ehStores = uniq(tab('전열매장').filter(function (r) { return r['es_id']; }), function (r) { return r['es_id']; }, function (r) { return migLive_(r['사용여부']); })
    .map(function (r) { return { es_id: r['es_id'], floor: migText_(r['층']), store_no: migText_(r['매장번호']), store_name: migText_(r['매장명']), active: migLive_(r['사용여부']),
      created_at: migTs_(r['등록일시']), created_by: migText_(r['등록자']), deleted_at: migTs_(r['삭제일시']) }; });
  const esIds = {}; ehStores.forEach(function (s) { esIds[s.es_id] = 1; });
  const ehDevices = uniq(uniq(tab('전열기기').filter(function (r) { return r['eh_id']; }), function (r) { return r['eh_id']; }, function (r) { return migLive_(r['사용여부']); }),
    function (r) { return r['qr_token'] || r['eh_id']; }, function (r) { return migLive_(r['사용여부']); })
    .map(function (r) { return { eh_id: r['eh_id'], es_id: esIds[r['es_id']] ? r['es_id'] : null, floor: migText_(r['층']), store_name: migText_(r['매장명']), mgmt_no: migText_(r['관리번호']),
      device_name: migText_(r['기기명']), watts: migNum_(r['용량W']), maker: migText_(r['제조사']), owner_main: migText_(r['책임자정']), owner_sub: migText_(r['책임자부']),
      approved_on: migDate_(r['승인일자']), qr_token: migText_(r['qr_token']), printed_at: migTs_(r['출력일시']), active: migLive_(r['사용여부']),
      created_at: migTs_(r['등록일시']), created_by: migText_(r['등록자']), updated_at: migTs_(r['수정일시']), deleted_at: migTs_(r['삭제일시']) }; });

  const csSites = uniq(tab('공사현장').filter(function (r) { return r['cs_id'] && r['현장명']; }), function (r) { return r['cs_id']; }, function (r) { return migLive_(r['사용여부']); })
    .map(function (r) { return { cs_id: r['cs_id'], name: r['현장명'], work: migText_(r['공사내용']), company: migText_(r['업체']), active: migLive_(r['사용여부']),
      created_at: migTs_(r['등록일시']), created_by: migText_(r['등록자']), ended_at: migTs_(r['끝낸일시']) }; });
  const csIds = {}; csSites.forEach(function (s) { csIds[s.cs_id] = 1; });
  // 점검 항목: 쓰는 것(순서대로) 먼저 1~n, 안 쓰는 것은 뒤로 (순서 번호가 겹쳐 있어도 됨)
  const csItems = tab('공사점검항목').filter(function (r) { return r['항목']; })
    .map(function (r, i) { return { r: r, live: migLive_(r['사용여부']), o: migNum_(r['순서']), i: i }; })
    .sort(function (a, b) { return (b.live - a.live) || ((a.o === null ? 1e9 : a.o) - (b.o === null ? 1e9 : b.o)) || a.i - b.i; })
    .map(function (x, i) { const r = x.r; return { seq: i + 1, item: r['항목'], descr: migText_(r['설명']), active: x.live, in_check: migYes_(r['점검사용']), changed_by: migText_(r['바꾼사람']), changed_at: migTs_(r['바꾼시각']) }; });
  const csChecks = uniq(tab('공사점검').filter(function (r) { return r['ck_id'] && migDate_(r['점검일']); }), function (r) { return r['ck_id']; }, function (r) { return !migYes_(r['삭제여부']); })
    .map(function (r) {
      const items = jsonOr_(r['항목'], []);
      (Array.isArray(items) ? items : []).forEach(function (x) { x.photos = (x.photos || []).map(function (p) { return { id: file(p.id, 'cs_photo') || '', at: p.at || '', n: p.n || 0 }; }).filter(function (p) { return p.id; }); });
      return { ck_id: r['ck_id'], check_day: migDate_(r['점검일']), cs_id: csIds[r['cs_id']] ? r['cs_id'] : null, site_name: migText_(r['현장명']), work: migText_(r['공사내용']), company: migText_(r['업체']),
        checker_id: migText_(r['점검자_id']), checker: migText_(r['점검자']), checked_at: migTs_(r['점검시각']), items: Array.isArray(items) ? items : [],
        n_good: migInt_(r['양호'], 0), n_bad: migInt_(r['미흡'], 0), n_na: migInt_(r['해당없음'], 0), photo_seq: migInt_(r['사진번호'], 0),
        pdf_file_id: file(r['pdf_id'], 'cs_pdf'), pdf_at: migTs_(r['PDF만든시각']), updated_at: migTs_(r['수정시각']), edited_by: migText_(r['고친사람']),
        deleted: migYes_(r['삭제여부']), round: migInt_(r['회차'], 1) || 1 };
    });
  // 같은 날·같은 현장·같은 회차가 둘이면 (DB는 막지 않지만 화면이 헷갈림) 뒤 것만 쓰는 중으로
  const csKey = {};
  csChecks.forEach(function (c) { if (c.deleted) return; const k = c.check_day + '|' + c.cs_id + '|' + c.round; if (csKey[k]) csKey[k].deleted = true; csKey[k] = c; });

  return [['files', Object.keys(files).map(function (k) { return files[k]; })], ['settings', settings], ['staff', staff], ['change_log', changeLog], ['signs', signRows],
    ['next_work', nextWork], ['tbm', tbm], ['risk_list', risk], ['daily_log', Object.keys(logDays).sort().map(function (d) { return logDays[d]; })],
    ['roster', roster], ['roster_changes', rosterChanges], ['default_holidays', holidays], ['fire_ext', fire], ['fire_checks', fireChecks],
    ['eh_stores', ehStores], ['eh_devices', ehDevices], ['cs_sites', csSites], ['cs_items', csItems], ['cs_checks', csChecks]];
}

/* ── 옛 파일 링크 공유: 앱(로그인 없는 휴대폰)에서 사진이 보이게. 5분씩 끊어 하고 어디까지 했는지 기억 → 「끝」까지 여러 번 ── */
function migrateShareMenu_() {
  const r = migrateShareFiles_();
  SpreadsheetApp.getUi().alert('옛 파일 링크 공유', r.done ? '끝 — 파일 ' + r.total + '개 모두 공유했습니다.' + (r.fail ? '\n(찾지 못한 파일 ' + r.fail + '개는 건너뜀)' : '')
    : r.at + ' / ' + r.total + '개 했습니다. 메뉴를 한 번 더 눌러 이어서 하세요.', SpreadsheetApp.getUi().ButtonSet.OK);
}
function migrateShareFiles_(budgetMs) {
  const p = PropertiesService.getScriptProperties();
  const list = migrateBuild_()[0][1].map(function (f) { return f.drive_id; });
  let at = Number(p.getProperty('MIGRATE_SHARE_AT')) || 0, fail = Number(p.getProperty('MIGRATE_SHARE_FAIL')) || 0;
  const end = Date.now() + (budgetMs == null ? 300000 : budgetMs);
  while (at < list.length && Date.now() < end) {
    try { DriveApp.getFileById(list[at]).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { fail++; }
    at++;
    if (at % 50 === 0) { p.setProperty('MIGRATE_SHARE_AT', String(at)); p.setProperty('MIGRATE_SHARE_FAIL', String(fail)); }
  }
  p.setProperty('MIGRATE_SHARE_AT', String(at)); p.setProperty('MIGRATE_SHARE_FAIL', String(fail));
  return { done: at >= list.length, at: at, total: list.length, fail: fail };
}
