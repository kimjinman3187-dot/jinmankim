# WORK22-6N-G1 — Google Provider 활성화 및 테스트 계정 UID 생성 절차 설계

기준일: 2026-06-09
작업 성격: **문서 작성 전용** (코드/Rules/Console/데이터 변경 없음)
선행: `work22-6n-d-*`, `work22-6n-e-*`, `work22-6n-g0-google-login-b1-validation.md`

## 1. 작업 목적

B1 RED 상태를 Green으로 전환하기 위한 **운영 준비 절차**를 문서화한다. 본 작업은 코드 구현이 아니라, Firebase Console에서 Google Provider를 활성화하기 전 필요한 확인사항, 테스트 계정 준비, 직원별 Google Email 배정, Firebase UID 확보 절차, `users/{uid}` 문서 생성 전 체크리스트를 정리하는 **설계 문서 작성**이다.

## 2. 현재 상태

현재 인증 구조:

```text
Anonymous Auth + PIN Login + sessionStorage role/name
```

이 구조는 Firestore Rules의 신뢰 기준으로 사용할 수 없다(6N-D/6N-B 확정).

최종 전환 방향:

```text
Google Login = PC/모바일 공통 신원 인증
PIN          = 모바일 factory 현장 보조 잠금
```

현재 B1 상태:

```text
B1 = RED
```

B1 RED 사유:

- Google Email 미확정 (운영 users 6개 전부 email 필드 부재 — 6N-G0 실증)
- Firebase UID 미생성 (auth_uid 6개 전부 빈 문자열 `""`)
- `users/{uid}` 경로 미확정
- Google Provider 활성화 전
- 직원별 Google 1회 로그인 전

---

## 3. 전제 조건 (절대 수행 금지)

```text
코드 수정 금지
index.html 수정 금지
js/firebase-shared.js 수정 금지
firestore.rules 수정 금지
Rules 배포 금지
users/orders 데이터 수정 금지
Reset Data 금지
Google Login UI 구현 금지
Firebase Console Rules 수정 금지
```

## 4. 허용 작업 (본 작업 범위)

```text
문서 작성
Firebase Console에서 확인해야 할 절차 정리
Google Provider 활성화 전 체크리스트 작성
Authorized domains 확인 항목 작성
Google 계정 배정표 작성
Firebase UID 수집 절차 작성
users/{uid} 문서 생성 전 체크리스트 작성
B1 Green 판정 기준 작성
HARNESS 의도DB 동시 저장
```

---

## 7.1 Google Provider 활성화 전 확인사항 (체크리스트)

| # | 확인 항목 | 확인값 / 메모 | 상태 |
|---|---|---|---|
| 1 | Firebase 프로젝트명 확인 | `yongjin-enterprise` (`firebase-shared.js:11` projectId) | 확인 필요(Gene) |
| 2 | 현재 운영 사이트 도메인 확인 | GitHub Pages `kimjinman3187-dot.github.io` 추정 | 확인 필요 |
| 3 | 현재 Auth 방식 확인 | Anonymous Auth (`firebase-shared.js:29-38`) | ✅ 확인됨 |
| 4 | 기존 Anonymous Auth 사용 여부 | 사용 중 (`signInAnonymously`) | ✅ 확인됨 |
| 5 | **PIN Login은 즉시 제거하지 않는다** | 전환 기간 병행, factory 보조 잠금으로 격하 예정 | 명시 |
| 6 | **Google Provider 활성화 ≠ 즉시 코드 변경** | Provider 활성화는 Console 설정일 뿐, 코드 무변경 | 명시 |
| 7 | **Provider 활성화 후에도 Google Login UI 구현은 별도 작업** | WORK22-6N-F(설계) → 이후 구현 | 명시 |

> 핵심: 본 단계에서 Provider를 **활성화하지 않는다.** 활성화 시 확인할 항목을 정리만 한다. 실제 활성화는 §B1 Green 절차에서 Gene 승인 후 수행.

---

## 7.2 Authorized domains 확인 항목

Firebase Console > Authentication > Settings > Authorized domains 에서 확인:

| # | 항목 | 확인 포인트 | 상태 |
|---|---|---|---|
| 1 | `localhost` 포함 여부 | 로컬 테스트용 | 확인 필요 |
| 2 | Firebase Hosting 기본 도메인 | `yongjin-enterprise.firebaseapp.com`, `yongjin-enterprise.web.app` | 확인 필요 |
| 3 | 현재 운영 배포 도메인 | 실제 서비스 URL | 확인 필요 |
| 4 | GitHub Pages 등 배포 도메인 | `kimjinman3187-dot.github.io` 사용 여부 | 확인 필요 |
| 5 | 테스트/운영 환경 도메인 구분 필요 여부 | 분리 정책 결정 | 확인 필요 |

> Google Login 팝업/리디렉션은 Authorized domains에 없는 출처에서 실패한다. 활성화 전 반드시 운영·테스트 도메인 등록 여부를 확인해야 한다.

---

## 7.3 테스트 Google 계정 목록

| 구분 | 이름 | 역할 | Google Email | 사용 목적 | 비고 |
|---|---|---|---|---|---|
| 관리자 테스트 | gene kim | admin | 미정 | 관리자 로그인 테스트 | UID 확보 필요 |
| 관리자 테스트 | 윤정원 | admin | 미정 | 관리자 로그인 테스트 | UID 확보 필요 |
| 영업 테스트 | 영업 | sales | 미정 | 영업 권한 테스트 | UID 확보 필요 |
| 회계 테스트 | 회계1 | accounting | 미정 | 회계 권한 테스트 | UID 확보 필요 |
| 회계 테스트 | 회계2 | accounting | 미정 | 회계 권한 테스트 | role 오타 수정 필요 |
| 공장 테스트 | 공장 | factory | 미정 | 모바일 현장 테스트 | PIN 보조 잠금 검토 |
| (추가 권장) 정지 테스트 | suspended 테스트 | sales | 미정 | status=suspended 차단 검증 | Emulator/회귀용 |

> 마지막 행(suspended 테스트)은 6N-E/6N-B 회귀 테스트 fixture와 정합을 위해 추가 권장. 운영 계정이 아닌 테스트 전용.

---

## 7.4 legacyUserId별 Google Email 배정표

현재 확인된 운영 users 컬렉션(6N-G0 실데이터):

| legacyUserId | name | role | status | 현재 문제 |
|---|---|---|---|---|
| emp_admin | 윤정원 | admin | active | email 없음 / auth_uid 없음 |
| admin_gene | gene kim | admin | active | email 없음 / auth_uid 없음 |
| 김상경 | 영업 | sales | active | 한글 문서 ID / email 없음 / auth_uid 없음 |
| emp_factory | 공장 | factory | active | email 없음 / auth_uid 없음 |
| emp_acc1 | 회계1 | accounting | active | email 없음 / auth_uid 없음 |
| emp_acc2 | 회계2 | ccounting | active | role 오타 / email 없음 / auth_uid 없음 |

배정표:

| legacyUserId | name | 현재 role | 수정 필요 role | 배정 Google Email | Firebase UID | status | 비고 |
|---|---|---|---|---|---|---|---|
| emp_admin | 윤정원 | admin | admin | 미정 | 미생성 | active | 관리자 |
| admin_gene | gene kim | admin | admin | 미정 | 미생성 | active | 관리자 |
| 김상경 | 영업 | sales | sales | 미정 | 미생성 | active | 한글 ID 유지 여부 검토 |
| emp_factory | 공장 | factory | factory | 미정 | 미생성 | active | 모바일 PIN 보조 잠금 대상 |
| emp_acc1 | 회계1 | accounting | accounting | 미정 | 미생성 | active | 회계 |
| emp_acc2 | 회계2 | ccounting | accounting | 미정 | 미생성 | active | role 오타 수정 필요 |

---

## 7.5 Firebase UID 확인 절차

Google Provider 활성화 후 UID 확보 절차:

```text
1. Firebase Console 접속
2. Authentication 메뉴 진입
3. Sign-in method에서 Google Provider 활성화
4. Authorized domains 확인
5. 테스트 Google 계정으로 1회 로그인
6. Authentication > Users 메뉴에서 신규 사용자 생성 여부 확인
7. 사용자별 UID 복사
8. legacyUserId별 Google Email 배정표에 UID 기록
9. UID와 Email이 맞는지 2인 검증
10. users/{uid} 문서 생성 전 Gene 승인 요청
```

주의사항:

```text
UID 확보는 users 데이터 수정이 아니다.
users/{uid} 문서 생성은 다음 작업(G2)에서 별도 승인 후 진행한다.
```

---

## 7.6 users/{uid} 문서 생성 전 체크리스트

- [ ] 직원별 Google Email 확정 여부
- [ ] Firebase UID 확보 여부
- [ ] 기존 legacyUserId와 UID 매칭 여부
- [ ] role 값 정상 여부
- [ ] emp_acc2 role 오타(`ccounting`→`accounting`) 수정 필요 여부
- [ ] 기존 PIN 유지 범위 확인 여부
- [ ] factory 모바일 잠금 정책 확인 여부
- [ ] admin 계정 2개 운영 필요성 확인 여부
- [ ] sales 한글 문서 ID(`김상경`) 이전 방식 검토 여부
- [ ] users/{uid} 문서 생성 방식 확정 여부
- [ ] 기존 users 문서 보존/마이그레이션/비활성화 기준 확인 여부
- [ ] Firestore Rules 배포 전 시뮬레이션 필요 여부

---

## 7.7 B1 Green 판정 기준

B1 Green 조건:

```text
1. Google Provider 활성화 완료
2. Authorized domains 확인 완료
3. 직원별 Google Email 배정 완료
4. 테스트 Google 계정 1회 로그인 완료
5. Firebase UID 확보 완료
6. legacyUserId ↔ Google Email ↔ Firebase UID 매핑표 작성 완료
7. role 오타 및 운영 리스크 목록화 완료
8. users/{uid} 생성 전 체크리스트 완료
9. Gene 승인 완료
```

B1 Green이 되기 전 금지:

```text
Google Login 코드 구현 금지
Firestore Rules 운영 배포 금지
Firebase Console Rules 수정 금지
users/orders 데이터 수정 금지
```

---

## 7.8 금지사항

```text
- 코드 수정 금지
- Firebase Rules 수정 금지
- Firestore Rules 배포 금지
- users/orders 데이터 수정 금지
- Reset Data 금지
- Google Login UI 구현 금지
- PIN Login 제거 금지
- 기존 운영 계정 삭제 금지
- 기존 users 문서 삭제 금지
- Delete branch 금지
```

---

## 7.9 다음 작업 WORK22-6N-G2 제안

```text
WORK22-6N-G2 — Google Email / Firebase UID 매핑표 확정 및 users/{uid} 생성 설계
```

목적:

```text
G1에서 확보한 Google Email과 Firebase UID를 기준으로,
기존 legacy users 문서를 users/{uid} 구조로 전환하기 위한 생성 방식,
보존 방식, 마이그레이션 기준, rollback 기준을 설계한다.
```

G2에서는 아직 코드 구현이 아니라 `users/{uid}` 전환 설계와 승인 기준만 작성한다.

---

## 8. 보고 형식

```text
1. 생성 파일
- repo/docs/work22-6n-g1-google-provider-uid-procedure.md
2. 의도DB 저장 파일
- C:\Users\kimji\Desktop\HARNESS_ENGINEERING\OPERATIONS\1_프로젝트관리\용진FLOW\09_GIT_REPO_의도DB\2026-06-09_WORK22-6N-G1_GoogleProvider_UID생성절차.md
3. B1 Green 전환 가능 여부 (가능 / 불가 / 조건부 가능) + 사유
4. Google Provider 활성화 전 필요한 Gene 승인 항목
5. 다음 작업 제안 — WORK22-6N-G2
```

## 9. 최종 판정 기준 (PASS)

```text
- repo/docs 문서 생성 완료
- HARNESS 의도DB 문서 생성 완료
- Google Provider 활성화 전 체크리스트 포함
- Authorized domains 확인 항목 포함
- 테스트 Google 계정 목록 포함
- legacyUserId별 Google Email 배정표 포함
- Firebase UID 확인 절차 포함
- users/{uid} 문서 생성 전 체크리스트 포함
- B1 Green 판정 기준 포함
- 금지사항 포함
- WORK22-6N-G2 제안 포함
```
