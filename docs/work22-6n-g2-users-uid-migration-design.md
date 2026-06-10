# WORK22-6N-G2 — Google Email / Firebase UID 매핑표 확정 및 users/{uid} 생성 설계

기준일: 2026-06-10
작업 성격: **문서 작성 전용** (코드/Rules/Console/데이터 변경 없음)
선행: `work22-6n-g0-google-login-b1-validation.md`, `work22-6n-g1-google-provider-uid-procedure.md`

## 0. 목적

G1에서 설계한 절차를 기반으로, 실제 운영 계정의 Google Email과 Firebase UID를 매핑하기 위한 **구조를 설계**한다. **아직 코드 구현은 하지 않는다.** `users/{uid}` 생성 방식과 기존 `users` 컬렉션의 보존 정책을 설계하는 문서 작업이다.

## 0-1. 전제

```text
B1 = RED
Google Login 구현 금지
Firestore Rules 배포 금지
users/orders 데이터 수정 금지
```

## 0-2. 금지사항

```text
코드 수정 금지 / index.html 금지 / firebase-shared.js 금지 / firestore.rules 금지
Firebase Console Rules 수정 금지 / users 데이터 수정 금지 / orders 데이터 수정 금지
Google Login 구현 금지 / Reset Data 금지
```

---

## 1. 현재 users 구조 분석

운영 `users` 컬렉션 실데이터(WORK22-6N-G0 익명 read 조회, 6개 문서):

| legacyUserId | name | role(원본) | status | auth_uid | email | pin | sort_index |
|---|---|---|---|---|---|---|---|
| emp_admin | 윤정원 | admin | active | `""` | 없음 | 있음 | 1 |
| admin_gene | gene kim | admin | active | `""` | 없음 | 있음 | 2 |
| 김상경 | 영업 | sales | active | `""` | 없음 | 있음 | 3 |
| emp_factory | 공장 | factory | active | `""` | 없음 | 있음 | 4 |
| emp_acc1 | 회계1 | accounting | active | `""` | 없음 | 있음 | 5 |
| emp_acc2 | 회계2 | **`ccounting`** | active | `""` | 없음 | 있음 | 6 |

구조적 특징과 문제:

1. **문서 ID 규칙 불일치** — `emp_*` 패턴 4개, `admin_gene` 1개, 한글 `김상경` 1개. 일관된 ID 체계 없음.
2. **auth_uid 필드는 존재하나 전부 빈 문자열** — 매핑 기준으로 무효. Rules의 `get(users/$(uid))` 전제 충족 불가.
3. **email 필드 부재** — Google 신원 연결점 없음.
4. **role 오타** `emp_acc2`=`ccounting` — 코드(`firebase-shared.js:49`, `index.html:1767`)가 런타임 보정하나 Rules는 원본을 직접 조회(`firestore.rules:49-51`)하므로 위험.
5. **pin 평문 필드 존재 + 익명 read 노출** (B3).
6. **현재 코드 사용 필드**: `role, status, sort_index, pin, attempts, lockoutUntil, name` (6N-B §5 확인).
7. **admin 2개** (`emp_admin`/`admin_gene`) — 운영 결정 필요.

---

## 2. 목표 users/{uid} 구조

문서 경로: `users/{auth.uid}` (문서 ID = Google 로그인으로 생성된 Firebase UID)

```js
users/{auth.uid} = {
  email: "",            // Google 계정 이메일 (신원)
  name: "",             // 표시 이름 + orders.reportedBy 매칭 키 (변경 금지)
  role: "",             // admin | sales | accounting | factory  (ccounting 금지)
  status: "",           // active | suspended (없으면 active)
  legacyUserId: "",     // 기존 PIN 문서 ID 보존 (추적/rollback)
  migratedFromPin: true,
  createdAt: 0,
  lastLoginAt: 0
}
```

| 필드 | 필수 | 정의·제약 |
|---|---|---|
| email | 필수 | Google 이메일. 권한 판단은 uid 기준. |
| name | 필수 | `orders.reportedBy` 매칭 키. 운영 중 변경 금지(B6). |
| role | 필수 | 4종만. `emp_acc2`는 `accounting`으로 정정 기입. |
| status | 권장 | active/suspended. 미존재 시 active(`firestore.rules:53-57`, `index.html:1025`). |
| legacyUserId | 필수 | 기존 문서 ID 보존. rollback·감사 근거. |
| migratedFromPin | 권장 | 이전 출처 식별. |
| createdAt/lastLoginAt | 선택 | 모니터링용. 권한 판단 미사용. |

**배제 필드:** `pin`, `attempts`, `lockoutUntil` — 신규 문서에 포함하지 않음(B2/B3). PIN 보조 잠금은 권한과 분리해 별도 설계.

---

## 3. legacyUserId 유지 정책

원칙: **기존 문서 ID는 신규 문서 ID로 재사용하지 않는다.** 신규 ID는 Firebase UID이며, 기존 ID는 `legacyUserId` 필드로 **보존**한다.

| legacyUserId | 유지 방식 | 비고 |
|---|---|---|
| emp_admin | `legacyUserId="emp_admin"` 보존 | admin |
| admin_gene | `legacyUserId="admin_gene"` 보존 | admin (2개 계정 정리 결정 §8) |
| 김상경 | `legacyUserId="김상경"` 보존 | **한글 ID 그대로 문자열 보존** (변환·정규화 금지 — 추적 무결성) |
| emp_factory | `legacyUserId="emp_factory"` 보존 | factory |
| emp_acc1 | `legacyUserId="emp_acc1"` 보존 | accounting |
| emp_acc2 | `legacyUserId="emp_acc2"` 보존 | role `ccounting`→`accounting` 정정 |

한글 ID(`김상경`) 처리: legacyUserId 필드에는 **원본 그대로** 저장(역추적 보장). 신규 문서 ID는 UID이므로 한글 ID 자체는 신규 경로에 영향 없음.

---

## 4. Google Email 매핑 정책

- 1 legacyUserId ↔ 1 Google Email ↔ 1 UID (1:1:1 원칙).
- Email은 `users/{uid}.email`에 저장하되 **권한 판단 기준이 아니다**(판단은 uid·role).
- 동일인이 복수 Google 계정을 가질 경우 **운영 대표 계정 1개만** 매핑.
- admin 2개(`emp_admin`/`admin_gene`)는 동일인 여부 확인 후 §8 결정에 따라 1~2개 Email 배정.

매핑표(확정 대기 — G3에서 Email/UID 채움):

| legacyUserId | name | 목표 role | 배정 Google Email | Firebase UID | status |
|---|---|---|---|---|---|
| emp_admin | 윤정원 | admin | 확인 필요 | 미생성 | active |
| admin_gene | gene kim | admin | 확인 필요 | 미생성 | active |
| 김상경 | 영업 | sales | 확인 필요 | 미생성 | active |
| emp_factory | 공장 | factory | 확인 필요 | 미생성 | active |
| emp_acc1 | 회계1 | accounting | 확인 필요 | 미생성 | active |
| emp_acc2 | 회계2 | accounting | 확인 필요 | 미생성 | active |

---

## 5. Firebase UID 매핑 정책

- UID는 **생성 결과물** — Google Provider 활성화 + 해당 계정 1회 로그인 후에만 존재(G1 §7.5).
- UID 확보 후 `users/{UID}` 문서를 신규 생성하며, 기존 문서는 수정하지 않는다.
- UID ↔ Email ↔ legacyUserId 매핑은 **2인 검증**(G1 §7.5 step 9) 후 확정.
- UID는 추측·임의 생성 금지. 반드시 Console Authentication > Users의 실제 값만 사용.

UID 미생성 상태에서는 매핑표의 UID 칸을 "미생성"으로 유지하며, 이 칸이 모두 채워지는 것이 **B1 Green의 핵심 조건**(G1 §7.7).

---

## 6. Migration 절차

**무중단·역가역(reversible)** 원칙. 기존 PIN 구조를 살린 채 신규 구조를 병행 구축한다.

```text
M0. (선행) B1 Green — Email/UID 확보 완료 + Gene 승인
M1. UID별 users/{uid} 문서 신규 생성
    - email/name/role/status/legacyUserId/migratedFromPin 기입
    - emp_acc2는 role=accounting 정정 기입
    - pin/attempts/lockoutUntil 미포함
M2. 기존 legacy users 문서는 그대로 보존(삭제·수정 금지)
M3. (코드 단계, 별도 작업) Google Login UI + users/{uid} 조회 경로 구현
M4. 신·구 병행 검증 — 동일인이 PIN/Google 양쪽에서 동일 role 화면을 받는지 확인
M5. Rules Emulator로 users/{uid} 기반 권한 검증(배포 아님)
M6. reportedBy 정합 확인 — users/{uid}.name == 기존 reportedBy 문자열
M7. (승인 후) 운영 Rules 배포 + PIN 주 인증 → factory 보조 잠금 격하
```

> M1~M2는 데이터 "추가"이지 기존 데이터 "수정"이 아님에 유의. 단 본 G2 작업에서는 **M0~M7 어느 것도 실행하지 않는다**(설계만).

신규 문서 생성 방식(택1, G3에서 확정):

- (A) Console 수동 입력 — 소규모(6건)라 적합, 오타 위험은 체크리스트로 통제
- (B) 1회성 관리 스크립트(Admin SDK) — 재현성 높으나 자격증명·승인 필요

---

## 7. Rollback 절차

```text
R1. 문제 발생 시 신규 users/{uid} 문서 비활성화: status="suspended"로 표시
    (삭제가 아니라 비활성화 — 감사 추적 보존)
R2. 코드/Rules가 배포된 경우 직전 버전으로 되돌림(Google Login UI/Rules)
R3. PIN Login 경로는 Migration 중 보존돼 있으므로 즉시 기존 인증으로 복귀 가능
R4. legacyUserId로 신규 문서 ↔ 기존 문서 역추적, 매핑 오류 정정
R5. orders.reportedBy는 name 기준 유지 상태이므로 데이터 영향 없음(전략 A 덕)
```

Rollback 안전장치:

- 기존 users 문서·PIN 경로를 **Migration 완료 전까지 제거하지 않는다** → 언제든 복귀 가능.
- 신규 문서는 삭제 대신 `suspended` 처리(데이터 보존).
- UID/Email 매핑 2인 검증으로 잘못된 권한 부여 사전 차단.

---

## 8. 운영 리스크

| # | 리스크 | 영향 | 대응 |
|---|---|---|---|
| 1 | emp_acc2 role `ccounting` 미정정 | 회계 권한 누락(Rules 원본 조회) | M1에서 `accounting` 정정 필수 |
| 2 | admin 2개 계정 | 권한 과다·중복 | §8 결정: 유지/통합/폐기 |
| 3 | sales 한글 ID `김상경` | 추적·정렬 혼선 | legacyUserId 원본 보존, 신규 ID는 UID |
| 4 | name 변경 시 reportedBy 단절 | sales 과거 주문 소유권 상실 | name 고정 정책(B6), 중기 reportedByUid |
| 5 | UID 추측/오매핑 | 잘못된 role 부여 | 실 UID만 사용 + 2인 검증 |
| 6 | PIN 평문 노출 | 보안(B3) | 신규 문서 pin 배제 + read 범위 축소 |
| 7 | Rules 선배포 | 인증 전면 거부 | B1 Green + Emulator 통과 + 승인 후 배포 |
| 8 | Google 계정 없는 직원 | 로그인 불가 | 계정 발급/예외 정책 사전 확정 |
| 9 | notifications 읽음 모델(B5) | 비-admin update 거부 | Phase 6 Rules 재설계와 연동 |
| 10 | 기존 users 조기 삭제 | rollback 불가 | Migration 완료 전 삭제 금지 |

---

## 9. G3 작업 제안

```text
WORK22-6N-G3 — Google Provider 활성화 실행 체크리스트 및 B1 Green 검증 절차
```

목적:

```text
G1/G2 설계를 바탕으로 Gene 승인 후 실제 Google Provider 활성화 → 테스트 로그인 →
UID 확보 → 매핑표 확정 → B1 Green 판정까지의 실행 체크리스트와 검증 절차를 정의한다.
```

조건: **G2 완료 후 Gene 승인 시 진행.** G3도 실행 체크리스트·검증 절차 설계이며, 코드 구현은 별도 후속 작업.

---

## 보고용 요약

- 생성 파일: `repo/docs/work22-6n-g2-users-uid-migration-design.md`
- 의도DB 저장: `2026-06-10_WORK22-6N-G2_users_UID마이그레이션설계.md`
- B1 상태: **RED 유지** (UID/Email 미확보 — 설계만 완료)
- 핵심 설계: users/{uid} 목표 구조 + legacyUserId 보존 + 무중단·역가역 Migration(M0~M7) + suspended 기반 Rollback + 운영 리스크 10종
- 다음: WORK22-6N-G3 (Gene 승인 시)
