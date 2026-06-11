# WORK22-6N-K4 Auth 병행 구조 정리 설계

기준일: 2026-06-11

## 1. 작업 상태

```text
작업명 = WORK22-6N-K4 — Google Login 이후 PIN/sessionStorage/Anonymous 병행 구조 정리 설계
작업 성격 = 설계 / 조사
코드 수정 = 없음
Rules 수정 = 없음
데이터 수정 = 없음
Reset Data = 미사용
Delete Branch = 미실행
```

## 2. 현재 기준

```text
WORK22-6N-K3B = PASS
WORK22-6N-K3C = PASS
WORK22-6N-K3D = PASS
WORK22-6N-K3D-1 = PASS
WORK22-6N-K3E = PASS
WORK22-6N-K3F = PASS
WORK22-6N-K3 전체 = PASS
```

확인된 운영 검증값:

```text
auth.email = kimjinman3187@gmail.com
auth.uid = xNrwQIcNh6MniXPOGD7J1nimb913
currentUser.role = admin
currentUser.status = active
currentUser.provider = google
yongjin_session = null
active_tab = dashboard
Finance permission-denied 재발 없음
Finance / AR 화면 정상 표시
```

## 3. 조사 대상 파일

```text
index.html
js/firebase-shared.js
js/work22-3h3i-finance-enhancement.js
firestore.rules
```

`firestore.rules`는 repo 안에서 발견되지 않았다. 따라서 K4에서는 rules 파일을 수정하지 않았고, 실제 배포 Rules는 별도 Firebase Console 기준 검토가 필요하다.

## 4. 현재 인증 구조 요약

### 4.1 Google Login 경로

위치:

```text
index.html
loginWithGoogle()
loadCurrentUserFromAuthUser(authUser)
startGoogleAuthStateRestore()
```

흐름:

```text
GoogleAuthProvider
↓
signInWithPopup()
↓
auth.currentUser.uid
↓
users/{uid} 단건 read
↓
status === active 확인
↓
role이 ACCESS_MATRIX에 존재하는지 확인
↓
currentUser UI 상태 객체 구성
↓
processLoginSuccess()
```

운영 기준:

```text
Google Login은 현재 운영 로그인 기준 경로로 PASS.
Google 경로에서는 sessionStorage.yongjin_session을 저장하지 않는다.
```

### 4.2 Anonymous Auth 경로

위치:

```text
js/firebase-shared.js
signInAnonymously()

index.html
startAnonymousPinBootstrap()
waitForFirebaseAndSyncUsers()
```

현재 역할:

```text
PIN 로그인과 users 전체 read를 유지하기 위한 보조 인증 경로.
Google Auth 복원에 실패하거나 Google 사용자가 없으면 Anonymous Auth가 실행된다.
```

판정:

```text
Google Login이 안정화되었으나 PIN 경로가 남아 있으므로 즉시 제거하면 안 된다.
users 전체 read 제거와 PIN 정책 확정 이후 제거한다.
```

### 4.3 PIN Login 경로

위치:

```text
index.html
roleGrid / pcRoleGrid
chooseUser(uid)
kp(digit)
tryLogin()
```

현재 역할:

```text
Firestore users 전체 read 결과를 roleGrid / pcRoleGrid에 표시한다.
선택된 사용자와 PIN을 비교한다.
성공 시 currentUser를 구성하고 sessionStorage.yongjin_session에 저장한다.
```

잔존 리스크:

```text
PIN은 편리하지만 Firebase Auth UID 기반 운영 권한 모델과 분리되어 있다.
PIN 성공 시 sessionStorage가 권한 복원 기준으로 사용된다.
attempts / lockoutUntil을 users 문서에 write한다.
```

### 4.4 sessionStorage 복원 경로

위치:

```text
index.html
window.addEventListener('load', ...)
sessionStorage.getItem('yongjin_session')
```

현재 역할:

```text
Google currentUser가 있거나 auth.currentUser가 Google user이면 session restore를 건너뛴다.
그 외에는 yongjin_session을 JSON parse하여 currentUser로 복원한다.
```

판정:

```text
Google 경로에서는 비권한화가 완료되어 있다.
PIN 경로에서는 아직 권한 복원 수단으로 남아 있다.
```

### 4.5 users 전체 read 경로

위치:

```text
index.html
syncUsers()

js/firebase-shared.js
FirebaseShared.syncUsers()
```

현재 역할:

```text
users 컬렉션 전체 active user를 읽어 roleGrid / pcRoleGrid를 구성한다.
PIN 사용자 목록 표시와 lockout 상태 반영에 사용된다.
```

잔존 리스크:

```text
Google UID 기반 단건 read 구조와 병행된다.
Rules를 UID 단건 read 중심으로 전환하려면 users 전체 read를 먼저 제거하거나 별도 허용 정책을 설계해야 한다.
```

### 4.6 currentUser / ACCESS_MATRIX / yj:auth-ready

현재 역할:

```text
currentUser = UI 상태 객체
ACCESS_MATRIX = 화면/기능 접근 제어 테이블
yj:auth-ready = 로그인 성공 후 Finance patch listener 재시작 신호
yjCanStartFinanceListeners = admin/accounting active user만 Finance listener 시작 허용
```

판정:

```text
currentUser와 ACCESS_MATRIX는 유지한다.
권한 판단 source만 PIN 선택값에서 users/{uid} read 결과로 점진 고정한다.
```

### 4.7 logout 경로

위치:

```text
index.html
logout()
```

현재 동작:

```text
Google user이면 auth.signOut() 시도
sessionStorage.yongjin_session 제거
notification/order listener 정리
location.reload()
```

판정:

```text
Google / PIN 병행 구조를 모두 고려하고 있어 K4 단계에서는 유지한다.
PIN 제거 후 signOut 중심으로 단순화한다.
```

### 4.8 factory 모바일 진입 경로

위치:

```text
index.html
ROLE_TABS
PC_ROLE_TABS
renderFactory()
startOrdersListener()
```

현재 특징:

```text
factory role은 모바일에서 factory/history 중심으로 사용된다.
PC에서는 factory만 허용된다.
startOrdersListener는 factory role에 대해 approved/completed 주문만 조회한다.
```

판정:

```text
공장 현장 사용성 때문에 factory 모바일 정책은 K4에서 바로 제거하지 않고 K4A로 분리한다.
```

## 5. Google Login 완료 후 남은 병행 구조

```text
Google Login = 운영 기준 경로
Anonymous Auth = PIN/users 전체 read 보조 경로
PIN Login = 기존 운영/현장 fallback 경로
sessionStorage.yongjin_session = PIN 복원 경로
users 전체 read = PIN 사용자 목록 표시 경로
users/{uid} 단건 read = Google 운영 로그인 경로
currentUser = 공통 UI 상태 객체
ACCESS_MATRIX = 공통 UI 접근 제어
```

## 6. KEEP / SHRINK / REMOVE / DEFER 분류표

| 항목 | 분류 | 사유 | 다음 조치 |
| --- | --- | --- | --- |
| Google Login | KEEP | K3 운영 검증 PASS | 유지 |
| users/{uid} 단건 read | KEEP | Google 운영 권한 source | 유지 및 표준화 |
| currentUser | KEEP | UI 상태 객체로 필요 | 유지 |
| ACCESS_MATRIX | KEEP | 화면 접근 제어 중심 | 유지 |
| yj:auth-ready | KEEP | Google/PIN 공통 로그인 후 패치 재시작 신호 | 유지 |
| yjCanStartFinanceListeners | KEEP | Finance listener 권한 gate | 유지 |
| active_tab | KEEP | 화면 복원 상태이며 권한 source 아님 | 유지 가능 |
| PIN Login | SHRINK | Google 운영 경로와 병행 중 | 주 인증에서 보조 잠금/현장 fallback으로 축소 설계 |
| sessionStorage.yongjin_session | SHRINK → REMOVE | Google에서는 미사용이나 PIN에서는 복원 source | PIN 축소 후 제거 |
| users 전체 read | SHRINK → REMOVE | PIN 사용자 목록 표시 때문에 잔존 | K4B에서 제거 설계 우선 |
| syncUsers | SHRINK | users 전체 read와 roleGrid 갱신 담당 | Google 기준으로 축소 |
| pcRoleGrid / roleGrid | SHRINK | PIN 선택 UI | factory 정책 확정 전까지 축소 보류 |
| attempts / lockoutUntil | SHRINK | PIN 보안 잠금에 필요 | PIN 축소 정책에 따라 유지 범위 결정 |
| Anonymous Auth | DEFER → REMOVE | PIN/users 전체 read 보조 경로 | users 전체 read/PIN 제거 후 제거 |
| factory 모바일 정책 | DEFER | 현장 사용성 영향 큼 | K4A로 분리 |
| Firestore Rules UID 전환 | DEFER | 선행 구조 정리 필요 | K4C 이후 설계 |

## 7. 권장 전환 순서

### 1단계: users 전체 read 제거 설계

작업 후보:

```text
WORK22-6N-K4B — users 전체 read 제거 및 UID 단건 read 전환 설계
```

목표:

```text
users 전체 read 없이 Google users/{uid} 단건 read로 운영 로그인 유지.
PIN 사용자 목록 표시 의존성을 분리.
```

이유:

```text
Firestore Rules를 UID 기반으로 전환하기 전 가장 큰 병행 구조가 users 전체 read이다.
```

### 2단계: sessionStorage.yongjin_session 제거 설계

작업 후보:

```text
WORK22-6N-K4C — sessionStorage.yongjin_session 제거 설계
```

목표:

```text
권한 복원 source를 Firebase Auth + users/{uid}로 고정.
active_tab 등 UI 상태만 sessionStorage에 유지.
```

### 3단계: PIN Login 주 인증 제거 또는 보조 잠금화

작업 후보:

```text
WORK22-6N-K4D — PIN Login 보조 정책 설계
```

선택지:

```text
A. PIN 제거
B. factory 모바일 전용 보조 잠금
C. 긴급 fallback으로 숨김 유지
```

### 4단계: Anonymous Auth 제거

작업 후보:

```text
WORK22-6N-K4E — Anonymous Auth 제거 설계
```

전제:

```text
PIN/users 전체 read 의존성이 제거되어야 한다.
```

### 5단계: factory 모바일 정책 확정

작업 후보:

```text
WORK22-6N-K4A — factory 모바일 Google/PIN 운영 정책 분리 설계
```

분리 사유:

```text
공장 현장 장비/공용PC/모바일 사용성은 보안 설계와 별도 운영 판단이 필요하다.
```

### 6단계: Firestore Rules Google UID 기반 전환

작업 후보:

```text
WORK22-6N-K4F — Firestore Rules UID 기반 전환 설계
```

전제:

```text
users 전체 read 제거
sessionStorage 권한 복원 제거
PIN 주 인증 축소
Anonymous Auth 제거 또는 범위 확정
```

## 8. Rules 전환 전 선행 조건

```text
1. users/{uid} 문서 구조 확정
2. 모든 운영 사용자의 Firebase UID 확보
3. users 전체 read 제거 또는 관리자 전용 제한
4. currentUser source를 users/{uid} read 결과로 고정
5. sessionStorage.yongjin_session 권한 복원 제거
6. PIN Login 정책 확정
7. Anonymous Auth 제거 또는 명확한 제한
8. factory 모바일 로그인 정책 확정
9. Rules staging 검증 절차 확보
10. rollback 절차 확보
```

## 9. K4 결론

권장 결론:

```text
K4는 구현 없이 병행 구조 정리 설계를 완료한다.
즉시 제거 대상은 없다.
가장 먼저 줄일 대상은 users 전체 read이다.
sessionStorage.yongjin_session은 Google 경로에서는 이미 비권한화되었으나 PIN 경로에 남아 있으므로 2단계에서 제거 설계를 진행한다.
Anonymous Auth는 users 전체 read와 PIN 경로가 남아 있어 즉시 제거하지 않는다.
factory 모바일 정책은 K4A로 분리한다.
Rules 전환은 마지막 단계로 이월한다.
```

## 10. 다음 작업 후보

1순위:

```text
WORK22-6N-K4B — users 전체 read 제거 및 UID 단건 read 전환 설계
```

분리 후보:

```text
WORK22-6N-K4A — factory 모바일 Google/PIN 운영 정책 분리 설계
```

후속 후보:

```text
WORK22-6N-K4C — sessionStorage.yongjin_session 제거 설계
WORK22-6N-K4D — PIN Login 보조 정책 설계
WORK22-6N-K4E — Anonymous Auth 제거 설계
WORK22-6N-K4F — Firestore Rules UID 기반 전환 설계
```

## 11. PASS 기준 확인

```text
코드 변경 없음 = 확인
Rules 변경 없음 = 확인
데이터 변경 없음 = 확인
현재 병행 구조 전수 정리 = 완료
KEEP / SHRINK / REMOVE / DEFER 분류 = 완료
K4A/K4B 후속 작업 분리 기준 = 완료
HARNESS 저장 = 별도 SHA256 확인 필요
다음 작업 지시 가능 수준의 설계문서 = 완료
```
