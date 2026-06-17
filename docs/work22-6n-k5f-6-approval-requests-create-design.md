# WORK22-6N-K5F-6 — approval_requests 생성 구조 설계

기준일: 2026-06-17  
작업 성격: 설계 문서 PR  
기준 상태: PR #95 merged, K5F-5 PASS, admin dashboard approval_requests read-only 목록 표시 완료

## 1. 목적

K5F-5에서 `approval_requests` read-only 목록 표시가 완료되었다.  
K5F-6의 목적은 미승인 Google 사용자가 승인 요청을 생성하는 구조를 설계하는 것이다.

이번 작업은 구현이 아니다.

```text
Firestore write 코드 구현 없음
Firestore Rules 수정 없음
Firebase Console 조작 없음
Cloud Functions 환경 생성 없음
승인/반려/보류 처리 구현 없음
```

## 2. 현재 기준

현재 운영 기준은 다음과 같다.

```text
Google Login 운영 흐름 존재
users/{uid} 단건 read 기반 로그인 존재
admin dashboard에 approval_requests read-only 목록 존재
approval_requests 조회 기준: requested_at desc, limit 50
승인/반려/보류 버튼은 disabled 유지
```

K5F-6은 이 상태에서 다음 단계를 위한 데이터 생성 설계를 확정한다.

## 3. 승인 요청 생성 흐름

권장 흐름은 다음과 같다.

```text
1. 미승인 Google 사용자가 Google Login 시도
2. auth.currentUser.uid / email / displayName 확보
3. users/{uid} 문서가 없거나 status가 active가 아니면 운영 로그인 진입 거부
4. 로그인 거부 화면에서 승인 요청 생성 안내 표시
5. 사용자가 요청 role과 요청 사유를 입력
6. approval_requests/{uid} 문서 생성 또는 기존 pending 요청 안내
7. admin dashboard read-only 목록에서 요청 확인
8. 실제 승인/반려/보류 처리는 후속 작업에서 분리 구현
```

K5F-6에서는 위 흐름 중 1~8의 설계만 다룬다. 실제 `set`, `add`, `update`, `delete`, `runTransaction`, `writeBatch`는 구현하지 않는다.

## 4. 컬렉션 구조

권장 컬렉션은 다음과 같다.

```text
approval_requests/{uid}
```

문서 ID를 Firebase Auth UID로 고정하는 방식을 우선 검토한다.

### 4.1 uid 문서 ID 고정 장점

```text
동일 Google 계정의 중복 요청 방지가 단순함
admin 목록에서 uid와 문서 ID가 일치하여 추적이 쉬움
users/{uid} 전환 시 연결이 명확함
Rules에서 request.auth.uid == resource id 조건을 쓰기 쉬움
```

### 4.2 uid 문서 ID 고정 단점

```text
같은 사용자의 재요청 이력을 한 문서에 누적하거나 별도 history 필드가 필요함
반려 후 재요청 정책을 status 변경 방식으로 명확히 정의해야 함
요청 이력을 완전한 이벤트 로그로 남기려면 별도 approval_request_logs가 필요할 수 있음
```

### 4.3 권장 판정

K5F-6 기준 권장안은 `approval_requests/{uid}`이다.  
이력 보존이 필요해지면 후속 작업에서 `approval_request_logs/{autoId}`를 별도 설계한다.

## 5. 문서 구조 초안

초안 구조는 다음과 같다.

```json
{
  "uid": "Firebase Auth UID",
  "email": "user@example.com",
  "displayName": "Google display name",
  "photoURL": "https://...",
  "provider": "google",
  "requested_role": "sales",
  "request_reason": "업무상 Sales 접근 필요",
  "status": "pending",
  "source": "google_approval_gate",
  "requested_at": "<serverTimestamp>",
  "updated_at": "<serverTimestamp>",
  "reviewed_by": null,
  "reviewed_at": null,
  "decision_reason": null,
  "memo": null
}
```

## 6. 필드 정의

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `uid` | string | O | Firebase Auth UID. 문서 ID와 동일해야 한다. |
| `email` | string | O | Google 계정 email. |
| `displayName` | string | 선택 | Google 표시 이름. 없으면 빈 문자열 허용. |
| `photoURL` | string | 선택 | Google 프로필 이미지 URL. UI 표시용이며 필수 아님. |
| `provider` | string | O | `google` 고정. |
| `requested_role` | string | O | 요청 권한. `sales`, `accounting`, `factory`만 우선 허용. |
| `request_reason` | string | 선택 | 요청 사유. 운영상 권장 입력. |
| `status` | string | O | 기본값 `pending`. |
| `source` | string | O | `google_approval_gate` 고정. |
| `requested_at` | timestamp | O | 최초 요청 시각. 서버 timestamp 권장. |
| `updated_at` | timestamp | O | 마지막 변경 시각. 서버 timestamp 권장. |
| `reviewed_by` | string/null | O | 처리 admin UID 또는 legacy id. 생성 시 null. |
| `reviewed_at` | timestamp/null | O | 처리 시각. 생성 시 null. |
| `decision_reason` | string/null | O | 승인/반려/보류 사유. 생성 시 null. |
| `memo` | string/null | O | 관리자 메모. 생성 시 null. |

## 7. status 값 체계

권장 상태값은 다음과 같다.

| status | 의미 | K5F-6 생성 단계 사용 여부 |
|---|---|---:|
| `pending` | 관리자 검토 대기 | O |
| `approved` | 승인 처리 완료 | 후속 작업 |
| `rejected` | 반려 처리 완료 | 후속 작업 |
| `on_hold` | 보류 처리 | 후속 작업 |
| `inactive` | 비활성/퇴사 등 운영상 제외 | 후속 작업 |

K5F-6 생성 흐름에서는 신규 요청의 기본값을 `pending`으로 고정한다.

## 8. requested_role 처리 방식

K5F-6 설계 기준 `requested_role`은 아래 값만 허용한다.

```text
sales
accounting
factory
```

`admin` 요청은 금지한다.  
`device` 계정 요청도 금지한다.  
factory-device-01 같은 `account_type=device` 계정은 별도 운영 계정으로 유지하며 개인 Google 승인 요청 흐름에 섞지 않는다.

## 9. 중복 요청 방지 기준

중복 요청 방지는 문서 ID를 `uid`로 고정하는 방식이 1차 기준이다.

권장 판정:

```text
approval_requests/{uid}가 없으면 pending 요청 생성 가능
approval_requests/{uid}.status == pending이면 새 요청 생성 금지, 기존 요청 안내
approval_requests/{uid}.status == on_hold이면 새 요청 생성 금지, 관리자 확인 필요 안내
approval_requests/{uid}.status == approved이면 새 요청 생성 금지, 로그인 재시도 안내
approval_requests/{uid}.status == rejected이면 재요청 정책을 후속 작업에서 결정
approval_requests/{uid}.status == inactive이면 관리자 문의 안내
```

반려 후 재요청을 허용할지 여부는 K5F-7 또는 K5G 계열에서 별도 확정한다.  
K5F-6에서는 임의 재요청 자동 생성을 설계하지 않는다.

## 10. requested_at / updated_at 기록 방식

권장 방식:

```text
requested_at: 최초 승인 요청 생성 시 serverTimestamp
updated_at: 최초 생성 시 serverTimestamp, 이후 status/memo 변경 시 갱신
```

클라이언트 시간값은 보조 표시로만 사용하고, 운영 기준 시간은 Firestore server timestamp로 설계한다.

K5F-6에서는 실제 `firebase.firestore.FieldValue.serverTimestamp()` 호출을 구현하지 않는다.

## 11. 관리자 read-only 목록 연결 기준

K5F-5의 read-only 목록은 다음 기준과 연결된다.

```text
컬렉션: approval_requests
정렬: requested_at desc
제한: limit 50
표시 대상: admin dashboard
표시 목적: 생성된 승인 요청의 확인
```

K5F-6 생성 구조가 적용되면 admin dashboard는 별도 구조 변경 없이 신규 요청을 목록에서 확인할 수 있어야 한다.

read-only 목록의 버튼은 계속 disabled 상태로 유지한다. 승인/반려/보류 처리는 후속 작업에서 분리한다.

## 12. Firestore Rules 향후 필요 조건

K5F-6에서는 Rules를 수정하지 않는다.  
향후 write 구현 시 필요한 Rules 조건은 다음과 같이 검토한다.

### 12.1 생성 허용 후보

```text
match /approval_requests/{requestUid} 기준으로 설계한다.
request.auth != null
request.auth.uid == requestUid
request.resource.data.uid == requestUid
request.resource.data.email == request.auth.token.email
request.resource.data.status == 'pending'
request.resource.data.source == 'google_approval_gate'
request.resource.data.requested_role in ['sales', 'accounting', 'factory']
request.resource.data.reviewed_by == null
request.resource.data.reviewed_at == null
request.resource.data.decision_reason == null
request.resource.data.memo == null
users/{request.auth.uid} active 문서가 없어야 함
```

### 12.2 업데이트 제한 후보

```text
일반 사용자는 본인 approval_requests/{uid} 생성만 가능
일반 사용자는 status/reviewed_by/reviewed_at/decision_reason 변경 금지
admin만 approval_requests status/memo/reviewed_* 변경 가능
admin 판단 기준은 users/{adminUid}.role == 'admin' 및 status == 'active'
```

### 12.3 읽기 제한 후보

```text
admin: 전체 approval_requests read 가능
요청자 본인: approval_requests/{uid} 단건 read 가능
그 외 role: read 금지
```

Rules 설계와 배포는 K5F-6 범위가 아니다.

## 13. users / invite_codes / pending_users / orders 영향

K5F-6 설계는 아래 데이터를 변경하지 않는 구조를 기본 원칙으로 한다.

```text
users 변경 없음
invite_codes 변경 없음
pending_users 변경 없음
orders 변경 없음
```

approval_requests 생성은 사용자 승인 요청 기록만 담당한다.  
`users/{uid}` 생성, role 부여, status active 확정은 별도 승인 처리 작업으로 분리한다.

## 14. 후속 작업 분리

K5F-6 이후 권장 작업 분리는 다음과 같다.

```text
WORK22-6N-K5F-7 — approval_requests 생성 UI/Rules 구현 범위 확정
WORK22-6N-K5G-1 — approval_requests 생성 최소 구현
WORK22-6N-K5G-2 — approval_requests 생성 검증 및 Closeout
WORK22-6N-K5H — admin 승인/반려/보류 처리 설계
WORK22-6N-K5I — admin 승인/반려/보류 최소 구현
```

승인/반려/보류 실제 처리, `users/{uid}` 자동 생성, `status=active` 확정, role 자동 부여는 K5F-6에서 제외한다.

## 15. 운영 리스크

| 리스크 | 설명 | 통제 방향 |
|---|---|---|
| 중복 요청 | 같은 Google 계정이 여러 번 요청 | 문서 ID를 uid로 고정 |
| 잘못된 role 요청 | admin/device 등 부적절한 role 요청 | requested_role 허용값 제한 |
| 승인 전 권한 부여 | 요청 생성만으로 접근 가능해지는 문제 | users 생성/role 부여 금지 |
| Rules 미정 상태 write | 클라이언트 write가 과도하게 열리는 문제 | 구현 전 Rules 설계 필수 |
| 반려 후 재요청 혼선 | rejected 상태에서 재요청 기준 불명확 | 후속 작업에서 정책 확정 |
| 개인정보 과다 저장 | Google 프로필 정보 과다 저장 | email/uid/displayName 중심 최소 저장 |
| 관리자 목록 누락 | requested_at 누락 시 정렬 실패 | requested_at 필수, serverTimestamp 권장 |

## 16. K5F-6에서 구현하지 않는 항목

```text
index.html 기능 코드 구현
approval_requests add/set/update/delete
users 생성/update
invite_codes 생성/update
pending_users 생성/update
orders 변경
runTransaction
writeBatch
Firestore Rules 수정
Firebase deploy
Firebase Console 조작
functions 환경 생성
firebase.json 생성
package.json 생성
.firebaserc 생성
Cloud Functions 코드 추가
승인/반려/보류 실제 동작
status=active 자동 확정
role 자동 부여
Reset Data
Delete Branch
```

## 17. PASS 기준

K5F-6 설계 문서 PASS 기준은 다음과 같다.

```text
approval_requests 생성 흐름 설계 완료
approval_requests/{uid} 구조 검토 완료
문서 ID uid 고정 여부 판정 완료
중복 요청 방지 기준 작성 완료
필드 구조 초안 작성 완료
status 값 체계 작성 완료
requested_role 처리 기준 작성 완료
requested_at / updated_at 기록 기준 작성 완료
admin read-only 목록 연결 기준 작성 완료
향후 Rules 필요 조건 정리 완료
승인/반려/보류 후속 작업 분리 완료
코드/Rules/데이터 변경 없음
```

## 18. Gene/ORION 검토 요청

검토 시 아래를 확인한다.

```text
1. 변경 파일이 docs 문서 1개뿐인지
2. index.html 변경이 없는지
3. Firestore Rules 변경이 없는지
4. approval_requests write 구현이 없는지
5. users/invite_codes/pending_users/orders 변경이 없는지
6. approval_requests/{uid} 구조가 운영 정책에 맞는지
7. rejected 후 재요청 정책을 후속 작업으로 분리하는 것이 적절한지
8. 다음 작업을 K5F-7 또는 K5G-1로 진행할지
```

자체 PASS가 아니라 Gene/ORION의 Files changed 및 문서 검토 후 PASS/HOLD를 판정한다.
