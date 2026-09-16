(function installYJEmployeeDocumentRequests() {
    if (window.YJEmployeeDocumentRequests) return;

    const COLLECTION = 'document_approval_requests';
    const EXPENSE_COLLECTION = 'expense_approval_requests';
    const SORT_FIELD = 'createdAt';
    const LIMIT = 100;
    const FILTERS = ['all', 'pending', 'approved', 'on_hold', 'rejected'];

    // WORK29: 문서결재 첨부파일 정책 (storage.rules / firestore.rules 와 동일 유지)
    const ATTACH_MAX_FILES = 5;
    const ATTACH_MAX_FILE_BYTES = 10 * 1024 * 1024;
    const ATTACH_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
    const ATTACH_STORAGE_PREFIX = 'document-approval-attachments';
    const ATTACH_SLOTS = ['a0', 'a1', 'a2', 'a3', 'a4'];
    // 확장자 → 업로드 시 지정할 canonical MIME type
    const EXT_CANONICAL_MIME = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        csv: 'text/csv',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        hwp: 'application/x-hwp',
        hwpx: 'application/x-hwpx'
    };
    // 확장자별로 브라우저가 보고할 수 있는 허용 MIME type (일치 검증용)
    const EXT_ACCEPT_BROWSER_MIME = {
        pdf: ['application/pdf'],
        png: ['image/png'],
        jpg: ['image/jpeg'],
        jpeg: ['image/jpeg'],
        xls: ['application/vnd.ms-excel'],
        xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        csv: ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
        doc: ['application/msword'],
        docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        hwp: ['application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp'],
        hwpx: ['application/x-hwpx', 'application/haansofthwpx', 'application/vnd.hancom.hwpx', 'application/zip']
    };
    // 브라우저가 형식을 특정하지 못한 경우 (확장자 검증에 의존)
    const ATTACH_TOLERATED_MIME = new Set(['', 'application/octet-stream']);

    const state = {
        initialized: false,
        loading: false,
        submitting: false,
        requests: [],
        selectedId: '',
        filter: 'all',
        attachments: [],
        // WORK29-CORRECTION D5: 선택한 로컬 파일의 소유 UID. 계정 전환 시 초기화 판단에 사용한다.
        attachmentsOwnerUid: '',
        // WORK29-CORRECTION-02 R3: 첨부 유무와 무관한 계정 컨텍스트 추적
        contextUid: '',
        // WORK29-CORRECTION-03 R3: 사용자 컨텍스트 세대. 유효 사용자 변경·로그아웃·비활성·
        // Auth 불일치가 발생할 때마다 증가하며, 진행 중인 비동기 작업의 결과를 폐기하는 기준이 된다.
        contextVersion: 0,
        refreshSeq: 0,        // 각 조회 작업의 고유 토큰
        loadingSeq: 0,        // 현재 loading 을 점유한 조회 토큰
        loadingVersion: -1,   // 그 조회가 시작된 컨텍스트 세대
        submitSeq: 0,         // 각 제출 작업의 고유 토큰
        submittingSeq: 0,     // 현재 제출 잠금과 버튼 상태를 점유한 토큰
        submittingVersion: -1,
        authWatchBound: false
    };

    const dom = {};

    function $(id) {
        return document.getElementById(id);
    }

    function cacheDom() {
        dom.panel = $('pcEmployeeDocumentRequestPanel');
        dom.form = $('pcEmployeeDocumentForm');
        dom.documentType = $('pcEmployeeDocumentTypeInput');
        dom.title = $('pcEmployeeDocumentTitleInput');
        dom.description = $('pcEmployeeDocumentDescriptionInput');
        dom.expenseFields = $('pcEmployeeExpenseFields');
        dom.expenseType = $('pcEmployeeExpenseTypeInput');
        dom.expenseAmount = $('pcEmployeeExpenseAmountInput');
        dom.expenseDate = $('pcEmployeeExpenseDateInput');
        dom.expensePayee = $('pcEmployeeExpensePayeeInput');
        dom.expenseMethod = $('pcEmployeeExpenseMethodInput');
        dom.submit = $('pcEmployeeDocumentSubmitBtn');
        dom.filter = $('pcEmployeeDocumentStatusFilter');
        dom.refresh = $('pcEmployeeDocumentRefreshBtn');
        dom.message = $('pcEmployeeDocumentMessage');
        dom.body = $('pcEmployeeDocumentBody');
        dom.detail = $('pcEmployeeDocumentDetail');
        dom.attachInput = $('pcEmployeeDocumentAttachmentInput');
        dom.attachSelectBtn = $('pcEmployeeDocumentAttachmentSelectBtn');
        dom.attachList = $('pcEmployeeDocumentAttachmentList');
        dom.attachProgress = $('pcEmployeeDocumentAttachmentProgress');
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
        return status || '-';
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

    function selectedVisibleRequest() {
        if (!state.selectedId) return null;
        return filteredRequests().find(request => request.id === state.selectedId) || null;
    }

    function syncSelectionWithVisibleRows() {
        const selected = selectedVisibleRequest();
        if (!selected) state.selectedId = '';
        return selected;
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
            value = request.workflow?.currentApproverRole === 'accounting' ? '회계 검토 대기 중입니다.' : request.workflow?.currentApproverRole === 'admin' ? '대표 최종 승인 대기 중입니다.' : '관리자 결재 대기 중입니다.';
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

        if (Array.isArray(request.workflow?.steps)) {
            const line = document.createElement('div');
            line.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
            appendText(line, 'p', '결재선 이력', 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
            request.workflow.steps.forEach(step => {
                const status = step.status === 'approved' ? '승인' : step.status === 'rejected' ? '반려' : step.status === 'pending' ? '대기' : '예정';
                appendText(line, 'p', `${step.label} · ${status} · ${step.actorName || '-'} · ${formatTime(step.actedAt)}`, 'mt-1 text-[11px] text-slate-300');
            });
            dom.detail.appendChild(line);
        }

        renderAttachments(dom.detail, request);

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

    function storageAvailable() {
        return Boolean(window.storage && typeof window.storage.ref === 'function');
    }

    function fileExt(name) {
        const parts = String(name || '').toLowerCase().split('.');
        return parts.length > 1 ? parts.pop() : '';
    }

    function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    function validateFile(file) {
        const ext = fileExt(file.name);
        const canonical = EXT_CANONICAL_MIME[ext];
        if (!canonical) return { ok: false, message: `지원하지 않는 형식입니다: ${file.name}` };
        const browserType = String(file.type || '');
        if (!ATTACH_TOLERATED_MIME.has(browserType) && !(EXT_ACCEPT_BROWSER_MIME[ext] || []).includes(browserType)) {
            return { ok: false, message: `확장자와 파일 형식이 일치하지 않습니다: ${file.name}` };
        }
        if (file.size < 1) return { ok: false, message: `빈 파일은 첨부할 수 없습니다: ${file.name}` };
        if (file.size > ATTACH_MAX_FILE_BYTES) return { ok: false, message: `파일당 최대 10MB입니다: ${file.name}` };
        return { ok: true, ext, contentType: canonical };
    }

    function currentAttachmentsTotal() {
        return state.attachments.reduce((sum, att) => sum + att.size, 0);
    }

    function addFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        // D5: 파일 선택은 현재 활성 사용자 본인만 가능하며, 선택 즉시 소유 UID 를 기록한다.
        if (!enforceUserContext()) return;
        const ready = requireReady();
        if (!ready.ok) {
            clearAttachments();
            setMessage(ready.message, 'error');
            return;
        }
        state.attachmentsOwnerUid = ready.auth.uid;
        let added = 0;
        for (const file of files) {
            if (state.attachments.length >= ATTACH_MAX_FILES) {
                setMessage(`첨부는 최대 ${ATTACH_MAX_FILES}개까지 가능합니다.`, 'error');
                break;
            }
            if (state.attachments.some(att => att.name === file.name && att.size === file.size)) {
                continue; // 동일 파일 중복 방지
            }
            const check = validateFile(file);
            if (!check.ok) {
                setMessage(check.message, 'error');
                continue;
            }
            if (currentAttachmentsTotal() + file.size > ATTACH_MAX_TOTAL_BYTES) {
                setMessage('첨부 합계는 최대 30MB입니다.', 'error');
                break;
            }
            state.attachments.push({ file, name: file.name, size: file.size, ext: check.ext, contentType: check.contentType });
            added += 1;
        }
        if (added > 0) setMessage(`첨부 ${state.attachments.length}개 선택됨 (합계 ${formatBytes(currentAttachmentsTotal())}).`, 'info');
        renderAttachmentList();
    }

    function removeAttachment(index) {
        if (index < 0 || index >= state.attachments.length) return;
        state.attachments.splice(index, 1);
        renderAttachmentList();
    }

    function clearAttachments() {
        state.attachments = [];
        state.attachmentsOwnerUid = '';
        if (dom.attachInput) dom.attachInput.value = '';
        renderAttachmentList();
        setAttachProgress('');
    }

    // WORK29-CORRECTION-02 R3: 계정 컨텍스트는 첨부 존재 여부와 무관하게 추적한다.
    // 유효한 사용자면 UID, 아니면 '' (로그아웃·비활성·Auth 불일치 포함).
    function currentContextUid() {
        const user = currentUser();
        const auth = authUser();
        if (!auth?.uid || !isActiveUser(user) || !hasMatchingAuth(user, auth)) return '';
        return auth.uid;
    }

    // 이전 사용자에게 속한 화면 상태를 모두 제거한다.
    function resetUserScopedState() {
        state.attachments = [];
        state.attachmentsOwnerUid = '';
        if (dom.attachInput) dom.attachInput.value = '';
        renderAttachmentList();
        setAttachProgress('');
        if (dom.form) dom.form.reset();
        state.requests = [];
        state.selectedId = '';
        if (dom.body) tableMessage('본인 문서 결재 요청을 조회하세요.');
        renderDetail(null);
    }

    // WORK29-CORRECTION D5 / CORRECTION-02 R3:
    // Auth UID 변경 / 업무 사용자 UID 변경 / 로그아웃 / 비활성 전환 / Auth·업무 사용자 불일치 시
    // 첨부 유무와 관계없이 폼·파일·목록·상세를 초기화한다.
    // WORK29-CORRECTION-03 R3: 컨텍스트 세대를 올려 진행 중인 비동기 작업의 결과를 무효화한다.
    function invalidateContext() {
        state.contextVersion += 1;
        state.refreshSeq += 1;   // 진행 중이던 조회 토큰 무효화
        state.submitSeq += 1;    // 진행 중이던 제출 토큰 무효화
        // 오래된 조회의 finally 가 새 조회의 loading 을 건드리지 못하도록 점유를 해제한다.
        state.loading = false;
        state.loadingSeq = 0;
        state.loadingVersion = -1;
        // 이전 사용자의 제출이 진행 중이어도 새 사용자는 즉시 자기 제출을 시작할 수 있다.
        state.submitting = false;
        state.submittingSeq = 0;
        state.submittingVersion = -1;
        if (dom.submit) dom.submit.disabled = false;
        if (dom.attachSelectBtn) dom.attachSelectBtn.disabled = false;
    }

    // 제출·조회 시작 시점의 컨텍스트를 캡처한다.
    function captureContext() {
        return { uid: currentContextUid(), version: state.contextVersion };
    }

    // 사용자 변경으로 현재 화면에서 결과를 확정 표시할 수 없을 때의 공통 안내.
    function contextChangedNotice(requestId) {
        return `사용자가 변경되어 현재 화면에서 결과를 확정 표시하지 않습니다. 요청 ID(${requestId || '알 수 없음'}) 처리 상태를 관리자에게 확인하세요.`;
    }

    // 캡처 시점과 현재 컨텍스트가 동일한지 확인한다(비동기 완료 지점마다 호출).
    function contextUnchanged(captured) {
        return Boolean(captured)
            && captured.version === state.contextVersion
            && captured.uid !== ''
            && captured.uid === currentContextUid();
    }

    function captureSubmit() {
        const context = captureContext();
        const token = ++state.submitSeq;
        return { uid: context.uid, version: context.version, token };
    }

    function submitOwns(captured) {
        return contextUnchanged(captured)
            && captured.token === state.submitSeq
            && captured.token === state.submittingSeq
            && captured.version === state.submittingVersion;
    }

    function setSubmitMessage(captured, text, tone) {
        if (submitOwns(captured)) setMessage(text, tone);
    }

    function setSubmitProgress(captured, text, tone) {
        if (submitOwns(captured)) setAttachProgress(text, tone);
    }

    function enforceUserContext() {
        const uid = currentContextUid();
        const previous = state.contextUid;
        state.contextUid = uid;
        if (uid !== previous) {
            // R3: 유효 사용자 식별자가 달라졌으면(빈 컨텍스트 → 사용자 포함) 항상 세대를 올려
            // 진행 중인 비동기 작업의 결과를 폐기 대상으로 만든다.
            invalidateContext();
            if (previous !== '') {
                // 이전 사용자가 있던 경우에만 화면 초기화와 안내를 수행한다.
                resetUserScopedState();
                setMessage('사용자가 변경되어 이전 사용자의 입력과 조회 결과를 초기화했습니다.', 'error');
            }
            return Boolean(uid);
        }
        if (!uid) {
            // 유효한 사용자 컨텍스트가 아니면 남아 있는 로컬 파일을 유지하지 않는다.
            if (state.attachments.length) resetUserScopedState();
            return false;
        }
        // 첨부 소유자와 현재 사용자가 다르면(비정상 경로) 파일만 폐기한다.
        if (state.attachments.length && state.attachmentsOwnerUid !== uid) {
            clearAttachments();
            setMessage('첨부 소유자가 현재 사용자와 달라 선택 파일을 초기화했습니다.', 'error');
            return false;
        }
        return true;
    }

    function renderAttachmentList() {
        if (!dom.attachList) return;
        clearNode(dom.attachList);
        state.attachments.forEach((att, index) => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between gap-2 rounded-lg border border-[#334155] bg-[#111827] px-3 py-2';
            const info = document.createElement('div');
            info.className = 'min-w-0';
            const nameEl = document.createElement('p');
            nameEl.className = 'truncate text-[11px] font-bold text-slate-200';
            nameEl.textContent = att.name;
            const sizeEl = document.createElement('p');
            sizeEl.className = 'text-[10px] font-bold text-slate-500';
            sizeEl.textContent = `${att.ext.toUpperCase()} · ${formatBytes(att.size)}`;
            info.appendChild(nameEl);
            info.appendChild(sizeEl);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'shrink-0 h-7 px-2 rounded-md bg-rose-700/70 hover:bg-rose-600 text-white text-[10px] font-black transition-colors disabled:opacity-50';
            remove.textContent = '제거';
            remove.disabled = state.submitting;
            remove.addEventListener('click', () => removeAttachment(index));
            li.appendChild(info);
            li.appendChild(remove);
            dom.attachList.appendChild(li);
        });
    }

    function setAttachProgress(text, tone) {
        if (!dom.attachProgress) return;
        clearNode(dom.attachProgress);
        if (!text) return;
        const p = document.createElement('p');
        p.className = 'text-[10px] font-black ' + (tone === 'error' ? 'text-rose-300' : 'text-cyan-300');
        p.textContent = text;
        dom.attachProgress.appendChild(p);
    }

    function renderAttachments(parent, request) {
        const attachments = request && request.attachments;
        if (!attachments || typeof attachments !== 'object') return;
        const slots = ATTACH_SLOTS.filter(slot => attachments[slot] && typeof attachments[slot] === 'object');
        if (!slots.length) return;
        const box = document.createElement('div');
        box.className = 'mt-3 rounded-lg border border-[#334155] bg-[#111827] p-3';
        appendText(box, 'p', `첨부파일 (${slots.length})`, 'text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2');
        slots.forEach(slot => {
            const meta = attachments[slot];
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between gap-2 py-1 border-b border-[#334155]/40 last:border-b-0';
            const info = document.createElement('div');
            info.className = 'min-w-0';
            const nameEl = document.createElement('p');
            nameEl.className = 'truncate text-[11px] font-bold text-slate-200';
            nameEl.textContent = meta.name || '(이름 없음)';
            const sizeEl = document.createElement('p');
            sizeEl.className = 'text-[10px] font-bold text-slate-500';
            sizeEl.textContent = formatBytes(meta.size);
            info.appendChild(nameEl);
            info.appendChild(sizeEl);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'shrink-0 h-7 px-3 rounded-md bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-black transition-colors';
            btn.textContent = '다운로드';
            btn.addEventListener('click', () => downloadAttachment(meta.storagePath, meta.name));
            row.appendChild(info);
            row.appendChild(btn);
            box.appendChild(row);
        });
        parent.appendChild(box);
    }

    // WORK29-CORRECTION D4: 공용 다운로드 처리 사용 (새 탭 없음 · Blob 저장 · URL 미보관)
    async function downloadAttachment(storagePath, name) {
        if (typeof window.yjDownloadAttachment !== 'function') {
            setMessage('첨부 다운로드 기능이 준비되지 않았습니다.', 'error');
            return;
        }
        setMessage('첨부파일을 내려받는 중입니다...', 'info');
        const result = await window.yjDownloadAttachment(storagePath, name);
        if (result.ok) {
            setMessage(`첨부파일을 저장했습니다: ${name || ''}`.trim(), 'success');
            return;
        }
        setMessage(window.yjAttachmentDownloadMessage(result.code), 'error');
    }

    function validateForm() {
        const documentType = String(dom.documentType?.value || 'GENERAL_APPROVAL');
        const title = String(dom.title?.value || '').trim();
        const description = String(dom.description?.value || '').trim();
        if (title.length < 2 || title.length > 80) return { ok: false, message: '제목은 공백 제외 2~80자로 입력하세요.' };
        if (description.length < 2 || description.length > 1000) return { ok: false, message: '상세 내용은 공백 제외 2~1000자로 입력하세요.' };
        if (documentType !== 'EXPENSE_REPORT') return { ok: true, documentType, title, description, payload: { kind: 'general_approval', body: {} } };
        const expenseType = String(dom.expenseType?.value || '');
        const amount = Number(dom.expenseAmount?.value || 0);
        const plannedDate = String(dom.expenseDate?.value || '');
        const payee = String(dom.expensePayee?.value || '').trim();
        const paymentMethod = String(dom.expenseMethod?.value || '');
        if (!['material', 'outsourcing', 'general', 'entertainment', 'other'].includes(expenseType)) return { ok: false, message: '지출유형을 선택하세요.' };
        if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, message: '금액은 1원 이상의 정수로 입력하세요.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) return { ok: false, message: '지출예정일을 입력하세요.' };
        if (payee.length < 1 || payee.length > 100) return { ok: false, message: '지급처는 1~100자로 입력하세요.' };
        if (!['bank_transfer', 'corporate_card', 'cash'].includes(paymentMethod)) return { ok: false, message: '지급방법을 선택하세요.' };
        if (state.attachments.length < 1) return { ok: false, message: '지출결의서는 증빙첨부가 필수입니다.' };
        return {
            ok: true,
            documentType,
            title,
            description,
            payload: { kind: 'expense_report', body: { expenseType, amount, plannedDate, payee, paymentMethod } }
        };
    }

    function buildCreatePayload(user, auth, ts, form) {
        return {
            requestType: 'document',
            documentType: 'GENERAL_APPROVAL',
            status: 'pending',
            schemaVersion: 1,
            title: form.title,
            description: form.description,
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

    function serverTimestamp() {
        return window.firebase.firestore.FieldValue.serverTimestamp();
    }

    function buildAttachmentMeta(uid, requestId, attachmentSnapshot) {
        const attachments = {};
        let total = 0;
        attachmentSnapshot.forEach((att, index) => {
            const slot = ATTACH_SLOTS[index];
            const storagePath = `${ATTACH_STORAGE_PREFIX}/${uid}/${requestId}/${slot}`;
            // WORK29-CORRECTION-02 R1: 슬롯은 맵 키(a0~a4)가 권위값이므로 중복 slot 필드를 두지 않는다.
            attachments[slot] = {
                name: att.name,
                storagePath,
                contentType: att.contentType,
                size: att.size
            };
            total += att.size;
        });
        return { attachments, total };
    }

    function buildDraftPayload(user, auth, form, meta) {
        const expense = form.documentType === 'EXPENSE_REPORT';
        const base = {
            requestType: 'document',
            documentType: form.documentType,
            status: 'draft',
            schemaVersion: expense ? 3 : 2,
            title: form.title,
            description: form.description,
            payload: form.payload,
            requesterUid: auth.uid,
            requesterName: user.name,
            requesterRole: user.role,
            createdAt: serverTimestamp(),
            submittedAt: null,
            updatedAt: serverTimestamp(),
            reviewerUid: null,
            reviewerName: null,
            reviewedAt: null,
            reviewComment: null,
            rejectionReason: null,
            holdReason: null,
            approvedAt: null,
            appliedAt: null,
            appliedByUid: null,
            lastTransitionId: null,
            attachments: meta.attachments,
            attachmentCount: Object.keys(meta.attachments).length,
            attachmentsTotalSize: meta.total
        };
        if (expense) {
            base.formType = 'expense';
        }
        return base;
    }

    function buildSubmitHistoryPayload(requestId, transitionId, user, auth) {
        return {
            requestId,
            transitionId,
            action: 'submitted',
            previousStatus: 'draft',
            nextStatus: 'pending',
            actorUid: auth.uid,
            actorName: user.name,
            actorRole: user.role,
            comment: '',
            createdAt: serverTimestamp(),
            schemaVersion: 1
        };
    }

    // WORK29-CORRECTION D3: 정리 결과를 단계별로 판정한다.
    // 반환 outcome:
    //   'submitted'      — 재조회 결과 이미 pending (응답만 유실). 파괴적 삭제를 하지 않는다.
    //   'cleaned'        — 등록된 모든 Storage 객체 제거(또는 원래 없음) + draft 문서 삭제 완료.
    //   'cleanup-failed' — Storage 객체가 남았거나 draft 삭제 실패. 성공으로 표시하지 않는다.
    //   'unknown'        — 상태 확인 자체가 실패. 파괴적 삭제를 하지 않는다.
    async function rollbackDraft(docRef, registeredPaths) {
        // 1) 트랜잭션 결과가 불명확할 수 있으므로 현재 상태를 먼저 재확인한다.
        let snap = null;
        try {
            snap = await docRef.get();
        } catch (error) {
            console.error('Rollback state check failed; requestId=', docRef.id, error);
            return { outcome: 'unknown' };
        }
        if (!snap.exists) return { outcome: 'cleaned' }; // 이미 정리됨
        const status = (snap.data() || {}).status;
        if (status !== 'draft') {
            // pending 등으로 이미 전이됨 = 제출이 실제로 완료된 경우. 삭제 금지.
            return { outcome: status === 'pending' ? 'submitted' : 'unknown' };
        }

        // 2) uploadedPaths 만 신뢰하지 않고 요청에 등록된 모든 첨부 경로에 삭제를 시도한다.
        //    (업로드 성공 후 응답만 유실된 경로도 정리 대상에 포함)
        let allRemoved = true;
        for (const path of registeredPaths) {
            try {
                await window.storage.ref(path).delete();
            } catch (error) {
                if (error?.code === 'storage/object-not-found') continue; // 이미 없음 = 정리 완료
                allRemoved = false;
                console.warn('Rollback storage delete failed:', path, error);
            }
        }
        // 3) Storage 객체가 하나라도 남아 있으면 draft 문서를 삭제하지 않는다.
        //    (문서를 먼저 지우면 사용자 권한으로 지울 수 없는 orphan 이 된다.)
        if (!allRemoved) return { outcome: 'cleanup-failed' };

        try {
            await docRef.delete();
            return { outcome: 'cleaned' };
        } catch (error) {
            console.error('Draft rollback delete failed; requestId=', docRef.id, error);
            return { outcome: 'cleanup-failed' };
        }
    }

    // WORK29-CORRECTION-02 R2: 등록된 모든 첨부 경로의 Storage metadata 를 조회해
    // 존재·경로·크기·contentType 일치를 확인한다. 하나라도 불일치·누락·조회 실패면 실패로 판정한다.
    async function verifyUploadedObjects(meta) {
        const entries = Object.entries(meta.attachments);
        for (const [slot, entry] of entries) {
            let info = null;
            try {
                info = await window.storage.ref(entry.storagePath).getMetadata();
            } catch (error) {
                return { ok: false, reason: `${slot} metadata 조회 실패(${error?.code || 'unknown'})` };
            }
            if (!info) return { ok: false, reason: `${slot} metadata 없음` };
            if (info.fullPath !== entry.storagePath) return { ok: false, reason: `${slot} 경로 불일치` };
            if (Number(info.size) !== Number(entry.size)) return { ok: false, reason: `${slot} 크기 불일치` };
            if (info.contentType !== entry.contentType) return { ok: false, reason: `${slot} contentType 불일치` };
        }
        return { ok: true, reason: '' };
    }

    async function submitWithAttachments(ready, form, captured, attachmentSnapshot) {
        if (!storageAvailable()) {
            setSubmitMessage(captured, '첨부 업로드 기능을 사용할 수 없습니다. 첨부 없이 제출하거나 관리자에게 문의하세요.', 'error');
            return;
        }
        const snapshotTotal = attachmentSnapshot.reduce((sum, att) => sum + att.size, 0);
        if (snapshotTotal > ATTACH_MAX_TOTAL_BYTES || attachmentSnapshot.length > ATTACH_MAX_FILES) {
            setSubmitMessage(captured, '첨부 개수/용량 제한을 초과했습니다.', 'error');
            return;
        }
        // WORK29-CORRECTION D5 / CORRECTION-03 R3-C:
        // 제출 시작 시점의 UID 와 컨텍스트 세대를 함께 캡처한다(Auth UID 단독 비교로는 부족).
        const submitUid = ready.auth.uid;
        if (state.attachmentsOwnerUid && state.attachmentsOwnerUid !== submitUid) {
            if (submitOwns(captured)) clearAttachments();
            setSubmitMessage(captured, '사용자가 변경되어 선택한 첨부파일을 초기화했습니다. 다시 선택하세요.', 'error');
            return;
        }
        const targetCollection = form.documentType === 'EXPENSE_REPORT' ? EXPENSE_COLLECTION : COLLECTION;
        const docRef = window.db.collection(targetCollection).doc();
        const requestId = docRef.id;
        const meta = buildAttachmentMeta(submitUid, requestId, attachmentSnapshot);
        // 등록된 전체 첨부 경로 (업로드 응답 유실 대비 — 정리는 이 목록 전체를 대상으로 한다)
        const registeredPaths = Object.values(meta.attachments).map(entry => entry.storagePath);
        let draftCreated = false;
        try {
            await docRef.set(buildDraftPayload(ready.user, ready.auth, form, meta));
            draftCreated = true;

            for (let i = 0; i < attachmentSnapshot.length; i += 1) {
                if (!contextUnchanged(captured)) {
                    throw Object.assign(new Error('user context changed during upload'), { code: 'context-changed' });
                }
                const slot = ATTACH_SLOTS[i];
                const att = attachmentSnapshot[i];
                setSubmitProgress(captured, `파일 업로드 중 ${i + 1}/${attachmentSnapshot.length} · ${att.name}`);
                await window.storage.ref(meta.attachments[slot].storagePath).put(att.file, { contentType: att.contentType });
                if (!contextUnchanged(captured)) {
                    throw Object.assign(new Error('user context changed after upload'), { code: 'context-changed' });
                }
            }

            // WORK29-CORRECTION-02 R2: 제출 직전 등록된 전체 객체의 metadata 를 재확인한다.
            // 정상 클라이언트의 데이터 무결성 보조 장치이며 보안 경계가 아니다
            // (악의적 클라이언트는 이 검사를 건너뛸 수 있다 — 잔여 위험으로 문서화).
            setSubmitProgress(captured, '업로드 결과 확인 중...');
            const verification = await verifyUploadedObjects(meta);
            if (!verification.ok) {
                throw Object.assign(new Error(`attachment verification failed: ${verification.reason}`), { code: 'attachment-mismatch' });
            }

            // R3-C: metadata 확인 중 사용자가 바뀌었으면 pending 전환을 실행하지 않는다.
            // (draft 상태이므로 이후 정리 경로에서 안전하게 처리된다.)
            if (!contextUnchanged(captured)) {
                throw Object.assign(new Error('user context changed before transition'), { code: 'context-changed' });
            }

            setSubmitProgress(captured, '결재 제출 처리 중...');
            const historyRef = docRef.collection('history').doc();
            const transitionId = historyRef.id;
            if (form.documentType === 'EXPENSE_REPORT') {
                if (!window.functions?.httpsCallable) {
                    throw Object.assign(new Error('expense approval function unavailable'), { code: 'functions-unavailable' });
                }
                const submitExpenseApproval = window.functions.httpsCallable('submitExpenseApproval');
                await submitExpenseApproval({ requestId, transitionId });
            } else {
                const auditRef = window.db.collection('audit_logs').doc(transitionId);
                await window.db.runTransaction(async transaction => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists) throw Object.assign(new Error('draft missing'), { code: 'not-found' });
                    if ((snap.data() || {}).status !== 'draft') throw Object.assign(new Error('draft not in draft state'), { code: 'failed-precondition' });
                    transaction.update(docRef, {
                        status: 'pending',
                        submittedAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        lastTransitionId: transitionId
                    });
                    transaction.set(historyRef, buildSubmitHistoryPayload(requestId, transitionId, ready.user, ready.auth));
                    transaction.set(auditRef, {
                        action: 'DOCUMENT_APPROVAL_SUBMITTED',
                        user: ready.user.name,
                        role: ready.user.role,
                        email: ready.user.email || ready.auth.email || '',
                        uid: ready.auth.uid,
                        order_id: requestId,
                        details: { requestId, transitionId, documentType: form.documentType, step: 0 },
                        timestamp: Date.now(),
                        createdAt: serverTimestamp(),
                        createdAtMs: Date.now(),
                        createdAtKst: typeof window.formatKstDateTime === 'function' ? window.formatKstDateTime(new Date()) : ''
                    });
                });
            }

            // D5 / R3-C: 완료 시점의 컨텍스트(UID + 활성 상태 + Auth 일치 + 세대)를 검사한다.
            // 이미 pending 으로 전이된 요청은 사용자 변경을 이유로 삭제하지 않는다.
            if (!contextUnchanged(captured)) {
                console.warn(contextChangedNotice(requestId));
                return;
            }
            dom.form.reset();
            clearAttachments();
            // WORK29-CORRECTION-02 R4: 제출 결과 문구가 조회 결과 문구에 덮이지 않도록
            // refresh() 이후에 최종 표시하고, 조회 실패는 별도 문구로 구분한다.
            const listed = await refresh();
            if (listed.reason === 'context-changed' || !contextUnchanged(captured)) {
                console.warn(contextChangedNotice(requestId));
            } else if (listed.ok) {
                setSubmitMessage(captured, '첨부파일을 포함한 문서 결재 요청을 결재 대기로 제출했습니다.', 'success');
            } else {
                setSubmitMessage(captured, `제출 완료 · 목록 갱신 실패 — 요청 ID(${requestId})는 정상 접수됐습니다. 새로고침으로 다시 조회하세요.`, 'error');
            }
        } catch (error) {
            console.warn('Employee document attachment submit failed:', error);
            setSubmitProgress(captured, '업로드 실패 — 정리 중...', 'error');
            // R3-C: 사용자가 바뀐 뒤에는 이전 사용자 문서를 파괴적으로 정리하지 않는다
            // (현재 사용자 권한으로는 삭제가 불가능하며, 결과도 확정 표시할 수 없다).
            if (!contextUnchanged(captured)) {
                console.warn(contextChangedNotice(requestId));
                return;
            }
            // D3: 상태 재확인 기반 정리. 불확실하면 파괴적 삭제를 하지 않는다.
            const result = draftCreated ? await rollbackDraft(docRef, registeredPaths) : { outcome: 'cleaned' };
            if (result.outcome === 'submitted') {
                // 업로드·전이는 실제로 완료됐고 응답만 유실된 경우 — 삭제하지 않는다.
                // R3-C: 이 시점에도 컨텍스트가 같을 때만 성공 tone 으로 확정 표시한다.
                if (!contextUnchanged(captured)) {
                    console.warn(contextChangedNotice(requestId));
                    return;
                }
                dom.form.reset();
                clearAttachments();
                setAttachProgress('');
                // 안내 문구는 refresh() 의 조회 메시지에 덮이지 않도록 조회 이후에 표시한다.
                const listedAfterSubmit = await refresh();
                if (listedAfterSubmit.reason === 'context-changed' || !contextUnchanged(captured)) {
                    console.warn(contextChangedNotice(requestId));
                } else {
                    setSubmitMessage(captured, `요청이 이미 결재 대기로 제출됐습니다. 요청 ID(${requestId}) 목록에서 상태를 확인하세요.`, 'success');
                }
                return;
            }
            if (result.outcome === 'cleanup-failed') {
                setSubmitMessage(captured, `첨부 업로드에 실패했고 임시 요청 정리에도 실패했습니다. 관리자에게 요청 ID(${requestId})를 전달하세요.`, 'error');
            } else if (result.outcome === 'unknown') {
                setSubmitMessage(captured, `첨부 업로드 처리 결과를 확인하지 못했습니다. 임의로 삭제하지 않았으니 관리자에게 요청 ID(${requestId})를 전달하세요.`, 'error');
            } else {
                setSubmitMessage(captured, error?.code === 'permission-denied' ? '첨부 업로드 권한이 없습니다.' : '첨부 업로드에 실패해 요청이 제출되지 않았습니다. 다시 시도하세요.', 'error');
            }
            setSubmitProgress(captured, '');
        }
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
        // D5: 제출 직전에도 첨부 소유자와 현재 사용자가 일치하는지 확인한다.
        if (!enforceUserContext()) return;
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
        const captured = captureSubmit();
        const attachmentSnapshot = state.attachments.map(att => Object.freeze({ ...att }));
        state.submitting = true;
        state.submittingSeq = captured.token;
        state.submittingVersion = captured.version;
        dom.submit.disabled = true;
        if (dom.attachSelectBtn) dom.attachSelectBtn.disabled = true;
        renderAttachmentList();
        setMessage('문서 결재 요청을 제출하는 중입니다.', 'info');
        try {
            if (form.documentType === 'EXPENSE_REPORT' && state.attachments.length < 1) {
                setSubmitMessage(captured, '지출결의서는 증빙첨부가 필수입니다.', 'error');
            } else if (state.attachments.length > 0) {
                await submitWithAttachments(ready, form, captured, attachmentSnapshot);
            } else {
                const ts = serverTimestamp();
                // R4: 첨부 없는 제출도 생성된 문서 reference 를 받아 요청 ID 를 확보한다.
                const createdRef = await window.db.collection(COLLECTION).add(buildCreatePayload(ready.user, ready.auth, ts, form));
                const requestId = createdRef?.id || '';
                // R3-B: 쓰기 완료 후 컨텍스트가 바뀌었으면 새 사용자 화면을 이전 작업 결과로 바꾸지 않는다.
                if (!contextUnchanged(captured)) {
                    console.warn(contextChangedNotice(requestId));
                    return;
                }
                dom.form.reset();
                const listed = await refresh();
                if (listed.reason === 'context-changed' || !contextUnchanged(captured)) {
                    console.warn(contextChangedNotice(requestId));
                } else if (listed.ok) {
                    setSubmitMessage(captured, '문서 결재 요청을 결재 대기로 제출했습니다.', 'success');
                } else {
                    setSubmitMessage(captured, `제출 완료 · 목록 갱신 실패 — 요청 ID(${requestId})는 정상 접수됐습니다. 새로고침으로 다시 조회하세요.`, 'error');
                }
            }
        } catch (error) {
            console.warn('Employee document request create failed:', error);
            setSubmitMessage(captured, error?.code === 'permission-denied' ? '문서 결재 요청 생성 권한이 없습니다.' : '문서 결재 요청을 제출하지 못했습니다.', 'error');
        } finally {
            if (submitOwns(captured)) {
                state.submitting = false;
                state.submittingSeq = 0;
                state.submittingVersion = -1;
                dom.submit.disabled = false;
                if (dom.attachSelectBtn) dom.attachSelectBtn.disabled = false;
                renderAttachmentList();
            }
        }
    }

    // WORK29-CORRECTION-02 R4: 조회 성공 여부·건수를 반환한다.
    // 기존 호출자(새로고침 버튼 등)는 반환값을 사용하지 않아도 동작한다.
    async function refresh() {
        if (!cacheDom()) return { ok: false, count: 0, reason: 'dom' };
        // WORK29-CORRECTION-03 R3: 같은 컨텍스트의 조회만 중복으로 막는다.
        // 사용자가 바뀐 뒤라면 이전 사용자의 조회가 진행 중이어도 새 조회를 시작한다.
        if (state.loading && state.loadingVersion === state.contextVersion) {
            return { ok: false, count: 0, reason: 'loading' };
        }
        const ready = requireReady();
        if (!ready.ok) {
            state.requests = [];
            tableMessage(ready.message);
            renderDetail(null);
            setMessage(ready.message, 'error');
            return { ok: false, count: 0, reason: 'not-ready' };
        }
        // 조회 시작 컨텍스트와 고유 토큰을 캡처한다.
        const captured = captureContext();
        const token = ++state.refreshSeq;
        state.loading = true;
        state.loadingSeq = token;
        state.loadingVersion = captured.version;
        // 이 조회의 결과·오류·finally 가 현재 화면 주인인지 판정한다.
        const isCurrent = () => token === state.refreshSeq && contextUnchanged(captured);
        tableMessage('본인 문서 결재 요청을 불러오는 중입니다.');
        setMessage('조회 중...', 'info');
        try {
            const [legacySnapshot, expenseSnapshot] = await Promise.all([
                window.db.collection(COLLECTION)
                    .where('requesterUid', '==', ready.auth.uid)
                    .orderBy(SORT_FIELD, 'desc')
                    .limit(LIMIT)
                    .get(),
                window.db.collection(EXPENSE_COLLECTION)
                    .where('requesterUid', '==', ready.auth.uid)
                    .orderBy(SORT_FIELD, 'desc')
                    .limit(LIMIT)
                    .get()
            ]);
            // R3: 사용자가 바뀐 뒤 도착한 오래된 응답은 state·DOM·LIVE 카드 어디에도 반영하지 않는다.
            if (!isCurrent()) {
                return { ok: false, count: 0, reason: 'context-changed' };
            }
            const expenseRequests = await Promise.all(expenseSnapshot.docs.map(async doc => {
                const parent = { id: doc.id, sourceCollection: EXPENSE_COLLECTION, ...doc.data() };
                if (!doc.ref?.collection) return parent;
                const stateSnapshot = await doc.ref.collection('workflow').doc('state').get();
                return stateSnapshot.exists ? { ...parent, ...stateSnapshot.data() } : parent;
            }));
            if (!isCurrent()) {
                return { ok: false, count: 0, reason: 'context-changed' };
            }
            state.requests = [
                ...legacySnapshot.docs.map(doc => ({ id: doc.id, sourceCollection: COLLECTION, ...doc.data() })),
                ...expenseRequests
            ].sort((a, b) => {
                const av = a.createdAt?.toMillis?.() || 0;
                const bv = b.createdAt?.toMillis?.() || 0;
                return bv - av;
            }).slice(0, LIMIT);
            const selected = syncSelectionWithVisibleRows();
            renderRows();
            renderDetail(selected || null);
            setMessage(`본인 요청 ${state.requests.length}건을 표시합니다.`, 'success');
            // WORK32: 기존 본인 요청 조회 결과를 LIVE 문서결재 카드로 전달 (신규 쿼리 없음)
            window.YJLiveOperationsHub?.updateEmployeeDocumentApprovals?.(state.requests);
            return { ok: true, count: state.requests.length, reason: '' };
        } catch (error) {
            console.warn('Employee document requests load failed:', error);
            // R3: 오래된 조회의 오류도 새 사용자 화면·LIVE 카드를 덮지 않는다.
            if (!isCurrent()) {
                return { ok: false, count: 0, reason: 'context-changed' };
            }
            // WORK32: 조회 실패를 LIVE 카드 내부 상태로만 전달
            window.YJLiveOperationsHub?.updateEmployeeDocumentApprovals?.([], { error: true, code: error?.code });
            state.requests = [];
            tableMessage(error?.code === 'failed-precondition' ? '본인 요청 조회 index가 아직 준비되지 않았습니다.' : '본인 요청을 불러오지 못했습니다.');
            renderDetail(null);
            setMessage(error?.code === 'permission-denied' ? '본인 요청 조회 권한이 없습니다.' : '본인 요청을 불러오지 못했습니다.', 'error');
            return { ok: false, count: 0, reason: error?.code || 'error' };
        } finally {
            // R3: 자신이 점유한 loading 만 해제한다(오래된 조회가 새 조회의 상태를 바꾸지 못하게).
            if (state.loadingSeq === token) {
                state.loading = false;
                state.loadingSeq = 0;
                state.loadingVersion = -1;
            }
        }
    }

    function bindEvents() {
        if (!cacheDom()) return false;
        if (state.initialized) return true;
        state.initialized = true;
        dom.form.addEventListener('submit', submit);
        if (dom.documentType) {
            const syncDocumentType = () => {
                const expense = dom.documentType.value === 'EXPENSE_REPORT';
                dom.expenseFields?.classList.toggle('hidden', !expense);
                if (dom.attachInput) dom.attachInput.required = expense;
                if (dom.attachSelectBtn) dom.attachSelectBtn.textContent = expense ? '증빙 선택 (필수)' : '파일 선택';
            };
            dom.documentType.addEventListener('change', syncDocumentType);
            syncDocumentType();
        }
        dom.refresh.addEventListener('click', refresh);
        if (dom.attachSelectBtn && dom.attachInput) {
            dom.attachSelectBtn.addEventListener('click', () => {
                if (!state.submitting) dom.attachInput.click();
            });
            dom.attachInput.addEventListener('change', () => {
                addFiles(dom.attachInput.files);
                dom.attachInput.value = '';
            });
        }
        dom.filter.addEventListener('change', () => {
            state.filter = FILTERS.includes(dom.filter.value) ? dom.filter.value : 'all';
            const selected = syncSelectionWithVisibleRows();
            renderRows();
            renderDetail(selected || null);
        });
        return true;
    }

    function init() {
        if (!bindEvents()) return;
        // D5: 계정 전환·로그아웃 감시 (1회만 바인딩)
        if (!state.authWatchBound && typeof window.auth?.onAuthStateChanged === 'function') {
            state.authWatchBound = true;
            window.auth.onAuthStateChanged(() => {
                if (cacheDom()) enforceUserContext();
            });
        }
        enforceUserContext();
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
