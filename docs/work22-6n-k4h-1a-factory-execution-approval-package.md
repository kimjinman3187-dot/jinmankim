# WORK22-6N-K4H-1A — factory 계정/UID 실행 승인 패키지

기준일: 2026-06-11
작업 성격: **Gene 승인용 실행 패키지 문서** (계정/데이터/코드/Rules/배포 변경 없음)
기준 커밋: `origin/main = e7c7b70` (PR #80 merged 포함)
선행: K4A~K4H PASS

## 1. 작업 개요

K4H-1(실제 factory 계정 준비·UID 확보·users/{uid} 생성)을 실행하기 **전**, Gene가 승인할 수 있도록 실행 범위·대상·필드·매핑표·승인 항목·금지·검증·rollback을 한 문서로 패키징한다. 본 문서는 실행하지 않으며 승인 게이트 역할만 한다.

## 2. K4A~K4H PASS 요약

```text
K4A  factory 모바일 인증 정책 분리 (권장 기기 Google 계정)        PR #74
K4B  users 전체 read 제거 설계                                    PR #72
K4C  sessionStorage.yongjin_session 제거 설계                     PR #73
K4D  PIN Login 제거/축소 설계 (PC 제거 + factory 제한 유지)        PR #75
K4E  Anonymous Auth 제거/축소 설계 (factory 예외)                  PR #76
K4F  Firestore Rules UID 전환 설계                                PR #77
K4F-1 Rules 보안 보정 (accounting create 금지 / factory query 축소) PR #78
K4G  factory 기기/공용 Google 계정 + users/{uid} 발급 설계         PR #79
K4H  factory Google 전환 실행 체크리스트                           PR #80
```

## 3. K4H-1 실제 실행 전 승인 필요 사유

K4H-1은 **운영 인프라를 처음으로 실제 변경**한다(Firebase Auth 계정 생성 + Firestore users 문서 생성). 되돌리기 비용이 크고 보안·감사에 직접 영향하므로, 실행 전 Gene의 명시 승인이 필수다. 본 패키지는 그 승인 입력값을 고정한다.

## 4. factory 계정 준비 대상

- 운영 factory 사용자(6N-G0 실데이터 기준): `emp_factory`(name=공장, role=factory, status=active, auth_uid="", email 없음).
- 전환 방식(K4G 권장): **기기별 Google 계정(account_type=device)**. 단기 fallback shared, 장기 personal.
- 대상: 공장 현장 모바일 기기 수만큼 device 계정 발급(수량은 §8 매핑표에서 확정).

## 5. 기기별 계정명 후보

```text
factory-device-01
factory-device-02
factory-device-03
...
(기기 수량에 맞춰 확정. 공용 단기 사용 시 factory-shared-01)
```

## 6. Firebase UID 확보 절차

```text
1. 각 factory Google 계정 준비(기기별)
2. 해당 계정으로 1회 로그인
3. Firebase Console > Authentication > Users 에서 UID 확인
4. 아래 양식에 계정명/email/UID/기기/확인자/확인일 기록
5. UID ↔ email 일치 2인 검증
(주의: 본 작업에서는 실행하지 않음 — 승인 후 K4H-1 실행 작업에서 수행)
```

## 7. users/{uid} 생성 예정 필드

```js
users/{auth.uid} = {
  role: 'factory',
  status: 'active',
  name: 'factory-device-01',
  email: '<factory google email>',
  auth_uid: '<Firebase Auth UID>',   // == 문서 ID
  account_type: 'device',            // device | shared | personal
  device_id: '<optional>',
  site: 'factory',
  sort_index: <number>,
  created_at: <ts>, updated_at: <ts>,
  created_by: '<admin uid 또는 Gene>'
}
```
제약: role/status/auth_uid/account_type self-update 금지, status!=active 차단, **orders create 금지(K4F-1)**.

## 8. 기기-계정-현장 사용자 매핑표 양식 (실행 시 작성)

| 기기 | 계정명 | account_type | Google Email | Firebase UID | 담당/위치 | status | 확인자 | 확인일 |
|---|---|---|---|---|---|---|---|---|
| device-01 | factory-device-01 | device | (미정) | (미생성) | (미정) | active | | |
| device-02 | factory-device-02 | device | (미정) | (미생성) | (미정) | active | | |
| … | … | device | (미정) | (미생성) | (미정) | active | | |

> 모든 값은 승인·실행 후 채움. 현재는 양식만.

## 9. 실행 전 Gene 승인 항목

```text
[ ] factory Google 계정 생성 승인
[ ] Firebase Auth UID 확인 승인
[ ] users/{uid} 생성 승인
[ ] 기기별 account_type=device 사용 승인
[ ] factory PIN fallback 병행 유지 승인
[ ] 모바일 Google 버튼 구현은 별도 PR로 진행 승인
[ ] Rules 구현/배포는 별도 PR 및 Emulator 검증 후 진행 승인
```

## 10. 실행 금지사항 (본 K4H-1A 작업)

```text
Firebase Auth 계정 생성 금지 / Firebase Console 조작 금지 / users 데이터 생성·수정 금지
index.html·firebase-shared.js 수정 금지 / firestore.rules·database.rules.json 생성·수정 금지 / firebase.json 수정 금지
Rules 배포 금지 / Reset Data 금지 / main 직접 수정 금지 / Delete Branch 금지 / 최종 PASS 선언 금지
```

## 11. 실행 후 검증 항목 (K4H-1 실행 시)

```text
1. users/{uid} 문서 ID == auth_uid
2. role=factory / status=active / account_type=device
3. 기기 Google 계정으로 로그인 → loadCurrentUserFromAuthUser → currentUser 생성
4. ACCESS_MATRIX factory 권한 적용 + factory 화면 진입
5. production 입력 가능 / 타 화면 차단 / orders create 불가
6. PIN fallback 병행 동작(전환기)
7. audit_logs 기기 단위 기록 확인
```

## 12. rollback 기준

```text
- 계정/UID/users 생성은 기기 단위 점진 적용, 각 단계 회귀 테스트
- 문제 시 users/{uid}는 삭제 대신 status='suspended' 비활성(데이터 보존)
- factory PIN fallback은 전환 안정화 전까지 유지 → 즉시 복귀 가능
- 계정 분실/오발급 시 status=suspended + 세션 만료 + 기기 회수
- Delete Branch 금지, 브랜치 보존
```

## 13. 후속 작업 분기

```text
K4H-1 (승인 후): factory 계정/UID 준비 + users/{uid} 생성 실행
K4H-2: 모바일 Google Login 버튼 구현 (index.html, 별도 PR)
K4H-3: factory 현장 검증 (PIN 병행)
K4H-4~6: PIN fallback / Anonymous / users 전체 read 제거 (각 별도 승인)
K4H-7: Firestore Rules UID 전환 구현 (K4F/K4F-1 → Emulator → 수동 배포)
```

## 14. PASS 기준

```text
origin/main 최신(e7c7b70) 기준 / PR #80 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
승인 필요 사유 + 계정 준비 대상 + 계정명 후보 + UID 확보 절차 + users/{uid} 필드 + 매핑표 양식 포함
Gene 승인 항목(7개 체크박스) + 실행 금지 + 실행 후 검증 + rollback + 후속 분기 포함
Firebase Auth 계정 생성·users 데이터·코드·Rules·배포 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단. 본 패키지의 §9 승인 항목 체크는 Gene가 수행한다.
