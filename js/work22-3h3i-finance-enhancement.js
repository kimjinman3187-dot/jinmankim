// ═══════════════════════════════════════════════════════
// YJ Flow PC 보조 패치 모음
// 작업22-3H/3I/3J — Finance 접기/펼치기 + 요약 카드 + 기간 필터
// 작업22-4B — PC AR 거래처별 잔액 리스트
// 작업22-5A — Dashboard 통합 지표 정리
// 작업22-5A-1 — Dashboard KPI overflow + LAST UPDATED 보정
// 작업22-5A-2 — Dashboard KPI 카드 레이아웃 직접 보정
// 작업22-5A-3 — PC KPI 카드 공통 overflow 보정
// 작업23-0A-1 — 공통 UI/용어/모바일 표시 정리
// 작업23-0A-2 — PC 상단 제목 이모티콘 중복 제거 보정
// 작업23-1A-1 — Production 진행 리스트 운영성 개선
// 작업23-1A-2 — Production 완료/포장 대기 리스트 운영성 개선
// ═══════════════════════════════════════════════════════
(function installYJFlowPCEnhancementPatches() {
    if (window.__YJ_FLOW_PC_ENHANCEMENT_PATCHES__) return;
    window.__YJ_FLOW_PC_ENHANCEMENT_PATCHES__ = true;

    const PATCH_VERSION = 'V2.0.2';
    const LAST_UPDATED = '26.05.28';

    const MONEY_KPI_IDS = [
        'pcKpiSales', 'pcKpiDebt',
        'pcFinanceOrderTotal', 'pcFinanceIssuedTotal', 'pcFinancePaidTotal', 'pcFinanceDebtTotal',
        'pcArOverdueAmount', 'pcArNormalAmount', 'receivableChartTotal'
    ];
    const COMMON_KPI_IDS = [
        ...MONEY_KPI_IDS,
        'pcKpiFactory', 'pcKpiPending', 'pcArRecoveryRate', 'pcArRiskLabel'
    ];
    const PC_TITLE_MARKERS = [
        'LIVE Dashboard', 'Live Dashboard', 'Operations Hub',
        'Sales Management', 'Finance Overview', 'Accounts Receivable',
        'Production Management', 'Production Live', 'Production',
        '회계 자산 현황판', '채권 현황판', '생산 공정 현황판'
    ];

    const krw = value => {
        if (typeof window.yjFormatKRW === 'function') return window.yjFormatKRW(value);
        if (typeof window.formatKRW === 'function') return window.formatKRW(value);
        return `₩ ${Math.round(Number(value) || 0).toLocaleString()}`;
    };

    const dashboardKrwShort = value => {
        const amount = Math.max(0, Number(value) || 0);
        if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}억`;
        if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}천만`;
        if (amount >= 10000) return `${Math.round(amount / 10000)}만`;
        return `${Math.round(amount).toLocaleString()}`;
    };

    const getAmount = order => {
        if (typeof window.yjGetAmount === 'function') return window.yjGetAmount(order);
        if (typeof window.getOrderAmount === 'function') return window.getOrderAmount(order);
        return (Number(order?.price) || 0) * (Number(order?.qty) || 0);
    };

    const getPaid = order => {
        if (typeof window.yjGetPaid === 'function') return window.yjGetPaid(order);
        if (typeof window.getPaidAmount === 'function') return window.getPaidAmount(order);
        const total = getAmount(order);
        const paid = Number(order?.paidAmount) || 0;
        if (order?.paymentStatus === 'paid') return paid > 0 ? Math.min(paid, total) : total;
        return Math.min(paid, total);
    };

    const getOutstanding = order => {
        if (typeof window.getOutstandingAmount === 'function') return window.getOutstandingAmount(order);
        return Math.max(0, getAmount(order) - getPaid(order));
    };

    const isInvoiceIssued = order => {
        if (typeof window.yjIsInvoiceIssued === 'function') return window.yjIsInvoiceIssued(order);
        if (typeof window.isInvoiceIssued === 'function') return window.isInvoiceIssued(order);
        return order?.invoiceStatus === 'issued' || !!order?.invoiceIssuedAt;
    };

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    const getKSTDateStringSafe = (dateObj = new Date()) => {
        if (typeof window.getKSTDateString === 'function') return window.getKSTDateString(dateObj);
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(dateObj);
    };

    const daysBetweenSafe = (startDateStr, endDateStr) => {
        if (typeof window.daysBetween === 'function') return window.daysBetween(startDateStr, endDateStr);
        if (!startDateStr || !endDateStr) return 0;
        const start = new Date(`${String(startDateStr).slice(0, 10)}T00:00:00+09:00`);
        const end = new Date(`${String(endDateStr).slice(0, 10)}T00:00:00+09:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
        return Math.max(0, Math.floor((end - start) / 86400000));
    };

    function normalizeUiLabel(text = '') {
        return String(text)
            .replace('회계 자산 관제탑', '회계 자산 현황판')
            .replace('채권 현황 관제탑', '채권 현황판')
            .replace('생산 공정 관제탑', '생산 공정 현황판');
    }

    function stripLeadingEmoji(text = '') {
        return String(text).replace(/^\s*(?:[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\uFE0F)+\s*/u, '');
    }

    function patchLastUpdated() {
        document.querySelectorAll('.system-footer p, aside p').forEach(p => {
            const text = (p.textContent || '').toLowerCase();
            if (text.includes('last updated')) p.textContent = `LAST UPDATED: ${LAST_UPDATED}`;
            if (text.includes('yj flow')) p.textContent = `YJ FLOW ${PATCH_VERSION}`;
        });
    }

    function patchCommonUiText() {
        document.querySelectorAll('.system-footer').forEach(footer => {
            const rows = Array.from(footer.querySelectorAll('p'));
            if (!rows.length) return;
            const firstText = rows[0].textContent || '';
            if (firstText.includes('LAST UPDATED') || firstText.includes('26.05.15') || firstText.includes('v2.0.1') || firstText.trim().startsWith(':')) {
                rows[0].textContent = `LAST UPDATED: ${LAST_UPDATED}`;
            }
            const hasVersion = rows.some(p => (p.textContent || '').includes('YJ FLOW'));
            if (!hasVersion) {
                const versionLine = document.createElement('p');
                versionLine.textContent = `YJ FLOW ${PATCH_VERSION}`;
                rows[0].insertAdjacentElement('afterend', versionLine);
            }
        });

        const labelNodes = Array.from(document.querySelectorAll('h1, h2, h3, p, span, button'));
        labelNodes.forEach(el => {
            if (!el || !el.textContent || el.children.length > 0) return;
            const current = el.textContent;
            let next = normalizeUiLabel(current);
            const stripped = stripLeadingEmoji(next);
            const shouldStrip = PC_TITLE_MARKERS.some(marker => stripped.includes(marker)) || /^(LIVE|Live|Sales|Finance|AR|Production|Operations|Accounts)/.test(stripped.trim());
            if (shouldStrip) next = stripped;
            if (next !== current) el.textContent = next;
        });
    }

    function parseMoneyText(text = '') {
        const clean = String(text).replace(/[^0-9.-]/g, '');
        const number = Number(clean);
        return Number.isFinite(number) ? number : 0;
    }

    function compactMoneyKpis() {
        MONEY_KPI_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const text = el.textContent || '';
            if (text.includes('억') || text.includes('천만') || /^\d+만$/.test(text.trim())) return;
            const amount = parseMoneyText(text);
            if (amount > 0) el.textContent = dashboardKrwShort(amount);
        });
    }

    function markCommonKpiCards() {
        COMMON_KPI_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('yj-common-kpi-value');
            const card = el.parentElement;
            if (card) card.classList.add('yj-common-kpi-card');
        });
    }

    function applyCommonKpiLayout() {
        injectSharedStyle();
        markCommonKpiCards();
        compactMoneyKpis();
        patchLastUpdated();
        patchCommonUiText();
    }

    function injectSharedStyle() {
        if (document.getElementById('work22-pc-enhancement-style')) return;
        const style = document.createElement('style');
        style.id = 'work22-pc-enhancement-style';
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
            .yj-common-kpi-card{min-width:0!important;overflow:hidden!important;padding:.85rem .9rem!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:.16rem!important;}
            .yj-common-kpi-card p,.yj-common-kpi-card span,.yj-common-kpi-card div{max-width:100%!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;}
            .yj-common-kpi-value{display:block!important;width:100%!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:1.08rem!important;line-height:1.05!important;letter-spacing:-0.055em!important;font-variant-numeric:tabular-nums!important;}
            .yj-dashboard-kpi-card{min-width:0!important;overflow:hidden!important;padding:.75rem .85rem!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:.18rem!important;}
            .yj-dashboard-kpi-card p,.yj-dashboard-kpi-card span,.yj-dashboard-kpi-card div{max-width:100%!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;}
            .yj-dashboard-meta{display:block;margin-top:.18rem;font-size:9px!important;line-height:1.1!important;font-weight:900;color:#64748b;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
            .yj-production-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:1rem;}
            .yj-production-summary-card{border:1px solid rgba(51,65,85,.9);background:rgba(15,21,34,.74);border-radius:1rem;padding:.8rem;min-width:0;overflow:hidden;}
            .yj-production-summary-label{font-size:9px;color:#64748b;font-weight:900;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            .yj-production-summary-value{font-size:1.05rem;color:#fff;font-weight:1000;margin-top:.2rem;letter-spacing:-.03em;}
            .yj-production-card{border:1px solid rgba(51,65,85,.95);background:rgba(15,21,34,.72);border-radius:1rem;padding:1rem;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease;}
            .yj-production-card.is-overdue{border-color:rgba(239,68,68,.5);background:rgba(127,29,29,.13);}
            .yj-production-card.is-today{border-color:rgba(249,115,22,.48);background:rgba(124,45,18,.12);}
            .yj-production-card.is-soon{border-color:rgba(234,179,8,.42);background:rgba(113,63,18,.1);}
            .yj-production-card.is-ready{border-color:rgba(34,197,94,.55);background:rgba(20,83,45,.14);box-shadow:0 0 0 1px rgba(34,197,94,.18) inset;}
            .yj-production-card.is-packing{border-color:rgba(59,130,246,.48);background:rgba(30,64,175,.13);}
            .yj-production-badge{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:0 .45rem;border-radius:.5rem;border:1px solid rgba(148,163,184,.2);font-size:10px;font-weight:1000;white-space:nowrap;}
            .yj-production-badge.overdue{color:#f87171;background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.32);}
            .yj-production-badge.today{color:#fb923c;background:rgba(249,115,22,.10);border-color:rgba(249,115,22,.32);}
            .yj-production-badge.soon{color:#facc15;background:rgba(234,179,8,.10);border-color:rgba(234,179,8,.32);}
            .yj-production-badge.normal{color:#38bdf8;background:rgba(14,165,233,.09);border-color:rgba(14,165,233,.28);}
            .yj-production-badge.progress{color:#a78bfa;background:rgba(139,92,246,.10);border-color:rgba(139,92,246,.26);}
            .yj-production-badge.ready{color:#4ade80;background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.34);}
            .yj-production-badge.packing{color:#60a5fa;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.34);}
            .yj-production-wait-panel{border:1px solid rgba(34,197,94,.24);background:rgba(20,83,45,.08);border-radius:1rem;padding:.85rem;margin-bottom:1rem;}
            .yj-production-wait-title{font-size:11px;color:#bbf7d0;font-weight:1000;letter-spacing:-.02em;margin-bottom:.55rem;}
            .yj-production-wait-row{display:flex;justify-content:space-between;gap:.75rem;padding:.45rem 0;border-top:1px solid rgba(148,163,184,.12);font-size:11px;font-weight:900;}
            .yj-production-wait-row:first-of-type{border-top:0;}
            #pcKpiSales,#pcKpiDebt,#pcKpiFactory,#pcKpiPending{display:block!important;width:100%!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:1.05rem!important;line-height:1.05!important;letter-spacing:-0.045em!important;font-variant-numeric:tabular-nums!important;}
            #pcFinanceOrderTotal,#pcFinanceIssuedTotal,#pcFinancePaidTotal,#pcFinanceDebtTotal,#pcArOverdueAmount,#pcArNormalAmount{font-size:1.05rem!important;letter-spacing:-0.055em!important;}
            #pcArRecoveryRate,#pcArRiskLabel{font-size:1.22rem!important;letter-spacing:-0.035em!important;}
            @media(max-width:1280px){.yj-common-kpi-value,#pcKpiSales,#pcKpiDebt,#pcKpiFactory,#pcKpiPending,#pcFinanceOrderTotal,#pcFinanceIssuedTotal,#pcFinancePaidTotal,#pcFinanceDebtTotal,#pcArOverdueAmount,#pcArNormalAmount{font-size:.95rem!important;}.yj-common-kpi-card,.yj-dashboard-kpi-card{padding:.7rem .75rem!important;}.yj-dashboard-meta{font-size:8.5px!important;}}
            @media(max-width:1024px){.yj-finance-summary-grid,.yj-production-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
            @media(max-width:640px){.yj-finance-summary-grid,.yj-production-summary-grid{grid-template-columns:1fr;}.yj-finance-section-header{align-items:flex-start!important;flex-direction:column!important;}.yj-finance-section-actions{justify-content:flex-start;}}
        `;
        document.head.appendChild(style);
    }

    // ───────────────────────────────────────────────
    // 작업22-3H/3I/3J — Finance 화면 운영성 보정
    // ───────────────────────────────────────────────
    (function installFinanceEnhancement() {
        if (window.__WORK22_3H3I3J_FINANCE_PATCH__) return;
        window.__WORK22_3H3I3J_FINANCE_PATCH__ = true;

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

        function getFinancePeriodRange() {
            const value = document.getElementById('globalDateFilter')?.value || 'all';
            const today = new Date();
            let start = '';
            let end = '';
            let label = '전체 기간';
            if (value === '7days') {
                const d = new Date(today);
                d.setDate(today.getDate() - 7);
                start = getKSTDateStringSafe(d);
                end = getKSTDateStringSafe(today);
                label = '최근 7일';
            } else if (value === 'lastMonth') {
                start = getKSTDateStringSafe(new Date(today.getFullYear(), today.getMonth() - 1, 1));
                end = getKSTDateStringSafe(new Date(today.getFullYear(), today.getMonth(), 0));
                label = '지난 달';
            } else if (value === 'thisYear') {
                start = getKSTDateStringSafe(new Date(today.getFullYear(), 0, 1));
                end = getKSTDateStringSafe(today);
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

        function findSection(rule) {
            if (!rule.sectionFromBody) return document.getElementById(rule.id);
            const body = document.getElementById(rule.id);
            const table = body && body.closest('table');
            return table && table.parentElement && table.parentElement.parentElement;
        }

        function wrapSectionContent(section) {
            if (!section || section.querySelector(':scope > .yj-finance-section-content')) return;
            const header = section.firstElementChild;
            if (!header) return;
            header.classList.add('yj-finance-section-header');
            const content = document.createElement('div');
            content.className = 'yj-finance-section-content';
            Array.from(section.children).slice(1).forEach(node => content.appendChild(node));
            section.appendChild(content);
        }

        function setSectionOpen(section, isOpen) {
            section.classList.toggle('yj-finance-collapsed', !isOpen);
            const button = section.querySelector('.yj-finance-toggle-btn');
            if (button) button.textContent = isOpen ? '접기' : '펼치기';
        }

        function ensureHeaderActions(section, rule) {
            const header = section && section.firstElementChild;
            if (!header || header.querySelector('.yj-finance-toggle-btn')) return;
            const meta = section.querySelector('[id$="Meta"]');
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
                setSectionOpen(section, section.classList.contains('yj-finance-collapsed'));
            });
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                setSectionOpen(section, section.classList.contains('yj-finance-collapsed'));
            });
        }

        function enhanceFinanceSections() {
            injectSharedStyle();
            SECTION_RULES.forEach(rule => {
                const section = findSection(rule);
                if (!section) return;
                wrapSectionContent(section);
                ensureHeaderActions(section, rule);
                if (!section.dataset.yjFinanceDefaultApplied) {
                    section.dataset.yjFinanceDefaultApplied = 'true';
                    setSectionOpen(section, rule.defaultOpen);
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
            const productionDone = order.status === 'completed' || (completedQty >= qty && qty > 0);
            return productionDone && !isInvoiceIssued(order);
        }

        function computeFinanceSummary(orders = []) {
            const summary = { invoiceWaitCount: 0, invoiceWaitAmount: 0, collectionWaitCount: 0, collectionRemainAmount: 0, completedCount: 0, completedPaidAmount: 0, actionQueueCount: 0 };
            orders.forEach(order => {
                const total = getAmount(order);
                const paid = getPaid(order);
                const remaining = Math.max(0, total - paid);
                if (isInvoiceWait(order)) { summary.invoiceWaitCount += 1; summary.invoiceWaitAmount += total; }
                if (isInvoiceIssued(order) && order.paymentStatus !== 'paid' && remaining > 0) { summary.collectionWaitCount += 1; summary.collectionRemainAmount += remaining; }
                if (order.paymentStatus === 'paid') { summary.completedCount += 1; summary.completedPaidAmount += paid || total; }
            });
            const pendingCount = orders.filter(order => order.status === 'pending').length;
            const productionCount = orders.filter(order => order.status === 'approved').length;
            summary.actionQueueCount = pendingCount + productionCount + summary.invoiceWaitCount + summary.collectionWaitCount;
            return summary;
        }

        function renderFinanceSummary(summary) {
            injectSummaryGrid();
            const range = getFinancePeriodRange();
            setText('pcFinanceSummaryInvoiceWait', `${summary.invoiceWaitCount}건`);
            setText('pcFinanceSummaryInvoiceAmount', `청구 예정 ${krw(summary.invoiceWaitAmount)}`);
            setText('pcFinanceSummaryCollectionWait', `${summary.collectionWaitCount}건`);
            setText('pcFinanceSummaryCollectionAmount', `잔금 ${krw(summary.collectionRemainAmount)}`);
            setText('pcFinanceSummaryCompleted', `${summary.completedCount}건`);
            setText('pcFinanceSummaryCompletedAmount', `입금 완료 ${krw(summary.completedPaidAmount)}`);
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
                    if (row.querySelector('td[colspan]')) { row.classList.remove('yj-finance-row-hidden-by-period'); return; }
                    const firstDateText = row.querySelector('td')?.textContent?.trim()?.slice(0, 10) || '';
                    const isVisible = isDateInFinancePeriod(firstDateText, range);
                    row.classList.toggle('yj-finance-row-hidden-by-period', !isVisible);
                    if (isVisible) visibleCount += 1;
                });
                if (meta && range.value !== 'all') meta.textContent = `${visibleCount}건`;
            });
        }

        function refreshFinancePeriodView() {
            const range = getFinancePeriodRange();
            const filtered = range.value === 'all' ? financeSummaryOrdersCache : financeSummaryOrdersCache.filter(order => isDateInFinancePeriod(getOrderFinanceDate(order), range));
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
            if (event.target && event.target.id === 'globalDateFilter') refreshFinancePeriodView();
        });

        const timer = setInterval(() => {
            enhanceFinanceSections();
            injectSummaryGrid();
            startFinanceSummaryListener();
            refreshFinancePeriodView();
            applyCommonKpiLayout();
        }, 300);
        setTimeout(() => clearInterval(timer), 30000);
        console.log('✅ 작업22-3J PC Finance 월별/기간 필터 보정 패치 준비 완료');
    })();

    // ───────────────────────────────────────────────
    // 작업22-4B — PC AR 거래처별 잔액 리스트 구현
    // ───────────────────────────────────────────────
    (function installARClientBalancePatch() {
        if (window.__WORK22_4B_PC_AR_CLIENT_BALANCE_PATCH__) return;
        window.__WORK22_4B_PC_AR_CLIENT_BALANCE_PATCH__ = true;

        function groupDebtByClient(debtItems = [], todayStr = getKSTDateStringSafe()) {
            const map = new Map();
            debtItems.forEach(order => {
                const client = String(order.client || '미지정 거래처').trim() || '미지정 거래처';
                const balance = getOutstanding(order);
                if (balance <= 0) return;
                const baseDate = String(order.payDate || order.dueDate || '').slice(0, 10) || '-';
                const elapsed = baseDate !== '-' ? daysBetweenSafe(baseDate, todayStr) : 0;
                if (!map.has(client)) map.set(client, { client, orderCount: 0, totalAmount: 0, paidAmount: 0, balanceAmount: 0, latestDate: '-', maxElapsed: 0 });
                const item = map.get(client);
                item.orderCount += 1;
                item.totalAmount += getAmount(order);
                item.paidAmount += getPaid(order);
                item.balanceAmount += balance;
                item.maxElapsed = Math.max(item.maxElapsed, elapsed);
                if (baseDate !== '-' && (item.latestDate === '-' || baseDate > item.latestDate)) item.latestDate = baseDate;
            });
            return Array.from(map.values()).sort((a, b) => b.maxElapsed !== a.maxElapsed ? b.maxElapsed - a.maxElapsed : b.balanceAmount - a.balanceAmount);
        }

        function renderClientBalanceRows(clientItems = []) {
            const tbody = document.getElementById('pcArTableBody');
            if (!tbody) return;
            tbody.innerHTML = clientItems.slice(0, 15).map(item => {
                const riskBadge = item.maxElapsed >= 60 ? `<span class='bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-1 rounded text-[10px] font-black'>RISK</span>` : item.maxElapsed >= 30 ? `<span class='bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-1 rounded text-[10px] font-black'>WATCH</span>` : `<span class='bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-1 rounded text-[10px] font-black'>SAFE</span>`;
                const elapsedClass = item.maxElapsed >= 60 ? 'text-red-500' : item.maxElapsed >= 30 ? 'text-orange-400' : 'text-slate-400';
                return `<tr class='hover:bg-red-500/5 transition-colors'><td class='px-4 py-3 font-bold text-white'>${item.client}<br><span class='text-[10px] text-slate-500 font-black'>미수 ${item.orderCount}건</span></td><td class='px-4 py-3 text-slate-400'>${item.latestDate}</td><td class='px-4 py-3 ${elapsedClass} font-bold'>${item.maxElapsed}일<br>${riskBadge}</td><td class='px-4 py-3 text-right font-black text-red-400'>${dashboardKrwShort(item.balanceAmount)}</td></tr>`;
            }).join('') || `<tr><td colspan='4' class='px-4 py-8 text-center text-slate-500 font-bold'>미수금 데이터가 없습니다.</td></tr>`;
        }

        function applyARCards(metrics = {}) {
            const todayStr = metrics.todayStr || getKSTDateStringSafe();
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
            setText('pcArOverdueAmount', dashboardKrwShort(overdueAmount));
            setText('pcArOverdueMeta', `30일 이상 ${overdueClients.length}개 거래처`);
            setText('pcArNormalAmount', dashboardKrwShort(normalAmount));
            setText('pcArNormalMeta', `입금 대기 ${normalClients.length}개 거래처`);
            setText('pcArRecoveryRate', `${recoveryRate}%`);
            setText('pcArRecoveryMeta', '거래처별 잔액 기준 회수율');
            setText('pcArRiskLabel', riskLabel);
            setText('pcArRiskMeta', riskMeta);
            setText('receivableChartTotal', dashboardKrwShort(debtAmount));
            renderClientBalanceRows(clientItems);
            applyCommonKpiLayout();
        }

        function patchARCards() {
            if (typeof window.updatePCARCards !== 'function') return false;
            if (window.updatePCARCards.__WORK22_4B_PATCHED__) return true;
            const originalUpdatePCARCards = window.updatePCARCards;
            window.updatePCARCards = function patchedUpdatePCARCards(metrics = {}) { originalUpdatePCARCards(metrics); applyARCards(metrics); };
            window.updatePCARCards.__WORK22_4B_PATCHED__ = true;
            console.log('✅ 작업22-4B PC AR 거래처별 잔액 리스트 패치 완료');
            return true;
        }

        let attempts = 0;
        const timer = setInterval(() => { attempts += 1; applyCommonKpiLayout(); if (patchARCards() || attempts >= 80) clearInterval(timer); }, 250);
    })();

    // ───────────────────────────────────────────────
    // 작업23-1A-1/1A-2 — Production 진행 리스트 운영성 개선
    // ───────────────────────────────────────────────
    (function installProductionOperationsPatch() {
        if (window.__WORK23_1A_PRODUCTION_OPERATIONS_PATCH__) return;
        window.__WORK23_1A_PRODUCTION_OPERATIONS_PATCH__ = true;

        function percent(done, total) {
            if (typeof window.yjSafePercent === 'function') return window.yjSafePercent(done, total);
            const totalNumber = Number(total) || 0;
            if (totalNumber <= 0) return 0;
            return Math.min(100, Math.round(((Number(done) || 0) / totalNumber) * 100));
        }

        function getDueState(order = {}, todayStr = getKSTDateStringSafe()) {
            const dueDate = String(order.dueDate || '').slice(0, 10);
            if (!dueDate || dueDate === '-') return { key: 'normal', label: '납기 미지정', sort: 40, days: null };
            if (dueDate < todayStr) return { key: 'overdue', label: `지연 ${daysBetweenSafe(dueDate, todayStr)}일`, sort: 0, days: -daysBetweenSafe(dueDate, todayStr) };
            if (dueDate === todayStr) return { key: 'today', label: '오늘 납기', sort: 10, days: 0 };
            const left = daysBetweenSafe(todayStr, dueDate);
            if (left <= 3) return { key: 'soon', label: `임박 D-${left}`, sort: 20, days: left };
            return { key: 'normal', label: `D-${left}`, sort: 30, days: left };
        }

        function getPackingState(pct, remainQty) {
            if (remainQty <= 0 || pct >= 100) return { key: 'ready', label: '완료 대기', sort: -20 };
            if (pct >= 90) return { key: 'packing', label: '포장 대기', sort: -10 };
            if (pct >= 70) return { key: 'progress', label: '마감 단계', sort: 10 };
            if (pct >= 35) return { key: 'progress', label: '진행 중', sort: 20 };
            if (pct > 0) return { key: 'progress', label: '초기 진행', sort: 30 };
            return { key: 'progress', label: '착수 대기', sort: 40 };
        }

        const getProductionPrimaryLabel = order =>
            String(order?.client || order?.workName || order?.title || order?.product || order?.memo || order?.material || '-').trim() || '-';

        const getProductionSecondaryLabel = order =>
            String(order?.material || order?.product || order?.workName || order?.title || order?.memo || '-').trim() || '-';

        function renderEnhancedProductionList(metrics = {}) {
            const list = document.getElementById('pcProductionProgressList');
            if (!list) return;
            const todayStr = metrics.todayStr || getKSTDateStringSafe();
            const activeItems = Array.isArray(metrics.activeProductionItems) ? metrics.activeProductionItems : [];
const packingFallbackItems = Array.isArray(metrics.packingWaitItems)
    ? metrics.packingWaitItems
    : Array.isArray(window.filteredOrders)
        ? window.filteredOrders.filter(order =>
            order &&
            order.status === 'completed' &&
            order.paymentStatus !== 'paid'
        )
        : [];

const itemMap = new Map();
[...activeItems, ...packingFallbackItems].forEach(order => {
    if (order?.id && !itemMap.has(order.id)) {
        itemMap.set(order.id, order);
    }
});

const items = Array.from(itemMap.values());
            const decorated = items.map(order => {
                const qty = Number(order.qty) || 0;
                const completedQty = Math.min(Number(order.completedQty) || 0, qty);
                const pct = percent(completedQty, qty);
                const due = getDueState(order, todayStr);
                const remainQty = Math.max(0, qty - completedQty);
                const packing = getPackingState(pct, remainQty);
                return { order, qty, completedQty, pct, due, remainQty, packing };
            }).sort((a, b) => {
                const aActive = a.order.status === 'approved' ? 0 : 1;
                const bActive = b.order.status === 'approved' ? 0 : 1;
                return aActive - bActive || a.packing.sort - b.packing.sort || a.due.sort - b.due.sort || String(a.order.dueDate || '').localeCompare(String(b.order.dueDate || '')) || b.pct - a.pct;
            });

            const overdueCount = decorated.filter(item => item.due.key === 'overdue').length;
            const readyCount = decorated.filter(item => item.packing.key === 'ready').length;
            const packingCount = decorated.filter(item => item.packing.key === 'packing').length;
            const totalRemain = decorated.reduce((sum, item) => sum + item.remainQty, 0);
            const waitItems = decorated.filter(item => item.packing.key === 'ready' || item.packing.key === 'packing');

            if (!decorated.length) {
                list.innerHTML = `<p class='text-center text-xs text-slate-500 font-bold py-8'>진행 중인 공정 데이터가 없습니다.</p>`;
                return;
            }

            const summary = `
                <div class='yj-production-summary-grid'>
                    <div class='yj-production-summary-card'><div class='yj-production-summary-label'>Overdue</div><div class='yj-production-summary-value text-red-400'>${overdueCount}건</div></div>
                    <div class='yj-production-summary-card'><div class='yj-production-summary-label'>Ready</div><div class='yj-production-summary-value text-green-400'>${readyCount}건</div></div>
                    <div class='yj-production-summary-card'><div class='yj-production-summary-label'>Packing</div><div class='yj-production-summary-value text-blue-400'>${packingCount}건</div></div>
                    <div class='yj-production-summary-card'><div class='yj-production-summary-label'>Remain</div><div class='yj-production-summary-value text-blue-400'>${totalRemain.toLocaleString()}장</div></div>
                </div>`;

            const waitPanel = waitItems.length ? `
                <div class='yj-production-wait-panel'>
                    <div class='yj-production-wait-title'>완료/포장 대기 우선 처리</div>
                    ${waitItems.slice(0, 4).map(item => `
                        <div class='yj-production-wait-row'>
                            <span class='text-white truncate'>${getProductionPrimaryLabel(item.order)}</span>
                            <span class='${item.packing.key === 'ready' ? 'text-green-400' : 'text-blue-400'}'>${item.packing.label} · 잔여 ${item.remainQty.toLocaleString()}장</span>
                        </div>`).join('')}
                </div>` : '';

            const rows = decorated.map(item => {
                const o = item.order;
                const inputId = `pc-in-${o.id}`;
                const dueClass = item.due.key;
                const cardClass = item.packing.key === 'ready' ? 'ready' : item.packing.key === 'packing' ? 'packing' : dueClass;
                const remainClass = item.remainQty <= 0 ? 'text-green-400' : item.pct >= 90 ? 'text-blue-400' : 'text-slate-300';
                const primaryLabel = getProductionPrimaryLabel(o);
                const secondaryLabel = getProductionSecondaryLabel(o);
                return `
                    <div class='yj-production-card is-${cardClass}'>
                        <div class='flex justify-between items-start gap-3 text-xs font-bold mb-2'>
                            <div class='min-w-0'>
                                <div class='text-white truncate'>${primaryLabel}</div>
                                <div class='text-[10px] text-slate-500 mt-1 truncate'>${secondaryLabel} · 총 ${item.qty.toLocaleString()}장</div>
                            </div>
                            <div class='flex flex-col items-end gap-1 shrink-0'>
                                <span class='yj-production-badge ${dueClass}'>${item.due.label}</span>
                                <span class='yj-production-badge ${item.packing.key}'>${item.packing.label}</span>
                            </div>
                        </div>
                        <div class='flex justify-between text-[10px] font-bold mb-1'>
                            <span class='text-slate-400'>${item.completedQty.toLocaleString()} / ${item.qty.toLocaleString()}장</span>
                            <span class='${item.pct >= 90 ? 'text-green-400' : 'text-blue-400'}'>${item.pct}%</span>
                        </div>
                        <div class='w-full bg-[#0f1522] h-2.5 rounded-full overflow-hidden border border-[#334155]'>
                            <div class='${item.pct >= 90 ? 'bg-green-500' : 'bg-blue-500'} h-full rounded-full transition-all duration-1000 ease-out' style='width: ${item.pct}%'></div>
                        </div>
                        <div class='mt-2 text-[10px] text-slate-500 font-bold flex justify-between'>
                            <span>납기: ${o.dueDate || '-'}</span>
                            <span class='${remainClass}'>잔여 ${item.remainQty.toLocaleString()}장</span>
                        </div>
                        <div class='mt-3 flex gap-2'>
                            <input type='text' id='${inputId}' class='flex-1 px-3 py-2 bg-[#111827] border border-[#334155] rounded-lg text-xs text-white font-bold outline-none focus:border-blue-400' placeholder='생산 수량'>
                            <button onclick="addProgress('${o.id}', '${inputId}')" class='px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-black shadow-md transition-colors'>보고</button>
                        </div>
                    </div>`;
            }).join('');
            list.innerHTML = summary + waitPanel + rows;
        }

        function patchProductionCards() {
            if (typeof window.updatePCProductionCards !== 'function') return false;
            if (window.updatePCProductionCards.__WORK23_1A_PATCHED__) return true;
            const originalUpdatePCProductionCards = window.updatePCProductionCards;
            window.updatePCProductionCards = function patchedUpdatePCProductionCards(metrics = {}) {
                originalUpdatePCProductionCards(metrics);
                renderEnhancedProductionList(metrics);
            };
            window.updatePCProductionCards.__WORK23_1A_PATCHED__ = true;
            console.log('✅ 작업23-1A-2 Production 완료/포장 대기 리스트 운영성 개선 패치 완료');
            return true;
        }

        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            injectSharedStyle();
            applyCommonKpiLayout();
            if (patchProductionCards() || attempts >= 80) clearInterval(timer);
        }, 250);
    })();

    // ───────────────────────────────────────────────
    // 작업22-5A/5A-1/5A-2/5A-3 — Dashboard 통합 지표 + PC KPI 공통 레이아웃 보정
    // ───────────────────────────────────────────────
    (function installDashboardIntegratedKpiPatch() {
        if (window.__WORK22_5A_DASHBOARD_INTEGRATED_KPI_PATCH__) return;
        window.__WORK22_5A_DASHBOARD_INTEGRATED_KPI_PATCH__ = true;

        function markDashboardKpiCard(valueId) {
            const valueEl = document.getElementById(valueId);
            const card = valueEl?.parentElement;
            if (card) card.classList.add('yj-dashboard-kpi-card', 'yj-common-kpi-card');
            if (valueEl) valueEl.classList.add('yj-common-kpi-value');
        }

        function setCardLabel(valueId, label) {
            const valueEl = document.getElementById(valueId);
            const card = valueEl?.parentElement;
            const labelEl = card?.querySelector('p:first-child');
            if (labelEl) labelEl.textContent = label;
            if (card) card.classList.add('yj-dashboard-kpi-card', 'yj-common-kpi-card');
            if (valueEl) valueEl.classList.add('yj-common-kpi-value');
        }

        function setCardMeta(valueId, meta) {
            const valueEl = document.getElementById(valueId);
            if (!valueEl || !valueEl.parentElement) return;
            valueEl.parentElement.classList.add('yj-dashboard-kpi-card', 'yj-common-kpi-card');
            valueEl.classList.add('yj-common-kpi-value');
            let metaEl = valueEl.parentElement.querySelector('.yj-dashboard-meta');
            if (!metaEl) { metaEl = document.createElement('span'); metaEl.className = 'yj-dashboard-meta'; valueEl.insertAdjacentElement('afterend', metaEl); }
            metaEl.textContent = meta;
        }

        function applyDashboardKpis(metrics = {}) {
            injectSharedStyle();
            ['pcKpiSales', 'pcKpiDebt', 'pcKpiFactory', 'pcKpiPending'].forEach(markDashboardKpiCard);
            const totalOrderAmount = Number(metrics.totalOrderAmount) || 0;
            const paidAmount = Number(metrics.paidAmount) || 0;
            const debtAmount = Number(metrics.debtAmount) || 0;
            const activeProductionCount = Array.isArray(metrics.activeProductionItems) ? metrics.activeProductionItems.length : 0;
            const pendingCount = Array.isArray(window.filteredOrders) ? window.filteredOrders.filter(o => o.status === 'pending').length : 0;
            const collectionRate = totalOrderAmount > 0 ? Math.round((paidAmount / totalOrderAmount) * 100) : 0;
            const debtCount = Array.isArray(metrics.debtItems) ? metrics.debtItems.length : 0;

            setCardLabel('pcKpiSales', 'Sales');
            setText('pcKpiSales', dashboardKrwShort(totalOrderAmount));
            setCardMeta('pcKpiSales', `수주 ${metrics.totalCount || 0}건`);

            setCardLabel('pcKpiDebt', 'AR');
            setText('pcKpiDebt', dashboardKrwShort(debtAmount));
            setCardMeta('pcKpiDebt', `미수 ${debtCount}건 · 장기 ${Array.isArray(metrics.overdueItems) ? metrics.overdueItems.length : 0}건`);

            setCardLabel('pcKpiFactory', 'Production');
            setText('pcKpiFactory', `${activeProductionCount}건`);
            setCardMeta('pcKpiFactory', `리드타임 ${metrics.avgLeadTime || '0.0'}일`);

            setCardLabel('pcKpiPending', 'Finance');
            setText('pcKpiPending', `${pendingCount}건`);
            setCardMeta('pcKpiPending', `수금률 ${collectionRate}% · 입금 ${dashboardKrwShort(paidAmount)}`);
            applyCommonKpiLayout();
        }

        function patchDashboard() {
            if (typeof window.updatePCSubDashboards !== 'function') return false;
            if (window.updatePCSubDashboards.__WORK22_5A_PATCHED__) return true;
            const originalUpdatePCSubDashboards = window.updatePCSubDashboards;
            window.updatePCSubDashboards = function patchedUpdatePCSubDashboards() {
                originalUpdatePCSubDashboards();
                try {
                    const source = Array.isArray(window.filteredOrders) ? window.filteredOrders : [];
                    const metrics = typeof window.getPCDashboardMetrics === 'function' ? window.getPCDashboardMetrics(source) : {};
                    applyDashboardKpis(metrics);
                } catch (error) {
                    console.error('작업22-5A Dashboard 통합 지표 갱신 실패:', error);
                }
            };
            window.updatePCSubDashboards.__WORK22_5A_PATCHED__ = true;
            console.log('✅ 작업22-5A-3 PC KPI 카드 공통 overflow 보정 패치 완료');
            return true;
        }

        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            applyCommonKpiLayout();
            patchCommonUiText();
            if (patchDashboard() || attempts >= 80) clearInterval(timer);
        }, 250);
    })();
})();
