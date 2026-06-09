# WORK22-6N-E — Google Login 테스트 계정 및 users/{uid} 매핑표 설계

기준일: 2026-06-09

## 1. 작업 목적

Google Login 전환을 실제 구현하기 전에 테스트 계정별 Firebase Auth UID와 Firestore `users/{uid}` 문서 구조를 설계한다.

이 작업은 구현이 아니라 계정, 권한, 마이그레이션 매핑표 작성이다.

목표:

- Google Login 전환 전 테스트 계정과 role 매핑 기준을 확정한다.
- Firebase Auth UID를 `users/{uid}` 문서 ID로 사용하는 구조를 전제로 한다.
- 기존 PIN 사용자 문서와 신규 Google Login 사용자 문서의 연결 기준을 설계한다.
- PC/모바일 모두 Google Login을 주 인증 방식으로 통일하는 전환 작업의 사전 매핑 기준을 만든다.

금지:

- 코드 수정 금지
- `index.html` 수정 금지
- `firestore.rules` 수정 금지
- Firebase Console 수정 금지
- Rules 배포 금지
- users/orders 데이터 수정 금지
- Reset Data 금지

## 2. 테스트 계정 매핑표

아래 표는 Google Login 테스트 전 Gene이 Firebase Console에서 UID를 확인한 뒤 채워야 하는 운영 준비표다.

| 구분 | Google 계정 이메일 | Firebase Auth UID | users 문서 ID | role | status | legacyUserId | name | 비고 |
|---|---|---|---|---|---|---|---|---|
| admin | 미정 | 미정 | `{auth.uid}` | admin | active | admin_gene | gene kim | 운영 관리자 |
| sales | 미정 | 미정 | `{auth.uid}` | sales | active | 기존 sales user ID | 기존 name | 영업 테스트 |
| accounting | 미정 | 미정 | `{auth.uid}` | accounting | active | 기존 accounting user ID | 기존 name | 회계 테스트 |
| factory | 미정 | 미정 | `{auth.uid}` | factory | active | 기존 factory user ID | 기존 name | 생산 테스트 |
| suspended | 미정 | 미정 | `{auth.uid}` | sales | suspended | 테스트용 | 테스트용 | 차단 테스트 |

작성 원칙:

- `Firebase Auth UID`는 Firebase Authentication > Users 화면에서 확인한 실제 UID를 입력한다.
- `users 문서 ID`는 실제 UID와 동일해야 한다.
- `legacyUserId`는 기존 PIN 기반 users 문서 ID를 보존한다.
- `name`은 기존 `orders.reportedBy`와 매칭되는 값을 우선 유지한다.
- suspended 계정은 로그인 차단과 Rules 차단 테스트 전용으로 사용한다.

## 3. users/{uid} 목표 문서 예시

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

필드 설명:

- `email`: Google 계정 이메일
- `name`: 앱 표시 이름 및 기존 `orders.reportedBy` 매칭 기준
- `role`: `admin`, `sales`, `accounting`, `factory` 중 하나
- `status`: `active` 또는 `suspended`
- `legacyUserId`: 기존 PIN users 문서 ID
- `migratedFromPin`: 기존 PIN 사용자에서 이전된 계정인지 여부
- `createdAt`: 신규 문서 생성 시각, 실제 생성 시 서버 기준 timestamp 검토
- `lastLoginAt`: 마지막 로그인 시각, Google Login 구현 단계에서 갱신 방식 설계

## 4. 기존 PIN 사용자 이전 규칙

기본 원칙:

- 기존 users 문서는 즉시 삭제하지 않는다.
- 기존 `pin` 필드는 신규 `users/{uid}` 문서로 이전하지 않는다.
- `legacyUserId`로 기존 문서 ID를 보존한다.
- `orders.reportedBy`와 users.name 매칭이 깨지지 않도록 `name`은 기존 값과 동일하게 유지한다.
- 신규 주문에는 향후 `reportedByUid`, `reportedByEmail`, `reportedByName` 구조를 검토한다.

이전 순서:

1. 기존 PIN users 문서 목록을 확정한다.
2. 각 기존 사용자에 대응하는 Google 계정을 확정한다.
3. Google Login 테스트로 Firebase Auth UID를 확인한다.
4. `users/{auth.uid}` 문서 생성 계획을 작성한다.
5. 기존 users 문서 ID를 `legacyUserId`에 기록한다.
6. 기존 `role`, `status`, `name` 값을 새 문서에 반영한다.
7. 기존 `pin`, `attempts`, `lockoutUntil`은 Google Login 주 인증 구조로 이전하지 않는다.
8. 기존 주문 조회 안정성을 위해 `orders.reportedBy` 문자열은 변경하지 않는다.

기존 PIN 문서 처리:

- Phase 1에서는 유지한다.
- Google Login 전환 검증이 끝날 때까지 삭제하지 않는다.
- PIN은 로그인 수단이 아니라 모바일 현장 작업자 편의용 보조 잠금 장치로 격하한다.
- PIN 값은 Firestore Rules의 권한 판단 기준으로 사용하지 않는다.

## 5. Firebase Console에서 Gene이 확인해야 할 항목

Authentication:

- Authentication > Sign-in method > Google provider 활성화 여부 확인
- Authentication > Users에서 Google 계정별 UID 확인
- 테스트 Google 계정이 최소 4개 이상 준비되어 있는지 확인
- suspended 차단 테스트용 계정 준비 여부 확인

Authorized domains:

- GitHub Pages 도메인 포함 여부 확인
- 예상 도메인: `kimjinman3187-dot.github.io`
- 운영 접속 도메인이 추가로 있다면 함께 확인

Firestore:

- Firestore > users에서 신규 `users/{uid}` 문서 생성 가능 여부 확인
- 기존 PIN users 문서 ID와 신규 UID 매핑표 작성
- 기존 users 문서의 `name`, `role`, `status` 값을 확인
- 기존 users 문서에 `auth_uid`가 있다면 비어 있는지, 사용 가능한지 별도 확인

주의:

- 이 단계에서는 Firebase Console을 수정하지 않는다.
- UID 확인과 매핑표 작성이 끝나기 전 코드 구현을 시작하지 않는다.
- Rules 배포는 하지 않는다.

## 6. 운영 전 금지 조건

아래 조건에서는 Google Login 구현 또는 Rules 전환을 시작하지 않는다.

- UID 미확정 상태에서 코드 구현 금지
- `users/{uid}` 문서 없이 Google Login UI 구현 금지
- Firestore Rules 배포 금지
- 기존 PIN users 문서 삭제 금지
- orders 데이터 마이그레이션 금지
- Reset Data 사용 금지
- Google provider 활성화 가능 여부 미확인 상태에서 운영 테스트 금지
- Authorized domains 미확인 상태에서 GitHub Pages 로그인 테스트 금지

## 7. 22-6N-F 착수 조건

22-6N-F를 시작하려면 아래 조건이 충족되어야 한다.

- 테스트 Google 계정 4개 이상 확정
- 각 계정 Firebase Auth UID 확인
- `users/{uid}` 매핑표 작성 완료
- `legacyUserId` 매핑 완료
- Google provider 활성화 가능 여부 확인
- GitHub Pages Authorized domain 확인
- suspended 차단 테스트 계정 준비
- 기존 `orders.reportedBy` 유지 정책 확정

조건 충족 전 판단:

- 22-6N-F 착수는 HOLD
- 구현 대신 계정/UID/문서 구조 검증을 계속한다.

## 8. 다음 작업 제안

추천 작업명:

WORK22-6N-F — Google Login 최소 UI 및 users/{uid} 조회 구조 구현 설계

목표:

- PC/모바일 공통 Google Login UI 설계
- Firebase Auth `auth.currentUser.uid` 기준 users 문서 조회 흐름 설계
- `currentUser`를 `users/{uid}` 조회 결과로 설정하는 구조 설계
- Google Login 후 role/status 기반 화면 권한 회귀 테스트 계획 작성
- 기존 PIN UI를 보조 잠금 장치로 격하하는 UX 설계

