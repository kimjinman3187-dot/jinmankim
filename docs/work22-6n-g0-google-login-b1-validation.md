# WORK22-6N-G0 — Google Login 운영 준비 검증 (B1 해소)

기준일: 2026-06-09
작업 성격: **읽기 전용 검증** (코드/Console/Rules/데이터 변경 없음)
선행: `work22-6n-d-review-google-login-design.md`, `work22-6n-e-google-login-user-mapping.md`

## 0. 검증 방법 및 데이터 출처

목적: B1(`users 문서 ID = auth.uid` 미확정)을 Green으로 전환할 수 있는지, 실제 운영 데이터로 확인한다.

검증 수행 내용:

- 운영 Firebase 프로젝트(`yongjin-enterprise`)에 **익명 인증으로 로그인** 후 `users` 컬렉션을 **읽기 전용 조회**했다. (현재 운영 앱이 PIN 로그인 목록을 만들 때 수행하는 것과 동일한 read. `index.html:1764`)
- 조회는 저장소 외부 임시 디렉터리의 1회성 read 스크립트로 수행했으며, **어떤 쓰기/수정/삭제도 하지 않았다.** PIN 값은 의도적으로 출력하지 않았다(필드 존재 여부만 확인).

조회 불가였던 항목(범위 한계):

- **Firebase Authentication 사용자 목록(Google 계정·UID) 조회는 불가.** Admin SDK + 서비스 계정 자격증명이 필요하나 저장소·환경에 없으며(정상), Console 접근은 금지 작업이다.
- 더 근본적으로 **Google Login UID는 현재 존재하지 않는다** — 코드에 `GoogleAuthProvider`가 없고(6N-D 확인), Google Provider 활성화는 금지된 Console 작업이며, 각 사용자가 Google로 1회 로그인해야 비로소 UID가 생성된다.

---

## 1. 실제 users 컬렉션 조회 결과 (운영 실데이터)

익명 인증으로 운영 `users` 컬렉션을 읽은 결과 — **총 6개 문서**:

| legacyUserId | name | role | status | auth_uid 필드 | email 필드 | pin 필드 | sort_index |
|---|---|---|---|---|---|---|---|
| `admin_gene` | gene kim | admin | active | 존재하나 **빈 문자열** `""` | **없음** | 있음 | 2 |
| `emp_admin` | 윤정원 | admin | active | `""` | 없음 | 있음 | 1 |
| `emp_acc1` | 회계1 | accounting | active | `""` | 없음 | 있음 | 5 |
| `emp_acc2` | 회계2 | **`ccounting`** ⚠️ | active | `""` | 없음 | 있음 | 6 |
| `emp_factory` | 공장 | factory | active | `""` | 없음 | 있음 | 4 |
| `김상경` | 영업 | sales | active | `""` | 없음 | 있음 | 3 |

### 1-1. 핵심 발견 (실데이터 근거)

1. **auth_uid 필드는 존재하나 6개 전부 빈 문자열(`""`)** → 6N-D/6N-B의 "auth_uid 비어 있음" 진단이 실데이터로 확정. UID 매핑 정보가 운영에 전무.
2. **email 필드는 6개 전부 부재** → Google 계정 매핑 정보가 운영에 전무. Google Email 배정이 선행되어야 함.
3. **pin 필드가 6개 전부 존재** → 익명 read만으로 PIN 필드가 노출되는 구조 확정(B3). 값은 본 검증에서 출력하지 않음.
4. **role 오타: `emp_acc2`의 role이 `"ccounting"`** ⚠️ → 코드 보정 로직(`firebase-shared.js:49`, `index.html:1767`의 `if(d.role==='ccounting') d.role='accounting'`)이 **실제 운영 오타를 가리고 있었음**이 실데이터로 확인. `users/{uid}` 신규 생성 시 반드시 `accounting`으로 정정해야 함.
5. **sales 문서 ID가 한글 이름 `김상경`** (name 필드는 "영업") → legacyUserId가 표준 패턴(`emp_*`)이 아님. 매핑·정렬·롤백 시 주의.
6. **admin 계정 2개** (`admin_gene`=gene kim, `emp_admin`=윤정원) → 둘 다 운영 admin인지, 하나는 폐기 대상인지 운영 확정 필요.
7. 설계문서 D §5 예시에 있던 `emp_acc1/emp_acc2/emp_factory/emp_admin/admin_gene`는 실재 확인. 단 sales는 예시의 가명이 아니라 `김상경`이었음.

---

## 2. B1 산출물 매핑표 (요구 형식)

| legacyUserId | Google Email | Firebase UID | 확인 여부 |
|---|---|---|---|
| `admin_gene` | 미보유 → 배정 필요 | 미생성(확인 필요) | ❌ 미확인 |
| `emp_admin` | 미보유 → 배정 필요 | 미생성(확인 필요) | ❌ 미확인 |
| `emp_acc1` | 미보유 → 배정 필요 | 미생성(확인 필요) | ❌ 미확인 |
| `emp_acc2` | 미보유 → 배정 필요 | 미생성(확인 필요) | ❌ 미확인 |
| `emp_factory` | 미보유 → 배정 필요 | 미생성(확인 필요) | ❌ 미확인 |
| `김상경` (sales) | 미보유 → 배정 필요 | 미생성(확인 필요) | ❌ 미확인 |

> "Firebase UID = 미생성"의 의미: 빈 `auth_uid`(""), email 부재, Google Provider 미활성, Google 로그인 이력 없음 → UID는 아직 **만들어진 적이 없다.** 따라서 본 작업의 허용 범위(조회)만으로는 채울 수 없다.

---

## 3. B1 Green 조건 대비 현황

| B1 Green 조건 | 현황 | 충족 |
|---|---|---|
| Google 계정 확정 | users에 email 필드 전무, 배정 이력 없음 | ❌ |
| Firebase UID 확인 | auth_uid 6개 전부 `""`, Google UID 미생성 | ❌ |
| users/{uid} 예정 경로 확정 | UID 미확정이라 경로 미정 | ❌ |
| role/status 확정 | role/status는 실데이터로 확정(단 `ccounting` 오타 정정 필요) | ✅(정정 조건부) |

---

## 4. B1 Green 불가 사유와 실제 해소 경로

### 왜 본 작업만으로 Green이 불가능한가 (구조적 사유)

B1 Green은 "조회"만으로 달성 불가하다. Firebase UID는 조회 대상이 아니라 **생성 결과물**이기 때문이다. UID가 존재하려면 다음이 선행되어야 하며, 모두 본 작업의 **금지 범위**다:

1. (금지: Console) Authentication > Google Provider **활성화**
2. (금지: Console) Authorized domains에 `kimjinman3187-dot.github.io` 등록 확인
3. 각 직원에게 **Google 계정(email) 배정**
4. 각 직원이 Google로 **1회 로그인** → 이때 비로소 Firebase UID 생성
5. 생성된 UID를 Authentication > Users에서 확인 → 매핑표 기입

### B1 Green을 위한 승인 필요 작업 (별도 단계)

| 순서 | 작업 | 담당/권한 | 현재 금지 여부 |
|---|---|---|---|
| 1 | Google Provider 활성화 + Authorized domains | Console 관리자 | 본 작업 금지 |
| 2 | 직원별 Google Email 확정·배정 | 운영 관리자 | 문서화는 가능 |
| 3 | 직원별 Google 1회 로그인 → UID 채집 | 각 직원 + 관리자 | 본 작업 금지 |
| 4 | 매핑표 UID/email 기입 → B1 Green | 운영 관리자 | 후속 |

> 이 4단계는 코드 구현(Phase 4)이 아니라 **운영 준비 절차**다. 승인 후 별도 세션에서 수행해야 한다.

---

## 5. 보고 형식 요약

### 1. 생성 파일
`docs/work22-6n-g0-google-login-b1-validation.md` (신규 1개. 코드/Console/Rules/데이터 변경 없음)

### 2. 계정 수
**6개** (admin 2: `admin_gene`/`emp_admin`, accounting 2: `emp_acc1`/`emp_acc2`, factory 1: `emp_factory`, sales 1: `김상경`)

### 3. UID 확인 수
**0개** (auth_uid 6개 전부 `""`, Google UID 미생성)

### 4. 미확인 수
**6개 전부** (Google Email·Firebase UID 모두 미보유)

### 5. B1 Green 여부
**❌ RED (Green 아님).** Google Provider 미활성 + email 부재 + auth_uid 공백으로 UID가 존재하지 않음. 조회 범위만으로는 해소 불가하며, §4의 승인 필요 절차(Console 활성화 + 계정 배정 + 1회 로그인)가 선행되어야 함.

### 6. 22-6N-G 착수 가능 여부
**조건부.** 22-6N-G가 **코드 구현(Google Login 실제 구현)**이라면 **착수 불가** — B1이 RED이고 6N-D 권장 순서상 B1 Green이 구현의 선행 조건이다. 22-6N-G가 **설계/준비 문서**라면 본 실데이터(§1)를 입력으로 착수 가능.

---

## 6. 추가 발견에 따른 권고 (구현 전 반영 필수)

본 검증에서 새로 드러난, 설계문서에 아직 반영되지 않은 운영 실데이터 이슈:

1. **`emp_acc2.role = "ccounting"` 오타** — `users/{uid}` 마이그레이션 시 `accounting`으로 정정. 현재는 코드 보정으로 가려져 있으나, Rules는 `currentRole() in ['accounting']`을 직접 보므로 정정 안 하면 emp_acc2가 회계 권한을 못 받음.
2. **admin 2개 계정 정리 결정** — `admin_gene`/`emp_admin` 중 운영 유지/폐기 확정.
3. **sales legacyUserId가 한글(`김상경`)** — 매핑표·정렬키에서 예외 처리.
4. **PIN 필드 운영 노출 확인(B3 실증)** — 익명 read로 pin 필드 접근 가능. Google 전환 시 `users/{uid}`에서 pin 배제 + read 범위 축소 필수.
5. **6N-E 매핑표 갱신** — 본 실데이터로 6N-E의 legacyUserId/name/role/status 칸을 "확인 필요"에서 확정값으로 교체 가능(단 email/UID는 여전히 대기).

> 위 1~5는 운영 데이터 수정 금지 원칙에 따라 **기록만** 하며, 실제 정정은 마이그레이션 승인 단계에서 수행한다.
