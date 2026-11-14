# DW · Supabase 이관 (도면협의: 구글 시트 → Supabase DB, 파일 → Supabase Storage → 주 1회 구글 드라이브)

- 판: **v1.0 (코드·시험 완료, 바꿔 타기 전)** · 수정 2026-11-14 · 기준 코드 도면협의 **v1.9.0** · 결정 **115**
- **이럴 때 읽기**: 도면협의 자료를 Supabase 로 옮기는 일, 바로가기 앱(`fm/dw/app.html`), 주 1회 드라이브 보관을 다룰 때
- 업무지원 이관(`WS_Supabase이관.md`, 결정 122)과 **같은 방식**. 업무지원에서 사용자가 답한 것을 그대로 따름: 같은 Supabase 프로젝트, 기기마다 시설팀 공용 계정 한 번 + PIN, 공개 버킷, 따로 갈래(`dw-supabase`), 주 1회 드라이브 보관 + DB 백업
- 로그인은 **소장·부소장 PIN 2개 그대로** (결정 36). 근무일 첫 서명은 DW 에 없음

## 1. 한눈에

| | 지금 (구글) | 바꿔 탄 뒤 (Supabase) |
|---|---|---|
| 화면 | 구글 웹앱 `/exec` (바로가기 페이지 안 창) | 바로가기 페이지 `fm/dw/app.html` 이 바로 엶 (화면 코드는 같은 `App.html`) |
| 자료 | 시트 `매장`·`검토서`·`준수사항` … | DB 표 `dw_*` (함수로만 읽고 씀) |
| 파일 | 드라이브 `도면협의_사진`·`_출력`·`_지침` | 버킷 `dw-files` → **8일 지나면** 드라이브 같은 폴더로 (주 1회) |
| 메일 | Gmail | **그대로 Gmail** (화면 → 구글 웹앱 → 메일, DB 에 발송 기록) |
| PDF 보기 | 새 창 (휴대폰이 구글 계정을 물음) | **앱 안에서 봄** (확대·내려받기·공유) |
| 백업 | 매일 시트 사본 | 주 1회 표마다 CSV (`도면협의_백업`, 30일) |

## 2. 파일

| 파일 | 내용 |
|---|---|
| `apps/dw/supabase/01_schema.sql` | 표 `dw_stores`(매장, `data` jsonb = 시트 열 이름 그대로) · `dw_reviews`(차수) · `dw_rules` · `dw_phrases` · `dw_synonyms` · `dw_log` · `dw_deleted` · `dw_settings` · `dw_sign_tokens` · `dw_guides` · `dw_guide_build` · `dw_files`. 공개 버킷 `dw-files`. 표는 anon·authenticated 모두 직접 못 읽음 |
| `02_const.sql` | `dw_const()` = Code.gs 의 항목·준수사항·문구·비슷한말·문서 이름… (**자동 생성**: `node apps/dw/tools/gen_const_sql.js`, Code.gs 를 고치면 다시) |
| `03_api.sql` | 화면이 부르는 함수 (`dw_login`·`dw_start`·`dw_save_review`·`dw_file`·`dw_guide_*`·`dw_sign_info`/`submit` …). 첫 값 `p_a` = {role, token} |
| `04_service.sql` | 구글 스크립트만 (service_role): 메일 기록, PIN·바로가기 주소 반영, 옮기기, 백업, 연결 확인 |
| `apps/dw/src/Supa.gs` | 구글 쪽: 메일·옛 드라이브 파일 통로(`doPost {api:'dw'}`), 시트 메뉴 ⑨(옮기기·주 1회·확인) |
| `fm/dw/config.js` | 바꿔 타는 날 스위치 `LIVE` + 공개 키 (service_role 키는 **절대 여기 없음**) |
| `fm/dw/dw-api.js` | 화면의 `api('apiXxx')` → DB 함수·버킷. Code.gs 와 같은 이름·같은 답 모양 |
| `fm/dw/app.html` | **자동 생성** (`python apps/dw/tools/build_fm.py`): Index + Styles + App |
| `fm/dw/index.html` | `LIVE` 가 true 면 `app.html` 로 (`?store=` `?sign=` 그대로) |

## 3. 로그인 · 보안

1. **기기 등록**: 기기마다 처음 한 번 시설팀 공용 계정(이메일·비밀번호, 업무지원과 같은 계정). 로그인 화면 아래 「기기 등록 풀기」.
2. **PIN**: 값은 지금과 같은 해시(`sha256('drawing-review:'+PIN)`), 기기 기억 표(token)도 같은 계산 → 옮긴 뒤에도 PIN·기억 그대로.
3. PIN 은 `dw_login`·`dw_start` 만 받고 나머지는 표만. 틀린 PIN **10분에 20번 → 10분 잠금, 6시간 안 3번째 잠금은 1시간** (결정 39 그대로, DB `PIN_FAIL`).
4. 시트 메뉴 ② PIN 바꾸기·⑧ 바로가기 주소는 바꿔 탄 뒤에도 그대로 쓰고, DB 에도 같이 넣음.
5. 원격 서명 링크(`?sign=`)는 기기 등록 없이 열림 (`dw_sign_info`·`dw_sign_submit` 만 비로그인 허용, 7일).

## 4. 파일 흐름

- 화면이 버킷에 올림 (`photo/2026-11/…jpg`, `pdf/…`, `guide/{지침}/…`) → DB `dw_files` 에 이름·드라이브 폴더(`photo/문서번호` 등) 기록.
- **주 1회 (일 새벽 4시, 메뉴 ⑨-2)**: 8일 지난 파일 → 드라이브 같은 폴더(이름 `YYYY-MM-DD_작업명_###` 그대로), DB 에 드라이브 번호 기록 → 그다음에만 버킷에서 지움. 8일 = 서명 링크 7일이 끝난 뒤. 지침 쪽 그림은 옮기지 않음(검색 화면이 자주 씀). 지운 파일 정리, 버킷에만 남은 파일(2일) 정리, CSV 백업, 만료 서명표 정리.
- 드라이브로 옮긴 파일·옛 파일은 화면이 구글 웹앱 통로로 받음(5MB 씩, 도면협의 폴더 안 파일만) → **링크 공유 안 해도 됨**.
- 옛 사진·협의서 번호(드라이브 번호)는 그대로 둬도 찾힘.

## 5. 앱 안 PDF 보기 (업무지원과 같음)

[열기]·[PDF 열기]·서명 페이지 [검토서 PDF 보기] → 앱 안 화면(pdf.js): 쪽 맞춤 / 150·200·300%, 내려받기, 공유(휴대폰 공유 창, PC 는 링크 복사), 뒤로. 못 불러오면 「다시 시도」·「새 창에서 열기」. 구글 판(지금)은 예전처럼 새 창.

## 6. 바꿔 타는 날 (사용자 순서)

1. Supabase 웹 → SQL Editor 에서 `apps/dw/supabase/01` → `02` → `03` → `04` 차례로 실행 (두 번 해도 됨).
2. 도면협의 구글 스크립트 **프로젝트 설정 → 스크립트 속성**: `SUPABASE_URL` = `https://kjhsduhufwaihhlfdipf.supabase.co`, `SUPABASE_SERVICE_KEY` = service_role 키 (**사용자가 직접**, 업무지원과 같은 값). 
3. 코드 올리기 + 배포(기존 배포 ID 새 버전) — `apps/dw/설치_및_테스트_안내.md` 맨 위.
4. 시트 메뉴 **⑨-3 연결 확인** → **⑨-1 옮기기** (끝나면 `SUPABASE_LIVE=Y`, 이때부터 옛 `/exec` 는 「새 주소로 열기」).
5. 바로가기 저장소 `fm/dw/config.js` `LIVE: true` 로 올림 → 휴대폰에서 기기 등록·PIN·매장·PDF 확인.
6. **⑨-2 주 1회 켜기**.
- 되돌리기: `LIVE: false` (옛 구글 앱). 단 옮긴 뒤 Supabase 에 쓴 내용은 시트에 없음.

## 7. 시험

`apps/dw/test` 에서 (PGlite·Playwright 는 업무지원 `apps/ws/node_modules` 를 같이 씀):
- `node sb_sql_test.js` — SQL 01~04 실제 실행, 보안·로그인·잠금·저장·파일·지침·서명·옮기기·백업 **84개**
- `node sb_ui_test.js` — `fm/dw/app.html` 휴대폰 화면 + 진짜 SQL: 기기 등록 → PIN → 매장 → 앱 안 PDF 보기 → 기기 등록 풀기 **17개**
- `node gas_test.js` — 구글 쪽 (Supa.gs 포함) **266개**

## 8. 뒤로 미룬 것

- 앱 사이 통로(`?api=summary`·`stores`·`defect`)는 아직 시트 자료 → HUB 만들 때 DB 로.
- 지침 색인 만드는 도중(`GUIDE_BUILDING`)인 것은 옮기지 않음 → 옮기기 전에 끝내 둘 것.
- 드라이브에 이미 있는 검토서 PDF 는 `dw_files` 에 넣지 않음 (보기 화면이 드라이브 주소를 알아보고 통로로 받음).
