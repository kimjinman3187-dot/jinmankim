# WORK22-6N-K3 신규 채팅방 인계문

작성일: 2026-06-11
작성: WORK22-6N-K3E
대상: 다음 작업자(신규 채팅방)

## 0. 한 줄 요약

Google Login **최소 운영 로그인은 완료(K3 PASS)**. 단 PIN/Anonymous/users 전체 read/Rules는 **아직 병행·미전환** 상태. 다음은 병행 구조 축소 설계(K4).

---

## 1. 현재 완료 기준

```text
WORK22-6N-K3B = PASS   (users/{uid} 매핑 정정)
WORK22-6N-K3C = PASS   (Finance permission 원인 조사)
WORK22-6N-K3D = PASS   (Finance 리스너 생명주기 수정, PR #68 merged)
WORK22-6N-K3  = PASS
```

기준 커밋: `origin/main = dc0e24e` (GitHub Pages built, 2026-06-11T06:45:22Z)

## 2. 현재 인증 구조 (동작 확인됨)

```text
Google Login 가능
auth.currentUser.uid 기준 users/{uid} read 성공
currentUser UI 상태 객체 구성 성공 (id/auth_uid/email/name/role/status/provider)
ACCESS_MATRIX 적용 성공
Google Login 경로에서 yongjin_session 저장 없음 (yongjin_session = null)
로그인·role 확정 후 yj:auth-ready 이벤트 → Finance 리스너 게이트 통과
```

검증된 Gene 계정 값:
```text
uid = xNrwQIcNh6MniXPOGD7J1nimb913
email = kimjinman3187@gmail.com
role = admin / status = active / provider = google
```

## 3. 아직 남은 구조 (미전환·주의)

```text
Anonymous Auth 병행          ← 제거 금지 (현재 PIN 부트스트랩이 의존)
PIN Login 경로 유지          ← 제거 금지
users 전체 read 경로 일부 유지 ← PIN 목록 구성용 syncUsers, PIN 노출(B3) 위험 잔존
모바일 factory PIN 보조 잠금 정책 미확정
Firestore Rules 최종 전환 미완료 ← 배포 Rules Google UID 기반 여부 미확정 (Emulator 검증 필요)
```

## 4. 절대 건드리지 말 것 (현행 금지)

```text
코드 임의 수정 금지 (구현은 Gene 승인 후, 최신 main 기준에서만)
firestore.rules 수정/배포 금지
users/orders 데이터 수정 금지, Reset Data 금지
PIN Login 제거 금지
Anonymous Auth 제거 금지
Delete Branch 금지 (특히 work22-6n-k3d-finance-listener-lifecycle 보존)
main 직접 수정 금지
```

## 5. 작업 시작 전 공통 기준 (매 작업 필수 확인)

```text
1. 현재 브랜치명
2. 현재 HEAD commit SHA
3. remote origin/main 최신 SHA (현재 dc0e24e)
4. 현재 브랜치가 origin/main 최신 기준인지
5. 열린 관련 PR 번호
6. 수정할 파일 목록
7. 수정하지 않을 파일 목록
규칙: 최신 main 아니면 코드 수정 금지 / PR base 오래되면 구현 금지 /
      같은 파일 다른 PR이 수정 중이면 구현 금지 / 조사는 코드 수정 없이 / 구현은 Gene 승인 후
```

## 6. 핵심 파일 지도

```text
index.html
  - Google Login: signInWithPopup(GoogleAuthProvider) (≈1963/2003)
  - onAuthStateChanged 복원: startGoogleAuthStateRestore (≈1780)
  - users/{uid}→currentUser: loadCurrentUserFromAuthUser (≈1927)
  - yj:auth-ready dispatch (K3D 추가)
  - 메인 orders 리스너(role 분기): ≈2228
  - 익명 부트스트랩: startAnonymousPinBootstrap (≈1761)
js/firebase-shared.js
  - Finance 리스너 3종 + yjCanStartFinanceListeners 게이트 (274~447)
js/work22-3h3i-finance-enhancement.js
  - Finance 요약카드 리스너 (≈440)
firestore.rules
  - 설계 초안만(미배포). Google UID 기반 전환은 K4B 대상
```

## 7. 관련 문서 (의도DB / repo docs)

```text
work22-6n-d-* (설계/검토), work22-6n-g0~g3 (B1/Provider/UID/마이그레이션/검증절차)
work22-6n-ia (Gene UID 테스트), work22-6n-k3c (Finance 권한 조사)
work22-6n-k3-...-completion (본 자산화), 2026-06-11-...-handoff (본 인계문)
```

## 8. 다음 작업 후보

```text
(권장) WORK22-6N-K4  — PIN/sessionStorage/Anonymous/users 전체 read 병행 구조 축소 순서 설계
       WORK22-6N-K4A — 모바일 factory PIN 보조 잠금 정책 설계
       WORK22-6N-K4B — Firestore Rules Google UID 기반 전환 설계 (Emulator 검증 전용)
권장 순서: K4 → K4A → K4B
```
