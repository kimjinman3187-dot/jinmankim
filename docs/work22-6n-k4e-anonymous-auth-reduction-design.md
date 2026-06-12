# WORK22-6N-K4E — Anonymous Auth 제거/축소 설계

기준일: 2026-06-11
작업 성격: **설계 문서** (코드/Rules/데이터 변경 없음)
기준 커밋: `origin/main = c6c3ed3` (PR #75 merged 포함)
선행: K4B(#72), K4C(#73), K4A(#74), K4D(#75)

## 1. 작업 개요

Anonymous Auth를 즉시 전면 제거하지 않고, **Google/PC 경로는 Anonymous 비사용으로 정리**하고 **factory 모바일 PIN fallback에만 Anonymous를 임시 예외로 격리**하는 분리 설계를 작성한다. 최종 목표는 factory 기기/공용 Google 계정 전환 후 완전 제거. 구현은 하지 않는다.

## 2. 현재 Anonymous Auth 구조

```text
onload → startGoogleAuthStateRestore() (onAuthStateChanged 등록)
onAuthStateChanged(authUser):
   ├─ isGoogleAuthUser(authUser)  → loadCurrentUserFromAuthUser (users/{uid})  ← Anonymous 미사용
   └─ 그 외(null/비-google)        → startAnonymousPinBootstrap()
                                       → signInAnonymously() → waitForFirebaseAndSyncUsers()
                                       → syncUsers()(users read) → roleGrid(PIN 목록)
```

## 3. Anonymous Auth 발생 위치 조사

| 요소 | 위치 | 내용 |
|---|---|---|
| `signInAnonymously` 정의 | `js/firebase-shared.js:29-38` | `auth.signInAnonymously()` |
| 호출 | `index.html:1765` | `startAnonymousPinBootstrap` 내부 |
| 부트스트랩 진입 | `index.html:1761` (가드 `anonymousPinBootstrapStarted` 1762) | 1회성 |
| 트리거 1 | `index.html:1740` | onload: `if(!startGoogleAuthStateRestore()) startAnonymousPinBootstrap()` (onAuthStateChanged 없을 때만) |
| 트리거 2 | `index.html:1797, 1801` | onAuthStateChanged 콜백에서 **비-Google이면** 부트스트랩 |
| 이후 read | `waitForFirebaseAndSyncUsers`(1747) → `syncUsers` | users read → roleGrid |
| 판별 | `isGoogleAuthUser`(1772) | `!isAnonymous && google provider` |

→ **Anonymous Auth는 "Google 사용자가 아닐 때"만 시작**된다. 즉 PIN 경로(factory 모바일 + 잔존 PC PIN) 전용.

## 4. Google Login 경로 영향 분석

- Google 로그인 시 `onAuthStateChanged`가 Google user를 받아 `loadCurrentUserFromAuthUser`로 진입 → **`startAnonymousPinBootstrap` 미호출**.
- `loginWithGoogle()`·`loadCurrentUserFromAuthUser`·currentUser·ACCESS_MATRIX·`yj:auth-ready` 어디에도 Anonymous 의존 없음.
- logout/login-fail의 signOut도 `!isAnonymous`(Google) 조건.

**결론: Google Login 경로는 Anonymous Auth에 의존하지 않는다.** (Q4 = 불필요)

## 5. PC 경로 Anonymous Auth 제거 가능성

- K4D로 PC PIN을 제거/숨김하면 PC 사용자는 Google 로그인만 사용 → onAuthStateChanged가 Google user → **Anonymous 미시작**.
- 즉 **PC Google 전용 경로에서는 Anonymous Auth 제거 가능**. (Q5 = 불필요)
- 단 startAnonymousPinBootstrap은 onAuthStateChanged의 "비-Google" 분기에 여전히 존재하므로, 비로그인 초기 상태에서 호출될 수 있다 → factory 예외와 함께 가드 설계 필요(§6/§8.2).

## 6. factory 모바일 PIN fallback 예외 분석

- factory 모바일은 Google 버튼이 없어(K4A) PIN으로 진입 → onAuthStateChanged가 비-Google → **Anonymous 시작** → users read → roleGrid → chooseUser/tryLogin.
- 즉 **factory 모바일 PIN fallback은 Anonymous Auth가 필요**하다(PIN 목록 read 컨텍스트). (Q6 = 필요)
- 따라서 Anonymous는 factory PIN 유지 구간 동안 **예외로 격리**해야 한다.

## 7. users read / syncUsers / roleGrid 영향 분석

- `syncUsers()`는 Anonymous(또는 인증된) 컨텍스트에서 users를 읽어 roleGrid/pcRoleGrid를 렌더.
- Anonymous 제거 → 인증 컨텍스트 없이 users read 불가(Rules상) → **roleGrid 표시 불가 → factory PIN 중단**.
- 따라서 Anonymous 제거는 **users 전체 read 제거(K4B)·roleGrid 제거(K4D factory)와 결합**되어 있다. (Q7/Q8: 강결합 — 셋이 함께 사라져야 함)
- 축소 방향: factory 유지 구간엔 roleGrid를 factory role로 좁히고 users read도 factory만으로 축소 → Anonymous 노출 범위 최소화.

## 8. sessionStorage.yongjin_session 영향 분석

- PIN 복원(`index.html:3461`)은 PIN 전용이며 Google이면 3459에서 early-return → **Anonymous 제거가 Google 복원과 충돌하지 않음**. (Q9 = 충돌 없음)
- factory PIN 새로고침 복원은 직전 PIN 로그인(Anonymous+users read 기반)에 의존 → factory 구간에서 sessionStorage와 Anonymous는 **동반 잔존**.

## 정책 선택지 A/B/C/D 비교

| 기준 | A(즉시 전면 제거) | B(PC/Google 제거+factory 예외) | C(전체 유지) | D(factory Google 선행 후 제거) |
|---|---|---|---|---|
| Google/PC 정리 | ✅ | ✅ | ❌ | ✅ |
| factory 현장 연속성 | ❌ 위험 | ✅ | ✅ | ✅ |
| users read 제거 | ✅ | 지연(factory) | ❌ | ✅ |
| sessionStorage 제거 | ✅ | 지연(factory) | ❌ | ✅ |
| Rules UID 전환 | ✅ | 단계 | ❌ | ✅ |
| 계정 선행 필요 | 없음 | 없음 | 없음 | factory Google 발급 |
| 보안 | 강함 | 중간 | 약함 | 강함 |

- **A안**: factory Gmail/UID 미수집 상태 → 현장 로그인 실패 위험. 부적합.
- **B안**: PC/Google 보안 정리 + factory 연속성 + K4F 단계화. factory 예외 잔존.
- **C안**: 병목 고착.
- **D안**: 최종 정리. factory 계정 발급 선행 필요.

## 10. 권장안 — 기본 B안 → 최종 D안

**기본 권장: B안** (PC/Google 경로 Anonymous 제거, factory PIN fallback에만 제한 유지)
**최종 목표: D안** (factory 기기/공용 Google 계정 전환 후 Anonymous 완전 제거)

1. **선택 이유:** Google/PC 경로는 이미 Anonymous 비의존(§4·§5)이라 즉시 정리 가능. factory만 PIN→Anonymous 의존이 남으므로 예외 격리. 계정 발급(D) 완료 시 완전 제거.
2. **Google Login 영향:** 없음(비의존).
3. **PC 운영 영향:** PC Google 전용 → Anonymous 미시작. 관리 경로 정리.
4. **factory 모바일 운영 영향:** Anonymous 예외 유지로 현장 PIN 연속. roleGrid factory 축소로 노출 최소화.
5. **보안 리스크:** factory 구간 Anonymous+users read+sessionStorage 잔존(B3). 익명 컨텍스트 Rules 신뢰 한계 지속.
6. **UX 리스크:** factory 현행 유지로 마찰 최소. PC는 Google 적응.
7. **Rules 전환 영향:** admin/sales/accounting UID 전환 가능, factory는 익명 uid라 예외 필요(§12).
8. **rollback 기준:** §16.
9. **구현 전 체크리스트:** §11 인접.

## 11. 제거/축소 단계 설계 (K4E-1 ~ K4E-9)

```text
K4E-1: Anonymous Auth 발생 위치 전수조사 → 완료(§3)
K4E-2: Google Login 경로 비의존성 확인 → 완료(§4)
K4E-3: PC Google 전용 경로 Anonymous 제거 가능성 설계 → §5 (PC PIN 제거 시 비시작)
K4E-4: factory 모바일 PIN fallback Anonymous 예외 유지 범위 설계 → §6 (factory만 격리)
K4E-5: syncUsers/roleGrid read 범위 축소 → factory role 한정 read + roleGrid factory만
K4E-6: sessionStorage.yongjin_session ↔ Anonymous 결합 지점 분리 → factory 전용 가드
K4E-7: factory 기기/공용 Google 계정 전환 후 완전 제거 조건 → users/{uid}(factory) 발급(K4G)
K4E-8: K4F Rules UID 전환 연결 조건 → §12
K4E-9: rollback 기준 → §16
```

### 구현 전 체크리스트 (구현은 별도 승인)
- [ ] Google 로그인 시 Anonymous 미시작 확인(onAuthStateChanged Google 분기)
- [ ] PC PIN 제거 후 PC에서 Anonymous 미시작 확인
- [ ] factory 모바일 PIN 진입 시에만 Anonymous 시작되도록 가드 확인
- [ ] roleGrid/users read를 factory role로 축소 가능 확인
- [ ] factory users/{uid}(role=factory) 발급 계획 확인
- [ ] Anonymous 제거 시 Rules factory 예외 정의 확인

## 12. K4F Rules UID 전환 선행 조건

```text
- admin/sales/accounting: 익명 미사용 → users/{uid} 기반 Rules 즉시 전환 가능
- factory: 익명 uid는 users/{uid} 없음 → Rules에서 factory PIN 구간 예외 임시 허용 필요
- 완전 전환 선행: factory 기기/공용 Google 계정 + users/{uid}(role=factory) 발급(K4G)
  → 이후 Anonymous 제거 + factory 예외 규칙 폐지
```

## 13. 운영 리스크
- factory users/{uid} 미발급 시 D안 지연 → Anonymous 장기 잔존
- roleGrid factory 축소 시 표시 누락
- 비로그인 초기 상태에서 Anonymous 시작 타이밍 관리 필요

## 14. 보안 리스크
- factory 구간 익명 컨텍스트 + users read + PIN 평문(B3) 잔존
- 익명 uid 기반 Rules 신뢰 불가 → factory 예외 동안 권한 강제 약함
- Anonymous 세션 누적/정리 정책 필요

## 15. UX 리스크
- PC Google 전환 적응
- factory 모바일 PIN→Google 전환 시 현장 적응
- 전환기 경로 이원화 혼선

## 16. rollback 설계
- Anonymous 제거는 **Google/PC 경로 한정**으로 먼저 적용하고 factory 예외는 유지 → 문제 시 factory PIN 즉시 동작.
- `startAnonymousPinBootstrap` 호출 가드(비-Google·factory)만 조정하고 함수 자체는 보존 → 토글 revert.
- factory users/{uid} 안정화 확인 전 Anonymous 완전 제거 금지.
- 각 단계 Google/factory PIN 회귀 테스트. 실패 시 revert(브랜치 보존, Delete Branch 금지).

## 17. 금지사항 준수 확인
```text
코드 변경 없음 / Rules 변경 없음 / users·orders 데이터 변경 없음 / Reset Data 미사용
main 직접 수정 없음 / Delete Branch 없음 / K4A·K4B·K4C·K4D 브랜치 재사용 없음(신규 브랜치)
K3D hotfix 브랜치 미접촉 / Anonymous·PIN 제거 구현 안 함 / 최종 PASS 선언 안 함
```

## 18. PASS 기준
```text
origin/main 최신(c6c3ed3) 기준 / PR #75 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
Anonymous 발생 위치 조사 완료 / Google·PC 경로 영향 분석 완료 / factory 예외 범위 분석 완료
syncUsers·roleGrid·sessionStorage 영향 분석 완료 / 선택지 A/B/C/D 비교 완료 / 권장안 제시 완료
K4F 선행 조건 정리 완료 / rollback 포함 / 코드·Rules·데이터 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.

## 부록. §7 핵심 질문 답
1. 시작 위치: `startAnonymousPinBootstrap`(index.html:1761) → `signInAnonymously`(firebase-shared.js:29, 호출 1765)
2. 실행 조건: onAuthStateChanged에서 **비-Google 사용자**일 때(1797/1801), 또는 onAuthStateChanged 미존재 시 onload(1740)
3. 실행 후 read: `waitForFirebaseAndSyncUsers`→`syncUsers`(users read)→roleGrid
4. Google 경로 필요?: **불필요**
5. PC Google 전용 필요?: **불필요**(PC PIN 제거 시 비시작)
6. factory 모바일 PIN 필요?: **필요**(PIN 목록 read 컨텍스트)
7. 제거 시 roleGrid/syncUsers 영향: 인증 컨텍스트 소실 → users read 불가 → roleGrid 중단
8. users 전체 read 제거와 관계: **강결합**(Anonymous는 PIN용 users read를 위해 존재)
9. sessionStorage 복원 충돌?: Google 복원은 3459 early-return → **충돌 없음**; factory PIN 복원은 동반 잔존
10. 격리 범위: factory 모바일 PIN fallback 구간으로만 Anonymous 한정(roleGrid factory 축소)
11. K4F 예외: admin/sales/accounting UID 즉시 전환, factory 익명 uid는 Rules 예외 임시 허용
12. rollback: 호출 가드만 조정·함수 보존, factory 안정화 전 완전 제거 금지
