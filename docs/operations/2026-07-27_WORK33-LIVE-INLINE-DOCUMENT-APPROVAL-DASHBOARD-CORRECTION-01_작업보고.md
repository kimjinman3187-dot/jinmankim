# WORK33 LIVE 내부 문서결재 대시보드 삽입 구조 정정 작업보고

## 판정

PC LIVE의 `#pc-page-dashboard` 하단에 문서결재 상세 대시보드 전체를 직접 삽입했다. 기본 사용 경로에서 `approval-dashboard.html`로 이동하지 않으며, 요약 카드의 버튼은 같은 LIVE 화면의 상세 영역으로 스크롤한다.

## 변경 내용

- `index.html`: LIVE 하단에 기간·상태·유형·검색, 요약, 목록, 페이지 이동, 상세, 이력, 인쇄·PDF, 새로고침 UI 전체를 삽입했다.
- `js/approval-dashboard.js`: LIVE root와 독립 페이지 root가 하나의 조회·필터·상세·인쇄 로직을 사용하는 단일 마운트 구조로 변경했다.
- `js/live-operations-hub.js`: 별도 페이지 이동을 제거하고 인라인 스크롤로 변경했다. 상세 대시보드의 bounded 요약 결과를 관리자 요약 카드에 공유해 기존 관리자 최근 현황 단발 조회를 중복 실행하지 않는다.
- `approval-dashboard.html`: 직접 주소 접근용 보조 경로로 유지하며 공용 CSS와 동일 JS를 사용한다.
- `approval-dashboard.css`: LIVE 전역 스타일을 오염시키지 않는 root-scoped 공용 스타일과 인라인 인쇄 계약을 추가했다.
- `tests/live-inline-approval-dashboard.test.mjs`: 인라인 전체 UI, 동일 ID 0건, 별도 이동 제거, 단일 마운트, 읽기 전용, bounded 조회, 공용 자산 재사용을 영구 검증한다.

## 권한·상태 계약

- 관리자는 현행 Rules 범위에서 전사 요청을 조회한다.
- 직원은 `requesterUid == auth.uid` 쿼리로 본인 요청만 조회한다.
- 비로그인·비활성 계정은 LIVE 상세 root를 숨기고 문서결재 조회를 실행하지 않는다.
- 인증 콜백마다 기존 목록·상세·요약·인쇄 데이터를 먼저 폐기해 계정 전환 시 이전 데이터 재노출을 막는다.
- 이미 `window.auth`와 `window.db`가 준비된 LIVE에서는 Firebase 초기화를 다시 호출하지 않는다.
- 초기화 상태로 이벤트와 인증 listener의 중복 바인딩을 막는다.

## 조회 비용

- 신규 `onSnapshot` 없음.
- 목록은 `PAGE_SIZE + 1`, 요약은 `SUMMARY_CAP + 1` bounded 단발 조회를 유지한다.
- LIVE 재진입은 재마운트하거나 같은 조회를 자동 반복하지 않는다.
- 관리자 WORK32 요약 카드의 별도 최근 현황 조회는 인라인 root가 있을 때 중단하며, 상세 요약 결과를 공유한다.

## 검증 결과

- `node --check js/approval-dashboard.js`: PASS
- `node --check js/live-operations-hub.js`: PASS
- `node --test tests/live-inline-approval-dashboard.test.mjs tests/employee-document-requests-race.test.mjs tests/attachment-download.test.mjs`: PASS (49/49)
- `git diff --check`: PASS
- 직원 운영 실계정 E2E: `PENDING` (제공된 실계정 없음, 구현 완료 차단 항목 아님)
- 운영 로그인 브라우저 E2E 및 인쇄 미리보기: Draft PR 검토 단계에서 Gene 확인 필요

## 금지사항 준수

- `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`: 변경 없음
- Authentication 계약 및 문서결재 쓰기 로직: 변경 없음
- WORK29 첨부 계약과 운영 데이터: 변경 없음
- 모바일 입력 화면과 Schedule: 변경 없음
- 신규 Firestore 쓰기·실시간 listener·무제한 조회·iframe: 추가 없음
- Ready 전환·병합·Pages/Firebase 배포: 수행하지 않음
