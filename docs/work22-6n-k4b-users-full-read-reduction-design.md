# WORK22-6N-K4B users 전체 read 제거 및 UID 단건 read 전환 설계

기준일: 2026-06-11

## 1. 작업 상태

```text
작업명 = WORK22-6N-K4B — users 전체 read 제거 및 UID 단건 read 전환 설계
작업 성격 = 설계 / 조사
코드 수정 = 없음
Rules 수정 = 없음
데이터 수정 = 없음
Reset Data = 미사용
Delete Branch = 미실행
```

## 2. 현재 기준

```text
WORK22-6N-K3 전체 = PASS
WORK22-6N-K4 = PASS
Google Login 운영 검증 = PASS
users/{uid} 단건 read = PASS
currentUser.provider = google
sessionStorage.yongjin_session = null
Finance / AR 화면 정상
```

K4 결론:

```text
KEEP = Google Login, users/{uid} 단건 read, currentUser, ACCESS_MATRIX, yj:auth-ready, yjCanStartFinanceListeners
SHRINK = PIN Login, sessionStorage.yongjin_session, users 전체 read, syncUsers, roleGrid / pcRoleGrid
DEFER = factory 모바일 정책, Anonymous Auth 제거, Firestore Rules UID 전환
```

## 3. 조사 대상 파일

```text
index.html
js/firebase-shared.js
js/work22-3h3i-finance-enhancement.js
```

참고:

```text
firestore.rules는 repo 내 파일 없음으로 확인된 상태이다.
Rules 수정 또는 배포는 수행하지 않았다.
```

## 4. users 전체 read 발생 위치

| 파일 | 함수/위치 | read 방식 | 목적 | 제거 가능성 |
| --- | --- | --- | --- | --- |
| `index.html` | `syncUsers()` | `db.collection('users').orderBy('sort_index', 'asc').get()` | PIN 로그인 사용자 목록 구성, `roleGrid`/`pcRoleGrid` 렌더링 | 가능. 단, PIN 목록 UI 축소/제거 필요 |
| `index.html` | `renderAdminMonitor()` | `db.collection('users').get()` | 관리자 잠금 상태 모니터, 강제 잠금 해제 UI | 제한 가능. admin 전용 유지 또는 후속 분리 필요 |
| `js/firebase-shared.js` | `FirebaseShared.syncUsers()` | `db.collection('users').where('status', '==', 'active').orderBy('sort_index', 'asc').get()` | 공용 사용자 목록 로드 API | 축소/제거 가능. 현재 핵심 운영 Google 경로에는 불필요 |
| `index.html` | `waitForFirebaseAndSyncUsers()` | 내부에서 `syncUsers()` 호출 | Anonymous Auth 후 PIN 사용자 목록 로드 | Anonymous/PIN 축소 전까지 잔존 |
| `index.html` | `startAnonymousPinBootstrap()` | Anonymous Auth 후 `waitForFirebaseAndSyncUsers()` | PIN bootstrap | Anonymous 제거 전까지 잔존 |

## 5. users 전체 read 의존 기능

| 기능 | users 전체 read 의존 여부 | 제거 시 영향 | 대체 방안 |
| --- | --- | --- | --- |
| PC PIN 사용자 버튼 표시 | 높음 | `pcRoleGrid`에 사용자 버튼 표시 불가 | PC는 Google Login 우선, PIN UI 숨김/축소 |
| 모바일 PIN 사용자 버튼 표시 | 높음 | `roleGrid`에 사용자 버튼 표시 불가 | factory 모바일 정책으로 분리 |
| `roleGrid` | 높음 | 모바일 PIN 선택 UI 미표시 | factory 전용 보조 정책 결정 |
| `pcRoleGrid` | 높음 | PC PIN 선택 UI 미표시 | Google Login만 표시 |
| `chooseUser(uid)` | 높음 | 선택할 USERS 배열이 없어짐 | PIN 축소 시 비활성화 |
| `tryLogin()` | 높음 | PIN 인증 대상 user를 찾을 수 없음 | Google 경로 사용, PIN 보조 정책 별도 |
| `attempts / lockoutUntil` 반영 | 중간 | PIN 잠금 상태 표시/갱신 불가 | PIN 유지 범위에 한해 단건 조회/서버 정책 검토 |
| factory 사용자 선택 | 높음 | 현장 공장 로그인 UX 영향 | K4A에서 공장 전용 정책 분리 |
| accounting/sales/admin 사용자 선택 | 높음 | PIN 방식 선택 불가 | Google Login으로 전환 |
| admin monitor | 중간 | 전체 사용자 잠금 모니터 미표시 | admin 전용 별도 쿼리 또는 후속 유지 판단 |

## 6. Google users/{uid} 단건 read 경로

현재 Google 운영 로그인 경로:

```text
auth.currentUser.uid
↓
db.collection('users').doc(uid).get()
↓
role / status / name / email / auth_uid 확인
↓
currentUser 구성
↓
ACCESS_MATRIX 적용
↓
processLoginSuccess()
↓
화면 진입
```

관련 함수:

```text
index.html
loadCurrentUserFromAuthUser(authUser)
loginWithGoogle()
startGoogleAuthStateRestore()
```

판단:

```text
Google Login 운영 경로는 users 전체 read 없이 유지 가능하다.
로그인 사용자의 users/{uid} 문서만 있으면 role/status/name/email/auth_uid를 확인할 수 있다.
ACCESS_MATRIX 적용도 전체 사용자 목록이 필요하지 않다.
```

## 7. users 전체 read 제거의 선행 효과

users 전체 read 제거는 Firestore Rules UID 기반 전환의 핵심 선행 조건이다.

현재 전체 read가 남아 있으면 Rules에서 다음 허용이 필요하다.

```text
users 컬렉션 active 사용자 목록 read 허용
```

이 허용은 UID 단건 read 중심의 운영 보안 모델과 충돌한다.

users 전체 read를 제거하면 Rules 전환 시 목표 구조를 아래처럼 단순화할 수 있다.

```text
request.auth.uid == users/{uid} 문서 ID
자기 users/{uid} 문서 read 허용
admin만 필요한 관리성 users read/write 허용
orders는 role/status 기준으로 별도 제한
```

## 8. PIN Login 축소 방향

PIN Login은 즉시 제거하지 않고 아래 선택지로 축소한다.

### A. PC PIN 로그인 제거 가능

판정:

```text
가능
```

이유:

```text
PC 운영 로그인은 Google Login이 PASS 되었고 users/{uid} 단건 read로 권한 확인 가능하다.
PC PIN 목록은 users 전체 read를 가장 크게 유발한다.
```

주의:

```text
긴급 fallback 필요 여부를 운영자가 결정해야 한다.
```

### B. 모바일 PIN 로그인 보류

판정:

```text
보류
```

이유:

```text
factory 모바일 사용성 영향이 크다.
현장 기기에서 Google Login UX가 불편할 수 있다.
```

### C. factory 전용 보조 잠금으로 유지 가능

판정:

```text
가능하나 별도 설계 필요
```

조건:

```text
전체 users read 없이 factory 전용 단건 또는 제한 목록으로 구성해야 한다.
```

### D. 긴급 fallback으로 숨김 유지 가능

판정:

```text
가능하나 운영 리스크 있음
```

조건:

```text
AUTH_DEV_MODE 또는 관리자 전용 숨김 플래그로 제한해야 한다.
운영 화면에 일반 노출되면 안 된다.
```

## 9. users 전체 read 제거 단계

### K4B-1: Google Login 경로와 PIN 경로 분리

목표:

```text
Google Login 경로는 users/{uid} 단건 read만 사용한다고 명확히 고정한다.
PIN bootstrap과 Google bootstrap이 서로 독립되도록 설계한다.
```

산출:

```text
Google Login에서는 syncUsers() 호출 금지 원칙
PIN Login에서만 syncUsers() 호출 허용
```

### K4B-2: PC PIN 사용자 목록 제거

목표:

```text
PC 로그인 화면에서 pcRoleGrid 기반 사용자 목록을 제거하거나 숨김 처리한다.
Google Login 버튼을 PC 기본 로그인 방식으로 고정한다.
```

효과:

```text
PC 경로의 users 전체 read 필요성 제거
```

### K4B-3: 모바일 factory 정책 분리

목표:

```text
모바일 factory 로그인은 K4A에서 별도 운영 정책으로 결정한다.
```

선택지:

```text
Google Login 사용
factory 전용 PIN 보조 잠금
공용 기기 전용 계정
```

### K4B-4: syncUsers 호출 범위 축소

목표:

```text
syncUsers()를 앱 전체 bootstrap에서 제거하고 PIN fallback이 필요한 제한 경로에서만 호출한다.
```

대상:

```text
window.onload
startAnonymousPinBootstrap()
waitForFirebaseAndSyncUsers()
```

### K4B-5: users 전체 read 제거

목표:

```text
index.html syncUsers()의 users 전체 get 제거
FirebaseShared.syncUsers() 제거 또는 dev-only 전환
admin monitor의 users 전체 get은 별도 admin-only 정책으로 분리
```

### K4B-6: Rules UID 기반 전환 준비

목표:

```text
users/{uid} 단건 read만으로 로그인과 권한 확인 가능하게 만든 뒤 Rules 전환 설계로 이동한다.
```

## 10. 최종 목표 구조

목표 로그인 흐름:

```text
앱 로드
↓
Firebase Auth 확인
↓
Google user 존재
↓
auth.uid 확보
↓
users/{uid} 단건 read
↓
status active 확인
↓
role 확인
↓
ACCESS_MATRIX 적용
↓
화면 진입
```

제거 또는 축소 목표:

```text
users 컬렉션 전체 active user read 제거
PIN 사용자 목록 렌더링 제거 또는 factory 보조 정책으로 분리
syncUsers 역할 축소
Anonymous Auth 제거 준비
```

## 11. 운영 리스크

| 리스크 | 내용 | 대응 |
| --- | --- | --- |
| factory 모바일 로그인 UX 저하 | PIN 목록 제거 시 현장 사용자가 불편할 수 있음 | K4A에서 별도 정책 설계 |
| 직원 Gmail 미수집 | Google 전환 대상 직원 email이 없으면 로그인 불가 | 사용자별 email/UID 수집 절차 필요 |
| 직원 UID 미생성 | Firebase Auth Users에 UID가 없으면 users/{uid} 생성 불가 | Google Login 1회 수행 절차 필요 |
| PIN 제거 후 현장 마찰 | 기존 PIN 습관이 있어 전환 부담 가능 | 단계적 축소, 공지, 보조 정책 |
| users 전체 read 제거 후 PIN 목록 표시 불가 | roleGrid/pcRoleGrid가 빈 상태가 될 수 있음 | PC PIN 제거 또는 factory 분리 |
| Anonymous Auth 제거 후 PIN bootstrap 실패 | PIN이 Anonymous Auth에 의존 | PIN 제거/축소 후 Anonymous 제거 |
| Rules 전환 후 users/{uid} 문서 누락 | uid 문서 없는 사용자는 로그인 불가 | 생성 체크리스트와 rollback 필요 |
| 권한 누락 | role/status 문서 오류 시 화면 접근 실패 | admin 검증표 필요 |
| admin monitor 축소 | 전체 user lockout 화면이 제한될 수 있음 | admin 전용 기능으로 재설계 |

## 12. K4B 결론

```text
Google Login 운영 경로는 users 전체 read 없이 유지 가능하다.
users 전체 read는 PIN 사용자 목록 표시와 admin monitor 때문에 잔존한다.
가장 먼저 줄일 대상은 PC PIN 사용자 목록과 syncUsers bootstrap이다.
모바일 factory PIN 정책은 K4A로 분리해야 한다.
Rules UID 전환은 users 전체 read 제거 이후 진행해야 한다.
```

## 13. 다음 작업 후보

1순위:

```text
WORK22-6N-K4C — sessionStorage.yongjin_session 제거 설계
```

이유:

```text
users 전체 read 축소 방향이 정리되었으므로 다음 병행 위험은 sessionStorage 권한 복원이다.
```

분리 후보:

```text
WORK22-6N-K4A — factory 모바일 Google/PIN 운영 정책 분리 설계
```

후속 후보:

```text
WORK22-6N-K4D — PIN Login 보조 정책 설계
WORK22-6N-K4E — Anonymous Auth 제거 설계
WORK22-6N-K4F — Firestore Rules UID 기반 전환 설계
```

## 14. PASS 기준 확인

```text
users 전체 read 위치 분석 완료
syncUsers 분석 완료
roleGrid / pcRoleGrid 의존도 분석 완료
Google users/{uid} 단건 read 경로 분석 완료
PIN Login 축소 방향 정리 완료
users 전체 read 제거 단계 작성 완료
운영 리스크 작성 완료
repo/docs 문서 생성 완료
HARNESS 의도DB 저장 및 SHA256 동일성 확인 필요
코드 변경 없음
Rules 변경 없음
데이터 변경 없음
Reset Data 미사용
```
