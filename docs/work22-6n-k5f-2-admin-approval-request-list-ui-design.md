# WORK22-6N-K5F-2 — 관리자 승인 요청 목록 UI 설계

기준일: 2026-06-12
작업 성격: **설계 문서** (코드/Rules/데이터/배포/Functions 환경 변경 없음)
기준 커밋: `origin/main = b874dda` (PR #91 merged 포함)

## 1. 현재 기준선

```text
K5F-1: C안 관리자 수동 승인 운영 구조 확정
A안 Functions: 장기 보류
B안 정적 사이트 단독 자동 승인: 금지
현재 repo: 정적 GitHub Pages 구조 (functions/·firebase.json·package.json·.firebaserc 없음)
원칙: users/{uid} 자동 생성·role 자동 부여·status=active 자동 확정·Console 직접 조작 금지
```

## 2. UI 설계 목적

admin이 승인대기 Google 사용자의 email/uid/요청 role/상태를 한 화면에서 확인하고 수동 승인 운영 판단 정보를 관리할 수 있게 한다. **이번 단계에서는 실제 승인/반려 기능을 구현하지 않는다**(설계만).

## 3. 승인 요청 목록 화면 위치

```text
PC: admin dashboard 내부, 초대코드 관리 카드(#pcAdminInviteCodePanel) 아래 별도 "승인 요청 목록" 카드(#pcApprovalRequestPanel 후보)
모바일: admin 화면(#adminInviteCodePanel 인접)에 별도 섹션 후보만 설계
표시 조건: currentUser.role === 'admin' 일 때만 노출 (기존 admin 패널 토글과 동일 패턴)
```
> 본 문서는 설계이므로 실제 index.html 수정은 하지 않는다.

## 4. 승인 요청 목록 컬럼 정의

| 컬럼 | 설명 |
|---|---|
| 요청일시 | requested_at |
| Google email | 로그인 계정 |
| Firebase uid | users/{uid} 예정 ID |
| 표시 이름 | displayName |
| 요청 role | sales / accounting / factory |
| 요청 경로 | google (초대코드/직접요청 등) |
| 상태 | pending/approved/rejected/on_hold/inactive |
| 승인자 | reviewed_by |
| 승인/반려 일시 | reviewed_at |
| 메모 | memo |

상태값: `pending / approved / rejected / on_hold / inactive`

## 5. 요청 상태값 정의

| 상태 | 의미 |
|---|---|
| pending | 승인 대기(기본) |
| approved | 승인됨(users/{uid} active 반영은 별도 안전 절차) |
| rejected | 반려 |
| on_hold | 보류(추가 확인 필요) |
| inactive | 비활성/퇴사 연계 |

## 6. 필터/검색/정렬 기준

```text
필터: 상태별, role별
검색: email, uid
정렬: 요청일시 최신순, 승인일시 최신순
```

## 7. 승인 상세 패널 설계

목록에서 한 사용자 선택 시 표시:
```text
email / uid / displayName / provider / 요청 role / 요청 사유 /
요청 일시 / 관리자 메모 / 처리 상태 / 처리자 / 처리 일시
```

## 8. 버튼 정책 (정책만 정의, 구현 없음)

| 버튼 | 정책 |
|---|---|
| 승인 | admin만. 승인 시에도 자동 active 확정 금지 — 실제 users/{uid} 반영은 별도 안전 절차(향후 Functions/SOP) |
| 반려 | admin만. status=rejected + 사유 기록 |
| 보류 | admin만. status=on_hold |
| 비활성 처리 | admin만. status=inactive + terminated_* (삭제 금지) |
| 메모 저장 | admin만. memo 갱신 |

> 이번 문서는 버튼 정책만. 실제 버튼/핸들러 구현 없음.

## 9. 권한/보안 정책

```text
admin만 승인 요청 목록을 볼 수 있다.
sales/accounting/factory 사용자는 접근할 수 없다.
factory-device-01(account_type=device)은 접근할 수 없다.
admin role은 일반 승인 요청으로 만들지 않는다(별도 강승인).
role 자동 부여 금지 / status=active 자동 확정 금지.
승인 처리의 실제 데이터 반영은 클라이언트 단독으로 하지 않는다(C안 원칙).
```

## 10. 데이터 모델 후보 (실제 생성 금지)

후보 컬렉션: `approval_requests/{requestId}`
```js
{
  uid: string,
  email: string,
  displayName: string,
  provider: 'google',
  requested_role: 'sales' | 'accounting' | 'factory',
  status: 'pending' | 'approved' | 'rejected' | 'on_hold',
  requested_at: timestamp,
  reviewed_by: string | null,
  reviewed_at: timestamp | null,
  memo: string | null
}
```
> 이번 단계 실제 컬렉션 생성 금지. requested_role에 admin/device 불가.

## 11. 구현 단계 분리안

```text
K5F-2: 승인 요청 목록 UI 설계 문서 (본 문서)
K5F-3: 승인 요청 기록 SOP 문서
K5F-4: admin dashboard UI 골격 추가 (index.html, read-only)
K5F-5: read-only 승인 요청 목록 표시
K5F-6: 수동 승인 처리 방식 재검토
K5G : Functions 도입 검토 (A안)
```

## 12. 금지사항

```text
index.html 수정 금지
실제 승인 버튼 구현 금지
users/{uid} 생성 금지
role 자동 부여 금지
status=active 자동 확정 금지
approval_requests 실제 생성 금지
Firestore Rules 수정 금지
Firebase Console 조작 금지
Functions 환경 생성 금지
Reset Data 금지
Delete Branch 금지
```

## 13. 리스크와 통제 장치

| # | 리스크 | 통제 장치 |
|---|---|---|
| 1 | 잘못된 role 승인 | requested_role 후보 제한(sales/accounting/factory) + 승인자 기록 + 2인 확인 |
| 2 | admin 계정 오발급 | 승인 요청에 admin role 불가, admin은 별도 강승인 |
| 3 | 승인 요청 누락 | 상태 필터(pending) + 처리 SLA(SOP, K5F-3) |
| 4 | 퇴사자 접근 잔존 | status=inactive + terminated_* + K5C-0 게이트 차단 |
| 5 | 승인 기록 누락 | reviewed_by/reviewed_at/memo 필수 기록 |
| 6 | 수동 조작 사고 | Console 직접 조작 금지(불가피 시 별도 승인) + 목록 UI 표준화 |
| 7 | Functions 도입 전 자동화 한계 | 자동 승인 미사용, 실제 active 반영은 안전 절차로만(C안) |

## 14. 다음 작업 후보

```text
K5F-3 — 관리자 승인 요청 기록 SOP 문서 자산화
K5F-4 — admin dashboard 승인 요청 목록 UI 골격 추가(read-only)
K5G-1 — Firebase Functions 도입 의사결정 문서
```

> 자체 PASS 아님. Gene/ORION이 문서 내용 + Files changed 검토 후 PASS/HOLD 판정.
