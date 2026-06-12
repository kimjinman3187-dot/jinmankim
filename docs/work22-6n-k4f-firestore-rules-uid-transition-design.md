# WORK22-6N-K4F — Firestore Rules UID 기반 전환 설계

기준일: 2026-06-11
작업 성격: **설계 문서** (코드/Rules/데이터/배포 변경 없음)
기준 커밋: `origin/main = 9199d12` (PR #76 merged 포함)
선행: K4A(#74), K4B(#72), K4C(#73), K4D(#75), K4E(#76)

## 1. 작업 개요

Firestore Rules를 즉시 수정하지 않고, 현재 인증 구조(`Firebase UID + users/{uid}`)를 기준으로 **UID 기반 Rules 전환 설계**를 작성한다. admin/sales/accounting을 UID 기준으로 우선 전환하고, factory는 PIN fallback/Anonymous 잔존 때문에 임시 예외로 둔다. 구현·배포는 하지 않는다.

## 2. 현재 Rules / 인증 구조

```text
Google Login → auth.currentUser.uid → users/{uid} → currentUser(메모리) → ACCESS_MATRIX → 화면
factory 모바일: PIN → Anonymous → syncUsers(users read) → roleGrid → tryLogin → sessionStorage
```

- 권한 판단이 현재 **클라이언트 ACCESS_MATRIX** 중심(UI 제어). 서버측 Rules 강제는 미배포.

## 3. Firestore Rules 파일 존재 여부

```text
Rules 파일 상태 (origin/main 9199d12 기준):
- firestore.rules: 없음
- database.rules.json: 없음
- firebase.json: 없음
- Firebase Console Rules 직접 확인: 수행하지 않음
- 참고: firestore.rules 초안(WORK22-6N-A DESIGN DRAFT)은 설계 브랜치 test/work22-6n-d 에만 존재, main 미반영·미배포
- K4F 문서는 저장소 기준 코드 조사로만 작성 (Rules 파일 신규 생성하지 않음)
```

## 4. collection read/write 경로 조사

접근 collection(코드 grep): `users`×9, `orders`×16, `audit_logs`×2, `notifications`×2.

| collection | read 경로 | write 경로 |
|---|---|---|
| `users` | `syncUsers()` 전체 read(roleGrid/PIN), `loadCurrentUserFromAuthUser` **users/{uid} 단건 read** | `users.doc(id).update({attempts,lockoutUntil})`(PIN 잠금), `forceUnlock`(admin) |
| `orders` | 메인 리스너(role 분기: sales=reportedBy, factory=approved/completed, 그외=전체), finance 3E/3F/3G 리스너, 3h3i 요약카드, sales 쿼리 | 주문 생성(reportedBy), status변경/반려/계산서/입금/생산 update |
| `audit_logs` | (없음 — 클라이언트 read 미사용) | `logAction()` add (user/role/action/timestamp) |
| `notifications` | `target_roles array-contains currentUser.role` read | `update({read,read_at})`(읽음 표시) |

## 5. users/{uid} 기준 권한 모델

```text
신원: request.auth.uid (Firebase Auth)
권한 source: get(/users/$(request.auth.uid)).data 의 role/status
- signedIn()      = request.auth != null
- userDoc()       = get(/databases/$(db)/documents/users/$(request.auth.uid))
- hasUserDoc()    = signedIn() && exists(userDoc)
- currentRole()   = hasUserDoc ? userDoc.role : null
- currentStatus() = userDoc.status (없으면 'active')
- activeUser()    = hasUserDoc && currentStatus=='active'
- roleIn(roles)   = activeUser() && currentRole() in roles
```

→ 이는 설계 브랜치의 `firestore.rules` 초안 함수 모델과 동일 골격. **factory 익명 uid는 users/{uid}가 없어 hasUserDoc=false → 예외 처리 필요**(§10).

## 6. role별 권한 설계

| role | users | orders | finance/AR | dashboard |
|---|---|---|---|---|
| admin | 본인 read + (제한적) 목록 read, write 제한 | 전체 read, write(검토) | read 가능 | read 가능 |
| sales | 본인 users/{uid}만 read | 본인 reportedBy read, 신규 create, Sales/AR update | AR update 가능, Finance update 차단 | read 가능 |
| accounting | 본인 users/{uid}만 read | 전체 read, Finance/AR update | read/update 가능 | read 가능 |
| factory | (예외) factory 목록 최소 read | approved/completed read, 생산 필드 update | 차단 | 프론트 차단 유지 |

공통: `status != active` → 전면 차단.

## 7. users collection Rules 설계

```text
1. users/{uid} 단건 read: 본인(request.auth.uid == uid) 허용
2. 본인 read 허용 (role/status 조회용)
3. users 전체 read: 기본 금지
4. admin만 제한적 users 목록 read 허용
5. factory PIN fallback 구간: factory role 문서만 최소 read하는 예외(제거 예정)
6. users write: admin/운영자 제한 (role/status/pin 변경은 admin 전용)
7. 사용자 자기 role/status 직접 수정 금지 (self-update는 attempts/lockoutUntil 등 비권한 필드만)
8. status != active 사용자 차단
```

> 현행 충돌(6N-D B1~B3): PIN 잠금 self-update가 `users.doc(legacyId)`(uid 아님)라 uid 기반 Rules와 충돌 → factory 예외/PIN 제거(K4D) 시 정리. PIN 평문 노출(B3) → users 전체 read 차단으로 해소.

## 8. orders collection Rules 설계

```text
read:
- admin: 전체
- accounting: 전체
- sales: reportedBy == users/{uid}.name (중기 reportedByUid == auth.uid)
- factory: status in ['approved','completed']
create:
- admin/sales/accounting: reportedBy == 본인 name, status == 'pending'
update(필드 단위, affectedKeys 제한):
- Sales(status/rejectReason/invoice...): admin/sales/accounting
- Finance(status/invoiceStatus/invoiceIssuedAt/updatedAt): admin/accounting
- AR(paidAmount/paymentStatus/updatedAt): admin/sales/accounting
- Production(completedQty/status/completedAt/updatedAt): admin/factory
delete: admin 전용 또는 전면 차단
```

## 9. finance / AR / dashboard 접근 설계

```text
finance/AR:
- read: admin/accounting 중심 (sales는 본인 AR 한정)
- listener 생명주기 ↔ Rules 권한 일치: K3D yjCanStartFinanceListeners(admin/accounting)와 Rules read 권한 일치시켜 permission-denied 재발 방지
- 체크리스트: ① 리스너 시작 role(admin/accounting) == Rules read 허용 role ② 익명 컨텍스트 미시작 ③ 에러 시 재구독
dashboard:
- productName/finance/receivable read: 로그인+role 기반. factory는 프론트 차단 유지
- aggregation read 필요 시 role별 제한
```

## 10. factory PIN fallback 예외 설계

```text
- PIN fallback 예외 필요: ✅ (factory 익명 uid는 users/{uid} 없음)
- Anonymous 예외 필요: ✅ (roleGrid용 users read 컨텍스트)
- users read 예외 범위: factory role 문서 최소 read로 한정 (전체 read 금지)
- 예외 제거 조건: factory 기기/공용 Google 계정 + users/{uid}(role=factory) 발급(K4G) 후
- 예외는 영구 아님 — 제거 예정 명시
```

## 11. 정책 선택지 A/B/C/D 비교

| 기준 | A(즉시 전체 UID) | B(admin/sales/acc 우선+factory 예외) | C(현행 유지) | D(factory Google 선행 후 전체) |
|---|---|---|---|---|
| 보안 명확성 | ✅ | 중간 | ❌ | ✅ |
| users 전체 read 차단 | ✅ | 부분 | ❌ | ✅ |
| Anonymous 제거 | ✅ | 지연 | ❌ | ✅ |
| factory 현장 연속성 | ❌ 위험 | ✅ | ✅ | ✅ |
| 계정 선행 | 없음 | 없음 | 없음 | factory Google |

- A: factory Gmail/UID 미수집 → 현장 중단 위험.
- B: 주요 데이터 보안 강화 + factory 연속성 + 단계 전환.
- C: 병목 고착, client ACCESS_MATRIX 의존 지속.
- D: 최종 정리, 계정 발급 선행.

## 12. 권장안 — 기본 B안 → 최종 D안

**기본 권장: B안** (admin/sales/accounting UID 우선 전환 + factory 최소 예외)
**최종 목표: D안** (factory Google 계정 선행 후 전체 UID 전환)

1. **선택 이유:** admin/sales/accounting은 Google UID + users/{uid} 확보로 즉시 UID Rules 가능. factory만 PIN/익명 잔존이라 최소 예외. K4G로 factory 전환 후 예외 폐지.
2. **admin 권한:** users 본인+제한 목록 read, orders 전체 read, write 제한, finance/dashboard read.
3. **sales 권한:** 본인 users/{uid} read, 본인 reportedBy orders read/create, Sales·AR update, Finance 차단.
4. **accounting 권한:** 본인 users read, orders 전체 read, Finance·AR update, users 전체 read 금지.
5. **factory 예외:** §10 (factory role 최소 read, 제거 예정).
6. **users read/write:** §7.
7. **orders read/write:** §8.
8. **finance/AR listener:** §9 (리스너 role ↔ Rules 일치).
9. **dashboard read:** §9.
10. **K4G 선행:** §13.
11. **rollback:** §19.
12. **Emulator 검증:** §15.

## 13. K4G factory 계정 전환 연결

```text
K4G 후보: WORK22-6N-K4G — factory 기기/공용 Google 계정 및 users/{uid} 발급 설계
선행 조건:
1. factory용 Google 계정/기기별 계정 결정
2. Firebase Auth UID 확보
3. users/{uid} 생성 (role=factory, status=active)
4. 모바일 Google Login 버튼/ factory login 경로 설계
5. factory PIN fallback 제거 가능성 검증
→ 완료 시: factory 예외 폐지 + Anonymous 완전 제거(K4E) + users 전체 read 제거(K4B) 완결
```

## 14. Rules 전환 단계 설계 (K4F-1 ~ K4F-10)

```text
K4F-1: Firestore Rules 파일 존재 여부 확인 → 완료(§3: 없음)
K4F-2: collection read/write 경로 전수조사 → 완료(§4)
K4F-3: users/{uid} 기준 권한 모델 설계 → §5
K4F-4: admin/sales/accounting UID 기반 Rules 설계 → §6·§8
K4F-5: factory PIN fallback 예외 설계 → §10
K4F-6: users 전체 read 차단 단계 설계 → §7 (단계: factory 예외 read만 허용→K4G 후 차단)
K4F-7: orders/finance/dashboard role별 접근 설계 → §8·§9
K4F-8: Emulator 검증 시나리오 설계 → §15
K4F-9: rollback 기준 작성 → §19
K4F-10: K4G factory 계정 전환 연결 → §13
```

## 15. Emulator 검증 시나리오

```text
fixture: users/{adminUid,salesUid,accountingUid,factoryUid,suspendedUid}, orders(salesOwn/other/approved/completed/rejected), audit_logs, notifications
assert:
- admin: users 본인 read OK / orders 전체 read OK / suspended write 차단
- sales: 본인 reportedBy orders read OK / 타 sales orders read 차단 / Finance update 차단 / users 전체 read 차단
- accounting: orders 전체 read OK / Finance·AR update OK / Production update 차단 / users 전체 read 차단
- factory: approved/completed read OK / pending read 차단 / Production update OK / 그 외 write 차단
- anonymous(factory 예외): factory role 최소 read만 허용 / 그 외 전면 차단
- unauthenticated: 전면 차단
- suspended(status!=active): 전면 차단
permission-denied 재현/방지: finance 리스너 시작 role == Rules read 허용 role 일치 검증(K3C 재발 방지)
주의: Emulator 통과는 배포 완료가 아님. 운영 배포는 별도 승인.
```

## 16. 운영 리스크
- factory 예외 구간 장기화 시 보안 약점 지속
- Rules 복잡도 증가(예외 분기)
- users 전체 read 차단 시 PIN roleGrid 영향(K4D/K4E와 동기 필요)

## 17. 보안 리스크
- 익명 uid 기반 factory 예외의 권한 강제 한계
- PIN 평문 노출(B3)은 users 전체 read 차단 전까지 잔존
- client currentUser는 신뢰 불가 — 반드시 서버 Rules로 최소 강제

## 18. UX 리스크
- Rules 배포 시 잘못된 제한으로 화면 깨짐 가능 → Emulator 선검증 필수
- factory 전환기 경로 이원화 혼선

## 19. rollback 설계
- Rules는 **배포 전 Emulator 전량 통과 + 수동 승인** 후에만 적용. 본 작업은 설계만.
- 배포 시 직전 Rules 백업 → 문제 시 즉시 revert.
- 단계 배포(읽기 우선 → 쓰기) 권장, 각 단계 회귀 테스트.
- factory 예외는 토글 가능한 분기로 유지(K4G 완료 전 제거 금지).
- 브랜치 보존, Delete Branch 금지.

## 20. 금지사항 준수 확인
```text
코드 변경 없음 / firestore.rules·database.rules.json·firebase.json 변경 없음(파일 미존재, 신규 생성 안 함)
Firebase Console Rules 변경 없음 / users·orders 데이터 변경 없음 / Reset Data 미사용 / Rules 배포 없음
main 직접 수정 없음 / Delete Branch 없음 / K4A~K4E 브랜치 재사용 없음(신규 브랜치)
K3D hotfix 브랜치 미접촉 / Emulator 결과를 배포 완료로 표현 안 함 / 최종 PASS 선언 안 함
```

## 21. PASS 기준
```text
origin/main 최신(9199d12) 기준 / PR #76 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
Rules 파일 존재 여부 조사 완료(없음) / collection read/write 경로 조사 완료
users/{uid} 권한 모델 + admin/sales/accounting UID Rules + factory 예외 + users 전체 read 차단 단계 설계 완료
orders/finance/dashboard role별 접근 설계 완료 / 선택지 A/B/C/D 비교 완료 / 권장안 제시 완료
K4G 연결 + Emulator 시나리오 + rollback 포함 / 코드·Rules·데이터·배포 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.
