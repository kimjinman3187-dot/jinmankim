# 2026-05-29 YJ Flow 작업22-PAYMENT-HOTFIX 작업 기록

> 기록 시각: 2026-05-29 17:51 KST  
> 작업명: 작업22-PAYMENT-HOTFIX — 모바일 입금액 검증 및 입금일 표시 보정  
> 저장 위치: `docs/operations/2026-05-29_YJ_Flow_작업22_PAYMENT_HOTFIX_작업기록.md`  
> 대상 PR: #28  
> 대상 브랜치: `work22-payment-hotfix`  

---

## 1. 오늘 작업의 핵심 결론

오늘 작업의 본질은 신규 기능 개발이 아니라, 회계 데이터 무결성을 지키기 위한 HOTFIX 처리였다.

초기에는 `confirmPayment(id)` 중심으로 모바일 입금액 검증을 보정하려 했으나, 실제 운영 반영을 위해서는 HOTFIX 파일 생성만으로는 부족했고, `index.html`에서 해당 파일을 로드하는 연결 작업이 필요했다.

작업 중 GitHub 커넥터의 한계로 인해 핵심 운영 파일을 전체 교체할 위험이 발생했고, 그 결과 PR #28을 Draft로 전환하여 안전하게 동결한 뒤, 최종적으로 `index.html`에 HOTFIX 로더 1줄을 추가하여 Ready 상태로 전환했다.

---

## 2. 작업 전제

### 유지한 원칙

```text
1. 작업22-PAYMENT-HOTFIX를 먼저 처리한다.
2. 22-3D 신규 기능은 착수하지 않는다.
3. Gene은 원칙적으로 코드 수정자가 아니라 검증자다.
4. AI 실행 측이 confirmPayment(id)를 안전 오버라이드 방식으로 수정한다.
5. Gene은 최종 GitHub Pages 화면과 Console만 검증한다.
6. main 직접 수정 금지.
7. PR 병합 후 Delete branch 금지.
```

### 오늘 추가된 현실 운영 예외

```text
AI 실행 측이 도구 제약으로 안전한 부분 수정을 직접 수행하기 어렵고,
수정 범위가 명확히 1줄 이하의 단순 패치일 경우,
Gene에게 지체 없이 수동 패치를 권고한다.
```

단, 이 경우에도 Gene은 개발자가 아니라 **AI가 지정한 정확한 패치 적용자**로만 움직인다.

---

## 3. 오늘 발생한 문제

### 3.1 기존 confirmPayment(id)의 문제

기존 로직은 입력값에서 숫자 외 문자를 제거한 뒤 금액으로 처리하는 구조였다.

```js
const amount = parseInt(inputStr.replace(/[^0-9]/g, ''));
```

이 구조에서는 아래 입력이 정상 금액처럼 처리될 수 있다.

```text
10000원 -> 10000
abc10000 -> 10000
10000abc -> 10000
```

또한 잔금 초과 입금에 대한 차단이 명확하지 않아 회계 데이터 무결성 문제가 발생할 수 있었다.

---

## 4. 오늘 실제 처리한 작업

### 4.1 HOTFIX 전용 브랜치 생성

```text
브랜치:
work22-payment-hotfix
```

### 4.2 HOTFIX 파일 생성

```text
파일:
js/work22-payment-hotfix.js
```

포함된 주요 로직:

```text
1. confirmPayment(id) 안전 오버라이드
2. 숫자와 쉼표만 허용
3. 문자 포함 금액 차단
4. 빈 값, 0, 음수, 소수점 차단
5. 잔금 초과 입금 저장 차단
6. 부분입금 / 완납 상태 분기
7. lastPaymentAt 저장
8. lastPaymentAmount 저장
9. 완납 시 paidAt 저장
10. 입금기한 / 최근입금일 / 입금완료일 표시 보강
```

### 4.3 PR #28 생성

```text
PR 번호:
#28

제목:
fix: 모바일 입금액 검증 및 입금일 표시 보정
```

### 4.4 위험 변경 발생 및 제거

중간에 `firebase-shared.js`를 브리지 로더 방식으로 교체하려는 시도가 있었고, 이때 대량 삭제 위험이 발생했다.

```text
문제 변경:
firebase-shared.js 대량 삭제

판정:
병합 금지

처리:
브랜치 포인터를 되돌려 위험 변경 제거
```

### 4.5 PR #28 Draft 전환

로더 연결 미완료 상태에서 실수 병합을 막기 위해 PR #28을 Draft 상태로 전환했다.

### 4.6 index.html 로더 1줄 추가

GitHub 커넥터는 `index.html`에 특정 줄만 안전하게 삽입하는 기능이 없었다. 따라서 Gene이 GitHub 웹 편집기에서 지정된 1줄만 추가했다.

추가 위치:

```html
<script src="js/firebase-shared.js"></script>
```

추가한 줄:

```html
<script src="js/work22-payment-hotfix.js?v=20260529"></script>
```

최종 구조:

```html
<script src="js/firebase-shared.js"></script>
<script src="js/work22-payment-hotfix.js?v=20260529"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

### 4.7 PR #28 Ready 전환

최종 확인 후 PR #28을 Draft에서 Ready 상태로 전환했다.

---

## 5. 현재 PR #28 상태

```text
state: open
merged: false
draft: false
mergeable: true
commits: 2
changed_files: 2
additions: 171
deletions: 1
```

변경 파일:

```text
1. index.html
2. js/work22-payment-hotfix.js
```

`index.html`의 삭제 1줄은 운영 코드 삭제가 아니라 공백 줄 정리로 판정한다.

---

## 6. 남은 작업

```text
1. PR #28 main 병합
2. Delete branch 금지
3. GitHub Pages 배포 반영 대기
4. 모바일 입금 테스트
5. 모바일 회계/수금 화면 표시 테스트
6. Console 치명 오류 확인
7. 완료 보고 11개 항목 작성
8. MD 자산화 최종본 정리
9. 그 후 작업22-3C/3D 상태 재정렬
```

---

## 7. Gene 검증 체크리스트

### 7.1 초과 입금 차단

```text
남은 잔금: 30,000원
입력 금액: 50,000원

정상 결과:
저장 안 됨
paidAmount 변경 안 됨
paymentStatus 변경 안 됨
경고창 표시
```

### 7.2 문자 포함 금액 차단

아래 입력은 모두 저장되면 안 된다.

```text
abc10000
10000원
10000abc
빈 값
0
-1000
1.5
```

### 7.3 부분입금

```text
남은 잔금: 30,000원
입력 금액: 10,000원

정상 결과:
paymentStatus: partial
lastPaymentAt 저장
lastPaymentAmount 저장
paidAt 저장 안 됨
```

### 7.4 완납

```text
남은 잔금: 30,000원
입력 금액: 30,000원

정상 결과:
paymentStatus: paid
lastPaymentAt 저장
lastPaymentAmount 저장
paidAt 저장
```

### 7.5 화면 표시

```text
입금기한 표시
최근입금일 표시
입금완료일 표시
```

### 7.6 Console

```text
빨간 치명 오류 없음
Firebase 오류 없음
로그인 불가 오류 없음
화면 빈 화면 오류 없음
```

---

## 8. 오늘 추가할 운영 룰

### RULE-PATCH-ESCALATION-001

```text
AI 실행 측이 도구 제약으로 직접 안전하게 코드를 수정하기 어려운 경우,
그리고 수정 범위가 명확한 소량 변경일 경우,
AI는 지체 없이 Gene에게 수동 패치를 권고한다.
```

### 적용 조건

```text
1. 수정 범위가 1줄 또는 매우 작은 블록으로 명확할 것
2. 수정 위치가 정확히 특정되어 있을 것
3. 변경 전/후 코드가 명확할 것
4. main 직접 수정이 아닐 것
5. PR 브랜치에서만 처리할 것
6. 수정 후 Files changed에서 대량 삭제가 없는지 확인할 것
```

### 금지 조건

```text
1. Gene에게 추측성 코드 수정을 요구하지 않는다.
2. Gene에게 여러 파일을 직접 수정하게 하지 않는다.
3. Gene에게 함수 리팩토링을 맡기지 않는다.
4. Gene에게 main 브랜치 수정을 요구하지 않는다.
5. Gene에게 검증 없이 병합을 요구하지 않는다.
```

### 표준 문장

```text
현재 도구 한계로 AI가 안전하게 부분 삽입을 완료하기 어렵습니다.
수정 범위는 PR 브랜치의 특정 파일 특정 위치에 1줄 추가입니다.
Gene이 직접 개발하는 것이 아니라, AI가 지정한 수동 패치를 적용하는 방식으로 진행하는 것이 가장 안전합니다.
```

---

## 9. 오늘의 교훈

```text
1. AI가 모든 GitHub 수정 작업을 직접 처리할 수 있다는 전제는 위험하다.
2. 커넥터가 부분 삽입을 지원하지 않으면 전체 파일 교체 리스크가 생긴다.
3. 운영 핵심 파일은 대량 삭제 가능성이 있으면 즉시 중단해야 한다.
4. 단순하고 명확한 1줄 패치는 Gene에게 즉시 권고하는 것이 오히려 안전하다.
5. Gene은 개발자가 아니라 최종 검증자이지만, 예외적으로 AI가 지정한 소량 패치 적용자는 될 수 있다.
6. 이 예외는 반드시 PR 브랜치에서만 허용한다.
```

---

## 10. 다음 작업 기준

```text
다음 작업:
PR #28 main 병합 전 최종 확인

확인할 것:
1. PR #28 Ready 상태 유지
2. changed_files 2개 유지
3. index.html 대량 삭제 없음
4. firebase-shared.js 변경 없음
5. mergeable true 유지

그 후:
main 병합
Delete branch 금지
GitHub Pages 검증
Console 치명 오류 확인
```
