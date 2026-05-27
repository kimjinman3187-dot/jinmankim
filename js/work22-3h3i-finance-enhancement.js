// ═══════════════════════════════════════════════════════
// 작업22-3H/3I/3J — PC Finance 접기/펼치기 UI + 요약 카드 + 기간 필터 보정
// ═══════════════════════════════════════════════════════
(function installWork22_3H3IFinanceEnhancementPatch() {
    if (window.__WORK22_3H3I_FINANCE_ENHANCEMENT_PATCH__) return;
    window.__WORK22_3H3I_FINANCE_ENHANCEMENT_PATCH__ = true;

    const SECTION_RULES = [
        { id: 'pcFinanceApprovalWaitSection', defaultOpen: true, label: '신규 승인' },
        { id: 'pcFinanceProductionProgressSection', defaultOpen: false, label: '생산 확인' },
        { id: 'pcFinanceInvoiceWaitBody', sectionFromBody: true, defaultOpen: true, label: '청구 대기' },
        { id: 'pcFinanceCollectionWaitSection', defaultOpen: true, label: '수금 대기' },
        { id: 'pcFinanceCompletedSection', defaultOpen: false, label: '완료 거래' }
    ];

    const SECTION_BODY_META_MAP = [
        { bodyId: 'pcFinanceApprovalWaitBody', metaId: 'pcFinanceApprovalWaitMeta' },
        { bodyId: 'pcFinanceProductionProgressBody', metaId: 'pcFinanceProductionProgressMeta' },
        { bodyId: 'pcFinanceInvoiceWaitBody', metaId: 'pcFinanceInvoiceWaitMeta' },
        { bodyId: 'pcFinanceCollectionWaitBody', metaId: 'pcFinanceCollectionWaitMeta' },
        { bodyId: 'pcFinanceCompletedBody', metaId: 'pcFinanceCompletedMeta' }
    ];

    let financeSummaryUnsubscribe = null;
    let financeSummaryOrdersCache = [];

    function injectFinanceEnhanceStyle() {
        if (document.getElementById('work22-3h3i-finance-enhance-style')) return;
        const style = document.createElement('style');
        style.id = 'work22-3h3i-finance-enhance-style';
        style.textContent = `
            .yj-finance-section-header{cursor:pointer;gap:1rem;}
            .yj-finance-section-header:hover{background:#0f172a!important;}
            .yj-finance-section-actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;}
            .yj-finance-toggle-btn{min-width:74px;height:32px;border-radius:10px;border:1px solid rgba(148,163,184,.22);background:rgba(15,23,42,.85);color:#cbd5e1;font-size:11px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;transition:all .15s ease;}
            .yj-finance-toggle-btn:hover{border-color:rgba(59,130,246,.55);color:#fff;}
            .yj-finance-section-content{transition:opacity .15s ease;}
            .yj-finance-collapsed>.yj-finance-section-content{display:none!important;}
            .yj-finance-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;margin:0 0 2rem 0;}
            .yj-finance-summary-card{background:#1e293b;border:1px solid #334155;border-radius:1rem;padding:1rem;box-shadow:0 12px 28px rgba(0,0,0,.22);}
            .yj-finance-summary-label{font-size:10px;color:#94a3b8;font-weight:900;letter-spacing:.08em;text-transform:uppercase;}
            .yj-finance-summary-value{font-size:18px;color:#fff;font-weight:1000;margin-top:.35rem;}
            .yj-finance-summary-sub{font-size:10px;color:#64748b;font-weight:800;margin-top:.25rem;}
            .yj-finance-period-badge{font-size:10px;font-weight:900;color:#38bdf8;background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.22);padding:.25rem .5rem;border-radius:.5rem;margin-top:.5rem;display:inline-flex;}
            .yj-finance-row-hidden-by-period{display:none!important;}
            @media(max-width:1024px){.yj-finance-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
            @media(max-width:640px){.yj-finance-summary-grid{grid-template-columns:1fr;}.yj-finance-section-header{align-items:flex-start!important;flex-direction:column!important;}.yj-finance-section-actions{justify-content:flex-start;}}
        `;
        document.head.appendChild(style);
    }

    function getKSTDateString(dateObj = new Date()) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(dateObj);
    }

    function getFinancePeriodRange() {
        const value = document.getElementById('globalDateFilter')?.value || 'all';
        const today = new Date();
        let start = '';
        let end = '';
        let label = '전체 기간';

        if (value === '7days') {
            const d = new Date(today);
            d.setDate(today.getDate() - 7);
            start = getKSTDateString(d);
            end = getKSTDateString(today);
            label = '최근 7일';
        } else if (value === 'lastMonth') {
            const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
            start = getKSTDateString(firstDay);
            end = getKSTDateString(lastDay);
            label = '지난 달';
        } else if (value === 'thisYear') {
            const firstDay = new Date(today.getFullYear(), 0, 1);
            start = getKSTDateString(firstDay);
            end = getKSTDateString(today);
            label = '올해';
        }

        return { value, start, end, label };
    }

    function getOrderFinanceDate(order = {}) {
        return String(order.dueDate || order.payDate || order.paymentConfirmedAt || order.paidAt || order.updatedAt || '').slice(0, 10);
    }

    function isDateInFinancePeriod(dateText, range = getFinancePeriodRange()) {
        if (!range || range.value === 'all') return true;
        const normalized = String(dateText || '').slice(0, 10);
        if (!normalized || normalized === '-') return false;
        return normalized >= range.start && normalized <= range.end;
    }

    function filterOrdersByFinancePeriod(orders = []) {
        const range = getFinancePeriodRange();
        if (range.value === 'all') return orders;
        return orders.filter(order => isDateInFinancePeriod(getOrderFinanceDate(order), range));
    }

    function findSection(rule) {
        if (!rule.sectionFromBody) return document.getElementById(rule.id);
        const body = document.getElementById(rule.id);
        const table = body && body.closest('table');
        return table && table.parentElement && table.parentElement.parentElement;
    }

    function getMetaElement(section) {
        if (!section) return null;
        return section.querySelector('[id$="Meta"]');
    }

    function wrapSectionContent(section) {
        if (!section || section.querySelector(':scope > .yj-finance-section-content')) return;
        const header = section.firstElementChild;
        if (!header) return;
        header.classList.add('yj-finance-section-header');
        const content = document.createElement('div');
        content.className = 'yj-finance-section-content';
        const nodes = Array.from(section.children).slice(1);
        nodes.forEach(node => content.appendChild(node));
        section.appendChild(content);
    }

    function ensureHeaderActions(section, rule) {
        const header = section && section.firstElementChild;
        if (!header || header.querySelector('.yj-finance-toggle-btn')) return;
        const meta = getMetaElement(section);
        const actions = document.createElement('div');
        actions.className = 'yj-finance-section-actions';
        if (meta) actions.appendChild(meta);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'yj-finance-toggle-btn';
        button.setAttribute('data-yj-finance-toggle', rule.label);
        actions.appendChild(button);
        header.appendChild(actions);
        header.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            toggleSection(section);
        });
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            toggleSection(section);
        });
    }

    function setSectionOpen(section, isOpen) {
        section.classList.toggle('yj-finance-collapsed', !isOpen);
        const button = section.querySelector('.yj-finance-toggle-btn');
        if (button) button.textContent = isOpen ? '접기' : '펼치기';
    }

    function toggleSection(section) {
        setSectionOpen(section, section.classList.contains('yj-finance-collapsed'));
    }

    function enhanceFinanceSections() {
        injectFinanceEnhanceStyle();
        SECTION_RULES.forEach(rule => {
            const section = findSection(rule);
            if (!section) return;
            wrapSectionContent(section);
            ensureHeaderActions(section, rule);
            if (!section.dataset.yjFinanceDefaultApplied) {
                section.dataset.yjFinanceDefaultApplied = 'true';
                setSectionOpen(section, rule.defaultOpen);
            } else {
                setSectionOpen(section, !section.classList.contains('yj-finance-collapsed'));
            }
        });
    }

    function injectSummaryGrid() {
        if (document.getElementById('pcFinanceEnhanceSummary')) return;
        const anchor = document.getElementById('pcFinanceApprovalWaitSection') || document.getElementById('pcFinanceProductionProgressSection') || findSection({ id: 'pcFinanceInvoiceWaitBody', sectionFromBody: true });
        if (!anchor || !anchor.parentElement) return;
        anchor.insertAdjacentHTML('beforebegin', `
            <div id='pcFinanceEnhanceSummary' class='yj-finance-summary-grid'>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Invoice Wait</div><div id='pcFinanceSummaryInvoiceWait' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryInvoiceAmount' class='yj-finance-summary-sub'>청구 예정 ₩ 0</div><div id='pcFinanceSummaryPeriodA' class='yj-finance-period-badge'>전체 기간</div></div>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Collection Wait</div><div id='pcFinanceSummaryCollectionWait' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryCollectionAmount' class='yj-finance-summary-sub'>잔금 ₩ 0</div><div id='pcFinanceSummaryPeriodB' class='yj-finance-period-badge'>전체 기간</div></div>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Completed</div><div id='pcFinanceSummaryCompleted' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryCompletedAmount' class='yj-finance-summary-sub'>입금 완료 ₩ 0</div><div id='pcFinanceSummaryPeriodC' class='yj-finance-period-badge'>전체 기간</div></div>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Action Queue</div><div id='pcFinanceSummaryActionQueue' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryActionSub' class='yj-finance-summary-sub'>승인/생산/청구/수금 처리 필요</div><div id='pcFinanceSummaryPeriodD' class='yj-finance-period-badge'>전체 기간</div></div>
            </div>`);
    }

    function isInvoiceWait(order = {}) {
        const qty = Number(order.qty) || 0;
        const completedQty = Number(order.completedQty) || 0;
        const productionDone = order.status === 'completed' || completedQty >= qty && qty > 0;
        return productionDone && !window.yjIsInvoiceIssued(order);
    }

    function computeFinanceSummary(orders = []) {
        const summary = {
            invoiceWaitCount: 0,
            invoiceWaitAmount: 0,
            collectionWaitCount: 0,
            collectionRemainAmount: 0,
            completedCount: 0,
            completedPaidAmount: 0,
            actionQueueCount: 0
        };
        orders.forEach(order => {
            const total = window.yjGetAmount(order);
            const paid = window.yjGetPaid(order);
            const remaining = Math.max(0, total - paid);
            if (isInvoiceWait(order)) {
                summary.invoiceWaitCount += 1;
                summary.invoiceWaitAmount += total;
            }
            if (window.yjIsInvoiceIssued(order) && order.paymentStatus !== 'paid' && remaining > 0) {
                summary.collectionWaitCount += 1;
                summary.collectionRemainAmount += remaining;
            }
            if (order.paymentStatus === 'paid') {
                summary.completedCount += 1;
                summary.completedPaidAmount += paid || total;
            }
        });
        const pendingCount = orders.filter(order => order.status === 'pending').length;
        const productionCount = orders.filter(order => order.status === 'approved').length;
        summary.actionQueueCount = pendingCount + productionCount + summary.invoiceWaitCount + summary.collectionWaitCount;
        return summary;
    }

    function renderFinanceSummary(summary) {
        injectSummaryGrid();
        const range = getFinancePeriodRange();
        const setText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        setText('pcFinanceSummaryInvoiceWait', `${summary.invoiceWaitCount}건`);
        setText('pcFinanceSummaryInvoiceAmount', `청구 예정 ${window.yjFormatKRW(summary.invoiceWaitAmount)}`);
        setText('pcFinanceSummaryCollectionWait', `${summary.collectionWaitCount}건`);
        setText('pcFinanceSummaryCollectionAmount', `잔금 ${window.yjFormatKRW(summary.collectionRemainAmount)}`);
        setText('pcFinanceSummaryCompleted', `${summary.completedCount}건`);
        setText('pcFinanceSummaryCompletedAmount', `입금 완료 ${window.yjFormatKRW(summary.completedPaidAmount)}`);
        setText('pcFinanceSummaryActionQueue', `${summary.actionQueueCount}건`);
        ['pcFinanceSummaryPeriodA', 'pcFinanceSummaryPeriodB', 'pcFinanceSummaryPeriodC', 'pcFinanceSummaryPeriodD'].forEach(id => setText(id, range.label));
    }

    function filterRenderedFinanceRows() {
        const range = getFinancePeriodRange();
        SECTION_BODY_META_MAP.forEach(({ bodyId, metaId }) => {
            const tbody = document.getElementById(bodyId);
            const meta = document.getElementById(metaId);
            if (!tbody) return;
            let visibleCount = 0;
            Array.from(tbody.querySelectorAll('tr')).forEach(row => {
                if (row.querySelector('td[colspan]')) {
                    row.classList.remove('yj-finance-row-hidden-by-period');
                    return;
                }
                const firstDateText = row.querySelector('td')?.textContent?.trim()?.slice(0, 10) || '';
                const isVisible = isDateInFinancePeriod(firstDateText, range);
                row.classList.toggle('yj-finance-row-hidden-by-period', !isVisible);
                if (isVisible) visibleCount += 1;
            });
            if (meta && range.value !== 'all') meta.textContent = `${visibleCount}건`;
        });
    }

    function refreshFinancePeriodView() {
        const filtered = filterOrdersByFinancePeriod(financeSummaryOrdersCache);
        renderFinanceSummary(computeFinanceSummary(filtered));
        filterRenderedFinanceRows();
    }

    function startFinanceSummaryListener() {
        if (financeSummaryUnsubscribe || !window.db) return;
        try {
            financeSummaryUnsubscribe = window.db.collection('orders').limit(300).onSnapshot(snapshot => {
                financeSummaryOrdersCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                refreshFinancePeriodView();
            }, error => console.error('작업22-3J Finance 기간 필터 요약 카드 로드 실패:', error));
        } catch (error) {
            console.error('작업22-3J Finance 기간 필터 요약 리스너 시작 실패:', error);
        }
    }

    document.addEventListener('change', event => {
        if (event.target && event.target.id === 'globalDateFilter') {
            refreshFinancePeriodView();
        }
    });

    const timer = setInterval(() => {
        enhanceFinanceSections();
        injectSummaryGrid();
        startFinanceSummaryListener();
        refreshFinancePeriodView();
        window.yjPatchFooterVersion();
    }, 300);
    setTimeout(() => clearInterval(timer), 30000);
    console.log('✅ 작업22-3J PC Finance 월별/기간 필터 보정 패치 준비 완료');
})();

// ═══════════════════════════════════════════════════════
// 작업22-4B — PC AR 거래처별 잔액 리스트 구현
// ═══════════════════════════════════════════════════════
(function installWork22_4BPCARClientBalancePatch() {
    if (window.__WORK22_4B_PC_AR_CLIENT_BALANCE_PATCH__) return;
    window.__WORK22_4B_PC_AR_CLIENT_BALANCE_PATCH__ = true;

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function getTodayText() {
        if (typeof window.getKSTDateString === 'function') return window.getKSTDateString();
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
    }

    function daysBetweenSafe(startDateStr, endDateStr) {
        if (typeof window.daysBetween === 'function') return window.daysBetween(startDateStr, endDateStr);
        if (!startDateStr || !endDateStr) return 0;
        const start = new Date(`${String(startDateStr).slice(0, 10)}T00:00:00+09:00`);
        const end = new Date(`${String(endDateStr).slice(0, 10)}T00:00:00+09:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
        return Math.max(0, Math.floor((end - start) / 86400000));
    }

    function getOutstanding(order = {}) {
        if (typeof window.getOutstandingAmount === 'function') return window.getOutstandingAmount(order);
        return Math.max(0, window.yjGetAmount(order) - window.yjGetPaid(order));
    }

    function groupDebtByClient(debtItems = [], todayStr = getTodayText()) {
        const map = new Map();
        debtItems.forEach(order => {
            const client = String(order.client || '미지정 거래처').trim() || '미지정 거래처';
            const total = window.yjGetAmount(order);
            const paid = window.yjGetPaid(order);
            const balance = getOutstanding(order);
            if (balance <= 0) return;

            const baseDate = String(order.payDate || order.dueDate || '').slice(0, 10) || '-';
            const elapsed = baseDate !== '-' ? daysBetweenSafe(baseDate, todayStr) : 0;

            if (!map.has(client)) {
                map.set(client, {
                    client,
                    orderCount: 0,
                    totalAmount: 0,
                    paidAmount: 0,
                    balanceAmount: 0,
                    latestDate: '-',
                    maxElapsed: 0,
                    hasOverdue: false
                });
            }

            const item = map.get(client);
            item.orderCount += 1;
            item.totalAmount += total;
            item.paidAmount += paid;
            item.balanceAmount += balance;
            item.maxElapsed = Math.max(item.maxElapsed, elapsed);
            item.hasOverdue = item.hasOverdue || elapsed >= 30;

            if (baseDate !== '-' && (item.latestDate === '-' || baseDate > item.latestDate)) {
                item.latestDate = baseDate;
            }
        });

        return Array.from(map.values()).sort((a, b) => {
            if (b.maxElapsed !== a.maxElapsed) return b.maxElapsed - a.maxElapsed;
            return b.balanceAmount - a.balanceAmount;
        });
    }

    function renderClientBalanceRows(clientItems = []) {
        const tbody = document.getElementById('pcArTableBody');
        if (!tbody) return;

        tbody.innerHTML = clientItems.slice(0, 15).map(item => {
            const riskBadge = item.maxElapsed >= 60
                ? `<span class='bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-1 rounded text-[10px] font-black'>RISK</span>`
                : item.maxElapsed >= 30
                    ? `<span class='bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-1 rounded text-[10px] font-black'>WATCH</span>`
                    : `<span class='bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-1 rounded text-[10px] font-black'>SAFE</span>`;
            const elapsedClass = item.maxElapsed >= 60 ? 'text-red-500' : item.maxElapsed >= 30 ? 'text-orange-400' : 'text-slate-400';

            return `
                <tr class='hover:bg-red-500/5 transition-colors'>
                    <td class='px-4 py-3 font-bold text-white'>${item.client}<br><span class='text-[10px] text-slate-500 font-black'>미수 ${item.orderCount}건</span></td>
                    <td class='px-4 py-3 text-slate-400'>${item.latestDate}</td>
                    <td class='px-4 py-3 ${elapsedClass} font-bold'>${item.maxElapsed}일<br>${riskBadge}</td>
                    <td class='px-4 py-3 text-right font-black text-red-400'>${window.yjFormatKRW(item.balanceAmount)}</td>
                </tr>
            `;
        }).join('') || `
            <tr>
                <td colspan='4' class='px-4 py-8 text-center text-slate-500 font-bold'>
                    미수금 데이터가 없습니다.
                </td>
            </tr>
        `;
    }

    function patchARCards() {
        if (typeof window.updatePCARCards !== 'function') return false;
        if (window.updatePCARCards.__WORK22_4B_PATCHED__) return true;

        const originalUpdatePCARCards = window.updatePCARCards;
        window.updatePCARCards = function patchedUpdatePCARCards(metrics = {}) {
            originalUpdatePCARCards(metrics);
            const todayStr = metrics.todayStr || getTodayText();
            const clientItems = groupDebtByClient(Array.isArray(metrics.debtItems) ? metrics.debtItems : [], todayStr);
            const overdueClients = clientItems.filter(item => item.maxElapsed >= 30);
            const normalClients = clientItems.filter(item => item.maxElapsed < 30);
            const overdueAmount = overdueClients.reduce((sum, item) => sum + item.balanceAmount, 0);
            const normalAmount = normalClients.reduce((sum, item) => sum + item.balanceAmount, 0);
            const paidAmount = Number(metrics.paidAmount) || 0;
            const debtAmount = overdueAmount + normalAmount;
            const recoveryRate = paidAmount + debtAmount > 0 ? Math.round((paidAmount / (paidAmount + debtAmount)) * 100) : 0;
            const riskLabel = overdueAmount > normalAmount && overdueAmount > 0 ? 'RISK' : overdueAmount > 0 ? 'WATCH' : 'SAFE';
            const riskMeta = riskLabel === 'RISK' ? '장기 미수 거래처 우선 회수 필요' : riskLabel === 'WATCH' ? '30일 이상 미수 거래처 존재' : '거래처별 연체 리스크 없음';

            setText('pcArOverdueAmount', window.yjFormatKRW(overdueAmount));
            setText('pcArOverdueMeta', `30일 이상 ${overdueClients.length}개 거래처`);
            setText('pcArNormalAmount', window.yjFormatKRW(normalAmount));
            setText('pcArNormalMeta', `입금 대기 ${normalClients.length}개 거래처`);
            setText('pcArRecoveryRate', `${recoveryRate}%`);
            setText('pcArRecoveryMeta', '거래처별 잔액 기준 회수율');
            setText('pcArRiskLabel', riskLabel);
            setText('pcArRiskMeta', riskMeta);
            setText('receivableChartTotal', typeof window.formatKRWShort === 'function' ? window.formatKRWShort(debtAmount) : Math.round(debtAmount).toLocaleString());
            renderClientBalanceRows(clientItems);
        };

        window.updatePCARCards.__WORK22_4B_PATCHED__ = true;
        console.log('✅ 작업22-4B PC AR 거래처별 잔액 리스트 패치 완료');
        return true;
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if (patchARCards() || attempts >= 80) clearInterval(timer);
    }, 250);
})();
