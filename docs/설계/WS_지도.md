# WS 지도 (에비뉴엘 도면 앱) — 설계 v0.1

- 결정 130 (2026-11-17). 업무지원 v0.12.0.
- 원래 앱: 「롯데 잠실 쇼핑맵 뷰어 & CAD 에디터」(전: `C:\avenuel\lotte_map_handover`). 인계 문서 `apps/map/SESSION_HANDOVER.md`.

## 1. 무엇을 하나
- 업무지원 메인의 6번째 칸(환경설정 바로 위, 전: 결재/내 서류 「작업중」)이 **「지도」**.
- 누르면 도면 앱이 **업무지원 화면 안에** 꽉 차게 열림(`iframe`). 주소창은 업무지원 주소 그대로.
- 도면 앱 기능은 그대로: 층 보기, 매장·기능실, 방화구역·제연구획·외벽, 소방 심벌, 설비 연결선(전기·수도·가스·배수), 축척, 자유 메모.
- 모든 직원이 보고 고칠 수 있음 (로그인한 사람만).

## 2. 파일
| 파일 | 내용 |
|---|---|
| `fm/map/` | 도면 앱 (HTML 4개 · `css/` · `js/`). 바로가기 페이지에 그대로 올림 (만들기 단계 없음) |
| `fm/map/js/storage/mapStore.js` | **새 파일**. 브라우저 저장소 대신 Supabase. `localStorage`와 같은 모양(`getItem`·`setItem`·`removeItem`)이라 저장소 파일은 이름만 바꿈 |
| `apps/ws/supabase/13_map.sql` | 표 2개 + DB 함수 2개 |
| `apps/ws/src/Index.html` → `fm/ws/app.html` | 「지도」 칸, 지도 화면(`renderMap`), `window.WS_MAP` |
| `fm/ws/ws-api.js` | `mapLoad` · `mapSave` |
| `apps/map/SESSION_HANDOVER.md` | 옛 인계 문서 (공개하지 않음) |

## 3. 자료 (Supabase)
- `map_kv` — 도면 앱이 브라우저에 두던 저장 칸을 **이름 그대로** 한 줄씩 (`k` = 옛 localStorage 이름, `v` = 글자, 고친 사람·시각).
  - 매장·기능실(`lotte_facility_specs_*`, `lotte_deleted_stores_*`, `lotte_renamed_stores_*`, `lotte_custom_stores_*`, `lotte_vacant_polygons_*`), 구역(`lotte_floor_zones_*`), 심벌(`lotte_symbols_*`), 설비 연결선(`lotte_util_lines_*`), 축척(`lotte_scale_settings*`), 고친 도면 그림(`lotte_saved_svg_*`).
  - 이름 끝 `_dept`·`_castle` = 백화점·캐슬플라자 (에비뉴엘은 없음).
  - 격자 간격(`lotte_grid_spacing_meters`)은 기기마다 보기 설정이라 브라우저에 그대로.
- `map_floor` — 층 도면 그림 주소 26개(에비뉴엘 7 · 백화점 16 · 캐슬 3). **공개 코드(`floors.js`)와 이 저장소(공개)에 두지 않음** — 11-17 배포 때 한 번 넣음. 원본은 옛 폴더 `C:venuel\lotte_map_handover\js\configloors.js`의 `svgUrl`, 주 1회 백업 CSV에도 있음.
- 함수 (PIN 로그인 표 `ws_auth` 필수, 표는 화면이 바로 못 읽음):
  - `ws_map_load(표)` → `{ kv: {이름: 값}, urls: {건물: {층: 주소}} }` — 처음 열 때 한 번.
  - `ws_map_save(표, 이름, 값)` → 한 칸 저장. 값 null = 지움. 이름은 `lotte_`로 시작하는 영문·숫자만, 값 5MB까지.
- 고치면 그 칸을 바로 저장(칸마다 차례로). 실패하면 한 번 알림. **같은 칸을 둘이 동시에 고치면 나중 저장이 남음** (시설팀 규모라 단순하게).
- 주 1회 백업 CSV에 `map_kv`·`map_floor` 포함 (`10_archive.sql`, `Archive.gs`).

## 4. 주소 감추기 · 오른쪽 버튼
- 지도는 업무지원 화면 안에서만 엶 → 주소창에 도면 앱 주소가 나오지 않음.
- 도면 앱 주소(`fm/map/index.html`)를 바로 열면 자료 없이 「업무지원 앱에서 [지도]를 눌러 열어 주세요」만 나옴 (자료·층 주소는 로그인 표가 있어야 받음).
- **PC(마우스)에서 오른쪽 버튼 메뉴 막음** — 업무지원·지도 둘 다. 휴대폰·아이패드 길게 누르기는 그대로.
- 한계: 개발자 도구(F12)를 아는 사람은 주소를 볼 수 있음. 진짜 보호는 「로그인한 사람만 자료를 받음」(3장).
- 층 도면 그림 자체는 아직 롯데 지도 업체 저장소(S3 `editor4-public-assets`)에서 받음. 업체가 주소를 바꾸면 `map_floor` 표 주소만 고치면 됨.

## 5. 남은 일
- 옛 PC 브라우저(localhost:8765)에 그려 둔 자료는 옮기지 않음 (시험 자료). 필요하면 옮기기 도구를 따로.
- 도면 앱 디자인을 DW 디자인 기준(06)에 맞추기, 아이패드 터치 시험, Delete 키로 연결선 지우기 안 되는 점 (인계 문서 5단계).
- 층 도면 그림을 Supabase 버킷으로 복사해 업체 저장소에 기대지 않기 (필요하면).

## 6. 시험
- `npm run test:sql` — 지도 7개 (막기·받기·저장·지움·칸 이름 막기).
- `node test/sb_map_test.js` (`npm run test:sb`에 포함) — 지도 칸 자리, 화면 안에서 열림, 로그인 표로 받은 주소로 그림, `floors.js`에 주소 없음, 저장·지움, 오른쪽 버튼 막음, 바로 열면 안내만.
