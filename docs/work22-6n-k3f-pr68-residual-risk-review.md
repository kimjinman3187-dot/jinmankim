# WORK22-6N-K3F PR #68 잔여 리스크 검토

기준일: 2026-06-11

## 1. 작업 상태

```text
작업명 = WORK22-6N-K3F — K3E 자산화 보정 및 PR #68 잔여 회귀 검증
작업 성격 = 문서 검증 / 자산화 보정 / 회귀 리스크 조사
코드 수정 = 없음
Rules 수정 = 없음
데이터 수정 = 없음
Reset Data = 미사용
Delete Branch = 미실행
```

## 2. 기준 확인

```text
브랜치 = docs/work22-6n-k3f-pr68-residual-risk
HEAD SHA = dc0e24ee3cae9f6b4311de10e70443317e898d7d
origin/main SHA = dc0e24ee3cae9f6b4311de10e70443317e898d7d
최신 main 기준 = 예
stash = 없음
```

작업 전 untracked 문서 4개가 있었으나 K3F 작업에서는 사용하지 않았다.

## 3. PR #68 변경 파일

Git merge diff 및 GitHub API 기준 PR #68 변경 파일:

```text
index.html
js/firebase-shared.js
js/work22-3h3i-finance-enhancement.js
```

변경 규모:

```text
index.html = +12 / -0
js/firebase-shared.js = +45 / -9
js/work22-3h3i-finance-enhancement.js = +8 / -2
```

## 4. PR #68 리뷰 코멘트 확인

GitHub API로 PR #68 review comment를 확인했다.

확인된 코멘트:

```text
path = js/firebase-shared.js
line = 314
priority = P2
요지 = finance patch timer clear 조건이 yjCanStartFinanceListeners()와 결합되어 있어
sales/factory/login 상태에서는 timer가 종료되지 않을 수 있음.
동일 패턴이 3F/3G timer에도 존재함.
DOM injection 완료 조건과 listener start 조건을 분리하거나 timeout을 추가해야 함.
```

## 5. timer 구조 조사 결과

### 5.1 3E 신규 승인 대기

파일:

```text
js/firebase-shared.js
```

확인 구조:

```text
setInterval 250ms
injectFinanceApprovalSection()
startPendingOrdersListener()
clear 조건 = pcFinanceApprovalWaitBody 존재 && yjCanStartFinanceListeners()
```

판정:

```text
admin/accounting = 종료 가능
sales/factory/login = yjCanStartFinanceListeners() false로 timer 지속 가능
```

### 5.2 3F 수금 대기

확인 구조:

```text
setInterval 250ms
injectCollectionSection()
startCollectionOrdersListener()
renderCollectionWaitList()
clear 조건 = pcFinanceCollectionWaitBody 존재 && yjCanStartFinanceListeners()
```

판정:

```text
admin/accounting = 종료 가능
sales/factory/login = yjCanStartFinanceListeners() false로 timer 지속 가능
```

### 5.3 3G 완료 거래

확인 구조:

```text
setInterval 250ms
injectCompletedSection()
startCompletedOrdersListener()
renderCompletedList()
clear 조건 = pcFinanceCompletedBody 존재 && yjCanStartFinanceListeners()
```

판정:

```text
admin/accounting = 종료 가능
sales/factory/login = yjCanStartFinanceListeners() false로 timer 지속 가능
```

### 5.4 Finance 기간 필터 요약 카드

파일:

```text
js/work22-3h3i-finance-enhancement.js
```

확인 구조:

```text
setInterval 300ms
enhanceFinanceSections()
injectSummaryGrid()
startFinanceSummaryListener()
refreshFinancePeriodView()
applyCommonKpiLayout()
setTimeout(() => clearInterval(timer), 30000)
```

판정:

```text
비-Finance role에서도 최대 30초 반복 가능
무한 반복은 아님
3E/3F/3G보다 영향도 낮음
```

## 6. 영향도 판정

판정:

```text
C. 수정 필요
```

근거:

```text
3E / 3F / 3G timer에는 timeout이 없고,
clear 조건이 yjCanStartFinanceListeners()와 결합되어 있어
sales/factory/login 상태에서 250ms 반복이 지속될 가능성이 있음.
Firestore listener는 보호되지만 DOM/footer/render 반복에 따른 성능 리스크가 남는다.
```

## 7. K3E 문서 보정 내용

보정 전 의미:

```text
WORK22-6N-K3 = PASS
WORK22-6N-K3D = PASS
```

보정 후 의미:

```text
WORK22-6N-K3 = PASS 후보
Gene admin Google Login 기준 PASS
Finance permission-denied 재발 없음
단, PR #68 P2 리뷰 코멘트에 따라 sales/factory/login 상태의 Finance patch timer 회귀 여부는 추가 확인 필요
```

## 8. K3D-1 Hotfix 필요 여부

```text
필요
```

권장 작업명:

```text
WORK22-6N-K3D-1 — Finance patch timer 종료 조건 분리 Hotfix
```

권장 방향:

```text
DOM injection 완료 조건과 listener start 조건을 분리한다.
listener start는 yjCanStartFinanceListeners()로 계속 보호한다.
timer clear는 DOM 존재 또는 최대 시도 횟수 기준으로 처리한다.
비-Finance role에서도 Firestore listener는 시작하지 않는다.
```

## 9. 다음 작업 지시문 초안

```text
작업명:
WORK22-6N-K3D-1 — Finance patch timer 종료 조건 분리 Hotfix

목표:
PR #68 이후 남은 Finance patch timer 회귀 리스크를 최소 수정으로 제거한다.

수정 범위:
js/firebase-shared.js
필요 시 js/work22-3h3i-finance-enhancement.js

수정 원칙:
DOM injection 완료 조건과 Firestore listener start 조건을 분리한다.
startPendingOrdersListener / startCollectionOrdersListener / startCompletedOrdersListener는 yjCanStartFinanceListeners() 조건을 유지한다.
timer clear 조건은 DOM 존재 또는 최대 시도 횟수 기준으로 변경한다.

금지:
firestore.rules 수정 금지
Rules 배포 금지
users/orders 데이터 수정 금지
Reset Data 사용 금지
PIN 로그인 제거 금지
Anonymous Auth 제거 금지
Finance 계산 로직 변경 금지

검증:
admin Google Login 후 Finance permission-denied 없음
sales/factory/login 상태에서 3E/3F/3G timer 무한 반복 없음
Finance 리스트 정상 표시
Console 빨간 JS 오류 없음
```

## 10. 최종 판정

```text
K3 admin path = PASS 후보
Finance permission-denied = 해결
비-Finance role timer 회귀 가능성 = 확인됨
K3 전체 최종 PASS = HOLD
K3D-1 Hotfix = 필요
```
