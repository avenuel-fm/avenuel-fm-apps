# 옛 [구역별 온습도 확인] 앱 자료 (보관용 사본)

- 원본: `C:\avenuel\mall-climate-pwa` · GitHub `avenuel-fm/mall-climate-pwa` (2026-11-21 복사). **원본은 이관·기능 확인 뒤 삭제 예정**이라 여기 남겨 둠 (결정 182·184).
- 이관 설계: `docs/설계/WS_온습도공조기.md`. 이 폴더는 **고치지 않는 참고 자료**입니다. 앱에 올리지 않습니다.
- 대화 기록 전체: `C:\Users\Administrator\Downloads\session-export-1795223883778.zip` (원본 폴더와 별개)

| 파일 | 담긴 것 |
|---|---|
| `config.json` | 장비 목록(공조기 층 묶음·구역, 에어커튼 묶음 키), 기본 시각, 불쾌지수 단계·권고 문구, 쾌적 범위, 실내외 차이 경고, 날씨 좌표 |
| `CLAUDE.md` · `AGENTS.md` · `옛앱_README.md` | 옛 앱 규칙·결정·알려진 함정, 사용 설명 |
| `app.js` | 온습도 입력·불쾌지수·그래프·온습도 리포트·날씨(Open-Meteo) |
| `usage.js` | 공조기·에어커튼 입력(10분 단위, 미가동, 요일 기본 시각), PC 표 배치, 가동시간 리포트(전일 대비·추이·CSV) |
| `style.css` | 층 색·에어커튼 IN/OUT 색(`.hv-name[data-tone]`, 이관 뒤에도 그대로 쓰는 예외 색) |
| `index.html` · `manifest.webmanifest` | 옛 화면 뼈대 |
| `google-sheets/Code.gs` | 시트 `기록`·`공조기`·`에어커튼` 칸 구조, 동기화 통로 v3 |
