# WORK22-6N-E — Google Login 테스트 계정 및 users/{uid} 매핑표 설계

기준일: 2026-06-09
최종 갱신: 2026-06-09 (WORK22-6N-E-UPDATE — 운영 users 실데이터 반영)
작업 성격: **문서 작성 전용** (코드/Rules/Console/운영데이터 변경 없음)
선행 검토: `work22-6n-d-review-google-login-design.md`, `work22-6n-g0-google-login-b1-validation.md`

## 0. 작업 목적 및 데이터 출처

Google Login 기반 Auth 구조 전환 전, 다음 매핑 체인을 문서로 확정한다.

```
Google 계정 → Firebase Auth UID → users/{uid} → role/status
```

확정된 전제(WORK22-6N-D / 6N-G0 결과):

- `auth.currentUser.uid`는 현재 **Anonymous Auth uid**다. (`js/firebase-shared.js:29-38`)
- **users 문서 ID ≠ auth.uid**, `users.auth_uid`는 6개 전부 빈 문자열(`""`) — 실데이터 확인(6N-G0)
- 현재 `firestore.rules` 초안은 `get(users/$(request.auth.uid))` 전제라 **운영 적용 불가** (`firestore.rules:37-47`)

**데이터 출처:**

- legacyUserId / name / role / status: **WORK22-6N-G0에서 운영 `users` 컬렉션 읽기 전용 조회로 확정한 실데이터.**
- Google Email / Firebase UID: **여전히 "확인 필요"** — Google Provider 미활성 + email 필드 부재 + UID 미생성(6N-G0, B1 RED).

---

## 1. 현재 사용자 목록 정리 (운영 실데이터)

WORK22-6N-G0 익명 read 조회 결과 — **총 6개 문서 확정**:

| legacyUserId | name | role(원본) | status | auth_uid | email 필드 | pin 필드 | sort_index |
|---|---|---|---|---|---|---|---|
| `emp_admin` | 윤정원 | admin | active | `""` | 없음 | 있음 | 1 |
| `admin_gene` | gene kim | admin | active | `""` | 없음 | 있음 | 2 |
| `김상경` | 영업 | sales | active | `""` | 없음 | 있음 | 3 |
| `emp_factory` | 공장 | factory | active | `""` | 없음 | 있음 | 4 |
| `emp_acc1` | 회계1 | accounting | active | `""` | 없음 | 있음 | 5 |
| `emp_acc2` | 회계2 | **`ccounting`** ⚠️오타 | active | `""` | 없음 | 있음 | 6 |

> DEV fallback 계정(`*-local`, `index.html:874-879`)은 운영 대상이 아니며 세션 복원 시 차단(`index.html:3295`)되므로 매핑표에서 제외.

### 1-1. 실데이터 기반 확정 사항 / 주의 항목

1. **emp_acc2.role = `ccounting` (운영 오타)** — 코드 보정(`firebase-shared.js:49`, `index.html:1767`의 `if(d.role==='ccounting') d.role='accounting'`)이 화면에서는 가리지만, **Firestore Rules는 원본 role을 직접 조회**(`firestore.rules:49-51`)하므로 정정 없이는 회계 권한이 부여되지 않는다. → **신규 `users/{uid}` 생성 시 반드시 `accounting`으로 정정.** 기존 운영 데이터는 본 작업에서 수정하지 않는다.
2. **admin 2개 계정** — `emp_admin`(윤정원), `admin_gene`(gene kim) 둘 다 admin/active. 운영 유지/폐기/통합 여부 **결정 필요**(아래 §3-3).
3. **sales legacyUserId가 한글 `김상경`** — 표준 패턴(`emp_*`)이 아닌 한글 문서 ID. 매핑·정렬·롤백·URL 처리 시 **예외 항목**으로 관리.
4. **auth_uid 6개 전부 `""`** — UID 매핑 정보 운영에 전무 → B1 RED.
5. **email 필드 6개 전부 부재** — Google 계정 배정 이력 없음 → B1 RED.
6. **pin 필드 6개 전부 존재 + 익명 read로 접근 가능** — B3(PIN 클라이언트 노출) 실증.

---

## 2. Google Login 전환 매핑표

각 행 = "1 Google 계정 = 1 Firebase UID = 1 users/{uid} 문서". 실데이터로 확정된 칸과 미확인 칸을 구분.

| legacyUserId | name | role | status | Google Email | Firebase UID | users/{uid} 예정 경로 |
|---|---|---|---|---|---|---|
| `emp_admin` | 윤정원 | admin | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| `admin_gene` | gene kim | admin | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| `김상경` | 영업 | sales | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| `emp_factory` | 공장 | factory | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| `emp_acc1` | 회계1 | accounting | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| `emp_acc2` | 회계2 | accounting ※원본 `ccounting` 정정 | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |

### 2-1. 매핑표 작성 규칙

1. **legacyUserId / name / role / status**: 위 §1 실데이터로 확정(갱신 완료). 단 `emp_acc2`의 role은 신규 생성 시 `accounting`으로 **정정 기입**.
2. **name**: 운영 중 변경 금지 — `orders.reportedBy` 매칭 보존(§5, B6).
3. **Google Email**: 각 직원에게 배정할 Google 계정. 미보유 → 배정 필요(B1).
4. **Firebase UID**: 해당 Google 계정으로 실제 1회 로그인 후 Console Authentication > Users에서 확인. 미생성 → "확인 필요"(B1).
5. **users/{uid} 예정 경로**: UID 확정 후 생성할 문서 경로(UID = 문서 ID).

### 2-2. 테스트 계정 최소 세트 (Emulator/회귀, 설계 B §13)

| 구분 | role | status | 목적 |
|---|---|---|---|
| adminUid | admin | active | 전체 권한 |
| salesUid | sales | active | 본인 reportedBy 소유권 |
| accountingUid | accounting | active | finance/AR 권한 |
| factoryUid | factory | active | approved/completed read + 생산 update |
| suspendedUid | sales | suspended | 차단 검증 |

---

## 3. role 구조 검증

### 3-1. 역할별 권한 표 (코드 ACCESS_MATRIX 기준, `index.html:958-975`)

| role | view | write |
|---|---|---|
| admin | live, sales, finance, ar, production, history, dashboard, reset, admin | sales, finance, ar, production, reset, admin |
| sales | live, sales, ar, production, history, dashboard | sales, ar |
| accounting | live, sales, finance, ar, production, history, dashboard | sales, finance, ar |
| factory | live, production, history | production |
| suspended | (status 값, role 아님) | 접속 차단 대상 |

### 3-2. ACCESS_MATRIX ↔ firestore.rules role 정합성

role 4종(admin/sales/accounting/factory)은 프론트 ACCESS_MATRIX와 Rules가 정합. **ACCESS_MATRIX는 수정 불필요** — Google Login 전환 시 role의 **출처만** PIN 선택값 → `users/{uid}.role`로 변경. `suspended`는 role이 아니라 status.

### 3-3. admin 2개 계정 처리 (결정 필요)

| legacyUserId | name | 비고 |
|---|---|---|
| `emp_admin` | 윤정원 | sort_index 1 |
| `admin_gene` | gene kim | sort_index 2 |

→ 둘 다 admin/active. **운영 결정 필요**: (A) 둘 다 유지(각자 Google 계정 배정), (B) 하나로 통합, (C) 하나 폐기/suspended. 결정 전까지 매핑표는 2행 모두 유지.

---

## 4. users/{uid} 목표 스키마

```js
users/{auth.uid} = {
  email: "",            // Google 계정 이메일 (로그인 신원)
  name: "",             // 표시 이름 + orders.reportedBy 매칭 기준 (변경 금지)
  role: "",             // admin | sales | accounting | factory  (ccounting 금지)
  status: "",           // active | suspended (없으면 active)
  legacyUserId: "",     // 기존 PIN users 문서 ID (추적/롤백용)
  migratedFromPin: true,
  createdAt: 0,
  lastLoginAt: 0
}
```

### 필드 정의 / 제약

| 필드 | 필수 | 정의·제약 |
|---|---|---|
| `email` | 필수 | Google 이메일. 신원 표시용(권한 판단은 uid). |
| `name` | 필수 | 화면 표시 + `orders.reportedBy` 키. 운영 중 변경 금지(B6). |
| `role` | 필수 | `admin/sales/accounting/factory`. **`ccounting` 등 오타 금지** — emp_acc2는 `accounting`으로 정정. |
| `status` | 권장 | `active/suspended`. 미존재 시 active(`firestore.rules:53-57`, `index.html:1025`와 일치). |
| `legacyUserId` | 필수 | 기존 PIN 문서 ID(`emp_acc2`, `김상경` 등) 보존. |
| `migratedFromPin` | 권장 | 이전 계정 식별. |
| `createdAt`/`lastLoginAt` | 선택 | 모니터링용. 권한 판단 미사용. |

**제거/비포함:** `pin`, `attempts`, `lockoutUntil` 배제. PIN 보조 잠금 격하 시 권한 판단과 분리(B2). `pin`은 노출 위험(B3 실증)으로 신규 문서에서 특히 배제.

---

## 5. reportedBy 유지 전략

### 현재 구조
- 생성: `reportedBy = currentUser.name` (`index.html:2873, 3033`)
- sales 조회: `where('reportedBy','==',currentUser.name)` (`index.html:2059-2060`)
- Rules 소유권: `orderData.reportedBy == currentUser().name` (`firestore.rules:72`)

→ 소유권 판정이 문자열 name 일치에 전적으로 의존. (sales name = "영업")

### 전략 A — name 유지 (단기)
신규 `users/{uid}.name`을 기존 `reportedBy` 문자열과 동일 유지. 장점: 무수정 호환. 단점: 동명이인·개명 위험.

### 전략 B — reportedByUid 확장 (중·장기)
신규 orders에 `reportedByUid/reportedByEmail/reportedByName` 동시 저장, Rules를 `reportedByUid == request.auth.uid`로 점진 전환. 기존 orders 일괄 수정은 마이그레이션 승인 전 금지.

### 권장
**단기 A + 중기 B 병행.** name 운영 중 변경 금지(고정 정책) → B6 해소 방향.

---

## 6. Firebase Console 확인 절차 (실행은 별도 승인)

1. Authentication > Sign-in method: Google Provider 활성화 상태 확인
2. Authentication > Settings > Authorized domains: `kimjinman3187-dot.github.io`, `localhost` 등록 확인
3. 각 직원 Google 계정 1회 로그인 → Authentication > Users에서 **Firebase UID** 확인 → §2 표 기입
4. Firestore users 컬렉션 재확인(legacyUserId 전수)
5. 매핑표 "확인 필요" 전부 충족 시 → B1 green 판정

> 본 문서는 절차 정의만. Console 설정·계정 생성·Provider 활성화는 금지 범위로 본 작업에서 수행하지 않음.

---

## 7. 차단 조건 (WORK22-6N-D 연계)

| 코드 | 내용 | 해소 방향 | 현재 상태 |
|---|---|---|---|
| **B1** | users 문서 ID = auth.uid 미확정 | §2 매핑표 UID/email 칸 충족 시 해소 | **RED**(auth_uid `""` 6개, email 부재 — 6N-G0 실증) |
| **B3** | PIN 클라이언트 노출 | §4에서 신규 스키마 pin 배제 + read 범위 축소 | **실증됨**(익명 read로 pin 필드 접근), 구현 대기 |
| **B5** | notifications 읽음 처리 | Phase 6 Rules 재설계에서 사용자별 읽음 모델 | 이월 |
| **B6** | reportedBy 매칭 | §5 A+B 병행 + name 고정 | 방향 확정 |

> B2/B4/B7/B8은 Phase 4·6·7에서 처리. 본 문서의 핵심 기여는 **B1을 채울 표 구조 확정 + name/role/status 실데이터 확정 + emp_acc2 오타·admin 2개·sales 한글 ID 등 운영 리스크 명시.**

---

## 보고 형식 요약

### 1. 생성/수정 파일
`docs/work22-6n-e-google-login-user-mapping.md` (실데이터 반영 갱신). 코드/Rules/Console/운영데이터 변경 없음.

### 2. legacyUserId 목록 (실데이터 확정)
`emp_admin`(윤정원/admin), `admin_gene`(gene kim/admin), `김상경`(영업/sales), `emp_factory`(공장/factory), `emp_acc1`(회계1/accounting), `emp_acc2`(회계2/**ccounting→accounting 정정**).

### 3. Google Login 매핑표
§2 — name/role/status 실데이터 확정, Google Email/Firebase UID/users 경로는 "확인 필요" 유지(B1 RED).

### 4. users/{uid} 목표 구조
§4 — `email/name/role/status/legacyUserId/migratedFromPin`(+선택 createdAt/lastLoginAt). pin/attempts/lockoutUntil 배제, role `ccounting` 금지.

### 5. reportedBy 유지 전략
단기 A(name 유지) + 중기 B(reportedByUid) 병행. name 변경 금지.

### 6. 차단 조건
B1 RED 유지 / B3 실증 / B6 방향 확정 / B5 이월.

### 7. 다음 작업
WORK22-6N-F(Google Login 최소 UI 설계)는 설계 문서로 착수 가능. 코드 구현은 B1 Green 이후로 한정.
