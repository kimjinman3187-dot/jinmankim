// ═══════════════════════════════════════════════════════
// 🔥 firebase-shared.js
// 목적: Firebase 초기화 & 공용 함수 모음
// 모바일/PC 양쪽 모두 로드됨
// ═══════════════════════════════════════════════════════

const firebaseConfig = {
    apiKey: 'AIzaSyDGdi03xiK44WzrK8082VjUPsIujQmN7_A',
    authDomain: 'yongjin-enterprise.firebaseapp.com',
    projectId: 'yongjin-enterprise',
    storageBucket: 'yongjin-enterprise.firebasestorage.app',
    messagingSenderId: '364016255378',
    appId: '1:364016255378:web:387f6145265e0a567d814b'
};

let db = null;
let auth = null;
let USERS = [];

function initializeFirebase() {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    window.db = db;
    window.auth = auth;
    console.log('✅ Firebase 초기화 완료 (전역 공유됨)');
}

async function signInAnonymously() {
    try {
        await auth.signInAnonymously();
        console.log('✅ 익명 인증 완료');
        return true;
    } catch (e) {
        console.error('❌ 인증 실패:', e);
        return false;
    }
}

async function syncUsers() {
    try {
        const snapshot = await db.collection('users')
            .where('status', '==', 'active')
            .orderBy('sort_index', 'asc')
            .get();

        USERS = snapshot.docs.map(doc => {
            const d = doc.data();
            if (d.role === 'ccounting') d.role = 'accounting';
            return { id: doc.id, ...d };
        });

        window.USERS = USERS;
        console.log('✅ 사용자 목록 로드 (공용):', USERS.length + '명');
        return USERS;
    } catch (e) {
        console.error('❌ 사용자 로드 실패:', e);
        return [];
    }
}

window.FirebaseShared = {
    initializeFirebase,
    signInAnonymously,
    syncUsers,
    getDB: () => db,
    getAuth: () => auth,
    getUsers: () => USERS
};

console.log('📦 firebase-shared.js 로드 완료');

// ═══════════════════════════════════════════════════════
// 공통 유틸
// ═══════════════════════════════════════════════════════
(function installFinancePatchUtilities() {
    if (window.__YJ_FINANCE_PATCH_UTILS__) return;
    window.__YJ_FINANCE_PATCH_UTILS__ = true;

    window.yjGetAmount = function yjGetAmount(order = {}) {
        if (typeof window.getOrderAmount === 'function') return window.getOrderAmount(order);
        return (Number(order.price) || 0) * (Number(order.qty) || 0);
    };

    window.yjGetPaid = function yjGetPaid(order = {}) {
        if (typeof window.getPaidAmount === 'function') return window.getPaidAmount(order);
        return Number(order.paidAmount) || 0;
    };

    window.yjFormatKRW = function yjFormatKRW(value) {
        if (typeof window.formatKRW === 'function') return window.formatKRW(value);
        return `₩ ${Math.round(Number(value) || 0).toLocaleString()}`;
    };

    window.yjSafePercent = function yjSafePercent(done, total) {
        if (typeof window.safePercent === 'function') return window.safePercent(done, total);
        const totalNumber = Number(total) || 0;
        if (totalNumber <= 0) return 0;
        return Math.min(100, Math.round(((Number(done) || 0) / totalNumber) * 100));
    };

    window.yjIsInvoiceIssued = function yjIsInvoiceIssued(order = {}) {
        if (typeof window.isInvoiceIssued === 'function') return window.isInvoiceIssued(order);
        return order.invoiceStatus === 'issued' || !!order.invoiceIssuedAt;
    };

    window.yjDateText = function yjDateText(value) {
        if (!value) return '-';
        try {
            if (value.toDate && typeof value.toDate === 'function') {
                return value.toDate().toISOString().slice(0, 10);
            }
            if (typeof value === 'number') {
                return new Date(value).toISOString().slice(0, 10);
            }
            return String(value).slice(0, 10);
        } catch (e) {
            return String(value || '-');
        }
    };

    window.yjPatchFooterVersion = function yjPatchFooterVersion() {
        const PATCH_VERSION = 'V2.0.2';
        const PATCH_DATE = '26.05.26';

        document.querySelectorAll('.system-footer p').forEach(p => {
            const text = (p.textContent || '').toLowerCase();
            if (text.includes('last updated')) p.textContent = `LAST UPDATED: ${PATCH_DATE}`;
            if (text.includes('yj flow')) p.textContent = `YJ FLOW ${PATCH_VERSION}`;
        });

        const appPC = document.getElementById('appPC');
        if (appPC) {
            appPC.querySelectorAll('aside p').forEach(p => {
                const text = (p.textContent || '').toLowerCase();
                if (text.includes('last updated')) p.textContent = `LAST UPDATED: ${PATCH_DATE}`;
                if (text.includes('yj flow')) p.textContent = `YJ FLOW ${PATCH_VERSION}`;
            });
        }
    };
})();

// ═══════════════════════════════════════════════════════
// 작업22-3D — PC Finance 생산 진행 확인 리스트 추가
// ═══════════════════════════════════════════════════════
(function installWork22_3DFinanceProductionPatch() {
    if (window.__WORK22_3D_FINANCE_PRODUCTION_PATCH__) return;
    window.__WORK22_3D_FINANCE_PRODUCTION_PATCH__ = true;

    function injectFinanceProductionSection() {
        if (document.getElementById('pcFinanceProductionProgressBody')) return;
        const invoiceBody = document.getElementById('pcFinanceInvoiceWaitBody');
        if (!invoiceBody) return;
        const invoiceTable = invoiceBody.closest('table');
        const invoiceWrapper = invoiceTable && invoiceTable.parentElement && invoiceTable.parentElement.parentElement;
        if (!invoiceWrapper) return;

        invoiceWrapper.insertAdjacentHTML('beforebegin', `
            <div id='pcFinanceProductionProgressSection' class='bg-[#1e293b] border border-[#334155] rounded-2xl shadow-xl overflow-hidden mb-8'>
                <div class='p-5 border-b border-[#334155] bg-[#111827] flex justify-between items-center'>
                    <div>
                        <h3 class='text-sm font-bold text-white uppercase tracking-widest'>🏭 PC 생산 진행 확인 리스트</h3>
                        <p class='text-[10px] text-slate-500 font-bold mt-1'>승인 완료 후 생산 진행률 확인이 필요한 주문</p>
                    </div>
                    <span id='pcFinanceProductionProgressMeta' class='text-[11px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-3 py-1.5 rounded-lg'>0건</span>
                </div>
                <div class='overflow-x-auto'>
                    <table class='w-full text-left text-[11px] text-slate-300'>
                        <thead class='bg-[#0f1522] text-slate-500 font-bold border-b border-[#334155]'>
                            <tr>
                                <th class='px-4 py-3'>납기일</th>
                                <th class='px-4 py-3'>거래처명</th>
                                <th class='px-4 py-3'>자재 / 수량</th>
                                <th class='px-4 py-3'>생산 진행</th>
                                <th class='px-4 py-3 text-center'>상태</th>
                            </tr>
                        </thead>
                        <tbody id='pcFinanceProductionProgressBody' class='divide-y divide-[#334155]/50'>
                            <tr><td colspan='5' class='px-4 py-8 text-center text-slate-500 font-bold'>생산 진행 데이터가 없습니다.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `);
    }

    window.updatePCFinanceProductionProgressList = function updatePCFinanceProductionProgressList(metrics = {}) {
        injectFinanceProductionSection();
        const tbody = document.getElementById('pcFinanceProductionProgressBody');
        const meta = document.getElementById('pcFinanceProductionProgressMeta');
        if (!tbody) return;

        const items = Array.isArray(metrics.activeProductionItems) ? [...metrics.activeProductionItems] : [];
        items.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
        if (meta) meta.textContent = `${items.length}건`;

        tbody.innerHTML = items.map(o => {
            const qty = Number(o.qty) || 0;
            const completedQty = Number(o.completedQty) || 0;
            const pct = window.yjSafePercent(completedQty, qty);
            const remainQty = Math.max(0, qty - completedQty);
            const statusBadge = pct >= 100
                ? `<span class='bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-1 rounded text-[10px] font-black'>생산완료 대기</span>`
                : `<span class='bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-1 rounded text-[10px] font-black'>생산중</span>`;
            return `
                <tr class='hover:bg-orange-500/5 transition-colors'>
                    <td class='px-4 py-3 text-slate-400'>${o.dueDate || '-'}</td>
                    <td class='px-4 py-3 font-bold text-white'>${o.client || '-'}</td>
                    <td class='px-4 py-3 text-slate-400'>${o.material || '-'}<br><span class='text-white font-bold'>${qty.toLocaleString()}장</span></td>
                    <td class='px-4 py-3 min-w-[220px]'>
                        <div class='flex justify-between text-[10px] font-bold mb-1'><span class='text-slate-400'>${completedQty.toLocaleString()} / ${qty.toLocaleString()}장</span><span class='text-orange-400'>${pct}%</span></div>
                        <div class='w-full bg-[#0f1522] h-2.5 rounded-full overflow-hidden border border-[#334155]'><div class='bg-orange-500 h-full rounded-full transition-all duration-1000 ease-out' style='width: ${pct}%'></div></div>
                        <div class='mt-1 text-[10px] text-slate-500 font-bold'>잔여 ${remainQty.toLocaleString()}장</div>
                    </td>
                    <td class='px-4 py-3 text-center'>${statusBadge}</td>
                </tr>`;
        }).join('') || `<tr><td colspan='5' class='px-4 py-8 text-center text-slate-500 font-bold'>생산 진행 데이터가 없습니다.</td></tr>`;
    };

    function patchFinanceCards() {
        if (typeof window.updatePCFinanceCards !== 'function') return false;
        if (window.updatePCFinanceCards.__WORK22_3D_PATCHED__) return true;
        const originalUpdatePCFinanceCards = window.updatePCFinanceCards;
        window.updatePCFinanceCards = function patchedUpdatePCFinanceCards(metrics) {
            originalUpdatePCFinanceCards(metrics);
            window.updatePCFinanceProductionProgressList(metrics);
        };
        window.updatePCFinanceCards.__WORK22_3D_PATCHED__ = true;
        console.log('✅ 작업22-3D PC Finance 생산 진행 확인 리스트 패치 완료');
        return true;
    }

    let patchAttempts = 0;
    const patchTimer = setInterval(() => {
        patchAttempts += 1;
        if (patchFinanceCards() || patchAttempts >= 80) clearInterval(patchTimer);
    }, 250);
})();

// ═══════════════════════════════════════════════════════
// 작업22-3E — PC Finance 신규 승인 대기 리스트 추가
// ═══════════════════════════════════════════════════════
(function installWork22_3EFinanceApprovalPatch() {
    if (window.__WORK22_3E_FINANCE_APPROVAL_PATCH__) return;
    window.__WORK22_3E_FINANCE_APPROVAL_PATCH__ = true;

    let pendingOrdersUnsubscribe = null;
    let pendingOrdersCache = [];

    function injectFinanceApprovalSection() {
        if (document.getElementById('pcFinanceApprovalWaitBody')) return;
        const productionSection = document.getElementById('pcFinanceProductionProgressSection');
        const invoiceBody = document.getElementById('pcFinanceInvoiceWaitBody');
        const invoiceTable = invoiceBody && invoiceBody.closest('table');
        const invoiceWrapper = invoiceTable && invoiceTable.parentElement && invoiceTable.parentElement.parentElement;
        const anchor = productionSection || invoiceWrapper;
        if (!anchor) return;

        anchor.insertAdjacentHTML('beforebegin', `
            <div id='pcFinanceApprovalWaitSection' class='bg-[#1e293b] border border-[#334155] rounded-2xl shadow-xl overflow-hidden mb-8'>
                <div class='p-5 border-b border-[#334155] bg-[#111827] flex justify-between items-center'>
                    <div>
                        <h3 class='text-sm font-bold text-white uppercase tracking-widest'>📝 PC 신규 승인 대기 리스트</h3>
                        <p class='text-[10px] text-slate-500 font-bold mt-1'>영업 접수 후 회계 승인 또는 반려 처리가 필요한 주문</p>
                    </div>
                    <span id='pcFinanceApprovalWaitMeta' class='text-[11px] font-black text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-lg'>0건</span>
                </div>
                <div class='overflow-x-auto'>
                    <table class='w-full text-left text-[11px] text-slate-300'>
                        <thead class='bg-[#0f1522] text-slate-500 font-bold border-b border-[#334155]'>
                            <tr>
                                <th class='px-4 py-3'>납기일</th>
                                <th class='px-4 py-3'>거래처명</th>
                                <th class='px-4 py-3'>자재 / 수량</th>
                                <th class='px-4 py-3 text-right'>예상 금액</th>
                                <th class='px-4 py-3 text-center'>상태</th>
                                <th class='px-4 py-3 text-center'>처리</th>
                            </tr>
                        </thead>
                        <tbody id='pcFinanceApprovalWaitBody' class='divide-y divide-[#334155]/50'>
                            <tr><td colspan='6' class='px-4 py-8 text-center text-slate-500 font-bold'>신규 승인 대기 데이터가 없습니다.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `);
    }

    function renderFinanceApprovalWaitList() {
        injectFinanceApprovalSection();
        const tbody = document.getElementById('pcFinanceApprovalWaitBody');
        const meta = document.getElementById('pcFinanceApprovalWaitMeta');
        if (!tbody) return;

        const items = [...pendingOrdersCache].sort((a, b) => {
            const dueCompare = String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
            if (dueCompare !== 0) return dueCompare;
            return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        });
        if (meta) meta.textContent = `${items.length}건`;

        tbody.innerHTML = items.map(o => {
            const qty = Number(o.qty) || 0;
            const amount = window.yjGetAmount(o);
            const approveButton = typeof window.updateStatus === 'function'
                ? `<button onclick='updateStatus(\'${o.id}\', \'approved\')' class='min-w-[88px] h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-black whitespace-nowrap leading-none inline-flex items-center justify-center shadow-md transition-colors'>수주 승인</button>`
                : `<button disabled class='min-w-[88px] h-10 px-4 rounded-xl bg-slate-700 text-slate-400 text-[12px] font-black whitespace-nowrap leading-none inline-flex items-center justify-center cursor-not-allowed'>승인 불가</button>`;
            const rejectButton = typeof window.rejectOrder === 'function'
                ? `<button onclick='rejectOrder(\'${o.id}\')' class='min-w-[64px] h-10 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-[12px] font-black whitespace-nowrap leading-none inline-flex items-center justify-center transition-colors'>반려</button>`
                : '';
            return `
                <tr class='hover:bg-cyan-500/5 transition-colors'>
                    <td class='px-4 py-3 text-slate-400'>${o.dueDate || '-'}</td>
                    <td class='px-4 py-3 font-bold text-white'>${o.client || '-'}</td>
                    <td class='px-4 py-3 text-slate-400'>${o.material || '-'}<br><span class='text-white font-bold'>${qty.toLocaleString()}장</span></td>
                    <td class='px-4 py-3 text-right font-black text-cyan-400'>${window.yjFormatKRW(amount)}</td>
                    <td class='px-4 py-3 text-center'><span class='bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-1 rounded text-[10px] font-black whitespace-nowrap'>승인대기</span></td>
                    <td class='px-4 py-3 text-center'><div class='flex justify-center items-center gap-2 whitespace-nowrap'>${rejectButton}${approveButton}</div></td>
                </tr>`;
        }).join('') || `<tr><td colspan='6' class='px-4 py-8 text-center text-slate-500 font-bold'>신규 승인 대기 데이터가 없습니다.</td></tr>`;
    }

    function startPendingOrdersListener() {
        if (pendingOrdersUnsubscribe || !window.db) return;
        try {
            pendingOrdersUnsubscribe = window.db.collection('orders')
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .limit(100)
                .onSnapshot(snapshot => {
                    pendingOrdersCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    renderFinanceApprovalWaitList();
                }, error => console.error('작업22-3E 신규 승인 대기 리스트 로드 실패:', error));
        } catch (error) {
            console.error('작업22-3E 신규 승인 대기 리스너 시작 실패:', error);
        }
    }

    function waitAndInstall() {
        injectFinanceApprovalSection();
        startPendingOrdersListener();
    }

    let patchAttempts = 0;
    const patchTimer = setInterval(() => {
        patchAttempts += 1;
        waitAndInstall();
        if (document.getElementById('pcFinanceApprovalWaitBody') && window.db) {
            console.log('✅ 작업22-3E PC Finance 신규 승인 대기 리스트 패치 완료');
            clearInterval(patchTimer);
        }
        if (patchAttempts >= 80) clearInterval(patchTimer);
    }, 250);
})();

// ═══════════════════════════════════════════════════════
// 작업22-3E-1 — 신규 승인 UI 보정 + 패치 버전/일자 반영
// ═══════════════════════════════════════════════════════
(function installWork22_3E1UIPatch() {
    if (window.__WORK22_3E1_UI_PATCH__) return;
    window.__WORK22_3E1_UI_PATCH__ = true;

    function injectUIPatchStyle() {
        if (document.getElementById('work22-3e1-ui-style')) return;
        const style = document.createElement('style');
        style.id = 'work22-3e1-ui-style';
        style.textContent = `
            #pcFinanceApprovalWaitSection button {
                white-space: nowrap !important;
                line-height: 1 !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                word-break: keep-all !important;
            }
            #pcFinanceApprovalWaitSection td:last-child > div {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 0.5rem !important;
                white-space: nowrap !important;
            }
            @media (max-width: 768px) {
                .mobile-ui .system-footer {
                    text-align: center !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                }
                .mobile-ui .system-footer p {
                    text-align: center !important;
                    width: 100% !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function normalizeApprovalButtons() {
        const section = document.getElementById('pcFinanceApprovalWaitSection');
        if (!section) return;
        section.querySelectorAll('button').forEach(button => {
            button.style.whiteSpace = 'nowrap';
            button.style.wordBreak = 'keep-all';
            button.style.lineHeight = '1';
            button.style.display = 'inline-flex';
            button.style.alignItems = 'center';
            button.style.justifyContent = 'center';
        });
    }

    let patchAttempts = 0;
    const patchTimer = setInterval(() => {
        patchAttempts += 1;
        injectUIPatchStyle();
        window.yjPatchFooterVersion();
        normalizeApprovalButtons();
        if (patchAttempts >= 80) clearInterval(patchTimer);
    }, 250);

    console.log('✅ 작업22-3E-1 신규 승인 UI 보정 패치 완료');
    console.log('📌 PATCH VERSION: v2.0.2 / PATCH DATE: 2026-05-26');
})();

// ═══════════════════════════════════════════════════════
// 작업22-3F — PC Finance 수금 대기 리스트 추가
// ═══════════════════════════════════════════════════════
(function installWork22_3FFinanceCollectionPatch() {
    if (window.__WORK22_3F_FINANCE_COLLECTION_PATCH__) return;
    window.__WORK22_3F_FINANCE_COLLECTION_PATCH__ = true;

    let collectionOrdersUnsubscribe = null;
    let collectionOrdersCache = [];

    function injectCollectionSection() {
        if (document.getElementById('pcFinanceCollectionWaitBody')) return;
        const invoiceBody = document.getElementById('pcFinanceInvoiceWaitBody');
        const invoiceTable = invoiceBody && invoiceBody.closest('table');
        const invoiceWrapper = invoiceTable && invoiceTable.parentElement && invoiceTable.parentElement.parentElement;
        if (!invoiceWrapper) return;

        invoiceWrapper.insertAdjacentHTML('afterend', `
            <div id='pcFinanceCollectionWaitSection' class='bg-[#1e293b] border border-[#334155] rounded-2xl shadow-xl overflow-hidden mt-8 mb-8'>
                <div class='p-5 border-b border-[#334155] bg-[#111827] flex justify-between items-center'>
                    <div>
                        <h3 class='text-sm font-bold text-white uppercase tracking-widest'>💰 PC 수금 대기 리스트</h3>
                        <p class='text-[10px] text-slate-500 font-bold mt-1'>계산서 발행 후 입금 등록 또는 잔금 관리가 필요한 주문</p>
                    </div>
                    <span id='pcFinanceCollectionWaitMeta' class='text-[11px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg'>0건</span>
                </div>
                <div class='overflow-x-auto'>
                    <table class='w-full text-left text-[11px] text-slate-300'>
                        <thead class='bg-[#0f1522] text-slate-500 font-bold border-b border-[#334155]'>
                            <tr>
                                <th class='px-4 py-3'>입금기한</th>
                                <th class='px-4 py-3'>거래처명</th>
                                <th class='px-4 py-3'>자재 / 수량</th>
                                <th class='px-4 py-3 text-right'>청구액</th>
                                <th class='px-4 py-3 text-right'>입금 / 잔금</th>
                                <th class='px-4 py-3 text-center'>처리</th>
                            </tr>
                        </thead>
                        <tbody id='pcFinanceCollectionWaitBody' class='divide-y divide-[#334155]/50'>
                            <tr><td colspan='6' class='px-4 py-8 text-center text-slate-500 font-bold'>수금 대기 데이터가 없습니다.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `);
    }

    function renderCollectionWaitList() {
        injectCollectionSection();
        window.yjPatchFooterVersion();
        const tbody = document.getElementById('pcFinanceCollectionWaitBody');
        const meta = document.getElementById('pcFinanceCollectionWaitMeta');
        if (!tbody) return;

        const items = collectionOrdersCache
            .filter(o => window.yjIsInvoiceIssued(o) && o.paymentStatus !== 'paid')
            .map(o => {
                const total = window.yjGetAmount(o);
                const paid = window.yjGetPaid(o);
                return { o, total, paid, remaining: Math.max(0, total - paid) };
            })
            .filter(item => item.remaining > 0)
            .sort((a, b) => String(a.o.payDate || a.o.dueDate || '').localeCompare(String(b.o.payDate || b.o.dueDate || '')));

        if (meta) meta.textContent = `${items.length}건`;

        tbody.innerHTML = items.map(item => {
            const o = item.o;
            const qty = Number(o.qty) || 0;
            const pct = item.total > 0 ? Math.min(100, Math.round((item.paid / item.total) * 100)) : 0;
            const paymentButton = typeof window.confirmPayment === 'function'
                ? `<button onclick='confirmPayment(\'${o.id}\')' class='min-w-[88px] h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-[12px] font-black whitespace-nowrap leading-none inline-flex items-center justify-center shadow-md transition-colors'>입금 등록</button>`
                : `<button disabled class='min-w-[88px] h-10 px-4 rounded-xl bg-slate-700 text-slate-400 text-[12px] font-black whitespace-nowrap leading-none inline-flex items-center justify-center cursor-not-allowed'>처리 불가</button>`;
            return `
                <tr class='hover:bg-amber-500/5 transition-colors'>
                    <td class='px-4 py-3 text-slate-400'>${o.payDate || o.dueDate || '-'}</td>
                    <td class='px-4 py-3 font-bold text-white'>${o.client || '-'}</td>
                    <td class='px-4 py-3 text-slate-400'>${o.material || '-'}<br><span class='text-white font-bold'>${qty.toLocaleString()}장</span></td>
                    <td class='px-4 py-3 text-right font-black text-blue-400'>${window.yjFormatKRW(item.total)}</td>
                    <td class='px-4 py-3 min-w-[190px]'>
                        <div class='flex justify-between text-[10px] font-bold mb-1'><span class='text-slate-400'>${window.yjFormatKRW(item.paid)}</span><span class='text-amber-400'>잔금 ${window.yjFormatKRW(item.remaining)}</span></div>
                        <div class='w-full bg-[#0f1522] h-2.5 rounded-full overflow-hidden border border-[#334155]'><div class='bg-amber-500 h-full rounded-full transition-all duration-1000 ease-out' style='width: ${pct}%'></div></div>
                    </td>
                    <td class='px-4 py-3 text-center'>${paymentButton}</td>
                </tr>`;
        }).join('') || `<tr><td colspan='6' class='px-4 py-8 text-center text-slate-500 font-bold'>수금 대기 데이터가 없습니다.</td></tr>`;
    }

    function startCollectionOrdersListener() {
        if (collectionOrdersUnsubscribe || !window.db) return;
        try {
            collectionOrdersUnsubscribe = window.db.collection('orders')
                .where('status', 'in', ['approved', 'completed'])
                .orderBy('createdAt', 'desc')
                .limit(150)
                .onSnapshot(snapshot => {
                    collectionOrdersCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    renderCollectionWaitList();
                }, error => console.error('작업22-3F 수금 대기 리스트 로드 실패:', error));
        } catch (error) {
            console.error('작업22-3F 수금 대기 리스너 시작 실패:', error);
        }
    }

    function install() {
        injectCollectionSection();
        window.yjPatchFooterVersion();
        startCollectionOrdersListener();
        renderCollectionWaitList();
    }

    let patchAttempts = 0;
    const patchTimer = setInterval(() => {
        patchAttempts += 1;
        install();
        if (document.getElementById('pcFinanceCollectionWaitBody') && window.db) {
            console.log('✅ 작업22-3F PC Finance 수금 대기 리스트 패치 완료');
            clearInterval(patchTimer);
        }
        if (patchAttempts >= 80) clearInterval(patchTimer);
    }, 250);
})();

// ═══════════════════════════════════════════════════════
// 작업22-3G — PC Finance 완료 거래 리스트 추가
// 목적: 입금 완료된 주문을 Finance 화면에서 읽기 전용 완료 거래로 분리 표시
// 원칙: confirmPayment/paymentStatus/status/completedAt/issueInvoice 로직 변경 금지
// ═══════════════════════════════════════════════════════
(function installWork22_3GFinanceCompletedPatch() {
    if (window.__WORK22_3G_FINANCE_COMPLETED_PATCH__) return;
    window.__WORK22_3G_FINANCE_COMPLETED_PATCH__ = true;

    let completedOrdersUnsubscribe = null;
    let completedOrdersCache = [];

    function injectCompletedSection() {
        if (document.getElementById('pcFinanceCompletedBody')) return;

        const collectionSection = document.getElementById('pcFinanceCollectionWaitSection');
        const invoiceBody = document.getElementById('pcFinanceInvoiceWaitBody');
        const invoiceTable = invoiceBody && invoiceBody.closest('table');
        const invoiceWrapper = invoiceTable && invoiceTable.parentElement && invoiceTable.parentElement.parentElement;
        const anchor = collectionSection || invoiceWrapper;
        if (!anchor) return;

        anchor.insertAdjacentHTML('afterend', `
            <div id='pcFinanceCompletedSection' class='bg-[#1e293b] border border-[#334155] rounded-2xl shadow-xl overflow-hidden mt-8 mb-8'>
                <div class='p-5 border-b border-[#334155] bg-[#111827] flex justify-between items-center'>
                    <div>
                        <h3 class='text-sm font-bold text-white uppercase tracking-widest'>✅ PC 완료 거래 리스트</h3>
                        <p class='text-[10px] text-slate-500 font-bold mt-1'>입금 완료되어 거래 종료 상태로 분리된 주문</p>
                    </div>
                    <span id='pcFinanceCompletedMeta' class='text-[11px] font-black text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-lg'>0건</span>
                </div>
                <div class='overflow-x-auto'>
                    <table class='w-full text-left text-[11px] text-slate-300'>
                        <thead class='bg-[#0f1522] text-slate-500 font-bold border-b border-[#334155]'>
                            <tr>
                                <th class='px-4 py-3'>입금완료일</th>
                                <th class='px-4 py-3'>거래처명</th>
                                <th class='px-4 py-3'>자재 / 수량</th>
                                <th class='px-4 py-3 text-right'>청구액</th>
                                <th class='px-4 py-3 text-right'>입금액</th>
                                <th class='px-4 py-3 text-center'>상태</th>
                            </tr>
                        </thead>
                        <tbody id='pcFinanceCompletedBody' class='divide-y divide-[#334155]/50'>
                            <tr><td colspan='6' class='px-4 py-8 text-center text-slate-500 font-bold'>완료 거래 데이터가 없습니다.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `);
    }

    function renderCompletedList() {
        injectCompletedSection();
        window.yjPatchFooterVersion();

        const tbody = document.getElementById('pcFinanceCompletedBody');
        const meta = document.getElementById('pcFinanceCompletedMeta');
        if (!tbody) return;

        const items = [...completedOrdersCache]
            .filter(o => o.paymentStatus === 'paid')
            .sort((a, b) => {
                const aDate = a.paymentConfirmedAt || a.paidAt || a.updatedAt || a.payDate || a.dueDate || '';
                const bDate = b.paymentConfirmedAt || b.paidAt || b.updatedAt || b.payDate || b.dueDate || '';
                return String(bDate).localeCompare(String(aDate));
            })
            .slice(0, 30);

        if (meta) meta.textContent = `${items.length}건`;

        tbody.innerHTML = items.map(o => {
            const qty = Number(o.qty) || 0;
            const total = window.yjGetAmount(o);
            const paid = window.yjGetPaid(o) || total;
            const paidDate = window.yjDateText(o.paymentConfirmedAt || o.paidAt || o.updatedAt || o.payDate || o.dueDate);

            return `
                <tr class='hover:bg-green-500/5 transition-colors'>
                    <td class='px-4 py-3 text-slate-400'>${paidDate}</td>
                    <td class='px-4 py-3 font-bold text-white'>${o.client || '-'}</td>
                    <td class='px-4 py-3 text-slate-400'>${o.material || '-'}<br><span class='text-white font-bold'>${qty.toLocaleString()}장</span></td>
                    <td class='px-4 py-3 text-right font-black text-blue-400'>${window.yjFormatKRW(total)}</td>
                    <td class='px-4 py-3 text-right font-black text-green-400'>${window.yjFormatKRW(paid)}</td>
                    <td class='px-4 py-3 text-center'><span class='bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-1 rounded text-[10px] font-black whitespace-nowrap'>입금완료</span></td>
                </tr>`;
        }).join('') || `<tr><td colspan='6' class='px-4 py-8 text-center text-slate-500 font-bold'>완료 거래 데이터가 없습니다.</td></tr>`;
    }

    function startCompletedOrdersListener() {
        if (completedOrdersUnsubscribe || !window.db) return;
        try {
            completedOrdersUnsubscribe = window.db.collection('orders')
                .where('paymentStatus', '==', 'paid')
                .limit(100)
                .onSnapshot(snapshot => {
                    completedOrdersCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    renderCompletedList();
                }, error => console.error('작업22-3G 완료 거래 리스트 로드 실패:', error));
        } catch (error) {
            console.error('작업22-3G 완료 거래 리스너 시작 실패:', error);
        }
    }

    function install() {
        injectCompletedSection();
        window.yjPatchFooterVersion();
        startCompletedOrdersListener();
        renderCompletedList();
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        install();
        if (document.getElementById('pcFinanceCompletedBody') && window.db) {
            console.log('✅ 작업22-3G PC Finance 완료 거래 리스트 패치 완료');
            clearInterval(timer);
        }
        if (attempts >= 80) clearInterval(timer);
    }, 250);
})();
