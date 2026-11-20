# WS · 점검 › 열화상점검

- 판: **v0.3 (결정 166·168 · 업무지원 v0.19.5 · 웹 전환 연동 규격·업무지원 쪽 준비 3장)** · 수정 2026-11-19
- **이럴 때 읽기**: 열화상점검 메뉴, FLIR 열화상 보고서(.atr) 작성기(`apps/thermal-reporter`)를 다룰 때
- 목차·읽는 법: `docs/설계/00_목차_읽는법.md`

> **요약**
> - [점검] 메뉴의 세 번째 줄(전열필증 아래, 공사장 점검 위).
> - **직원**: 이름만 흐리게 보이고 눌리지 않음. **소장·부소장·관리자·옵저버**: 눌러서 안내 화면을 엶 (결정 166). 메인 메뉴 끄기(결정 148)와 따로 정함 — 부소장도 엶.
> - 안내 화면: 「준비 중 · 지금은 사무실 PC에서만」, 하는 일, PC에서 `run.bat`로 쓰는 법.

## 1. 작성기 (PC 프로그램, `apps/thermal-reporter/`)
- 넣는 것: FLIR 열화상 사진(.jpg, 이름 예 `1층1번_일반.jpg`), 보고서 제목, 측정자, 날짜.
- 하는 일: 사진마다 점 3개(R·S·T상) 자동 배치 → 온도·상간 온도차(ΔT). 점은 화면에서 끌어 옮김. 예전 보고서(.atr)로 점 위치 학습.
- 나오는 것: FLIR Thermal Studio 보고서(.atr). 양식은 `templates/master_template.atr`(2026년 4분기 EPS 1층).
- 실행: FLIR Thermal Studio 부품(`engine/` DLL, 약 385MB)이 있는 윈도우 PC에서 `run.bat` → `http://127.0.0.1:8765`. 파이썬 필요.
- 휴대폰·태블릿·구글 웹앱에서는 직접 열 수 없음 (이 PC에서만 열림).

## 2. 작업 방식 (사용자 11-19)
- 작성기 코드는 **안티그라비티**가 고치고, Claude Code 세션([점검]-[열화상점검])이 할 일을 정리해 지시문을 쓰고 결과를 검사함.
- 저장소에 올릴 때 `engine/` FLIR 부품·`temp/` 사진은 빼야 함 (FLIR 사용 허락·용량). 작성기는 아직 저장소에 없음.

## 3. 웹 전환 · 업무지원 연동 규격 (준비, 11-19)
사용자 11-19: 작성기를 PC 프로그램 → 웹에서 단독 실행으로 바꾸는 중(안티그라비티). 자료는 Supabase, 만든 파일은 PC로 내려받기 또는 구글 드라이브로. 끝나면 업무지원에 붙임. 붙일 때 다시 고치지 않도록 아래 규격으로 만듦. **지도(결정 130)와 같은 방식.**

| 항목 | 정한 것 |
|---|---|
| 파일 자리 | `fm/thermal/` (`index.html` + 필요한 js·css). 만들기 단계 없는 정적 파일. 파이썬 서버·`engine/` FLIR 부품 없이 브라우저에서만 |
| 여는 법 | 업무지원 [점검 › 열화상점검]이 `../thermal/index.html`을 화면 안 창(`iframe`)으로 띄움. 주소창은 업무지원 그대로, 「뒤로」는 업무지원이 그림 |
| 로그인 | 작성기에는 로그인 없음. 업무지원 PIN 로그인을 그대로 씀. 권한(소장·부소장·관리자·옵저버)은 업무지원이 거름 |
| 자료 통로 | 작성기는 Supabase에 **직접 붙지 않고** 부모 창의 `window.parent.WS_THERMAL`만 부름 (지도 `WS_MAP`과 같음). 업무지원이 PIN 로그인 표로 `ws_thermal_*` 함수를 부름 → 공개 키로 표를 열어 두는 일 없음 |
| 단독 시험 | 부모가 없으면(`window.parent === window`) `fm/thermal/mock_bridge.js`의 가짜 통로로 돎 (브라우저 저장소). 실제 자료는 안 씀 |
| 내려받기 | `.atr`는 브라우저에서 zip으로 만들어 바로 내려받음. 라이브러리는 cdnjs 고정 판(예: JSZip 3.10.1) |
| 구글 드라이브 | 2단계. 업무지원 구글 서버(`WS_GAS_URL`)가 드라이브 폴더에 넣음 — 작성기는 `WS_THERMAL.toDrive()`만 부름 |
| 디자인 | 공통 디자인 `apps/design/tokens.css` 값 (결정 150). 바탕 흰색, 남색 `#1E3A5F` |
| 화면 크기 | 업무지원 창 안에서 휴대폰(390px)·태블릿·PC 모두. 넘치는 가로 스크롤 없음 |

**`WS_THERMAL` 통로 (업무지원이 만듦, 모두 Promise)**
| 이름 | 하는 일 | 돌려주는 것 |
|---|---|---|
| `me()` | 지금 로그인한 사람 | `{ name, role }` |
| `boot()` | 처음 열 때 한 번 | `{ model, template_url, reports }` — 점 위치 학습 값, 양식 .atr 주소, 최근 보고서 목록 |
| `saveModel(model)` | 점 위치 학습 값 저장 (JSON) | `{ ok }` |
| `saveTemplate(t)` | 양식 .atr 바꾸기: `upload()` 결과에 `name`을 붙여 넘김 `{ path, url, name }` | `{ ok }` |
| `upload(blob, name)` | 사진·양식·보고서 파일 올리기 (Storage `ws-files/thermal/…`). **줄이지 않고 원본 그대로** (줄이면 온도 자료가 사라짐), 확장자는 `name`에서 | `{ path, url }` |
| `saveReport(r)` | 만든 보고서 기록 `{ title, inspector, date, path, pages, max_dt }` | `{ ok, id }` |
| `toDrive(path, name)` | 2단계: 구글 드라이브로 옮기기 | `{ ok, url }` |
| `full(on)` | 화면 가득 켜기·끄기 | — |

**업무지원 쪽 준비 — 11-19 만들어 둠 (결정 168, 갈래 `claude/thermal-menu`, 아직 배포 안 함)**
- `apps/ws/supabase/16_thermal.sql`: 표 `thermal_kv`(model·template) · `thermal_report`(보고서 기록), 함수 `ws_thermal_boot` · `ws_thermal_set` · `ws_thermal_report`. 표는 직접 못 읽고 함수로만, 소장·부소장·관리자·옵저버만 (직원은 서버에서도 막음). 보고서·양식 경로는 `thermal/`로 시작해야 함
- `fm/ws/ws-api.js`: `thermalBoot` · `thermalSet` · `thermalReport`, `upload(kind, blob, ext)` — `ext`를 주면 줄이지 않음
- `Index.html`: `window.WS_THERMAL` 통로. 바로가기 앱(Supabase)에서는 [열화상점검]이 `../thermal/index.html`을 지도처럼 화면 안 창으로 엶 (「뒤로」는 왼쪽 아래 작은 버튼). 구글 웹앱에서는 지금처럼 안내 화면
- 붙이는 날: ① 작성기 `fm/thermal/` 검사 ② Supabase에서 `16_thermal.sql` 실행 ③ 업무지원 판 올려 배포 ④ 바로가기 저장소에 `fm/thermal/` · `fm/ws/app.html` · `fm/ws/ws-api.js` 올리기 ⑤ 소장 계정으로 양식 .atr 한 번 올리기

**확인할 위험**: FLIR 사진 안 온도 자료를 읽는 일은 브라우저에서도 됨(원시 열 자료 + 플랑크 상수). 점 3개 위치를 **사진(jpg) 안에 다시 써 넣는 일**은 FLIR 부품 없이 어려움 — 안 되면 Thermal Studio에서 점이 안 보이거나 온도가 다를 수 있으니 실제 프로그램으로 열어 확인.

## 3-1. 작성기 웹판 검사 (11-20, 업무지원 v0.20.3)
- 위치 `fm/thermal/` (`index.html`·`app.js`·`flir_parser.js`·`atr_generator.js`·`spot_model.js`·`mock_bridge.js`·`styles.css`). 파이썬·FLIR 부품 없이 브라우저만. 라이브러리 pako 2.1.0·JSZip 3.10.1(cdnjs).
- 양식 `master_template.atr`(약 6.9MB, 건물 설비 사진 포함)은 **공개 저장소에 올리지 않음** (`.gitignore`). 소장이 처음 한 번 올리면 Supabase `thermal_kv.template`에 저장, 이후 `boot().template_url`로 받음. 못 받으면 「양식 파일 선택」 안내.
- 시험(11-20): 업무지원 창(iframe)에 넣고 가짜 통로로 — 양식 없음 안내 → 양식 올리기(`upload`+`saveTemplate`) → 사진 3장 → .atr 다운로드 + `upload`·`saveReport`(3쪽, 최대 ΔT) 호출 확인. 만든 .atr: 사진 칸 3개, 측정자·날짜 들어가고 옛 이름·옛 날짜 없음, zip 이상 없음.
- 온도 비교(옛 FlirTool vs 브라우저, 같은 위치): 2장은 소수 첫째 자리까지 같음, **1장은 0.6℃ 낮게 나옴**(28.9 ↔ 28.3 — 방사율·반사온도·거리 값 적용 차이로 추정). 사진에 점이 없던 5장은 위치가 달라 비교 못 함. → 4장 남은 일.

## 4. 남은 일
- 양식 칸 8개 고정: 사진이 8장보다 적으면 옛 사진이 남고, 많으면 9장째부터 빠짐.
- 쪽마다 회로 이름이 양식의 옛 이름으로 남음.
- `temp/` 사진이 계속 쌓임.
- 화면 디자인 값을 공통 디자인(결정 150)에 맞추기.
- **온도 오차**: 일부 사진에서 옛 값보다 0.6℃ 낮음 — 사진 안 물체 방사율·반사온도·거리·대기 값을 계산에 쓰는지 확인(`flir_parser.js` `FlirCalculator`). FLIR Thermal Studio에서 같은 사진 값과 비교.
- 8장 넘는 사진 제한·구글 드라이브 옮기기(`toDrive`)는 아직.
