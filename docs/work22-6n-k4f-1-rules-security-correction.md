# WORK22-6N-K4F-1 — Firestore Rules UID 전환 설계 보안 보정

기준일: 2026-06-11
작업 성격: **설계 보정 문서** (코드/Rules/데이터/배포 변경 없음)
기준 커밋: `origin/main = 3577f92` (PR #77 merged 포함)
선행: K4F(PR #77, 최종 PASS 보류)

## 1. 작업 개요

K4F(PR #77 merged) 병합 후 검토에서 발견된 **두 보안·운영 리스크**를 보정한다. K4F 문서는 폐기하지 않고 본 보정 문서로 결론을 갱신한다. 구현·배포는 하지 않는다.

## 2. K4F 병합 후 검토 결과

| # | 이슈 | 성격 |
|---|---|---|
| 1 | accounting에 orders create 허용 = UI보다 DB 권한이 넓어지는 privilege expansion | 보안(권한 상승) |
| 2 | factory anonymous fallback Rules(factory role 문서만 허용) ↔ 현재 `syncUsers()` 전체 users query 불일치 → permission-denied로 roleGrid/PIN 깨짐 | 운영(전환 깨짐) |

## 3. 보정 필요 사유

K4F §8/§5의 `canCreateOrder()` 표현과 anonymous factory 예외 설계가 **현행 앱 동작과 불일치**하여, 그대로 Rules 구현 시 (1) accounting 권한 상승, (2) factory 로그인 중단을 유발. 따라서 결론을 보정한다.

## 4. 이슈 1 — accounting orders create 권한 상승

### 4-1. 지적 원문
> This create rule grants accounting the ability to add new orders, but the current product gate only lets roles with `sales` write create orders: both `handleReport` and `handleReportPC` call `requireWrite('sales')`, and `ACCESS_MATRIX.accounting.write` is only `['finance', 'ar']`. If implemented as written, an accounting user could bypass the UI and create orders directly via the SDK — a privilege expansion.

### 4-2. 보정 결론
```text
orders create 권한은 accounting에게 부여하지 않는다.
orders create는 기존 앱 동작과 동일하게 sales(및 admin) 권한 기준으로 제한한다.
accounting은 finance / AR / 수금 / 회계 처리 관련 update/read 중심으로 설계한다.
```

## 5. 현재 UI 권한 모델 검증 (코드 근거)

| 확인 | 위치 | 결과 |
|---|---|---|
| ACCESS_MATRIX.accounting.write | `index.html` ACCESS_MATRIX | `['finance', 'ar']` — **'sales' 없음** |
| handleReport 가드 | `index.html:2989` | `requireWrite('sales', ...)` |
| handleReportPC 가드 | `index.html:3149` | `requireWrite('sales', ...)` |
| orders create 발생 | `index.html:3056`(handleReport), `3216`(handleReportPC) | `db.collection('orders').add(newOrder)` |
| accounting UI create 진입 | `canWrite('sales')` = accounting write에 'sales' 미포함 | **불가(차단)** |
| admin | admin.write에 'sales' 포함 | create 가능 |

→ **현행 UI: orders create는 sales + admin만 가능, accounting 불가.** K4F가 accounting create를 허용하면 SDK 우회 권한 상승.

## 6. orders create Rules 보정안

```text
allow create on orders: sales 또는 admin 만 허용
- accounting create orders 금지(명시)
- create 시 request.resource.data.reportedBy == users/{uid}.name && status == 'pending'
accounting 권한 범위:
- finance/ar 필드 update (status/invoiceStatus/invoiceIssuedAt/paidAmount/paymentStatus 등)
- orders 전체 read
- orders create/delete 금지
```

→ `canCreateOrder()`는 `roleIn(['admin','sales'])`로 보정(기존 K4F의 `['admin','sales','accounting']`에서 accounting 제거).

## 7. 이슈 2 — anonymous factory fallback query mismatch

### 7-1. 지적 원문
> The proposed anonymous fallback allows only factory-role user documents, but the current PIN bootstrap still runs `db.collection('users').orderBy('sort_index','asc').get()` and renders them in `syncUsers()`. With Rules, that unfiltered list query will be denied once the rule only permits factory documents — deploying this B-step as described would break the factory roleGrid/PIN login unless the design also requires changing the client query to `role == 'factory'` before the rule is enabled.

### 7-2. 보정 결론
```text
factory anonymous fallback Rules를 활성화하기 전,
클라이언트 users 목록 query를 role == 'factory' 조건으로 먼저 축소해야 한다.
현재 syncUsers()의 전체 users query를 그대로 둔 채 Rules만 factory 문서 허용으로 바꾸면,
Firestore는 query 전체를 permission-denied 처리한다.
```

## 8. 현재 syncUsers / roleGrid query 검증 (코드 근거)

| 확인 | 위치 | 결과 |
|---|---|---|
| syncUsers query | `index.html:1810` | `db.collection('users').orderBy('sort_index','asc').get()` — **무필터 전체** |
| roleGrid 렌더 | syncUsers 결과 → roleGrid/pcRoleGrid | 전체 users 버튼 |
| renderAdminMonitor | `index.html:2108` | `db.collection('users').get()` — **무필터 전체**(admin) |
| factory fallback 표시 | roleGrid(전체 목록 중 factory 포함) | 전체 query 의존 |

→ Firestore list query는 **결과 집합 전체가 규칙을 만족해야** 허용된다. factory 문서만 허용하는 규칙에 무필터 전체 query를 던지면 **쿼리 전체 deny**.

## 9. factory-role-only Rules 적용 전 선행 조건

```text
필수 선행(클라이언트 query 축소):
db.collection('users')
  .where('role', '==', 'factory')
  .orderBy('sort_index', 'asc')
  .get()
또는 factory fallback 전용 query 함수를 별도 분리.

이 선행 수정 없이 factory-role-only Rules를 배포하면
factory roleGrid / PIN login이 permission-denied로 중단된다.
(주의: where('role','==','factory') + orderBy('sort_index') 복합 인덱스 필요 가능)
```

## 10. K4F 원문 설계 보정표

| 항목 | K4F 원문 방향 | 보정 방향 | 이유 |
|---|---|---|---|
| orders create | accounting 허용 가능 표현 존재 | accounting create 금지, sales/admin만 허용 | UI 권한보다 DB 권한이 넓어지는 권한 상승 방지 |
| accounting 권한 | orders create 포함 가능성 | finance/ar read-update 중심 | `ACCESS_MATRIX.accounting.write = ['finance','ar']`와 정합 |
| anonymous factory fallback | factory role users 문서만 허용 | Rules 전 client query를 `role == 'factory'`로 먼저 축소 | unfiltered users query는 permission-denied 가능 |
| syncUsers | 전체 users read 전제 | factory fallback 전용 query 분리 필요 | roleGrid/PIN login 중단 방지 |
| K4F 최종 PASS | PR #77 merge로 완료 | K4F-1 반영 후 PASS 가능 | 보안 보정 필요 |

## 11. Rules 구현 전 필수 체크리스트

```text
1. orders create는 sales/admin만 허용
2. accounting은 orders create 불가로 명시
3. accounting은 finance/ar 처리 권한으로 제한
4. ACCESS_MATRIX와 Rules 권한 모델 충돌 없음 확인
5. handleReport/handleReportPC requireWrite('sales')와 Rules create 조건 일치
6. factory anonymous fallback Rules 배포 전 users query를 role=='factory'로 축소
7. syncUsers 전체 users read를 factory fallback에서 사용하지 않도록 분리
8. factory roleGrid가 permission-denied 없이 뜨는지 Emulator 검증
9. anonymous가 non-factory users 문서를 읽지 못하는지 검증
10. accounting의 SDK orders create가 deny 되는지 검증
11. sales의 정상 orders create 가능 검증
12. admin의 create 가능 여부 정책 명시 후 검증(UI상 admin write에 'sales' 포함 → 허용)
```

## 12. Emulator 검증 보정 시나리오

```text
S1. sales user → orders create → ALLOW
S2. accounting user → orders create via SDK → DENY  (권한 상승 차단)
S3. accounting user → finance/ar update → ALLOW(필드 한정)
S4. anonymous → users where role=='factory' query → ALLOW
S5. anonymous → users unfiltered orderBy('sort_index') query → DENY (예상)
S6. factory roleGrid → factory-only query 적용 후 render 성공
S7. anonymous → non-factory users read → DENY
S8. admin → orders create → ALLOW (정책 확정: admin write에 'sales' 포함)
```

## 13. K4G 연결 영향

```text
K4G는 여전히 필요하다. 다만 K4G 이전에 K4F-1에서 확정해야 할 조건:
1. factory fallback query를 role == 'factory'로 축소해야 한다.
2. accounting orders create는 금지해야 한다.
3. factory 예외는 임시이며 K4G 이후 제거한다.
4. K4G 완료 전 Rules UID 전환은 admin/sales/accounting 우선 + factory 예외 방식으로만 가능하다.
```

## 14. 금지사항 준수 확인
```text
코드 변경 없음 / firestore.rules·database.rules.json 생성·수정 없음 / firebase.json 변경 없음
Firebase Console Rules 변경 없음 / users·orders 데이터 변경 없음 / Reset Data 미사용 / Rules 배포 없음
실제 client query 수정 없음(설계만) / main 직접 수정 없음 / Delete Branch 없음
K4A~K4F 브랜치 재사용 없음(신규 브랜치) / K3D hotfix 브랜치 미접촉 / 최종 PASS 선언 안 함
```

## 15. PASS 기준
```text
origin/main 최신(3577f92) 기준 / PR #77 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
이슈1(accounting create 권한 상승) 반영 + accounting create 금지 + sales/admin 제한 결론 명시
이슈2(anonymous factory query mismatch) 반영 + role=='factory' 선행 축소 조건 + permission-denied 리스크 명시
K4F 원문 보정표 + Rules 구현 전 체크리스트 + Emulator 보정 시나리오 + K4G 연결 영향 포함
코드·Rules·데이터·배포 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.
