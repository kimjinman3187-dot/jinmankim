# WORK22-6N-K5G-1F — Firestore Rules 배포 전 안전검증

기준일: 2026-06-17
역할: **Firestore Rules 보안 경계 분석자 + Rules 파일 신설 준비자** (UI 구현자 아님 / Firebase deploy 실행자 아님)
작업 성격: 배포 전 안전검증 문서 (docs-only, 코드/Rules/데이터/배포 변경 없음)

---

## 1. 기준 SHA

`origin/main = 677af6d0d0758c3b3b80bc793c942c60530c3789`
(Merge PR **#98** — `docs/work22-6n-k5g-1r-firestore-rules-scope`; K5G-1R PASS 반영)

선행 상태: PR #98 merged · K5G-1R PASS · 다음 작업 K5G-1F · K5G-1(UI/write)은 K5G-1F 배포 이후.

## 2. 작업 브랜치

`docs/work22-6n-k5g-1f-rules-preflight-safety` (base: origin/main 677af6d)

## 3. 분석한 파일 목록

```text
[git/트리]          git ls-tree -r origin/main  → firestore.rules / firebase.json / .firebaserc / 루트 package.json 부재 재확인
[K5G-1R]            docs/work22-6n-k5g-1r-firestore-rules-scope.md (Rules 후보·배포 방식·docs-only 판정)
[K5F-6/7]           docs/work22-6n-k5f-6-approval-requests-create-design.md / ...k5f-7-...scope.md (필드/상태/role 화이트리스트)
[K4F]               docs/work22-6n-k4f-firestore-rules-uid-transition-design.md (Rules 헬퍼 모델 signedIn/activeUser/roleIn/isAdmin)
[기존 Rules 골격]   origin/test/work22-6n-d-google-login-auth-design:firestore.rules
                    ⚠️ "WORK22-6N-A DESIGN DRAFT ONLY / DO NOT DEPLOY" — main 미반영·미배포·운영본 아님
[Functions 환경]    functions/README.md (K5E-1: 정적 GitHub Pages + 클라 CDN, Functions HOLD, project alias=yongjin-enterprise)
[클라이언트]        js/firebase-shared.js (projectId='yongjin-enterprise')
```

---

## 4. 운영 Rules 백업 필요성 판단 — **필수 (CRITICAL, YES)**

### 4-1. 핵심 위험: Firestore Rules 배포는 "전체 교체"다

```text
firebase deploy --only firestore:rules 는 프로젝트의 활성 룰셋(ruleset) 전체를
repo의 firestore.rules 내용으로 "통째로 교체"한다. 추가(append)가 아니다.
```

→ 현재 운영(Console 배포) Rules에는 `users` / `orders` / `invite_codes` / `pending_users` 등 **기존 접근 규칙이 들어 있을 것**이나, 그 내용은 **저장소에 존재하지 않는다**(K5G-1R §4: 운영 Rules는 Console에만, 내용 미상).

따라서 운영 Rules **백업 없이** `firestore.rules`를 새로 만들어 배포하면:

| 시나리오 | 결과 |
|---|---|
| repo에 approval_requests 블록만 담아 배포 | 기존 users/orders/invite_codes/pending_users 규칙 **전부 소실** → 운영 로그인·주문·재무 **즉시 장애** |
| `test/work22-6n-d` 초안을 그대로 배포 | 그 초안은 운영본이 아님("DO NOT DEPLOY"). 운영과 다른 규칙으로 덮어써 **예측 불가 장애** |

### 4-2. ⚠️ 절대 가정 금지

`test/work22-6n-d:firestore.rules` 초안 = 운영 Rules 가 **아니다**. 미배포 설계본이다.
→ **백업은 반드시 "프로젝트에 실제 배포된 활성 룰셋"에서** 가져와야 하며, 저장소의 어떤 초안으로도 대체할 수 없다.

---

## 5. Firebase CLI 백업 가능 여부 — **부분적 (전용 pull 명령 없음 → REST API 권장)**

```text
- Firebase CLI에는 Firestore Rules 전용 "pull/get/export" 명령이 없다.
  (RTDB는 `firebase database:get`이 있으나, Firestore Rules에는 대응 명령 부재.)
  `firebase deploy --only firestore:rules`는 "push 전용"이라 백업에 못 쓴다.
- 신뢰 가능한 백업 경로 = Firebase Security Rules 관리 REST API (firebaserules.googleapis.com), 읽기(GET) 전용:
    1) 활성 릴리스 조회:
       GET https://firebaserules.googleapis.com/v1/projects/yongjin-enterprise/releases
       → cloud.firestore 릴리스의 rulesetName 확인
    2) 룰셋 소스 조회:
       GET https://firebaserules.googleapis.com/v1/projects/yongjin-enterprise/rulesets/{rulesetId}
       → 응답 source.files[].content 가 현재 운영 Rules 전문
- 인증: Gene/승인자의 Google 계정 OAuth 토큰 또는 서비스계정 필요(권한: Firebase Rules Viewer 이상).
  Claude Code는 이 토큰을 보유하지 않으므로 본 단계에서 백업을 실행하지 않는다(승인자 수행).
```

> 결론: CLI 단독 백업은 불가에 가깝지만, **Rules REST API GET(읽기 전용)** 으로 운영 Rules를 그대로 받아올 수 있다. 이는 배포가 아니라 조회이므로 안전하다.

## 6. Firebase Console 직접 조작 필요 여부 — **불필요 (백업은 읽기 전용으로 가능)**

```text
- 운영 Rules 백업은 §5의 Rules REST API GET(읽기 전용)으로 가능 → Console "조작"(변경) 불필요.
- Console Rules 탭에서 텍스트를 "복사"하는 것은 읽기 행위이며 설정 변경이 아니다.
  단, 오타·누락 위험이 있으므로 REST API GET이 더 안전·정확하다.
- 어느 경로든 Rules를 Console에서 "편집/저장/배포"하는 조작은 금지 대상이며 본 작업에서 하지 않는다.
```

---

## 7. firestore.rules 신설 시 기존 운영 Rules 보존 방법 (절차 확정)

```text
[원칙] repo firestore.rules = (운영 백업 전문) ∪ (approval_requests 신규 블록)  ← 반드시 SUPERSET
1. §5로 운영 활성 룰셋 source 백업 → docs/ 또는 별도 안전 저장소에 타임스탬프와 함께 보관
   (예: rules-backup/firestore.rules.yongjin-enterprise.<rulesetId>.<날짜>)
2. 백업 전문을 그대로 repo firestore.rules 초기 내용으로 둔다 (기존 users/orders/invite_codes/pending_users 규칙 보존)
3. 그 위에 approval_requests/{requestUid} match 블록만 "추가"한다 (§11 조건)
   - 추가 위치: match /{document=**} { allow read, write: if false; } 캐치올 "위"
4. `firebase deploy --only firestore:rules`의 사전 점검:
   - `firebase deploy --only firestore:rules --dry-run` 또는 배포 미리보기로 diff 확인
   - 백업본 ↔ 신규본 diff = "approval_requests 블록만 추가"인지 라인 단위 검증
5. 배포 후 즉시 스모크 테스트(§11)로 기존 컬렉션 접근이 그대로인지 확인
```

→ 절대 금지: approval_requests만 담긴 partial 파일 배포 / 초안(test/work22-6n-d) 배포 / 백업 없이 배포.

## 8. firebase.json firestore-only 구성의 안전성 — **안전 (YES)**

```json
{ "firestore": { "rules": "firestore.rules" } }
```

```text
- hosting / functions 블록 미포함 → GitHub Pages 정적 운영·Functions(HOLD)와 완전 분리 (K5G-1R §10-1).
- `firebase deploy --only firestore:rules`만 사용 → 다른 리소스(호스팅/함수/인덱스) 무영향.
- GitHub Pages는 firebase.json을 읽지 않으므로 정적 사이트 서빙에 영향 없음.
- 주의: 전체 `firebase deploy`(--only 미지정) 실행 금지. firestore:rules로만 한정한다.
```

## 9. .firebaserc project alias yongjin-enterprise 적절성 — **적절 (YES)**

```json
{ "projects": { "default": "yongjin-enterprise" } }
```

```text
- js/firebase-shared.js projectId='yongjin-enterprise' 와 일치 (functions/README.md K5E-1 alias와 동일).
- 배포 대상 프로젝트를 고정 → "엉뚱한 프로젝트로 배포" 사고 차단(안전성↑).
- alias 고정은 정적 운영에 영향 없음(배포 시 CLI만 참조).
```

---

## 10. K5G-1F에서 실제 파일 추가 여부 — **추가하지 않음 (docs-only 1회 더 닫음)**

판정 근거(중요 안전 조건 정합):

```text
- 운영 Rules 백업(§5)이 "아직 확보되지 않은" 상태에서 firestore.rules를 추가/배포하면
  전체 교체로 운영 규칙을 덮어쓸 위험(§4)이 그대로 남는다.
- 본 작업 역할 = "분석자 + 신설 준비자"이며 "deploy 실행자/UI 구현자 아님".
- 작업 기본 원칙: 즉시 deploy 금지, 백업 절차 선확정, 실제 파일 추가는 Gene/ORION 승인 후.
```

→ **K5G-1F = docs-only 안전검증 PR**(본 문서 1개). 즉시 커밋 가능한 `firestore.rules`/`firebase.json`/`.firebaserc` 전문은 **K5G-1R §15에 이미 참조 보관**되어 있으므로 여기서 중복 생성하지 않는다.
→ 실제 파일 추가 + 배포는 **운영 Rules 백업 확보를 전제로** 후속 단계로 분리한다:

```text
K5G-1F        (본 작업) : 배포 전 안전검증 — docs only, 파일·배포·백업실행 없음
K5G-1F-2      (후속)    : 운영 활성 룰셋 백업 실행(§5 REST API GET) + 백업본 저장 (승인자 인증 필요)
K5G-1F-IMPLEMENT (후속) : firestore.rules(=백업∪approval_requests) + firebase.json + .firebaserc 추가 PR
                          → dry-run diff 검증 → `firebase deploy --only firestore:rules` (승인자)
K5G-1         (후속)    : approval_requests 생성 UI/write 구현 (index.html) — 위 배포·검증 이후
```

---

## 11. K5G-1 UI/write 구현 전 필수 안전 조건 (게이트)

아래가 **전부 충족**되기 전에는 K5G-1(approval_requests write UI)을 진행하지 않는다.

```text
[백업]
1. 운영 활성 룰셋 source 백업 확보(§5) — 타임스탬프 + rulesetId 기록, 안전 보관
[파일 구성]
2. repo firestore.rules = 백업 전문 ∪ approval_requests 블록 (SUPERSET, §7) — partial/초안 금지
3. firebase.json = firestore 블록만(§8), .firebaserc = default: yongjin-enterprise(§9)
[검증 후 배포]
4. 배포 전 diff: 백업본 ↔ 신규본 = "approval_requests 추가만"인지 라인 검증(+ --dry-run)
5. `firebase deploy --only firestore:rules`로만 배포(Console 편집 금지, 전체 deploy 금지) — 승인자 수행
[배포 후 스모크 테스트 — 기존 운영 무손상 확인]
6. users/{uid} 단건 read 정상 / orders role별 read·write 정상 / invite_codes 흐름 정상 / pending_users 정상
7. approval_requests: 미승인 본인 create 성공 / 타인 uid create 거부 / 비본인 read 거부 / admin 목록 read 성공 /
   일반 사용자 update·delete 거부
[승인]
8. Gene/ORION이 4~7 결과를 검토·PASS — 그 후에만 K5G-1 착수
```

### 11-1. approval_requests Rules 후보 조건 (K5G-1R 재확인)

```text
match /approval_requests/{requestUid}
create:
  request.auth != null
  && requestUid == request.auth.uid
  && request.resource.data.uid == request.auth.uid
  && request.resource.data.email == request.auth.token.email
  && request.resource.data.status == 'pending'
  && request.resource.data.source == 'google_approval_gate'
  && request.resource.data.requested_role in ['sales','accounting','factory']
  && request.resource.data.reviewed_by == null
  && request.resource.data.reviewed_at == null
  && request.resource.data.decision_reason == null
  && request.resource.data.memo == null
  && !activeUser()                      // users/{auth.uid} active 문서가 없어야 함
read:
  isAdmin()                              // admin 전체(목록 list)
  || requestUid == request.auth.uid      // 본인 단건 get (본인조건 list 쿼리는 불가)
update, delete:
  isAdmin()                              // admin = users/{adminUid}.role=='admin' && status=='active'
```

> 기존 헬퍼(`signedIn`/`hasUserDoc`/`currentUser`/`currentRole`/`currentStatus`/`activeUser`/`roleIn`/`isAdmin`)는 운영 Rules 백업본에 정의되어 있어야 재사용 가능. 백업본에 없으면 approval_requests 블록과 함께 헬퍼도 보존/정의 필요(§7).

---

## 12. 이번 PR 변경 파일

```text
docs/work22-6n-k5g-1f-rules-preflight-safety.md   (신규, 본 문서 1개)
```

- index.html / firestore.rules / firebase.json / .firebaserc / functions / users·orders·invite_codes·pending_users : **변경 없음**

## 13. 금지사항 준수 여부

| 금지 항목 | 준수 |
|---|---|
| Firebase Console 조작 | ✅ 없음 |
| firebase deploy 실행 | ✅ 없음 |
| 실제 운영 Rules 덮어쓰기 | ✅ 없음 (백업 미확보 → 파일 추가 자체를 하지 않음) |
| index.html 수정 | ✅ 없음 |
| approval_requests write UI / createApprovalRequest 구현 | ✅ 없음 |
| users 생성·update / invite_codes / pending_users / orders 변경 | ✅ 없음 |
| Cloud Functions 생성 / package 설치 / npm install | ✅ 없음 |
| Reset Data / Delete Branch / main 직접 수정 | ✅ 없음 |
| firestore.rules / firebase.json / .firebaserc 실제 추가 | ✅ 없음 (docs-only, §10) |
| 자체 PASS 선언 | ✅ 없음 (Gene/ORION 판정 대기) |

## 14. Gene/ORION 검토 요청 사항

```text
1. 변경 파일이 docs 1개(work22-6n-k5g-1f-rules-preflight-safety.md)뿐인지 확인
2. §4 위험 인식 동의: Firestore Rules 배포 = 전체 교체이며, 백업 없는 firestore.rules 추가/배포는 운영 규칙 소실 위험
3. §5 백업 경로 승인: Rules REST API GET(읽기 전용)으로 운영 활성 룰셋 백업 — 승인자 인증으로 실행
4. §10 판정 승인: K5G-1F는 docs-only로 닫고, 실제 파일 추가는 K5G-1F-IMPLEMENT, 백업은 K5G-1F-2로 분리
5. §11 게이트 승인: 백업→SUPERSET 구성→diff/dry-run→firestore:rules 한정 배포→스모크 테스트→PASS 후 K5G-1
6. 후속 순서 확정: K5G-1F-2(백업) → K5G-1F-IMPLEMENT(파일+배포) → K5G-1(UI/write)
7. (백업 실행 권한) Rules REST API GET 또는 Console 복사 중 어느 경로로 백업을 확보할지 지정
```

> 자체 PASS 아님. Gene/ORION이 안전검증 내용 + 후속 분리(K5G-1F-2 / K5G-1F-IMPLEMENT) 착수 여부를 검토 후 PASS/HOLD 판정.
