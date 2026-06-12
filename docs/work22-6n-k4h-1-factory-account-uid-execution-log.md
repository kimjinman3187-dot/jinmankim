# WORK22-6N-K4H-1 factory 계정/UID 실행 로그

기준일: 2026-06-11 (실값 보정: 2026-06-12)
작업 성격: **실행 결과 문서화(Area B)** — Gene 수동 실행(Area A) 결과 기록
기준 커밋: `origin/main = 230996e` (PR #81 merged 포함)

## ✅ 실행 데이터 상태

| 항목 | 상태 |
|---|---|
| Gene 승인 | ✅ 접수 완료 (7개 항목 승인) |
| Gene 수동 실행(Area A) 결과값 | ✅ **수신 완료** (2026-06-12, Gene 확인) |
| factory-device-01 계정/UID/users 생성 | ✅ 완료 |
| audit_logs 오생성 문서 | ✅ 삭제 완료 (Gene) |

> 본 로그는 Gene가 Firebase Console에서 직접 확인·복사한 실값으로 갱신되었다. UID는 Gene 제공값을 그대로 기록(추정·OCR 재구성 없음).

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

1차 pilot: `factory-device-01` (account_type=device) — **완료**.

| 기기번호 | 계정명 | account_type | email | Firebase UID | 담당/위치 | status | 확인자 | 확인일 |
|---|---|---|---|---|---|---|---|---|
| factory-device-01 | factory-device-01 | device | yjflow.factory01@gmail.com | Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2 | factory | active | Gene | 2026-06-12 |

## 4. Firebase Auth UID 확인 결과

```text
email: yjflow.factory01@gmail.com
uid: Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2
displayName/name: factory-device-01
로그인 성공 여부: 성공 (Gene 확인)
```

## 5. users/{uid} 생성 결과

| Firebase UID | users 문서 ID | role | status | account_type | device_id | legacyUserId | 검증 |
|---|---|---|---|---|---|---|---|
| Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2 | Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2 | factory | active | device | factory-device-01 | emp_factory | ✅ 일치 |

생성 필드:
```js
users/Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2 = {
  role: 'factory', status: 'active',
  name: 'factory-device-01', email: 'yjflow.factory01@gmail.com',
  auth_uid: 'Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2',
  account_type: 'device', device_id: 'factory-device-01',
  legacyUserId: 'emp_factory', site: 'factory', sort_index: 90,
  created_by: 'Gene'
}
```

## 6. 필드 검증

```text
- 문서 ID == auth_uid: ✅ 일치 (Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2)
- role == factory: ✅ 확인 완료
- status == active: ✅ 확인 완료
- account_type == device: ✅ 확인 완료
- device_id 기록: ✅ factory-device-01
- legacyUserId: ✅ emp_factory (기존 PIN 계정 추적 연결)
- self-update 금지 대상(role/status/auth_uid/account_type): 정책 확정(K4F-1), Rules 구현 시 강제(미배포)
- audit_logs 오생성 문서: ✅ 삭제 완료 (Gene)
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
| users 추가 변경 | factory-device-01 1건 생성(Gene, 승인 범위) + audit_logs 오생성 삭제(Gene) |
| factory PIN fallback | **병행 유지**(미제거) ✅ |
| 모바일 Google 버튼 | **미구현** ✅ |

## 8. rollback 기준

```text
- 문제 발생 시 users/{Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2}.status = 'suspended' (삭제 아님, 데이터 보존)
- factory PIN fallback 유지 → 즉시 기존 경로 복귀 가능 (legacyUserId=emp_factory 추적)
- 모바일 Google 버튼 미구현 → UI 영향 없음
- Rules 배포 없음 → 권한 통제 변화 없음
- 기기 단위 점진 적용, 실패 시 해당 기기만 suspended
- Delete Branch 금지, 브랜치 보존
```

## 9. 후속 작업

```text
K4H-2: 모바일 Google Login 버튼 구현 (index.html, 별도 PR)
K4H-3: factory 현장 검증 (PIN 병행) — factory-device-01 실기기 로그인 검증
K4H-4: PIN fallback 제거 (별도 승인)
K4H-5: Anonymous Auth 제거 (별도 승인)
K4H-6: users 전체 read 제거 (별도 승인)
K4H-7: Firestore Rules UID 전환 구현 (K4F/K4F-1 → Emulator → 수동 배포)
```

## 10. PASS 기준 대비 현황

| 기준 | 상태 |
|---|---|
| Gene 승인 범위 내 실행 | ✅ |
| factory Google 계정 준비 결과 기록 | ✅ yjflow.factory01@gmail.com |
| Firebase Auth UID 확인 결과 기록 | ✅ Zh2L0j1fy4Og1iIB9dKrrI0Ev8j2 |
| users/{uid} 생성 결과 기록 | ✅ 생성 완료 |
| 문서 ID == auth_uid 확인 | ✅ 일치 |
| role/status/account_type 확인 | ✅ factory/active/device |
| 매핑표 포함 | ✅ (실값) |
| PIN fallback 병행 유지 | ✅ |
| 모바일 Google 버튼 미구현 | ✅ |
| Rules 변경/배포 없음 | ✅ |
| Reset Data 미사용 | ✅ |
| 실행 로그 문서 1개 PR | ✅ (PR #82) |

→ **PASS 후보.** factory-device-01 계정/UID/users/{uid} 생성 실값 확정, ID==auth_uid 일치, 금지사항 전부 준수.

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.
