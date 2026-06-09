# WORK22-6N-B — Firebase Auth UID와 users 문서 매핑 검증 및 Rules 시뮬레이션 테스트 설계

기준일: 2026-06-09

## 1. 목적

운영 Firestore Rules를 배포하지 않고, 현재 Firebase Anonymous Auth + PIN + sessionStorage 구조에서 Firestore Rules가 신뢰할 수 있는 사용자 식별 기준을 가질 수 있는지 검증한다.

이 문서는 `firestore.rules` 설계 초안의 전제조건을 검증하기 위한 테스트 계획이다. Firebase Console Rules 수정, Rules 배포, `users`/`orders` 데이터 수정, Reset Data 사용은 금지한다.

## 2. 현재 Auth 구조 요약

현재 앱은 `js/firebase-shared.js`에서 Firebase를 초기화한 뒤 `auth.signInAnonymously()`를 호출한다.

확인된 흐름:

1. 앱 로드 시 Firebase Anonymous Auth가 먼저 수행된다.
2. 이후 `users` 컬렉션을 읽어 PIN 로그인 대상 사용자 목록을 만든다.
3. PIN 입력 성공 시 `currentUser = user`로 설정하고 `sessionStorage.setItem('yongjin_session', JSON.stringify(currentUser))`를 저장한다.
4. 주문 생성 시 `reportedBy`는 `currentUser.name`을 사용한다.
5. `currentUser`와 `auth.currentUser.uid`를 연결하거나 검증하는 코드가 없다.

중요 결론:

- `request.auth.uid`는 Firebase Anonymous Auth의 uid다.
- PIN으로 선택한 업무 사용자 `currentUser.id/name/role`과 `request.auth.uid` 사이의 신뢰 가능한 연결은 현재 코드에서 확인되지 않는다.
- 같은 브라우저의 같은 anonymous uid로 서로 다른 PIN 사용자를 선택할 수 있다면, Rules는 PIN role을 안전하게 구분할 수 없다.

## 3. sessionStorage 구조

`yongjin_session`은 PIN 로그인 성공 시 `currentUser` 전체를 JSON으로 저장한다.

코드 기준 예상 필드:

- `id`: users 문서 ID
- `name`: 표시 이름 및 `orders.reportedBy` 값
- `role`: `admin`, `sales`, `accounting`, `factory`
- `pin`: PIN 검증 값
- `status`: 없으면 active로 간주
- `sort_index`: 로그인 목록 정렬
- `attempts`: PIN 실패 횟수
- `lockoutUntil`: 잠금 해제 시각

보안 한계:

- sessionStorage는 클라이언트 제어 영역이므로 Firestore Rules에서 신뢰할 수 없다.
- PIN 및 role이 클라이언트에 노출되는 구조는 운영 Rules 설계 전 별도 보안 검토가 필요하다.

## 4. UID ↔ users 문서 매핑 검증 결과

코드 조사 결과:

- `syncUsers()`는 `db.collection('users').orderBy('sort_index', 'asc').get()`으로 모든 사용자를 읽는다.
- 각 user 객체는 `{ id: doc.id, ...doc.data() }` 형태로 만들어진다.
- PIN 성공 후 `currentUser.id`는 users 문서 ID다.
- users 업데이트는 `db.collection('users').doc(user.id).update(...)`로 수행된다.
- `auth.currentUser.uid`와 `user.id`를 비교하거나 매핑하는 로직은 없다.

현재 판단:

- `users/{request.auth.uid}` 조회를 전제로 한 PR #59 `firestore.rules` 초안은 현재 앱 구조만으로는 운영 적용 가능하다고 볼 수 없다.
- 실제 users 문서 ID가 Firebase Auth uid와 일치하는지 운영 데이터에서 별도 확인해야 한다.
- 확인 전에는 role 기반 Rules 배포를 차단해야 한다.

운영에서 확인할 항목:

1. 로그인 직후 `auth.currentUser.uid` 값
2. PIN 선택 후 `currentUser.id`
3. `users/{auth.currentUser.uid}` 문서 존재 여부
4. 해당 문서의 `role`, `status`, `name`이 PIN 선택 사용자와 일치하는지
5. 동일 anonymous uid로 다른 PIN 사용자를 선택할 수 있는지

## 5. users 컬렉션 문서 구조 검증 항목

코드 기준으로 사용되는 필드:

- `role`
- `status`
- `sort_index`
- `pin`
- `attempts`
- `lockoutUntil`
- `name`

검증해야 할 구조:

- users 문서 ID가 Firebase Auth uid와 같은가
- `role` 필드가 모든 운영 계정에 존재하는가
- `status` 필드가 없을 경우 active로 간주해도 되는가
- `name`이 `orders.reportedBy`와 정확히 매칭되는가
- `pin`, `attempts`, `lockoutUntil`을 client read 가능한 상태로 유지해도 되는가

노출 위험:

- 현재 PIN 검증은 클라이언트에서 `user.pin`과 비교한다.
- 따라서 users read를 허용하면 PIN 관련 정보가 노출될 수 있다.
- 운영 Rules 적용 전 PIN 검증 방식을 서버 검증 또는 별도 인증 모델로 옮길지 결정해야 한다.

## 6. custom claims 없이 가능한 범위와 한계

가능한 범위:

- `request.auth.uid == users 문서 ID`가 보장되면 Rules에서 `get(/users/$(request.auth.uid))`로 role/status를 조회할 수 있다.
- 이 경우 `admin`, `sales`, `accounting`, `factory` 별 read/write 정책을 서버에서 일부 강제할 수 있다.

한계:

- Anonymous Auth uid는 PIN 업무 사용자와 자동으로 연결되지 않는다.
- 한 anonymous uid에서 여러 PIN 사용자를 선택할 수 있으면 role 구분이 불가능하다.
- users 문서 ID가 auth uid가 아니면 `users/{request.auth.uid}` 기반 Rules는 실패한다.
- custom claims가 없으면 Rules마다 users 문서 조회 비용과 쿼리 제약을 고려해야 한다.
- 클라이언트에서 PIN/role을 읽는 구조는 Rules만으로 근본 보호가 어렵다.

권장 방향:

1. 단기: UID와 users 문서 매핑 가능 여부를 운영에서 확인한다.
2. 중기: users 문서 ID를 auth uid와 매핑하거나 별도 mapping 컬렉션을 설계한다.
3. 장기: custom claims 또는 서버 검증 로그인 모델로 role을 신뢰 가능한 인증 정보에 반영한다.

## 7. role별 테스트 시나리오

### admin

- users read 가능
- orders 전체 read 가능
- orders create/update/delete 가능 여부 검토
- audit_logs read 가능
- notifications create/update/delete 가능 여부 검토
- Reset Data 기능은 Rules 테스트에서 실행 금지

### sales

- users read 가능 여부 확인
- 본인 `reportedBy == currentUser.name` orders read 가능
- 타 sales 사용자의 orders read 차단
- orders create 가능
- Sales 수정 가능
- AR payment update 가능
- Finance invoice/status update 차단
- Production progress update 차단
- orders delete 차단

### accounting

- users read 가능 여부 확인
- orders 전체 read 가능
- Sales 수정 가능
- Finance 승인/반려/계산서 update 가능
- AR payment update 가능
- Production progress update 차단
- orders delete 차단

### factory

- users read 가능 여부 확인
- `status in ['approved', 'completed']` orders read 가능
- pending/rejected orders read 차단
- Production progress update 가능
- Sales/Finance/AR update 차단
- orders create/delete 차단
- Dashboard 접근은 프론트에서 차단 유지

## 8. orders 테스트 시나리오

### read

- admin: 모든 orders read 허용
- sales: 본인 reportedBy orders만 read 허용
- accounting: 모든 orders read 허용
- factory: approved/completed orders만 read 허용

### create

- admin: 허용 여부 운영 정책 확인
- sales: 신규 수주 create 허용
- accounting: Sales 수정권한 정책에 따라 create 허용 여부 결정 필요
- factory: create 차단

### update

- Sales update: admin/sales/accounting 허용, factory 차단
- Finance update: admin/accounting 허용, sales/factory 차단
- AR update: admin/sales/accounting 허용, factory 차단
- Production update: admin/factory 허용, sales/accounting 차단

### delete

- 운영 앱에서 일반 주문 삭제 기능은 권장하지 않는다.
- admin delete 허용 여부는 Reset Data 위험과 별도로 재검토한다.
- sales/accounting/factory delete는 차단한다.

## 9. users 테스트 시나리오

### read

- 현재 앱 구조상 로그인 목록 표시를 위해 users read가 필요하다.
- 단, PIN 노출 위험 때문에 운영 배포 전 read 범위 축소 또는 PIN 제거 설계가 필요하다.

### update

- 본인 attempts/lockoutUntil update 허용 여부 검토
- admin forceUnlock / status 관리 허용 여부 검토
- role/pin/status 변경은 admin 전용으로 제한해야 한다.
- 일반 role 사용자의 users create/delete는 차단한다.

## 10. audit_logs 테스트 시나리오

현재 코드 컬렉션명은 `audit_logs`다. PR #59 초안은 호환 검토용으로 `auditLogs`도 포함했다.

### create

- active authenticated user만 create 허용
- request payload의 `user`, `role`이 서버 조회한 users 문서와 일치해야 한다.

### read

- admin만 read 허용
- sales/accounting/factory read 차단

### update/delete

- 모든 role에서 차단

## 11. notifications 테스트 시나리오

현재 코드 흐름:

- `notifications`에서 `target_roles array-contains currentUser.role` 조회
- 읽은 notification에 대해 `read: true`, `read_at` update 수행

시뮬레이션 항목:

- target_roles에 현재 role이 포함된 notification만 read 허용
- target_roles 미포함 notification read 차단
- notification read 상태 update를 클라이언트에 허용할지 재검토
- 알림 생성/삭제는 admin 또는 서버 전용으로 제한

주의:

- `read` 필드가 notification 전체에 하나만 있으면 여러 role/user가 공유할 때 부정확할 수 있다.
- 운영 Rules 전 알림 읽음 상태 모델을 별도 검토해야 한다.

## 12. 운영 배포 전 차단 조건

아래 중 하나라도 미해결이면 Rules 배포를 차단한다.

- `users/{request.auth.uid}` 문서가 실제로 존재하지 않음
- Firebase Anonymous Auth uid와 PIN 사용자 `currentUser.id`가 다름
- 같은 auth uid로 여러 PIN role 선택 가능
- users read가 PIN 값을 노출함
- `orders.reportedBy`와 `users.name` 값이 안정적으로 매칭되지 않음
- role별 write payload 필드 목록이 실제 앱 업데이트와 불일치
- notifications read/update 모델이 사용자별 읽음 상태를 표현하지 못함
- Rules Emulator 테스트 케이스가 준비되지 않음

## 13. Rules 시뮬레이션 테스트 설계

권장 도구:

- Firebase Emulator Suite
- Rules unit test 스크립트
- 별도 fixture 데이터

필수 fixture:

- users/adminUid: role admin, status active, name adminName
- users/salesUid: role sales, status active, name salesName
- users/accountingUid: role accounting, status active, name accountingName
- users/factoryUid: role factory, status active, name factoryName
- users/suspendedUid: role sales, status suspended
- orders/salesOwnOrder: reportedBy salesName, status pending
- orders/salesOtherOrder: reportedBy otherSalesName, status pending
- orders/approvedOrder: status approved
- orders/completedOrder: status completed
- orders/rejectedOrder: status rejected
- audit_logs/log1
- notifications/roleTargetedNotification

필수 assert:

- 각 role별 read/write 허용/차단
- suspended user 차단
- users missing uid 차단
- audit_logs create only
- notifications target_roles 기반 read

## 14. 22-6N-C 진행 조건

22-6N-C 착수 가능 조건:

1. 운영 Firebase에서 `auth.currentUser.uid`와 users 문서 ID 매핑 결과 확인
2. PIN 노출 위험에 대한 운영 결정 완료
3. `orders.reportedBy`와 users.name 매칭 기준 확정
4. notifications 읽음 상태 모델 유지/변경 결정
5. Rules Emulator 테스트 fixture 확정

추천 작업명:

WORK22-6N-C — Firestore Rules Emulator 테스트 케이스 작성 및 UID 매핑 검증 자동화

