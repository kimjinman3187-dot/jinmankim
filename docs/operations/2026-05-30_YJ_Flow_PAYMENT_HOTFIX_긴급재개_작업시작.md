# 2026-05-30 YJ Flow PAYMENT-HOTFIX 긴급 재개 작업 시작

> 작업 시작: 2026-05-30 토요일 16:10 KST  
> 작업 유형: 긴급 오류 대응  
> 증상: PC/모바일 공통 입금처리 시 “주문 데이터를 찾을 수 없습니다.” 발생  

---

## 1. 증상

```text
PC / 모바일 공통
입금처리 클릭 시:
주문 데이터를 찾을 수 없습니다.
```

---

## 2. 1차 원인 판정

`index.html` 내부에서는 주문 배열이 다음처럼 `let`으로 선언되어 있다.

```js
let orders = [];
let filteredOrders = [];
```

하지만 `js/work22-payment-hotfix.js`는 외부 스크립트에서 다음처럼 `window.orders`만 확인했다.

```js
const orderList = Array.isArray(window.orders) ? window.orders : [];
const o = orderList.find(x => x.id === id);
if (!o) return alert('주문 데이터를 찾을 수 없습니다.');
```

브라우저에서 전역 `let` 변수는 `window` 속성으로 노출되지 않는다. 따라서 외부 스크립트인 `work22-payment-hotfix.js`에서 `window.orders`를 통해 주문 배열을 찾을 수 없고, PC/모바일 모두 동일하게 주문 데이터 조회 실패가 발생했다.

---

## 3. 긴급 수정 방향

`window.orders` 의존을 제거하고, `confirmPayment(id)` 실행 시 Firestore에서 해당 주문 문서를 직접 조회하도록 수정한다.

수정 방향:

```text
1. confirmPayment(id)에서 window.orders를 사용하지 않는다.
2. db.collection('orders').doc(id).get()으로 주문 데이터를 직접 조회한다.
3. 문서가 없으면 그때만 주문 데이터 없음 경고를 표시한다.
4. 저장 성공 후 로컬 객체 갱신에 의존하지 않고 executeSearch/renderAccounting/renderReceivables로 화면을 재렌더링한다.
5. 기존 숫자 검증, 초과입금 차단, 부분입금/완납 분기는 유지한다.
```

---

## 4. 작업 원칙

```text
1. main 직접 수정 금지
2. 긴급 수정 브랜치에서 처리
3. PR 생성 후 Files changed 확인
4. Delete branch 금지
5. Gene은 화면과 Console만 검증
```
