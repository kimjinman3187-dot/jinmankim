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
