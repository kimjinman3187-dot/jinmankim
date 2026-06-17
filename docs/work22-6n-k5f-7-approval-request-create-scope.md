# WORK22-6N-K5F-7 — approval_requests 생성 UI/Rules 구현 범위 확정

기준일: 2026-06-12
역할: **저장소 구조 분석자 + 구현 범위 설계자** (구현 아님)
작업 성격: 분석/범위 확정 문서 (코드/Rules/데이터 변경 없음)

## 1. 기준 SHA
`origin/main = f2e258ab039d74fec99cc6de73279ec0e5c0232b` (PR #96 merged 포함; K5F-4/5/6 반영)

## 2. 분석한 파일 목록
- `index.html` (게이트 DOM, 승인요청 read-only 목록, Google 로그인 흐름, processLoginSuccess)
- repo 전체 트리(정적 GitHub Pages: `firestore.rules`·`firebase.json`·`functions/` 실행환경 **없음**)

## 3. Google 로그인 / 승인대기 게이트 위치

```text
Google 로그인 진입: loginWithGoogle() (PC #loginPC 버튼 / 모바일 #loginMobile 버튼)
세션 복원:        startGoogleAuthStateRestore() → onAuthStateChanged
신원 매핑:        loadCurrentUserFromAuthUser() → users/{uid} 없음/inactive/pending → gateReason
게이트 표시:      showApprovalGate(reason, authUser)  [index.html:2119]
게이트 DOM:       #googleApprovalGate  [index.html:176]  (email #gateEmail / uid #gateUid / 상태 #gateStatus)
재적용 가드:      reassertGate() [2109] + window hashchange 가드 [2101]  (#factory 등 직접접근 차단)
초대코드 블록:    #pendingInviteCodeInput / handlePendingInviteCodePreview() [2195] (read-only 검증, K5D-2)
admin 승인목록:   #pcApprovalRequestPanel [436] (read-only) ← loadApprovalRequestsReadOnly() [2544], approval_requests orderBy(requested_at).limit(50).get()
```

## 4. 승인 요청 UI 삽입 후보 위치 (확정)

**후보(권장): `#googleApprovalGate` 내부, 초대코드 블록(index.html:187–193) 아래 / `Google 계정전환` 버튼(194) 위**에 별도 "승인 요청" 카드 1개.

- 사유: 미승인 사용자는 이미 이 게이트에 머물고 email/uid가 표시됨 → 같은 화면에서 요청 생성이 자연스럽고 운영 화면 DOM과 분리됨.
- 구성:
  - `requested_role` **select** (옵션: sales / accounting / factory — **admin·device 없음**)
  - `request_reason` **textarea(선택 입력)** — 소속/사유 (민감정보 금지 안내)
  - `승인 요청 보내기` 버튼 → `createApprovalRequest()` (K5G-1에서 구현)
  - 결과 메시지 영역 1개 (textContent)
- email/uid/displayName은 입력받지 않고 `window.auth.currentUser`에서 서버 신원으로 사용(클라 위조 방지).

### 4-1. requested_role 선택 UI
게이트 카드 내 select. 화이트리스트 sales/accounting/factory 고정. admin/device 옵션 제공 금지.

### 4-2. request_reason 입력 필요 여부
**선택 입력 권장**(필수 아님). 승인 판단 보조(K5F-3 SOP의 request_reason). 비우면 빈 문자열. 민감정보 금지 안내 문구 포함.

## 5. approval_requests 생성 함수 후보 위치

- 위치: `handlePendingInviteCodePreview()`(index.html:2195) **인접**(같은 게이트 핸들러 그룹).
- 함수명 후보: `createApprovalRequest()`
- 동작(K5G-1 구현 예정):
  - 문서 ID = `request.auth.uid` (uid 기준 단건 → **중복 요청 방지**; 재요청 시 갱신 또는 "이미 요청됨" 안내)
  - set payload: `{ uid, email, displayName, provider:'google', requested_role(화이트리스트 검증), request_reason, status:'pending', requested_at: serverTimestamp() }`
  - role/status는 **요청값일 뿐 권한 아님** — 승인은 admin 별도 처리(K5F-6)
  - 성공/실패 메시지 + **게이트 유지**(processLoginSuccess 미호출, 운영 진입 없음)
- ⚠️ 본 K5F-7에서는 **위치 확정만**. write 구현은 K5G-1.

## 6. Firestore Rules 필요 여부 — **필요 (YES)**

- 현재 repo에 `firestore.rules` 파일 없음 → 배포 Rules는 Console에만 존재(내용 미상). approval_requests write를 미승인(승인대기) 사용자가 하려면 Rules에서 명시 허용 필요.
- 필요한 Rules(초안):
```text
match /approval_requests/{reqId} {
  // 본인 uid 문서만 생성, status=pending, role 화이트리스트
  allow create: if request.auth != null
    && reqId == request.auth.uid
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.status == 'pending'
    && request.resource.data.requested_role in ['sales','accounting','factory'];
  allow read:   if request.auth != null && (reqId == request.auth.uid || isAdmin());
  allow update, delete: if isAdmin();   // 승인/반려/보류는 admin (또는 향후 Functions)
}
```
- read는 admin 목록(K5F-5)과 본인 read 허용. update/delete(승인 처리)는 admin only.

## 7. Rules PR 분리 여부 — **분리 (YES)**

- **UI 구현 PR(클라이언트)과 Rules PR을 분리**한다. 보안 경계 변경은 독립 검토·롤백이 안전.
- 배포 순서 권장: **Rules PR 먼저 배포 → UI PR 나중**. (UI가 Rules보다 먼저 나가면 create가 permission-denied; Rules가 먼저면 UI 없어도 무해)
- 단 `firestore.rules` 파일이 repo에 없으므로, Rules 작업은 (a) firestore.rules 파일 신설 + (b) Console/CLI 배포 결정이 필요 → **K5G-1R(별도)** 로 분리. (Rules 배포는 Functions와 무관하게 Spark 요금제에서도 가능)

## 8. K5G-1 최소 구현 범위

```text
1. #googleApprovalGate에 requested_role select + request_reason(선택) textarea + "승인 요청 보내기" 버튼 추가
2. createApprovalRequest(): approval_requests/{auth.uid} set (status=pending, requested_at=serverTimestamp, requested_role 화이트리스트, email/uid는 auth에서)
3. 중복 요청 처리(이미 pending이면 안내), 성공/실패 메시지(textContent)
4. 게이트 유지 — 운영 화면 진입 없음, currentUser 운영세팅 없음
5. index.html 1개 파일 최소 변경
```

## 9. K5G-1 금지 범위

```text
users/{uid} 생성/update 금지
role 자동 부여 금지 / status=active 자동 확정 금지
승인/반려/보류 처리 구현 금지 (admin 처리 별도)
admin·device requested_role 금지
운영 화면 진입 금지 / processLoginSuccess 호출 금지
invite_codes used_count 증가 금지
Firestore Rules 파일 수정/배포 금지(별도 K5G-1R)
Firebase Console 조작 금지 / Reset Data·Delete Branch·main 직접 수정 금지
```

## 10. 기존 흐름 영향 분석

| 흐름 | 영향 |
|---|---|
| 기존 PIN 로그인 | **없음** (게이트/approval_requests는 미승인 Google 전용) |
| factory-device-01 (device/google/factory/active) | **없음** (users/{uid} active → 게이트 미발동) |
| sales/accounting/factory (승인된 Google) | **없음** (active → 게이트 미발동) |
| admin 승인목록(read-only) | **없음** (K5F-5 그대로, create와 독립) |
| 미승인 Google 사용자 | 게이트에 요청 생성 UI 추가됨(본인 문서만 write, 운영 진입 없음) |

## 11. 권장 다음 작업명

```text
K5G-1   — 승인 요청 생성 UI + approval_requests write (index.html, 클라이언트)
K5G-1R  — approval_requests Firestore Rules 신설/배포 (별도 PR, 보안 경계)
        (배포 순서: K5G-1R Rules 먼저 → K5G-1 UI 나중)
```
**K5F-7 이후 K5G-1로 진행 권장.** 단 write가 실제 동작하려면 K5G-1R Rules가 선행/병행되어야 함.

## 12. Codex 실행 지시문 초안 (K5G-1)

```text
WORK22-6N-K5G-1 — 미승인 Google 사용자 승인 요청 생성 UI 구현
기준: origin/main 최신(현재 f2e258a 이후), 신규 브랜치 fix/work22-6n-k5g-1-approval-request-create
변경 파일: index.html 1개만
구현:
  - #googleApprovalGate 초대코드 블록 아래에 승인요청 카드 추가
    (requested_role select: sales/accounting/factory, request_reason textarea(선택), '승인 요청 보내기' 버튼, 결과 메시지 div)
  - createApprovalRequest(): db.collection('approval_requests').doc(auth.currentUser.uid).set({
      uid, email, displayName, provider:'google',
      requested_role(화이트리스트 검증), request_reason(trim, 민감정보 금지 안내),
      status:'pending', requested_at: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:false})  // 이미 존재 시 안내
  - 성공/실패 textContent 메시지, permission-denied 안전 처리(raw error 미노출)
  - 게이트 유지: processLoginSuccess 미호출, 운영 DOM 미노출
금지: users 생성/role 부여/status active/승인처리/admin·device role/Rules 파일 수정·배포/Console/Reset Data/Delete Branch/main 직접수정
검증: git diff --check, JS 파싱, index.html 1개, write는 approval_requests/{본인uid}만
주의: Rules 미배포 시 permission-denied 가능 → K5G-1R(Rules PR) 선행/병행. PR 생성 후 Gene/ORION 최종 판정.
```

### 부록. 상태별 사용자 안내 기준(메시지 초안)
```text
pending   : "승인 요청이 접수되었습니다. 관리자 승인을 기다려 주세요."
on_hold   : "추가 확인이 필요합니다. 관리자에게 문의해 주세요."
approved  : "승인되었습니다. 다시 로그인하면 이용할 수 있습니다." (실제 active 반영은 안전 절차 후)
rejected  : "승인 요청이 반려되었습니다. 관리자에게 문의해 주세요."
inactive  : "비활성화된 계정입니다. 관리자에게 문의해 주세요."
```

> 자체 PASS 아님. Gene/ORION이 분석/범위 + (구현 시) Files changed 검토 후 PASS/HOLD 판정.
