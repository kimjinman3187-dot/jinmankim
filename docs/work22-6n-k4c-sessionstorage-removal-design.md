# WORK22-6N-K4C — sessionStorage.yongjin_session 제거 설계

기준일: 2026-06-11
작업 성격: **설계 문서** (코드/Rules/데이터 변경 없음)
기준 커밋: `origin/main = 25eb782` (PR #72 merged 포함)
선행: K4(병행 구조 정리), K4B(users 전체 read 제거 설계, PR #72)

## 1. 작업 개요

PIN Login 병행 구조에서 사용하던 `sessionStorage.yongjin_session`(권한 정보 보관) 의존성을 전수조사하고, **Google Login + Firebase Auth + `users/{uid}` + `currentUser`** 기준 구조로 전환하기 위한 제거 설계를 정의한다. 권한 source를 클라이언트 제어 영역(sessionStorage)에서 분리하는 것이 목표다.

## 2. 현재 인증/session 구조

```text
[Google 경로]  Google Login → auth.currentUser.uid → users/{uid} 단건 read
              → currentUser(메모리) → ACCESS_MATRIX → yj:auth-ready → listener → 화면
[PIN 경로]    PIN 선택/입력 → currentUser = user → sessionStorage.yongjin_session 저장
              → processLoginSuccess → 화면
[복원]        Google: onAuthStateChanged(startGoogleAuthStateRestore) → users/{uid} 재read
              PIN:   processLoadEvent → sessionStorage.yongjin_session 파싱
```

핵심: **권한 source가 경로별로 이원화**되어 있다. Google은 `users/{uid}`(서버), PIN은 `sessionStorage`(클라이언트).

## 3. sessionStorage.yongjin_session 발생(set) 위치

| 위치 | 코드 | 경로 |
|---|---|---|
| `index.html:1907` | `sessionStorage.setItem('yongjin_session', JSON.stringify(currentUser))` (PIN tryLogin 성공) | **PIN 전용** |
| `index.html:1923` | 동일 (dev bypass 로그인) | **DEV 전용** |

→ **Google Login 경로에는 set이 전혀 없다.** `loadCurrentUserFromAuthUser`는 currentUser만 메모리에 구성하고 sessionStorage에 쓰지 않는다.

## 4. sessionStorage.yongjin_session 사용(get) / 삭제(remove) 위치

### get(읽기)
| 위치 | 용도 | Google 의존? |
|---|---|---|
| `index.html:3461` | 세션 복원(processLoadEvent) — **단, 3459에서 `currentUser?.provider==='google' \|\| isGoogleAuthUser(...)`면 early-return** | ❌ (PIN 전용) |
| `js/work22-payment-hotfix.js:46` | 감사로그 user 이름/role **fallback** (`window.currentUser` 우선, 없을 때만 sessionStorage) | ❌ (currentUser 우선) |

### remove(삭제)
| 위치 | 용도 |
|---|---|
| `index.html:1038` | `clearSavedSession()` (계정 비활성/정리) |
| `index.html:2613` | `logout()` (Google signOut 후 remove + reload) |
| `index.html:3465 / 3473 / 3486` | 복원 블록의 손상/로컬계정 가드 |

> `active_tab`은 **별도 키**(비권한 UI 상태)로, yongjin_session과 분리해 다룬다(§9.2 유지 후보).

## 5. Google Login 경로와 sessionStorage 의존성 분석

- **set 없음**(§3) → Google 로그인은 sessionStorage.yongjin_session을 만들지 않는다.
- **복원 시 우회**: `index.html:3459`가 Google이면 sessionStorage 복원 로직 진입 전 return. Google 복원은 `startGoogleAuthStateRestore`의 `onAuthStateChanged` → `loadCurrentUserFromAuthUser`(users/{uid} 재read)로 수행.
- **audit fallback만 존재**: payment-hotfix는 `window.currentUser`를 먼저 보고 없을 때만 sessionStorage. Google 로그인 시 currentUser가 항상 있으므로 fallback 미발동.

**결론: Google Login 경로는 sessionStorage.yongjin_session에 의존하지 않는다.** 따라서 Google 경로 기준으로는 제거 가능.

## 6. currentUser 기준 대체 구조

```text
앱 로드 → Firebase Auth 상태 확인 → Google user 확인 → auth.currentUser.uid
→ users/{uid} 단건 read → currentUser 메모리 구성 → ACCESS_MATRIX
→ yj:auth-ready → listener 시작 → 화면 진입
```

- 권한 판단 source: **currentUser(메모리) + users/{uid}(서버)** 만 사용. sessionStorage 권한값 불사용.
- 화면 진입/권한: `canView/canWrite`(ACCESS_MATRIX)는 `currentUser.role`만 참조 → sessionStorage 불필요.
- 새로고침: onAuthStateChanged가 currentUser를 재구성 → 영속 저장 불필요.

## 7. Finance / AR listener 영향 분석

- Finance 리스너(`firebase-shared.js`)와 요약카드(`3h3i`)는 K3D에서 **`yjCanStartFinanceListeners()`**(window.db + currentUser + role∈[admin,accounting]) + **`yj:auth-ready`** 이벤트로 시작 → **sessionStorage 의존 없음**.
- 메인 orders 리스너(`index.html`)는 `currentUser.role` 분기 → sessionStorage 의존 없음.
- 알림(notiPoller)도 `currentUser.role` 기반.

**결론: listener 시작 조건은 sessionStorage.yongjin_session에 의존하지 않는다.** 제거 영향 없음.

## 8. 새로고침 / auth restore 영향 분석

- Google: `onAuthStateChanged`가 새로고침 시 자동 발화 → `loadCurrentUserFromAuthUser`로 currentUser 재구성. **sessionStorage 없이 복원 가능.**
- PIN: 현재 새로고침 복원은 sessionStorage.yongjin_session에 의존(3461). PIN 유지 구간에서는 이 경로를 보존해야 함(제거 시 PIN 사용자는 새로고침마다 재로그인 필요).
- `active_tab`(탭 복원)은 비권한 UI 상태로 유지 가능.

## 9. PIN / factory 모바일 잔존 리스크

- **PIN set 경로(1907)** 제거 시 PIN 사용자의 새로고침 세션 유지가 깨짐 → PIN 완전 제거 전까지 **보류**.
- **factory 모바일**은 PIN 의존 가능성(K4A 미확정) → factory 정책 확정 전 sessionStorage PIN 경로 제거 금지.
- **dev bypass(1923)**: AUTH_DEV_MODE 전용 → 운영 영향 없음(숨김/유지 후보).
- **payment-hotfix fallback(46)**: currentUser 우선이라 Google에선 무해. 단 PIN 구간 audit 정확도 위해 잔존 허용.

## 분류 (9.1~9.4)

### 9.1 제거 대상 (Google 경로 기준)
- 권한 source로 sessionStorage.yongjin_session을 **읽는** 경로(3461)는 Google에서 이미 우회됨 → Google 전용 단계에서 제거.
- Google 로그인 후 화면 진입 판단에 sessionStorage 불사용(이미 충족).
- 최종 목표: PIN 제거 시 set(1907)·get(3461)·payment fallback(46) 동반 제거.

### 9.2 유지 후보
- `active_tab`(비권한 UI 탭 상태).
- payment-hotfix의 `window.currentUser` 우선 audit 경로(sessionStorage는 fallback일 뿐).

### 9.3 보류 대상
- PIN tryLogin set(1907) + PIN 복원(3461) — PIN Login 유지 구간 필요.
- factory 모바일 연결 sessionStorage — K4A 정책 확정 전.
- dev bypass set(1923) — AUTH_DEV_MODE.

### 9.4 후속 작업 이관
- PIN Login 제거/축소 → K4D 이후
- factory 모바일 Google/PIN 정책 → **K4A**
- Anonymous Auth 제거 → 후속
- Firestore Rules UID 기반 전환 → K4B 후속

## 10. 제거 단계 설계 (K4C-1 ~ K4C-7)

```text
K4C-1: sessionStorage.yongjin_session set/get/remove 위치 전수조사
       → 완료 (§3·§4): set 2(1907/1923), get 2(3461/payment46), remove 5
K4C-2: Google Login 경로 sessionStorage 비의존성 확인
       → 완료 (§5): set 없음 + 복원 우회(3459) + audit fallback 무해
K4C-3: currentUser + Firebase Auth restore 기준 대체 구조 설계
       → §6 (onAuthStateChanged 재구성, 영속 저장 불요)
K4C-4: Finance / AR listener 시작 조건 영향 분석
       → 완료 (§7): yjCanStartFinanceListeners + yj:auth-ready, 의존 없음
K4C-5: PIN fallback 잔존 구간과 분리
       → §9.3 (1907/3461/1923/payment46 보류, factory K4A 이관)
K4C-6: sessionStorage 제거 구현 전 체크리스트 작성 (아래)
K4C-7: rollback 기준 작성 (§11)
```

### K4C-6 구현 전 체크리스트 (구현은 별도 승인 작업)
- [ ] Google 로그인 후 sessionStorage.yongjin_session이 set되지 않음을 런타임 확인
- [ ] Google 새로고침 시 onAuthStateChanged로 currentUser 재구성 확인
- [ ] Finance/AR/noti listener가 currentUser만으로 정상 시작 확인
- [ ] payment-hotfix audit user가 window.currentUser로 채워짐 확인
- [ ] PIN 경로 보존 여부 결정(또는 PIN 제거 작업과 동시 진행)
- [ ] factory 모바일 정책(K4A) 확정 여부 확인
- [ ] active_tab 유지 확인(권한 무관)

## 11. rollback 설계

- 제거는 **Google 전용 구간에 한정**하고 PIN set/get/payment-fallback은 보존 → 문제 시 PIN 경로 즉시 복귀.
- 제거 구현은 **provider 분기 가드** 뒤에 두어(예: `provider==='google'`일 때만 sessionStorage 미사용), 토글로 되돌릴 수 있게 설계.
- `active_tab`은 변경하지 않음(복원 UX 보존).
- 운영 배포 전 Google/PIN 양 경로 회귀 테스트. 실패 시 직전 커밋으로 revert(브랜치 보존, Delete Branch 금지).

## 12. K4D/K4E/K4F 연결

```text
K4C (본 설계) → sessionStorage.yongjin_session 권한 source 제거 방향 확정
K4D — PIN Login 제거/축소 설계 (sessionStorage set 경로 동반 제거)
K4E — Anonymous Auth 제거 설계 (PIN bootstrap 의존 해소)
K4F — Firestore Rules UID 기반 전환/Emulator 검증 (K4B 후속)
(분리) K4A — factory 모바일 Google/PIN 운영 정책 분리
```

## 13. 금지사항 준수 확인

```text
코드 변경 없음 / Rules 변경 없음 / users·orders 데이터 변경 없음
Reset Data 미사용 / main 직접 수정 없음 / Delete Branch 없음
K4B 브랜치 재사용 없음(신규 브랜치) / K3D hotfix 브랜치 미접촉 / 최종 PASS 선언 안 함
```

## 14. PASS 기준

```text
origin/main 최신(25eb782) 기준 작업 / PR #72 merge 반영 확인
신규 브랜치 / 문서 1개만 변경
sessionStorage.yongjin_session 전수조사 완료 (set2/get2/remove5)
Google 경로 비의존성 판단 완료 / currentUser 대체 구조 설계 완료
Finance/AR listener 영향 분석 완료 / PIN·factory 잔존 리스크 분리 완료
rollback 설계 포함 / 코드·Rules·데이터 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.
