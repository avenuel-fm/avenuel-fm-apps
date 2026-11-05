# 업무지원(WS) 앱 배포 정보

| 항목 | 값 |
|---|---|
| 스크립트 ID | `1N1IE6Cz-LNQPRo3zpEBy9yTIUum-CzmsAq7HpUWLNxn21RJFsnL3LbB6` |
| **배포 ID (지금 쓰는 웹앱)** | `AKfycbxzD0-R4Cg5_eeECMfgLok3lCSOZuac5cwVSVLvVuQTp_d3rfm_HWH1ju-EmyVC5qut6Q` |
| 웹앱 주소 | `https://script.google.com/macros/s/AKfycbxzD0-R4Cg5_eeECMfgLok3lCSOZuac5cwVSVLvVuQTp_d3rfm_HWH1ju-EmyVC5qut6Q/exec` |

## 규칙
- **배포는 위 배포 ID를 새 버전으로 갱신하는 방식으로만** 합니다. 새 배포를 만들면 웹앱 주소가 바뀌어 `fm/apps.js`·QR·TinyURL이 모두 어긋나므로 **절대 새로 만들지 않습니다.**
- 배포는 사용자 확인을 받은 뒤에만 합니다.

## 올리는 순서 (`apps/ws` 폴더에서)
1. 시험: `npm run test:all` → 「모두 통과」
2. 파일 올리기: `npx clasp push`
3. 기존 배포 갱신:
   ```
   npx clasp deploy -i AKfycbxzD0-R4Cg5_eeECMfgLok3lCSOZuac5cwVSVLvVuQTp_d3rfm_HWH1ju-EmyVC5qut6Q -d "v0.x.x 한 줄 설명"
   ```
   - `-i`(배포 ID)를 **반드시** 붙입니다. 빼면 새 배포가 생깁니다.
4. 확인: `npx clasp deployments` → 위 배포 ID의 버전 번호가 올라갔는지

## 처음 한 번
- `npx clasp login` → 브라우저에서 **시설팀 공용 계정**으로 허용 (사용자가 직접)
- https://script.google.com/home/usersettings 에서 「Google Apps Script API」 켜기
