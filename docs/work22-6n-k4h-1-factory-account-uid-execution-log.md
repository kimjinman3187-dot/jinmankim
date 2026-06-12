# WORK22-6N-K4H-1 factory 계정/UID 실행 로그

기준일: 2026-06-11
작업 성격: **실행 결과 문서화(Area B)** — Gene 수동 실행(Area A) 결과 기록
기준 커밋: `origin/main = 230996e` (PR #81 merged 포함)

## ⚠️ 실행 데이터 상태 (먼저 읽을 것)

| 항목 | 상태 |
|---|---|
| Gene 승인 | ✅ 접수 완료 (7개 항목 승인) |
| Gene 수동 실행(Area A) 결과값 | ❌ **본 작업자에게 미수신** (factory-device email/UID 미제공) |
| 실행 결과 prod 검증(읽기) | ❌ 운영 DB 읽기 범위 밖으로 차단됨(PII) — 수행 안 함 |
| 본 로그의 실제값 | **입력 대기** — 이메일/UID/생성 결과를 지어내지 않음 |

→ 본 문서는 **실행 로그 골격 + Area B 검증 사실**을 기록하며, Area A 실제값은 Gene 실행 결과 수신 후 채운다. 현재 상태 = **HOLD 후보**(실행 결과 미수신).

## 1. 작업 개요

K4H-1은 factory 기기별 Google 계정 + Firebase Auth UID 확보 후 `users/{uid}`(role=factory, status=active, account_type=device)를 준비하는 첫 실행 단계다. 실행은 Gene 수동 영역(Area A), 본 작업자는 결과 문서화·검증(Area B).

## 2. Gene 승인 항목

```text
[승인] factory Google 계정 생성
[승인] Firebase Auth UID 확인
[승인] users/{uid} 생성
[승인] account_type=device 사용
[승인] factory PIN fallback 병행 유지
[승인] 모바일 Google 버튼은 별도 PR
[승인] Rules 구현/배포는 별도 PR + Emulator 검증 후 진행
```

## 3. factory 계정 준비 결과

1차 pilot 기준: `factory-device-01` (account_type=device).

| 기기번호 | 계정명 | account_type | email | Firebase UID | 담당/위치 | status | 확인자 | 확인일 |
|---|---|---|---|---|---|---|---|---|
| factory-device-01 | factory-device-01 | device | **미수신** | **미수신** | 미수신 | active(예정) | Gene | 미수신 |

> email/UID는 Gene 실행 결과 수신 후 기입. 값 미수신으로 공란 유지(지어내지 않음).

## 4. Firebase Auth UID 확인 결과

```text
email: 미수신
uid: 미수신
displayName/name: factory-device-01(예정)
로그인 성공 여부: 미수신
```

## 5. users/{uid} 생성 결과

| Firebase UID | users 문서 ID | role | status | account_type | device_id | 검증 |
|---|---|---|---|---|---|---|
| 미수신 | 미수신(==auth_uid 예정) | factory | active | device | factory-device-01 | 대기 |

## 6. 필드 검증

```text
- 문서 ID == auth_uid: 대기(값 수신 후 검증)
- role == factory: 설계상 확정, 실데이터 대기
- status == active: 설계상 확정, 실데이터 대기
- account_type == device: 설계상 확정, 실데이터 대기
- device_id 기록: factory-device-01(예정)
- self-update 금지 대상(role/status/auth_uid/account_type): 정책 확정(K4F-1), Rules 구현 시 강제
```

## 7. 운영 상태 / 금지사항 준수 (Area B 검증 — 사실)

| 항목 | 상태(검증) |
|---|---|
| index.html 변경 | 없음 ✅ |
| js/firebase-shared.js 변경 | 없음 ✅ |
| Firestore Rules 변경 | 없음 ✅ (firestore.rules main에 부재) |
| database.rules.json 변경 | 없음 ✅ (부재) |
| firebase.json 변경 | 없음 ✅ (부재) |
| Rules 배포 | 없음 ✅ |
| orders 데이터 변경 | 없음 ✅ |
| Reset Data | 미사용 ✅ |
| Delete Branch | 미실행 ✅ |
| main 직접 수정 | 없음 ✅ (신규 브랜치) |
| factory PIN fallback | **병행 유지**(미제거) ✅ |
| 모바일 Google 버튼 | **미구현** ✅ |

## 8. rollback 기준

```text
- 문제 발생 시 users/{uid}.status = 'suspended' (삭제 아님, 데이터 보존)
- factory PIN fallback 유지 → 즉시 기존 경로 복귀 가능
- 모바일 Google 버튼 미구현 → UI 영향 없음
- Rules 배포 없음 → 권한 통제 변화 없음
- 기기 단위 점진 적용, 실패 시 해당 기기만 suspended
- Delete Branch 금지, 브랜치 보존
```

## 9. 후속 작업

```text
K4H-2: 모바일 Google Login 버튼 구현 (index.html, 별도 PR)
K4H-3: factory 현장 검증 (PIN 병행)
K4H-4: PIN fallback 제거 (별도 승인)
K4H-5: Anonymous Auth 제거 (별도 승인)
K4H-6: users 전체 read 제거 (별도 승인)
K4H-7: Firestore Rules UID 전환 구현 (K4F/K4F-1 → Emulator → 수동 배포)
```

## 10. PASS 기준 대비 현황

| 기준 | 상태 |
|---|---|
| Gene 승인 범위 내 실행 | ✅(승인 확인) |
| factory Google 계정 준비 결과 기록 | ⚠️ 골격만(값 미수신) |
| Firebase Auth UID 확인 결과 기록 | ⚠️ 미수신 |
| users/{uid} 생성 결과 기록 | ⚠️ 미수신 |
| 문서 ID == auth_uid 확인 | ⚠️ 대기 |
| role/status/account_type 확인 | ⚠️ 대기 |
| 매핑표 포함 | ✅(양식+pilot 행) |
| PIN fallback 병행 유지 | ✅ |
| 모바일 Google 버튼 미구현 | ✅ |
| Rules 변경/배포 없음 | ✅ |
| Reset Data 미사용 | ✅ |
| 실행 로그 문서 1개 PR | ✅(본 문서) |

→ **HOLD 후보.** 코드/Rules/금지 준수는 충족하나, **factory 계정/UID/users 생성의 실제 결과값이 미수신**이라 실행 PASS 핵심 항목(3~6)을 확정 기록할 수 없다.

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단. 실제값 수신 시 본 로그를 갱신한다.
