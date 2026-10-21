# EATON RTO 인허가 대시보드

회사 인허가(사업자등록증·환경·소방·안전검사 등)를 **상시 전시용 화면**으로 보여주고,
**만료일이 다가오면 담당자에게 갱신 안내 메일**을 자동 발송하며,
**변경사항은 팀장이 승인**하고 **모든 변경 이력을 조회**할 수 있는 웹 애플리케이션입니다.
데이터는 **구글 스프레드시트 'RTO'** 에 저장하며, 화면은 **PowerPoint(PPTX) 파일로 내려받아** 다른 기기에서도 열어볼 수 있습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🖥 상시 디스플레이 | 전체화면 대시보드, 만료일 기반 상태 자동 계산(🟢 유효 / 🟡 갱신중 / 🔴 만료 / ⚪ 해당없음), 구글 시트에서 로드 후 1분 주기 자동 갱신 |
| ✉️ 만료 알림 메일 | 만료 D-N일(기본 60/30/14/7일)에 담당자에게 Gmail 자동 발송, 팀장 CC |
| ✅ 팀장 승인 워크플로우 | 일반 사용자는 변경 요청 → 팀장이 승인/거절 → 승인 시 반영 |
| 📜 변경 이력 | 모든 반영된 등록/수정/삭제 내역과 변경자 기록 |
| 📽 PPTX 내보내기 | 대시보드 화면을 PowerPoint 파일로 저장 |

## 폴더 구조

```
RTO/
├── .github/workflows/
│   └── deploy-pages.yml           # GitHub Pages 자동 배포
├── public/                        # 웹 앱 (정적 호스팅)
│   ├── index.html                 # 디스플레이 대시보드
│   ├── dashboard.css / dashboard.js
│   ├── admin.html                 # 관리자 화면 (등록·승인·설정)
│   ├── admin.css / admin.js
│   ├── common.js                  # 공용 헬퍼(상태 계산 등)
│   ├── sheets-config.js           # ← Apps Script Web App URL 입력 필수
│   ├── sheets.js                  # 구글 시트 읽기(JSONP)/쓰기(no-cors POST) 헬퍼
│   └── supabase-config.js         # (구버전) 사용하지 않음
├── apps-script/
│   ├── Code.gs                    # 구글 시트 데이터 저장소 + Gmail 발송 스크립트
│   └── appsscript.json            # Apps Script 매니페스트
└── README.md
```

## 1) Google Apps Script + 스프레드시트 설정

데이터 저장소는 **구글 스프레드시트 'RTO'** 입니다. 웹앱은 Apps Script를 통해 시트를 읽고 씁니다.

1. [script.google.com](https://script.google.com) → 새 프로젝트
2. [apps-script/Code.gs](apps-script/Code.gs) 내용을 `Code.gs` 에 붙여넣기
3. 좌측 **설정(⚙) → 'appsscript.json 매니페스트 표시' 체크** 후, [appsscript.json](apps-script/appsscript.json) 내용으로 교체
4. 우측 상단 **배포 → 새 배포 → 유형: 웹 앱** 선택
   - 액세스 권한: **모든 사용자(Anyone)**
   - 실행 계정: **나(배포자)**
5. 배포 후 나오는 **Web App URL** 복사
6. [public/sheets-config.js](public/sheets-config.js) 의 `APPS_SCRIPT_URL` 에 붙여넣기

### 스프레드시트 'RTO' (자동 생성)
- 스크립트가 첫 실행 시 내 드라이브에 **'RTO'** 스프레드시트를 자동 생성하고, 아래 시트(탭)를 만듭니다.
- 기존 시트를 쓰려면 `Code.gs` 상단 `SPREADSHEET_ID` 에 시트 ID를 입력하세요.

| 시트(탭) | 용도 |
| --- | --- |
| 인허가 | 인허가 목록 (카테고리, 인허가명, 발급기관, 발급일, 만료일, 상태, 담당자 등) |
| 설정 | 사이트명, 제목, 담당 연락처, 알림 기준, 팀장 이메일, 담당자 이메일(참조) 등 key/value |
| 변경요청 | 일반 사용자의 등록/수정/삭제 승인 요청 |
| 변경이력 | 반영된 변경 내역 |
| 알림로그 | 발송된 만료 알림 기록 |

> 발송은 스크립트를 배포한 Google 계정의 Gmail로 보내집니다.

## 2) 웹 앱 실행 (GitHub Pages 권장)

`public/` 폴더가 웹 앱입니다. 로컬에서 바로 확인하려면:

```bash
cd public
python3 -m http.server 8080
```

브라우저에서:
- **디스플레이 화면**: `http://localhost:8080/` (대형 화면/사이니지에서 열어두세요)
- **관리자 화면**: `http://localhost:8080/admin.html`

### GitHub Pages로 배포

1. **배포 전에** [public/sheets-config.js](public/sheets-config.js) 에 실제 `APPS_SCRIPT_URL` 을 입력하세요.
2. 이 폴더 전체를 Git 저장소로 만들어 GitHub에 올립니다.
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```
3. GitHub 저장소 → **Settings → Pages** → **Source: GitHub Actions** 로 설정합니다.
4. push 하면 [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) 이 `public/` 폴더를 자동으로 배포합니다.
   - 배포 주소: `https://<계정>.github.io/<저장소>/`
   - 기본 브랜치가 `main`이 아닌 경우 workflow의 `branches: [main]` 을 맞게 수정하세요.

> Netlify / 사내 웹서버에도 `public/` 폴더를 그대로 올리면 됩니다.

### 호스팅 시 주의 (중요)
- GitHub Pages는 **공개(public) 저장소** 기준 무료이며, `sheets-config.js` 의 Apps Script URL이 인터넷에 공개됩니다.
- Apps Script 웹앱이 **액세스: 모든 사용자(Anyone)** 로 배포되므로, URL을 아는 누구나 시트 데이터를 읽고 수정할 수 있습니다.
  - 사내 내부망 전용이면 그대로 사용해도 되지만,
  - 외부 공개로 운영한다면 Apps Script 배포를 **나(배포자)만 접근**으로 제한하거나, 별도 인증을 추가하세요.

## 3) 만료 알림 (Gmail 발송)

- 관리자 화면 **"지금 만료 알림 발송"** 버튼으로 수동 발송할 수 있습니다.
- 발송된 알림은 스프레드시트 'RTO'의 **알림로그** 탭에 기록됩니다.
- 매일 자동 발송이 필요하면 편집기에서 함수 선택창을 **`installTrigger`** 로 바꾸고 **▶ 실행** 한 번만 하면 됩니다(매일 오전 9시 자동 실행).
  - 실행 시각을 바꾸려면 `installTrigger(8)` 처럼 호출하거나, 편집기 **트리거(시계 아이콘) → 시간 기반 → 매일** 에서 직접 설정하세요.
  - 참고: `dailyCheck()` 는 현재 알림 대상(버킷 범위 내)을 매 실행마다 모두 발송하므로, 하루 1회 실행을 권장합니다.

## 4) 사용 방법

### 관리자 화면
1. 오른쪽 위에 **내 이름/이메일** 입력(팀장 이메일과 일치하면 '팀장' 역할)
2. **인허가 목록** 탭: 등록/수정/삭제
   - 팀장은 저장 즉시 반영, 일반 사용자는 **승인 요청**으로 등록됨
3. **변경 요청** 탭: 팀장이 승인/거절
4. **변경 이력** 탭: 누가 무엇을 언제 바꿨는지 확인
5. **담당자** 탭: 인허가에 입력된 담당자 이메일이 자동 수집되어 표시됩니다.
6. **설정** 탭: 사이트명, 제목, 담당 연락처, 팀장 이메일, 담당자 이메일(참조), 검토 시작 기준일(`alert_days`), 알림 시점(`reminder_buckets`) 등

### 승인 워크플로우
```
일반 사용자 ──변경 요청──▶ 변경요청 시트(pending)
                                  │
              팀장 승인(승인) ◀────┘        팀장 거절(거절)
                    │                            │
        인허가 시트 반영 + 변경이력 기록      reject_reason 기록
```

### 상태 계산 규칙
- 인덱스(디스플레이) 화면:
  - 만료일 없음 → ⚪ 해당 없음
  - 만료일 < 오늘 → 🔴 만료
  - 만료일까지 남은 일수 ≤ `alert_days` → 🟡 갱신중
  - 그 외 → 🟢 유효
- 관리자 화면은 위 규칙에 `status_override`(수동 상태)가 우선 적용됩니다.

## FAQ

- **데이터가 안 불러와져요** → [public/sheets-config.js](public/sheets-config.js) 의 `APPS_SCRIPT_URL` 확인, Apps Script 배포가 '웹 앱(Anyone)'인지 확인, 편집기 → 실행(▶) 로그에서 오류 확인.
- **이메일이 안 와요** → 위와 동일하게 Apps Script URL/배포 확인. 편집기에서 함수 선택창을 **`testEmail`** 로 바꾸고 ▶ 실행하면 설정 시트의 팀장 이메일로 시험 메일이 발송됩니다(담당자 알림은 인허가 항목의 **담당자 이메일**이 입력되어 있어야 발송됨). 발송 내역은 스프레드시트 'RTO'의 **알림로그** 탭과 Apps Script 실행 로그에서 확인하세요.
- **변경이 바로 안 보여요** → 시트 반영 후 화면은 **1분 주기**로 자동 재조회됩니다(새로고침하면 즉시 반영).
- **PPTX가 다운로드 안 돼요** → 인터넷 연결 필요(pptxgenjs CDN 로드).
