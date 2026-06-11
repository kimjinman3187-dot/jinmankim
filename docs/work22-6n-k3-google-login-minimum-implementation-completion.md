# WORK22-6N-K3 — Google Login 최소 운영 로그인 구현 완료 자산화

기준일: 2026-06-11
자산화 작업: WORK22-6N-K3E
검증 기준 커밋: `origin/main = dc0e24ee3cae9f6b4311de10e70443317e898d7d`

## 1. K3 작업 목적

Anonymous Auth + PIN 구조 위에, **Google Login 최소 운영 로그인 경로**를 추가한다. `auth.currentUser.uid`로 `users/{uid}`를 조회해 role/status 기반 `currentUser`를 구성하고, 기존 ACCESS_MATRIX UI 권한을 그대로 적용한다. (Rules 최종 전환·PIN 제거는 K3 범위 밖)

## 2. K3B — Firestore users/{uid} 문서 매핑 정정 결과

- Gene Google 계정으로 `users/{uid}` 문서가 매핑됨:
  - `uid = xNrwQIcNh6MniXPOGD7J1nimb913`
  - `users/{uid}.role = admin`, `status = active`, `name = gene kim`
- 6N-G0 실데이터에서 확인된 `emp_acc2.role="ccounting"` 오타 등은 신규 `users/{uid}` 생성 시 `accounting` 정정 대상(전체 직원 전환은 미완, K4 이후).
- 결과: Gene의 Google uid에 대해 **`users/{uid}` 단건 read 성공** → 로그인 신원 매핑 확립.

## 3. K3C — Finance permission-denied 원인 조사 결과

(상세: `work22-6n-k3c-finance-permission-error-investigation.md`)

- 에러 위치: Finance용 orders 리스너 — `firebase-shared.js:277/362/430` + `work22-3h3i-finance-enhancement.js:440`.
- 1차 원인(코드): Finance 리스너가 **`window.db`만 보고 인증/role 무관하게 자동 시작** → 익명 컨텍스트에서 부착되고, 에러 콜백이 unsubscribe 핸들을 리셋하지 않아 **영구 미재시작**.
- 2차 요인(Rules): orders read가 무권한/익명 컨텍스트에 대해 제한됨.
- 판정: UI의 `currentUser.role`은 Rules에 반영되지 않으며(클라이언트 변수), Finance 리스너 생명주기가 핵심 결함.

## 4. K3D — Finance 리스너 생명주기 수정 결과

수정 커밋: `d8b8939 fix(finance): start listeners after auth readiness` (PR #68, main 머지)

검증된 변경 내용:

1. **시작 게이트 강화** — 신규 `window.yjCanStartFinanceListeners()`: `window.db` + `currentUser` 존재 + `role ∈ ['admin','accounting']`일 때만 true. 기존 `if (xUnsubscribe || !window.db)` → `if (xUnsubscribe || !window.yjCanStartFinanceListeners?.())`로 전부 교체.
2. **에러 후 재시작 가능** — 3개 리스너 에러 콜백에서 `pendingOrdersUnsubscribe/collectionOrdersUnsubscribe/completedOrdersUnsubscribe = null` 리셋 추가 → 가드 해제되어 재구독 가능.
3. **auth-ready 이벤트 연동** — `index.html`이 로그인·role 확정 후 `window.dispatchEvent(new CustomEvent('yj:auth-ready', {role,status,provider}))` 발생. `firebase-shared.js`/`3h3i`가 `yj:auth-ready` 수신 시 `yjStartFinanceListenersWhenReady(startFn)` 호출.
4. 요약카드(`work22-3h3i-finance-enhancement.js:440`)도 동일 게이트 적용.

→ Finance 리스너가 **익명 컨텍스트가 아니라 admin/accounting 로그인 확정 후** 시작되도록 보정됨.

## 5. GitHub PR 번호

| PR | 내용 | 상태 | merge SHA |
|---|---|---|---|
| #67 | `work22-6n-k3-google-login-minimum` (Google Login 최소 구현) | merged | `2d56bf2` |
| #68 | `work22-6n-k3d-finance-listener-lifecycle` (Finance 리스너 생명주기 수정) | merged | `dc0e24e` |

> 관련 설계/문서 PR: #63(매핑표), #64(설계문서 묶음) — 별도.

## 6. 변경 파일 목록 (검증됨)

| 커밋 | 파일 | 규모 |
|---|---|---|
| `9a97b93` (K3, PR#67) | `index.html` | +138 / -16 (Google login flow) |
| `d8b8939` (K3D, PR#68) | `index.html` | +12 (yj:auth-ready dispatch) |
| `d8b8939` | `js/firebase-shared.js` | +54 / -11 (리스너 게이트·재시작) |
| `d8b8939` | `js/work22-3h3i-finance-enhancement.js` | +10 (요약카드 게이트) |

## 7. 변경하지 않은 파일 목록

- `firestore.rules` — **Rules 최종 전환 미수행**(K4B 이후). 배포 Rules도 미변경.
- `users` / `orders` 데이터 — 미변경.
- PIN Login / Anonymous Auth 경로 — 제거하지 않고 **병행 유지**.

## 8. Gene 실제 화면 검증 결과 (Gene 제공값)

```text
auth.email           = kimjinman3187@gmail.com
auth.uid             = xNrwQIcNh6MniXPOGD7J1nimb913
currentUser.id       = xNrwQIcNh6MniXPOGD7J1nimb913
currentUser.auth_uid = xNrwQIcNh6MniXPOGD7J1nimb913
currentUser.email    = kimjinman3187@gmail.com
currentUser.name     = gene kim
currentUser.role     = admin
currentUser.status   = active
currentUser.provider = google
yongjin_session      = null
active_tab           = factory
```

> 위 값은 Gene 실제 로그인 화면에서 확인·제공된 검증값이다(자산화 시점 기록). 본 자산화 작업자가 직접 운영 화면을 재관측한 것은 아니며, GitHub/Pages 상태는 아래 9에서 별도 검증함.

## 9. PASS 근거 (자산화 작업자 직접 검증)

- PR #67/#68 모두 **merged**, main 최신 = `dc0e24e` (API 확인).
- K3D 수정 커밋 `d8b8939`가 main에 존재하며 §4 내용대로 코드 반영됨(diff 확인).
- **GitHub Pages = built**, commit `dc0e24e`, 2026-06-11T06:45:22Z → 최신 main 배포 완료.
- `work22-6n-k3d-finance-listener-lifecycle` 브랜치 **미삭제** 확인.
- 로그인 경로: `loadCurrentUserFromAuthUser`(index.html)가 `users/{uid}` get → currentUser 구성 → `yj:auth-ready` dispatch → Finance 리스너 게이트 통과 구조 확인.

## 10. 남은 리스크

1. **Anonymous Auth 병행 유지** — Google/익명 경로 공존. 익명 컨텍스트 잔존이 향후 Rules 전환 시 혼선 요인.
2. **PIN Login 경로 유지** — 보조 잠금/제거 정책 미확정(K4A).
3. **users 전체 read 경로 일부 유지** — PIN 목록 구성용 `users` 전체 read(`syncUsers`) 잔존 → PIN 노출(B3) 위험 지속.
4. **Rules 최종 전환 미완료** — 배포 Rules가 Google UID 기반으로 전환됐는지 미확정(K4B Emulator 검증 필요). Finance 외 컬렉션 권한도 점검 필요.
5. **모바일 factory PIN 보조 잠금 정책 미확정**(K4A).
6. **role 오타/계정 정리 미완** — emp_acc2 `ccounting`, admin 2계정, sales 한글 ID는 전체 직원 전환(K4) 시 처리.

## 11. 다음 작업 후보

- **(권장) WORK22-6N-K4** — Google Login 이후 PIN/sessionStorage/Anonymous/users 전체 read 병행 구조 축소 순서 설계
- WORK22-6N-K4A — 모바일 factory PIN 보조 잠금 정책 설계
- WORK22-6N-K4B — Firestore Rules Google UID 기반 전환 설계(Emulator 검증 전용)

권장 순서: **K3E 자산화 → K4 병행 구조 정리 → K4A factory 정책 → K4B Rules 전환**
