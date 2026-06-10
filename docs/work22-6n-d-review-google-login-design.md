# WORK22-6N-D-REVIEW — Google Login Auth/Role 설계문서 검토 보고서

기준일: 2026-06-09
검토 브랜치: `test/work22-6n-d-google-login-auth-design`
검토자: Claude Code (읽기 전용 검토)

## 0. 검토 범위 및 준수 사항

검토 대상:

- `docs/work22-6n-d-google-login-auth-design.md` (설계 초안 D)
- `docs/work22-6n-b-rules-simulation-plan.md` (Rules 시뮬레이션 계획 B)
- `firestore.rules` (WORK22-6N-A DESIGN DRAFT)
- `index.html` (운영 프론트엔드)
- `js/firebase-shared.js` (Firebase 초기화 공용 스크립트)

준수 사항(모두 지킴): 코드 수정 없음, PR 생성 없음, Firebase Console 미접근, Rules 미배포, users/orders 데이터 미변경, Reset Data 미실행. 본 보고서 1개 파일만 신규 작성.

검토 방식: 저장소를 로컬에 클론(push 없음)한 뒤 해당 브랜치를 체크아웃하여 설계문서 2종과 운영 코드 3종을 정적 분석. 단, **운영 Firestore 실데이터(users 문서 ID가 실제 auth uid와 일치하는지 등)는 본 검토에서 직접 확인 불가** — 이 부분은 설계문서 B의 "운영에서 확인할 항목"으로 남아 있으며 본 보고서에서도 차단 조건으로 유지한다.

---

## 1. 설계문서와 현재 코드의 일치 항목

설계문서가 현재 코드 구조를 정확히 기술한 항목:

| # | 설계문서 주장 | 코드 근거 | 판정 |
|---|---|---|---|
| 1 | 앱 로드 시 Anonymous Auth 먼저 실행 | `js/firebase-shared.js:29-38` `signInAnonymously()`, 호출부 `index.html:1741` | 일치 |
| 2 | 이후 users 컬렉션을 읽어 PIN 로그인 목록 구성 | `index.html:1760-1799` (`syncUsers` → roleGrid/pcRoleGrid 렌더) | 일치 |
| 3 | PIN 성공 시 `currentUser=user` + `sessionStorage.yongjin_session`에 전체 저장 | `index.html:1859-1861` | 일치 |
| 4 | sessionStorage에 role/name/id/pin/status 등 저장 | `index.html:1861` (`JSON.stringify(currentUser)`, currentUser는 `{id, ...doc.data()}`로 pin 포함) | 일치 |
| 5 | 주문 생성 시 `reportedBy = currentUser.name` 사용 | `index.html:2850, 2873` (모바일), `3010, 3033` (PC) | 일치 |
| 6 | `auth.currentUser.uid`와 `users` 문서 ID를 연결/검증하는 코드 없음 | 전체 코드에서 `auth.currentUser.uid` 비교 로직 부재 확인 | 일치 |
| 7 | users 업데이트는 `users.doc(user.id).update(...)`로 수행 | `index.html:1860, 1864, 1865, 1930` | 일치 |
| 8 | PIN 검증은 클라이언트에서 `pinBuffer === user.pin` 비교 | `index.html:1859` | 일치 |
| 9 | users read 허용 시 PIN 노출 위험 | `firestore.rules:137` `allow read: if signedIn()` + USERS에 pin 포함 | 일치 |
| 10 | role 종류 = admin / sales / accounting / factory | `index.html:958-975` ACCESS_MATRIX, `firestore.rules:63-87` | 일치 |
| 11 | ACCESS_MATRIX가 `currentUser.role` 기준으로 view/write 판단 | `index.html:1023-1024` (`canView`/`canWrite`) | 일치 |
| 12 | sales는 본인 `reportedBy == currentUser.name` 주문만 조회 | `index.html:2059-2060` (`where('reportedBy','==',currentUser.name)`) | 일치 |
| 13 | notifications는 `target_roles array-contains role`로 조회 후 read 상태 update | `index.html:2422`(query), `2429`(`update({read:true,read_at})`) | 일치 |
| 14 | audit_logs 컬렉션명은 `audit_logs` | `index.html:1734` (`db.collection('audit_logs')`) | 일치 |
| 15 | custom claims 미사용 | 코드 전체에서 custom claims 설정/참조 부재 확인 | 일치 |
| 16 | GoogleAuthProvider 미사용(현재) | `GoogleAuthProvider`/`signInWithPopup`/`signInWithRedirect` 전부 부재 확인 | 일치 |

**결론:** 설계문서 D와 B의 현행 구조 진단은 코드와 매우 정확하게 일치한다. 잘못 기술된 현행 구조 항목은 발견되지 않았다.

---

## 2. 설계문서와 현재 코드의 불일치 항목

설계문서가 명시하지 않았거나 설계가 현재 코드와 충돌하는 지점:

### 2-1. firestore.rules의 users 자기수정 규칙 ↔ 현재 PIN 잠금 로직 충돌 (중대)

- `firestore.rules:141-145`는 `userId == request.auth.uid`일 때만 `attempts`/`lockoutUntil` self-update를 허용한다.
- 그러나 현재 코드는 `db.collection('users').doc(user.id).update({attempts, lockoutUntil})` (`index.html:1860, 1864, 1865`)에서 `user.id`가 **PIN 문서 ID(`emp_acc1` 등)**이며 **Anonymous auth.uid가 아니다.**
- 즉 현재 Rules 초안을 그대로 배포하면 PIN 실패 카운트/잠금 쓰기가 **전부 거부**된다. 설계문서 D는 "attempts/lockoutUntil을 권한 기준으로 쓰지 않는다"(§5-9)고만 했을 뿐, 이 write 경로 자체가 깨진다는 점은 명시하지 않았다.

### 2-2. audit_logs create 규칙 ↔ 현재 익명 인증 충돌 (중대)

- `firestore.rules:171-173`은 create 시 `request.resource.data.user == currentUser().name`을 요구하고, `currentUser()`는 `get(users/$(request.auth.uid))`이다(`firestore.rules:37-47`).
- 현재 익명 uid에는 `users/{uid}` 문서가 없으므로 `get()`이 실패 → 모든 audit_logs 기록(`index.html:1734`)이 거부된다.
- 설계문서는 audit_logs를 §10(B)에서 다루지만, **Google Login 전환 전에는 이 규칙이 동작 불가**라는 점을 차단 조건으로 더 강하게 표시할 필요가 있다.

### 2-3. notifications update 규칙 ↔ 현재 읽음 처리 충돌 (중대)

- `firestore.rules:189` `allow create, update, delete: if isAdmin();` — update가 admin 전용.
- 현재 코드 `index.html:2429`는 일반 사용자(sales/factory 포함)가 알림을 읽으면 `update({read:true, read_at})`를 수행한다.
- 따라서 비-admin 사용자의 알림 읽음 처리가 거부된다. 설계문서 B §11이 "알림 읽음 상태 모델 재검토"로 지적한 사항과 동일하나, 코드 동작이 즉시 깨진다는 점에서 차단 조건으로 승격해야 한다.

### 2-4. logout에 `firebase.auth().signOut()` 부재 (설계와 코드 갭)

- 설계문서 D §6은 "로그아웃 시 `firebase.auth().signOut()` 호출"을 목표로 명시한다.
- 현재 `logout()`(`index.html:2439`)은 `sessionStorage.removeItem` + 리스너 해제 + `location.reload()`만 수행하고 **signOut을 호출하지 않는다.** Google Login 전환 시 신규 구현 대상으로 정확히 식별되어 있어 문제는 아니나, 현재 코드에 signOut 경로가 전무하다는 사실은 명시 가치가 있다.

### 2-5. 세션 복원 시 uid 재검증 부재 (설계가 보강해야 할 갭)

- `index.html:3293-3300`은 `sessionStorage`에서 `currentUser`를 복원할 때 `-local` 접미사만 거를 뿐, **현재 auth 세션과의 uid 일치 검증 없이** `processLoginSuccess()`로 진입한다.
- Google Login 전환 시 "복원된 currentUser.uid == 현재 auth.uid" 검증을 추가하지 않으면 신뢰 경계가 다시 깨진다. 설계문서 §10의 "sessionStorage 의존 제거 과정에서 화면 복원 흐름이 흔들릴 가능성"에 해당하나, 구체적 코드 지점(3293-3300)으로 못박아야 한다.

### 2-6. syncUsers 이중 정의 / status 필터 불일치 (경미하나 전환 시 주의)

- `js/firebase-shared.js:40-60`의 `syncUsers`는 `where('status','==','active')`로 서버 필터.
- `index.html:1760-1815`는 동명 함수를 **재정의**하여 `orderBy('sort_index')`로 전체를 읽고 클라이언트에서 `status==='active'` 필터(`index.html:1769`). 실제 호출되는 것은 index.html 측이다.
- Google Login + `users/{uid}` 단건 조회 구조로 전환하면 이 "전체 users read" 자체가 사라져야 하므로, 두 정의 모두 정리 대상. 설계문서는 단건 조회 전환은 말하나 이 이중 정의는 언급하지 않는다.

### 2-7. orders 필드 단위 write 정합성 (대체로 일치, 1건 주의)

현행 write payload와 Rules `affectedKeys` 비교 결과 — 대부분 부분집합으로 통과하나 확인 필요:

| 동작 | 코드 write 필드 | 대응 Rules | 판정 |
|---|---|---|---|
| 승인/상태변경 `updateStatus` `index.html:2280` | `{status}` | finance `hasOnly[status,rejectReason,invoiceStatus,invoiceIssuedAt,updatedAt]` | 통과(부분집합) |
| 반려 `rejectOrder` `index.html:2289` | `{status,rejectReason}` | finance 동일 | 통과 |
| 계산서 `index.html:2305-2308` | `{invoiceStatus,invoiceIssuedAt}` | finance 동일 | 통과 |
| 입금 `confirmPayment` `index.html:2360` | `{paidAmount,paymentStatus}` | AR `hasOnly[paidAmount,paymentStatus,updatedAt]` | 통과 |
| 생산 `index.html:2205-2208` | `{completedQty,status,completedAt?}` | production `hasOnly[completedQty,status,completedAt,updatedAt]` | 통과 |

→ 필드 차원은 현재 거의 정합적이다. 단 코드가 `updatedAt`을 **쓰지 않음**에 유의(부분집합이라 통과하나, 향후 `updatedAt` 강제 요구로 룰을 강화하면 코드도 함께 수정 필요).

---

## 3. 구현 전 반드시 해결해야 할 차단 조건 (Blocking)

아래는 Google Login 전환 코딩 착수 전 또는 Rules 배포 전 **반드시** 해소해야 하는 조건이다. 하나라도 미해결 시 해당 단계 진입 금지.

### B1. users 문서 ID = auth.uid 보장 (최우선)
현재 users 문서 ID는 `emp_acc1` 등 임의 ID이며 익명 uid와 무관(`index.html:1764-1768`). `firestore.rules`의 모든 권한 함수가 `get(users/$(request.auth.uid))` 전제(`firestore.rules:37-47`). **Google 계정별 실제 Firebase uid 확정 + `users/{uid}` 신규 문서 생성 전까지 Rules 배포 절대 금지.** (설계 B §12 1번과 동일)

### B2. PIN 잠금 write 경로 재설계
B1이 충족되어 문서 ID가 uid로 바뀌면 `index.html:1860/1864/1865/1930`의 `users.doc(user.id)` 호출 대상도 uid로 바뀌어야 한다. 그 전까지 `firestore.rules:141-145` self-update 규칙은 현행 코드와 충돌(거부). PIN을 보조 잠금으로 격하(§7 분리)하면서 이 write를 server 권한과 분리할지 결정 필요.

### B3. PIN 값의 클라이언트 노출 제거 결정
`firestore.rules:137` `allow read: if signedIn()`이 유지되면 모든 로그인 사용자가 타인 `pin`을 읽을 수 있다. Google Login 후에는 `users/{uid}` self-read로 좁히고(설계 §7) PIN 검증을 클라이언트 밖으로 옮기는 결정 선행 필요. (설계 B §5 노출 위험, §12와 동일)

### B4. audit_logs create 규칙 동작 가능 시점 확정
`firestore.rules:171-173`은 `users/{uid}` 문서 존재 + `name`/`role` 일치를 요구. Google Login + 매핑 완료 전에는 감사 로그 기록이 거부된다. Phase 4(로그인 구현) 시점에 users/{uid}가 먼저 존재해야 함.

### B5. notifications 읽음 상태 모델 결정
`firestore.rules:189`(update admin 전용)와 `index.html:2429`(일반 사용자 읽음 update) 충돌. 사용자별 읽음 상태(예: `notifications/{id}/reads/{uid}` 서브문서 또는 uid 배열) 모델 확정 전 notifications Rules 배포 금지. (설계 B §11과 동일)

### B6. orders.reportedBy ↔ users.name 매칭 안정성 확정
`firestore.rules:72` `isSalesOwner`가 `orderData.reportedBy == currentUser().name` 비교. Google 전환 후 users.name이 바뀌면 과거 주문 소유권 판정이 깨진다. 설계 §5의 "name 고정 정책" 또는 신규 주문 `reportedByUid` 도입 확정 필요. (설계 B §12와 동일)

### B7. 동일 익명 uid 다중 role 선택 가능성 차단
현재 한 익명 세션에서 여러 PIN 사용자 선택 가능(`index.html:1839 chooseUser`). Google Login은 uid=1 identity로 이를 자연 해소하나, 전환 완료 전 Rules가 role을 신뢰할 수 없음. (설계 B §2, §6과 동일)

### B8. Rules Emulator 테스트 fixture/케이스 미작성
설계 B §13의 fixture·assert가 아직 코드/스크립트로 존재하지 않음. 운영 배포 전 필수. (Phase 7)

---

## 4. 수정 대상 파일 목록

Google Login 전환 시 실제로 손대야 하는 파일과 지점:

| 파일 | 수정 지점(현행 라인) | 수정 성격 |
|---|---|---|
| `js/firebase-shared.js` | `29-38` signInAnonymously | Google provider 로그인 함수 추가(익명 제거/대체), `signOut` 헬퍼 추가 |
| `js/firebase-shared.js` | `40-60` syncUsers | 전체 users read → `users/{uid}` 단건 조회로 교체 |
| `index.html` | `1736-1758` window.onload | 익명 인증 호출 제거, `onAuthStateChanged` + Google Login 버튼 흐름으로 교체 |
| `index.html` | `1760-1815` syncUsers(재정의) | 전체 users read 제거, PIN 로그인 그리드 렌더 제거 또는 보조잠금용으로 축소 |
| `index.html` | `1833-1879` checkLockout/chooseUser/tryLogin/pcAdminBypass | PIN 주 인증 흐름 → 보조 잠금으로 격하 또는 제거 |
| `index.html` | `1859-1861` PIN 성공 시 currentUser 설정 | `users/{uid}` 조회 결과로 currentUser 구성하도록 교체 |
| `index.html` | `2439` logout | `firebase.auth().signOut()` 추가 |
| `index.html` | `3285-3311` 세션 복원 | sessionStorage 의존 축소 + 복원 시 auth.uid 재검증 추가 |
| `index.html` | `1734` logAction | (Rules와 정합) user/role 출처를 users/{uid} 기준으로 유지 |
| `index.html` | `2422-2429` notifications | 사용자별 읽음 모델로 재설계(Rules B5와 연동) |
| `index.html` | `2059-2060` sales 주문 쿼리 | 단기 name 기준 유지, 중기 `reportedByUid` 기준으로 전환 |
| `firestore.rules` | `137` users read | `signedIn()` → `userId == request.auth.uid \|\| isAdmin()`로 축소 |
| `firestore.rules` | `141-148` users update | uid 기준 self-update 유지, PIN 잠금 필드 의존 정리 |
| `firestore.rules` | `72` isSalesOwner | `reportedBy == name` → 점진적으로 `reportedByUid == uid` |
| `firestore.rules` | `186-190` notifications | 사용자별 읽음 모델로 update 규칙 재설계 |
| (신규) | `firestore.rules` 테스트 / fixture | Emulator 테스트 스크립트 신규 작성 |

> ACCESS_MATRIX(`index.html:958-975`)는 **수정 불필요** — role source만 바뀌고 매트릭스 자체는 유지(§6 참조).

---

## 5. 권장 구현 순서

설계문서 D §9의 Phase 구분을 코드 충돌 기준으로 재배열·보강한 권장 순서:

1. **Phase 1~3 (코딩 전 / 데이터 확정)** — 현재 단계에서 즉시 가능
   - Firebase Console Google provider 활성화 계획 + Authorized domains(`kimjinman3187-dot.github.io`) 확인
   - 테스트 Google 계정별 실제 auth.uid 확인 → **B1 해소**
   - legacy PIN 문서 ↔ `users/{uid}` 매핑표 작성 → WORK22-6N-E
   - ※ 이 단계까지는 코드/Rules 변경 없음. **22-6N-E가 곧 이 단계의 산출물.**

2. **Phase 4 (Google Login 최소 구현)** — B1 확인 후 착수
   - `firebase-shared.js` + `index.html` 인증 진입부 교체(§4 표)
   - `users/{uid}` 조회 → currentUser 구성, status≠active 시 signOut
   - logout에 signOut 추가, 세션 복원 uid 재검증 추가
   - PIN UI는 제거 또는 보조 잠금으로 격하 → **B2 분리 결정 반영**

3. **Phase 5 (권한 회귀 테스트)** — 프론트 한정, Rules 미배포 상태
   - role별 메뉴/화면/수정 권한, URL hash 직접 접근 차단 검증
   - ACCESS_MATRIX는 그대로 두고 role source만 검증

4. **Phase 6 (firestore.rules 재설계)** — B3/B5/B6 결정 반영
   - users read 축소(137), self-update uid화(141-148), notifications 읽음 모델(186-190), sales 소유권 uid 전환(72)

5. **Phase 7 (Emulator 테스트)** — **B8 해소**
   - 설계 B §13 fixture/assert를 실제 테스트 스크립트로 작성, suspended·missing-uid·role별 allow/deny 통과

6. **Phase 8 (운영 Rules 수동 적용 판단)**
   - B1~B8 전부 green + 인덱스 Enabled 확인 + 수동 승인 후에만 Console에서 배포

핵심 원칙: **B1(uid 매핑) 확정 전에는 어떤 코드/Rules도 손대지 않는다.** 데이터 사실 확인이 모든 코딩의 선행 조건.

---

## 6. 22-6N-E 착수 가능 여부

**판정: 착수 가능 (조건부 — 데이터 확인 작업으로 한정).**

근거:

- 22-6N-E의 정의는 "테스트 Google 계정 목록 확정 + Firebase Auth uid 확인 절차 + legacy↔uid 매핑표 + reportedBy 유지 정책 확정"(설계 D §12)으로, **전부 코드/Rules/데이터 변경이 아닌 조사·문서화 작업**이다. 따라서 본 검토의 금지사항(코드/Rules/데이터 변경)과 충돌하지 않는다.
- 22-6N-E는 본 보고서 **B1·B6의 해소 작업 그 자체**이며, B1은 다른 모든 단계(Phase 4~8)의 선행 조건이다. 즉 22-6N-E는 전환 전 반드시 먼저 수행되어야 할 단계로, 우선순위가 가장 높다.
- 다만 22-6N-E 진행 중 **실제 users 문서 ID와 auth.uid 비교 결과**가 나와야 B1을 green으로 전환할 수 있으며, 이 확인은 운영 Firebase 접근(읽기)이 필요하다 — 본 정적 검토 범위 밖이므로 22-6N-E에서 수행.

**착수 시 가드레일:**

1. 22-6N-E는 **매핑표 작성과 절차 정의까지만** 수행 — Console에서 provider를 켜거나 users 문서를 생성하는 것은 별도 승인 단계(Phase 2~3 실행)로 분리.
2. reportedBy 유지 정책(B6)을 22-6N-E 산출물에 반드시 포함 — name 고정 vs reportedByUid 도입 중 택일 명문화.
3. 매핑표에 `legacyUserId / email / 예상 role / status / 대응 auth.uid(확인 후)` 컬럼을 두고, uid 미확인 행은 명시적으로 "미확인"으로 표시해 B1 green 판정 기준을 객관화.

→ **결론: 22-6N-E는 즉시 착수 가능하며, 본 검토 결과 다음 작업으로 권장한다. 단, 22-6N-E 완료(특히 B1 uid 매핑 확정) 전에는 Phase 4 이후의 코드/Rules 구현에 착수하지 않는다.**

---

## 부록. 검토 근거 핵심 라인 인덱스

- 익명 인증: `js/firebase-shared.js:29-38` / 호출 `index.html:1741`
- users 전체 read: `index.html:1764` / `js/firebase-shared.js:42-45`
- PIN 로그인·세션 저장: `index.html:1859-1861`
- 세션 복원(uid 미검증): `index.html:3293-3300`
- logout(signOut 부재): `index.html:2439`
- sales 소유권 쿼리: `index.html:2059-2060`
- 주문 생성 reportedBy: `index.html:2873, 3033`
- 주문 update 필드: `index.html:2280, 2289, 2305-2308, 2360, 2205-2208`
- audit_logs 기록: `index.html:1734`
- notifications 읽음 update: `index.html:2429`
- users 잠금 write: `index.html:1860, 1864, 1865, 1930`
- ACCESS_MATRIX: `index.html:958-975`
- Rules 권한 함수: `firestore.rules:33-131`
- Rules users/orders/audit/notifications: `firestore.rules:133-190`
