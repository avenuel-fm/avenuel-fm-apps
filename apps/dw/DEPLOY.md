# 도면협의(DW) 앱 배포 정보

| 항목 | 값 |
|---|---|
| 스크립트 ID | `1S0XILSNjnHGDXVN2_Ylb3UuzokfezHjSAY71oW0oyVgUbSlkkEdsCpB2` (시트에 붙은 스크립트) |
| **배포 ID (지금 쓰는 웹앱)** | `AKfycbyc0v4cT_zoVSjy7RGydb8rfys9mUyi6jHfAQeTvDXpmH1ycLglOoHmF6mRu2B8x-Ty` |
| 웹앱 주소 | `https://script.google.com/macros/s/AKfycbyc0v4cT_zoVSjy7RGydb8rfys9mUyi6jHfAQeTvDXpmH1ycLglOoHmF6mRu2B8x-Ty/exec` |

## 규칙
- **배포는 위 배포 ID를 새 버전으로 갱신하는 방식으로만** 합니다. 새 배포를 만들면 웹앱 주소가 바뀌어 `fm/apps.js`·검토서 QR·서명 메일·TinyURL `avenuel-dr`이 모두 어긋나므로 **절대 새로 만들지 않습니다.**
- 배포는 사용자 확인을 받은 뒤에만 합니다.

## 올리는 순서 (`apps/dw` 폴더에서)
clasp는 업무지원 앱에 설치된 것을 같이 씁니다 (`../ws/node_modules/.bin/clasp`).
1. 시험: `cd test && node gas_test.js` → 「서버 로직 점검 통과」
2. 파일 올리기: `../ws/node_modules/.bin/clasp push`
3. 기존 배포 갱신:
   ```
   ../ws/node_modules/.bin/clasp deploy -i AKfycbyc0v4cT_zoVSjy7RGydb8rfys9mUyi6jHfAQeTvDXpmH1ycLglOoHmF6mRu2B8x-Ty -d "v1.8.x 한 줄 설명"
   ```
   - `-i`(배포 ID)를 **반드시** 붙입니다. 빼면 새 배포가 생깁니다.
4. 확인: `../ws/node_modules/.bin/clasp deployments` → 위 배포 ID의 버전 번호가 올라갔는지
