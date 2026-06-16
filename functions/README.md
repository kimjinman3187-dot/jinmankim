# WORK22-6N-K5E-1 — 초대코드 승인 Cloud Function 스캐폴드 (환경 점검 + 참조 구현)

기준일: 2026-06-12
기준 커밋: `origin/main = 7f965df` (PR #89 merged 포함)
판정: **HOLD** (§3 — Firebase Functions 환경 미존재)

## ⚠️ §3 환경 점검 결과 (먼저 읽을 것)

| 점검 항목 | 결과 |
|---|---|
| `functions/` 디렉터리 | **없음** |
| `firebase.json` | **없음** |
| `functions/package.json` / `functions/src/index.*` | **없음** |
| `.firebaserc` | **없음** |
| 사용 언어(JS/TS) | 해당 없음(Functions 환경 자체 부재) |
| Firebase 사용 방식 | **클라이언트 CDN only** (index.html에서 firebase-app/auth/firestore compat CDN 로드, 정적 GitHub Pages 사이트) |

→ repo는 `index.html + js/ + docs/ + .nojekyll`로 구성된 **순수 정적 사이트**다. Firebase Functions 도입 흔적이 **전혀 없다**.

## §3 판정에 따른 조치 (HOLD)

§3 기준: "functions 환경이 없으면 대규모 신규 Firebase Functions 환경을 임의로 만들지 않는다. functions/README 또는 docs에 환경 점검 결과를 보고하고 HOLD 보고한다. 단, repo에 이미 Firebase Functions 도입 흔적이 명확하면 기존 스타일에 맞춰 최소 구성만 추가한다."

- 도입 흔적 **명확하지 않음(전무)** → 예외 조항 미적용.
- 따라서 **배포 가능한 Functions 환경(`functions/package.json` + 의존성 + `firebase.json` functions 블록 + Node 런타임 + lock 파일)을 임의로 생성하지 않는다.**
- 본 문서는 §3 지시대로 **환경 점검 결과 + 참조용 함수 구현 + 도입 요건**만 기록한다. 실제 환경 채택은 Gene/ORION 승인 후 별도(K5E-2 등)에서 진행한다.

## 환경 채택 시 필요한 것 (Gene/ORION 결정 사항)

Cloud Functions를 도입하려면 아래가 신설되어야 하며, 이는 정적 사이트 repo에 **Node 배포 스택·과금(Blaze 요금제)·CI 파이프라인**을 추가하는 아키텍처 결정이다:

```text
functions/package.json   (firebase-functions, firebase-admin 의존성)
functions/index.js       (또는 src/index.ts)
functions/.eslintrc / tsconfig (선택)
firebase.json            (functions 블록 + 기존 hosting 설정과 병행 검토)
.firebaserc              (프로젝트 alias: yongjin-enterprise)
Node 런타임 버전 고정
Blaze 요금제 전환 (Functions 호출/Admin SDK 사용)
```

## 참조용 구현 — `claimInviteCode` (callable, 배포 아님)

> 아래는 환경 채택 시 `functions/index.js`(JS, Gen2 기준 예시)에 넣을 **참조 코드**다. 본 PR에서는 배포·실행하지 않으며, 클라이언트(index.html)에서 호출하지 않는다.

```js
// functions/index.js  (참조 — 환경 채택(K5E-2) 후 활성화)
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const ALLOWED_INVITE_ROLES = ['sales', 'accounting', 'factory'];
const FORBIDDEN_ROLES = ['admin', 'master', 'owner', 'system', 'device'];

function normalizeInviteCode(value) {
  return String(value || '').trim().toUpperCase();
}

function toMillis(v) {
  if (v == null || v === '') return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : ms;
}

exports.claimInviteCode = onCall(async (request) => {
  // 1) 인증 필수
  const auth = request.auth;
  if (!auth || !auth.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const uid = auth.uid;
  const email = auth.token?.email || '';
  const name = auth.token?.name || email;

  // 2) 코드 normalize
  const code = normalizeInviteCode(request.data?.inviteCode);
  if (!code) throw new HttpsError('invalid-argument', 'empty-code');

  const inviteRef = db.collection('invite_codes').doc(code);
  const userRef = db.collection('users').doc(uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) return { ok: false, reason: 'not-found' };
      const inv = inviteSnap.data() || {};

      // 3) invite_codes 검증
      if (inv.active !== true) return { ok: false, reason: 'inactive-code' };
      if (inv.revoked_at) return { ok: false, reason: 'revoked-code' };
      const role = inv.role;
      if (FORBIDDEN_ROLES.includes(role)) return { ok: false, reason: 'admin-role-forbidden' };
      if (!ALLOWED_INVITE_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
      const expMs = toMillis(inv.expires_at);
      if (expMs !== null && expMs < Date.now()) return { ok: false, reason: 'expired' };
      const used = Number(inv.used_count) || 0;
      const max = Number(inv.max_uses) || 0;
      if (max > 0 && used >= max) return { ok: false, reason: 'usage-limit-exceeded' };
      const allowed = String(inv.allowed_domain || '').trim();
      if (allowed) {
        const domain = (email.split('@')[1] || '').toLowerCase();
        if (domain !== allowed.toLowerCase()) return { ok: false, reason: 'domain-mismatch' };
      }

      // 4) users/{uid} 상태 확인
      const userSnap = await tx.get(userRef);
      if (userSnap.exists) {
        const u = userSnap.data() || {};
        if (u.status === 'active') return { ok: false, reason: 'already-approved' };
        if (u.status === 'inactive') return { ok: false, reason: 'inactive-user' };
      }

      // 5) users/{uid} 서버 생성 — role은 invite.role에서만, status/account_type/provider 서버 확정
      tx.set(userRef, {
        uid, auth_uid: uid, email, name,
        role,                       // invite_codes/{code}.role 에서만
        status: 'active',           // 서버에서만 확정
        approved: true,
        account_type: 'personal',   // 고정 (device/admin 생성 금지)
        provider: 'google',         // 고정
        approved_by: 'invite_code',
        approved_via: code,
        approved_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        terminated_at: null, terminated_by: null, terminate_reason: null
      }, { merge: true });

      // 6) used_count 증가 (transaction 내). arrayUnion 내부엔 serverTimestamp 불가 → Timestamp.now() 사용
      tx.update(inviteRef, {
        used_count: used + 1,
        updated_at: FieldValue.serverTimestamp(),
        used_by: FieldValue.arrayUnion({ uid, email, claimed_at: Timestamp.now() })
      });

      return { ok: true, role, status: 'active' };
    });

    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, role: result.role, status: 'active', message: '초대코드 승인이 완료되었습니다.' };
  } catch (error) {
    console.error('claimInviteCode failed', { code: error?.code, message: error?.message });
    return { ok: false, reason: 'internal' };
  }
});
```

### 설계 주의 (반영됨)
- role은 **클라이언트 입력이 아니라 invite_codes/{code}.role 에서만** 결정.
- status=active / account_type=personal / provider=google **서버 고정**. device·admin 계정 생성 금지.
- used_count 증가는 **transaction 내부에서만**. `arrayUnion` 내부 객체엔 `serverTimestamp()`를 직접 못 넣으므로 `Timestamp.now()`로 대체(§10 주의 반영).
- 에러는 raw 노출 금지 → `{ ok:false, reason }` 또는 HttpsError로만.

## 에러 reason 기준
`unauthenticated / empty-code / not-found / inactive-code / revoked-code / invalid-role / admin-role-forbidden / expired / usage-limit-exceeded / domain-mismatch / already-approved / inactive-user / permission-denied / internal`

## 후속 (Gene/ORION 승인 후)
```text
K5E-2: Firebase Functions 환경 정식 도입 결정 + functions/package.json/firebase.json/.firebaserc 구성 + Blaze 전환
       → 위 참조 코드 활성화 → emulator 테스트 → 배포
K5F  : 클라이언트(index.html)에서 httpsCallable('claimInviteCode') 연결 (승인 후 운영 진입)
```

> 자체 PASS 아님. 본 단계는 환경 점검 결과 보고 + 참조 구현 제시 + HOLD. 실제 Functions 환경 도입·배포·클라이언트 연결은 별도 승인 단계.
