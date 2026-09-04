(function installYJLiveOperationsHub() {
    if (window.YJLiveOperationsHub) return;

    const state = {
        initialized: false,
        approvalRequests: [],
        documentApprovals: [],
        orders: [],
        // WORK32: LIVE 문서결재 현황 카드 전용 상태 (관리자 hub 상태와 분리)
        docCard: {
            role: '',              // 'admin' | 'employee' | ''
            pending: 0,
            onHold: 0,
            approved7: 0,
            rejected7: 0,
            recent: [],
            adminActiveCapped: false,   // 관리자 활성 요청 150건 상한 도달
            adminRecentPartial: false,  // 최근 200건 상한 + 200번째도 7일 이내 → 부분 집계
            adminRecentLimit: 200,
            employeeCapped: false,      // 직원 본인 100건 상한 도달
            status: 'idle',        // idle | loading | ready | empty | denied | error
            seq: 0,
            inflight: false
        }
    };

    const ORDER_STATUS_LABELS = {
        pending: '승인 대기',
        approved: '생산 진행',
        completed: '생산 완료',
        rejected: '반려'
    };

    // WORK32: 카드 상수 (관리자 추가 조회 상한 / 직원·관리자 활성 조회 상한 / 최근 7일)
    const DOC_CARD = {
        ADMIN_RECENT_LIMIT: 200,
        ADMIN_ACTIVE_LIMIT: 150,
        EMPLOYEE_LIMIT: 100,
        RECENT_ITEMS: 5,
        WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
        COLLECTION: 'document_approval_requests'
    };

    // 허용된 상태값만 명시적으로 매핑, 그 외는 중립 배지
    const DOC_STATUS_CLASS = {
        draft: 'text-slate-300',
        pending: 'text-amber-300',
        on_hold: 'text-cyan-300',
        approved: 'text-emerald-300',
        rejected: 'text-rose-300'
    };

    function $(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const node = $(id);
        if (node) node.textContent = value == null || value === '' ? '-' : String(value);
    }

    function currentUser() {
        if (window.currentUser) return window.currentUser;
        if (typeof window.yjGetCurrentUser === 'function') return window.yjGetCurrentUser();
        return null;
    }

    function isAdmin() {
        const user = currentUser();
        return Boolean(user && user.status === 'active' && user.role === 'admin');
    }

    function timestampValue(value) {
        try {
            if (!value) return 0;
            if (typeof value.toMillis === 'function') return value.toMillis();
            if (typeof value.toDate === 'function') return value.toDate().getTime();
            if (value instanceof Date) return value.getTime();
            if (typeof value === 'number') return value;
            return new Date(value).getTime() || 0;
        } catch (error) {
            return 0;
        }
    }

    function formatTime(value) {
        const time = timestampValue(value);
        if (!time) return '-';
        return new Date(time).toLocaleString('ko-KR', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    function displayValue(item, keys, fallback) {
        for (const key of keys) {
            const value = item?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
        }
        return fallback || '-';
    }

    function clearList(list) {
        if (list) list.textContent = '';
    }

    function appendEmpty(list, message) {
        const item = document.createElement('li');
        item.className = 'text-[11px] font-bold text-slate-500';
        item.textContent = message;
        list.appendChild(item);
    }

    // ---------- WORK41: 최근 업무 정렬 · 지연 판별 · 예외 색상/문구 ----------
    // 주문 상태 우선순위(작을수록 먼저): 지연/반려 → 대기 → 진행 → 완료
    const ORDER_PRIORITY = { rejected: 0, pending: 1, approved: 2, completed: 3 };
    const DAY_MS = 24 * 60 * 60 * 1000;

    function parseDueMs(order) {
        const due = order?.dueDate;
        if (!due) return 0;
        const ms = new Date(due).getTime();
        return Number.isFinite(ms) ? ms : 0;
    }
    // 지연: 납기일이 지났고 아직 완료/반려가 아님
    function isDelayedOrder(order, nowMs) {
        const due = parseDueMs(order);
        if (!due) return false;
        const status = order?.status;
        if (status === 'completed' || status === 'rejected') return false;
        return due < (nowMs || Date.now());
    }
    // 납기 임박: 납기가 오늘~windowDays 이내이고 미완료
    function isDueSoonOrder(order, nowMs, windowDays) {
        const due = parseDueMs(order);
        if (!due) return false;
        const status = order?.status;
        if (status === 'completed' || status === 'rejected') return false;
        const now = nowMs || Date.now();
        const days = windowDays || 3;
        return due >= now && due <= now + days * DAY_MS;
    }
    function orderPriorityRank(order, nowMs) {
        if (isDelayedOrder(order, nowMs)) return 0;               // 지연은 최우선
        const base = ORDER_PRIORITY[order?.status];
        return base === undefined ? 1.5 : base;                  // 미지정 상태는 대기와 진행 사이
    }
    // WORK41 §3.7: 테스트성 데이터 식별(비파괴 — 삭제·수정하지 않고 배지/필터로만 처리)
    const TEST_PATTERN = /(^|[\s_\-])(TEST|테스트|샘플|SAMPLE|DEMO)/i;
    function isTestOrder(order) {
        if (!order) return false;
        if (order.isTest === true || order.testData === true) return true;
        const fields = [order.client, order.clientName, order.company, order.title, order.material, order.productName, order.itemName, order.id];
        return fields.some(v => typeof v === 'string' && TEST_PATTERN.test(v));
    }
    // 최근 업무 명시 정렬 — 미처리 우선, 완료는 뒤로(또는 제외), 테스트 데이터는 기본 제외. 자동 테스트 대상.
    function sortRecentOrders(orders, options) {
        const opts = options || {};
        const nowMs = opts.nowMs || Date.now();
        let list = Array.isArray(orders) ? orders.slice() : [];
        if (!opts.includeCompleted) {
            list = list.filter(order => order?.status !== 'completed');
        }
        if (!opts.includeTest) {
            list = list.filter(order => !isTestOrder(order));
        }
        return list.sort((a, b) => {
            const ra = orderPriorityRank(a, nowMs);
            const rb = orderPriorityRank(b, nowMs);
            if (ra !== rb) return ra - rb;                                       // 우선순위 오름차순
            return timestampValue(orderTime(b)) - timestampValue(orderTime(a));  // 동순위는 최신순
        });
    }

    const TONE_TEXT = { amber: 'text-amber-300', rose: 'text-rose-300', slate: 'text-slate-200' };
    const TONE_CLASSES = ['text-white', 'text-slate-200', 'text-slate-400', 'text-amber-300', 'text-rose-300', 'text-emerald-300', 'text-blue-300'];
    // 0건=중립, 처리 필요=강조, 조회 실패=숫자 대신 '-'+원인 문구 (색상만으로 구분하지 않음)
    function setCountCell(numId, badgeId, stateId, count, options) {
        const opts = options || {};
        const num = $(numId);
        const badge = badgeId ? $(badgeId) : null;
        const st = stateId ? $(stateId) : null;
        const suffix = opts.suffix || '';
        const applyNumClass = cls => { if (num) { TONE_CLASSES.forEach(c => num.classList.remove(c)); num.classList.add(cls); } };
        if (opts.failed) {
            if (num) num.textContent = '-';
            applyNumClass('text-rose-300');
            if (badge) badge.textContent = '조회 실패';
            if (st) st.textContent = opts.failMessage || '조회 실패 · 다시 시도';
            return;
        }
        const value = Number(count) || 0;
        const active = value > 0;
        if (num) num.textContent = `${value}${suffix}`;
        applyNumClass(active ? (TONE_TEXT[opts.tone] || TONE_TEXT.amber) : TONE_TEXT.slate);
        if (badge) badge.textContent = `${value}건`;
        if (st) st.textContent = active ? (opts.activeMessage || '처리 필요') : (opts.idleMessage || '처리할 항목이 없습니다.');
    }

    function documentTitle(request) {
        return displayValue(request, ['title', 'documentType', 'requestType'], '제목 없음');
    }

    function documentRequester(request) {
        return displayValue(request, ['requesterName', 'requesterEmail', 'requesterUid'], '요청자 정보 없음');
    }

    function documentStatusLabel(status) {
        if (typeof window.YJApproval?.getStatusLabel === 'function') {
            return window.YJApproval.getStatusLabel(status);
        }
        return status || '-';
    }

    function renderApprovalRequests() {
        const requests = state.approvalRequests;
        const pending = requests.filter(request => request?.status === 'pending').length;
        const onHold = requests.filter(request => request?.status === 'on_hold').length;
        const approvalTotal = pending + onHold;
        setText('pcHubApprovalTotal', `${approvalTotal}건`);
        const approvalBadge = $('pcHubApprovalTotal');
        if (approvalBadge) {
            approvalBadge.classList.toggle('text-amber-200', approvalTotal > 0);
            approvalBadge.classList.toggle('text-slate-200', approvalTotal === 0);
        }
        setText('pcHubApprovalPending', pending);
        setText('pcHubApprovalHold', onHold);

        const recent = requests.slice().sort((a, b) => timestampValue(b?.requested_at) - timestampValue(a?.requested_at))[0];
        setText('pcHubApprovalRecent', recent
            ? `${displayValue(recent, ['displayName', 'name', 'email'], '요청자 정보 없음')} · ${formatTime(recent.requested_at)}`
            : '현재 조회된 요청이 없습니다.');
    }

    function orderTime(order) {
        return order?.updatedAt || order?.createdAt || order?.dueDate;
    }

    const ORDER_STATUS_TONE = { pending: 'text-amber-300', approved: 'text-blue-300', completed: 'text-emerald-300', rejected: 'text-rose-300' };
    function renderOrderItem(list, order, nowMs) {
        const item = document.createElement('li');
        item.className = 'rounded-lg border border-[#334155]/70 bg-[#0f1522] px-3 py-2';
        const top = document.createElement('div');
        top.className = 'flex items-center justify-between gap-3';
        const left = document.createElement('div');
        left.className = 'flex min-w-0 items-center gap-1.5';
        if (isTestOrder(order)) {
            const testBadge = document.createElement('span');
            testBadge.className = 'shrink-0 rounded bg-slate-600/60 px-1.5 py-0.5 text-[10px] font-black text-slate-200';
            testBadge.textContent = '테스트';
            left.appendChild(testBadge);
        }
        const client = document.createElement('p');
        client.className = 'truncate text-[11px] font-black text-slate-100';
        client.textContent = displayValue(order, ['client', 'clientName', 'company'], '거래처 정보 없음');
        left.appendChild(client);
        const delayed = isDelayedOrder(order, nowMs || Date.now());
        const baseLabel = ORDER_STATUS_LABELS[order?.status] || order?.status || '-';
        const status = document.createElement('span');
        // 색상만으로 구분하지 않고 상태 문구를 함께 표시(§3.5)
        status.className = `shrink-0 text-[11px] font-black ${delayed ? 'text-rose-300' : (ORDER_STATUS_TONE[order?.status] || 'text-slate-300')}`;
        status.textContent = delayed ? `지연 · ${baseLabel}` : baseLabel;
        top.append(left, status);
        const meta = document.createElement('p');
        meta.className = 'mt-1 truncate text-[11px] font-bold text-slate-400';
        meta.textContent = `${displayValue(order, ['material', 'productName', 'itemName'], '품목 정보 없음')} · 납기 ${displayValue(order, ['dueDate'], '-')}`;
        item.append(top, meta);
        list.appendChild(item);
    }

    function renderOrders() {
        const orders = state.orders;
        const failed = Boolean(state.ordersError);
        const completed = orders.filter(order => order?.status === 'completed').length;
        const dashboardMetrics = typeof window.getPCDashboardMetrics === 'function'
            ? window.getPCDashboardMetrics(orders)
            : null;
        const receivable = dashboardMetrics
            ? dashboardMetrics.debtItems.length
            : orders.filter(order => ['approved', 'completed'].includes(order?.status) && order?.paymentStatus !== 'paid').length;
        const nowMs = Date.now();
        const urgent = orders.filter(order => isDelayedOrder(order, nowMs) || isDueSoonOrder(order, nowMs)).length;

        // 운영 현황(B): 생산 완료만 hub가 대표 표시(승인 대기·생산 진행은 pcKpi* 가 대표)
        setText('pcHubMetricCompleted', failed ? '-' : `${completed}건`);
        // 지금 처리할 업무(A): 납기·지연 / 미수금 — 0건 중립, 처리필요 강조, 조회실패 명시
        setCountCell('pcHubUrgentOrders', 'pcHubUrgentBadge', 'pcHubUrgentState', urgent, {
            tone: 'rose', failed,
            activeMessage: '지연·임박 주문 확인 필요', idleMessage: '지연·임박 주문 없음',
            failMessage: '주문 조회 실패 · 다시 시도'
        });
        setCountCell('pcHubMetricReceivable', 'pcHubReceivableBadge', 'pcHubReceivableState', receivable, {
            tone: 'rose', suffix: '건', failed,
            activeMessage: '미수 관리 대상 있음', idleMessage: '미수 관리 대상 없음',
            failMessage: '주문 조회 실패 · 다시 시도'
        });

        const list = $('pcHubRecentOrders');
        clearList(list);
        if (!list) return;
        if (failed) { appendEmpty(list, '주문 조회 실패 · 다시 시도해 주세요.'); return; }
        const includeCompleted = Boolean($('pcHubRecentIncludeCompleted')?.checked);
        const includeTest = Boolean($('pcHubRecentIncludeTest')?.checked);
        const recent = sortRecentOrders(orders, { includeCompleted, includeTest, nowMs }).slice(0, 5);
        if (!recent.length) {
            appendEmpty(list, includeCompleted ? '현재 조회된 주문이 없습니다.' : '미처리 주문이 없습니다.');
            return;
        }
        recent.forEach(order => renderOrderItem(list, order, nowMs));
    }

    // ---------- WORK32: LIVE 문서결재 현황 카드 ----------
    function docCardEligible() {
        const user = currentUser();
        return Boolean(user && user.status === 'active');
    }

    // 상세 대시보드(js/approval-dashboard.js)와 동일한 표시번호 규칙을 재사용한다.
    function docNumber(request) {
        const ms = timestampValue(request?.createdAt);
        const d = ms ? new Date(ms) : null;
        const ymd = d
            ? `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
            : '00000000';
        const idPart = String(request?.id || '').slice(-6) || '------';
        return `DA-${ymd}-${idPart}`;
    }

    function resetDocCardData() {
        const c = state.docCard;
        c.role = '';
        c.pending = 0; c.onHold = 0; c.approved7 = 0; c.rejected7 = 0;
        c.recent = [];
        c.adminActiveCapped = false; c.adminRecentPartial = false; c.adminRecentLimit = DOC_CARD.ADMIN_RECENT_LIMIT; c.employeeCapped = false;
        c.status = 'idle';
        c.seq += 1;      // 진행 중 응답 무효화
    }

    function docCardBasisText() {
        const c = state.docCard;
        const DEFAULT_TEXT = '대기·보류는 누적, 승인·반려는 최근 7일 기준입니다.';
        if (c.role === 'employee') {
            return c.employeeCapped ? `본인 최근 ${DOC_CARD.EMPLOYEE_LIMIT}건 기준입니다.` : DEFAULT_TEXT;
        }
        if (c.role === 'admin') {
            if (!c.adminActiveCapped && !c.adminRecentPartial) return DEFAULT_TEXT;
            const parts = [];
            parts.push(c.adminActiveCapped
                ? `대기·보류는 활성 요청 최근 ${DOC_CARD.ADMIN_ACTIVE_LIMIT}건 기준입니다.`
                : '대기·보류는 누적 기준입니다.');
            parts.push(c.adminRecentPartial
                ? `승인·반려는 최근 ${c.adminRecentLimit}건 기준의 부분 집계입니다.`
                : '승인·반려는 최근 7일 기준입니다.');
            return parts.join(' ');
        }
        return DEFAULT_TEXT;
    }

    function renderDocCardRecent() {
        const list = $('pcLiveDocRecent');
        if (!list) return;
        clearList(list);
        const c = state.docCard;
        if (!c.recent.length) {
            appendEmpty(list, c.status === 'loading' ? '불러오는 중입니다.' : '표시할 요청이 없습니다.');
            return;
        }
        const showRequester = c.role === 'admin';
        c.recent.slice(0, DOC_CARD.RECENT_ITEMS).forEach(request => {
            const item = document.createElement('li');
            item.className = 'flex items-center justify-between gap-3 rounded-lg border border-[#334155]/70 bg-[#0f1522] px-3 py-2';
            const main = document.createElement('div');
            main.className = 'min-w-0';
            const line1 = document.createElement('p');
            line1.className = 'truncate text-[11px] font-black text-slate-200';
            line1.textContent = `${docNumber(request)} · ${documentTitle(request)}`;
            main.appendChild(line1);
            const line2 = document.createElement('p');
            line2.className = 'mt-1 truncate text-[10px] font-bold text-slate-500';
            line2.textContent = showRequester
                ? `${documentRequester(request)} · ${formatTime(request?.createdAt)}`
                : formatTime(request?.createdAt);
            main.appendChild(line2);
            const badge = document.createElement('span');
            badge.className = `shrink-0 text-[10px] font-black ${DOC_STATUS_CLASS[request?.status] || 'text-slate-400'}`;
            badge.textContent = documentStatusLabel(request?.status);
            item.append(main, badge);
            list.appendChild(item);
        });
    }

    function renderDocCard() {
        const card = $('pcLiveDocApprovalCard');
        const liveCard = $('pcLiveOpsDocCard');
        const glancePending = $('pcHubDocGlancePending');
        const glanceHold = $('pcHubDocGlanceHold');
        if (!card && !liveCard && !glancePending && !glanceHold) return;
        const eligible = docCardEligible();
        card?.classList.toggle('hidden', !eligible);
        liveCard?.classList.toggle('hidden', !eligible);
        if (!eligible) return;

        const c = state.docCard;
        const scopeLabel = c.role === 'admin' ? '전사' : (c.role === 'employee' ? '본인 요청' : '-');
        setText('pcLiveDocScopeBadge', scopeLabel);
        setText('pcLiveDocPending', c.pending);
        setText('pcLiveDocHold', c.onHold);
        setText('pcLiveDocApproved7', c.approved7);
        setText('pcLiveDocRejected7', c.rejected7);
        setText('pcLiveOpsDocScopeBadge', scopeLabel);
        setText('pcLiveOpsDocPending', c.pending);
        setText('pcLiveOpsDocHold', c.onHold);
        setText('pcLiveOpsDocApproved7', c.approved7);
        setText('pcLiveOpsDocRejected7', c.rejected7);
        setText('pcHubDocGlancePending', c.pending);
        setText('pcHubDocGlanceHold', c.onHold);
        // WORK41: 문서결재 예외 카드 합계·상태 문구(조회 실패를 0건으로 표시하지 않음)
        const docGlanceTotal = (Number(c.pending) || 0) + (Number(c.onHold) || 0);
        setText('pcHubDocGlanceTotal', `${docGlanceTotal}건`);
        const docGlanceBadge = $('pcHubDocGlanceTotal');
        if (docGlanceBadge) {
            docGlanceBadge.classList.toggle('text-amber-200', docGlanceTotal > 0);
            docGlanceBadge.classList.toggle('text-slate-200', docGlanceTotal === 0);
        }
        const docGlanceStateNode = $('pcHubDocGlanceState');
        if (docGlanceStateNode) {
            docGlanceStateNode.textContent = {
                loading: '불러오는 중입니다.',
                denied: '조회 권한 확인 필요',
                error: '조회 실패 · 다시 시도',
                empty: '',
                ready: '',
                idle: ''
            }[c.status] || '';
        }

        const basis = $('pcLiveDocBasis');
        if (basis) basis.textContent = docCardBasisText();

        const stateText = {
            idle: '조회 결과 대기 중입니다.',
            loading: '문서결재 현황을 불러오는 중입니다.',
            ready: '',
            empty: '표시할 문서결재 요청이 없습니다.',
            denied: '문서결재 조회 권한이 없습니다.',
            error: '문서결재 현황을 불러오지 못했습니다.'
        }[c.status] || '';
        setText('pcLiveDocState', stateText);
        setText('pcLiveOpsDocState', stateText);

        renderDocCardRecent();
    }

    // 최근 조회(승인·반려·최근 요청) 결과만 초기화. 대기·보류는 별도 활성 조회 소관.
    function resetAdminRecentData() {
        const c = state.docCard;
        c.approved7 = 0;
        c.rejected7 = 0;
        c.recent = [];
        c.adminRecentPartial = false;
        c.adminRecentLimit = DOC_CARD.ADMIN_RECENT_LIMIT;
    }

    // 관리자 전용 단발 bounded 조회 1회 (실시간 Listener 아님, 신규 index 불필요)
    function fetchAdminRecentOnce() {
        const c = state.docCard;
        if (!isAdmin()) return;                 // 관리자 권한 확인 후에만 조회
        // WORK33 인라인 상세 대시보드의 bounded 요약 결과를 재사용해 별도 get()을 만들지 않는다.
        if ($('pcLiveDocumentApprovalDashboard')) return;
        if (c.inflight) return;                 // 진행 중이면 상태 유지 (중복 실행 금지)
        if (!window.db || typeof window.db.collection !== 'function') {
            // Firestore 미준비: 조용히 반환하지 않고 카드 내부 오류로 종료 (무한 로딩 방지)
            resetAdminRecentData();
            c.status = 'error';
            renderDocCard();
            return;                             // Firestore 호출 0건
        }
        // 재조회 시작: 이전 최근 조회 결과를 먼저 제거하고 로딩 상태를 명확히 표시
        resetAdminRecentData();
        c.status = 'loading';
        renderDocCard();
        const seq = ++c.seq;
        c.inflight = true;
        window.db.collection(DOC_CARD.COLLECTION)
            .orderBy('createdAt', 'desc')
            .limit(DOC_CARD.ADMIN_RECENT_LIMIT)
            .get()
            .then(snapshot => {
                if (seq !== c.seq || !isAdmin()) return;   // 오래된 응답은 화면을 덮지 않음
                const rows = snapshot.docs.map(doc => {
                    const data = doc.data() || {};
                    data.id = doc.id;
                    return data;
                });
                const cutoff = Date.now() - DOC_CARD.WINDOW_MS;
                c.approved7 = rows.filter(r => r.status === 'approved' && timestampValue(r.createdAt) >= cutoff).length;
                c.rejected7 = rows.filter(r => r.status === 'rejected' && timestampValue(r.createdAt) >= cutoff).length;
                c.recent = rows.slice(0, DOC_CARD.RECENT_ITEMS);
                const capped = rows.length >= DOC_CARD.ADMIN_RECENT_LIMIT;
                const oldestMs = rows.length ? timestampValue(rows[rows.length - 1].createdAt) : 0;
                c.adminRecentPartial = capped && oldestMs >= cutoff;  // 상한 도달 + 마지막 건도 7일 이내
                c.status = rows.length ? 'ready' : 'empty';
                renderDocCard();
            })
            .catch(error => {
                if (seq !== c.seq) return;
                // 실패한 조회의 과거 결과를 재사용하지 않는다 (대기·보류는 활성 조회 소관이라 유지)
                resetAdminRecentData();
                c.status = (error && error.code === 'permission-denied') ? 'denied' : 'error';
                console.warn('[live-hub] document approval card query failed:', error);
                renderDocCard();   // 오류는 카드 내부에서만 처리 (LIVE 전체 렌더 중단 없음)
            })
            .finally(() => { c.inflight = false; });
    }

    // 관리자: approval.js 기존 결과 재사용(대기·보류) + 단발 조회로 7일 지표·최신 5건
    // activeAuthoritative=false(=`all` 등 다른 필터)면 대기·보류·150건 상한을 덮어쓰지 않는다.
    // `all` 결과는 상태 무관 최신 150건이라, 그중 활성 건만 세면 누적 활성 요청을 과소 집계한다.
    function feedAdminDocCard(activeAuthoritative) {
        const c = state.docCard;
        if (!isAdmin()) return;
        c.role = 'admin';
        c.employeeCapped = false;
        if (activeAuthoritative) {
            const active = state.documentApprovals;
            c.pending = active.filter(request => request?.status === 'pending').length;
            c.onHold = active.filter(request => request?.status === 'on_hold').length;
            c.adminActiveCapped = active.length >= DOC_CARD.ADMIN_ACTIVE_LIMIT;
        }
        renderDocCard();
        fetchAdminRecentOnce();
    }

    function bindDocCardNavigation() {
        const button = $('pcLiveDocOpenBtn');
        if (!button || button.dataset.yjDocCardBound === 'true') return;
        button.dataset.yjDocCardBound = 'true';
        button.addEventListener('click', () => scrollToPanel('pcLiveDocumentApprovalDashboard'));
    }

    function deriveAdminRecentSummary(rows, over, limit, nowMs) {
        const cutoff = (nowMs || Date.now()) - DOC_CARD.WINDOW_MS;
        const oldestMs = rows.length ? timestampValue(rows[rows.length - 1]?.createdAt) : 0;
        return {
            approved7: rows.filter(row => row?.status === 'approved' && timestampValue(row?.createdAt) >= cutoff).length,
            rejected7: rows.filter(row => row?.status === 'rejected' && timestampValue(row?.createdAt) >= cutoff).length,
            recent: rows.slice(0, DOC_CARD.RECENT_ITEMS),
            partial: Boolean(over && oldestMs >= cutoff),
            limit: Number(limit) || DOC_CARD.ADMIN_RECENT_LIMIT
        };
    }

    // approval-dashboard.js의 기간=전체 조회 결과를 WORK32 요약 카드에도 공급한다.
    function updateApprovalDashboardSummary(payload) {
        if (!isAdmin() || payload?.role !== 'admin') return;
        const c = state.docCard;
        c.role = 'admin';
        if (payload?.error) {
            resetAdminRecentData();
            c.status = payload.code === 'permission-denied' ? 'denied' : 'error';
            renderDocCard();
            return;
        }
        if (!Array.isArray(payload?.rows)) return;
        const rows = payload.rows;
        const recent = deriveAdminRecentSummary(rows, payload.over, payload.limit);
        c.approved7 = recent.approved7;
        c.rejected7 = recent.rejected7;
        c.recent = recent.recent;
        c.adminRecentPartial = recent.partial;
        c.adminRecentLimit = recent.limit;
        c.status = rows.length ? 'ready' : 'empty';
        renderDocCard();
    }

    function updateVisibility() {
        const admin = isAdmin();
        if (!admin && state.documentApprovals.length) {
            state.documentApprovals = [];
        }
        $('pcAdminOperationsHub')?.classList.toggle('hidden', !admin);
        // WORK32: 신규 카드는 관리자 hub 상태와 분리 제어.
        // 비로그인·비활성이면 초기화(조회 0건), 관리자→비관리자 전환 시에만 전사 데이터 폐기.
        if (!docCardEligible()) resetDocCardData();
        else if (state.docCard.role === 'admin' && !admin) resetDocCardData();
        renderDocCard();
    }

    function scrollToPanel(targetId) {
        const target = $(targetId);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('ring-2', 'ring-blue-500/50');
        window.setTimeout(() => target.classList.remove('ring-2', 'ring-blue-500/50'), 1200);
    }

    function bindNavigation() {
        document.querySelectorAll('[data-yj-hub-target]').forEach(button => {
            if (button.dataset.yjHubBound === 'true') return;
            button.dataset.yjHubBound = 'true';
            button.addEventListener('click', () => scrollToPanel(button.dataset.yjHubTarget));
        });
    }

    function renderAll() {
        updateVisibility();
        renderApprovalRequests();
        renderOrders();
    }

    function init() {
        bindNavigation();
        bindDocCardNavigation();
        bindRecentToggle();
        state.initialized = true;
        renderAll();
    }

    function updateApprovalRequests(requests) {
        state.approvalRequests = Array.isArray(requests) ? requests.slice() : [];
        renderApprovalRequests();
    }

    function updateDocumentApprovals(requests, filter) {
        if (filter !== 'active' && filter !== 'all') return;
        const nextRequests = Array.isArray(requests) ? requests.slice() : [];
        state.documentApprovals = filter === 'all'
            ? nextRequests.filter(request => request?.status === 'pending' || request?.status === 'on_hold')
            : nextRequests;
        // WORK32: 카드의 대기·보류·상한은 `active` 결과일 때만 갱신 (기존 hub 동작은 그대로)
        feedAdminDocCard(filter === 'active');
    }

    // WORK32: 직원 경로 — 기존 본인 요청 조회 결과만 전달받아 계산(신규 Firestore 쿼리 0건)
    function updateEmployeeDocumentApprovals(requests, options) {
        const c = state.docCard;
        if (isAdmin()) return;                       // 관리자 카드는 관리자 경로가 관리
        if (!docCardEligible()) { resetDocCardData(); renderDocCard(); return; }
        const opts = options || {};
        c.role = 'employee';
        c.adminActiveCapped = false;
        c.adminRecentPartial = false;
        c.seq += 1;                                   // 진행 중 관리자 응답 무효화(역할 전환 대비)
        if (opts.error) {
            // 조회 실패 시 이전 성공 데이터를 화면에 남기지 않는다 (마지막 조회 시각 표기가 없으므로)
            c.pending = 0; c.onHold = 0; c.approved7 = 0; c.rejected7 = 0;
            c.recent = [];
            c.employeeCapped = false;
            c.status = (opts.code === 'permission-denied') ? 'denied' : 'error';
            renderDocCard();
            return;
        }
        const rows = Array.isArray(requests) ? requests.slice() : [];
        const cutoff = Date.now() - DOC_CARD.WINDOW_MS;
        c.pending = rows.filter(request => request?.status === 'pending').length;
        c.onHold = rows.filter(request => request?.status === 'on_hold').length;
        c.approved7 = rows.filter(request => request?.status === 'approved' && timestampValue(request?.createdAt) >= cutoff).length;
        c.rejected7 = rows.filter(request => request?.status === 'rejected' && timestampValue(request?.createdAt) >= cutoff).length;
        c.recent = rows.slice(0, DOC_CARD.RECENT_ITEMS);
        c.employeeCapped = rows.length >= DOC_CARD.EMPLOYEE_LIMIT;
        c.status = rows.length ? 'ready' : 'empty';
        renderDocCard();
    }

    function updateOrders(orders, options) {
        state.orders = Array.isArray(orders) ? orders.slice() : [];
        // WORK41: 조회 실패 신호(선택). 미전달 시 성공으로 간주(기존 호출부 호환).
        state.ordersError = Boolean(options && options.error);
        renderOrders();
    }

    // WORK41: 최근 업무 '완료 포함' 토글 — 변경 시 재렌더(신규 조회 없음)
    function bindRecentToggle() {
        ['pcHubRecentIncludeCompleted', 'pcHubRecentIncludeTest'].forEach(id => {
            const toggle = $(id);
            if (!toggle || toggle.dataset.yjRecentBound === 'true') return;
            toggle.dataset.yjRecentBound = 'true';
            toggle.addEventListener('change', renderOrders);
        });
    }

    window.addEventListener('yj:auth-ready', () => window.setTimeout(() => {
        updateVisibility();
        renderAll();
    }, 0));
    document.addEventListener('DOMContentLoaded', init);

    window.YJLiveOperationsHub = {
        init,
        updateApprovalRequests,
        updateDocumentApprovals,
        updateApprovalDashboardSummary,
        updateEmployeeDocumentApprovals,
        updateOrders,
        refreshVisibility: updateVisibility,
        scrollToPanel,
        __test: {
            deriveAdminRecentSummary,
            docCardState: () => state.docCard,
            seedDocCard: seed => Object.assign(state.docCard, seed || {}),
            // WORK41: 최근 업무 정렬·지연 판별 검증용
            sortRecentOrders,
            orderPriorityRank,
            isDelayedOrder,
            isDueSoonOrder,
            isTestOrder
        }
    };
})();
