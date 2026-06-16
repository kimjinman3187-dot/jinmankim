# WORK22-6N-K5A — 직원 개인 Google 승인 구조 설계

## 1. 문제 정의

K4H 계열 작업으로 factory 공용 Google device 계정은 생산 전용 로그인 흐름으로 정리되었다. 다음 단계에서는 일반 직원 개인 Google 계정을 어떻게 운영 승인 대상으로 편입할지 결정해야 한다.

현재 수동으로 Firebase Console에서 직원 30명 계정을 하나씩 등록하는 방식은 운영 비용이 높고, 퇴사자 처리와 권한 회수가 늦어질 위험이 있다. 따라서 개인 Google 로그인은 자동 수집, 승인, 차단, 퇴사 처리 기준을 갖춘 운영 구조로 설계해야 한다.

## 2. K4H 완료 상태 요약

- PR #85가 main에 병합되었고 K4H 최종 상태는 PASS로 판정되었다.
- `factory-device-01`은 PIN 목록에서 제외되고 Google 로그인 전용 계정으로 정리되었다.
- factory role은 모바일/PC에서 생산 화면 중심으로 제한되었다.
- Google 로그인 결과 표시에는 계정, role, provider 흐름이 드러나도록 보정되었다.
- `factory-device-01`은 `account_type=device`, `role=factory`, `status=active` 구조를 유지한다.

## 3. 직원 개인 Google 로그인 필요성

직원 개인 Google 로그인은 다음 운영 문제를 해결하기 위해 필요하다.

- 직원별 감사 로그와 책임 소재를 분리한다.
- 공용 계정 공유로 인한 권한 추적 불명확성을 줄인다.
- 퇴사자 또는 업무 변경자의 접근을 빠르게 차단한다.
- 장기적으로 Google Workspace 또는 Google Group 기반 자동 권한 관리로 확장할 수 있다.

개인 Google 계정은 `account_type=personal`로 구분하고, 기본 PIN 로그인 대상에는 포함하지 않는다.

## 4. A/B/C/D 구조 비교

### A안 — `users/{uid}`에 `status=pending` 혼재

- 방식: Google 로그인 직후 `users/{uid}` 문서를 만들고 `status=pending`으로 둔다.
- 장점: 컬렉션이 하나라 단순해 보인다.
- 단점: 운영 사용자와 승인 대기 사용자가 같은 컬렉션에 섞인다.
- 리스크: Rules와 UI에서 active/pending 분기 누락 시 미승인 계정이 노출될 수 있다.
- 판정: 비권장.

### B안 — `pending_users` 분리 승인

- 방식: 최초 Google 로그인 사용자를 `pending_users/{uid}`에 기록하고 관리자가 승인 시 `users/{uid}`로 승격한다.
- 장점: 승인 대기와 운영 사용자가 분리된다.
- 단점: 승인 UI와 승격 로직이 필요하다.
- 리스크: 승격 실패 또는 중복 승인 처리 설계가 필요하다.
- 판정: fallback.

### C안 — 초대코드 기반 자동 승인

- 방식: 관리자가 초대코드를 발급하고, 직원이 Google 로그인 후 초대코드를 입력하면 role/status가 검증되어 `users/{uid}`가 생성된다.
- 장점: Firebase Console 수동 등록을 줄이고, 관리자 승인 부담도 낮다.
- 단점: 초대코드 발급/만료/사용 처리 설계가 필요하다.
- 리스크: 초대코드 유출 시 오남용을 막기 위한 만료와 1회성 처리가 필요하다.
- 판정: 중기 기본 권장안.

### D안 — Google Workspace / Google Group 기반 자동 승인

- 방식: Workspace 도메인 또는 Google Group 멤버십을 기준으로 role과 접근 권한을 결정한다.
- 장점: 입사/퇴사/부서 이동을 조직 계정 정책과 연동할 수 있다.
- 단점: Workspace 관리 체계와 추가 연동 설계가 필요하다.
- 리스크: 초기 설정 난이도와 운영 정책 정합성 검토가 필요하다.
- 판정: 장기 목표.

## 5. 권장안

K5A 최종 판단은 다음과 같다.

- 중기 기본: C안 — 초대코드 기반 자동 승인
- 장기 목표: D안 — Google Workspace / Google Group 기반 자동 승인
- fallback: B안 — `pending_users` 분리 승인
- 비권장: A안 — `users/{uid}` `status=pending` 혼재

핵심 원칙은 직원 30명 Firebase Console 수동 등록을 제거하고, 앱 내부 승인 흐름 또는 조직 계정 기반 승인 흐름으로 전환하는 것이다.

## 6. 데이터 모델 초안

### `users/{uid}`

```json
{
  "name": "employee name",
  "email": "employee@example.com",
  "role": "sales",
  "status": "active",
  "account_type": "personal",
  "auth_uid": "<firebase_uid>",
  "legacyUserId": "",
  "createdAt": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>",
  "terminated_at": null,
  "terminated_by": null,
  "termination_reason": null
}
```

### `invite_codes/{code}`

```json
{
  "role": "sales",
  "status": "active",
  "account_type": "personal",
  "issued_by": "admin uid",
  "issued_at": "<serverTimestamp>",
  "expires_at": "<timestamp>",
  "used": false,
  "used_by": null,
  "used_at": null
}
```

### `pending_users/{uid}` fallback

```json
{
  "email": "employee@example.com",
  "displayName": "employee name",
  "status": "pending",
  "requested_at": "<serverTimestamp>",
  "provider": "google"
}
```

## 7. 승인 플로우

권장 C안 플로우:

1. 관리자가 직원에게 초대코드를 전달한다.
2. 직원이 개인 Google 계정으로 로그인한다.
3. 앱이 `auth.currentUser.uid`와 email을 확인한다.
4. 직원이 초대코드를 입력한다.
5. 앱이 `invite_codes/{code}`의 만료, 미사용, role, account_type을 확인한다.
6. 조건이 맞으면 `users/{uid}`를 `account_type=personal`, `status=active`로 생성한다.
7. 초대코드는 `used=true`, `used_by=<uid>`로 변경한다.
8. 이후 로그인은 `users/{uid}` 단건 read와 기존 `ACCESS_MATRIX`로 처리한다.

fallback B안 플로우:

1. 미등록 Google 사용자는 운영 화면 진입이 차단된다.
2. `pending_users/{uid}`에 승인 대기 정보만 기록한다.
3. 관리자가 승인 UI에서 role을 지정한다.
4. 승인 시 `users/{uid}`로 승격한다.

## 8. 관리자 승인 UI 초안

관리자 화면에는 다음 최소 항목이 필요하다.

- 승인 대기 사용자 이메일
- Google displayName
- 요청 시간
- 지정할 role 선택
- 승인 버튼
- 반려 버튼
- 승인 또는 반려 처리자
- 처리 시간

초대코드 방식에서는 별도 대기열보다 다음 UI가 우선이다.

- 초대코드 발급
- role 지정
- 만료일 지정
- 미사용/사용완료 상태 확인
- 코드 폐기

## 9. 권한 차단 플로우

다음 조건에서는 운영 화면 진입을 차단한다.

- `users/{uid}` 문서 없음
- `status !== active`
- `role` 없음
- `role`이 `ACCESS_MATRIX`에 없음
- `auth_uid`가 현재 Firebase UID와 불일치
- `account_type`이 허용되지 않은 값

차단 시에는 `currentUser`를 구성하지 않고, `processLoginSuccess()`를 호출하지 않는다. Firebase Auth는 signOut 처리하거나 로그인 화면으로 되돌린다.

## 10. Firestore Rules 영향

K5A는 Rules를 변경하지 않는 설계 단계다. 다만 후속 K5B에서 다음 초안을 검토해야 한다.

- `users/{uid}`는 본인 UID 또는 admin만 read 가능해야 한다.
- `invite_codes`는 코드 검증에 필요한 최소 read만 허용해야 한다.
- 초대코드 사용 처리는 중복 사용 방지를 위해 transaction 또는 callable function 후보를 검토해야 한다.
- `pending_users` fallback을 사용할 경우 본인 create와 admin read/update 범위를 분리해야 한다.
- Rules 전환 전에는 기존 Google Login 최소 운영 흐름과 PIN rollback 경로를 유지한다.

## 11. 기존 PIN 계정 영향

- 기존 PIN 계정은 rollback과 예비 로그인 경로로 유지한다.
- 개인 Google 계정은 기본 PIN 목록에 노출하지 않는다.
- `pin`이 없는 사용자는 PIN 로그인 대상이 아니다.
- `account_type=personal` 계정은 Google Login 중심으로 운영한다.
- 장기적으로 PIN은 보조 잠금 또는 비상 경로로 축소한다.

## 12. factory-device-01 영향

- `factory-device-01`은 `account_type=device`를 유지한다.
- `role=factory`, `status=active`를 유지한다.
- PIN 목록에는 계속 노출하지 않는다.
- 개인 직원 계정 승인 구조와 분리한다.
- 공장 공용 기기 로그인 정책은 별도 device 계정 정책으로 유지한다.

## 13. 구현 단계 분할안

1. K5B — 직원 개인 Google 승인 구조 데이터 모델 / Rules 초안 확정
2. K5C — 초대코드 컬렉션과 관리자 발급 UI 설계
3. K5D — Google 개인 계정 최초 로그인/초대코드 입력 흐름 구현
4. K5E — `users/{uid}` 자동 생성 및 초대코드 사용 처리 구현
5. K5F — pending fallback 또는 반려 플로우 구현
6. K5G — 퇴사자 inactive 처리 UI와 감사 로그 설계
7. K5H — Workspace / Google Group 연동 가능성 재검토

## 14. 리스크

- 초대코드 유출 시 잘못된 계정 승인 가능성
- 초대코드 중복 사용 처리 누락 가능성
- 개인 Gmail 사용 시 퇴사자 계정 자체를 조직에서 suspend할 수 없는 한계
- `users/{uid}`와 Firebase Auth UID 불일치 시 권한 오류 가능성
- Rules 전환이 미흡하면 승인 전 사용자가 과도한 read 권한을 가질 수 있음
- PIN rollback과 Google 승인 흐름이 병행되는 동안 UX 혼선 가능성

## 15. 퇴사자 처리 원칙

퇴사자는 삭제하지 않고 `status=inactive`로 처리한다.

필수 기록:

- `terminated_at`
- `terminated_by`
- `termination_reason`
- `updatedAt`

삭제하지 않는 이유:

- 감사 로그와 주문 처리 이력의 사용자 참조를 보존한다.
- 과거 처리 책임과 운영 기록을 유지한다.
- 계정 재사용 또는 재입사 여부를 명확히 구분한다.

장기적으로는 Workspace 계정 suspend 또는 Google Group 제거와 연동하는 방식을 검토한다.

## 16. 다음 구현 후보 작업명

```text
WORK22-6N-K5B — 직원 개인 Google 승인 구조 데이터 모델 / Rules 초안 확정
```

K5B는 코드 구현이 아니라 데이터 모델 / Rules 초안 설계 작업이다.

