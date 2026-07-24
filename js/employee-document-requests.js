(function installYJEmployeeDocumentRequests() {
    if (window.YJEmployeeDocumentRequests) return;

    const COLLECTION = 'document_approval_requests';
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
        attachments: []
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
        if (dom.attachInput) dom.attachInput.value = '';
        renderAttachmentList();
        setAttachProgress('');
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

    async function downloadAttachment(storagePath, name) {
        if (!storageAvailable() || !storagePath) {
            setMessage('첨부파일을 불러올 수 없습니다.', 'error');
            return;
        }
        try {
            const url = await window.storage.ref(storagePath).getDownloadURL();
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.download = name || '';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            console.warn('Attachment download failed:', error);
            setMessage('첨부파일을 불러오지 못했습니다.', 'error');
        }
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

    function serverTimestamp() {
        return window.firebase.firestore.FieldValue.serverTimestamp();
    }

    function buildAttachmentMeta(uid, requestId) {
        const attachments = {};
        let total = 0;
        state.attachments.forEach((att, index) => {
            const slot = ATTACH_SLOTS[index];
            const storagePath = `${ATTACH_STORAGE_PREFIX}/${uid}/${requestId}/${slot}`;
            attachments[slot] = {
                slot,
                name: att.name,
                storagePath,
                contentType: att.contentType,
                size: att.size
            };
            total += att.size;
        });
        return { attachments, total };
    }

    function buildDraftPayload(user, auth, title, description, meta) {
        return {
            requestType: 'document',
            documentType: 'GENERAL_APPROVAL',
            status: 'draft',
            schemaVersion: 2,
            title,
            description,
            payload: { kind: 'general_approval', body: {} },
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

    async function rollbackDraft(docRef, uploadedPaths) {
        // 성공한 업로드 파일 정리 시도 (draft 단계에서만 삭제 허용)
        for (const path of uploadedPaths) {
            try {
                await window.storage.ref(path).delete();
            } catch (error) {
                console.warn('Rollback storage delete failed:', path, error);
            }
        }
        try {
            await docRef.delete();
            return true;
        } catch (error) {
            console.error('Draft rollback delete failed; requestId=', docRef.id, error);
            return false;
        }
    }

    async function submitWithAttachments(ready, form) {
        if (!storageAvailable()) {
            setMessage('첨부 업로드 기능을 사용할 수 없습니다. 첨부 없이 제출하거나 관리자에게 문의하세요.', 'error');
            return;
        }
        if (currentAttachmentsTotal() > ATTACH_MAX_TOTAL_BYTES || state.attachments.length > ATTACH_MAX_FILES) {
            setMessage('첨부 개수/용량 제한을 초과했습니다.', 'error');
            return;
        }
        const docRef = window.db.collection(COLLECTION).doc();
        const requestId = docRef.id;
        const meta = buildAttachmentMeta(ready.auth.uid, requestId);
        const uploadedPaths = [];
        let draftCreated = false;
        try {
            await docRef.set(buildDraftPayload(ready.user, ready.auth, form.title, form.description, meta));
            draftCreated = true;

            for (let i = 0; i < state.attachments.length; i += 1) {
                const slot = ATTACH_SLOTS[i];
                const att = state.attachments[i];
                setAttachProgress(`파일 업로드 중 ${i + 1}/${state.attachments.length} · ${att.name}`);
                await window.storage.ref(meta.attachments[slot].storagePath).put(att.file, { contentType: att.contentType });
                uploadedPaths.push(meta.attachments[slot].storagePath);
            }

            setAttachProgress('결재 제출 처리 중...');
            const historyRef = docRef.collection('history').doc();
            const transitionId = historyRef.id;
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
            });

            dom.form.reset();
            clearAttachments();
            setMessage('첨부파일을 포함한 문서 결재 요청을 결재 대기로 제출했습니다.', 'success');
            await refresh();
        } catch (error) {
            console.warn('Employee document attachment submit failed:', error);
            setAttachProgress('업로드 실패 — 정리 중...', 'error');
            let cleaned = true;
            if (draftCreated) cleaned = await rollbackDraft(docRef, uploadedPaths);
            if (!cleaned) {
                setMessage(`첨부 업로드에 실패했고 임시 요청 정리에도 실패했습니다. 관리자에게 요청 ID(${requestId})를 전달하세요.`, 'error');
            } else {
                setMessage(error?.code === 'permission-denied' ? '첨부 업로드 권한이 없습니다.' : '첨부 업로드에 실패해 요청이 제출되지 않았습니다. 다시 시도하세요.', 'error');
            }
            setAttachProgress('');
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
        if (dom.attachSelectBtn) dom.attachSelectBtn.disabled = true;
        renderAttachmentList();
        setMessage('문서 결재 요청을 제출하는 중입니다.', 'info');
        try {
            if (state.attachments.length > 0) {
                await submitWithAttachments(ready, form);
            } else {
                const ts = serverTimestamp();
                await window.db.collection(COLLECTION).add(buildCreatePayload(ready.user, ready.auth, ts, form.title, form.description));
                dom.form.reset();
                setMessage('문서 결재 요청을 결재 대기로 제출했습니다.', 'success');
                await refresh();
            }
        } catch (error) {
            console.warn('Employee document request create failed:', error);
            setMessage(error?.code === 'permission-denied' ? '문서 결재 요청 생성 권한이 없습니다.' : '문서 결재 요청을 제출하지 못했습니다.', 'error');
        } finally {
            state.submitting = false;
            dom.submit.disabled = false;
            if (dom.attachSelectBtn) dom.attachSelectBtn.disabled = false;
            renderAttachmentList();
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
            const selected = syncSelectionWithVisibleRows();
            renderRows();
            renderDetail(selected || null);
            setMessage(`본인 요청 ${state.requests.length}건을 표시합니다.`, 'success');
            // WORK32: 기존 본인 요청 조회 결과를 LIVE 문서결재 카드로 전달 (신규 쿼리 없음)
            window.YJLiveOperationsHub?.updateEmployeeDocumentApprovals?.(state.requests);
        } catch (error) {
            console.warn('Employee document requests load failed:', error);
            // WORK32: 조회 실패를 LIVE 카드 내부 상태로만 전달
            window.YJLiveOperationsHub?.updateEmployeeDocumentApprovals?.([], { error: true, code: error?.code });
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
