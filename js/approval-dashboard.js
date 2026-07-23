/*
 * WORK31-DOCUMENT-APPROVAL-DASHBOARD-IMPLEMENTATION-01
 * 독립 PC 문서결재 "조회 전용" 대시보드 로직.
 * - 기존 결재 계약을 그대로 재사용(document_approval_requests + history).
 * - 읽기 전용: 승인/반려/보류/수정 등 어떠한 쓰기(Write)도 수행하지 않는다.
 * - Firestore 쓰기 API / Storage API / 신규 컬렉션 / 신규 Rules·index 사용 없음.
 * - 권한은 현행 Security Rules의 read 제한을 그대로 따른다(클라이언트 표시 제어를 신뢰하지 않음).
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
    var STATUS_ORDER = ['draft', 'pending', 'approved', 'rejected', 'on_hold', 'applied', 'cancelled'];
    var REQUEST_TYPE_LABELS = { document: '문서', test_document: '테스트 문서' };
    var ATTACH_SLOTS = ['a0', 'a1', 'a2', 'a3', 'a4'];

    var state = {
        user: null,
        isAdmin: false,
        filters: { period: 'all', start: '', end: '', status: 'all', requestType: 'all', search: '' },
        startCursors: [],   // startCursors[i] = startAfter 커서(스냅샷) for 페이지 i (i=0 은 커서 없음)
        pageIndex: 0,
        hasNext: false,
        rows: [],           // 현재 페이지에서 서버로 불러온 원본 문서
        selectedId: '',
        loading: false,
        lastQueryAt: null
    };

    var dom = {};

    function $(id) { return document.getElementById(id); }

    function cacheDom() {
        [
            'authState', 'body', 'userInfo', 'scopeNote', 'summary',
            'filterPeriod', 'customRange', 'startDate', 'endDate',
            'filterStatus', 'filterType', 'search', 'refreshBtn', 'lastQuery',
            'tbody', 'listNote', 'pageInfo', 'prevBtn', 'nextBtn',
            'detail', 'printArea', 'printBtn'
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
    function typeLabel(t) { return REQUEST_TYPE_LABELS[t] || t || '-'; }
    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function ts(dateObj) { return firebase.firestore.Timestamp.fromDate(dateObj); }

    // ---------- 기간 → createdAt 범위 ----------
    function periodRange() {
        var f = state.filters;
        var now = new Date();
        if (f.period === '7d') { var s = new Date(now); s.setDate(s.getDate() - 7); return { start: s, end: null }; }
        if (f.period === 'lastMonth') {
            return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
        }
        if (f.period === 'thisYear') { return { start: new Date(now.getFullYear(), 0, 1), end: null }; }
        if (f.period === 'custom') {
            return {
                start: f.start ? new Date(f.start + 'T00:00:00') : null,
                end: f.end ? new Date(f.end + 'T23:59:59') : null
            };
        }
        return { start: null, end: null }; // 전체
    }

    // ---------- Firestore 쿼리 (읽기 전용) ----------
    // 인덱스 안전: 관리자=status(선택시)+createdAt / 직원=requesterUid+createdAt.
    // 직원 상태 필터는 신규 복합 index 없이 클라이언트에서 처리한다.
    function baseListQuery() {
        var q = window.db.collection(COLLECTION);
        if (!state.isAdmin) q = q.where('requesterUid', '==', state.user.uid);
        var r = periodRange();
        if (r.start) q = q.where('createdAt', '>=', ts(r.start));
        if (r.end) q = q.where('createdAt', '<=', ts(r.end));
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
        state.selectedId = '';
        renderDetail(null);
        loadSummary();
        loadList();
    }

    async function loadList() {
        if (!state.user || state.loading) return;
        state.loading = true;
        tableMessage('불러오는 중...');
        try {
            var q = baseListQuery().limit(PAGE_SIZE);
            var cur = state.startCursors[state.pageIndex];
            if (cur) q = q.startAfter(cur);
            var snap = await q.get();
            var docs = snap.docs.map(function (d) {
                var obj = d.data(); obj.id = d.id; obj._snap = d; return obj;
            });
            state.rows = docs;
            if (docs.length === PAGE_SIZE) {
                state.startCursors[state.pageIndex + 1] = docs[docs.length - 1]._snap;
                state.hasNext = true;
            } else {
                state.hasNext = false;
            }
            state.lastQueryAt = new Date();
            renderTable();
            renderPageInfo();
            updateLastQuery();
        } catch (e) {
            handleQueryError(e);
        } finally {
            state.loading = false;
        }
    }

    async function loadSummary() {
        // 기간 + 역할 범위 기준(최대 SUMMARY_CAP건) 상태별 집계. 상태/유형/검색 필터는 반영하지 않음.
        try {
            var q = window.db.collection(COLLECTION);
            if (!state.isAdmin) q = q.where('requesterUid', '==', state.user.uid);
            var r = periodRange();
            if (r.start) q = q.where('createdAt', '>=', ts(r.start));
            if (r.end) q = q.where('createdAt', '<=', ts(r.end));
            var snap = await q.orderBy('createdAt', 'desc').limit(SUMMARY_CAP).get();
            var counts = { total: snap.size, pending: 0, on_hold: 0, approved: 0, rejected: 0 };
            snap.forEach(function (d) {
                var s = (d.data() || {}).status;
                if (counts[s] != null) counts[s]++;
            });
            renderSummary(counts, snap.size >= SUMMARY_CAP, null);
        } catch (e) {
            renderSummary(null, false, e);
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

    function renderSummary(counts, capped, error) {
        if (!dom.summary) return;
        clearNode(dom.summary);
        if (error) {
            var code = (error && error.code) || '';
            dom.summary.appendChild(el('div', 'dash-summary-err',
                code === 'permission-denied' ? '요약 조회 권한이 없습니다.' : '요약 집계를 불러오지 못했습니다.'));
            console.warn('[approval-dashboard] summary error:', error);
            return;
        }
        var tiles = [
            ['전체', counts.total], ['대기', counts.pending], ['보류', counts.on_hold],
            ['승인', counts.approved], ['반려', counts.rejected]
        ];
        tiles.forEach(function (t) {
            var tile = el('div', 'dash-tile');
            tile.appendChild(el('div', 'dash-tile-label', t[0]));
            tile.appendChild(el('div', 'dash-tile-value', String(t[1]) + (capped && t[0] === '전체' ? '+' : '')));
            dom.summary.appendChild(tile);
        });
        if (capped) dom.summary.appendChild(el('div', 'dash-summary-cap', '기간 기준 최대 ' + SUMMARY_CAP + '건까지 집계'));
    }

    function statusBadge(parent, status) {
        var span = el('span', 'dash-badge dash-badge-' + (status || 'unknown'), statusLabel(status));
        parent.appendChild(span);
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
                dom.listNote.textContent = '현재 페이지 ' + state.rows.length + '건 중 0건 표시 (필터는 현재 페이지 기준).';
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
        if (dom.prevBtn) dom.prevBtn.disabled = state.pageIndex === 0 || state.loading;
        if (dom.nextBtn) dom.nextBtn.disabled = !state.hasNext || state.loading;
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

    function renderAttachments(parent, req) {
        // 첨부는 표시 전용 확장 지점. 다운로드/Storage 접근 없음.
        var a = req.attachments;
        if (!a || typeof a !== 'object') return;
        var slots = ATTACH_SLOTS.filter(function (s) { return a[s] && typeof a[s] === 'object'; });
        if (!slots.length) return;
        var b = box('첨부파일 (표시 전용 · ' + slots.length + ')');
        slots.forEach(function (s) {
            var m = a[s];
            var row = el('div', 'dash-att');
            row.appendChild(el('span', 'dash-att-name', m.name || '(이름 없음)'));
            row.appendChild(el('span', 'dash-att-meta', fmtBytes(m.size) + ' · ' + (m.contentType || '-')));
            b.appendChild(row);
        });
        b.appendChild(el('p', 'dash-hint', '다운로드는 첨부 기능(PR #166) 병합 이후 단계에서 제공됩니다.'));
        parent.appendChild(b);
    }

    function buildDetailInto(container, req, historyDocs, historyError) {
        clearNode(container);
        container.appendChild(el('p', 'dash-detail-title', req.title || '제목 없음'));
        container.appendChild(el('p', 'dash-detail-sub', docNumber(req)));
        var meta = el('p', 'dash-detail-meta',
            (req.requesterName || req.requesterUid || '-') + ' · ' + (req.requesterRole || '-') + ' · 요청 ' + fmtDateTime(req.submittedAt || req.createdAt));
        container.appendChild(meta);
        var stLine = el('div', 'dash-detail-status'); statusBadge(stLine, req.status); container.appendChild(stLine);

        var desc = box('상세 내용');
        desc.appendChild(el('p', 'dash-box-text', req.description || '-'));
        container.appendChild(desc);

        renderAttachments(container, req);

        var proc = box('처리 정보');
        proc.appendChild(el('p', 'dash-box-text', '처리자: ' + (req.reviewerName || '-')));
        proc.appendChild(el('p', 'dash-box-text', '처리일: ' + fmtDateTime(req.reviewedAt || req.approvedAt)));
        container.appendChild(proc);

        renderResult(container, req);

        // 이력
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

    function renderDetail(req, historyDocs, historyError) {
        if (!dom.detail) return;
        if (historyDocs) state._lastHistory = historyDocs; // 인쇄용 이력 보관
        if (!req) {
            state._lastHistory = null;
            clearNode(dom.detail);
            dom.detail.appendChild(el('p', 'dash-hint', '목록에서 요청을 선택하면 상세와 결재 이력을 표시합니다.'));
            if (dom.printBtn) dom.printBtn.disabled = true;
            return;
        }
        buildDetailInto(dom.detail, req, historyDocs, historyError);
        if (dom.printBtn) dom.printBtn.disabled = false;
    }

    async function openDetail(id) {
        var req = state.rows.find(function (r) { return r.id === id; });
        if (!req) return;
        state.selectedId = id;
        renderTable();
        renderDetail(req, null, null); // 로딩 표시
        try {
            var snap = await window.db.collection(COLLECTION).doc(id).collection('history').orderBy('createdAt', 'asc').get();
            var hist = snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
            renderDetail(req, hist, null);
        } catch (e) {
            console.warn('[approval-dashboard] history error:', e);
            renderDetail(req, null, e);
        }
    }

    function doPrint() {
        var req = state.rows.find(function (r) { return r.id === state.selectedId; });
        if (!req || !dom.printArea) return;
        // 인쇄 영역에 현재 상세(+이력)를 복제 렌더 후 인쇄.
        clearNode(dom.printArea);
        var header = el('div', 'dash-print-head', '용진FLOW 문서결재');
        dom.printArea.appendChild(header);
        var body = el('div');
        // 상세를 다시 그리되, 이력은 현재 dom.detail 에 이미 로드된 내용을 재조회.
        buildDetailInto(body, req, state._lastHistory || null, null);
        dom.printArea.appendChild(body);
        window.print();
    }

    // ---------- 인증/부트스트랩 ----------
    function showAuthState(msg) {
        if (dom.authState) { dom.authState.textContent = msg; dom.authState.style.display = 'block'; }
        if (dom.body) dom.body.style.display = 'none';
    }
    function showDashboard() {
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
        if (dom.refreshBtn) dom.refreshBtn.addEventListener('click', function () { loadSummary(); loadList(); });
        if (dom.prevBtn) dom.prevBtn.addEventListener('click', function () { if (state.pageIndex > 0 && !state.loading) { state.pageIndex--; loadList(); } });
        if (dom.nextBtn) dom.nextBtn.addEventListener('click', function () { if (state.hasNext && !state.loading) { state.pageIndex++; loadList(); } });
        if (dom.printBtn) dom.printBtn.addEventListener('click', doPrint);
    }

    function init() {
        cacheDom();
        bindEvents();
        renderDetail(null);
        if (typeof firebase === 'undefined' || !window.FirebaseShared || typeof window.FirebaseShared.initializeFirebase !== 'function') {
            showAuthState('Firebase 로드에 실패했습니다. 새로고침 후 다시 시도하세요.');
            return;
        }
        try {
            window.FirebaseShared.initializeFirebase();
        } catch (e) {
            console.warn('[approval-dashboard] init error:', e);
            showAuthState('Firebase 초기화에 실패했습니다.');
            return;
        }
        if (!window.auth || !window.db) { showAuthState('Firebase 연결이 준비되지 않았습니다.'); return; }
        showAuthState('로그인 확인 중...');
        window.auth.onAuthStateChanged(async function (u) {
            if (!u) {
                showAuthState('로그인이 필요합니다. 메인 앱에서 로그인한 뒤 이 대시보드에 접속하세요.');
                return;
            }
            try {
                var snap = await window.db.collection('users').doc(u.uid).get();
                if (!snap.exists) { showAuthState('사용자 프로필을 찾을 수 없습니다. 관리자에게 문의하세요.'); return; }
                var d = snap.data() || {};
                if ((d.status || '') !== 'active') { showAuthState('비활성 계정입니다. 활성 승인 후 이용할 수 있습니다.'); return; }
                state.user = { uid: u.uid, name: d.name || '', role: d.role || '' };
                state.isAdmin = (d.role === 'admin');
                renderUserInfo();
                // 직원은 상태 서버필터 미사용 안내(옵션 유지, 클라이언트 필터)
                showDashboard();
                resetAndLoad();
            } catch (e) {
                console.warn('[approval-dashboard] profile error:', e);
                showAuthState((e && e.code === 'permission-denied') ? '프로필 조회 권한이 없습니다.' : '프로필 조회 중 오류가 발생했습니다.');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 디버깅/테스트용 최소 노출 (쓰기 API 없음)
    window.YJApprovalDashboard = { reload: function () { loadSummary(); loadList(); } };
})();
