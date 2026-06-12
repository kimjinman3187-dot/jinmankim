# WORK22-6N-K4H — factory Google 전환 실행 체크리스트

기준일: 2026-06-11
작업 성격: **실행 전 체크리스트 문서** (코드/Rules/Auth계정/데이터/배포 변경 없음)
기준 커밋: `origin/main = 680862f` (PR #79 merged 포함)
선행: K4A~K4G PASS

## 1. 작업 개요

K4G 설계를 실제 실행하기 전, factory Google 전환에 필요한 **준비·검증·제거·승인 체크리스트**를 확정한다. 모든 실행(계정 생성/users 생성/코드/Rules/배포)은 본 문서 범위 밖이며 Gene 승인 후 별도 작업.

## 2. K4G 결론 요약

```text
1. factory 모바일은 현재 PIN fallback 전용 (loginMobile에 Google 버튼 없음)
2. Google 인증 파이프라인은 뷰포트 무관 재사용 가능
3. 기본 권장: 기기별 Google 계정(account_type=device)
4. users/{uid}(role=factory, status=active, account_type=device) 발급 필요
5. factory Google 전환 후 PIN/Anonymous/users 전체 read/Rules factory 예외 제거 가능
```

## 3. factory 전환 목표 구조

```text
factory 기기 Google 계정 → Firebase UID → users/{uid}(role=factory,active,device)
→ Google Login(loginMobile 버튼) → loadCurrentUserFromAuthUser → currentUser
→ ACCESS_MATRIX(factory: view[live,production,history]/write[production]) → factory 화면
이후: PIN fallback / Anonymous / sessionStorage / users 전체 read / Rules factory 예외 제거
```

## 4. 계정 준비 체크리스트

```text
[ ] 1. factory 기기 수량 확인
[ ] 2. 기기별 계정명 규칙 확정 (예: factory-device-01, -02)
[ ] 3. 계정 유형 확정 (기본 device / 단기 shared / 장기 personal)
[ ] 4. 계정별 담당 기기/위치/사용자 매핑표 작성
[ ] 5. 계정 회수/분실/퇴사자 대응 정책 작성
[ ] 6. Gene 승인 전 계정 생성 금지
```

## 5. Firebase UID 확보 체크리스트

```text
[ ] 1. Google 계정 준비 후 최초 로그인 방식 결정
[ ] 2. Firebase Auth UID 확인 절차 작성 (Console > Authentication > Users)
[ ] 3. UID 기록 양식 작성 (계정명 / email / UID / 기기 / 확인자 / 확인일)
[ ] 4. UID ↔ 계정 email 불일치 검증 기준 작성
[ ] 5. Gene 승인 전 Firebase Auth 계정 생성/UID 수집 금지
```

## 6. users/{uid} 생성 체크리스트

필드 기준:
```js
{ role:'factory', status:'active', name:'factory-device-01', email:'<factory google email>',
  auth_uid:'<Firebase Auth UID>', account_type:'device', device_id:'<optional>',
  site:'factory', sort_index:<n>, created_at:<ts>, updated_at:<ts>, created_by:'<admin uid 또는 Gene>' }
```
체크리스트:
```text
[ ] 1. users/{uid} 문서 ID == auth_uid 확인
[ ] 2. role=factory 확인
[ ] 3. status=active 확인
[ ] 4. account_type=device 확인
[ ] 5. self-update 금지 필드(role/status/auth_uid/account_type) 명시
[ ] 6. status=suspended 시 접근 차단 기준 명시
[ ] 7. Gene 승인 전 users 데이터 생성/수정 금지
```

## 7. 모바일 Google Login 구현 전 체크리스트

```text
[ ] 1. 현재 loginWithGoogle()가 PC(loginPC:157)에만 있는지 확인 (확인됨: 모바일 없음)
[ ] 2. 모바일 loginMobile에 Google 버튼 추가 필요성 확인
[ ] 3. factory 전용 버튼 vs 공통 Google 버튼 결정
[ ] 4. Google Login 성공 후 loadCurrentUserFromAuthUser 흐름 확인
[ ] 5. currentUser.role=factory 진입 화면 확인
[ ] 6. 모바일 ROLE_TABS.factory(['factory','history']) 진입 확인
[ ] 7. 실패 시 PIN fallback 임시 유지 여부 결정
[ ] 8. 구현 전 Gene 승인 필요
```

## 8. factory 현장 검증 체크리스트

```text
[ ] 1. factory 기기에서 Google Login 성공
[ ] 2. users/{uid} 단건 read 성공
[ ] 3. currentUser 생성 성공
[ ] 4. ACCESS_MATRIX factory 권한 적용 성공
[ ] 5. factory 화면 진입 성공
[ ] 6. production 입력 가능 확인
[ ] 7. sales/admin/accounting 화면 접근 차단 확인
[ ] 8. orders create 불가 확인 (K4F-1)
[ ] 9. audit_logs 기록 기준 확인 (기기 단위 식별)
[ ] 10. 로그아웃/재로그인 확인
```

## 9. 제거 단계 체크리스트 (순서 강제)

```text
[ ] 1. factory Google Login 100% 성공 전 PIN fallback 제거 금지
[ ] 2. factory PIN fallback 제거 전 Anonymous Auth 제거 금지
[ ] 3. roleGrid 제거 전 users 전체 read 차단 금지
[ ] 4. factory UID 전환 전 Rules factory 예외 제거 금지
[ ] 5. K4F-1의 factory query role=='factory' 임시 축소 조건 유지
[ ] 6. 모든 제거는 별도 PR/별도 승인으로 진행
```

## 10. K4F-1 보정사항 유지 체크

```text
[ ] accounting orders create 금지 유지 (canCreateOrder = roleIn(['admin','sales']))
[ ] factory anonymous fallback query role=='factory' 축소 유지 (전환 완료 전)
[ ] 전환 완료 후 PIN fallback과 함께 축소 query/익명 예외 제거
```

## 11. 운영 리스크
- 기기-담당자 매핑 운영대장 미비 시 추적 혼선
- factory users/{uid} 미발급 시 전환 지연
- 기기 Google 세션 만료 시 현장 진입 지연

## 12. 보안 리스크
- 기기 세션 탈취/공유, 공용(shared) 비번 노출
- role/status/account_type self-update 미차단 시 권한 위변조
- 전환 완료 전 PIN 평문(B3)·익명 컨텍스트 잔존

## 13. UX 리스크
- 현장 직원 Google 로그인 적응
- 모바일 Google 팝업/리디렉션 실패(도메인/네트워크)
- 전환기 PIN/Google 이원화 혼선

## 14. 감사 로그 리스크
- 기기/공용 계정은 audit_logs·orders가 기기 단위 식별 → 개인 행위 추적 약화
- 보완: 기기-담당자 교대 운영대장, 중요한 작업은 개인 계정(A안)

## 15. rollback 기준
- factory Google 전환은 **기기 단위 점진 적용**, 각 기기 전환 후 회귀 테스트
- 전환 미완 구간: factory PIN fallback + K4F-1 축소 query 유지 → 문제 시 PIN 즉시 복귀
- users/{uid}(factory): 삭제 대신 status='suspended' 비활성(데이터 보존)
- Anonymous/users 전체 read/Rules 예외 제거는 factory 100% 전환 확인 후에만, 실패 시 revert(브랜치 보존, Delete Branch 금지)

## 16. Gene 승인 게이트

```text
[ ] 계정 생성 전 승인 (factory 기기 Google 계정)
[ ] users 데이터 생성 전 승인 (users/{uid} 생성)
[ ] 코드 구현 전 승인 (모바일 Google 버튼)
[ ] Rules 구현 전 승인 (K4F/K4F-1 반영)
[ ] 배포 전 승인 (Emulator 통과 후 수동 배포)
```

## 17. 후속 작업 분기

```text
K4H-1: factory 계정/UID 준비 실행 (Firebase Auth 계정/UID 확인 + users/{uid} 생성, Gene 승인 필수)
K4H-2: 모바일 Google Login 버튼 구현 (index.html 수정 가능, PR 검증 필수)
K4H-3: factory 현장 검증 (실제 기기, PIN fallback 유지 상태 병행 검증)
K4H-4: factory PIN fallback 제거 (Google 안정화 후 별도 승인)
K4H-5: Anonymous Auth 제거 (factory PIN 제거 후 별도 승인)
K4H-6: users 전체 read 제거 (roleGrid 제거 후 별도 승인)
K4H-7: Firestore Rules UID 전환 구현 (K4F/K4F-1 반영 → Emulator 검증 → 수동 승인 배포)
```

## 18. 금지사항 준수 확인
```text
코드 변경 없음 / firestore.rules·database.rules.json 생성·수정 없음 / firebase.json 변경 없음
Firebase Console Rules 변경 없음 / Firebase Auth 계정 생성 없음 / users·orders 데이터 생성·수정 없음
Reset Data 미사용 / Rules 배포 없음 / 모바일 Google 버튼 실제 추가 없음 / client query 실제 수정 없음
main 직접 수정 없음 / Delete Branch 없음 / K4A~K4G 브랜치 재사용 없음(신규 브랜치) / K3D hotfix 미접촉 / 최종 PASS 선언 안 함
```

## 19. PASS 기준
```text
origin/main 최신(680862f) 기준 / PR #79 merge 반영 확인 / 신규 브랜치 / 문서 1개만 변경
계정 준비·UID 확보·users/{uid} 생성·모바일 Google Login 구현 전·현장 검증·제거 단계 체크리스트 포함
K4F-1 보정 유지 체크 + Gene 승인 게이트 + 후속 작업 분기(K4H-1~7) + rollback 포함
코드·Rules·Auth계정·데이터·배포 변경 없음
```

> 최종 PASS는 Gene / ORION이 GitHub Files changed 직접 검토 후 판단.
