(function installYJDocumentApproval() {
    if (window.YJApproval) return;

    const COLLECTION = 'document_approval_requests';
    const DEFAULT_FILTER = 'active';
    const FILTER_STATUSES = {
        active: ['pending', 'on_hold'],
        pending: ['pending'],
        on_hold: ['on_hold'],
        approved: ['approved'],
        rejected: ['rejected'],
        cancelled: ['cancelled'],
        all: null
    };
    const STATUS_LABELS = {
        draft: '작성 중',
        pending: '승인 대기',
        approved: '승인',
        rejected: '반려',
        on_hold: '보류',
        cancelled: '취소',
        applied: '적용 완료'
    };
    const ACTION_BY_TRANSITION = {
        'draft>pending': 'submitted',
        'draft>cancelled': 'cancelled',
        'pending>cancelled': 'cancelled',
        'pending>approved': 'approved',
        'pending>rejected': 'rejected',
        'pending>on_hold': 'on_hold',
        'on_hold>pending': 'resumed',
        'on_hold>approved': 'approved',
        'on_hold>rejected': 'rejected'
    };
    const ADMIN_TRANSITIONS = {
        pending: ['approved', 'rejected', 'on_hold'],
        on_hold: ['approved', 'rejected']
    };

    const state = {
        initialized: false,
        loading: false,
        requests: [],
        selectedId: '',
        filter: DEFAULT_FILTER,
        processingRequestIds: new Set()
    };

    const dom = {};

    function $(id) {
        return document.getElementById(id);
    }

    function cacheDom() {
        dom.panel = $('pcDocumentApprovalPanel');
        dom.filter = $('pcDocumentApprovalStatusFilter');
        dom.refresh = $('pcDocumentApprovalRefreshBtn');
        dom.message = $('pcDocumentApprovalMessage');
        dom.body = $('pcDocumentApprovalBody');
        dom.detail = $('pcDocumentApprovalDetail');
        return Boolean(dom.panel && dom.filter && dom.refresh && dom.message && dom.body && dom.detail);
    }

    function currentUser() {
        if (window.currentUser) return window.currentUser;
        if (typeof window.yjGetCurrentUser === 'function') return window.yjGetCurrentUser();
        return null;
    }

    function isAdminUser() {
        const user = currentUser();
        const canAdminWrite = typeof window.canWrite === 'function' ? window.canWrite('admin', user?.role) : user?.role === 'admin';
        return Boolean(user && user.status === 'active' && canAdminWrite);
    }

    function getReviewerUid() {
        return window.auth?.currentUser?.uid || currentUser()?.auth_uid || '';
    }

    function getReviewerName() {
        return String(currentUser()?.name || '').trim();
    }

    function setMessage(text, tone) {
        if (!dom.message) return;
        dom.message.textContent = text || '';
        dom.message.className = 'mb-3 min-h-[28px] rounded-lg border px-3 py-2 text-[11px] font-bold ';
        if (tone === 'error') dom.message.className += 'border-rose-500/30 bg-rose-500/10 text-rose-300';
        else if (tone === 'success') dom.message.className += 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
        else dom.message.className += 'border-[#334155] bg-[#0f1522] text-slate-400';
    }

    function clearNode(node) {
        if (node) node.textContent = '';
    }

    function appendText(parent, tagName, text, className) {
        const el = document.createElement(tagName);
        if (className) el.className = className;
        el.textContent = text == null || text === '' ? '-' : String(text);
        parent.appendChild(el);
        return el;
    }

    function tableMessage(message) {
        clearNode(dom.body);
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.className = 'px-3 py-8 text-center text-slate-500 font-bold';
        cell.textContent = message;
        row.appendChild(cell);
        dom.body.appendChild(row);
    }

    function formatTime(value) {
        try {
            if (!value) return '-';
            if (typeof value.toDate === 'function') return value.toDate().toLocaleString('ko-KR');
            if (typeof value === 'number') return new Date(value).toLocaleString('ko-KR');
            if (value instanceof Date) return value.toLocaleString('ko-KR');
            return String(value).slice(0, 19);
        } catch (error) {
            return '-';
        }
    }

    function getSortMillis(request) {
        const value = request.updatedAt || request.submittedAt || request.createdAt || request.reviewedAt;
        try {
            if (value?.toDate) return value.toDate().getTime();
            if (typeof value === 'number') return value;
            if (typeof value === 'string') return Date.parse(value) || 0;
        } catch (error) { }
        return 0;
    }

    function statusLabel(status) {
        return STATUS_LABELS[status] || status || '-';
    }

    function selectedFilterStatuses() {
        return FILTER_STATUSES[state.filter] === undefined ? FILTER_STATUSES[DEFAULT_FILTER] : FILTER_STATUSES[state.filter];
    }

    function canTransition(previousStatus, nextStatus) {
        return ADMIN_TRANSITIONS[previousStatus]?.includes(nextStatus) && Boolean(ACTION_BY_TRANSITION[`${previousStatus}>${nextStatus}`]);
    }

    function sanitizeError(error) {
        const code = error?.code || '';
        if (code === 'permission-denied') return '문서 결재 권한이 없습니다. Rules 배포 상태와 관리자 계정을 확인하세요.';
        if (code === 'failed-precondition') return '요청 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.';
        if (code === 'not-found') return '문서 결재 요청을 찾을 수 없습니다.';
        if (code === 'unavailable' || code === 'deadline-exceeded') return '네트워크 문제로 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
        return '문서 결재 처리를 완료하지 못했습니다. 콘솔을 확인하세요.';
    }

    function displayValue(request, keys, fallback) {
        for (const key of keys) {
            const value = request?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return fallback || '-';
    }

    function requestTitle(request) {
        return displayValue(request, ['title', 'documentType', 'requestType'], '제목 없음');
    }

    function requesterName(request) {
        return displayValue(request, ['requesterName', 'requesterEmail', 'requesterUid'], '요청자 정보 없음');
    }

    function renderStatusBadge(parent, status) {
        const span = document.createElement('span');
        const tone = {
            pending: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
            approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
            rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
            on_hold: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
            cancelled: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
            draft: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
            applied: 'bg-purple-500/10 text-purple-300 border-purple-500/30'
        }[status] || 'bg-slate-500/10 text-slate-300 border-slate-500/30';
        span.className = `inline-flex items-center rounded border px-2 py-1 text-[10px] font-black ${tone}`;
        span.textContent = statusLabel(status);
        parent.appendChild(span);
    }

    function createButton(label, className, onClick, disabled) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.disabled = Boolean(disabled);
        if (!disabled) button.addEventListener('click', onClick);
        return button;
    }

    function baseButtonClass(tone) {
        const base = 'mr-1 mb-1 px-3 py-2 rounded-lg text-[10px] font-black transition-colors disabled:cursor-not-allowed disabled:opacity-50 ';
        if (tone === 'approve') return base + 'bg-emerald-700 hover:bg-emerald-600 text-white';
        if (tone === 'reject') return base + 'bg-rose-700 hover:bg-rose-600 text-white';
        if (tone === 'hold') return base + 'bg-amber-700 hover:bg-amber-600 text-white';
        return base + 'bg-slate-700 text-slate-200';
    }

    function renderActions(cell, request) {
        const status = String(request.status || '');
        const isProcessing = state.processingRequestIds.has(request.id);
        if (!ADMIN_TRANSITIONS[status]) {
            appendText(cell, 'span', '처리 불가', 'text-[10px] font-black text-slate-500');
            return;
        }
        if (canTransition(status, 'approved')) {
            cell.appendChild(createButton('승인', baseButtonClass('approve'), () => openDetail(request.id, 'approved'), isProcessing));
        }
        if (canTransition(status, 'rejected')) {
            cell.appendChild(createButton('반려', baseButtonClass('reject'), () => openDetail(request.id, 'rejected'), isProcessing));
        }
        if (canTransition(status, 'on_hold')) {
            cell.appendChild(createButton('보류', baseButtonClass('hold'), () => openDetail(request.id, 'on_hold'), isProcessing));
        }
    }

    function renderRows() {
        if (!dom.body) return;
        clearNode(dom.body);
        if (!state.requests.length) {
            tableMessage('표시할 문서 결재 요청이 없습니다.');
            renderDetail(null);
            return;
        }

        state.requests.forEach(request => {
            const row = document.createElement('tr');
            row.className = request.id === state.selectedId
                ? 'border-b border-[#334155]/70 bg-blue-500/10'
                : 'border-b border-[#334155]/70 hover:bg-slate-800/50';

            appendText(row, 'td', formatTime(request.submittedAt || request.createdAt), 'px-3 py-3 text-slate-400 align-top whitespace-nowrap');

            const docCell = document.createElement('td');
            docCell.className = 'px-3 py-3 align-top min-w-[220px]';
            appendText(docCell, 'div', requestTitle(request), 'font-black text-white text-[12px] leading-snug');
            appendText(docCell, 'div', displayValue(request, ['documentType', 'requestType'], '문서'), 'text-[10px] text-slate-500 font-bold mt-1');
            row.appendChild(docCell);

            const requesterCell = document.createElement('td');
            requesterCell.className = 'px-3 py-3 align-top min-w-[160px]';
            appendText(requesterCell, 'div', requesterName(request), 'font-bold text-slate-200');
            appendText(requesterCell, 'div', displayValue(request, ['requesterRole', 'requesterSite'], '-'), 'text-[10px] text-slate-500 font-bold mt-1');
            row.appendChild(requesterCell);

            const statusCell = document.createElement('td');
            statusCell.className = 'px-3 py-3 align-top';
            renderStatusBadge(statusCell, request.status);
            row.appendChild(statusCell);

            appendText(row, 'td', displayValue(request, ['reviewerName', 'reviewerUid'], '-'), 'px-3 py-3 text-slate-300 font-bold align-top');
            appendText(row, 'td', formatTime(request.reviewedAt), 'px-3 py-3 text-slate-400 align-top whitespace-nowrap');

            const actionCell = document.createElement('td');
            actionCell.className = 'px-3 py-3 align-top min-w-[160px]';
            renderActions(actionCell, request);
            row.appendChild(actionCell);

            row.addEventListener('click', event => {
                if (event.target.closest('button')) return;
                openDetail(request.id);
            });
            dom.body.appendChild(row);
        });
    }

    function renderPayload(parent, request) {
        const payload = request?.payload;
        const box = document.createElement('div');
        box.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
        appendText(box, 'p', '요청 내용', 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
        if (!payload || typeof payload !== 'object') {
            appendText(box, 'p', displayValue(request, ['description'], '내용 없음'), 'text-[11px] text-slate-300 whitespace-pre-line');
        } else {
            Object.keys(payload).slice(0, 12).forEach(key => {
                const line = document.createElement('div');
                line.className = 'grid grid-cols-[110px_1fr] gap-2 text-[11px] py-1 border-b border-[#334155]/40 last:border-b-0';
                appendText(line, 'span', key, 'text-slate-500 font-black');
                const value = payload[key];
                appendText(line, 'span', typeof value === 'object' ? JSON.stringify(value) : value, 'text-slate-300 break-words');
                box.appendChild(line);
            });
        }
        parent.appendChild(box);
    }

    function createReasonArea(action, request) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mt-4 rounded-lg border border-[#334155] bg-[#111827] p-3';
        const label = action === 'approved' ? '승인 의견' : action === 'rejected' ? '반려 사유' : '보류 사유';
        appendText(wrapper, 'label', label, 'block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2');
        const textarea = document.createElement('textarea');
        textarea.id = 'pcDocumentApprovalReasonInput';
        textarea.rows = 4;
        textarea.maxLength = 500;
        textarea.className = 'w-full rounded-lg border border-[#334155] bg-[#0f1522] px-3 py-2 text-xs text-white outline-none focus:border-cyan-400 resize-none';
        textarea.placeholder = action === 'approved' ? '선택 입력, 최대 500자' : '필수 입력, 공백 제외 2~500자';
        wrapper.appendChild(textarea);

        const actions = document.createElement('div');
        actions.className = 'mt-3 flex flex-wrap gap-2';
        const confirm = createButton(label + ' 처리', baseButtonClass(action === 'approved' ? 'approve' : action === 'rejected' ? 'reject' : 'hold'), () => handleDecision(request.id, action), false);
        const cancel = createButton('취소', baseButtonClass('neutral'), () => renderDetail(request), false);
        actions.appendChild(confirm);
        actions.appendChild(cancel);
        wrapper.appendChild(actions);
        return wrapper;
    }

    function renderDetail(request, action) {
        if (!dom.detail) return;
        clearNode(dom.detail);
        if (!request) {
            appendText(dom.detail, 'p', '목록에서 요청을 선택하면 상세 정보와 처리 사유 입력 영역이 표시됩니다.', 'text-[11px] text-slate-500 font-bold');
            return;
        }
        state.selectedId = request.id;
        appendText(dom.detail, 'p', requestTitle(request), 'text-sm font-black text-white leading-snug');
        appendText(dom.detail, 'p', `${requesterName(request)} · ${displayValue(request, ['requesterRole'], '-')}`, 'mt-1 text-[11px] text-slate-400 font-bold');
        const statusLine = document.createElement('div');
        statusLine.className = 'mt-3';
        renderStatusBadge(statusLine, request.status);
        dom.detail.appendChild(statusLine);
        renderPayload(dom.detail, request);

        const description = displayValue(request, ['description'], '');
        if (description && description !== '-') {
            const desc = document.createElement('div');
            desc.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
            appendText(desc, 'p', '설명', 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
            appendText(desc, 'p', description, 'text-[11px] text-slate-300 whitespace-pre-line');
            dom.detail.appendChild(desc);
        }

        if (action && canTransition(request.status, action)) {
            dom.detail.appendChild(createReasonArea(action, request));
        } else if (ADMIN_TRANSITIONS[request.status]) {
            appendText(dom.detail, 'p', '처리 버튼을 선택하면 사유 입력 영역이 열립니다.', 'mt-4 text-[11px] text-slate-500 font-bold');
        } else {
            appendText(dom.detail, 'p', '이 요청은 현재 UI에서 처리 가능한 상태가 아닙니다.', 'mt-4 text-[11px] text-slate-500 font-bold');
        }
    }

    function selectedRequest() {
        return state.requests.find(request => request.id === state.selectedId) || null;
    }

    function openDetail(id, action) {
        const request = state.requests.find(item => item.id === id);
        if (!request) return;
        state.selectedId = id;
        renderRows();
        renderDetail(request, action);
    }

    async function refresh() {
        if (!cacheDom()) return;
        if (state.loading) return;
        if (!isAdminUser()) {
            clearNode(dom.body);
            tableMessage('관리자 계정으로 로그인하면 문서 결재 요청을 조회할 수 있습니다.');
            renderDetail(null);
            setMessage('관리자 전용 패널입니다.', 'error');
            return;
        }
        if (!window.db?.collection) {
            setMessage('Firestore 연결이 준비되지 않았습니다.', 'error');
            return;
        }
        state.loading = true;
        tableMessage('문서 결재 요청을 불러오는 중입니다.');
        setMessage('조회 중...', 'info');
        try {
            const snapshot = await window.db.collection(COLLECTION).limit(150).get();
            const statuses = selectedFilterStatuses();
            state.requests = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(request => !statuses || statuses.includes(String(request.status || '')))
                .sort((a, b) => getSortMillis(b) - getSortMillis(a));
            if (!state.requests.some(request => request.id === state.selectedId)) state.selectedId = '';
            renderRows();
            const activeLabel = state.filter === 'active' ? 'pending + on_hold' : state.filter;
            setMessage(`${activeLabel} 기준 ${state.requests.length}건을 표시합니다.`, 'success');
        } catch (error) {
            console.warn('Document approval requests load failed:', error);
            tableMessage(sanitizeError(error));
            renderDetail(null);
            setMessage(sanitizeError(error), 'error');
        } finally {
            state.loading = false;
        }
    }

    function validateReason(action, rawValue) {
        const reason = String(rawValue || '').trim();
        if (action === 'approved') {
            if (reason.length > 500) return { ok: false, message: '승인 의견은 500자 이하로 입력하세요.' };
            return { ok: true, reason };
        }
        if (reason.length < 2 || reason.length > 500) {
            return { ok: false, message: action === 'rejected' ? '반려 사유는 공백 제외 2~500자로 입력하세요.' : '보류 사유는 공백 제외 2~500자로 입력하세요.' };
        }
        return { ok: true, reason };
    }

    function buildUpdatePayload(action, transitionId, reason, ts) {
        const user = currentUser();
        const payload = {
            status: action,
            reviewerUid: getReviewerUid(),
            reviewerName: getReviewerName(),
            reviewedAt: ts,
            updatedAt: ts,
            lastTransitionId: transitionId
        };
        if (action === 'approved') {
            payload.approvedAt = ts;
            if (reason) payload.reviewComment = reason;
        }
        if (action === 'rejected') payload.rejectionReason = reason;
        if (action === 'on_hold') payload.holdReason = reason;
        if (!payload.reviewerUid && user?.auth_uid) payload.reviewerUid = user.auth_uid;
        return payload;
    }

    function buildHistoryPayload(requestId, transitionId, previousStatus, nextStatus, reason, ts) {
        const user = currentUser();
        return {
            requestId,
            transitionId,
            action: ACTION_BY_TRANSITION[`${previousStatus}>${nextStatus}`],
            previousStatus,
            nextStatus,
            actorUid: getReviewerUid(),
            actorName: getReviewerName(),
            actorRole: user?.role || '',
            comment: reason || '',
            createdAt: ts,
            schemaVersion: 1
        };
    }

    async function handleDecision(requestId, action) {
        if (state.processingRequestIds.has(requestId)) return;
        if (!isAdminUser()) {
            setMessage('관리자만 문서 결재 요청을 처리할 수 있습니다.', 'error');
            return;
        }
        const reviewerUid = getReviewerUid();
        const reviewerName = getReviewerName();
        if (!reviewerUid || !reviewerName) {
            setMessage('관리자 UID와 이름을 확인할 수 없습니다. 다시 로그인 후 시도하세요.', 'error');
            return;
        }
        const request = state.requests.find(item => item.id === requestId);
        if (!request || !canTransition(request.status, action)) {
            setMessage('현재 상태에서 허용되지 않는 결재 처리입니다.', 'error');
            return;
        }
        const reasonInput = $('pcDocumentApprovalReasonInput');
        const validation = validateReason(action, reasonInput?.value || '');
        if (!validation.ok) {
            setMessage(validation.message, 'error');
            if (reasonInput) reasonInput.focus();
            return;
        }
        if (!window.db?.runTransaction || !window.firebase?.firestore?.FieldValue) {
            setMessage('Firestore transaction 기능이 준비되지 않았습니다.', 'error');
            return;
        }

        state.processingRequestIds.add(requestId);
        renderRows();
        setMessage('문서 결재를 처리하는 중입니다.', 'info');
        try {
            const requestRef = window.db.collection(COLLECTION).doc(requestId);
            const historyRef = requestRef.collection('history').doc();
            const transitionId = historyRef.id;
            const ts = window.firebase.firestore.FieldValue.serverTimestamp();

            await window.db.runTransaction(async transaction => {
                const latestSnap = await transaction.get(requestRef);
                if (!latestSnap.exists) throw Object.assign(new Error('request not found'), { code: 'not-found' });
                const latest = { id: latestSnap.id, ...latestSnap.data() };
                const previousStatus = String(latest.status || '');
                if (!canTransition(previousStatus, action)) {
                    throw Object.assign(new Error('invalid transition'), { code: 'failed-precondition' });
                }
                if (!ACTION_BY_TRANSITION[`${previousStatus}>${action}`]) {
                    throw Object.assign(new Error('missing transition action'), { code: 'failed-precondition' });
                }

                transaction.update(requestRef, buildUpdatePayload(action, transitionId, validation.reason, ts));
                transaction.set(historyRef, buildHistoryPayload(requestId, transitionId, previousStatus, action, validation.reason, ts));
            });

            if (typeof window.logAction === 'function') {
                await window.logAction('DOCUMENT_APPROVAL_' + action.toUpperCase(), requestId, {
                    status: action,
                    transitionId
                });
            }
            setMessage('문서 결재 처리가 완료되었습니다.', 'success');
            await refresh();
        } catch (error) {
            console.warn('Document approval transaction failed:', error);
            setMessage(sanitizeError(error), 'error');
        } finally {
            state.processingRequestIds.delete(requestId);
            renderRows();
            const request = selectedRequest();
            if (request) renderDetail(request);
        }
    }

    function bindEvents() {
        if (!cacheDom()) return false;
        if (state.initialized) return true;
        state.initialized = true;
        dom.filter.addEventListener('change', () => {
            state.filter = dom.filter.value || DEFAULT_FILTER;
            refresh();
        });
        dom.refresh.addEventListener('click', refresh);
        return true;
    }

    function init() {
        if (!bindEvents()) return;
        if (isAdminUser()) refresh();
    }

    window.addEventListener('yj:auth-ready', () => {
        setTimeout(init, 0);
    });
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(init, 0);
    });

    window.YJApproval = {
        init,
        refresh,
        openDetail
    };
})();
