# WORK29 문서결재 전수 검토 및 첨부파일 V1 구현 보고

- 작업 ID: `WORK29-DOCUMENT-APPROVAL-AUDIT-AND-FILE-ATTACHMENT-V1-01`
- 일자: 2026-07-22
- 저장소: `kimjinman3187-dot/jinmankim`
- 기준 Branch: `main`
- 기준 commit: `2ebceb4` (`Merge pull request #165 ... work28-invite-code-admin-read-rules-01`)
- 작업 worktree: `.../4_일정관리/202506/jinmankim-work29`
- 작업 Branch: `work29-document-approval-file-attachment-v1-01`

## 1. 목적과 범위

용진FLOW 문서결재 기능을 실제 코드 기준으로 전수 검토하고, 누락된 **일반 문서 증빙파일 첨부 기능**을 PC 환경에 구현한다.

- 포함: PC 문서결재 첨부(선택), 업로드/조회/다운로드, Firestore/Storage 보안 규칙, 실패 rollback.
- 제외: 인벤토리 엑셀 파싱·재고 반영, 모바일 문서결재, WORK28 초대코드 UI, 직원 초대 기능.

## 2. 기존 기능 전수 검토 결과

| 영역 | 항목 | 상태 |
|---|---|---|
| 직원 PC (`employee-document-requests.js`) | 활성 직원만 접근 / Auth UID 일치(fail-closed) | 구현 완료 |
| | 제목·상세 검증(2~80 / 2~1000) Rules 일치 | 구현 완료 |
| | 중복 클릭 차단(`state.submitting`+disabled) | 구현 완료 |
| | 본인 요청 목록/상태 필터/상세, 새로고침 유지 | 구현 완료 |
| | 안전 DOM(`textContent`/`createElement`) | 구현 완료 |
| | **실제 파일 선택·업로드** | **미구현 → 본 작업에서 구현** |
| 관리자 PC (`approval.js`) | active admin+Auth UID 일치, 트랜잭션 내 재검증 | 구현 완료 |
| | pending/on_hold/approved/rejected/cancelled/전체 필터 | 구현 완료 |
| | 승인·반려·보류 전이, 요청+history 동일 트랜잭션 | 구현 완료 |
| | 반려·보류 사유 필수 / 승인 의견 선택 | 구현 완료 |
| | 중복 처리·상태 경합 차단 | 구현 완료 |
| | schemaVersion 1 요청 계속 처리 | 구현 완료 |
| Operations Hub (`live-operations-hub.js`) | 문서결재 status 집계(pending/on_hold)만 소비 | 구현 완료(무변경) |
| Firestore Rules (`firestore.rules`) | schemaVersion 1 text-only 계약 | 구현 완료 |
| | create shape 가 `status=="pending"` 고정 → **draft 생성 불가** | 결함/제약 → 본 작업에서 unified create 로 확장 |
| | 첨부 스키마 | 미구현 → 본 작업에서 구현 |
| Firebase SDK (`firebase-shared.js`, `index.html`) | app/auth/firestore compat 로드 | 구현 완료 |
| | **Storage SDK 미로드 / `window.storage` 없음** | 미구현 → 본 작업에서 추가 |
| `firebase.json` | firestore rules/indexes 만 | Storage 미연결 → 본 작업에서 연결 |
| `firestore.indexes.json` | 문서결재 2개 query 인덱스 존재 | 구현 완료(무변경, 신규 query 없음) |

발견한 주요 결함/제약: 기존 create 규칙이 `status == "pending"` 을 강제하여 첨부용 draft 문서를 만들 수 없었다. 첨부 없는 기존 흐름과의 하위호환을 유지하면서 draft 경로를 추가하는 것이 핵심 과제였다.

## 3. 구현한 기능 (첨부 V1)

- PC 문서결재 전용. 첨부는 선택 사항이며, 첨부 없이 제목·상세만 제출하는 기존 흐름은 그대로 유지.
- 최대 5개 / 파일당 10MB / 합계 30MB.
- 허용 확장자: PDF, PNG, JPG·JPEG, XLS·XLSX, CSV, DOC·DOCX, HWP·HWPX.
- 확장자 + MIME type 동시 검증. HWP/CSV 등 브라우저가 형식을 특정 못 하는 경우 확장자 기준 canonical MIME 을 지정하고, 상반된 MIME 은 거부.
- 직원 화면: 파일 선택 영역, 파일명·용량 표시, 제출 전 개별 제거, 안내 문구, 업로드 진행 표시, 제출 중 버튼·이벤트 차단, 본인 상세 첨부 목록·다운로드.
- 관리자 화면: 목록에 "첨부 N개" 표시, 상세에서 파일명·용량·형식 + 관리자 다운로드, 승인·반려·보류 후 첨부 메타데이터 보존.
- 파일명·사용자 입력은 `innerHTML` 미사용, `textContent`/`createElement` 로만 렌더.

## 4. 데이터 구조 / 스키마 변경

첨부 있는 신규 요청은 `schemaVersion: 2`, 없는 요청은 기존 `schemaVersion: 1` 유지.

요청 문서 추가 필드(schemaVersion 2):

- `attachments`: 슬롯 맵 `{ a0..a4: { slot, name, storagePath, contentType, size } }`
- `attachmentCount`: 정수 1~5
- `attachmentsTotalSize`: 정수 1~31457280 (30MB)

Firestore 에는 **영구 공개 URL·다운로드 토큰을 저장하지 않는다.** 다운로드는 `storagePath` 로 그때그때 `getDownloadURL()` 호출.

Storage 경로: `document-approval-attachments/{requesterUid}/{requestId}/{slot}` (원본 파일명은 경로로 사용하지 않고 메타데이터로만 저장).

## 5. 제출 순서와 실패 복구

1. 작성자 소유 `draft` 요청 생성(schemaVersion 2, `submittedAt: null`, 첨부 메타데이터 포함). requestId 는 `collection().doc()` 로 선발급해 storagePath 를 확정.
2. draft 의 requestId 로 Storage 에 파일 업로드(성공 경로 추적).
3. 전 파일 업로드 성공 후 Firestore 트랜잭션: `draft → pending` 전이 + `submitted` history 를 같은 트랜잭션에서 기록.
4. 성공 시 직원 목록 새로고침.

실패 시 rollback(`rollbackDraft`): 성공한 업로드 파일 삭제 시도(→ draft 단계 Storage delete 허용) 후 draft 문서 삭제. 정리 실패 시 성공 메시지를 표시하지 않고 requestId 를 사용자에게 안내. pending 요청을 남기지 않는다. draft 삭제는 요청자 본인의 미제출 draft 에만 허용.

## 6. 보안 계약

### Cloud Firestore (`firestore.rules`)

- active 직원만 본인 요청 생성, `requesterUid == auth.uid`, `users/{uid}` 의 name·role 과 payload 일치.
- 생성은 unified shape 하나로 v1(pending, 첨부 없음) / v2(draft, 첨부 있음) 검증. v1 경로에는 attachment 키 금지, v2 경로는 attachment 메타데이터 검증.
- attachment 메타: 개수 1~5, 합계 ≤30MB, 슬롯 키 `a0..a4` 만, 각 항목 키 hasOnly, `storagePath` 정확성, 파일당 ≤10MB.
- 타 직원 요청 조회 차단, admin 만 전체 조회·결재.
- 제출 후 attachment 불변: user/admin update 의 `affectedKeys().hasOnly()` 허용 목록에 attachment 키가 없어 변경 시 자동 차단.
- history 없는 상태 전이 차단(parent-history 정합성 검증 유지).

### Firebase Storage (`storage.rules`, 신규)

`firebase.json` 에 Storage Rules 경로 연결.

- 비로그인 접근 차단, inactive 업로드 차단.
- 요청자 본인의 draft 경로에만 업로드. 기존 객체 덮어쓰기 차단(`resource == null`).
- draft 단계에서 요청자 본인 삭제 허용(rollback), pending 이후 수정·삭제 차단(요청 status 가드).
- active admin 또는 요청자 본인만 읽기. 공개 읽기·임의 경로 차단.
- 파일당 10MB, 확장자 대응 canonical MIME 만 허용.

## 7. 변경 파일

| 파일 | 변경 요약 |
|---|---|
| `index.html` | Storage compat SDK 스크립트 1개 추가, 직원 폼에 첨부 UI(입력/목록/진행) 추가 |
| `js/firebase-shared.js` | `initializeFirebase()` 에 `window.storage` 초기화(가드 포함) |
| `js/employee-document-requests.js` | 첨부 선택·검증·목록·제거 UI, draft→업로드→트랜잭션 제출, rollback, 첨부 표시·다운로드 |
| `js/approval.js` | 목록 첨부 배지, 상세 첨부 목록·관리자 다운로드 |
| `firestore.rules` | unified create shape, attachment 검증, draft 삭제 허용, update 분리+`resource != null` 가드 |
| `firebase.json` | Storage rules 연결, 로컬 emulator 설정(firestore/storage) |
| `storage.rules` (신규) | 첨부 Storage 보안 규칙(cross-service Firestore 검사 인라인) |
| `firestore.indexes.json` | 변경 없음(신규 query 없음) |
| `tests/rules/*` (신규) | `@firebase/rules-unit-testing` 기반 Firestore/Storage 규칙 테스트 |

## 8. 테스트 환경과 결과

- Node v24, Java 21(Temurin), firebase-tools 15.15.0.
- `@firebase/rules-unit-testing` + Firebase/Storage 에뮬레이터. 운영 데이터·운영 Storage 미사용(에뮬레이터 격리).
- 정적 검증: JS syntax(3개 파일) OK, 중복 DOM ID 없음, `git diff --check` clean, `innerHTML`/다운로드 토큰 저장 없음, Storage SDK 단일 로드, auth init 가드로 중복 listener 방지, WORK28/초대코드 코드 혼입 없음.

규칙 검증(에뮬레이터):

- **Firestore 규칙: 26/26 통과.** (비로그인/inactive/UID 불일치 생성 차단, v1 하위호환, draft(v2) 생성, 잘못된 storagePath/키/개수/용량 차단, 타 직원 조회 차단, draft→pending 제출, 제출 후 attachment 변조 차단, admin 승인+history, history 불일치 차단, draft 삭제 규칙 등)
- **Storage 규칙: 17/17 통과.** (비로그인·타직원·inactive 차단, 본인 draft 업로드, 형식/10MB/덮어쓰기/임의경로 차단, active admin·본인 읽기, draft rollback 삭제 허용, pending 이후 삭제 차단 등)

## 9. 미검증 / 남은 위험

- **메모리 제약으로 인한 실행 방식:** 본 PC(RAM 8GB)에서 Firestore+Storage 에뮬레이터를 **한 프로세스로 동시 실행**하면 메모리 압박으로 일부 케이스가 간헐 실패(flaky)한다. 그래서 Firestore 스위트와 Storage 스위트를 **분리 실행**했고, 각각 100% 통과했다. CI 등 여유 있는 환경에서는 단일 실행 권장.
- **Firestore 1000-expression 한도:** 에뮬레이터가 원본 update shape 를 포함한 큰 규칙에서 한도에 민감했다. 이를 위해 create 를 unified shape 로 합치고 update 를 두 allow 문으로 분리+`resource != null` 가드했다. (기능/보안 계약은 동일, 식 개수만 절감)
- **Firestore 규칙의 contentType allow-list:** 확장자↔MIME allow-list 강제는 실제 업로드 경계인 `storage.rules` 에서 수행하고, Firestore 는 구조/경로/크기/개수만 검증한다(한도 회피 목적의 의도적 분담).
- **rollback Storage 정리:** draft 단계 삭제로 실제 정리가 가능하나, draft 문서 삭제까지 실패하는 극단적 경우 orphan blob 이 남을 수 있어 requestId 를 사용자에게 안내한다(운영 시 서버측 lifecycle 정리 권장).
- E2E(실브라우저) 업로드·다운로드는 미수행. 운영 배포 전 스테이징 브라우저 검증 권장.

## 10. Firebase 영향 구분

- Authentication: 변경 없음.
- Cloud Firestore: 규칙 확장(첨부 스키마·unified create·update 분리). 인덱스 변경 없음. **배포 미수행.**
- Realtime Database: 해당 없음.
- Storage: 신규 `storage.rules`, `firebase.json` 연결. **배포 미수행.**
- Security Rules: Firestore/Storage 모두 에뮬레이터 검증 완료, **운영 배포 미수행.**
- PC 연동: 직원 첨부 작성/업로드/조회, 관리자 목록·상세·다운로드 구현.
- 모바일 연동: 변경 없음(PC 전용 UI, 모바일 미노출).

## 11. 운영 배포 전 필요 작업

1. Gene 의 코드 검토 및 Draft PR → Ready 전환 승인.
2. `firebase deploy --only firestore:rules,storage` (Storage Rules 최초 배포).
3. Firebase Console 에서 Storage 버킷·CORS 확인.
4. 스테이징 브라우저 E2E(첨부 1/5개, 실패 rollback, 관리자 다운로드) 검증.

## 12. 후속 인벤토리 엑셀 승인 기능과의 경계

본 작업의 "문서 업로드" 는 일반 문서결재 증빙 첨부까지다. 인벤토리 엑셀을 파싱해 재고 변경안을 만들고 승인 후 재고에 반영하는 기능은 별도 후속 작업이며 본 범위에 포함하지 않는다. 첨부 스키마(schemaVersion 2)는 향후 엑셀 승인 payload 확장과 독립적으로 설계되었다.

---

## 13. WORK29 PR #166 코드 검토 보정 (2026-07-24)

`main f0a4ba8` 통합 후 검토 지적 D1~D5 를 보정했다. 아래는 기존 서술 중 **과장된 표현의 정정**과 실제 잔여 위험이다.

### 13.1 기존 서술 정정

| 위치 | 기존 서술 | 정정 |
| --- | --- | --- |
| 4장 / 9장 (첨부 검증) | 확장자 + MIME type 동시 검증 | **Storage Rules 는 실제 파일 바이트 형식(시그니처)을 검증하지 않는다.** 검증 대상은 클라이언트가 선언한 확장자·contentType 메타데이터와, 보정 이후 추가된 Firestore 등록 메타(slot·storagePath·contentType·size)와 실제 Storage 객체의 일치 여부다. 바이너리 시그니처 검사와 악성코드 검사는 V1 범위 밖이다. |
| 5장 (rollback) | 성공한 업로드 파일 삭제 시도 후 draft 문서 삭제 / pending 요청을 남기지 않는다 | **모든 실패에서 orphan 을 방지한다는 의미가 아니었다.** 보정 전에는 Storage 삭제 실패를 경고로만 남기고 draft 문서를 삭제해, 사용자 권한으로 지울 수 없는 orphan 객체가 남을 수 있었다. 보정 후에는 Storage 객체가 하나라도 남으면 draft 문서를 삭제하지 않는다. |
| 4장 (다운로드) | (첨부 다운로드를 새 탭 링크로 처리) | **새 탭 방식은 실제 파일 저장을 보장하지 않았다.** 교차 출처 URL 에서 `download` 속성이 무시될 수 있고 토큰 URL 이 새 탭·브라우저 기록에 노출된다. 보정 후에는 Blob 다운로드 공용 함수로 대체했다. |
| 9장 (Firestore 검증 범위) | 구조/경로/크기/개수만 검증 | 보정으로 **선언 합계(`attachmentsTotalSize`)와 실제 항목 size 합계의 일치**, 첨부 이름·contentType 의 빈 문자열 금지가 추가됐다. |

### 13.2 보정 내용

- **D1** `firestore.rules`: `attachmentsTotalSize == 실제 항목 size 합계` 강제(과소·과대 신고 모두 차단), 이름·contentType 빈 문자열 금지. 1000-expression 한도 대응으로 per-entry `hasOnly`→`keys().size()==5`, 중복 `is` 타입 검사 제거(타입 불일치는 평가 오류로 동일하게 거부), storagePath 접두어 1회 생성으로 축소.
- **D2** `storage.rules`: 업로드 슬롯이 Firestore `attachments` 맵에 등록돼 있고 `slot`·`storagePath`·`contentType`·`size` 가 실제 객체와 모두 일치할 때만 허용. 미등록 슬롯·경로/형식/크기 불일치 업로드 차단.
- **D3** `js/employee-document-requests.js`: rollback 을 상태 재확인 기반으로 재설계. 이미 `pending` 이면 삭제하지 않고 제출 완료로 안내, 상태 확인 실패 시 파괴적 삭제 금지, 등록된 전체 첨부 경로에 삭제 시도, `object-not-found` 는 정리 완료로 처리, Storage 객체가 남으면 draft 문서를 삭제하지 않음.
- **D4** `js/firebase-shared.js` + 직원·관리자 화면: 공용 `window.yjDownloadAttachment()` 로 통합. `target="_blank"` 미사용, `getDownloadURL() → fetch() → Blob → Object URL`로 원래 파일명 저장→즉시 revoke, 다운로드 URL 미보관. fetch·Blob 읽기 예외는 원인을 CORS로 단정하지 않고 네트워크 또는 교차 출처 정책 문제로 보고하며 새 탭 fallback은 사용하지 않는다.
- **D5** `js/employee-document-requests.js`: 선택 파일에 소유 UID 를 기록하고 Auth UID 변경·로그아웃·비활성 전환·Auth/업무 사용자 불일치 시 파일·폼·진행 상태를 초기화. 제출 시작 UID 와 완료 시점 UID 가 다르면 성공 처리하지 않음.

### 13.3 실제 잔여 위험 (V1 범위 밖)

1. 실제 파일 바이트 시그니처 검증·악성코드 검사 없음 (확장자/contentType 메타 기반 검증까지가 범위).
2. Storage 객체 삭제까지 실패하는 극단적 경우, draft 문서와 객체가 함께 남는다(보정 후에는 orphan 이 아니라 **정리 가능한 draft 상태**로 남고 사용자에게 요청 ID 를 안내한다). 운영 시 서버측 lifecycle 정리 권장.
3. 현재 다운로드는 `getDownloadURL() → fetch() → Blob` 경로다. 버킷 CORS 권위 설정과 실제 브라우저 다운로드 성공은 별도 증거이며, 설정만으로 현재 경로의 성공·실패를 단정하지 않는다. 최종 판정은 운영 Pages origin과 실계정·실제 객체를 사용한 런타임 E2E다.
4. Rules 는 에뮬레이터 검증만 완료됐고 **운영 배포되지 않았다**. 관리자·직원 실계정 운영 E2E 는 미수행(PENDING).

---

## 14. WORK29 PR #166 2차 보정 (2026-07-24)

1차 보정 diff 재검토에서 확인된 R1~R5 를 보정했다.

### 14.1 첨부 스키마 변경 (schemaVersion 2, 운영 배포 전이므로 마이그레이션 불필요)

첨부 항목에서 **중복 `slot` 필드를 제거**했다. 슬롯의 권위값은 첨부 맵의 키(`a0`~`a4`)이며 `storagePath` 접미사에도 포함된다.
변경 후 항목은 **정확히 4개 키**만 가진다: `name` · `storagePath` · `contentType` · `size`.

### 14.2 기존 서술 추가 정정

| 기존 서술 | 정정 |
| --- | --- |
| "5개 필드를 모두 접근하므로 `keys().size() == 5` 가 `hasOnly()` 와 동등하다" (1차 보정 §13.2) | **사실이 아니었다.** 당시 `slot` 은 읽지 않아 실제 접근 필드는 4개였고, `slot` 을 임의 키로 교체해 총 개수를 유지하는 우회가 가능했다. 또한 `is string`/`is int` 를 제거해 `name`/`contentType` 에 배열·맵, `size` 에 실수를 넣는 우회가 가능했다. 2차 보정에서 **4키 고정 + 전 필드 타입 검사**로 교정했다. |
| "Firestore 메타 ↔ Storage 객체 결속" | **단방향이다.** Storage 업로드 객체가 Firestore 등록 메타와 일치하는 방향만 Rules 로 강제된다. Firestore 의 `draft → pending` 전환이 실제 Storage 객체 존재까지 보장하지는 못한다(Rules 는 Storage 객체를 조회할 수 없다). 제출 직전 클라이언트 metadata 확인은 **정상 UI 의 무결성 보조 장치이며 보안 경계가 아니다.** |

### 14.3 보정 내용

- **R1** `firestore.rules`: 항목 키 정확히 4개 + `name is string`(1~255) + `contentType is string`(빈 문자열 금지) + `size is int`(1B~10MB) + `storagePath is string` 및 요청자 UID·requestId·맵 슬롯과 정확히 일치. 합계는 정수 `size` 의 정확한 합계(1B~30MB). 첨부 맵 키는 `a0~a4` 만 허용.
- **R2** `js/employee-document-requests.js`: 업로드 완료 후 `draft → pending` 트랜잭션 **직전에** 등록된 전체 경로의 Storage metadata 를 조회해 존재·경로·크기·contentType 일치를 확인한다. 하나라도 불일치·누락·조회 실패면 트랜잭션을 실행하지 않고 기존 rollback 계약으로 진입한다.
- **R3** 계정 컨텍스트(`contextUid`)를 첨부 존재 여부와 **독립적으로** 추적한다. Auth UID 변경·업무 사용자 UID 변경·로그아웃·비활성 전환·Auth/사용자 불일치 시 선택 파일·소유 UID·파일 input·제목/상세 폼·진행 문구·이전 직원 요청 목록·선택 요청 ID·상세 화면을 모두 초기화한다.
- **R4** `refresh()` 가 `{ ok, count, reason }` 을 반환하도록 하고(기존 호출자는 반환값 미사용으로도 동작), 제출 성공 문구를 조회 **이후에** 최종 표시한다. 조회 실패 시 "제출 완료 · 목록 갱신 실패 + 요청 ID" 로 구분한다. 첨부 없는 제출도 생성된 문서 reference 에서 요청 ID 를 확보한다.
- **R5** 운영 버킷 CORS 는 **읽기 전용 확인만** 시도했고 설정은 변경하지 않았다.

### 14.4 잔여 위험 (재확인)

1. **Storage → Firestore 방향만 Rules 로 강제된다.** Firestore `pending` 전환이 실제 Storage 객체 존재를 보장하지 못한다. 완전한 서버 측 존재 보장은 Cloud Functions 등 신뢰 가능한 백엔드가 필요하다.
2. 제출 직전 metadata 확인은 정상 클라이언트용 보조 장치이며 악의적 클라이언트는 우회할 수 있다.
3. 실제 파일 바이트 시그니처 검증·악성코드 검사는 V1 범위 밖이다.
4. 운영 버킷 CORS 권위 설정은 활성 gcloud 계정이 없어 `CORS CONFIG READ BLOCKED · ACTIVE ACCOUNT REQUIRED` 상태다. 존재하지 않는 경로의 비인증 probe는 권위 증거로 사용하지 않으며, 버킷 설정 확인과 실제 브라우저 다운로드 E2E를 별도 게이트로 관리한다.
5. Rules 는 에뮬레이터 검증만 완료됐고 운영 배포되지 않았다. 관리자·직원 실계정 운영 E2E 는 PENDING 이다.

---

## 15. WORK29 PR #166 3차 보정 (2026-07-24) — 사용자 전환 비동기 경합

### 15.1 기존 보고 정정

| 기존 서술 | 정정 |
| --- | --- |
| "계정 컨텍스트 독립 추적 PASS" (2차 §14) | **동기 시점만 검증했다.** 사용자 변경 순간의 초기화는 동작했으나, 변경 **이전에 시작된 비동기 조회·제출이 나중에 완료되는 경합**은 검증 범위에 없었다. |
| "이전 직원의 요청 목록 즉시 초기화" | 초기화는 됐지만, 직원 A 의 진행 중 조회가 늦게 도착하면 **직원 B 화면·`state.requests`·LIVE 카드에 A 결과가 재등장**할 수 있었다. 또한 A 의 조회가 `state.loading` 을 점유해 B 의 첫 조회가 즉시 종료될 수 있었다. |
| "제출 중 UID 변경 시 성공 문구 금지" | 첨부 제출 경로만 `authUser().uid` 를 단독 비교했다. **첨부 없는 제출 경로에는 완료 시점 검사가 없었고**, 응답 유실 `submitted` 경로도 사용자 변경을 검사하지 않아 새 사용자 화면에 성공 문구가 표시될 수 있었다. |
| 2차 클라이언트 `35/35 PASS` | 임시 하네스로 실행 후 삭제해 **저장소에서 재현할 수 없다.** 3차에서도 동일한 방식(임시 하네스)이며, 실행 건수와 범위를 그대로 기록한다. |

### 15.2 보정 내용

- **컨텍스트 세대(`contextVersion`) 도입.** 유효 사용자 식별자가 달라지면(사용자 변경·로그아웃·비활성 전환·Auth 불일치, 빈 컨텍스트→사용자 포함) 세대를 올리고 진행 중인 조회 토큰을 무효화한다. 화면 초기화·안내는 이전 사용자가 있던 경우에만 수행한다.
- **조회 토큰(`refreshSeq`) + 컨텍스트 대조.** `refresh()` 는 시작 시 UID·세대·토큰을 캡처하고, 응답·오류 처리 직전에 셋 다 동일한 경우에만 `state.requests`·DOM·선택 상세·LIVE 카드에 반영한다. 다르면 `{ ok:false, reason:'context-changed' }` 를 반환하고 아무것도 반영하지 않는다.
- **loading 점유 분리.** `state.loading` 은 점유한 토큰만 해제한다(오래된 조회의 `finally` 가 새 조회 상태를 바꾸지 못함). 컨텍스트가 바뀐 뒤에는 이전 조회가 진행 중이어도 새 사용자의 조회가 시작된다.
- **제출 컨텍스트 공용 검사.** 첨부 유무와 무관하게 제출 시작 시 `{uid, version}` 을 캡처하고, 첨부 없는 `add()` 완료 직후 / metadata 확인 후 / 트랜잭션 완료 후 / rollback `submitted` 판정 후 / `refresh()` 이후 / 성공 문구 표시 직전에 동일성을 확인한다.
- **사용자 변경 시 처리.** 성공 문구 금지, 새 사용자 폼·목록·상세를 이전 작업 결과로 변경 금지, 이미 `pending` 인 요청은 삭제 금지, 파괴적 rollback 금지, 요청 ID 를 포함한 "사용자가 변경되어 현재 화면에서 결과를 확정 표시하지 않습니다" 안내만 수행.

### 15.3 3차 검증 범위 (실제 실행 건수)

- 클라이언트 결정론 스텁 테스트 **37/37 PASS** — 비동기 조회 경합 16 · 첨부 없는 제출 경합 6 · 첨부 제출 경합 11 · 기존 계약 회귀 4
- Firestore Rules **46/46 PASS**, Storage Rules **25/25 PASS** (분리 실행, 통합 실행 미수행)
- 변경 파일 1개(`js/employee-document-requests.js`), WORK31·WORK32·Rules·tests·index.html 무변경

### 15.4 잔여 위험 (변동 없음)

Storage→Firestore 단방향 결속 / 제출 직전 metadata 확인은 보안 경계 아님 / 바이트 시그니처·악성코드 검사 V1 범위 밖 / `CORS CONFIG READ BLOCKED · ACTIVE ACCOUNT REQUIRED` / 실계정 운영 E2E PENDING.

---

## 16. WORK29 PR #166 추가 경합 보정 및 독립 검증 (2026-07-27)

새 검증 기준선은 `main f0a4ba8131aff869fcb6db33b07fe991d94ad21f` / PR Head `93b82225742c0df33c246ea955ddbf52442b1459`였다. 독립 검토에서 3차 보정의 기존 37개 임시 하네스에 포함되지 않은 R5~R7 결함을 확인했다.

### 16.1 확인된 결함

- **R5:** 첨부 없는 제출의 늦은 `add()` 실패가 외부 `catch`에서 컨텍스트 검사 없이 새 사용자 화면에 오류 문구를 표시할 수 있었다.
- **R6:** 전역 `state.submitting`과 버튼 disabled 상태에 제출 토큰 소유권이 없어, A 제출 중 B가 새 제출을 시작하지 못하고 A의 늦은 `finally`가 B의 버튼·첨부 목록을 변경할 수 있었다.
- **R7:** 첨부 메타 생성과 업로드 반복문이 가변 `state.attachments`를 직접 참조해 사용자 전환 초기화 또는 새 사용자 파일 선택의 영향을 받을 수 있었다.

### 16.2 최소 보정

- 제출 토큰 `submitSeq`, 제출 잠금 소유 토큰 `submittingSeq`, 잠금 세대 `submittingVersion`을 도입했다.
- 사용자 컨텍스트가 바뀌면 이전 제출 토큰과 잠금을 무효화해 새 사용자가 즉시 자기 제출을 시작할 수 있게 했다.
- 성공·실패·진행 문구와 `finally`의 버튼·첨부 목록 갱신은 현재 제출 토큰 소유자만 수행한다.
- 첨부 없는 `add()` 실패도 제출 토큰과 전체 사용자 컨텍스트가 동일할 때만 화면에 반영한다.
- 제출 시작 시 첨부 객체 배열을 복제·동결하고, 메타 생성과 업로드 반복문은 이 스냅샷만 참조한다.
- 각 파일 업로드 전후에 사용자 컨텍스트를 검사해 전환 후 남은 업로드를 중단한다.
- 사용자 전환 후 오래된 작업의 요청 ID 안내는 새 사용자 DOM을 덮지 않고 콘솔 경고로만 남긴다.
- 사용자 전환으로 결과가 불확실한 draft와 부분 업로드는 파괴적으로 rollback하지 않는다. 이미 `pending`인 요청도 삭제하지 않는다.

### 16.3 실제 검증 결과

- 2026-07-27 신규 결정론 임시 하네스: **12/12 PASS**
  - R5 늦은 성공·실패의 새 사용자 메시지/폼 변경 차단
  - R6 B의 즉시 제출, 오래된 A `finally` 차단, 동일 사용자 중복 제출 차단, A→B→A 세대 차단
  - R7 원본 첨부 스냅샷, 사용자 전환 후 잔여 업로드 중단, B 파일의 A 경로 유입 0건, 정확한 4필드 계약
  - 로그아웃 토큰 무효화와 동일 사용자 정상 제출 회귀
- 기존 3차 임시 하네스 **37/37은 저장소에 남아 있지 않아 이번 작업에서 재실행하지 않았다.** 이전 실행 기록을 이번 PASS 건수로 확대하지 않는다.
- Firestore Rules: **46/46 PASS**, Firestore 단독 에뮬레이터 실행.
- Storage Rules: **25/25 PASS**, 필요한 Firestore와 Storage 에뮬레이터만 별도 프로세스로 실행.
- `node --check js/employee-document-requests.js` PASS.
- `git diff --check` PASS.
- 사용자 입력 `innerHTML` 0건, `_blank` 0건, 가변 `state.attachments` 업로드 반복문 0건.
- 임시 클라이언트 하네스는 실행 후 삭제했고 저장소에 남기거나 커밋하지 않았다.
- WORK31·WORK32·모바일·Rules·Rules 테스트·`index.html`·`js/approval.js`·`js/firebase-shared.js` 변경 0건.

### 16.4 커밋과 상태

- 코드 커밋: `9b12309` — `fix(work29): isolate stale submit results after user changes`
- 코드 수정 파일: `js/employee-document-requests.js`
- PR은 `OPEN · Draft · MERGE HOLD`를 유지한다.
- Firestore/Storage Rules 배포, Firebase Console, CORS, Pages, Schedule, 운영 데이터 변경은 수행하지 않았다.
- 실계정 운영 E2E와 운영 CORS 권위 확인은 계속 PENDING이다.

### 16.5 잔여 위험

- 사용자 전환이 파일 업로드 직후 발생하면 draft 문서와 일부 Storage 객체가 남을 수 있다. 새 사용자 권한으로 파괴적 정리를 시도하지 않고 요청 ID 기반의 관리자 점검 대상으로 보존한다.
- 기존 37개 하네스는 재현 자산이 아니어서 이번 독립 검증에서는 신규 12개 하네스와 Rules·정적 회귀만 실제 재실행했다.
- Storage→Firestore 단방향 결속, metadata 확인의 비보안 경계, 파일 바이트 시그니처·악성코드 검사 부재는 기존 V1 잔여 위험과 같다.

---

## 17. WORK29 PR #166 상시 경합 회귀 테스트 자산화 (2026-07-27)

### 17.1 목적과 실행 방식

삭제되는 임시 하네스에 의존하던 사용자 전환 경합 검증을 `tests/employee-document-requests-race.test.mjs`로 자산화했다. 테스트는 Node 기본 `node:test`와 `vm`만 사용하며 신규 패키지를 요구하지 않는다.

테스트는 실제 생산 파일 `js/employee-document-requests.js`를 매 실행마다 직접 읽어 격리된 VM에서 실행한다. 테스트 훅은 읽어 온 문자열의 최종 공개 객체를 VM 메모리 안에서만 확장하며 저장소의 생산 파일에는 export·조건 분기·테스트 코드를 추가하지 않는다. Window, DOM, Firebase Auth, Firestore, Storage는 deferred promise로 완료 순서를 직접 제어하는 결정론 스텁을 사용하고 실제 네트워크·운영 Firebase·실제 Storage에는 접근하지 않는다.

### 17.2 과거 임시 테스트와의 관계

- 3차 임시 하네스 37개와 4차 임시 하네스 12개를 단순 합산하거나 재실행한 것으로 기록하지 않는다.
- 새 상시 테스트는 과거 핵심 범위를 R3-A·R3-B·R3-C·R4·R5·R6·R7·D3·CONTRACT ID로 다시 매핑해 독립적으로 구현했다.
- 과거 하네스가 없어도 `node --test tests/employee-document-requests-race.test.mjs` 한 명령으로 반복 실행할 수 있다.

### 17.3 실제 실행 결과

- 상시 클라이언트 경합 회귀: **30/30 PASS**
  - 조회 경합: 오래된 성공·실패·로그아웃 결과 차단, B 결과·loading 유지, 목록·상세·선택 ID·LIVE 카드 보호, 동일 사용자 정상 조회
  - 첨부 없는 제출: 늦은 성공·실패 차단, B 즉시 제출, 오래된 `finally`의 버튼·첨부 목록 변경 차단, A→B→A 세대 보호, 동일 사용자 중복 제출 차단, 제출/목록 갱신 결과 분리
  - 첨부 제출: 스냅샷 분리, 첫·중간 파일 업로드 중 전환 시 잔여 업로드 중단, B 파일의 A 경로 유입 차단, metadata·트랜잭션·응답 유실 컨텍스트 보호
  - rollback: pending 삭제 0건, 사용자 변경 후 파괴적 rollback 0건, 정상 draft 정리 유지, 불명확 상태·Storage 삭제 실패 시 draft 삭제 금지
  - 계약: 정확한 첨부 4필드, 최대 5개·파일당 10MB·합계 30MB, metadata 확인, 가변 첨부 배열 업로드 순회 0건, `innerHTML`·`_blank` 0건
- Firestore Rules: **46/46 PASS**, Firestore 단독 에뮬레이터 실행.
- Storage Rules: **25/25 PASS**, 필요한 Firestore와 Storage 에뮬레이터를 별도 프로세스로 실행.
- `node --check js/employee-document-requests.js`: PASS.
- `node --check tests/employee-document-requests-race.test.mjs`: PASS.
- `git diff --check`: PASS.
- 중복 DOM ID 0건, 모바일 첨부 UI 참조 0건.
- 에뮬레이터 debug log와 임시 하네스는 실행 후 제거했다.

### 17.4 변경 범위와 상태

- 신규 파일: `tests/employee-document-requests-race.test.mjs`
- 수정 파일: 본 WORK29 검토·구현보고
- 생산 코드, Firestore/Storage Rules, Rules 테스트, `index.html`, `js/approval.js`, `js/firebase-shared.js`, 모바일, WORK31·WORK32 변경 0건.
- Firebase Console, CORS, Pages, Schedule, 운영 데이터 변경 0건.
- 운영 CORS 권위 확인과 실계정 운영 E2E는 계속 PENDING이다.
- 상시 회귀가 통과했지만 PR은 `OPEN · Draft · MERGE HOLD`를 유지하며 Ready 전환·병합·배포는 별도 Gene 승인 대상이다.

### 17.5 잔여 위험

- VM 테스트는 실제 브라우저·Firebase SDK·네트워크 타이밍을 대체하지 않으므로 실계정 운영 E2E가 필요하다.
- Storage→Firestore 단방향 결속, metadata 확인의 비보안 경계, 파일 바이트 시그니처·악성코드 검사 부재는 기존 V1 잔여 위험과 같다.
- 사용자 전환 직후 발생 가능한 부분 업로드와 draft는 파괴적으로 정리하지 않고 관리자 점검 대상으로 보존한다.

---

## 18. WORK29 PR #166 CORS 진단 계약 정정 및 운영 게이트 재정의 (2026-07-27)

### 18.1 진단 오류와 최소 보정

브라우저 Fetch API의 예외만으로 실제 CORS 정책 차단, 네트워크 단절, DNS·프록시 문제, 확장 프로그램 차단, 일시적 전송 실패, Blob 응답 읽기 실패를 확정적으로 구분할 수 없다. 기존 구현은 fetch 또는 Blob 읽기 예외를 모두 `cors`와 `CORS GATE FAILED`로 표시해 원인을 과잉 단정했다.

`js/firebase-shared.js`의 공용 다운로드 계약을 다음과 같이 최소 보정했다.

- 다운로드 경로는 기존과 동일한 `getDownloadURL() → fetch() → Blob → Object URL`을 유지한다.
- fetch 또는 Blob 읽기 예외 코드를 `cors`에서 `network-or-cors`로 변경했다.
- 사용자 문구를 “네트워크 또는 브라우저 교차 출처 정책 문제로 첨부파일을 내려받지 못했습니다.”로 변경했다.
- 로그의 `CORS gate` 단정 표현을 `network or cross-origin failure`로 변경했다.
- URL 획득 오류, HTTP 403, 기타 비정상 HTTP 응답 분류는 기존 계약을 유지한다.
- Object URL 생성·원래 파일명·anchor 제거·URL revoke·다운로드 URL 미저장·새 탭 fallback 금지 계약을 유지한다.
- 직원과 관리자 호출부는 공용 함수와 메시지 함수를 그대로 사용하며 변경하지 않았다.

### 18.2 공식 문서 기준 게이트 분리

Firebase 공식 다운로드 문서는 `getDownloadURL()`로 받은 URL을 XHR/Blob으로 내려받는 경로와 SDK 직접 다운로드 경로의 CORS 설명을 구분한다. 따라서 버킷 CORS 설정만으로 현재 다운로드 경로의 성공·실패를 단정하지 않는다.

운영 GitHub Pages 확인 결과:

- URL: `https://kimjinman3187-dot.github.io/jinmankim/`
- Origin: `https://kimjinman3187-dot.github.io`
- Pages 상태: built
- Source: `main /`

Google Cloud 권위 조회 준비 결과:

- gcloud 설치: 확인
- 활성 gcloud 계정: 없음
- 버킷 조회 명령 `gcloud storage buckets describe gs://yongjin-enterprise.firebasestorage.app --format="default(cors_config)"`: 활성 계정 부재로 실행하지 않음
- 판정: `CORS CONFIG READ BLOCKED · ACTIVE ACCOUNT REQUIRED`
- 로그인·계정 전환·IAM·버킷 CORS 설정 변경: 미수행

버킷 CORS 권위 설정은 보조 증거이고 최종 런타임 게이트는 배포 후 운영 Pages origin에서 실계정과 실제 객체로 수행하는 다운로드 E2E다.

### 18.3 상시 다운로드 테스트

신규 `tests/attachment-download.test.mjs`는 실제 `js/firebase-shared.js`에서 공용 다운로드 설치 함수 블록을 읽어 VM에서 실행한다. Node 기본 `node:test`·`vm`만 사용하며 실제 네트워크·Firebase·Storage를 호출하지 않는다.

- D4-P-01~12 계약 전체 PASS.
- Node 실제 집계: **14/14 PASS**. D4-P-09의 fetch 예외와 Blob 읽기 예외를 각각 중첩 테스트로 실행해 계약 수 12개와 Node 집계 수 14개를 구분한다.
- 정상 다운로드, 원래 파일명, Object URL revoke, anchor 제거, URL 획득 오류 분류, HTTP 오류 분류, `network-or-cors`, 비단정 사용자 문구, 새 탭 fallback 0건, 다운로드 URL 영구 저장 0건을 검증한다.

### 18.4 전체 회귀와 상태

- 다운로드 상시 테스트: **14/14 PASS**.
- 기존 사용자 전환 경합: **30/30 PASS**.
- Firestore Rules: **46/46 PASS**, Firestore 단독 실행.
- Storage Rules: **25/25 PASS**, 필요한 Firestore·Storage 별도 실행.
- 생산·테스트 JavaScript `node --check`: PASS.
- `git diff --check`: PASS.
- 에뮬레이터 debug log와 임시 하네스 잔존 0건.
- Firestore/Storage Rules, Rules 테스트, `js/employee-document-requests.js`, `index.html`, `js/approval.js`, 모바일, WORK31·WORK32 변경 0건.
- Firebase Console, CORS 설정, Schedule, 운영 데이터·Storage 객체, 운영 배포 변경 0건.
- 실계정 운영 다운로드 E2E는 PENDING이며 PR은 `OPEN · Draft · MERGE HOLD`를 유지한다.
