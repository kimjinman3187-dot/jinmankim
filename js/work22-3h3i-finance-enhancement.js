// ═══════════════════════════════════════════════════════
// 작업22-3H/3I — PC Finance 접기/펼치기 UI + 요약 카드 추가
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

    let financeSummaryUnsubscribe = null;

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
            @media(max-width:1024px){.yj-finance-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
            @media(max-width:640px){.yj-finance-summary-grid{grid-template-columns:1fr;}.yj-finance-section-header{align-items:flex-start!important;flex-direction:column!important;}.yj-finance-section-actions{justify-content:flex-start;}}
        `;
        document.head.appendChild(style);
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
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Invoice Wait</div><div id='pcFinanceSummaryInvoiceWait' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryInvoiceAmount' class='yj-finance-summary-sub'>청구 예정 ₩ 0</div></div>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Collection Wait</div><div id='pcFinanceSummaryCollectionWait' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryCollectionAmount' class='yj-finance-summary-sub'>잔금 ₩ 0</div></div>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Completed</div><div id='pcFinanceSummaryCompleted' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryCompletedAmount' class='yj-finance-summary-sub'>입금 완료 ₩ 0</div></div>
                <div class='yj-finance-summary-card'><div class='yj-finance-summary-label'>Action Queue</div><div id='pcFinanceSummaryActionQueue' class='yj-finance-summary-value'>0건</div><div id='pcFinanceSummaryActionSub' class='yj-finance-summary-sub'>승인/생산/청구/수금 처리 필요</div></div>
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
    }

    function startFinanceSummaryListener() {
        if (financeSummaryUnsubscribe || !window.db) return;
        try {
            financeSummaryUnsubscribe = window.db.collection('orders').limit(300).onSnapshot(snapshot => {
                const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                renderFinanceSummary(computeFinanceSummary(orders));
            }, error => console.error('작업22-3H/3I Finance 요약 카드 로드 실패:', error));
        } catch (error) {
            console.error('작업22-3H/3I Finance 요약 리스너 시작 실패:', error);
        }
    }

    const timer = setInterval(() => {
        enhanceFinanceSections();
        injectSummaryGrid();
        startFinanceSummaryListener();
        window.yjPatchFooterVersion();
    }, 300);
    setTimeout(() => clearInterval(timer), 30000);
    console.log('✅ 작업22-3H/3I PC Finance 접기/펼치기 및 요약 카드 패치 준비 완료');
})();
