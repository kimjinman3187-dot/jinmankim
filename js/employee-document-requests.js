(function installYJEmployeeDocumentRequests() {
    if (window.YJEmployeeDocumentRequests) return;

    const COLLECTION = 'document_approval_requests';
    const SORT_FIELD = 'createdAt';
    const LIMIT = 100;
    const FILTERS = ['all', 'pending', 'approved', 'on_hold', 'rejected'];

    const state = {
        initialized: false,
        loading: false,
        submitting: false,
        requests: [],
        selectedId: '',
        filter: 'all'
    };

    const dom = {};

    function $(id) {
        return document.getElementById(id);
    }

    function cacheDom() {
        dom.panel = $('pcEmployeeDocumentRequestPanel');
        dom.form = $('pcEmployeeDocumentForm');
        dom.title = $('pcEmployeeDocumentTitleInput');
        dom.description = $('pcEmployeeDocumentDescriptionInput');
        dom.submit = $('pcEmployeeDocumentSubmitBtn');
        dom.filter = $('pcEmployeeDocumentStatusFilter');
        dom.refresh = $('pcEmployeeDocumentRefreshBtn');
        dom.message = $('pcEmployeeDocumentMessage');
        dom.body = $('pcEmployeeDocumentBody');
        dom.detail = $('pcEmployeeDocumentDetail');
        return Boolean(dom.panel && dom.form && dom.title && dom.description && dom.submit && dom.filter && dom.refresh && dom.message && dom.body && dom.detail);
    }

    function currentUser() {
        if (typeof window.yjGetCurrentUser === 'function') return window.yjGetCurrentUser();
        return window.currentUser || null;
    }

    function authUser() {
        return window.auth?.currentUser || window.FirebaseShared?.getAuth?.()?.currentUser || null;
    }

    function isActiveUser(user) {
        return Boolean(user && (user.status || 'active') === 'active');
    }

    function getUserUidFields(user) {
        return [user?.auth_uid, user?.uid, user?.id].filter(value => typeof value === 'string' && value.trim() !== '');
    }

    function hasMatchingAuth(user, auth) {
        if (!auth?.uid) return false;
        const fields = getUserUidFields(user);
        return fields.length > 0 && fields.every(value => value === auth.uid);
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

    function setMessage(text, tone) {
        if (!dom.message) return;
        dom.message.textContent = text || '';
        dom.message.className = 'mb-3 min-h-[28px] rounded-lg border px-3 py-2 text-[11px] font-bold ';
        if (tone === 'error') dom.message.className += 'border-rose-500/30 bg-rose-500/10 text-rose-300';
        else if (tone === 'success') dom.message.className += 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
        else dom.message.className += 'border-[#334155] bg-[#0f1522] text-slate-400';
    }

    function tableMessage(message) {
        clearNode(dom.body);
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'px-3 py-8 text-center text-slate-500 font-bold';
        cell.textContent = message;
        row.appendChild(cell);
        dom.body.appendChild(row);
    }

    function formatTime(value) {
        try {
            if (!value) return '-';
            if (typeof value.toDate === 'function') return value.toDate().toLocaleString('ko-KR');
            if (value instanceof Date) return value.toLocaleString('ko-KR');
            if (typeof value === 'number') return new Date(value).toLocaleString('ko-KR');
            if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString('ko-KR');
            return String(value).slice(0, 19);
        } catch (error) {
            return '-';
        }
    }

    function statusLabel(status) {
        if (typeof window.YJApproval?.getStatusLabel === 'function') return window.YJApproval.getStatusLabel(status);
        const labels = {
            pending: '결재 대기',
            approved: '승인',
            rejected: '반려',
            on_hold: '보류',
            cancelled: '취소',
            applied: '적용 완료'
        };
        return labels[status] || status || '-';
    }

    function renderStatusBadge(parent, status) {
        const span = document.createElement('span');
        const tone = {
            pending: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
            approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
            rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
            on_hold: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
            cancelled: 'bg-slate-500/10 text-slate-300 border-slate-500/30'
        }[status] || 'bg-slate-500/10 text-slate-300 border-slate-500/30';
        span.className = `inline-flex items-center rounded border px-2 py-1 text-[10px] font-black ${tone}`;
        span.textContent = statusLabel(status);
        parent.appendChild(span);
    }

    function filteredRequests() {
        if (!FILTERS.includes(state.filter) || state.filter === 'all') return state.requests;
        return state.requests.filter(request => request.status === state.filter);
    }

    function requestTitle(request) {
        return request?.title || '제목 없음';
    }

    function renderRows() {
        if (!dom.body) return;
        const rows = filteredRequests();
        clearNode(dom.body);
        if (!rows.length) {
            tableMessage('표시할 본인 문서 결재 요청이 없습니다.');
            renderDetail(null);
            return;
        }
        rows.forEach(request => {
            const row = document.createElement('tr');
            row.className = request.id === state.selectedId
                ? 'border-b border-[#334155]/70 bg-blue-500/10'
                : 'border-b border-[#334155]/70 hover:bg-slate-800/50';

            appendText(row, 'td', formatTime(request.submittedAt || request.createdAt), 'px-3 py-3 text-slate-400 align-top whitespace-nowrap');
            appendText(row, 'td', requestTitle(request), 'px-3 py-3 font-black text-white align-top min-w-[220px]');
            const statusCell = document.createElement('td');
            statusCell.className = 'px-3 py-3 align-top';
            renderStatusBadge(statusCell, request.status);
            row.appendChild(statusCell);
            appendText(row, 'td', formatTime(request.reviewedAt || request.approvedAt), 'px-3 py-3 text-slate-400 align-top whitespace-nowrap');

            row.addEventListener('click', () => openDetail(request.id));
            dom.body.appendChild(row);
        });
    }

    function renderResult(parent, request) {
        const status = request?.status || '';
        let label = '처리 결과';
        let value = '';
        if (status === 'approved') {
            label = '승인 의견';
            value = request.reviewComment || '승인되었습니다.';
        } else if (status === 'rejected') {
            label = '반려 사유';
            value = request.rejectionReason || '';
        } else if (status === 'on_hold') {
            label = '보류 사유';
            value = request.holdReason || '';
        } else if (status === 'pending') {
            value = '관리자 결재 대기 중입니다.';
        } else {
            value = statusLabel(status);
        }
        const box = document.createElement('div');
        box.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
        appendText(box, 'p', label, 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
        appendText(box, 'p', value || '-', 'text-[11px] text-slate-300 whitespace-pre-line');
        parent.appendChild(box);
    }

    function renderDetail(request) {
        if (!dom.detail) return;
        clearNode(dom.detail);
        if (!request) {
            appendText(dom.detail, 'p', '목록에서 요청을 선택하면 상세와 처리 결과를 표시합니다.', 'text-[11px] text-slate-500 font-bold');
            return;
        }
        state.selectedId = request.id;
        appendText(dom.detail, 'p', requestTitle(request), 'text-sm font-black text-white leading-snug');
        appendText(dom.detail, 'p', formatTime(request.submittedAt || request.createdAt), 'mt-1 text-[11px] text-slate-400 font-bold');
        const statusLine = document.createElement('div');
        statusLine.className = 'mt-3';
        renderStatusBadge(statusLine, request.status);
        dom.detail.appendChild(statusLine);

        const desc = document.createElement('div');
        desc.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
        appendText(desc, 'p', '상세 내용', 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
        appendText(desc, 'p', request.description || '-', 'text-[11px] text-slate-300 whitespace-pre-line');
        dom.detail.appendChild(desc);

        const reviewer = document.createElement('div');
        reviewer.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
        appendText(reviewer, 'p', '처리 정보', 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
        appendText(reviewer, 'p', `처리자: ${request.reviewerName || '-'}`, 'text-[11px] text-slate-300');
        appendText(reviewer, 'p', `처리일: ${formatTime(request.reviewedAt || request.approvedAt)}`, 'mt-1 text-[11px] text-slate-300');
        dom.detail.appendChild(reviewer);

        renderResult(dom.detail, request);
    }

    function openDetail(id) {
        const request = state.requests.find(item => item.id === id);
        if (!request) return;
        state.selectedId = id;
        renderRows();
        renderDetail(request);
    }

    function validateForm() {
        const title = String(dom.title?.value || '').trim();
        const description = String(dom.description?.value || '').trim();
        if (title.length < 2 || title.length > 80) return { ok: false, message: '제목은 공백 제외 2~80자로 입력하세요.' };
        if (description.length < 2 || description.length > 1000) return { ok: false, message: '상세 내용은 공백 제외 2~1000자로 입력하세요.' };
        return { ok: true, title, description };
    }

    function buildCreatePayload(user, auth, ts, title, description) {
        return {
            requestType: 'document',
            documentType: 'GENERAL_APPROVAL',
            status: 'pending',
            schemaVersion: 1,
            title,
            description,
            payload: {
                kind: 'general_approval',
                body: {}
            },
            requesterUid: auth.uid,
            requesterName: user.name,
            requesterRole: user.role,
            createdAt: ts,
            submittedAt: ts,
            updatedAt: ts,
            reviewerUid: null,
            reviewerName: null,
            reviewedAt: null,
            reviewComment: null,
            rejectionReason: null,
            holdReason: null,
            approvedAt: null,
            appliedAt: null,
            appliedByUid: null,
            lastTransitionId: null
        };
    }

    function requireReady() {
        const user = currentUser();
        const auth = authUser();
        if (!isActiveUser(user)) return { ok: false, message: '활성 사용자만 문서 결재 요청을 사용할 수 있습니다.' };
        if (!window.db?.collection || !window.firebase?.firestore?.FieldValue) return { ok: false, message: 'Firestore 연결이 준비되지 않았습니다.' };
        if (!hasMatchingAuth(user, auth)) return { ok: false, message: 'Firebase Auth 사용자와 현재 사용자 정보가 일치하지 않습니다.' };
        if (!user.name || !user.role) return { ok: false, message: '사용자 이름과 권한 정보가 필요합니다.' };
        return { ok: true, user, auth };
    }

    async function submit(event) {
        event.preventDefault();
        if (state.submitting) return;
        const ready = requireReady();
        if (!ready.ok) {
            setMessage(ready.message, 'error');
            return;
        }
        const form = validateForm();
        if (!form.ok) {
            setMessage(form.message, 'error');
            return;
        }
        state.submitting = true;
        dom.submit.disabled = true;
        setMessage('문서 결재 요청을 제출하는 중입니다.', 'info');
        try {
            const ts = window.firebase.firestore.FieldValue.serverTimestamp();
            await window.db.collection(COLLECTION).add(buildCreatePayload(ready.user, ready.auth, ts, form.title, form.description));
            dom.form.reset();
            setMessage('문서 결재 요청을 결재 대기로 제출했습니다.', 'success');
            await refresh();
        } catch (error) {
            console.warn('Employee document request create failed:', error);
            setMessage(error?.code === 'permission-denied' ? '문서 결재 요청 생성 권한이 없습니다.' : '문서 결재 요청을 제출하지 못했습니다.', 'error');
        } finally {
            state.submitting = false;
            dom.submit.disabled = false;
        }
    }

    async function refresh() {
        if (!cacheDom()) return;
        if (state.loading) return;
        const ready = requireReady();
        if (!ready.ok) {
            state.requests = [];
            tableMessage(ready.message);
            renderDetail(null);
            setMessage(ready.message, 'error');
            return;
        }
        state.loading = true;
        tableMessage('본인 문서 결재 요청을 불러오는 중입니다.');
        setMessage('조회 중...', 'info');
        try {
            const snapshot = await window.db.collection(COLLECTION)
                .where('requesterUid', '==', ready.auth.uid)
                .orderBy(SORT_FIELD, 'desc')
                .limit(LIMIT)
                .get();
            state.requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (!state.requests.some(request => request.id === state.selectedId)) state.selectedId = '';
            renderRows();
            if (!state.selectedId) renderDetail(null);
            setMessage(`본인 요청 ${state.requests.length}건을 표시합니다.`, 'success');
        } catch (error) {
            console.warn('Employee document requests load failed:', error);
            state.requests = [];
            tableMessage(error?.code === 'failed-precondition' ? '본인 요청 조회 index가 아직 준비되지 않았습니다.' : '본인 요청을 불러오지 못했습니다.');
            renderDetail(null);
            setMessage(error?.code === 'permission-denied' ? '본인 요청 조회 권한이 없습니다.' : '본인 요청을 불러오지 못했습니다.', 'error');
        } finally {
            state.loading = false;
        }
    }

    function bindEvents() {
        if (!cacheDom()) return false;
        if (state.initialized) return true;
        state.initialized = true;
        dom.form.addEventListener('submit', submit);
        dom.refresh.addEventListener('click', refresh);
        dom.filter.addEventListener('change', () => {
            state.filter = FILTERS.includes(dom.filter.value) ? dom.filter.value : 'all';
            renderRows();
            const selected = state.requests.find(request => request.id === state.selectedId);
            renderDetail(selected || null);
        });
        return true;
    }

    function init() {
        if (!bindEvents()) return;
        const user = currentUser();
        if (isActiveUser(user)) refresh();
    }

    window.addEventListener('yj:auth-ready', () => {
        setTimeout(init, 0);
    });
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(init, 0);
    });

    window.YJEmployeeDocumentRequests = {
        init,
        refresh,
        openDetail
    };
})();
