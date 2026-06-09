# WORK22-6N-E — Google Login users/{uid} 매핑표 최종본

기준일: 2026-06-09

## 1. 작업 성격

이 문서는 Google Login 전환 전 테스트 계정, Firebase Auth UID, Firestore `users/{uid}` 문서, role/status, legacy PIN 사용자 연결 기준을 확정하기 위한 문서 작성 전용 산출물이다.

허용 범위:

- 문서 비교
- 문서 통합
- `docs/work22-6n-e-google-login-user-mapping.md` 최종본 작성

금지 범위:

- 코드 구현 금지
- `index.html` 수정 금지
- `firestore.rules` 수정 금지
- Firebase Console 수정 금지
- Rules 배포 금지
- users/orders 데이터 수정 금지
- Reset Data 금지
- Google Login UI 구현 금지

## 2. 최종 설계 기준

Google Login 전환의 신원/권한 체인은 아래 순서로 고정한다.

```text
Google 계정
  -> Firebase Auth UID
  -> Firestore users/{uid}
  -> users.role / users.status
  -> ACCESS_MATRIX 화면/수정 권한
  -> Firestore Rules role/status 검증
```

핵심 원칙:

- Firebase Auth UID를 `users/{uid}` 문서 ID로 사용한다.
- Firestore Rules와 프론트 권한 판단 모두 `users/{auth.uid}`의 role/status를 기준으로 한다.
- `sessionStorage`의 role/name 값은 보안 판단 기준으로 사용하지 않는다.
- PIN 값은 Firestore Rules 권한 판단 기준으로 사용하지 않는다.
- 기존 PIN은 장기적으로 로그인 수단이 아니라 모바일 현장 작업자의 편의용 보조 잠금 장치로 격하한다.

## 3. DEV fallback 계정 제외 원칙

아래 로컬 개발 fallback 계정은 운영 Google Login 매핑 대상에서 제외한다.

| fallback id | role | 제외 사유 |
|---|---|---|
| admin-local | admin | localhost `devAuth=1` 전용 개발 계정 |
| sales-local | sales | localhost `devAuth=1` 전용 개발 계정 |
| accounting-local | accounting | localhost `devAuth=1` 전용 개발 계정 |
| factory-local | factory | localhost `devAuth=1` 전용 개발 계정 |

운영 매핑표에는 실제 운영 users 문서 ID 또는 확정된 legacy PIN user ID만 포함한다.

## 4. legacyUserId 목록

현재 문서화된 legacy PIN 사용자 후보는 아래와 같다. 실제 Firestore users 컬렉션 확인 후 확정한다.

| legacyUserId | 예상 role | 비고 |
|---|---|---|
| admin_gene | admin | 운영 관리자 후보 |
| emp_acc1 | accounting | 회계 후보 |
| emp_acc2 | accounting | 회계 후보 |
| emp_admin | admin | 관리자 후보 |
| emp_factory | factory | 생산 후보 |
| 기존 sales user ID | sales | 실제 users 문서 확인 필요 |
| 기존 accounting user ID | accounting | 실제 users 문서 확인 필요 |
| 기존 factory user ID | factory | 실제 users 문서 확인 필요 |

주의:

- 위 목록은 설계 후보이며 운영 데이터 수정 대상이 아니다.
- 실제 legacyUserId는 Firebase Console 또는 안전한 read-only 조회로 확정한다.
- 모든 미확인 값은 이 문서에서 “확인 필요”로 표기한다.

## 5. Google Login 7열 매핑표

아래 표는 WORK22-6N-F 전 Gene이 채워야 하는 최종 운영 준비표다.

| legacyUserId | name | role | status | Google Email | Firebase UID | users/{uid} 예정 경로 |
|---|---|---|---|---|---|---|
| admin_gene | gene kim | admin | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| 기존 sales user ID 확인 필요 | 기존 name 확인 필요 | sales | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| 기존 accounting user ID 확인 필요 | 기존 name 확인 필요 | accounting | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| 기존 factory user ID 확인 필요 | 기존 name 확인 필요 | factory | active | 확인 필요 | 확인 필요 | `users/{확인 필요}` |
| 테스트용 | 테스트용 | sales | suspended | 확인 필요 | 확인 필요 | `users/{확인 필요}` |

작성 기준:

- `Google Email`: 실제 테스트 Google 계정 이메일을 입력한다.
- `Firebase UID`: Firebase Authentication > Users에서 확인한 UID를 입력한다.
- `users/{uid} 예정 경로`: `users/` + Firebase UID로 작성한다.
- `role`: 현재 `ACCESS_MATRIX`와 동일하게 `admin`, `sales`, `accounting`, `factory`만 사용한다.
- `status`: `active` 또는 `suspended`만 사용한다.
- `name`: 기존 `orders.reportedBy`와 매칭되는 값을 우선 유지한다.

## 6. users/{uid} 목표 스키마

목표 경로:

```text
users/{auth.uid}
```

목표 문서 예시:

```js
{
  email: "user@example.com",
  name: "gene kim",
  role: "admin",
  status: "active",
  legacyUserId: "admin_gene",
  migratedFromPin: true,
  createdAt: null,
  lastLoginAt: null
}
```

신규 스키마에서 배제할 필드:

- `pin`
- `attempts`
- `lockoutUntil`

배제 사유:

- Google Login 전환 후 위 필드는 주 인증/권한 판단 기준이 아니다.
- PIN 값은 Firestore Rules에서 신뢰할 수 없고 client read 노출 위험이 있다.
- 모바일 보조 잠금이 필요하면 별도 local-only 또는 서버 검증 설계에서 다시 다룬다.

## 7. 기존 PIN 사용자 이전 규칙

기본 원칙:

- 기존 users 문서는 즉시 삭제하지 않는다.
- 기존 `pin` 필드는 신규 `users/{uid}` 문서로 이전하지 않는다.
- 기존 `attempts`, `lockoutUntil`은 신규 `users/{uid}` 주 인증 스키마에서 제외한다.
- `legacyUserId`로 기존 users 문서 ID를 보존한다.
- 기존 `role`, `status`, `name`은 확인 후 신규 문서에 반영한다.

이전 순서:

1. 기존 PIN users 문서 목록을 read-only로 확인한다.
2. 각 legacyUserId에 대응하는 Google 계정을 확정한다.
3. Google 계정 로그인으로 Firebase Auth UID를 확인한다.
4. 7열 매핑표를 완성한다.
5. `users/{uid}` 생성 계획을 문서화한다.
6. 별도 승인 전까지 기존 users/orders 데이터는 수정하지 않는다.

## 8. reportedBy 유지 전략

단기 전략:

- 기존 `orders.reportedBy` 문자열은 변경하지 않는다.
- 신규 `users/{uid}.name`은 기존 `orders.reportedBy`와 같은 값을 우선 사용한다.
- 기존 Dashboard, Sales, AR, History 조회 흐름이 name 기반으로 흔들리지 않게 유지한다.

중기 전략:

- 신규 주문 생성 구조에 아래 필드 추가를 검토한다.
  - `reportedByUid`
  - `reportedByEmail`
  - `reportedByName`
- sales 본인 주문 조회를 `reportedBy == users.name`에서 `reportedByUid == request.auth.uid`로 전환한다.
- Firestore Rules도 uid 기반 소유권 검증으로 단순화한다.

주의:

- 중기 확장 전까지 기존 `reportedBy` name 값을 임의 변경하지 않는다.
- orders 데이터 마이그레이션은 별도 설계/승인 전 금지한다.

## 9. ACCESS_MATRIX와 role 정합성

Google Login 전환 후에도 role 값은 현재 `ACCESS_MATRIX`와 정합해야 한다.

| role | 권한 기준 |
|---|---|
| admin | 전체 화면/수정 및 운영 관리 |
| sales | Sales/AR 수정, Production 조회, Finance 차단 |
| accounting | Sales/Finance/AR 수정, Production 조회 |
| factory | Production 조회/수정, Sales/Finance/AR/Dashboard 차단 |

정합성 원칙:

- `users/{uid}.role` 값은 위 네 role 중 하나여야 한다.
- `status != active`는 프론트 접근과 Rules 접근 모두 차단한다.
- role을 sessionStorage에서 복원하더라도 보안 판단에는 사용하지 않는다.
- Firestore Rules는 `users/{request.auth.uid}.role/status`만 신뢰한다.

## 10. Firebase Console에서 Gene이 확인해야 할 항목

Authentication:

- Authentication > Sign-in method > Google provider 활성화 가능 여부 확인
- Authentication > Users에서 Google 계정별 UID 확인
- 테스트 Google 계정 4개 이상 준비
- suspended 차단 테스트용 계정 준비

Authorized domains:

- GitHub Pages 도메인 포함 여부 확인
- 예상 도메인: `kimjinman3187-dot.github.io`
- 운영 접속 도메인이 추가로 있다면 함께 확인

Firestore:

- 기존 users 문서의 실제 legacyUserId/name/role/status 확인
- 신규 `users/{uid}` 문서 생성 가능 여부 확인
- 기존 users 문서에 `auth_uid`가 있다면 비어 있는지, 사용 가능한지 확인

주의:

- 이 단계에서는 Firebase Console을 수정하지 않는다.
- UID 확인과 매핑표 작성이 끝나기 전 코드 구현을 시작하지 않는다.
- Rules 배포는 하지 않는다.

## 11. 차단 조건

### B1 — UID 매핑 Green 전 구현 차단

B1 Green 조건:

- 테스트 Google 계정 4개 이상 확정
- 각 계정 Firebase Auth UID 확인
- `users/{uid}` 예정 경로 확정
- legacyUserId와 UID 1:1 매핑 확인

B1 상태:

- 현재 B1은 Green이 아니다.
- 모든 UID/Email 값이 “확인 필요” 상태다.

차단:

- B1 Green 전 Google Login UI 코드 구현 금지
- B1 Green 전 `users/{uid}` 전제 Rules 구현/배포 금지

### B3 — users/{uid} 문서 준비 전 인증 전환 차단

B3 Green 조건:

- `users/{uid}` 목표 문서 생성 계획 확정
- role/status/name/legacyUserId 값 확정
- suspended 테스트 문서 계획 확정

차단:

- B3 Green 전 Google Login 성공 후 화면 진입 구현 금지
- B3 Green 전 운영 users 문서 수정 금지

### B5 — reportedBy 안정성 확인 전 orders 전환 차단

B5 Green 조건:

- 기존 `orders.reportedBy`와 신규 `users/{uid}.name` 매칭 정책 확정
- name 변경 금지 기준 확정
- 중기 `reportedByUid` 확장 설계 별도 승인

차단:

- B5 Green 전 orders 데이터 마이그레이션 금지
- B5 Green 전 reportedBy 기반 조회 로직 변경 금지

### B6 — Rules/Console 운영 적용 차단

B6 Green 조건:

- Google provider 활성화 절차 승인
- Authorized domains 확인
- Rules Emulator 테스트 설계 완료
- Firestore composite index 상태 확인
- 운영 Rules 수동 적용 승인

차단:

- B6 Green 전 Firebase Console Rules 수정 금지
- B6 Green 전 Rules 배포 금지
- B6 Green 전 운영 데이터 수정 금지

## 12. 22-6N-F 착수 조건

22-6N-F는 두 갈래로 나눈다.

### 22-6N-F 설계 문서 착수

가능 조건:

- 이 최종 매핑표 문서가 PR로 생성되어 review 가능 상태
- B1/B3/B5/B6 차단 조건이 문서화되어 있음

판정:

- 22-6N-F 설계 문서 작업은 착수 가능

### 22-6N-F 코드 구현 착수

가능 조건:

- B1 Green
- B3 Green
- B5 최소 단기 정책 Green
- Google provider 활성화 가능 여부 확인
- Authorized domains 확인

판정:

- 현재 22-6N-F 코드 구현은 HOLD
- 모든 Email/UID가 “확인 필요”이므로 Google Login UI 구현 금지

## 13. 다음 작업 제안

추천 작업명:

WORK22-6N-F — Google Login 최소 UI 및 users/{uid} 조회 구조 구현 설계

목표:

- PC/모바일 공통 Google Login UI 설계
- Firebase Auth `auth.currentUser.uid` 기준 users 문서 조회 흐름 설계
- `currentUser`를 `users/{uid}` 조회 결과로 설정하는 구조 설계
- Google Login 후 role/status 기반 화면 권한 회귀 테스트 계획 작성
- 기존 PIN UI를 보조 잠금 장치로 격하하는 UX 설계

