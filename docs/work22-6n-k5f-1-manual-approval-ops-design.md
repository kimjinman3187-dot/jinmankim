# WORK22-6N-K5F-1 — 관리자 수동 승인 운영 구조 설계

기준일: 2026-06-12
작업 성격: **설계 문서** (코드/Rules/데이터/배포/Functions 환경 변경 없음)
기준 커밋: `origin/main = d2f2d6e` (PR #90 merged 포함)

## 1. 현재 상태 요약

```text
K5A:   직원 개인 Google 승인 구조 설계 완료
K5C-0: 미승인 Google 계정 차단 UI 완료 (PR #87)
K5D-1: 초대코드 UI 골격 완료 (PR #88)
K5D-2: 초대코드 read-only 검증 완료 (PR #89)
K5E-1: Cloud Functions 환경 부재로 HOLD (PR #90, functions/README.md 환경점검 기록)
```
repo 구조: `index.html + js/ + docs/ + .nojekyll` 순수 정적 GitHub Pages 사이트. `functions/`(실행환경)·`firebase.json`·`package.json`·`.firebaserc` 없음(클라이언트 CDN Firebase only).

## 2. 의사결정 요약

```text
현재 채택: C안 — 자동 승인 보류, 관리자 수동 승인 구조
장기 목표: A안 — Firebase Functions 정식 도입
단독 금지: B안 — 정적 사이트만으로 자동 승인 완성 시도
```

## 3. A/B/C안 비교

| 항목 | A안 (Functions 도입) | B안 (정적 단독) | C안 (수동 승인) |
|---|---|---|---|
| 구현 난이도 | 높음(배포 스택 신설) | 낮음 | 낮음 |
| 보안성 | **높음(서버 확정)** | 낮음(클라 우회) | 중간(사람 검증) |
| 비용/운영 부담 | 높음(Blaze 과금·CLI·런타임) | 낮음 | 낮음 |
| 현재 repo 적합성 | 낮음(정적→배포 전환) | 높음 | **높음** |
| 자동화 수준 | 높음 | 중간(검증까지) | 낮음(수동) |
| 권한 상승 위험 | 낮음 | **높음(role/status 클라 결정)** | 낮음(admin 통제) |
| 추천 | 장기 목표 | **비권장** | **현재 채택** |

## 4. C안 채택 사유

```text
- 현재 repo는 정적 GitHub Pages 구조다.
- 서버 권한 없이 users/{uid} 생성, role 부여, status=active 확정, used_count 증가는 안전하지 않다.
- Cloud Functions 도입은 장기적으로 필요하지만 현재는 배포 구조/요금제/환경파일/운영 절차가 추가된다.
- 따라서 지금은 자동 승인을 보류하고 관리자 수동 승인으로 운영 안정성을 확보한다.
```

## 5. 관리자 수동 승인 운영 원칙

```text
1. 미승인 Google 사용자는 승인대기 화면에 머문다.
2. 승인대기 사용자는 운영 화면에 접근할 수 없다.
3. admin이 승인 전까지 users/{uid}를 자동 생성하지 않는다.
4. role은 admin이 결정한다.
5. role 후보는 sales/accounting/factory 중심으로 제한한다.
6. admin 계정은 일반 초대/수동 승인 흐름으로 만들지 않는다(별도 강승인).
7. 퇴사자는 삭제하지 않고 status=inactive 처리한다.
8. 기록 보존을 우선한다.
```

## 6. 승인 대상 정보 (관리자가 승인 전 확인)

| 항목 | 설명 |
|---|---|
| Google email | 로그인 계정 |
| Firebase uid | users/{uid} 문서 ID |
| 이름/표시명 | displayName 또는 email |
| 요청 role | sales / accounting / factory |
| 승인 요청 일시 | 요청 시각 |
| 승인 사유 | 입사/부서 등 |
| 승인자 | admin uid/이름 |
| 상태 | pending → active |

> 본 문서는 설계 문서이므로 실제 데이터 생성·기입은 하지 않는다.

## 7. 승인 절차

```text
1. 직원이 Google로 로그인한다.
2. users/{uid}가 없으면 승인대기 화면(K5C-0 게이트)에 머문다.
3. 직원이 관리자에게 email/uid를 전달한다.
4. 관리자는 role(sales/accounting/factory)을 확인한다.
5. 관리자는 승인 기록(요청자/role/사유/승인자/일시)을 남긴다.
6. 정식 Functions 도입 전까지 자동 승인 기능은 사용하지 않는다.
7. 실제 users/{uid} 반영은 별도 승인된 안전 절차에서만 수행한다.
```

**Firebase Console 직접 수정은 원칙적으로 금지**한다. 불가피한 임시 운영이 필요하면 **별도 승인 절차**(2인 확인·기록 남김)를 거쳐야 하며, 이는 임시 예외로만 허용하고 SOP에 기록한다.

## 8. 퇴사/비활성 처리 절차

```text
- 삭제 금지 (데이터 보존)
- status=inactive
- terminated_at 기록
- terminated_by 기록
- terminate_reason 기록
- Auth disabled는 장기적으로 서버/Admin SDK(A안) 도입 후 처리
```

## 9. 금지사항

```text
클라이언트에서 role 부여 금지
클라이언트에서 status=active 확정 금지
클라이언트에서 users/{uid} 생성 금지
정적 사이트만으로 자동 승인 완성 금지
admin role 초대코드 금지
Firebase Console 직접 조작 금지(불가피 시 별도 승인)
Rules 우회 금지
Reset Data 금지
Delete Branch 금지
```

## 10. 리스크와 통제 장치

| # | 리스크 | 통제 장치 |
|---|---|---|
| 1 | 승인 누락 | 승인 요청 목록 SOP(K5F-2/3) + 처리 SLA |
| 2 | 잘못된 role 부여 | role 후보 제한(sales/accounting/factory) + 승인자 기록 + 2인 확인 |
| 3 | 퇴사자 접근 잔존 | status=inactive 즉시 처리 + 게이트 차단(K5C-0) + 장기 Auth disabled(A안) |
| 4 | Console 수동 조작 사고 | 원칙 금지 + 불가피 시 별도 승인·기록 |
| 5 | admin 계정 오발급 | 초대/수동 승인 흐름에서 admin 생성 금지(별도 강승인) |
| 6 | 초대코드 유출 | 자동 승인 보류(C안)로 코드 단독 승인 불가 + (도입 시) max_uses/expires/allowed_domain/active |
| 7 | Functions 도입 전 보안 한계 | 자동 승인 미사용 + 사람 검증 + K5C-0 게이트로 운영 화면 차단 유지 |

## 11. K5F-2 이후 작업 후보

```text
K5F-2 — 관리자 승인 요청 목록 UI 설계
K5F-3 — 승인 기록 문서/SOP 자산화
K5G-1 — Firebase Functions 도입 의사결정 문서
K5G-2 — Functions 환경 도입 PR
K5G-3 — claimInviteCode 실제 배포/연결
```

## 12. 장기 A안 전환 조건

```text
1. Firebase Blaze 요금제 승인
2. Firebase CLI 운영자 지정
3. functions/package.json 생성 승인
4. firebase.json/.firebaserc 생성 승인
5. Functions 배포 절차 승인
6. Emulator 또는 테스트 절차 확보
7. 롤백 절차 확보
8. 운영 로그/감사 기록 확보
```
→ 위 8개가 모두 충족·승인되면 K5E-1 참조 구현(`functions/README.md`의 claimInviteCode)을 활성화하여 A안으로 전환한다. 본 C안 구조는 그 전환까지 운영 기준선으로 유지한다.

> 자체 PASS 아님. Gene/ORION이 문서 내용 + Files changed 검토 후 PASS/HOLD 판정.
