# 2026-05-27 YJ Flow 작업22-QA — PC Finance / AR / Dashboard 통합 회귀 테스트

> 목적: 작업22 PC Finance / AR / Dashboard 고도화 이후 기능 간 충돌 여부를 확인하기 위한 통합 회귀 테스트 체크리스트  
> Repository: kimjinman3187-dot/jinmankim  
> 운영 브랜치: main  
> 작업 브랜치: test/work21-pc-sub-dashboard  
> 작성일: 2026-05-27  
> QA 대상: GitHub Pages 배포본  
> 코드 변경 여부: 없음  
> 새 기능 개발 여부: 없음  

---

## 1. QA 목적

작업22-QA는 새 기능 개발이 아니다.

이번 QA의 목적은 작업22-3C~22-5A-3에서 반영된 PC Finance, PC AR, LIVE Dashboard 기능이 실제 운영 화면에서 서로 충돌하지 않는지 확인하는 것이다.

확인 범위는 다음과 같다.

- LIVE Dashboard KPI 정상 표시
- PC Finance 요약 카드 및 리스트 정상 표시
- PC Finance 기간 필터 정상 작동
- PC Finance 접기 / 펼치기 정상 작동
- PC AR 거래처별 잔액 리스트 정상 표시
- PC AR SAFE / WATCH / RISK 표시 정상
- Finance / AR / Dashboard KPI overflow 재발 없음
- LAST UPDATED 26.05.27 정상 표시
- Console 치명 오류 없음

---

## 2. QA 전제 조건

QA는 아래 전제에서 수행한다.

- GitHub Pages를 강력 새로고침한다.
- PC 화면으로 로그인한다.
- Console을 열어둔다.
- 빨간색 TypeError, ReferenceError, Firebase permission error를 치명 오류로 본다.
- Tailwind CDN production 경고는 기존 비치명 경고로 본다.
- 운영 데이터 삭제 또는 Reset Data 전체 초기화는 금지한다.
- 테스트가 필요한 경우 테스트 데이터만 사용한다.

---

## 3. LIVE Dashboard QA

### 3-1. 진입 테스트

- [ ] PC 로그인 후 LIVE Dashboard 진입 가능
- [ ] 화면 로딩 중 멈춤 없음
- [ ] KPI 카드 4개 표시
- [ ] Console 치명 오류 없음

### 3-2. KPI 카드 테스트

확인 대상:

- Sales
- AR
- Production
- Finance

체크 항목:

- [ ] Sales 카드 숫자 정상 표시
- [ ] AR 카드 숫자 정상 표시
- [ ] Production 카드 숫자 정상 표시
- [ ] Finance 카드 숫자 정상 표시
- [ ] 숫자가 카드 밖으로 넘치지 않음
- [ ] meta 라인 텍스트가 카드 밖으로 넘치지 않음
- [ ] KPI 값이 빈값 또는 NaN으로 표시되지 않음

---

## 4. PC Finance QA

### 4-1. Finance 화면 진입

- [ ] FINANCE 탭 진입 가능
- [ ] Finance Overview 표시
- [ ] 상단 요약 카드 표시
- [ ] Console 치명 오류 없음

### 4-2. Finance KPI / 요약 카드

확인 대상:

- 당월 총 수주액
- 계산서 발행액
- 당월 실결제
- 전체 미수금 합계
- Invoice Wait
- Collection Wait
- Completed
- Action Queue

체크 항목:

- [ ] 카드 숫자 정상 표시
- [ ] 카드 숫자 overflow 없음
- [ ] 금액이 NaN 또는 undefined로 표시되지 않음
- [ ] LAST UPDATED 26.05.27 정상 표시

### 4-3. 기간 필터 테스트

테스트 대상:

- 전체 기간
- 최근 7일
- 지난 달
- 올해

체크 항목:

- [ ] 전체 기간 선택 시 전체 데이터 표시
- [ ] 최근 7일 선택 시 기간 기준 반영
- [ ] 지난 달 선택 시 기간 기준 반영
- [ ] 올해 선택 시 기간 기준 반영
- [ ] 요약 카드 기간 배지 정상 변경
- [ ] 리스트 행 표시가 기간 기준과 충돌하지 않음
- [ ] Console 치명 오류 없음

### 4-4. 섹션 접기 / 펼치기

확인 대상:

- 신규 승인
- 생산 확인
- 청구 대기
- 수금 대기
- 완료 거래

체크 항목:

- [ ] 접기 버튼 정상 작동
- [ ] 펼치기 버튼 정상 작동
- [ ] 접힌 상태에서 화면 깨짐 없음
- [ ] 펼친 상태에서 리스트 정상 표시
- [ ] 섹션 meta 건수 정상 표시

### 4-5. Finance 버튼 존재 확인

주의: 운영 데이터에서는 무리하게 클릭하지 않는다.
테스트 데이터가 있을 때만 클릭 검증한다.

확인 대상:

- 수주 승인
- 반려
- 계산서 발행
- 입금 등록

체크 항목:

- [ ] 버튼 표시 정상
- [ ] 버튼 레이아웃 깨짐 없음
- [ ] 테스트 데이터 기준 클릭 시 Console 치명 오류 없음
- [ ] 기존 paymentStatus / invoiceStatus 흐름과 충돌 없음

---

## 5. PC AR QA

### 5-1. AR 화면 진입

- [ ] AR 탭 진입 가능
- [ ] 채권 현황 관제탑 표시
- [ ] 장기 연체 KPI 표시
- [ ] 일반 미수 KPI 표시
- [ ] 회수율 KPI 표시
- [ ] 리스크 라벨 표시
- [ ] Console 치명 오류 없음

### 5-2. AR KPI 카드

체크 항목:

- [ ] 장기 연체 금액 표시 정상
- [ ] 일반 미수 금액 표시 정상
- [ ] 회수율 표시 정상
- [ ] 리스크 라벨 SAFE / WATCH / RISK 표시 정상
- [ ] KPI 숫자 overflow 없음
- [ ] NaN 또는 undefined 표시 없음

### 5-3. 거래처별 잔액 리스트

체크 항목:

- [ ] 거래처별로 1행씩 표시
- [ ] 같은 거래처의 미수 주문이 합산됨
- [ ] 미수 건수 표시 정상
- [ ] 최종 입금기한 표시 정상
- [ ] 경과일 표시 정상
- [ ] 잔액 표시 정상
- [ ] SAFE / WATCH / RISK 표시 정상
- [ ] 빈 데이터일 때 화면 깨짐 없음

---

## 6. Production / Sales 영향 확인

작업22의 직접 대상은 아니지만, Dashboard와 공통 KPI 로직 영향 여부를 확인한다.

### 6-1. Production

- [ ] Production 탭 진입 가능
- [ ] 생산 진행 리스트 표시 정상
- [ ] 기존 생산 관련 버튼 또는 표시 깨짐 없음
- [ ] Console 치명 오류 없음

### 6-2. Sales

- [ ] Sales 또는 수주 관련 화면 진입 가능
- [ ] 기존 수주 데이터 표시 정상
- [ ] 기존 입력 / 검색 / 필터가 깨지지 않음
- [ ] Console 치명 오류 없음

---

## 7. Console 오류 판정 기준

### 치명 오류

아래 오류는 QA 실패로 본다.

- TypeError
- ReferenceError
- Firebase permission error
- Uncaught error
- 버튼 클릭 후 화면 멈춤
- 데이터 로딩 실패

### 비치명 경고

아래는 기존 경고로 보고 QA 실패로 보지 않는다.

- Tailwind CDN production 경고
- 개발 환경 안내성 warning

---

## 8. QA 결과 기록 형식

Gene은 QA 완료 후 아래 형식으로 보고한다.

정상일 경우:

작업22-QA 검증 완료
- LIVE Dashboard 정상
- PC Finance 정상
- PC AR 정상
- Production / Sales 기존 기능 정상
- KPI overflow 재발 없음
- LAST UPDATED 26.05.27 정상
- Console 치명 오류 없음

문제 발생 시:

작업22-QA 문제 발생
- 발생 화면:
- 발생 기능:
- 문제 설명:
- Console 오류:
- 화면 캡처:
- 재현 순서:

---

## 9. QA 완료 기준

작업22-QA는 아래 기준을 만족해야 완료로 본다.

- LIVE Dashboard 정상
- PC Finance 정상
- PC AR 정상
- Production / Sales 기존 기능 정상
- KPI overflow 재발 없음
- LAST UPDATED 26.05.27 정상
- Console 치명 오류 없음
- 운영 데이터 손상 없음
- Reset Data 전체 초기화 없음

---

## 10. QA 이후 다음 결정

QA 통과 시 다음 후보를 검토한다.

| 우선순위 | 후보 | 판단 |
|---:|---|---|
| 1 | 작업23-1A | Production 운영 고도화 |
| 2 | 작업23-1B | Sales 입력 / 검색 / 필터 고도화 |
| 3 | 작업22-DEV-1 | PC 관리자용 모바일 프리뷰, 후순위 |

QA 실패 시 새 기능 개발은 중단하고 보정 작업을 우선한다.

보정 작업명 예시:

- 작업22-QA-FIX-1 — 발견 오류 1차 보정
- 작업22-QA-FIX-2 — 발견 오류 2차 보정

---

## 11. 최종 원칙

작업22-QA는 새 기능 개발이 아니다.
작업22-QA는 운영 안정성 확인 단계다.

QA에서 문제가 발견되면 즉시 보정 작업으로 전환한다.
QA가 통과되면 작업23 개발 후보를 검토한다.
