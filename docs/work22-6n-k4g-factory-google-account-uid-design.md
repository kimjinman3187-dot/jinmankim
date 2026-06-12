# WORK22-6N-K4G — factory 기기/공용 Google 계정 및 users/{uid} 발급 설계

기준일: 2026-06-11
작업 성격: **설계 문서** (코드/Rules/Auth계정/데이터/배포 변경 없음)
기준 커밋: `origin/main = acf022a` (PR #78 merged 포함)
선행: K4A(#74), K4B(#72), K4C(#73), K4D(#75), K4E(#76), K4F(#77), K4F-1(#78)

## 1. 작업 개요

factory 모바일 PIN fallback을 제거하기 위한 **factory Google 계정/기기 계정 운영 방식**과 **`users/{uid}` 발급 구조**를 설계한다. 이는 K4E(Anonymous 완전 제거)·K4B(users 전체 read 제거)·K4F factory 예외 폐지의 공통 선행. 계정 생성·코드·Rules 변경은 하지 않는다.

## 2. 현재 factory 로그인 구조

```text
factory 모바일: PIN fallback → Anonymous Auth → syncUsers(users read) → roleGrid → tryLogin → sessionStorage.yongjin_session
```

- `loginWithGoogle()` 버튼은 **PC(`loginPC`, index.html:157)만** 존재. 모바일(`loginMobile`, 99)엔 없음 → factory 모바일 = PIN 전용.
- Google 파이프라인(`onAuthStateChanged`(1786)·`isGoogleAuthUser`(1771)·`loadCurrentUserFromAuthUser`·`loginWithGoogle`(1956))은 **뷰포트 무관** → 모바일 버튼 추가 + factory users/{uid}만 있으면 재사용 가능.
- `account_type` 필드는 현재 **미존재**(신규 설계 대상).

## 3. K4A~K4F-1 결론 요약

```text
K4A: factory 모바일 PIN 전용, 권장 기기/공용 Google 계정(C안 성격)
K4B: users 전체 read 제거 설계
K4C: sessionStorage.yongjin_session 제거(Google 비의존)
K4D: PC PIN 제거 + factory PIN 제한 유지
K4E: Anonymous는 비-Google(PIN)일 때만 시작, factory 예외
K4F: admin/sales/accounting UID 우선 + factory 예외
K4F-1: ① accounting orders create 금지 ② factory anonymous fallback 전 client query role=='factory' 축소
```

## 4. factory 계정 정책 선택지 A/B/C/D 비교

| 기준 | A(개인 Google) | B(기기별 Google) | C(공용 Google 1개) | D(PIN 유지) |
|---|---|---|---|---|
| 도입 난이도 | 높음(Gmail 수집) | 중간 | 낮음 | 없음 |
| 현장 UX | 마찰 | 단순 | 단순 | 현행 |
| 개인 책임 추적 | 강함 | 중간 | **약함** | 중간 |
| PIN 제거 | ✅ | ✅ | ✅ | ❌ |
| Anonymous 제거 | ✅ | ✅ | ✅ | ❌ |
| users 전체 read 제거 | ✅ | ✅ | ✅ | ❌ |
| Rules UID 전환 | ✅ | ✅ | ✅ | ❌ |
| 퇴사자/기기 분실 | 회수 용이 | 기기 회수 필요 | **공유 비번 위험** | - |
| 장기 적합성 | 높음 | 높음 | 낮음 | 낮음 |

- **A안**: 개인별 추적 최상이나 고령/현장 직원 Gmail 수집·UX 부담.
- **B안**: 기기별 계정(factory-device-01 등)으로 수집 부담↓·UX 단순·전환 가능. 추적성은 기기 단위.
- **C안**: 가장 단순·빠름이나 공용 비번/추적성 취약 → 단기 한정.
- **D안**: 병목 고착.

## 5. 권장안 — 기본 B안 (단기 fallback C안, 장기 A안)

**기본 권장: B안 — factory 기기별 Google 계정.** 단기 fallback C안(공용 1개), 장기 A안(개인 계정 + 현장 감사 보완)으로 진화.

1. **선택 이유:** 개인 Gmail 수집 부담 없이 UID 기반 전환 가능, 모바일 UX 단순, PIN/Anonymous/users read 제거 경로 확보. 추적성은 기기 단위로 확보(개인 추적 필요 시 A안).
2. **도입 난이도:** 중간(기기별 계정 발급 + users/{uid} 생성).
3. **현장 UX:** 기기 고정 Google 세션 → 로그인 마찰 최소.
4. **보안 리스크:** 기기 분실 시 계정 회수 절차 필요, 기기 세션 탈취 위험.
5. **감사 로그 리스크:** orders/audit_logs가 기기 단위로만 식별 → 개인 행위 추적 약화(보완: 기기-담당자 매핑 운영대장).
6. **퇴사자/기기 분실 리스크:** 기기 회수·계정 status='suspended' 전환·세션 강제 만료 절차.
7. **users/{uid} 필드 설계:** §6.
8. **모바일 Google Login 설계:** §7.
9. **PIN fallback 제거 조건:** §8.
10. **Anonymous 제거 조건:** §9.
11. **Rules factory 예외 제거 조건:** §11.
12. **rollback:** §18.

## 6. users/{uid} 문서 설계

```js
users/{auth.uid} = {
  role: 'factory',
  status: 'active',                 // active | suspended
  name: '공장기기01',                // 또는 factory-device-01
  email: '<factory google email>',
  auth_uid: '<Firebase Auth UID>',  // == 문서 ID
  account_type: 'device',           // device | shared | personal
  device_id: '<optional>',
  site: 'factory',
  sort_index: <number>,
  created_at: <ts>, updated_at: <ts>,
  created_by: '<admin uid 또는 Gene>'
}
```

| 기준 | 내용 |
|---|---|
| role/status/auth_uid/account_type | **사용자 직접 수정 금지**(admin/운영자만). Rules write 제한 |
| status != active | 접근 차단(activeUser 조건) |
| 권한 제한 | factory는 **orders create 금지**(K4F-1), 생산/출고 최소 권한만 |
| account_type | device(기본 권장) / shared(단기) / personal(장기) 구분 |

## 7. 모바일 Google Login 경로 설계

```text
1. 현재 loginWithGoogle()는 PC(loginPC)만 존재(157)
2. Google 파이프라인은 뷰포트 무관 → 재사용 가능
3. loginMobile에 Google Login 버튼 추가 검토 (또는 factory 전용 버튼)
4. factory 전용 버튼 별도 배치 검토(현장 단순화)
5. 성공 후: loginWithGoogle → onAuthStateChanged → loadCurrentUserFromAuthUser → users/{uid} → currentUser → ACCESS_MATRIX(factory: view[live,production,history]/write[production])
6. factory role 진입 화면: 모바일 ROLE_TABS.factory(['factory','history'])
7. 실패 시 fallback: 전환 과도기엔 factory PIN 제한 유지(K4G 미완 구간), 완료 후 PIN 제거
```

> 주의: §15 금지사항 — **실제 모바일 Google 버튼 추가는 본 작업 범위 아님**(설계만).

## 8. factory PIN fallback 제거 단계 (K4G-1 ~ K4G-11)

```text
K4G-1: factory 계정 정책 결정 (B안 기기별)
K4G-2: factory Google/기기 계정 목록 설계 (factory-device-01..N)
K4G-3: Firebase UID 확보 절차 (각 계정 1회 로그인 → Console Users → UID)
K4G-4: users/{uid}(role=factory, status=active, account_type=device) 생성 절차
K4G-5: 모바일 Google Login 진입 경로 설계 (loginMobile 버튼)
K4G-6: factory role 화면 진입 검증 절차
K4G-7: factory PIN fallback 제거 조건 정의 (아래)
K4G-8: Anonymous Auth 제거 조건 정의 (§9)
K4G-9: users 전체 read 제거 조건 정의 (§10)
K4G-10: Firestore Rules factory 예외 제거 조건 정의 (§11)
K4G-11: rollback 기준 작성 (§18)
```

**PIN fallback 제거 조건:** factory 기기 계정 + users/{uid} 발급 완료 + 모바일 Google Login 동작 검증 + 현장 회귀 통과.

## 9. Anonymous Auth 제거 연결 (K4E)

```text
조건: factory가 Google(B안)로 이행 → 비-Google PIN 경로 소멸 → startAnonymousPinBootstrap 트리거 사라짐
→ signInAnonymously 호출 경로 제거 가능. (factory 전환 100% 확인 후)
```

## 10. users 전체 read 제거 연결 (K4B)

```text
조건: factory PIN roleGrid 제거 → syncUsers 전체 read 불요 → users 전체 read 제거
중간 단계(K4F-1): factory PIN 잔존 구간엔 client query를 where('role','==','factory')로 축소(임시 안전장치)
factory Google 전환 후: roleGrid 자체 제거 → users는 loadCurrentUserFromAuthUser의 users/{uid} 단건 read만 남음
```

## 11. Firestore Rules factory 예외 제거 연결 (K4F/K4F-1)

```text
현행 예외(임시): anonymous + factory role 문서 최소 read 허용
제거 조건: factory가 Google UID + users/{uid} 보유 → 익명 예외 불요
→ orders read(factory)는 request.auth.uid 기반 users/{uid}.role=='factory'로 판정 (익명 예외 폐지)
→ users 전체 read 차단 규칙 전면 적용 가능
```

## 12. K4F-1 보정사항 연결

```text
보정1(accounting orders create 금지): K4G와 무관하게 Rules 구현 단계에서 유지(canCreateOrder=roleIn(['admin','sales']))
보정2(factory anonymous fallback query role=='factory' 축소):
 - K4G 전환 전 임시 안전장치(PIN 잔존 구간 permission-denied 방지)
 - K4G 완료 후: factory PIN fallback 자체 제거 → 해당 예외/축소 query도 제거 가능
```

## 13. 운영 리스크
- 기기 계정 수/배치 관리, 기기-담당자 매핑 운영대장 필요
- factory users/{uid} 미발급 시 전환 지연 → 의존 잔존 장기화
- 모바일 Google 세션 만료 시 현장 진입 지연

## 14. 보안 리스크
- 기기 세션 탈취/공유, 공용(C안) 비번 노출
- account_type/role/status self-update 차단 미흡 시 권한 위변조
- 전환 완료 전 PIN 평문(B3)·익명 컨텍스트 잔존

## 15. UX 리스크
- 현장 직원 Google 로그인 적응
- 모바일 Google 팝업/리디렉션 실패(도메인/네트워크)
- 전환기 PIN/Google 이원화 혼선

## 16. 감사 로그 리스크
- 기기/공용 계정은 audit_logs·orders가 기기 단위 식별 → 개인 행위 추적 약화
- 보완: 기기-담당자 교대 운영대장, 중요한 작업은 개인 계정(A안) 요구

## 17. 퇴사자/기기 분실 리스크
- 기기 분실: 계정 status='suspended' + 세션 강제 만료 + 기기 회수
- 퇴사자: 개인 계정(A안) 즉시 회수, 기기 계정은 비번 변경
- 외부 노출: 공용(C안) 장기 사용 금지

## 18. rollback 설계
- factory Google 전환은 **기기 단위 점진 적용**, 각 기기 전환 후 회귀 테스트.
- 전환 미완 구간엔 factory PIN fallback + K4F-1 축소 query 유지 → 문제 시 PIN 즉시 복귀.
- users/{uid}(factory)는 삭제 대신 status='suspended'로 비활성(데이터 보존).
- Anonymous/users 전체 read 제거는 factory 100% 전환 확인 후에만(K4E/K4B). 실패 시 revert(브랜치 보존, Delete Branch 금지).

## 19. 후속 작업 제안
```text
WORK22-6N-K4H 후보 — factory Google 전환 실행 체크리스트 및 회귀 검증(구현 전 준비)
이후: Rules 구현 단계(K4F+K4F-1 반영) → Emulator 검증 → 수동 승인 배포
```

## 20. 금지사항 준수 확인
```text
코드 변경 없음 / firestore.rules·database.rules.json 생성·수정 없음 / firebase.json 변경 없음
Firebase Console Rules 변경 없음 / Firebase Auth 계정 생성 없음 / users·orders 데이터 생성·수정 없음
Reset Data 미사용 / Rules 배포 없음 / 실제 client query 수정 없음 / 실제 모바일 Google 버튼 추가 없음
main 직접 수정 없음 / Delete Branch 없음 / K4A~K4F-1 브랜치 재사용 없음(신규 브랜치) / K3D hotfix 미접촉 / 최종 PASS 선언 안 함
```

## 21. PASS 기준
```text
origin/main 최신(acf022a) 기준 / PR #78 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
factory 현재 로그인 구조 조사 완료 / 계정 정책 A/B/C/D 비교 완료 / 권장안 제시 완료
users/{uid} 필드 설계 완료 / 모바일 Google Login 경로 설계 완료
PIN·Anonymous·users 전체 read·Rules factory 예외 제거 조건 작성 완료
K4F-1 보정 연결 완료 / 운영·보안·UX·감사·기기분실 리스크 포함 / rollback 포함
코드·Rules·Auth계정·데이터·배포 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.
