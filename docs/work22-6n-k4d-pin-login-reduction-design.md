# WORK22-6N-K4D — PIN Login 제거/축소 설계

기준일: 2026-06-11
작업 성격: **설계 문서** (코드/Rules/데이터 변경 없음)
기준 커밋: `origin/main = 2c7ade9` (PR #74 merged 포함)
선행: K4B(PR #72), K4C(PR #73), K4A(PR #74)

## 1. 작업 개요

PIN Login을 즉시 전면 제거하지 않고, **PC PIN을 우선 제거/숨김**하여 PC를 Google Login 전용으로 전환하고, **factory 모바일 PIN fallback만 제한적으로 유지**하는 단계 전환을 설계한다(K4A 권장안 계승). 구현은 하지 않는다.

## 2. 현재 PIN Login 구조

```text
[loginMobile]  roleGrid(PIN 사용자 버튼) + keypadArea           ← 모바일, Google 버튼 없음
[loginPC]      pcRoleGrid + pcKeypadArea + pcAdminBypassBtn(dev) + "Google로 로그인" 버튼
공유 로직      chooseUser(uid) / kp / kpDel / tryLogin / checkLockoutStatus
사용자 목록    syncUsers() → users 전체 read → roleGrid·pcRoleGrid 렌더
부트스트랩     startAnonymousPinBootstrap → signInAnonymously → syncUsers
```

## 3. PC PIN 경로 조사 결과

| 요소 | 위치 | 비고 |
|---|---|---|
| PC PIN 그리드 | `index.html:146` `pcRoleGrid` | PIN 사용자 버튼(`pc-rsb-{id}`) |
| PC 키패드 | `index.html:150` `pcKeypadArea` | |
| PC dev bypass | `index.html:143` `pcAdminBypassBtn` → `pcAdminBypassLogin()`(1915) | AUTH_DEV_MODE 전용 |
| PC Google 버튼 | `index.html:157` `loginWithGoogle()` | **PC는 이미 Google 경로 보유** |

→ PC는 Google 버튼이 이미 있으므로 **pcRoleGrid/pcKeypadarea/pcAdminBypass를 숨기면 즉시 Google 전용 전환 가능**.

## 4. 모바일/factory PIN 경로 조사 결과

| 요소 | 위치 | 비고 |
|---|---|---|
| 모바일 PIN 그리드 | `index.html:103` `roleGrid` | `rsb-{id}` 버튼, **현재 전체 role 노출** |
| 모바일 키패드 | `index.html:107` `keypadArea` | |
| 모바일 Google 버튼 | 없음 | factory 모바일 = PIN 전용(K4A) |

→ factory 모바일 PIN 유지는 `roleGrid`+`keypadArea`+공유 로직 보존을 의미. 단 현재 roleGrid가 전체 사용자를 노출하므로, 제한 유지 시 **factory role만 노출하도록 좁히는 설계** 필요.

## 5. Google Login 경로 영향 분석

- `chooseUser`(1885)는 `rsb-`(모바일)·`pc-rsb-`(PC) 버튼을 **공유 토글**, `kp/tryLogin`(1886/1890)도 공유.
- **PC PIN UI(pcRoleGrid/pcKeypadArea) 숨김은 Google 경로에 영향 없음**: `loginWithGoogle()`·`onAuthStateChanged`·`loadCurrentUserFromAuthUser`는 PIN UI와 독립.
- 공유 함수(chooseUser/tryLogin)는 모바일 factory가 계속 쓰므로 **삭제가 아니라 PC측 진입 UI만 비표시**가 안전.

**결론: PC PIN 숨김은 Google Login 무영향. 단 공유 PIN 함수는 factory 모바일 위해 보존.**

## 6. users 전체 read / sessionStorage / Anonymous Auth 의존성 분석

| 의존 | 발생 위치 | PC PIN 제거 후 | factory PIN 유지 시 |
|---|---|---|---|
| users 전체 read | `syncUsers()` → roleGrid/pcRoleGrid | pcRoleGrid 미사용이나 roleGrid 위해 **잔존** | 잔존(roleGrid). factory role로 **축소 가능** |
| sessionStorage.yongjin_session set | `index.html:1907`(PIN), 1923(dev) | PC PIN 미사용 시 PC 경로 비활성, 함수는 잔존 | factory PIN 성공 시 set **잔존** |
| PIN 복원 | `index.html:3461` | Google이면 3459 early-return(무영향) | factory PIN 새로고침 복원 위해 **잔존** |
| Anonymous Auth | `startAnonymousPinBootstrap`→`syncUsers` | roleGrid 표시 위해 **잔존** | factory 목록 read 위해 **잔존** |

→ **factory 모바일 PIN을 남기는 한 세 의존(users read/sessionStorage/Anonymous)은 모두 잔존**한다. PC PIN만 제거해도 이들은 사라지지 않음(roleGrid가 모바일에 남기 때문). 완전 제거는 factory가 Google(C안)로 이행한 뒤(K4E).

## 7. 정책 선택지 A/B/C/D 비교

| 기준 | A(전체 즉시 제거) | B(PC 제거+factory 제한 유지) | C(전체 유지) | D(PC dev-only+factory 제한) |
|---|---|---|---|---|
| PC Google 전용 | ✅ | ✅ | ❌ | ✅(운영) |
| factory 현장 연속성 | ❌ 위험 | ✅ | ✅ | ✅ |
| users read 제거 | ✅ | 지연 | ❌ | 지연 |
| sessionStorage 제거 | ✅ | 지연 | ❌ | 지연 |
| Anonymous 제거 | ✅ | 지연 | ❌ | 지연 |
| rollback 수단 | 약함 | 중간 | 강함 | **강함(dev-only)** |
| 보안 | 강함 | 중간 | 약함 | 중간(dev 경로 관리) |

- **A안**: factory Gmail/UID 미수집 상태에서 현장 로그인 불가 위험 → 현 시점 부적합.
- **B안**: PC Google 정리 + factory 연속성 + K4E/K4F 단계화 가능. factory 영역 의존 잔존.
- **C안**: 병목 고착.
- **D안**: B안 + PC PIN을 dev-only 숨김으로 남겨 비상 rollback 확보. dev 경로 관리 부담.

## 8. 권장안 — 기본 B안 (보조: D안)

**기본 권장: B안 — PC PIN 제거 + factory 모바일 PIN 제한 유지.**
(전환 안정화 기간에는 **D안**으로 PC PIN을 dev-only 숨김 유지해 rollback 수단 확보 후, 안정 확인 시 완전 제거)

1. **선택 이유:** PC는 Google 버튼이 이미 있어 즉시 전용 전환 가능. factory는 Gmail/UID 미수집이라 PIN 연속성 필요. B안이 현장 충격 없이 admin/sales/accounting을 Google로 정리.
2. **PC 운영 영향:** pcRoleGrid/pcKeypadArea/pcAdminBypass 숨김 → PC는 Google 전용. admin/sales/accounting는 Google 로그인만.
3. **factory 모바일 운영 영향:** roleGrid를 factory role로 축소(권장)하여 제한 PIN 유지. 현장 진입 연속.
4. **보안 리스크:** factory PIN 평문 노출(B3)·sessionStorage 권한 source 잔존. D안 dev-only 경로 노출 관리.
5. **UX 리스크:** PC 사용자 Google 적응. factory는 현행 유지라 마찰 최소.
6. **K4E(Anonymous 제거) 가능?:** **부분 보류** — factory roleGrid가 Anonymous bootstrap에 의존 → factory C안 이행 후 가능.
7. **K4F(Rules UID 전환) 가능?:** **단계 가능** — admin/sales/accounting UID 우선 전환, factory는 C안 계정 확정까지 예외.
8. **rollback 기준:** §14.
9. **구현 전 체크리스트:** 아래 §9 K4D-9 인접.

## 9. 제거/축소 단계 설계 (K4D-1 ~ K4D-9)

```text
K4D-1: PC PIN 표시 경로 전수조사 → 완료(§3): pcRoleGrid(146)/pcKeypadArea(150)/pcAdminBypassBtn(143)
K4D-2: PC PIN 제거 또는 숨김 설계 → loginPC에서 pcRoleGrid/pcKeypadArea 비표시,
        pcAdminBypass는 dev-only 유지(D안) 또는 제거(B안). 공유 함수는 보존.
K4D-3: Google 전용 PC 진입 구조 확인 → loginWithGoogle()만 노출, onAuthStateChanged 복원 확인
K4D-4: factory 모바일 PIN fallback 제한 유지 → roleGrid를 factory role로 축소, keypad 유지
K4D-5: PIN sessionStorage 경로 분리 → set(1907)/복원(3461)은 factory 전용 구간으로 가드
K4D-6: Anonymous Auth 잔존 범위 분리 → factory 목록 read 한정으로 축소 표시
K4D-7: factory 기기/공용 Google 계정 전환 조건 정의 → users/{uid}(role=factory) 발급(K4G 후보)
K4D-8: K4E/K4F 진입 조건 작성 → §10
K4D-9: rollback 기준 작성 → §14
```

### 구현 전 체크리스트 (구현은 별도 승인)
- [ ] PC에서 Google 로그인만으로 admin/sales/accounting 진입 확인
- [ ] PC PIN UI 숨김 후 Google 경로 무영향 확인
- [ ] factory 모바일 roleGrid가 factory만 노출하도록 축소 가능 확인
- [ ] factory PIN 성공/복원/잠금 경로 정상 확인
- [ ] dev-only(pcAdminBypass) 노출 조건(AUTH_DEV_MODE) 확인
- [ ] users read 축소 시 PIN 목록 영향 확인

## 10. K4E/K4F 선행 조건

```text
K4E (Anonymous Auth 제거):
- 선행: factory가 C안(기기/공용 Google 계정)로 이행 → roleGrid/Anonymous bootstrap 불요
K4F (Rules UID 전환):
- admin/sales/accounting: 즉시 UID 기반 가능
- factory: C안 계정 UID 확정까지 예외 규칙 임시 운용
K4G 후보:
- factory 기기/공용 Google 계정 등록 + users/{uid}(role=factory) 생성
```

## 11. 운영 리스크
- PC 사용자 Google 미숙지로 초기 진입 지연
- factory roleGrid 축소 시 누락 표시 위험
- factory users/{uid} 미발급 시 C안 이행 지연 → 의존 잔존 장기화

## 12. 보안 리스크
- factory PIN 평문 노출(B3) 전환기 지속
- sessionStorage 권한 source(factory) 잔존
- D안 dev-only 경로 오노출 시 우회 로그인 위험
- Anonymous Auth 잔존 구간 Rules 신뢰 한계

## 13. UX 리스크
- PC Google 팝업/도메인 실패 가능성
- factory 모바일 PIN→Google 전환 시 현장 적응
- 전환기 PC/모바일 경로 상이로 혼선

## 14. rollback 설계
- **D안 우선 채택 권장**: PC PIN을 즉시 삭제하지 않고 dev-only 숨김으로 남겨, 문제 시 PC PIN 즉시 복귀.
- PC PIN 숨김·factory roleGrid 축소·sessionStorage 가드를 **분리 커밋**해 단계별 revert.
- factory PIN 경로(roleGrid/keypad/set 1907/복원 3461)는 C안 안정화 확인 전 보존.
- Anonymous bootstrap은 factory C안 이행 확인 후에만 제거(K4E).
- 각 단계 Google/PIN 양 경로 회귀 테스트. 실패 시 revert(브랜치 보존, Delete Branch 금지).

## 15. 금지사항 준수 확인
```text
코드 변경 없음 / Rules 변경 없음 / users·orders 데이터 변경 없음 / Reset Data 미사용
main 직접 수정 없음 / Delete Branch 없음 / K4A·K4B·K4C 브랜치 재사용 없음(신규 브랜치)
K3D hotfix 브랜치 미접촉 / PIN 제거 구현 안 함 / 최종 PASS 선언 안 함
```

## 16. PASS 기준
```text
origin/main 최신(2c7ade9) 기준 / PR #74 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
PC PIN·모바일/factory PIN 경로 조사 완료 / Google 경로 영향 분석 완료
users read·sessionStorage·Anonymous 의존성 정리 완료 / 선택지 A/B/C/D 비교 완료
권장안 제시 완료 / K4E·K4F 선행 조건 정리 완료 / rollback 포함 / 코드·Rules·데이터 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.

## 부록. §7 핵심 질문 답
1. PC PIN 표시: `loginPC`의 `pcRoleGrid`(146)+`pcKeypadArea`(150)
2. 모바일 PIN 표시: `loginMobile`의 `roleGrid`(103)+`keypadArea`(107)
3. roleGrid=모바일 게이트, pcRoleGrid=PC 게이트
4. chooseUser/kp/tryLogin은 **PC·모바일 공유**(1885-1890)
5. tryLogin 성공: users.doc(id).update(attempts/lockout 리셋) + currentUser 설정 + sessionStorage set + logAction + processLoginSuccess
6. sessionStorage set: `index.html:1907`(PIN), 1923(dev bypass)
7. PIN 복원: `index.html:3461`(Google이면 3459 early-return)
8. Anonymous 시작: `startAnonymousPinBootstrap`(onload, Google 아님일 때) → syncUsers
9. PC PIN 제거 Google 영향: **없음**(Google 버튼/파이프라인 독립). 단 공유 함수는 보존
10. factory만 PIN 유지 시: users read/sessionStorage/Anonymous **모두 잔존**(roleGrid 때문), factory role로 축소만 가능
11. K4E 선행: factory C안(기기 Google 계정) 이행 + users/{uid}(factory) 발급
12. K4F PIN 예외: admin/sales/accounting UID 우선, factory는 C안 확정까지 Rules 예외 임시 운용
