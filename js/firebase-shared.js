// ═══════════════════════════════════════════════════════
// 🔥 firebase-shared.js
// 목적: Firebase 초기화 & 공용 함수 모음
// 모바일/PC 양쪽 모두 로드됨
// ═══════════════════════════════════════════════════════

// 1️⃣ Firebase 설정 (변경 금지)
const firebaseConfig = {
    apiKey: "AIzaSyDGdi03xiK44WzrK8082VjUPsIujQmN7_A",
    authDomain: "yongjin-enterprise.firebaseapp.com",
    projectId: "yongjin-enterprise",
    storageBucket: "yongjin-enterprise.firebasestorage.app",
    messagingSenderId: "364016255378",
    appId: "1:364016255378:web:387f6145265e0a567d814b"
};

// 2️⃣ Firebase 초기화
let db = null;
let auth = null;

function initializeFirebase() {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    auth = firebase.auth();
    
    // 🚀 [핵심 수정 사항]: index.html이 통신망을 사용할 수 있도록 전역 개방
    window.db = db;
    window.auth = auth;
    
    console.log('✅ Firebase 초기화 완료 (전역 공유됨)');
}

// 3️⃣ 익명 로그인
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

// 4️⃣ 사용자 동기화 (참고용 - 실제 화면 그리기는 index.html의 syncUsers가 담당)
let USERS = [];

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

        console.log('✅ 사용자 목록 로드 (공용):', USERS.length + '명');
        
        // 🚀 [추가 조치]: 데이터를 불러온 후 전역 USERS 변수에도 할당
        window.USERS = USERS; 
        
        return USERS;
    } catch (e) {
        console.error('❌ 사용자 로드 실패:', e);
        return [];
    }
}

// 5️⃣ 내보내기
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
// 작업22-3D — PC Finance 생산 진행 확인 리스트 추가
// 목적: PC Finance 화면에서 생산 진행 중 주문을 읽기 전용으로 확인
// 원칙: Production/addProgress/Firebase lifecycle 로직은 변경하지 않음
// ═══════════════════════════════════════════════════════
(function installWork22_3DFinanceProductionPatch() {
    if (window.__WORK22_3D_FINANCE_PRODUCTION_PATCH__) return;
    window.__WORK22_3D_FINANCE_PRODUCTION_PATCH__ = true;

    function getPercent(done, total) {
        if (typeof window.safePercent === 'function') {
            return window.safePercent(done, total);
        }

        const totalNumber = Number(total) || 0;
        if (totalNumber <= 0) return 0;
        return Math.min(100, Math.round(((Number(done) || 0) / totalNumber) * 100));
    }

    function injectFinanceProductionSection() {
        if (document.getElementById('pcFinanceProductionProgressBody')) return;

        const invoiceBody = document.getElementById('pcFinanceInvoiceWaitBody');
        if (!invoiceBody) return;

        const invoiceTable = invoiceBody.closest('table');
        const invoiceWrapper = invoiceTable && invoiceTable.parentElement && invoiceTable.parentElement.parentElement;
        if (!invoiceWrapper) return;

        invoiceWrapper.insertAdjacentHTML('beforebegin', `
            <div id="pcFinanceProductionProgressSection" class="bg-[#1e293b] border border-[#334155] rounded-2xl shadow-xl overflow-hidden mb-8">
                <div class="p-5 border-b border-[#334155] bg-[#111827] flex justify-between items-center">
                    <div>
                        <h3 class="text-sm font-bold text-white uppercase tracking-widest">🏭 PC 생산 진행 확인 리스트</h3>
                        <p class="text-[10px] text-slate-500 font-bold mt-1">
                            승인 완료 후 생산 진행률 확인이 필요한 주문
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span id="pcFinanceProductionProgressMeta" class="text-[11px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-3 py-1.5 rounded-lg">
                            0건
                        </span>
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-[11px] text-slate-300">
                        <thead class="bg-[#0f1522] text-slate-500 font-bold border-b border-[#334155]">
                            <tr>
                                <th class="px-4 py-3">납기일</th>
                                <th class="px-4 py-3">거래처명</th>
                                <th class="px-4 py-3">자재 / 수량</th>
                                <th class="px-4 py-3">생산 진행</th>
                                <th class="px-4 py-3 text-center">상태</th>
                            </tr>
                        </thead>
                        <tbody id="pcFinanceProductionProgressBody" class="divide-y divide-[#334155]/50">
                            <tr>
                                <td colspan="5" class="px-4 py-8 text-center text-slate-500 font-bold">
                                    생산 진행 데이터가 없습니다.
                                </td>
                            </tr>
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

        const items = Array.isArray(metrics.activeProductionItems)
            ? [...metrics.activeProductionItems]
            : [];

        items.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));

        if (meta) {
            meta.textContent = `${items.length}건`;
        }

        tbody.innerHTML = items.map(o => {
            const qty = Number(o.qty) || 0;
            const completedQty = Number(o.completedQty) || 0;
            const pct = getPercent(completedQty, qty);
            const remainQty = Math.max(0, qty - completedQty);

            const statusBadge = pct >= 100
                ? `<span class="bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-1 rounded text-[10px] font-black">생산완료 대기</span>`
                : `<span class="bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-1 rounded text-[10px] font-black">생산중</span>`;

            return `
                <tr class="hover:bg-orange-500/5 transition-colors">
                    <td class="px-4 py-3 text-slate-400">${o.dueDate || '-'}</td>
                    <td class="px-4 py-3 font-bold text-white">${o.client || '-'}</td>
                    <td class="px-4 py-3 text-slate-400">
                        ${o.material || '-'}<br>
                        <span class="text-white font-bold">${qty.toLocaleString()}장</span>
                    </td>
                    <td class="px-4 py-3 min-w-[220px]">
                        <div class="flex justify-between text-[10px] font-bold mb-1">
                            <span class="text-slate-400">${completedQty.toLocaleString()} / ${qty.toLocaleString()}장</span>
                            <span class="text-orange-400">${pct}%</span>
                        </div>
                        <div class="w-full bg-[#0f1522] h-2.5 rounded-full overflow-hidden border border-[#334155]">
                            <div class="bg-orange-500 h-full rounded-full transition-all duration-1000 ease-out" style="width: ${pct}%"></div>
                        </div>
                        <div class="mt-1 text-[10px] text-slate-500 font-bold">
                            잔여 ${remainQty.toLocaleString()}장
                        </div>
                    </td>
                    <td class="px-4 py-3 text-center">${statusBadge}</td>
                </tr>
            `;
        }).join('') || `
            <tr>
                <td colspan="5" class="px-4 py-8 text-center text-slate-500 font-bold">
                    생산 진행 데이터가 없습니다.
                </td>
            </tr>
        `;
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
        if (patchFinanceCards() || patchAttempts >= 80) {
            clearInterval(patchTimer);
        }
    }, 250);
})();
