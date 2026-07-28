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

## PR #169 1차 검토 보정

1차 검토 판정은 `CHANGES REQUIRED / Draft 유지 / Ready 전환 HOLD`였다.

### R1 조회 실패 fail-closed

- 변경 전: 성공 조회 뒤 최신 목록 조회가 실패하면 이전 `rows`, 선택 문서, 이력 캐시, 인쇄 대상, 마지막 조회 시각이 상태에 남을 수 있었다.
- 변경 후: 최신 목록 오류에서 목록과 페이지 상태를 비우고, 선택·상세·이력·인쇄·마지막 조회 시각을 제거한다. `historySeq`를 증가시켜 진행 중인 이전 상세 응답도 무효화한다.
- 필터를 다시 조작해도 실패 전 문서가 렌더되지 않으며, 느린 이전 성공 응답도 최신 실패 상태를 덮지 못한다.

### R2 LIVE 인쇄 호스트

- 변경 전: 중첩된 LIVE 대시보드의 상위 요소가 인쇄 CSS에서 먼저 숨겨져 빈 인쇄 화면이 될 수 있었다.
- 변경 후: 인쇄 직전에 안전한 DOM API로 `body` 직계 자식 `#yjApprovalDashboardPrintHost`를 만들고 그 호스트만 인쇄한다.
- `afterprint`에서 임시 호스트와 body 인쇄 class를 제거한다. 반복 인쇄 전 기존 호스트를 먼저 제거하므로 중복 호스트가 남지 않는다.
- LIVE와 독립 페이지가 동일한 `doPrint()` 경로를 사용한다.

### R3 관리자 요약 카드 계약

- 대기·보류와 `adminActiveCapped`는 기존 활성 요청 결과만 사용하며 상세 500건 요약으로 덮어쓰지 않는다.
- 상세 요약 공유는 최근 7일 승인·반려와 최근 5건만 갱신한다.
- 500건 초과 시 가장 오래된 조회 문서가 최근 7일 안에 있을 때만 부분 집계로 표시한다.
- 안내 문구에는 실제 공유 상한 500건을 사용한다.
- 상세 요약 실패 시 승인·반려·최근 요청은 제거하고 오류 상태를 표시하되, 대기·보류 활성 수치는 유지한다.

### R4 실행형 회귀 테스트

`tests/work33-pr169-review-correction.test.mjs`에 실제 운영 함수를 실행하는 다음 테스트를 추가했다.

- 이전 목록·선택·이력·인쇄·조회 시각을 가진 상태에서 목록 실패 후 완전 폐기
- 실패 뒤 상태·유형·검색 필터 변경 시 이전 문서 미재등장
- 느린 이전 성공 응답과 최신 실패 응답의 결정론적 경합
- 중첩 위치와 무관한 body 직계 인쇄 호스트 생성
- 반복 인쇄 시 호스트 1개 유지 및 `afterprint` 완전 정리
- 관리자 활성 대기·보류 및 활성 상한 보존
- 최근 7일 완전·부분 집계 판정
- 요약 실패 시 최근 지표 제거, 활성 수치 유지, 오류 표시
- `index.html` 전체 DOM ID 중복 0건

## 1차 보정 검증 결과

- 관련 전체 테스트: `53/53 PASS`
- WORK33 신규 실행형 테스트: `4/4 PASS`
- `node --check js/approval-dashboard.js`: PASS
- `node --check js/live-operations-hub.js`: PASS
- `git diff --check`: PASS
- GitHub 자동 체크: 등록 0건
- 관리자 운영 로그인 E2E: `PENDING` (Draft 브랜치의 인증된 운영 브라우저 세션 미실행)
- 직원 운영 실계정 E2E: `PENDING` (실계정 미제공)

## 잔여 위험과 최종 판정

- 실제 브라우저 인쇄 미리보기의 용지·브라우저별 레이아웃은 Gene의 Draft 검토가 필요하다.
- 관리자 및 직원 운영 계정의 실제 Rules 연동은 운영 세션 E2E 전까지 `PENDING`이다.
- 자동 검증 기준 R1~R4 보정은 완료했다.
- PR #169는 Draft로 유지하며 Gene 승인 전 Ready 전환·병합·Pages/Firebase 배포를 수행하지 않는다.
