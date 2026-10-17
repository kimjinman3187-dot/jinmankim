# 용진FLOW v1.0 1차 프로젝트 종료·자산목록서

- 종료 기준일: 2026-10-17
- 개발 기간 기준: 2026-03-18 최초 Git 이력 ~ 2026-10-17 v1.0 릴리스
- 종료 상태: 1차 개발 완료, Code Freeze
- 최종 승인 기준: PR #207, merge commit `60e8f443bdfc672562d033d018327ee5805a7644`
- 릴리스 태그: `v1.0.0-release`

## 1. 종료 판정

용진FLOW v1.0의 인증, 권한 분리, 영업·회계·미수금, 결재문서, 생산·재고, PC·모바일 화면, 인쇄·첨부·ERP 내보내기 준비가 구현·통합·배포됐다. 자동 테스트와 운영 URL 확인, 테스트 데이터 정리, 핵심 운영 문서 작성까지 완료했으므로 1차 개발 프로젝트를 종료한다.

실제 계정 로그인, 회사 더존 규격, 현장 사용성 확인은 개발 완료 조건에서 분리된 후속 운영 검증이다.

## 2. 최종 산출물

| 분류 | 산출물 | 위치·식별자 | 상태 |
|---|---|---|---|
| 소스 | 운영 코드 원본 | GitHub `kimjinman3187-dot/jinmankim`, `main` | 완료 |
| 릴리스 | v1.0 고정점 | `v1.0.0-release` → `60e8f443...` | 완료 |
| 배포 | 운영 웹 화면 | `https://kimjinman3187-dot.github.io/jinmankim/` | 정상 |
| 인프라 | Firebase 프로젝트 | `yongjin-enterprise` | 운영 |
| 보안 | Firestore/Storage Rules | `firestore.rules`, `storage.rules` | 적용·테스트 완료 |
| 자동화 | GitHub Pages workflow | `.github/workflows/pages.yml` | 운영 |
| 테스트 | 정적 회귀 | `tests/*.test.mjs` | 167/167 통과 |
| 테스트 | Firestore Rules | `tests/rules` | 98/98 통과 |
| 테스트 | Storage Rules | `tests/rules` | 25/25 통과 |
| 문서 | 개발 완료 승인 보고서 | `docs/2026-10-17_YONGJINFLOW_V1-0_1차개발완료_승인보고서.md` | 완료 |
| 문서 | 권한별 기능 명세서 | `docs/2026-10-17_YONGJINFLOW_V1-0_RBAC_권한별기능명세서.md` | 완료 |
| 문서 | 현장 사용자 SOP | `docs/2026-10-17_YONGJINFLOW_V1-0_현장사용자_1페이지SOP.md` | 완료 |
| 문서 | 착수·요구사항 기준서 | 본 문서와 함께 병합 | 완료 |
| 문서 | 운영 인수인계·장애대응서 | 본 문서와 함께 병합 | 완료 |
| 문서 | 프로젝트 종료·자산목록서 | 본 문서 | 완료 |

## 3. 코드 자산 목록

| 영역 | 주요 파일 | 내용 |
|---|---|---|
| 앱 셸·업무 화면 | `index.html`, `desktop.css` | 로그인, 역할별 메뉴, 영업·회계·생산·재고 PC/모바일 화면 |
| 결재문서 | `js/business-documents.js`, `js/business-document-client.js`, `business-documents.css` | 표준문서, 상태 전이, 인쇄, 첨부, 지급·ERP 처리 |
| 결재 대시보드 | `js/approval-dashboard.js`, `approval-dashboard.html`, `approval-dashboard.css` | 결재 조회·처리·인쇄 화면 |
| 인증 공통 | `js/firebase-shared.js` | Firebase 인증·공통 처리 |
| 생산·재고 | `js/production-inventory.js` | 주문 생산, 재고 생산, 입고·배정·출고·반품·정정 |
| 회계 원장 | `js/payment-ledger.js`, 회계 보완 스크립트 | 입금·취소·정정·중복 차단 |
| 운영 허브 | `js/live-operations-hub.js` | 핵심 운영 현황 통합 |
| 보안 규칙 | `firestore.rules`, `storage.rules` | 역할·상태·소유권·불변성 통제 |
| Firebase 구성 | `firebase.json`, `.firebaserc`, `firestore.indexes.json` | 프로젝트·에뮬레이터·Rules·인덱스 기준 |
| Pages 배포 | `.github/workflows/pages.yml`, `.nojekyll` | `main` 기반 정적 배포 |
| 레거시·호환 | `functions/` | 과거 서버 구현·테스트 자산. 임의 배포 금지 |

## 4. 데이터 자산 목록

| 데이터 | Firestore 경로 | 관리 원칙 |
|---|---|---|
| 사용자 | `users/{uid}` | 승인된 UID·역할·active 상태 관리 |
| 주문 | `orders/{orderId}` | 영업·생산·회계·수금 기준 데이터 |
| 입금 원장 | `orders/{orderId}/paymentEvents` | 생성 후 수정·삭제 금지 |
| 결재문서 | `business_documents/{documentId}` | 상태 전이와 결재선 통제 |
| 결재 이력 | `business_documents/{documentId}/history` | 동작별 불변 이력 |
| 첨부·지급 증빙 | 문서 하위 `attachment_*`, `payments/*` | 청크·완료 매니페스트·SHA-256 검증 |
| 결재자 명단 | `business_approver_directory/{uid}` | 관리자·회계 승인 계정만 등록 |
| 알림 | `business_document_notifications/{id}` | 사용자별 수신·읽음 상태 |
| 생산·재고 | `production_inventory/main/*` | 작업·품목·이동·배정 분리 |
| 감사 | `audit_logs/{id}` | 주요 처리 근거 기록 |

운영 데이터는 Git 저장소에 포함하지 않는다. 계정·실제 주문·결재문서의 소유권과 보존정책은 회사 운영 기준을 따른다.

## 5. 문서 자산 체계

- GitHub `docs`: PR과 구현에 직접 연결되는 원본 문서
- HARNESS `09_GIT_REPO_의도DB`: 필요한 경우 GitHub 문서의 인덱스·요약·인수인계만 관리
- 같은 본문을 두 위치에 중복 저장하지 않는다.
- `OPERATIONS\4_일정관리`는 저장소 문서 위치로 사용하지 않는다.
- OneDrive 작업본은 동기화·소유권 충돌 가능성이 있으므로 회사의 장기 보관 원본으로 자동 간주하지 않는다.

이번 종료 문서 3종의 원본은 GitHub `docs`로 확정한다. HARNESS 복사·이동은 별도 Gene 승인 없이는 수행하지 않는다.

## 6. 복구·증적 자산

### 소스 복구 기준

- 태그: `v1.0.0-release`
- commit: `60e8f443bdfc672562d033d018327ee5805a7644`
- PR: `#207 YongjinFLOW v1.0 release sign-off`
- Pages build: 위 commit 기준 `built`, 운영 URL HTTP 200 확인

### 테스트 데이터 정리 복구본

- 경로: `C:\Users\kimji\OneDrive\문서\용진_flow\output\2026-10-17_yongjinflow_v1_0_테스트데이터_정리전백업.json`
- SHA-256: `6703f6aa1cf9fbf687e35158a1087257713579c0d3cff7949c5f5fee08cc1cfe`
- 내용: 삭제 대상 상위 21건과 하위 첨부·이력 4건, 총 25개 문서
- 삭제 안전장치: 백업 시점 `updateTime` 일치 문서만 삭제
- 보존 확인: 실제 주문 1건, 실제 결재문서 1건

복구본은 민감한 데이터가 포함될 수 있어 GitHub에 저장하지 않는다. 장기 보존 위치와 보존기간은 Gene이 회사 정책에 따라 확정한다.

## 7. 보안·접근 자산

- GitHub 저장소 관리자 권한
- Firebase 프로젝트 관리자 권한
- Google 로그인 허용 계정과 Firebase Auth UID
- `users/{uid}` 역할 문서와 결재자 명단

비밀번호, 토큰, 서비스 계정 키는 자산목록 본문에 기록하지 않는다. 담당자 변경 시 계정 권한을 재검토하고 불필요한 접근을 회수한다.

## 8. 미결이 아닌 후속 운영 검증

| 항목 | 완료 시점 | 판정 |
|---|---|---|
| 생산·생산관리자 등 실제 계정별 1회 로그인 | 계정 준비 후 | 메뉴·쓰기 권한이 RBAC 명세와 일치 |
| 더존 ERP 규격·인코딩 | 회사 환경 확인 후 | CSV/JSON 업로드와 한글 표시 정상 |
| 휴대폰·PC 현장 사용성 | 실제 사용자 점검 후 | 업무 용어·글자·버튼 흐름에 중대한 장애 없음 |

단순 사용법 문의는 SOP로 처리한다. 기능 장애는 hotfix, 신규 기능·구조 변경은 Phase 2 백로그로 분리한다.

## 9. 잔여 위험과 통제

| 위험 | 통제 |
|---|---|
| 실제 계정별 권한 미확인 | 운영 투입 전 역할별 1회 로그인 |
| 더존 구버전 인코딩 불일치 | 샘플 업로드 후 UTF-8 BOM/EUC-KR 확정 |
| 로컬 복구본 단일 위치 | Gene 승인 후 회사 승인 백업 위치로 이관 |
| 사용자 실수로 수량 변경 | 모바일 조회 전용, PC 처리, 불변 원장과 정정 사유 |
| 승인 없는 Rules·데이터 변경 | 백업·명시 승인·에뮬레이터·diff·스모크 테스트 의무화 |
| Code Freeze 이후 기능 추가 | Phase 2 착수서와 별도 브랜치·PR로 분리 |

## 10. 프로젝트 종료 후 변경 원칙

1. v1.0 태그는 이동·삭제하지 않는다.
2. `main` 직접 수정 대신 작업 브랜치와 PR을 사용한다.
3. 운영 장애·보안 문제만 v1 hotfix로 처리한다.
4. UI 개선과 신규 기능은 Phase 2 요구사항으로 등록한다.
5. Rules, Firebase 설정, `users`, `orders`, Reset Data는 Gene의 명시 승인 없이 변경하지 않는다.
6. 완료 보고에는 변경 파일, 테스트, PR·SHA, 운영 영향과 Gene 검토 항목을 남긴다.

## 11. 최종 종료 체크리스트

- [x] 기능 개발 및 운영 배포 완료
- [x] 역할·보안·상태 전이 테스트 완료
- [x] 테스트 데이터 정리와 복구본 확보
- [x] 릴리스 태그와 복구 기준점 확보
- [x] 사용자 가이드·권한 명세·완료 보고서 작성
- [x] 착수·요구사항 기준서 작성
- [x] 운영 인수인계·장애대응서 작성
- [x] 프로젝트 종료·자산목록서 작성
- [x] 후속 운영 검증과 Phase 2 분리

이 체크리스트를 기준으로 용진FLOW v1.0 1차 개발 프로젝트를 종료한다.
