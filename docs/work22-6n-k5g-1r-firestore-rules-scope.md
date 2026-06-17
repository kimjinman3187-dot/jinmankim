# WORK22-6N-K5G-1R — approval_requests Firestore Rules 신설/배포 범위 확정

기준일: 2026-06-17
역할: **보안 Rules 구조 분석자** (UI 구현자 아님 / 배포 실행자 아님)
작업 성격: 분석 + Rules 범위 확정 문서 (코드/Rules/데이터/배포 변경 없음, docs 1개만 추가)

---

## 1. 기준 SHA

`origin/main = 8e52634e944dd7cd34067e29a17dda6889c3743d`
(Merge pull request **#97** — `docs/work22-6n-k5f-7-approval-request-create-scope` 포함; K5F-4/5/6/7 반영)

선행 상태: PR #97 merged · K5F-7 PASS · 다음 작업 K5G-1R · K5G-1(UI/write)은 K5G-1R 이후.

---

## 2. 작업 브랜치

`docs/work22-6n-k5g-1r-firestore-rules-scope` (base: origin/main 8e52634)

---

## 3. 분석한 파일 목록

```text
[저장소 루트 트리]      .nojekyll / README.md / SECURITY.md / desktop.css / favicon.png
                        icon-192.png / icon-512.png / index.html / manifest.json
                        docs/ · functions/ · js/
[Firebase 설정 탐색]    firestore.rules / firebase.json / .firebaserc / package.json /
                        package-lock.json / functions/package.json  → 루트·하위 전체 검색
[기존 설계 근거 문서]   docs/work22-6n-k5f-7-approval-request-create-scope.md (직전 PR #97)
                        docs/work22-6n-k5f-6-approval-requests-create-design.md (PR #96)
                        docs/work22-6n-k4f-firestore-rules-uid-transition-design.md (Rules 헬퍼 모델)
                        docs/work22-6n-k4f-1-rules-security-correction.md
                        functions/README.md (K5E-1 환경 점검 = Functions HOLD)
[기존 Rules 골격(미배포)] origin/test/work22-6n-d-google-login-auth-design:firestore.rules
                        (WORK22-6N-A DESIGN DRAFT, main 미반영·미배포, "DO NOT DEPLOY" 명시)
[클라이언트 Firebase]   js/firebase-shared.js (projectId='yongjin-enterprise', compat CDN)
```

조사 방식: `git ls-tree -r origin/main` 트리 검색 + 루트/하위 파일 `find` 검색. Firebase Console은 조작·확인하지 않음(금지).

---

## 4. firestore.rules 존재 여부 — **없음 (NO)**

- `origin/main` 트리에 `firestore.rules` **부재**.
- 단, 미배포 설계 초안이 `origin/test/work22-6n-d-google-login-auth-design:firestore.rules`에만 존재(파일 상단 "WORK22-6N-A DESIGN DRAFT ONLY / DO NOT DEPLOY" 명시). main 미반영·미배포.
- 실제 운영(배포)된 Rules는 Firebase Console에만 존재하며 **본 작업에서 내용 미확인**(Console 조작 금지). → 운영 Rules 내용은 미상으로 간주.

## 5. firebase.json 존재 여부 — **없음 (NO)**

## 6. .firebaserc 존재 여부 — **없음 (NO)**

## 7. package.json 존재 여부 — **없음 (NO)** (루트·functions 모두 없음)

## 8. functions 디렉터리 존재 여부 — **존재하나 실행환경 아님**

- `functions/`는 존재하지만 내용은 `functions/README.md` **1개뿐**. `package.json` / `index.js` / 의존성 / lock 파일 **없음**.
- K5E-1(functions/README.md) 판정: **HOLD** — "정적 GitHub Pages + Firebase 클라이언트 CDN only, Functions 도입 흔적 전무". 즉 **배포 가능한 Functions 환경은 부재**.

> 정리: 저장소는 `index.html + js/ + docs/ + .nojekyll`의 **순수 정적 GitHub Pages 사이트**이며, Firebase는 클라이언트 compat CDN(projectId=`yongjin-enterprise`)으로만 사용된다. Firestore Rules·firebase.json·Functions 실행환경은 모두 부재다.

---

## 9. Rules 파일 신설 필요 여부 — **필요 (YES)**

- K5G-1(UI/write)에서 미승인(승인대기) Google 사용자가 `approval_requests/{uid}`를 생성하려면, 서버측 Firestore Rules가 해당 create를 **명시 허용**하고 동시에 위조/과다권한을 **차단**해야 한다.
- 현재 운영 Rules 내용이 미상이므로, 클라이언트 write가 열려 있는지/막혀 있는지 가정 불가 → **명시적 Rules 정의가 보안 전제**(K5F-6 §15 "Rules 미정 상태 write" 리스크 통제).
- 저장소를 단일 출처(SSOT)로 두기 위해 **`firestore.rules` 파일을 repo로 관리**하는 것이 원칙(Console 직접 편집은 추적·롤백 불가, 금지 대상).

### 9-1. Rules를 저장소 파일로 관리할 수 있는가 — **가능 (YES)**

- `firestore.rules` + `firebase.json`(firestore 블록)을 repo에 두고, Firebase CLI `firebase deploy --only firestore:rules`로 배포 가능.
- **Firestore Rules 배포는 Spark(무료) 요금제에서도 가능** — Cloud Functions(Blaze 필요, K5E HOLD)와 **무관**. 따라서 Functions HOLD가 Rules 배포를 막지 않는다.

### 9-2. 적절한 파일명

```text
firestore.rules     ← Firestore 보안 규칙 (Firebase CLI 표준 파일명)
firebase.json       ← firestore.rules 경로 지정 (배포 진입점)
.firebaserc         ← 프로젝트 alias 고정 (projects.default = "yongjin-enterprise")
```

표준 파일명 사용(Firebase CLI 관례). 비표준 명명은 CLI 인식 불가하므로 지양.

---

## 10. firebase.json 신설 필요 여부 — **필요 (YES, 단 firestore-only 최소 구성)**

- `firebase deploy --only firestore:rules`는 `firebase.json`의 `firestore.rules` 경로 지정을 필요로 함 → 신설 필요.
- **반드시 `firestore` 블록만** 포함한다. `hosting` / `functions` 블록은 넣지 않는다(아래 §11-1 참조).

### 10-1. firebase.json 신설이 기존 정적 GitHub Pages 운영에 주는 영향 — **없음 (영향 없음)**

```text
- GitHub Pages는 firebase.json을 읽지 않는다. firebase.json은 Firebase CLI(deploy) 전용 설정 파일이다.
- 정적 사이트는 .nojekyll + index.html 기반으로 GitHub Pages가 그대로 서빙하며, firebase.json 추가는
  서빙 동작에 영향을 주지 않는다(무시됨).
- 단 firebase.json에 hosting 블록을 넣으면, 누군가 `firebase deploy`(전체)를 실행할 경우 Firebase Hosting로
  배포가 일어나 GitHub Pages와 이중 배포/혼선이 생길 수 있다. → hosting 블록 미포함으로 원천 차단.
- 따라서 firestore 블록만 둔 firebase.json은 GitHub Pages 운영과 완전히 분리된다.
```

---

## 11. Rules 배포 방식 후보

| # | 방식 | 설명 | 권장도 |
|---|---|---|---|
| A | **Firebase CLI 로컬 배포** | repo의 firestore.rules를 `firebase deploy --only firestore:rules`로 배포. PR 검토 → merge → 승인자가 로컬 CLI 배포 | **권장(1차)** — 단순·Spark 가능·추적은 PR로 |
| B | GitHub Actions CI 배포 | merge 시 Actions가 `firebase deploy --only firestore:rules` 자동 실행(서비스계정 키 필요) | 차기 검토 — 자동화 이점, 단 시크릿/CI 신설 비용 |
| C | Firebase Console 직접 편집 | Console에서 Rules 붙여넣기 | **금지(채택 불가)** — 추적·리뷰·롤백 불가, 본 작업 금지사항 |

- **Console 직접 조작 없이 배포 가능** → **가능(YES)**. A 또는 B 모두 Console 없이 동작.
- **GitHub PR로 Rules 관리 가능** → **가능(YES)**. firestore.rules를 repo 파일로 PR 검토 후 CLI/CI 배포.
- 본 K5G-1R 권장: **방식 A**(CLI 로컬 배포, 배포 실행은 Gene/ORION/승인자). B는 후속 자동화 옵션으로 기록.

---

## 12. K5G-1R에서 실제 Rules 파일을 추가할지 여부 — **추가하지 않음 (설계/범위 문서만)**

판정 근거(K5E-1 선례 정합):

```text
- 본 작업 역할 = "보안 Rules 구조 분석자". 배포 실행자/UI 구현자 아님(작업 지시 명시).
- firestore.rules + firebase.json + .firebaserc 신설은 저장소에 "Firebase CLI 배포 표면(보안 경계 + 배포 스택)"을
  새로 도입하는 아키텍처 결정이다 → K5E-1이 Functions 환경을 임의 신설하지 않고 HOLD+승인요청한 것과 동일 성격.
- 작업 허용 조항: "실제 Rules 파일 추가가 필요하다고 판단할 경우 먼저 Gene/ORION 승인 요청",
  "기존 코드 파일 변경 없이 docs 문서만 추가하는 것은 허용".
```

→ **K5G-1R = docs-only PR**(본 문서 1개 추가). 즉시 커밋 가능한 `firestore.rules`/`firebase.json`/`.firebaserc` **전문은 본 문서 §15에 코드블록으로 포함**하되, 라이브 파일로는 추가하지 않는다.
→ 실제 파일 추가 + 배포는 **후속 단계(K5G-1F: Rules 파일 신설/배포)** 로 분리하고, **Gene/ORION 승인 후** 진행한다. 순서는 반드시 **K5G-1F(배포) → K5G-1(UI write)**.

```text
K5G-1R  (본 작업) : Rules 범위/설계 확정 — docs only, 파일·배포 없음
K5G-1F  (후속)    : firestore.rules + firebase.json + .firebaserc 신설 PR → CLI 배포 (Gene/ORION 승인 후)
K5G-1   (후속)    : approval_requests 생성 UI/write 구현 (index.html) — K5G-1F 배포 이후
```

---

## 13. K5G-1 UI 구현 전 필수 Rules 조건 (최소 셋)

K5G-1(UI write) 진입 전, 아래 조건이 배포된 Rules에 **반드시** 반영되어 있어야 한다.

### 13-1. create (생성) — 미승인 본인만, pending 고정, role 화이트리스트

```text
match /approval_requests/{requestUid}
allow create 필수 조건:
  1. request.auth != null
  2. requestUid == request.auth.uid                       // 문서 ID = 본인 uid (중복/위조 방지)
  3. request.resource.data.uid == request.auth.uid        // 본문 uid도 본인
  4. request.resource.data.email == request.auth.token.email  // Google 신원 바인딩(위조 차단)
  5. request.resource.data.status == 'pending'            // 상태 위조 금지
  6. request.resource.data.source == 'google_approval_gate'
  7. request.resource.data.requested_role in ['sales','accounting','factory']  // admin·device 금지
  8. request.resource.data.reviewed_by == null
     && reviewed_at == null && decision_reason == null && memo == null  // 처리필드 사전 위조 금지
  9. !activeUser()  // users/{auth.uid} active 문서가 없어야 함 (이미 승인된 사용자의 요청 금지)
```

### 13-2. read (읽기) — admin 전체 / 본인 단건

```text
allow read:
  - isAdmin()                          // admin 목록(K5F-5 loadApprovalRequestsReadOnly, orderBy+limit50 list query)
  - || requestUid == request.auth.uid  // 요청자 본인 단건 read
  - 그 외 role: 금지
```

> ⚠️ Rules 평가 주의: admin **목록(list) 쿼리**는 `isAdmin()`(문서 데이터 비의존)으로 통과 가능하나, "본인 단건"은 **단건 get**으로만 성립한다(본인 조건이 들어간 list 쿼리는 불가). 클라이언트는 본인 요청을 `.doc(uid).get()`으로 조회해야 한다.

### 13-3. update / delete — admin only

```text
allow update, delete:
  - isAdmin()  // (admin = users/{adminUid}.role=='admin' && status=='active'; 기존 헬퍼 roleIn(['admin']))
  - 일반 사용자 update/delete 전면 금지
  - (향후 승인/반려/보류 처리에서 변경 가능 필드를 status/memo/reviewed_*/decision_reason/updated_at로
     affectedKeys 화이트리스트 제한 — K5H/K5I에서 세분화)
```

### 13-4. 기존 Rules 헬퍼 재사용 (test/work22-6n-d 골격 정합)

기존 미배포 골격에 이미 정의된 헬퍼를 그대로 사용한다(신규 함수 최소화):
`signedIn()` · `hasUserDoc()` · `currentUser()` · `currentRole()` · `currentStatus()` · `activeUser()` · `roleIn(roles)` · `isAdmin()`.

---

## 14. 이번 PR 변경 파일

```text
docs/work22-6n-k5g-1r-firestore-rules-scope.md   (신규, 본 문서 1개)
```

- `index.html` 변경 없음 / `firestore.rules` 추가 없음 / `firebase.json` 추가 없음 / `.firebaserc` 추가 없음
- 기존 코드·데이터·Rules·배포 변경 **전무**.

---

## 15. (참조) 후속 K5G-1F에서 추가할 파일 전문 — 본 PR 미적용

> 아래는 Gene/ORION 승인 후 **K5G-1F에서 그대로 커밋**할 참조 전문이다. 본 K5G-1R PR에는 **라이브 파일로 추가하지 않는다**(K5E-1 참조 구현 방식과 동일).

### 15-1. `firestore.rules` (approval_requests 블록 — 기존 골격에 추가)

```text
// 기존 헬퍼(signedIn/hasUserDoc/currentUser/currentRole/currentStatus/activeUser/roleIn/isAdmin) 재사용 전제.
// 아래 블록을 service ... match /databases/{database}/documents 내부,
// match /{document=**} { allow read, write: if false; } catch-all 위에 추가.

match /approval_requests/{requestUid} {

  // 생성: 미승인(승인대기) 본인만, status=pending, role 화이트리스트, 처리필드 null 고정
  allow create: if request.auth != null
    && requestUid == request.auth.uid
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.email == request.auth.token.email
    && request.resource.data.status == 'pending'
    && request.resource.data.source == 'google_approval_gate'
    && request.resource.data.requested_role in ['sales', 'accounting', 'factory']
    && request.resource.data.reviewed_by == null
    && request.resource.data.reviewed_at == null
    && request.resource.data.decision_reason == null
    && request.resource.data.memo == null
    && !activeUser();   // users/{auth.uid} active 문서가 없어야 함

  // 읽기: admin 전체(목록) / 본인 단건
  allow read: if isAdmin()
    || (request.auth != null && requestUid == request.auth.uid);

  // 수정/삭제: admin 전용 (승인/반려/보류 처리; 필드 화이트리스트는 K5H/K5I에서 세분화)
  allow update, delete: if isAdmin();
}
```

### 15-2. `firebase.json` (firestore 전용 최소 구성 — hosting/functions 블록 없음)

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

### 15-3. `.firebaserc`

```json
{
  "projects": {
    "default": "yongjin-enterprise"
  }
}
```

### 15-4. K5G-1F 배포 절차(참조)

```text
1. firestore.rules / firebase.json / .firebaserc 추가 PR (Gene/ORION 검토)
2. merge 후 승인자가 로컬에서:
     firebase deploy --only firestore:rules --project yongjin-enterprise
   (Spark 요금제 가능, Functions 무관, Console 직접 편집 없음)
3. 배포 확인 후 → K5G-1(UI write) 진행
```

---

## 16. 금지사항 준수 여부

| 금지 항목 | 준수 |
|---|---|
| index.html 수정 금지 | ✅ 미수정 |
| approval_requests write UI 구현 금지 | ✅ 미구현 |
| createApprovalRequest 함수 구현 금지 | ✅ 미구현 |
| users 생성/update 금지 | ✅ 없음 |
| invite_codes / pending_users / orders 변경 금지 | ✅ 없음 |
| Cloud Functions 생성 금지 | ✅ 없음 |
| Firebase Console 직접 조작 금지 | ✅ 미조작(운영 Rules 미확인 처리) |
| Firebase deploy 실행 금지 | ✅ 미실행 |
| Reset Data 금지 | ✅ 없음 |
| Delete Branch 금지 | ✅ 없음 |
| main 직접 수정 금지 | ✅ 신규 브랜치 작업 |
| 자체 PASS 선언 금지 | ✅ 미선언 (Gene/ORION 판정 대기) |
| 실제 Rules 파일 추가 | ✅ 미추가 (docs only, §12 판정) |

---

## 17. PR 번호와 링크

- 브랜치: `docs/work22-6n-k5g-1r-firestore-rules-scope` (base 8e52634, origin/main)
- PR 제목(권장): `docs: WORK22-6N-K5G-1R approval_requests Firestore Rules 범위 확정`
- PR 생성 링크(환경에 `gh` 미설치 → 웹에서 생성):
  `https://github.com/kimjinman3187-dot/jinmankim/pull/new/docs/work22-6n-k5g-1r-firestore-rules-scope`
- PR 번호: **(생성 후 기입)**

---

## 18. Gene/ORION 검토 요청 사항

```text
1. 변경 파일이 docs 1개(work22-6n-k5g-1r-firestore-rules-scope.md)뿐인지 확인
2. index.html / firestore.rules / firebase.json / .firebaserc 라이브 추가가 없는지 확인
3. §12 판정 승인 여부: K5G-1R는 docs-only, 실제 파일 신설은 후속 K5G-1F로 분리(K5E-1 선례 정합)가 적절한가
4. §13 최소 Rules 조건(create/read/update·delete) 승인 여부 — 특히:
     - create의 !activeUser() (미승인자만 생성) 조건
     - email == request.auth.token.email 신원 바인딩
     - requested_role 화이트리스트(sales/accounting/factory, admin·device 금지)
5. §11 배포 방식: 방식 A(CLI 로컬, Spark 가능) 채택 / 방식 B(Actions) 후속 검토가 적절한가
6. §15 firebase.json을 firestore 블록만 두어 GitHub Pages와 분리하는 방침 승인 여부
7. 후속 순서 확정: K5G-1F(Rules 파일 신설+배포) → K5G-1(UI write) 순서가 맞는지
8. K5G-1F 착수 승인 여부 (= 실제 firestore.rules/firebase.json/.firebaserc 파일 추가 허가)
```

> 자체 PASS 아님. Gene/ORION이 분석 + 범위 판정 + 후속(K5G-1F) 착수 여부를 검토 후 PASS/HOLD 판정.
