# WORK22-6N-D — PIN 인증 구조 폐기 및 Google Login 기반 Auth/Role 설계

기준일: 2026-06-09

## 1. 목적

현재 Firebase Anonymous Auth + PIN + sessionStorage 인증 구조를 장기 운영 보안 구조에서 폐기하고, Google Login 기반 Firebase Auth + `users/{uid}` role 매핑 구조로 전환하기 위한 설계 초안을 정의한다.

이 문서는 설계 문서다. 운영 코드, `index.html`, `firestore.rules`, Firebase Console, Rules 배포, `users`/`orders` 데이터는 변경하지 않는다.

## 2. 현재 구조의 문제

현재 앱은 Firebase Anonymous Auth를 사용한다. 앱 로드 후 `signInAnonymously()`가 실행되고, 이후 `users` 컬렉션의 사용자 목록을 읽어 PIN 로그인 화면을 구성한다.

PIN 로그인 성공 후에는 선택된 user 객체가 `currentUser`가 되고, `sessionStorage.yongjin_session`에 `role`, `name`, `id`, `pin`, `status` 등 사용자 정보가 저장된다.

주요 문제:

- Firebase Anonymous Auth 사용으로 업무 사용자 신원이 Firebase Auth 계정과 직접 연결되지 않는다.
- PIN 로그인 후 role/name이 sessionStorage에 저장된다.
- `auth.currentUser.uid`와 `users` 문서 ID의 일치가 보장되지 않는다.
- 현재 확인된 운영 전제상 `users.auth_uid`는 비어 있거나 신뢰 가능한 매핑 기준으로 사용되지 않는다.
- Firestore Rules는 PIN role 또는 sessionStorage role/name을 신뢰할 수 없다.
- 같은 anonymous uid에서 여러 PIN role을 선택할 수 있으면 서버 Rules에서 role을 구분할 수 없다.
- users 목록 read가 PIN 필드 노출 위험을 만든다.
- 장기적으로 Firestore Rules를 강화하려면 서버가 신뢰할 수 있는 uid 기반 identity가 필요하다.

결론:

PIN은 사용 편의 장치일 수는 있지만, 운영 보안의 주 인증 수단으로는 부적합하다.

## 3. Google Login 전환 목표 구조

목표 인증 구조:

1. Firebase `GoogleAuthProvider`를 사용한다.
2. 사용자는 PC와 모바일 모두 Google Login으로 인증한다.
3. 로그인 성공 후 `auth.currentUser.uid`를 유일한 신원 인증 기준으로 사용한다.
4. 앱은 `users/{auth.uid}` 문서를 조회한다.
5. `users/{auth.uid}` 문서의 `email`, `name`, `role`, `status`를 기준으로 화면 권한을 적용한다.
6. Firestore Rules도 `users/{request.auth.uid}` 문서를 기준으로 role/status를 검증한다.

권한 판단 기준:

- 신원: Firebase Auth `request.auth.uid`
- role/status source: Firestore `users/{request.auth.uid}`
- 화면 권한: 기존 `ACCESS_MATRIX` 유지, 단 role source를 PIN 선택값에서 users 문서로 변경
- Rules 권한: `users/{request.auth.uid}`의 role/status 기반

확정 원칙:

- PC와 모바일 모두 Google Login을 주 인증 방식으로 통일한다.
- Firebase Auth의 `request.auth.uid`를 유일한 신원 인증 기준으로 사용한다.
- `users/{auth.uid}` 문서의 role/status를 권한 판단 기준으로 사용한다.
- 기존 PIN은 로그인 수단이 아니라 모바일 현장 작업자의 편의용 보조 잠금 장치로 격하한다.
- PIN 값은 Firestore Rules의 권한 판단 기준으로 사용하지 않는다.
- sessionStorage role/name 값은 보안 판단 기준으로 사용하지 않는다.

## 4. users 컬렉션 목표 구조

목표 문서 경로:

```text
users/{auth.uid}
```

목표 필드 예시:

```js
{
  email: "user@example.com",
  name: "홍길동",
  role: "sales", // admin | sales | accounting | factory
  status: "active", // active | suspended
  createdAt: 1710000000000,
  lastLoginAt: 1710000000000,
  legacyUserId: "emp_acc1",
  migratedFromPin: true
}
```

필드 의미:

- `email`: Google 계정 이메일
- `name`: 앱 표시 이름 및 기존 `orders.reportedBy` 매칭 기준
- `role`: 권한 매트릭스 role
- `status`: 접속 허용 여부
- `createdAt`: users/{uid} 문서 생성 시각
- `lastLoginAt`: 마지막 로그인 시각
- `legacyUserId`: 기존 PIN users 문서 ID
- `migratedFromPin`: PIN 기반 계정에서 이전되었는지 여부

운영 전 검토 사항:

- `name` 변경이 기존 `orders.reportedBy` 조회에 영향을 주지 않도록 고정 정책을 둔다.
- role/status 변경은 admin 전용 관리 흐름으로 제한한다.
- PIN 관련 필드는 권한 판단 기준에서 제거한다.

## 5. 기존 PIN 사용자 이전안

기존 users 문서 예시:

- `admin_gene`
- `emp_acc1`
- `emp_acc2`
- `emp_admin`
- `emp_factory`
- 기타 현장/영업/회계 계정

이전 전략:

1. 각 기존 PIN 사용자에 대응하는 Google 계정을 확정한다.
2. Google 로그인으로 생성되는 Firebase Auth uid를 확인한다.
3. `users/{auth.uid}` 문서를 새로 만든다.
4. 기존 users 문서 ID는 `legacyUserId`에 저장한다.
5. 기존 `name`은 가능하면 유지해 `orders.reportedBy`와의 매칭을 보존한다.
6. 기존 `role`은 새 users 문서의 `role`로 이전한다.
7. 기존 `status`는 새 users 문서의 `status`로 이전한다. 없으면 `active`로 시작하되 운영 확인을 거친다.
8. 기존 `pin` 필드는 제거하거나 deprecated 처리한다.
9. 기존 `attempts`, `lockoutUntil`은 Google Login 전환 후 로그인 보안 기준으로 사용하지 않는다.

`orders.reportedBy` 유지 방안:

- 단기: 기존 주문의 `reportedBy` 문자열은 변경하지 않는다.
- 단기: 새 users 문서의 `name`을 기존 `reportedBy`와 동일하게 유지한다.
- 중기: 신규 orders에는 `reportedByUid`, `reportedByEmail`, `reportedByName`을 함께 저장하는 구조를 설계한다.
- 장기: 조회 기준을 문자열 name에서 uid 기반으로 전환한다.

주의:

- 기존 orders 데이터 일괄 수정은 별도 마이그레이션 설계 전 금지한다.
- Google 계정이 없는 직원은 계정 발급 또는 예외 인증 정책이 필요하다.

## 6. 화면 권한 구조 변경안

현재:

- PIN 선택값이 `currentUser`가 된다.
- `sessionStorage.yongjin_session`에 role/name이 저장된다.
- `ACCESS_MATRIX`는 `currentUser.role`을 기준으로 메뉴/화면/수정 권한을 판단한다.

목표:

- Google Login 성공 후 `auth.currentUser.uid`를 확보한다.
- `users/{auth.uid}` 문서를 읽어 `currentUser`를 설정한다.
- `currentUser.role`은 users 문서에서 온 role만 사용한다.
- `currentUser.status !== active`면 접속을 차단하고 Firebase signOut 처리한다.
- sessionStorage에는 최소 표시 정보만 저장하거나 사용하지 않는 방향을 검토한다.
- sessionStorage의 role/name은 보안 판단 기준으로 사용하지 않는다.
- `ACCESS_MATRIX`는 유지하되 role source를 Firestore users 문서로 변경한다.
- 로그아웃 시 `firebase.auth().signOut()`을 호출한다.

모바일 PIN의 새 위치:

- PIN은 로그인 수단이 아니라 모바일 현장 작업자 편의용 보조 잠금 장치로 격하한다.
- 예: Google Login 후 짧은 화면 잠금 해제용 local-only PIN
- PIN 값은 Firestore Rules 권한 판단 기준에 사용하지 않는다.
- PIN이 필요한 경우 서버 권한과 분리하고, PIN 값 저장 위치와 암호화/해시 정책을 별도 설계한다.

## 7. Firestore Rules 전환 방향

Rules 기본 전제:

```js
request.auth != null
```

role/status 조회:

```js
get(/databases/$(database)/documents/users/$(request.auth.uid))
```

전환 방향:

- `users/{request.auth.uid}` read 허용
- 다른 users 문서는 admin만 read/update 가능하도록 축소 검토
- admin/accounting/sales/factory role별 orders read/write 설계
- orders delete는 원칙적으로 admin만 또는 전면 차단 검토
- `audit_logs`는 create-only, read는 admin 전용
- notifications는 role target 또는 uid target 기반으로 재설계

PR #59 `firestore.rules` 초안에서 수정해야 할 부분:

- PIN 기반 users 전체 read 전제를 제거한다.
- users read를 `users/{request.auth.uid}` 중심으로 좁힌다.
- role/status lookup 전제는 유지하되, users 문서 ID가 auth uid인 구조를 확정한다.
- sales 본인 주문 판단을 `reportedBy == users.name`에서 점진적으로 `reportedByUid == request.auth.uid`로 이동한다.
- users update에서 attempts/lockoutUntil 같은 PIN 로그인 필드 의존성을 제거한다.
- notification read/update 모델을 사용자별 읽음 상태로 재검토한다.

운영 배포 전 필수:

- Rules Emulator 테스트
- 실제 Google Auth uid와 users/{uid} fixture 검증
- index query와 Rules read 조건 호환성 확인

## 8. Firebase Console 설정 필요 항목

Firebase Console에서 필요한 설정:

1. Authentication > Sign-in method > Google 활성화
2. Authorized domains 확인
3. GitHub Pages 도메인 허용 확인
   - 예: `kimjinman3187-dot.github.io`
4. 테스트 계정 목록 작성
5. 각 테스트 계정의 Firebase Auth uid 확인
6. 테스트 계정별 users/{uid} 문서 생성 계획 확정

테스트 계정 목록 예시:

- admin: Gene 운영 관리자 Google 계정
- sales: 영업 테스트 Google 계정
- accounting: 회계 테스트 Google 계정
- factory: 공장 테스트 Google 계정
- suspended: 정지 계정 테스트 Google 계정

주의:

- Firebase Console 설정은 별도 승인 후 수동으로 진행한다.
- Rules 배포보다 Google Login 테스트와 users/{uid} 매핑 검증이 먼저다.

## 9. 단계별 전환 계획

### Phase 1: 설계 문서화

- 현재 인증 구조 문제 정리
- Google Login 목표 구조 확정
- users/{uid} 목표 스키마 확정
- 운영 전환 리스크 정리

### Phase 2: Firebase Console Google Login 활성화 준비

- Google provider 활성화 계획 수립
- Authorized domains 확인
- 테스트 계정 목록 확정

### Phase 3: users/{uid} 테스트 문서 생성

- Google 계정별 Firebase uid 확인
- users/{uid} 문서 생성 계획 작성
- legacy PIN user와 Google uid 매핑표 작성

### Phase 4: Google Login UI 최소 구현

- PC/모바일 공통 Google Login 버튼
- 로그인 후 users/{uid} 조회
- status 차단 및 signOut 처리
- 기존 PIN UI 제거 또는 보조 잠금으로 격하

### Phase 5: role 기반 화면 접근 회귀 테스트

- admin/sales/accounting/factory role별 메뉴/화면 접근 검증
- URL hash 직접 접근 차단 검증
- Sales/Finance/AR/Production 수정권한 검증

### Phase 6: firestore.rules 재설계

- PR #59 초안을 Google Login 구조에 맞춰 수정
- users 전체 read 제거
- users/{uid} 중심 role/status 검증
- orders uid 기반 소유권 전환 설계

### Phase 7: Emulator 테스트

- Rules Emulator fixture 작성
- role별 allow/deny 테스트 작성
- suspended user 차단 테스트 작성
- audit_logs/notifications 테스트 작성

### Phase 8: 운영 Rules 수동 적용 판단

- Google Login 운영 검증 완료
- users/{uid} 매핑 완료
- Emulator 테스트 통과
- 인덱스 Enabled 확인
- 수동 승인 후 Firebase Console에서 Rules 적용 판단

## 10. 위험 요소

- 기존 PIN 로그인 사용자 혼란
- Google 계정 없는 직원 처리 필요
- orders.reportedBy 문자열 기준 흔들림
- 기존 users 문서 마이그레이션 오류
- users.name 변경으로 과거 주문 조회가 흔들릴 위험
- GitHub Pages 도메인 인증 문제
- Firebase Console provider 설정 누락
- 실수로 운영 Rules를 먼저 적용하는 문제
- 모바일 현장 작업자의 로그인 UX 저하
- sessionStorage 의존 제거 과정에서 기존 화면 복원 흐름이 흔들릴 가능성
- custom claims를 쓰지 않을 경우 Rules get/exists 의존 증가

## 11. 추천 결론

PIN 인증은 장기 운영 보안 구조로 부적합하다.

용진FLOW의 장기 표준은 Google Login + Firebase Auth uid + `users/{uid}` role/status 매핑 구조가 되어야 한다.

다만 바로 구현하지 말고 아래 순서를 지킨다.

1. 설계 확정
2. 테스트 계정/uid 매핑
3. users/{uid} 문서 계획
4. Google Login 최소 구현
5. 권한 회귀 테스트
6. Rules 재설계
7. Emulator 테스트
8. 운영 Rules 수동 적용 판단

즉, 인증 신원 기준은 `request.auth.uid`로 통일하되, 기존 업무 데이터와 직원 UX를 보호하기 위해 설계/테스트/이전 순서로 진행한다.

## 12. 다음 작업 제안

추천 작업명:

WORK22-6N-E — Google Login 테스트 계정 및 users/{uid} 매핑표 설계

목표:

- 테스트 Google 계정 목록 확정
- Firebase Auth uid 확인 절차 정의
- legacy PIN users 문서와 새 users/{uid} 문서 매핑표 작성
- orders.reportedBy 유지 정책 확정

