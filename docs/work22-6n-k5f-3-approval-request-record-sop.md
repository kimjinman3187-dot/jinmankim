# WORK22-6N-K5F-3 — 승인 요청 기록 SOP 문서

기준일: 2026-06-12
작업 성격: **SOP 문서** (코드/Rules/데이터/배포/Functions 환경 변경 없음)
기준 커밋: `origin/main = c4170dd` (PR #92 merged 포함)

## 1. 현재 기준선

```text
K5F-1: C안 관리자 수동 승인 운영 구조 확정
K5F-2: 관리자 승인 요청 목록 UI 설계 확정
A안 Functions: 장기 보류
B안 정적 사이트 단독 자동 승인: 금지
현재 repo: 정적 GitHub Pages 구조 (functions/·firebase.json·package.json·.firebaserc 없음)
```

## 2. SOP 목적

자동 승인 기능이 없는 상태에서, 관리자가 Google 계정 승인 요청을 **누락 없이 접수·검토·기록·보존**하기 위한 운영 절차를 표준화한다.

## 3. 승인 요청 접수 기준

승인 요청은 아래 정보가 있어야 접수 가능:
```text
1. Google email   2. Firebase uid   3. 표시 이름   4. 요청 role
5. 요청자 실명   6. 소속/업무 역할   7. 승인 요청 사유   8. 요청 일시
9. 요청을 전달받은 관리자
```

## 4. 승인 요청 기록 항목

| 항목 | 설명 |
|---|---|
| request_id | 요청 식별자 |
| requested_at | 요청 일시 |
| email | Google 계정 |
| uid | Firebase uid |
| displayName | 표시 이름 |
| requested_role | sales/accounting/factory |
| request_reason | 요청 사유 |
| request_channel | 전달 경로(메신저/대면 등) |
| status | pending/approved/rejected/on_hold/inactive |
| reviewed_by | 처리 admin |
| reviewed_at | 처리 일시 |
| decision_reason | 승인/반려/보류 사유 |
| memo | 관리자 메모 |

상태값: `pending / approved / rejected / on_hold / inactive`

## 5. 승인 요청 기록 양식 (템플릿 — 실제 DB/파일 생성 없음)

```text
[승인 요청 기록]

request_id:
requested_at:
email:
uid:
displayName:
requested_role:
request_reason:
request_channel:
status:
reviewed_by:
reviewed_at:
decision_reason:
memo:
```

## 6. 승인 판단 기준

```text
1. 요청자의 실명이 확인됨
2. email이 실제 직원/승인 대상자와 일치함
3. uid가 승인대기 화면에서 확인된 값과 일치함
4. requested_role이 sales/accounting/factory 중 하나임
5. admin role 요청이 아님
6. device 계정 요청이 아님
7. 승인 사유가 명확함
8. 승인자가 admin임
```

## 7. 반려 판단 기준

```text
1. email 소유자가 불명확함
2. uid가 확인되지 않음
3. requested_role이 부적절함
4. admin role 요청
5. device 계정 요청
6. 승인 사유 없음
7. 외부인/퇴사자 의심
8. 중복 요청
```

## 8. 보류 판단 기준

```text
1. 정보가 일부 부족함
2. 요청자의 소속이 불명확함
3. role 판단이 애매함
4. 관리자의 추가 확인이 필요함
5. 승인자는 있으나 근거가 부족함
```

## 9. 관리자 메모 작성 기준

포함:
```text
누가 요청했는가 / 왜 승인·반려·보류했는가 / 어떤 role을 부여하려는가 /
추가 확인이 필요한가 / 퇴사·비활성 이력이 있는가
```
금지(기록하지 말 것):
```text
비밀번호 / 주민번호 / 민감 개인정보 / 불필요한 사적 내용
```

## 10. 승인 기록 보존 원칙

```text
삭제보다 보존 우선
상태 변경 이력 보존
승인자 기록 필수
승인/반려/보류 사유 기록 필수
퇴사자도 삭제보다 inactive 기록
```

## 11. 퇴사/비활성 기록 기준

기록 항목: `uid / email / 기존 role / inactive 처리 일시 / 처리자 / 사유 / 접근 차단 확인 여부`
원칙:
```text
users 문서 삭제 금지
status=inactive 원칙
terminated_at / terminated_by / terminate_reason 기록
Auth disabled는 장기적으로 Admin SDK/Functions(A안) 도입 후 처리
```

## 12. 예외 처리 절차

불가피하게 Firebase Console 또는 DB 수동 조작이 필요한 경우 **별도 예외 승인 절차**로만 분리:
```text
1. Gene 승인 필요
2. 작업 전 변경 대상 기록
3. 작업 후 변경 결과 기록
4. screenshot 또는 로그 보존
5. ORION 검토 후 PASS/HOLD 기록
```
> 본 SOP는 Firebase Console 조작을 허용하는 문서가 아니다. **원칙은 금지**이며, 위는 불가피한 예외에 한한 통제 절차다.

## 13. 금지사항

```text
클라이언트에서 users/{uid} 생성 금지
클라이언트에서 role 부여 금지
클라이언트에서 status=active 확정 금지
정적 사이트만으로 자동 승인 완성 금지
admin role 승인 요청 금지
device 계정 승인 요청 금지
Firebase Console 직접 조작 금지
Rules 우회 금지
Reset Data 금지
Delete Branch 금지
```

## 14. 리스크와 통제 장치

| # | 리스크 | 통제 장치 |
|---|---|---|
| 1 | 승인 요청 누락 | 접수 기준(§3) + pending 상태 추적 + 처리 SLA |
| 2 | 잘못된 role 승인 | 승인 판단 기준(§6) + role 후보 제한 + 2인 확인 |
| 3 | admin 계정 오발급 | admin role 승인 요청 금지(별도 강승인) |
| 4 | 퇴사자 접근 잔존 | status=inactive + terminated_* + K5C-0 게이트 |
| 5 | 기록 없는 수동 조작 | Console 직접 조작 금지 + 예외 절차(§12) 기록 의무 |
| 6 | uid/email 불일치 | 승인대기 화면 값과 대조 확인(§6-2,3) |
| 7 | 개인정보 과다 기록 | 메모 금지 항목(§9) 명시 |
| 8 | 승인 기준 불명확 | §6~8 기준 표준화 + decision_reason 필수 |

## 15. 다음 작업 후보

```text
K5F-4 — admin dashboard 승인 요청 목록 UI 골격
K5F-5 — read-only 승인 요청 목록 표시
K5F-6 — 수동 승인 처리 방식 재검토
K5G-1 — Firebase Functions 도입 의사결정 문서
```

> 자체 PASS 아님. Gene/ORION이 문서 내용 + Files changed 검토 후 PASS/HOLD 판정.
