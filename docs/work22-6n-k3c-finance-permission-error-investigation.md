# WORK22-6N-K3C — Google Login 후 Finance 권한 에러 원인 분리 조사 (보고서)

기준일: 2026-06-10
조사 브랜치: `work22-6n-k3-google-login-minimum`
작업 성격: **읽기 전용 코드/Rules 정적 조사** (코드/Rules/데이터 변경 없음)

## 0. 입력 사실 (정상 확인된 항목)

```text
email = kimjinman3187@gmail.com
uid   = xNrwQIcNh6MniXPOGD7J1nimb913
users/{uid} exists = true
currentUser.role = admin
currentUser.status = active
yongjin_session = null
active_tab = factory
```

증상: admin Google Login 성공 후, Finance 관련 리스너에서 `Missing or insufficient permissions` 발생.

> 참고: 본 조사 중 배포된 Rules의 orders 동작을 라이브 read로 실측하려 했으나, 운영 DB 읽기는 본 작업(코드/Rules 조사) 범위 밖으로 분류되어 차단됨. 따라서 **배포된 Rules 본문은 직접 확인하지 못했고**, 아래 결론은 정적 코드 분석 + Firestore Rules 동작 원리에 근거한다. 배포 Rules 본문 확인이 필요한 부분은 명시한다.

---

## 1. Finance 에러 발생 위치 특정 (조사 대상 1~5)

조사 대상으로 지정된 라인은 모두 **Finance용 orders 리스너의 에러 콜백**이다:

| 위치 | 리스너 | 쿼리 |
|---|---|---|
| `js/firebase-shared.js:277` (err cb 280) | 작업22-3E 신규 승인 대기 | `orders.where('status','==','pending').orderBy('createdAt','desc').limit(100)` |
| `js/firebase-shared.js:362` (err cb 365) | 작업22-3F 수금 대기 | `orders.where('status','in',['approved','completed']).orderBy('createdAt','desc').limit(150)` |
| `js/firebase-shared.js:430` (err cb 433) | 작업22-3G 완료 거래 | `orders.where('paymentStatus','==','paid').limit(100)` |
| `js/work22-3h3i-finance-enhancement.js:440` | 작업22-3H/3I Finance 기간필터 요약카드 | `orders.limit(300)` |

### 1-1. 접근 컬렉션 목록
- `orders` (위 4개 Finance 리스너 전부)
- `users` (로그인 시 `users/{uid}` 단건 get — 이건 **성공**, 아래 §3)

### 1-2. 문제 발생 쿼리 목록
```text
orders where status == pending  + orderBy createdAt desc limit 100      (3E)
orders where status in [approved, completed] + orderBy createdAt desc limit 150  (3F)
orders where paymentStatus == paid  limit 100                           (3G)
orders limit 300                                                        (3H/3I 요약카드)
```

---

## 2. 핵심 구조 결함 — Finance 리스너가 인증/권한 생명주기 밖에서 시작됨 (코드 문제, 확정)

이것이 본 증상의 **1차 원인**이며 코드로 확정 가능하다.

### 2-1. Finance 리스너는 `window.db`만 보고 무조건 자동 시작
`js/firebase-shared.js`의 3개 리스너는 각 IIFE의 `setInterval`(약 285/370/438행)이 **`window.db` 존재만** 확인하고 `startXOrdersListener()`를 호출한다. 시작 함수는:

```js
if (pendingOrdersUnsubscribe || !window.db) return;   // 274/360/428행
pendingOrdersUnsubscribe = window.db.collection('orders')...onSnapshot(..., errCb);
```

→ **로그인 여부, 인증 provider, currentUser.role을 전혀 확인하지 않는다.** `window.db`는 익명 인증 직후 생성되므로, 리스너는 **Google Login 이전/무관하게** 부착된다.

### 2-2. 부팅 순서상 익명 인증이 먼저 실행됨
`index.html:1735-1740` window.onload:
```js
initializeFirebase();
if (!startGoogleAuthStateRestore()) startAnonymousPinBootstrap();
```
`startGoogleAuthStateRestore()`(1780)는 `onAuthStateChanged`를 등록하고 true를 반환. 콜백(1784)은 **authUser가 Google 사용자가 아니면**(최초 로드 시 null) `startAnonymousPinBootstrap()` → `signInAnonymously()`(1765)를 호출한다.

→ **최초 방문/팝업 로그인 흐름에서는 익명 인증이 먼저 일어나고**, 그 직후 `window.db`가 준비되어 Finance 리스너가 **익명 컨텍스트로 부착**된다. 사용자가 Google 팝업 로그인을 누르는 것은 그 다음이다(`signInWithPopup`, 1964/2004).

### 2-3. 에러가 나면 리스너가 영구히 죽고 재시작되지 않음
에러 콜백(280/365/433)은 `console.error`만 하고 **`pendingOrdersUnsubscribe` 등 핸들을 null로 되돌리지 않는다.** `onSnapshot`은 호출 즉시 unsubscribe 함수를 반환해 핸들이 truthy로 남으므로, 이후 `setInterval`이 다시 `startXOrdersListener()`를 불러도 `if (pendingOrdersUnsubscribe ...) return`에 걸려 **재부착되지 않는다.**

→ 익명 컨텍스트에서 한 번 permission denied가 나면, **그 뒤 Google admin 로그인이 성공해도 Finance 리스너는 죽은 채로 남는다.** UI의 currentUser.role은 admin으로 갱신되지만(`processLoginSuccess`) 죽은 리스너는 되살아나지 않아 화면에는 권한 에러가 지속된다.

### 2-4. 대조군 — 메인 orders 리스너는 정상 생명주기
`index.html:2228-2229`의 메인 orders 리스너는 **로그인 후 `currentUser.role`로 분기**한다(sales→reportedBy, factory→status in[...], 그 외(admin/accounting)→전체). 이 리스너는 currentUser가 설정된 뒤 시작되므로 admin이면 전체 orders를 정상 구독한다.

→ **메인 리스너(History/검색)는 admin에서 동작하는데 Finance 리스너만 실패**한다면, 이는 Rules가 admin을 거부해서가 아니라 **Finance 리스너가 잘못된(익명) 컨텍스트에서 부착·고착되었기 때문**임을 가리킨다. 이것이 두 문제(로그인 vs Finance 권한)를 분리하는 핵심 진단이다.

---

## 3. Google Login 문제와 Finance 권한 문제의 분리 (PASS 기준 1)

| 구분 | 상태 | 근거 |
|---|---|---|
| Google Login 자체 | ✅ 정상 | `loadCurrentUserFromAuthUser`(1927)가 `users/{uid}` 단건 get 성공 → currentUser.role=admin 설정. 즉 **Gene의 Google uid로 users/{uid} read는 허용됨** |
| Finance orders 리스너 | ❌ permission denied | §1 4개 리스너. orders 컬렉션 list 쿼리에서 실패 |

**결론: 두 문제는 분리된다.** 로그인(=users/{uid} 단건 read)은 성공했고, 실패는 **orders 컬렉션 list 쿼리**에 국한된다. 따라서 "로그인 깨짐"이 아니라 "orders read 경로"의 문제다.

---

## 4. Rules 문제인지 코드 쿼리 문제인지 판정 (조사 대상 6·7, PASS 기준 3)

### 4-1. currentUser.role은 Rules에 반영되지 않는다 (조사 7 — 확정)
`currentUser`(role=admin)는 `loadCurrentUserFromAuthUser`(1942)가 만든 **클라이언트 JS 변수**일 뿐이다. ACCESS_MATRIX(`canView/canWrite`)의 **UI 게이팅에만** 쓰인다. Firestore Rules는 `currentUser`를 볼 수 없고, 서버에서 독립적으로 `get(/users/$(request.auth.uid))`를 평가한다.
→ **UI role과 Rules 권한은 완전히 분리(decoupled)되어 있다.** UI가 admin을 보여줘도 Rules가 admin을 인정하는지는 별개다.

### 4-2. Anonymous ↔ Google UID 구조 충돌 (조사 6)
- 로그인 시 `users/{uid}` get은 성공(§3) → Gene의 Google uid에 대해 **users read는 허용**됨.
- 그러나 Finance 리스너는 §2처럼 **익명 uid 컨텍스트**(users/{anonymous-uid} 문서 없음)에서 부착될 수 있다. 어떤 role 기반 배포 Rules든 익명 uid는 `get(users/{uid})`가 없어 role 판정 불가 → orders list 거부.
- 즉 **request.auth가 익명이냐 Google이냐에 따라 orders 접근 결과가 갈리는데, Finance 리스너는 그 경계를 무시하고 익명 단계에서 부착**된다 → 충돌.

### 4-3. 판정

**1차 원인 = 코드(리스너 생명주기) 문제.** (확정, §2)
Finance 리스너가 인증/role 준비 이전(익명) 단계에서 무조건 부착되고, 에러 후 재시작되지 않는 구조. 이 결함은 배포 Rules가 무엇이든 증상을 만든다.

**2차 요인 = Rules의 orders 제한.** (부분 확정)
- orders list가 거부된다는 것은 배포 Rules가 orders read를 **익명/무권한 컨텍스트에 대해 제한**하고 있음을 의미(만약 `request.auth!=null` 전면 허용이면 익명에서도 통과했을 것).
- 다만 **Google admin uid에 대해서도 orders가 거부되는지**는 배포 Rules 본문을 봐야 확정된다(라이브 read 차단으로 미확인). 두 시나리오:
  - (P-코드) 배포 Rules가 admin을 정상 허용 → Finance 에러는 순수 §2 생명주기 문제(익명 부착·미재시작).
  - (P-Rules) 배포 Rules가 admin조차 거부(예: 구버전 룰, 또는 orders read가 users/{uid}.role을 제대로 못 읽는 룰) → 생명주기 수정만으로는 부족, Rules도 수정 필요.

→ **결정 테스트(코드 수정 없이 가능):** 로그인 완료(admin) 후 동작하는 **메인 orders 리스너(index.html:2229)** 가 정상이면 P-코드, 그것도 permission denied면 P-Rules. 증상이 "Finance만 실패"라면 P-코드 쪽이 유력하다.

---

## 5. 수정 필요 파일 후보 (PASS 기준 4 — 수정 지시문 작성 가능 상태)

| 파일 | 지점 | 수정 방향(설계) |
|---|---|---|
| `js/firebase-shared.js` | 274-292 (3E), 360-379 (3F), 428-447 (3G) | ① 리스너 시작 게이트를 `window.db`에서 **"Google 인증 완료 + currentUser.role ∈ finance 권한(admin/accounting)"** 로 강화 ② 에러 콜백에서 해당 `xUnsubscribe=null` 리셋 + 재시작 허용(또는 onAuthStateChanged 재구독) |
| `js/work22-3h3i-finance-enhancement.js` | 440 (`orders.limit(300)`) | 동일 — 인증/role 준비 후 시작, 에러 시 재시도 |
| `index.html` | 1735-1804 부팅/auth 흐름 | Finance 리스너 시작 시점을 `processLoginSuccess`(로그인·role 확정) 이후로 이동시키는 훅 제공. 익명 컨텍스트 부착 방지 |
| `firestore.rules` (배포본) | orders read | **배포 Rules 본문 확인 후** admin/accounting의 orders read 허용 여부 검증·정정(P-Rules일 때) |

> 주의: 위는 **수정 방향 설계**이며, 본 작업은 코드/Rules 수정 금지이므로 실제 변경은 별도 승인 작업에서 수행한다.

---

## 6. K3 최종 PASS 가능 여부 판단

| K3C PASS 기준 | 충족 |
|---|---|
| Google Login 문제와 Finance 권한 문제 분리 | ✅ §3 |
| Finance 에러 발생 위치 특정 | ✅ §1 (firebase-shared.js 277/362/430 + 3h3i:440) |
| Rules 문제인지 코드 쿼리 문제인지 판정 | ✅ §4 — **1차 코드(리스너 생명주기), 2차 Rules orders 제한**. 단 P-Rules 확정은 배포 Rules 본문 확인 필요 |
| 수정 지시문 작성 가능 상태 도달 | ✅ §5 |

**K3C = PASS** (조사 목적 달성).

**K3 최종 PASS 여부 = 보류(조건부).** Finance 권한 에러가 K3(Google Login 최소 구현)의 잔여 결함으로 남아 있다. K3를 최종 PASS로 올리려면 §5의 리스너 생명주기 수정(최소한 P-코드)이 선행되어야 한다. 로그인 자체는 정상이므로, "로그인 기능"만 보면 K3는 PASS 후보이나 **Finance 화면 회귀가 미해결**이라 전체 PASS는 수정 후로 미룬다.

---

## 7. 다음 작업 제안

```text
WORK22-6N-K3D — Finance 리스너 생명주기 수정 지시문
  - firebase-shared.js 3개 + 3h3i 요약카드 리스너를 인증/role 확정 후 시작하도록 게이트
  - 에러 시 unsubscribe 리셋 + 재구독 (onAuthStateChanged 연동)
(병행) 배포 firestore.rules 본문 확인 — admin/accounting orders read 허용 여부 검증 (P-코드 vs P-Rules 확정)
```

---

## 부록. 근거 라인 인덱스

- Finance 리스너 시작 가드/쿼리/에러: `firebase-shared.js:274-292, 360-379, 428-447`
- 요약카드 리스너: `work22-3h3i-finance-enhancement.js:440`
- 부팅/auth 분기: `index.html:1735-1740, 1761-1804`
- Google 로그인→currentUser: `index.html:1927-1954, 1963-1965`
- 메인 orders 리스너(role 분기, 대조군): `index.html:2228-2229`
- ACCESS_MATRIX(UI 게이팅): `index.html` ACCESS_MATRIX/canView/canWrite
