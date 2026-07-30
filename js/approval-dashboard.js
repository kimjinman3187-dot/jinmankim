/*
 * WORK31-DOCUMENT-APPROVAL-DASHBOARD-IMPLEMENTATION-01 (+ REVIEW-FIX-01)
 * 독립 PC 문서결재 "조회 전용" 대시보드 로직.
 * - 기존 결재 계약을 그대로 재사용(document_approval_requests + history).
 * - 읽기 전용: 승인/반려/보류/수정 등 어떠한 쓰기(Write)도 수행하지 않는다.
 * - Firestore 쓰기 API / Storage API / 신규 컬렉션 / 신규 Rules·index 사용 없음.
 * - 권한은 현행 Security Rules의 read 제한을 그대로 따른다(클라이언트 표시 제어를 신뢰하지 않음).
 *
 * REVIEW-FIX-01 보정:
 * D1 로딩 종료 후 페이지 버튼 재렌더 / D2 PAGE_SIZE+1 로 hasNext 정확 판정 /
 * D3 목록·요약 request sequence 로 최신 응답만 반영 / D4 상세 이력 seq+선택ID 검증·인쇄 정합 /
 * D5 페이지 이동·새로고침 후 선택 상세 정합 / D6 기간 종료 endExclusive(<) / D7 요약 CAP+1 정확 표기.
 */
(function installApprovalDashboard() {
    'use strict';

    var COLLECTION = 'document_approval_requests';
    var PAGE_SIZE = 25;
    var SUMMARY_CAP = 500;

    var STATUS_LABELS = {
        draft: '작성 중',
        pending: '결재 대기',
        approved: '승인',
        rejected: '반려',
        on_hold: '보류',
        applied: '적용 완료',
        cancelled: '취소'
    };
    var REQUEST_TYPE_LABELS = { document: '문서', test_document: '테스트 문서' };
    var ATTACH_SLOTS = ['a0', 'a1', 'a2', 'a3', 'a4'];

    var state = {
        user: null,
        isAdmin: false,
        filters: { period: 'all', start: '', end: '', status: 'all', requestType: 'all', search: '' },
        startCursors: [],   // startCursors[i] = startAfter 커서(스냅샷) for 페이지 i (i=0 은 커서 없음)
        pageIndex: 0,
        hasNext: false,
        rows: [],           // 현재 페이지에서 서버로 불러온 원본 문서(최대 PAGE_SIZE)
        selectedId: '',
        loading: false,
        lastQueryAt: null,
        // 비동기 경합 방지용 최신 요청 식별자 (D3/D4/R1/R2)
        listSeq: 0,
        summarySeq: 0,
        historySeq: 0,
        authSeq: 0,
        // 인쇄 정합용 이력 캐시 (D4)
        _lastHistory: null,
        _historyForId: '',
        initialized: false,
        authUnsubscribe: null
    };

    var dom = {};
    var root = null;

    function $(id) { return root ? root.querySelector('#' + id) : null; }

    function cacheDom(mountRoot) {
        root = mountRoot;
        [
            'authState', 'body', 'userInfo', 'scopeNote', 'summary',
            'filterPeriod', 'customRange', 'startDate', 'endDate',
            'filterStatus', 'filterType', 'search', 'refreshBtn', 'lastQuery',
            'tbody', 'listNote', 'pageInfo', 'prevBtn', 'nextBtn',
            'detail', 'printArea', 'printBtn', 'backBtn'
        ].forEach(function (k) { dom[k] = $('dash_' + k); });
    }

    // ---------- 안전 DOM 유틸 (innerHTML 미사용) ----------
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function clearNode(node) { if (node) node.textContent = ''; }

    function toDate(v) {
        try {
            if (!v) return null;
            if (typeof v.toDate === 'function') return v.toDate();
            if (v instanceof Date) return v;
            if (typeof v === 'number') return new Date(v);
            if (v.seconds != null) return new Date(v.seconds * 1000);
            return null;
        } catch (e) { return null; }
    }
    function fmtDateTime(v) { var d = toDate(v); return d ? d.toLocaleString('ko-KR') : '-'; }
    function fmtDate(v) {
        var d = toDate(v);
        if (!d) return '-';
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function ymd(d) { return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()); }

    // 문서번호: 읽기 전용 표시번호 (원본 request ID/문서구조 미변경)
    function docNumber(req) {
        var d = toDate(req.createdAt) || new Date(0);
        var idPart = String(req.id || '').slice(-6) || '------';
        return 'DA-' + ymd(d) + '-' + idPart;
    }
    function statusLabel(s) { return STATUS_LABELS[s] || s || '-'; }
    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function ts(dateObj) { return firebase.firestore.Timestamp.fromDate(dateObj); }

    // ---------- 기간 → createdAt 범위 (D6: endExclusive 반환, Firestore 는 '<' 사용) ----------
    function periodRange() {
        var f = state.filters;
        var now = new Date();
        if (f.period === '7d') {
            return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), endExclusive: null, invalid: false };
        }
        if (f.period === 'lastMonth') {
            return {
                start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                endExclusive: new Date(now.getFullYear(), now.getMonth(), 1), // 이번 달 1일 00:00 (exclusive)
                invalid: false
            };
        }
        if (f.period === 'thisYear') {
            return { start: new Date(now.getFullYear(), 0, 1), endExclusive: null, invalid: false };
        }
        if (f.period === 'custom') {
            var s = f.start ? new Date(f.start + 'T00:00:00') : null;
            var e = null;
            if (f.end) { e = new Date(f.end + 'T00:00:00'); e.setDate(e.getDate() + 1); } // 종료일 다음 날 00:00 (exclusive)
            var invalid = !!(f.start && f.end && f.start > f.end); // YYYY-MM-DD 문자열 비교
            return { start: s, endExclusive: e, invalid: invalid };
        }
        return { start: null, endExclusive: null, invalid: false };
    }

    // ---------- Firestore 쿼리 (읽기 전용) ----------
    function baseListQuery(range) {
        var q = window.db.collection(COLLECTION);
        if (!state.isAdmin) q = q.where('requesterUid', '==', state.user.uid);
        if (range.start) q = q.where('createdAt', '>=', ts(range.start));
        if (range.endExclusive) q = q.where('createdAt', '<', ts(range.endExclusive));
        if (state.isAdmin && state.filters.status !== 'all') q = q.where('status', '==', state.filters.status);
        return q.orderBy('createdAt', 'desc');
    }

    function applyClientFilters(docs) {
        var f = state.filters;
        var term = (f.search || '').trim().toLowerCase();
        return docs.filter(function (r) {
            if (!state.isAdmin && f.status !== 'all' && r.status !== f.status) return false; // 직원 상태=클라이언트
            if (f.requestType !== 'all' && (r.requestType || '') !== f.requestType) return false;
            if (term) {
                var hay = ((r.title || '') + ' ' + (r.requesterName || '') + ' ' + (r.requesterUid || '')).toLowerCase();
                if (hay.indexOf(term) < 0) return false;
            }
            return true;
        });
    }

    // ---------- 로드 ----------
    function resetAndLoad() {
        state.startCursors = [];
        state.pageIndex = 0;
        state.hasNext = false;
        clearSelection();
        loadSummary();
        loadList();
    }

    // 목록: PAGE_SIZE+1 조회로 다음 페이지 존재를 정확히 판정하고(D2),
    // request sequence 로 최신 응답만 반영하며(D3), 종료 후 페이지 버튼을 다시 렌더한다(D1).
    async function loadList() {
        if (!state.user) return;
        var seq = ++state.listSeq; // R1: 새 호출 즉시 증가시켜 진행 중 이전 응답을 무효화
        var range = periodRange();
        if (range.invalid) {
            state.rows = []; state.hasNext = false; state.loading = false;
            if (dom.lastQuery) dom.lastQuery.textContent = ''; // 오해 소지 있는 이전 조회 시각 제거
            tableMessage('시작일이 종료일보다 늦습니다. 기간을 다시 선택하세요.');
            renderPageInfo();
            return;
        }
        state.loading = true;
        renderPageInfo();
        tableMessage('불러오는 중...');
        try {
            var q = baseListQuery(range).limit(PAGE_SIZE + 1);
            var cur = state.startCursors[state.pageIndex];
            if (cur) q = q.startAfter(cur);
            var snap = await q.get();
            if (seq !== state.listSeq) return; // 최신 요청만 반영
            var docs = snap.docs.map(function (d) { var o = d.data(); o.id = d.id; o._snap = d; return o; });
            state.hasNext = docs.length > PAGE_SIZE;         // 26번째 존재 시에만 다음 페이지 있음
            state.rows = docs.slice(0, PAGE_SIZE);           // 화면/상태에는 앞 25건만
            if (state.hasNext && state.rows.length) {
                state.startCursors[state.pageIndex + 1] = state.rows[state.rows.length - 1]._snap;
            }
            state.lastQueryAt = new Date();
            renderTable();
            updateLastQuery();
            reconcileSelectionAfterList();                    // D5
        } catch (e) {
            if (seq !== state.listSeq) return;
            failListClosed(e);
        } finally {
            if (seq === state.listSeq) {                       // 최신 요청만 로딩/버튼 상태 복구 (D1)
                state.loading = false;
                renderPageInfo();
            }
        }
    }

    async function loadSummary() {
        // 기간 + 역할 범위 기준 상태별 집계. 상태/유형/검색 필터는 반영하지 않음.
        var seq = ++state.summarySeq; // R1: 새 호출 즉시 증가시켜 진행 중 이전 응답을 무효화
        var range = periodRange();
        if (range.invalid) { renderSummary(null, false, { code: 'range' }); return; }
        try {
            var q = window.db.collection(COLLECTION);
            if (!state.isAdmin) q = q.where('requesterUid', '==', state.user.uid);
            if (range.start) q = q.where('createdAt', '>=', ts(range.start));
            if (range.endExclusive) q = q.where('createdAt', '<', ts(range.endExclusive));
            var snap = await q.orderBy('createdAt', 'desc').limit(SUMMARY_CAP + 1).get(); // D7: CAP+1
            if (seq !== state.summarySeq) return;
            var over = snap.size > SUMMARY_CAP;                // 501번째 존재 시에만 초과
            var docs = snap.docs.slice(0, SUMMARY_CAP);
            var counts = { total: docs.length, pending: 0, on_hold: 0, approved: 0, rejected: 0 };
            docs.forEach(function (d) {
                var s = (d.data() || {}).status;
                if (counts[s] != null) counts[s]++;
            });
            renderSummary(counts, over, null);
            if (state.filters.period === 'all' && window.YJLiveOperationsHub &&
                typeof window.YJLiveOperationsHub.updateApprovalDashboardSummary === 'function') {
                window.YJLiveOperationsHub.updateApprovalDashboardSummary({
                    rows: docs.map(function (d) { var o = d.data() || {}; o.id = d.id; return o; }),
                    over: over,
                    limit: SUMMARY_CAP,
                    role: state.isAdmin ? 'admin' : 'employee'
                });
            }
        } catch (e) {
            if (seq !== state.summarySeq) return;
            renderSummary(null, false, e);
            if (state.filters.period === 'all' && window.YJLiveOperationsHub &&
                typeof window.YJLiveOperationsHub.updateApprovalDashboardSummary === 'function') {
                window.YJLiveOperationsHub.updateApprovalDashboardSummary({
                    error: true,
                    code: (e && e.code) || '',
                    role: state.isAdmin ? 'admin' : 'employee'
                });
            }
        }
    }

    function handleQueryError(e) {
        var code = (e && e.code) || '';
        var msg = '조회 중 오류가 발생했습니다.';
        if (code === 'permission-denied') msg = '조회 권한이 없습니다. (관리자 전체 조회는 admin 계정만 가능합니다.)';
        else if (code === 'failed-precondition') msg = '조회에 필요한 Firestore 인덱스가 아직 준비되지 않았습니다.';
        else if (code === 'unavailable' || code === 'deadline-exceeded') msg = '네트워크 문제로 조회하지 못했습니다. 새로고침 후 다시 시도하세요.';
        tableMessage(msg);
        console.warn('[approval-dashboard] query error:', e);
    }

    function failListClosed(e) {
        state.rows = [];
        state.hasNext = false;
        state.lastQueryAt = null;
        state.historySeq++;
        clearSelection();
        if (dom.printArea) clearNode(dom.printArea);
        cleanupPrintHost();
        if (dom.lastQuery) dom.lastQuery.textContent = '';
        handleQueryError(e);
        renderPageInfo();
    }

    // ---------- 렌더 ----------
    function renderUserInfo() {
        if (!dom.userInfo) return;
        clearNode(dom.userInfo);
        dom.userInfo.appendChild(el('span', 'dash-user-name', state.user.name || '(이름 없음)'));
        dom.userInfo.appendChild(el('span', 'dash-user-role', state.isAdmin ? '관리자' : (state.user.role || '직원')));
        if (dom.scopeNote) {
            dom.scopeNote.textContent = state.isAdmin
                ? '관리자: 전체 문서결재 요청 조회. (요청 유형·검색은 현재 페이지 기준 필터)'
                : '직원: 본인 요청만 조회. (상태·요청 유형·검색은 현재 불러온 결과 기준 필터)';
        }
    }

    function renderSummary(counts, over, error) {
        if (!dom.summary) return;
        clearNode(dom.summary);
        if (error) {
            var code = (error && error.code) || '';
            var m = code === 'permission-denied' ? '요약 조회 권한이 없습니다.'
                : code === 'range' ? '기간 범위가 올바르지 않습니다.'
                    : '요약 집계를 불러오지 못했습니다.';
            dom.summary.appendChild(el('div', 'dash-summary-err', m));
            if (code !== 'range' && code !== 'permission-denied') console.warn('[approval-dashboard] summary error:', error);
            return;
        }
        var tiles = [
            ['전체', counts.total, over], ['대기', counts.pending, false], ['보류', counts.on_hold, false],
            ['승인', counts.approved, false], ['반려', counts.rejected, false]
        ];
        tiles.forEach(function (t) {
            var tile = el('div', 'dash-tile');
            tile.appendChild(el('div', 'dash-tile-label', t[0]));
            tile.appendChild(el('div', 'dash-tile-value', String(t[1]) + (t[2] ? '+' : '')));
            dom.summary.appendChild(tile);
        });
        if (over) dom.summary.appendChild(el('div', 'dash-summary-cap', '기간 기준 ' + SUMMARY_CAP + '건 초과(정확 집계는 상한까지만 표시)'));
    }

    function statusBadge(parent, status) {
        parent.appendChild(el('span', 'dash-badge dash-badge-' + (status || 'unknown'), statusLabel(status)));
    }

    function tableMessage(msg) {
        if (!dom.tbody) return;
        clearNode(dom.tbody);
        var tr = el('tr');
        var td = el('td', 'dash-empty', msg);
        td.colSpan = 6;
        tr.appendChild(td);
        dom.tbody.appendChild(tr);
        if (dom.listNote) dom.listNote.textContent = '';
    }

    function renderTable() {
        if (!dom.tbody) return;
        var visible = applyClientFilters(state.rows);
        clearNode(dom.tbody);
        if (!visible.length) {
            tableMessage(state.rows.length ? '현재 페이지에 필터 조건과 일치하는 요청이 없습니다.' : '표시할 문서결재 요청이 없습니다.');
            if (dom.listNote && state.rows.length) {
                dom.listNote.textContent = '현재 페이지 ' + state.rows.length + '건 중 0건 표시 (상태/유형/검색은 현재 페이지 기준).';
            }
            return;
        }
        visible.forEach(function (req) {
            var tr = el('tr', req.id === state.selectedId ? 'dash-row dash-row-sel' : 'dash-row');
            tr.appendChild(el('td', 'dash-td-mono', docNumber(req)));
            tr.appendChild(el('td', 'dash-td-title', req.title || '제목 없음'));
            tr.appendChild(el('td', null, req.requesterName || req.requesterUid || '-'));
            tr.appendChild(el('td', 'dash-td-nowrap', fmtDate(req.submittedAt || req.createdAt)));
            var stTd = el('td'); statusBadge(stTd, req.status); tr.appendChild(stTd);
            tr.appendChild(el('td', 'dash-td-nowrap', fmtDate(req.reviewedAt || req.approvedAt)));
            tr.addEventListener('click', function () { openDetail(req.id); });
            dom.tbody.appendChild(tr);
        });
        if (dom.listNote) {
            dom.listNote.textContent = visible.length !== state.rows.length
                ? '현재 페이지 ' + state.rows.length + '건 중 ' + visible.length + '건 표시 (상태/유형/검색은 현재 페이지 기준).'
                : '현재 페이지 ' + visible.length + '건 표시.';
        }
    }

    function renderPageInfo() {
        if (dom.pageInfo) dom.pageInfo.textContent = '페이지 ' + (state.pageIndex + 1);
        if (dom.prevBtn) dom.prevBtn.disabled = state.loading || state.pageIndex === 0;
        if (dom.nextBtn) dom.nextBtn.disabled = state.loading || !state.hasNext;
    }

    function updateLastQuery() {
        if (dom.lastQuery) dom.lastQuery.textContent = state.lastQueryAt ? ('마지막 조회: ' + state.lastQueryAt.toLocaleString('ko-KR')) : '';
    }

    function box(labelText) {
        var b = el('div', 'dash-box');
        b.appendChild(el('p', 'dash-box-label', labelText));
        return b;
    }

    function renderResult(parent, req) {
        var s = req.status || '';
        var label = '처리 결과', value = '';
        if (s === 'approved') { label = '승인 의견'; value = req.reviewComment || '승인되었습니다.'; }
        else if (s === 'rejected') { label = '반려 사유'; value = req.rejectionReason || '-'; }
        else if (s === 'on_hold') { label = '보류 사유'; value = req.holdReason || '-'; }
        else if (s === 'pending') { value = '관리자 결재 대기 중입니다.'; }
        else { value = statusLabel(s); }
        var b = box(label);
        b.appendChild(el('p', 'dash-box-text', value || '-'));
        parent.appendChild(b);
    }

    function renderAttachments(parent, req, options) {
        options = options || {};
        var a = req.attachments;
        if (!a || typeof a !== 'object') return;
        var slots = ATTACH_SLOTS.filter(function (s) { return a[s] && typeof a[s] === 'object'; });
        if (!slots.length) return;
        var b = box('첨부파일 (' + slots.length + ')');
        var status = options.forPrint ? null : el('p', 'dash-hint');

        async function downloadAttachment(storagePath, name) {
            if (!status || typeof window.yjDownloadAttachment !== 'function') return;
            status.textContent = '내려받는 중...';
            try {
                var result = await window.yjDownloadAttachment(storagePath, name);
                if (result && result.ok) {
                    status.textContent = '저장했습니다: ' + (name || '(이름 없음)');
                    return;
                }
                status.textContent = (typeof window.yjAttachmentDownloadMessage === 'function')
                    ? window.yjAttachmentDownloadMessage(result && result.code)
                    : '첨부파일을 내려받지 못했습니다.';
            } catch (error) {
                console.warn('[approval-dashboard] attachment download error:', error);
                status.textContent = '첨부파일을 내려받지 못했습니다.';
            }
        }

        slots.forEach(function (s) {
            var m = a[s];
            var row = el('div', 'dash-att');
            row.appendChild(el('span', 'dash-att-name', m.name || '(이름 없음)'));
            row.appendChild(el('span', 'dash-att-meta', fmtBytes(m.size) + ' · ' + (m.contentType || '-')));
            if (!options.forPrint) {
                if (!m.storagePath) {
                    row.appendChild(el('span', 'dash-att-meta', '경로 없음'));
                } else if (typeof window.yjDownloadAttachment === 'function') {
                    var btn = el('button', 'btn', '다운로드');
                    btn.type = 'button';
                    btn.addEventListener('click', function () {
                        downloadAttachment(m.storagePath, m.name);
                    });
                    row.appendChild(btn);
                }
            }
            b.appendChild(row);
        });
        if (status) b.appendChild(status);
        parent.appendChild(b);
    }

    function buildDetailInto(container, req, historyDocs, historyError, options) {
        clearNode(container);
        container.appendChild(el('p', 'dash-detail-title', req.title || '제목 없음'));
        container.appendChild(el('p', 'dash-detail-sub', docNumber(req)));
        container.appendChild(el('p', 'dash-detail-meta',
            (req.requesterName || req.requesterUid || '-') + ' · ' + (req.requesterRole || '-') + ' · 요청 ' + fmtDateTime(req.submittedAt || req.createdAt)));
        var stLine = el('div', 'dash-detail-status'); statusBadge(stLine, req.status); container.appendChild(stLine);

        var desc = box('상세 내용');
        desc.appendChild(el('p', 'dash-box-text', req.description || '-'));
        container.appendChild(desc);

        renderAttachments(container, req, options);

        var proc = box('처리 정보');
        proc.appendChild(el('p', 'dash-box-text', '처리자: ' + (req.reviewerName || '-')));
        proc.appendChild(el('p', 'dash-box-text', '처리일: ' + fmtDateTime(req.reviewedAt || req.approvedAt)));
        container.appendChild(proc);

        renderResult(container, req);

        var hb = box('결재 이력');
        if (historyError) {
            hb.appendChild(el('p', 'dash-box-text',
                (historyError.code === 'permission-denied') ? '이력 조회 권한이 없습니다.' : '이력을 불러오지 못했습니다.'));
        } else if (!historyDocs) {
            hb.appendChild(el('p', 'dash-box-text', '이력을 불러오는 중...'));
        } else if (!historyDocs.length) {
            hb.appendChild(el('p', 'dash-box-text', '기록된 이력이 없습니다.'));
        } else {
            historyDocs.forEach(function (h) {
                var line = el('div', 'dash-hist');
                line.appendChild(el('span', 'dash-hist-time', fmtDateTime(h.createdAt)));
                line.appendChild(el('span', 'dash-hist-flow',
                    statusLabel(h.previousStatus) + ' → ' + statusLabel(h.nextStatus) + ' (' + (h.action || '-') + ')'));
                line.appendChild(el('span', 'dash-hist-actor', (h.actorName || h.actorUid || '-') + (h.comment ? (' · ' + h.comment) : '')));
                hb.appendChild(line);
            });
        }
        container.appendChild(hb);
    }

    // renderDetail 은 화면만 그린다. 이력 캐시/인쇄 버튼 상태는 openDetail 이 관리.
    function renderDetail(req, historyDocs, historyError) {
        if (!dom.detail) return;
        if (!req) {
            clearNode(dom.detail);
            dom.detail.appendChild(el('p', 'dash-hint', '목록에서 요청을 선택하면 상세와 결재 이력을 표시합니다.'));
            if (dom.printBtn) dom.printBtn.disabled = true;
            return;
        }
        buildDetailInto(dom.detail, req, historyDocs, historyError);
    }

    function clearSelection() {
        state.selectedId = '';
        state._lastHistory = null;
        state._historyForId = '';
        renderDetail(null);
    }

    // 페이지 이동/새로고침 후 선택 상세 정합성 (D5)
    function reconcileSelectionAfterList() {
        if (!state.selectedId) return;
        var still = state.rows.find(function (r) { return r.id === state.selectedId; });
        if (!still) { clearSelection(); return; }
        openDetail(state.selectedId); // 최신 row + history 로 상세 갱신
    }

    // 상세 + 이력. 이력은 seq + 선택ID 로 최신·정합만 반영 (D4).
    async function openDetail(id) {
        var req = state.rows.find(function (r) { return r.id === id; });
        if (!req) return;
        state.selectedId = id;
        state._lastHistory = null;        // 이전 문서 이력 즉시 폐기 (D4)
        state._historyForId = '';
        var seq = ++state.historySeq;
        renderTable();                    // 선택 하이라이트
        renderDetail(req, null, null);    // 이력 로딩 표시
        if (dom.printBtn) dom.printBtn.disabled = true; // 이력 로딩 중 인쇄 OFF
        try {
            var snap = await window.db.collection(COLLECTION).doc(id).collection('history').orderBy('createdAt', 'asc').get();
            if (seq !== state.historySeq || state.selectedId !== id) return; // 늦은 응답/선택 변경 무시
            var hist = snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
            state._lastHistory = hist;
            state._historyForId = id;
            renderDetail(req, hist, null);
            if (dom.printBtn) dom.printBtn.disabled = false;
        } catch (e) {
            if (seq !== state.historySeq || state.selectedId !== id) return;
            console.warn('[approval-dashboard] history error:', e);
            state._lastHistory = null;
            state._historyForId = '';
            renderDetail(req, null, e);
            if (dom.printBtn) dom.printBtn.disabled = false; // 오류도 인쇄 허용(오류 포함), 이전 이력 재사용 안 함
        }
    }

    function cleanupPrintHost() {
        var oldHost = document.getElementById('yjApprovalDashboardPrintHost');
        if (oldHost && oldHost.parentNode) oldHost.parentNode.removeChild(oldHost);
        document.body.classList.remove('yj-approval-dashboard-printing');
        window.removeEventListener('afterprint', cleanupPrintHost);
    }

    function createPrintHost(req, hist, histErr) {
        cleanupPrintHost();
        var host = el('div', 'yj-approval-dashboard yj-approval-dashboard-print-host');
        host.id = 'yjApprovalDashboardPrintHost';
        host.appendChild(el('div', 'dash-print-head', '용진FLOW 문서결재'));
        var body = el('div');
        buildDetailInto(body, req, hist, histErr, { forPrint: true });
        host.appendChild(body);
        document.body.appendChild(host);
        return host;
    }

    function doPrint() {
        var id = state.selectedId;
        var req = state.rows.find(function (r) { return r.id === id; });
        if (!id || !req) return;
        // 저장된 이력이 현재 선택 문서 것일 때만 사용 (D4). 아니면 이력 미포함으로 인쇄.
        var hist = (state._historyForId === id) ? state._lastHistory : null;
        var histErr = (state._historyForId === id) ? null : { code: 'stale' };
        createPrintHost(req, hist, hist ? null : histErr);
        document.body.classList.add('yj-approval-dashboard-printing');
        window.addEventListener('afterprint', cleanupPrintHost);
        window.print();
    }

    // ---------- 인증/부트스트랩 ----------
    function resetDashboardState() {
        state.user = null; state.isAdmin = false;
        state.rows = []; state.startCursors = []; state.pageIndex = 0; state.hasNext = false;
        state.selectedId = ''; state._lastHistory = null; state._historyForId = '';
        state.lastQueryAt = null; state.loading = false;
        state.listSeq++; state.summarySeq++; state.historySeq++; // 진행 중 list/summary/history 응답 무효화
        // R3: 렌더된 이전 사용자 데이터도 함께 초기화(계정 전환 시 재노출 방지)
        if (dom.userInfo) clearNode(dom.userInfo);
        if (dom.scopeNote) dom.scopeNote.textContent = '';
        if (dom.summary) clearNode(dom.summary);
        if (dom.lastQuery) dom.lastQuery.textContent = '';
        if (dom.listNote) dom.listNote.textContent = '';
        if (dom.tbody) clearNode(dom.tbody);
        if (dom.printArea) clearNode(dom.printArea);
        cleanupPrintHost();
        if (dom.pageInfo) dom.pageInfo.textContent = '페이지 1';
        if (dom.prevBtn) dom.prevBtn.disabled = true;
        if (dom.nextBtn) dom.nextBtn.disabled = true;
        renderDetail(null); // 상세 + 인쇄 버튼 초기화
    }

    function showAuthState(msg) {
        resetDashboardState(); // 숨겨진 이전 데이터가 재인증/reload 시 재사용되지 않게 초기화 (H2.8)
        if (dom.authState) { dom.authState.textContent = msg; dom.authState.style.display = 'block'; }
        if (dom.body) dom.body.style.display = 'none';
        if (root && root.id === 'pcLiveDocumentApprovalDashboard') root.classList.add('hidden');
    }
    function showDashboard() {
        if (root && root.id === 'pcLiveDocumentApprovalDashboard') root.classList.remove('hidden');
        if (dom.authState) dom.authState.style.display = 'none';
        if (dom.body) dom.body.style.display = 'block';
    }

    function bindEvents() {
        if (dom.filterPeriod) dom.filterPeriod.addEventListener('change', function () {
            state.filters.period = dom.filterPeriod.value;
            if (dom.customRange) dom.customRange.style.display = (state.filters.period === 'custom') ? 'flex' : 'none';
            resetAndLoad();
        });
        if (dom.startDate) dom.startDate.addEventListener('change', function () { state.filters.start = dom.startDate.value; if (state.filters.period === 'custom') resetAndLoad(); });
        if (dom.endDate) dom.endDate.addEventListener('change', function () { state.filters.end = dom.endDate.value; if (state.filters.period === 'custom') resetAndLoad(); });
        if (dom.filterStatus) dom.filterStatus.addEventListener('change', function () {
            state.filters.status = dom.filterStatus.value;
            if (state.isAdmin) resetAndLoad(); // 관리자=서버 필터(페이지네이션 초기화)
            else renderTable();                 // 직원=클라이언트 필터(현재 페이지)
        });
        if (dom.filterType) dom.filterType.addEventListener('change', function () { state.filters.requestType = dom.filterType.value; renderTable(); });
        if (dom.search) dom.search.addEventListener('input', function () { state.filters.search = dom.search.value; renderTable(); });
        if (dom.refreshBtn) dom.refreshBtn.addEventListener('click', function () {
            // 현재 페이지·선택 유지하고 최신값으로 갱신 (선택 정합은 reconcile 이 처리)
            loadSummary(); loadList();
        });
        if (dom.prevBtn) dom.prevBtn.addEventListener('click', function () { if (state.pageIndex > 0 && !state.loading) { state.pageIndex--; loadList(); } });
        if (dom.nextBtn) dom.nextBtn.addEventListener('click', function () { if (state.hasNext && !state.loading) { state.pageIndex++; loadList(); } });
        if (dom.printBtn) dom.printBtn.addEventListener('click', doPrint);
        // WORK32: 용진FLOW 복귀 (현재 창 이동, 동일 오리진 세션 재사용)
        if (dom.backBtn) dom.backBtn.addEventListener('click', function () { window.location.href = 'index.html'; });
    }

    function init(options) {
        var mountRoot = (options && options.root) || document.querySelector('[data-yj-approval-dashboard]');
        if (!mountRoot || state.initialized) return false;
        state.initialized = true;
        cacheDom(mountRoot);
        bindEvents();
        renderDetail(null);
        if (typeof firebase === 'undefined' || !window.FirebaseShared || typeof window.FirebaseShared.initializeFirebase !== 'function') {
            showAuthState('Firebase 로드에 실패했습니다. 새로고침 후 다시 시도하세요.');
            return false;
        }
        if (!window.auth || !window.db) {
            try {
                window.FirebaseShared.initializeFirebase();
            } catch (e) {
                console.warn('[approval-dashboard] init error:', e);
                showAuthState('Firebase 초기화에 실패했습니다.');
                return false;
            }
        }
        if (!window.auth || !window.db) { showAuthState('Firebase 연결이 준비되지 않았습니다.'); return false; }
        showAuthState('로그인 확인 중...');
        state.authUnsubscribe = window.auth.onAuthStateChanged(async function (u) {
            var aseq = ++state.authSeq;        // R2: 인증 콜백마다 최신 토큰 증가
            showAuthState('로그인 확인 중...');  // R3: 이전 사용자 상태·DOM 즉시 fail-closed 초기화 + 본문 숨김
            if (!u) {
                if (aseq !== state.authSeq) return;
                showAuthState('로그인이 필요합니다. 메인 앱에서 로그인한 뒤 이 대시보드에 접속하세요.');
                return;
            }
            try {
                var snap = await window.db.collection('users').doc(u.uid).get();
                // R2: 최신 인증 콜백이고 현재 로그인 사용자가 여전히 u 일 때만 반영
                if (aseq !== state.authSeq || !window.auth.currentUser || window.auth.currentUser.uid !== u.uid) return;
                if (!snap.exists) { showAuthState('사용자 프로필을 찾을 수 없습니다. 관리자에게 문의하세요.'); return; }
                var d = snap.data() || {};
                if ((d.status || '') !== 'active') { showAuthState('비활성 계정입니다. 활성 승인 후 이용할 수 있습니다.'); return; }
                state.user = { uid: u.uid, name: d.name || '', role: d.role || '' };
                state.isAdmin = (d.role === 'admin');
                renderUserInfo();
                showDashboard();
                resetAndLoad();
            } catch (e) {
                if (aseq !== state.authSeq || !window.auth.currentUser || window.auth.currentUser.uid !== u.uid) return;
                console.warn('[approval-dashboard] profile error:', e);
                showAuthState((e && e.code === 'permission-denied') ? '프로필 조회 권한이 없습니다.' : '프로필 조회 중 오류가 발생했습니다.');
            }
        });
        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 디버깅/테스트용 최소 노출 (쓰기 API 없음)
    window.YJApprovalDashboard = {
        mount: init,
        reload: function () { loadSummary(); loadList(); },
        __test: {
            periodRange: periodRange,
            computeHasNext: function (fetched) { return fetched > PAGE_SIZE; },
            loadList: loadList,
            failListClosed: failListClosed,
            renderTable: renderTable,
            createPrintHost: createPrintHost,
            cleanupPrintHost: cleanupPrintHost,
            doPrint: doPrint,
            seedState: function (seed) { Object.keys(seed || {}).forEach(function (k) { state[k] = seed[k]; }); },
            state: function () { return state; },
            setDom: function (nextDom) { dom = nextDom || {}; },
            PAGE_SIZE: PAGE_SIZE,
            SUMMARY_CAP: SUMMARY_CAP
        }
    };
})();
