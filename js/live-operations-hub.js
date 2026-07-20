(function installYJLiveOperationsHub() {
    if (window.YJLiveOperationsHub) return;

    const state = {
        initialized: false,
        approvalRequests: [],
        documentApprovals: [],
        orders: []
    };

    const ORDER_STATUS_LABELS = {
        pending: '승인 대기',
        approved: '생산 진행',
        completed: '생산 완료',
        rejected: '반려'
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

    function documentTitle(request) {
        return displayValue(request, ['title', 'documentType', 'requestType'], '제목 없음');
    }

    function documentRequester(request) {
        return displayValue(request, ['requesterName', 'requesterEmail', 'requesterUid'], '요청자 정보 없음');
    }

    function documentTime(request) {
        return request?.reviewedAt || request?.submittedAt || request?.createdAt || request?.updatedAt;
    }

    function documentStatusLabel(status) {
        if (typeof window.YJApproval?.getStatusLabel === 'function') {
            return window.YJApproval.getStatusLabel(status);
        }
        return status || '-';
    }

    function renderDocumentItem(list, request, compact) {
        const item = document.createElement('li');
        item.className = compact
            ? 'flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2'
            : 'rounded-lg border border-[#334155]/70 bg-[#0f1522] px-3 py-2';

        const main = document.createElement('div');
        main.className = 'min-w-0';
        const title = document.createElement('p');
        title.className = 'truncate text-[11px] font-black text-slate-200';
        title.textContent = documentTitle(request);
        main.appendChild(title);

        const meta = document.createElement('p');
        meta.className = 'mt-1 truncate text-[10px] font-bold text-slate-500';
        meta.textContent = compact
            ? documentRequester(request)
            : `${documentRequester(request)} · ${formatTime(documentTime(request))}`;
        main.appendChild(meta);

        const status = document.createElement('span');
        status.className = 'shrink-0 text-[10px] font-black text-cyan-300';
        status.textContent = documentStatusLabel(request?.status);
        item.append(main, status);
        list.appendChild(item);
    }

    function renderApprovalRequests() {
        const requests = state.approvalRequests;
        const pending = requests.filter(request => request?.status === 'pending').length;
        const onHold = requests.filter(request => request?.status === 'on_hold').length;
        setText('pcHubApprovalTotal', `${pending + onHold}건`);
        setText('pcHubApprovalPending', pending);
        setText('pcHubApprovalHold', onHold);

        const recent = requests.slice().sort((a, b) => timestampValue(b?.requested_at) - timestampValue(a?.requested_at))[0];
        setText('pcHubApprovalRecent', recent
            ? `${displayValue(recent, ['displayName', 'name', 'email'], '요청자 정보 없음')} · ${formatTime(recent.requested_at)}`
            : '현재 조회된 요청이 없습니다.');
    }

    function renderDocumentApprovals() {
        const requests = state.documentApprovals;
        const pending = requests.filter(request => request?.status === 'pending').length;
        const onHold = requests.filter(request => request?.status === 'on_hold').length;
        const recent = requests.slice().sort((a, b) => timestampValue(documentTime(b)) - timestampValue(documentTime(a)));
        setText('pcHubDocumentTotal', `${pending + onHold}건`);
        setText('pcHubDocumentPending', pending);
        setText('pcHubDocumentHold', onHold);

        const cardList = $('pcHubDocumentRecent');
        clearList(cardList);
        if (cardList) {
            if (!recent.length) appendEmpty(cardList, '현재 조회된 문서가 없습니다.');
            recent.slice(0, 3).forEach(request => renderDocumentItem(cardList, request, true));
        }

        const recentList = $('pcHubRecentDocuments');
        clearList(recentList);
        if (recentList) {
            if (!recent.length) appendEmpty(recentList, '현재 조회된 문서가 없습니다.');
            recent.slice(0, 5).forEach(request => renderDocumentItem(recentList, request, false));
        }
    }

    function orderTime(order) {
        return order?.updatedAt || order?.createdAt || order?.dueDate;
    }

    function renderOrderItem(list, order) {
        const item = document.createElement('li');
        item.className = 'rounded-lg border border-[#334155]/70 bg-[#0f1522] px-3 py-2';
        const top = document.createElement('div');
        top.className = 'flex items-center justify-between gap-3';
        const client = document.createElement('p');
        client.className = 'truncate text-[11px] font-black text-slate-200';
        client.textContent = displayValue(order, ['client', 'clientName', 'company'], '거래처 정보 없음');
        const status = document.createElement('span');
        status.className = 'shrink-0 text-[10px] font-black text-blue-300';
        status.textContent = ORDER_STATUS_LABELS[order?.status] || order?.status || '-';
        top.append(client, status);
        const meta = document.createElement('p');
        meta.className = 'mt-1 truncate text-[10px] font-bold text-slate-500';
        meta.textContent = `${displayValue(order, ['material', 'productName', 'itemName'], '품목 정보 없음')} · 납기 ${displayValue(order, ['dueDate'], '-')}`;
        item.append(top, meta);
        list.appendChild(item);
    }

    function renderOrders() {
        const orders = state.orders;
        const pending = orders.filter(order => order?.status === 'pending').length;
        const production = orders.filter(order => order?.status === 'approved').length;
        const completed = orders.filter(order => order?.status === 'completed').length;
        const dashboardMetrics = typeof window.getPCDashboardMetrics === 'function'
            ? window.getPCDashboardMetrics(orders)
            : null;
        const receivable = dashboardMetrics
            ? dashboardMetrics.debtItems.length
            : orders.filter(order => ['approved', 'completed'].includes(order?.status) && order?.paymentStatus !== 'paid').length;
        setText('pcHubMetricPending', `${pending}건`);
        setText('pcHubMetricProduction', `${production}건`);
        setText('pcHubMetricCompleted', `${completed}건`);
        setText('pcHubMetricReceivable', `${receivable}건`);

        const list = $('pcHubRecentOrders');
        clearList(list);
        if (!list) return;
        const recent = orders.slice().sort((a, b) => timestampValue(orderTime(b)) - timestampValue(orderTime(a))).slice(0, 5);
        if (!recent.length) appendEmpty(list, '현재 조회된 주문이 없습니다.');
        recent.forEach(order => renderOrderItem(list, order));
    }

    function updateVisibility() {
        const admin = isAdmin();
        if (!admin && state.documentApprovals.length) {
            state.documentApprovals = [];
            renderDocumentApprovals();
        }
        $('pcAdminOperationsHub')?.classList.toggle('hidden', !admin);
        $('pcHubRecentDocumentsCard')?.classList.toggle('hidden', !admin);
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
        renderDocumentApprovals();
        renderOrders();
    }

    function init() {
        bindNavigation();
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
        renderDocumentApprovals();
    }

    function updateOrders(orders) {
        state.orders = Array.isArray(orders) ? orders.slice() : [];
        renderOrders();
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
        updateOrders,
        refreshVisibility: updateVisibility,
        scrollToPanel
    };
})();
