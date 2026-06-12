# WORK22-6N-K4A — factory 모바일 Google/PIN 운영 정책 분리 설계

기준일: 2026-06-11
작업 성격: **운영 정책 설계 문서** (코드/Rules/데이터 변경 없음)
기준 커밋: `origin/main = 2af283b` (PR #73 merged 포함)
선행: K4B(users 전체 read 제거, PR #72), K4C(sessionStorage 제거, PR #73)

## 1. 작업 개요

PIN/sessionStorage/Anonymous Auth 축소의 핵심 보류 조건은 **factory 모바일 정책 미확정**이다(K4C 결론). 본 문서는 factory 모바일 사용자의 로그인 운영 정책을 ① factory도 Google 전환, ② factory 모바일만 PIN fallback 유지, ③ factory 전용/공용 Google 계정, ④ 현행 유지 중 어느 방향으로 정할지 분리 설계하고 권장안을 제시한다.

## 2. 현재 factory 모바일 로그인 구조

```text
[모바일 로그인 게이트(loginMobile)]  PIN 그리드(roleGrid) + 키패드  ← Google 버튼 없음
[PC 로그인 게이트(loginPC)]         PIN 그리드(pcRoleGrid) + 키패드 + "Google로 로그인" 버튼
```

- **Google 로그인 버튼(`loginWithGoogle()`)은 `loginPC`에만 존재**(`index.html:157`). `loginMobile`(`index.html:99~`)에는 PIN 그리드/키패드만 있다.
- 따라서 **factory를 포함한 모바일 사용자는 현재 PIN 로그인만 가능**하다.
- factory 권한: `ACCESS_MATRIX.factory` = view[live, production, history], write[production]. `ROLE_TABS.factory`=['factory','history'].
- 단, Google 인증 파이프라인(`onAuthStateChanged` → `startGoogleAuthStateRestore` → `loadCurrentUserFromAuthUser` → `users/{uid}`)은 **뷰포트와 무관**하게 동작한다. 즉 모바일 게이트에 Google 버튼을 추가하면 기술적으로 factory 모바일 Google 로그인이 가능하다.

## 3. factory 관련 코드 조사 결과

| 항목 | 위치 | 내용 |
|---|---|---|
| 모바일 PIN 게이트 | `index.html:99` `loginMobile` / `roleGrid` | PIN 그리드만 |
| PC Google 버튼 | `index.html:157` `loginWithGoogle()` | PC 전용 |
| factory 권한 | `ACCESS_MATRIX.factory` | view/write production 중심 |
| factory orders 쿼리 | `index.html:2240` | `where status in [approved,completed]` (role==='factory') |
| 모바일/PC 분기 | `window.innerWidth > 768` | 768 이하 = 모바일 게이트 |
| PIN set | `index.html:1907` | PIN 성공 시 sessionStorage.yongjin_session |
| 익명 부트스트랩 | `startAnonymousPinBootstrap` → `syncUsers` | PIN 목록(roleGrid) 위한 users 전체 read |
| dev fallback | `index.html:882` `factory-local` | AUTH_DEV_MODE 전용 |

## 4. Google Login 전환 가능성

- **기술적으로 가능**: Google 인증 파이프라인은 뷰포트 무관. 모바일 게이트에 Google 버튼을 추가하고 `users/{uid}`에 factory role 문서가 있으면 factory 모바일 Google 로그인 동작.
- 전제: factory 직원의 Gmail 확보 + Firebase UID 생성 + `users/{uid}` 문서(role=factory) 생성(K4B/G 계열, 아직 미수집 — 6N-G0에서 factory `emp_factory`의 email/auth_uid 공백 확인).
- 현 시점 미충족: factory 직원 Gmail/UID 미수집.

## 5. PIN fallback 유지 필요성

- 공장 현장: 공용 단말/교대 근무/장갑 착용/오프라인 우려 등으로 개인 Google 로그인 마찰 가능성.
- PIN은 빠른 현장 진입에 유리. 단 PIN은 클라이언트 평문 노출(B3) + 권한 source가 sessionStorage라는 한계.
- 즉 "현장 UX" 대 "보안 일원화"의 trade-off가 factory에 집중된다.

## 6. users 전체 read / sessionStorage / Anonymous Auth 의존성

PIN(=factory 모바일) 경로를 유지하면 아래가 **함께 잔존**한다:

| 의존 | 이유 |
|---|---|
| users 전체 read (`syncUsers`) | PIN 사용자 목록(roleGrid) 렌더 |
| sessionStorage.yongjin_session | PIN 성공 set(1907) + 새로고침 복원(3461) |
| Anonymous Auth | PIN 목록 read 전 부트스트랩(`startAnonymousPinBootstrap`) |

→ **factory PIN을 남기면 K4B(users read 제거)·K4C(sessionStorage 제거)·K4E(Anonymous 제거)가 factory 예외로 인해 완결 불가.** 이것이 factory 정책이 전체 전환의 병목인 이유.

## 7. 정책 선택지 A/B/C/D 비교

### A안 — factory도 Google Login 전환
- 장점: 보안 구조 단순화, Rules UID 전환 용이, users 전체 read/sessionStorage/Anonymous 제거 가능, 권한 source 일원화.
- 리스크: 현장 직원 Gmail/UID 수집 필요, 모바일 로그인 UX 마찰, 공용기기 계정 관리 문제.

### B안 — factory 모바일만 PIN fallback 유지
- 장점: 현장 전환 마찰 최소, 공장 모바일 운영 연속성.
- 리스크: sessionStorage.yongjin_session 잔존, Anonymous Auth 잔존, users 전체 read 제거 지연, Rules UID 전환 지연.

### C안 — factory 전용/기기별 Google 계정(공용 계정)
- 장점: UID 기반 전환 가능, PIN 제거 가능, 개인 Gmail 수집 부담 감소.
- 리스크: 공용 계정 보안 관리, 퇴사자/교대자 추적성 저하, 감사로그 개인 식별 약화.

### D안 — 현행 유지(factory PIN 유지)
- 장점: 운영 충격 없음.
- 리스크: Auth 전환 병목 고착, users 전체 read/sessionStorage/Rules UID 전환 모두 불가.

| 기준 | A | B | C | D |
|---|---|---|---|---|
| users 전체 read 제거 | ✅ | ❌ | ✅ | ❌ |
| sessionStorage 제거 | ✅ | ❌ | ✅ | ❌ |
| Anonymous 제거 | ✅ | ❌ | ✅ | ❌ |
| Rules UID 전환 | ✅ | 지연 | ✅ | ❌ |
| 현장 UX 마찰 | 높음 | 낮음 | 중간 | 없음 |
| 감사 추적성 | 높음 | 중간 | 낮음 | 중간 |
| 계정 수집 부담 | 높음 | 없음 | 낮음 | 없음 |

## 8. 권장안 — 권장안 3(factory 모바일 제한적 PIN fallback 유지 후 단계적 제거), 종착지 C안

**구조:** 즉시 전면 전환(A) 대신, 전환기에는 factory 모바일만 제한적 PIN fallback을 유지하고, 병행해 **factory 기기/공용 Google 계정(C안)** 을 도입하여 단계적으로 PIN을 제거한다.

1. **선택 이유:** factory 직원 개인 Gmail/UID 미수집(6N-G0 확인) 상태에서 A안 전면 전환은 현장 마찰·계정 공백 위험. C안 기기별 Google 계정은 개인 수집 부담 없이 UID 기반 전환을 가능케 함. 전환기 PIN 유지로 운영 연속성 확보.
2. **운영 리스크:** 전환기 동안 PIN 경로(users read/sessionStorage/Anonymous) 잔존 → 전체 제거 지연. 공용 Google 계정의 단말 관리 필요.
3. **보안 리스크:** PIN 평문 노출(B3) 전환기 지속. 공용 계정 비밀번호/세션 관리, 퇴사자 회수 절차 필요.
4. **UX 리스크:** factory 현장은 기기 고정 Google 세션으로 로그인 마찰 최소화 가능. PC PIN은 즉시 제거 가능(현장 무관).
5. **K4D 진입:** **부분 가능** — "PC PIN 제거 + factory 제한 PIN 유지"로 K4D 설계 진행 가능.
6. **K4E(Anonymous 제거):** **부분 보류** — factory PIN 유지 구간 동안 Anonymous bootstrap 잔존. factory가 C안으로 완전 이행한 뒤 제거.
7. **K4F(Rules UID 전환):** **단계 가능** — admin/sales/accounting은 UID 기반 우선 적용, factory는 C안 계정 UID 확정 후 포함(예외 규칙 임시 운용).
8. **rollback 기준:** §13.

> 대안: factory 직원 개인 Gmail 수집이 현실적으로 빠르게 가능하면 **A안**으로 직행이 가장 깔끔(병목 즉시 해소). 수집이 어려우면 본 권장안(3→C).

## 9. K4D/K4E/K4F 선행 조건

```text
권장안(3→C) 채택 시:
- K4D: PC PIN 제거 + factory 제한 PIN 유지로 설계 진행 가능
- K4E: factory C안(기기 Google 계정) 이행 완료 후 Anonymous 제거
- K4F: admin/sales/accounting UID 우선 전환 + factory 예외 → C안 완료 후 factory 포함
선행 데이터 조건:
- factory 기기/공용 Google 계정 발급 + users/{uid}(role=factory) 생성
- (또는 A안 시) factory 직원 개인 Gmail/UID 수집
```

## 10. 운영 리스크
- factory 기기 Google 세션 만료/로그아웃 시 현장 진입 지연
- 공용 계정 단말 분실/공유 관리
- 전환기 PIN·Google 이중 경로의 혼선
- factory users/{uid} 문서 누락 시 로그인 실패

## 11. 보안 리스크
- PIN 평문 클라이언트 노출(B3) 전환기 지속
- 공용 Google 계정의 개인 식별·감사 추적성 저하
- 퇴사자/교대자 계정 회수 미흡 시 무단 접근
- Anonymous Auth 잔존 구간의 Rules 신뢰 한계

## 12. UX 리스크
- 개인 Gmail 강제(A안) 시 현장 직원 거부감
- 모바일 Google 팝업/리디렉션 실패(네트워크/도메인) 가능성
- 장갑/오프라인 등 현장 환경 제약

## 13. rollback 설계
- 전환은 **PC PIN 제거 → factory 제한 PIN 유지 → factory C안 도입 → factory PIN 제거** 순으로 단계화하고, 각 단계는 직전 상태로 revert 가능하게 분리 커밋.
- factory PIN 경로(set 1907/복원 3461/roleGrid)는 C안 안정화 확인 전까지 보존 → 문제 시 즉시 PIN 복귀.
- Anonymous bootstrap은 factory 완전 이행 확인 후에만 제거(K4E).
- 모든 단계 Google/PIN 양 경로 회귀 테스트. 실패 시 revert(브랜치 보존, Delete Branch 금지).

## 14. 금지사항 준수 확인
```text
코드 변경 없음 / Rules 변경 없음 / users·orders 데이터 변경 없음
Reset Data 미사용 / main 직접 수정 없음 / Delete Branch 없음
K4B·K4C 브랜치 재사용 없음(신규 브랜치) / K3D hotfix 브랜치 미접촉 / 최종 PASS 선언 안 함
```

## 15. PASS 기준
```text
origin/main 최신(2af283b) 기준 / PR #73 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
factory 모바일 로그인 구조 조사 완료(PC 전용 Google 버튼·모바일 PIN 전용 확인)
Google 전환 가능성·PIN fallback 필요성·의존성(users read/sessionStorage/Anonymous) 정리 완료
선택지 A/B/C/D 비교 완료 / 권장안 제시 완료 / K4D·K4E·K4F 선행 조건 정리 완료 / rollback 포함
코드·Rules·데이터 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.

## 부록. §7 핵심 질문 답
1. factory 현재 경로: **PIN(모바일 게이트는 PIN 전용, Google 버튼은 PC만)**
2. Google만으로 운영 가능?: 파이프라인은 가능하나 **모바일 Google 버튼 추가 + factory users/{uid} 필요**
3. Gmail/UID 확보 현실성: 개인 수집은 부담 → **C안(기기/공용 계정)이 현실적**
4. PIN fallback 필요 상황: 공용단말·교대·현장 제약·계정 공백 시
5. PIN 유지 시 의존 잔존?: **users 전체 read + sessionStorage + Anonymous 모두 잔존**
6. factory만 PIN 유지 시 PC PIN 제거 충돌?: **충돌 없음**(PC PIN은 독립 제거 가능)
7. factory PIN 보안 리스크: 평문 노출(B3), sessionStorage 권한 source
8. Google 전환 UX 리스크: 개인 Gmail 거부감, 모바일 팝업 실패, 현장 제약
9. K4D 선행: factory 정책 확정이 PIN 제거 범위(PC만/전체)를 결정
10. 정책 확정 전 제거 금지 코드: `loginMobile` PIN 그리드/`roleGrid`, `syncUsers`(users read), `startAnonymousPinBootstrap`, sessionStorage set(1907)/복원(3461)
