// 작업22-PAYMENT-HOTFIX — 모바일 입금액 초과 방지 및 입금일 표시 보정
(function installWork22PaymentHotfix() {
    if (window.__WORK22_PAYMENT_HOTFIX__) return;
    window.__WORK22_PAYMENT_HOTFIX__ = true;

    const parseStrictPaymentAmount = value => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(raw)) return null;
        const normalized = raw.replace(/,/g, '');
        if (!/^\d+$/.test(normalized)) return null;
        const amount = Number(normalized);
        if (!Number.isSafeInteger(amount) || amount <= 0) return null;
        return amount;
    };

    const getOrderTotal = order => {
        if (typeof window.getOrderAmount === 'function') return Number(window.getOrderAmount(order)) || 0;
        if (typeof window.yjGetAmount === 'function') return Number(window.yjGetAmount(order)) || 0;
        return (Number(order?.price) || 0) * (Number(order?.qty) || 0);
    };

    const getPaidAmount = order => Math.max(0, Number(order?.paidAmount) || 0);

    const formatKRW = value => {
        if (typeof window.formatKRW === 'function') return window.formatKRW(value);
        if (typeof window.yjFormatKRW === 'function') return window.yjFormatKRW(value);
        return `₩ ${(Number(value) || 0).toLocaleString()}`;
    };

    const dateText = value => {
        if (typeof window.yjDateText === 'function') return window.yjDateText(value);
        if (!value) return '-';
        try {
            if (value.toDate && typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
            if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
            return String(value).slice(0, 10);
        } catch (e) {
            return '-';
        }
    };

    const getSafeAuditUser = () => {
        let sessionUser = {};
        try {
            sessionUser = JSON.parse(sessionStorage.getItem('yongjin_session') || '{}') || {};
        } catch (e) {
            sessionUser = {};
        }

        const globalUser = window.currentUser || {};
        return {
            name: globalUser.name || sessionUser.name || 'SYSTEM',
            role: globalUser.role || sessionUser.role || 'system'
        };
    };

    function installLogActionGuard() {
        if (window.logAction?.__WORK22_CURRENT_USER_GUARD__) return true;
        if (typeof window.logAction !== 'function') return false;

        window.logAction = async function logActionGuarded(action, orderId, details) {
            try {
                if (typeof window.db === 'undefined') return;
                const safeUser = getSafeAuditUser();
                await window.db.collection('audit_logs').add({
                    action,
                    user: safeUser.name,
                    role: safeUser.role,
                    order_id: orderId,
                    details,
                    timestamp: Date.now()
                });
            } catch (e) {
                console.warn('Audit log failed:', e);
            }
        };

        window.logAction.__WORK22_CURRENT_USER_GUARD__ = true;
        console.log('✅ PAYMENT-HOTFIX-2D logAction currentUser guard installed');
        return true;
    }

    function renderPaymentDateBadges() {
        const source = Array.isArray(window.filteredOrders) ? window.filteredOrders : Array.isArray(window.orders) ? window.orders : [];
        source.forEach(order => {
            if (!order?.id) return;
            document.querySelectorAll(`[onclick*="confirmPayment('${order.id}')"], [data-yj-action='payment'][data-yj-id='${order.id}']`).forEach(button => {
                const card = button.closest('div.bg-white, div.bg-amber-50, div.border, tr');
                if (!card || card.querySelector('.yj-payment-date-meta')) return;
                const meta = document.createElement(card.tagName === 'TR' ? 'td' : 'div');
                meta.className = card.tagName === 'TR'
                    ? 'yj-payment-date-meta px-4 py-3 text-[10px] text-slate-400 leading-5'
                    : 'yj-payment-date-meta mt-3 p-3 rounded-xl border border-slate-100 bg-slate-50 text-[10px] font-bold text-slate-500 leading-5';
                meta.innerHTML = `
                    <div>입금기한: <span class="text-slate-700">${order.payDate || '-'}</span></div>
                    <div>최근입금일: <span class="text-blue-600">${dateText(order.lastPaymentAt)}</span></div>
                    <div>입금완료일: <span class="text-green-600">${dateText(order.paidAt)}</span></div>
                `;
                if (card.tagName === 'TR') {
                    const lastCell = card.querySelector('td:last-child');
                    if (lastCell) lastCell.insertAdjacentElement('beforebegin', meta);
                } else {
                    button.parentElement?.insertAdjacentElement('beforebegin', meta);
                }
            });
        });
    }

    function installConfirmPaymentOverride() {
        if (typeof window.confirmPayment !== 'function') return false;
        if (window.confirmPayment.__WORK22_PAYMENT_HOTFIX__) return true;

        window.confirmPayment = async function confirmPaymentHotfixed(id) {
            if (typeof window.db === 'undefined') {
                return alert('데이터베이스 연결이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.');
            }

            let o = null;
            try {
                const orderDoc = await window.db.collection('orders').doc(id).get();
                if (!orderDoc.exists) {
                    return alert('주문 데이터를 찾을 수 없습니다.');
                }
                o = { id: orderDoc.id, ...orderDoc.data() };
            } catch (e) {
                return alert('주문 데이터 조회 실패: ' + e.message);
            }

            const inputStr = prompt('입금된 금액을 입력하세요:\n(숫자 또는 쉼표만 입력 예: 10000 / 10,000)');
            if (inputStr === null) return;

            const amount = parseStrictPaymentAmount(inputStr);
            if (amount === null) {
                return alert('올바른 금액을 입력하세요. 숫자와 쉼표만 사용할 수 있으며 0원, 음수, 소수점, 문자는 허용되지 않습니다.');
            }

            const totalAmount = getOrderTotal(o);
            const paidBefore = getPaidAmount(o);
            const remainingBeforePayment = Math.max(0, totalAmount - paidBefore);

            if (totalAmount <= 0) {
                return alert('총 청구액을 확인할 수 없어 입금 처리할 수 없습니다.');
            }

            if (remainingBeforePayment <= 0 || o.paymentStatus === 'paid') {
                return alert('이미 입금 완료 처리된 주문입니다.');
            }

            if (amount > remainingBeforePayment) {
                return alert(`입금액이 남은 잔금을 초과했습니다.\n남은 잔금: ${formatKRW(remainingBeforePayment)}\n입력 금액: ${formatKRW(amount)}\n\n저장하지 않았습니다.`);
            }

            const newPaid = paidBefore + amount;
            const isFullyPaid = amount === remainingBeforePayment;
            const newStatus = isFullyPaid ? 'paid' : 'partial';
            const now = Date.now();

            const confirmMessage = isFullyPaid
                ? `총 청구액: ${formatKRW(totalAmount)}\n기존 입금액: ${formatKRW(paidBefore)}\n이번 입금액: ${formatKRW(amount)}\n\n입금완료 처리하시겠습니까?`
                : `총 청구액: ${formatKRW(totalAmount)}\n기존 입금액: ${formatKRW(paidBefore)}\n이번 입금액: ${formatKRW(amount)}\n남은 잔금: ${formatKRW(totalAmount - newPaid)}\n\n부분입금 처리하시겠습니까?`;

            if (!confirm(confirmMessage)) return;

            const updatePayload = {
                paidAmount: newPaid,
                paymentStatus: newStatus,
                lastPaymentAt: now,
                lastPaymentAmount: amount
            };

            if (isFullyPaid && !o.paidAt) {
                updatePayload.paidAt = now;
            }

            try {
                await window.db.collection('orders').doc(id).update(updatePayload);

                Object.assign(o, updatePayload);

                if (typeof window.logAction === 'function') {
                    await window.logAction('PAYMENT_UPDATED', id, {
                        added_amount: amount,
                        total_paid: newPaid,
                        paymentStatus: newStatus,
                        lastPaymentAt: now,
                        paidAt: updatePayload.paidAt || o.paidAt || null
                    });
                }

                if (typeof window.showToast === 'function') {
                    window.showToast('noti-accounting', '💵', isFullyPaid ? '입금 완료' : '부분입금 처리', `${o.client || '주문'} 입금이 반영되었습니다.`);
                } else {
                    alert(isFullyPaid ? '입금 완료 처리되었습니다.' : '부분입금 처리되었습니다.');
                }

                // PAYMENT-HOTFIX-2B: 입금 처리 후 생산공정 리스트가 사라지는 회귀를 막기 위해
                // 전체 검색/렌더링 체인(executeSearch/renderAccounting/renderReceivables)을 강제 호출하지 않는다.
                // Firestore onSnapshot 리스너가 데이터 변경을 감지해 기존 화면 흐름대로 갱신한다.
                setTimeout(renderPaymentDateBadges, 150);
            } catch (e) {
                alert('입금 처리 실패: ' + e.message);
            }
        };

        window.confirmPayment.__WORK22_PAYMENT_HOTFIX__ = true;
        console.log('✅ 작업22-PAYMENT-HOTFIX-2B confirmPayment 렌더링 회귀 방지 완료');
        return true;
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        installLogActionGuard();
        installConfirmPaymentOverride();
        renderPaymentDateBadges();
        if (window.confirmPayment?.__WORK22_PAYMENT_HOTFIX__ && window.logAction?.__WORK22_CURRENT_USER_GUARD__ && attempts >= 8) clearInterval(timer);
        if (attempts >= 120) clearInterval(timer);
    }, 250);
})();

// WORK25-MOBILE-LOGIN-UI-03 — 모바일 로그인 패널 통합 보수, PC 톤 유지, 인벤토리 Beta 표시
(function installWork25MobileLoginUi03() {
    if (window.__WORK25_MOBILE_LOGIN_UI03__) return;
    window.__WORK25_MOBILE_LOGIN_UI03__ = true;

    const RELEASE_TEXT = 'Release: 26.07.07 / v2.0.5 · Mobile Login Panel';

    function installStyle() {
        if (document.getElementById('work25-mobile-login-ui03-style')) return;
        const style = document.createElement('style');
        style.id = 'work25-mobile-login-ui03-style';
        style.textContent = `
            @media (max-width: 768px) {
                .mobile-ui.login-gateway-layer {
                    min-height: 100vh;
                    min-height: 100dvh;
                    justify-content: center;
                    padding: 28px 22px 94px;
                    overflow: hidden;
                    background:
                        radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 34%),
                        radial-gradient(circle at bottom right, rgba(0,180,255,0.10), transparent 30%),
                        linear-gradient(135deg, #020617 0%, #081225 38%, #0b1d3a 72%, #050b16 100%);
                }

                .mobile-ui.login-gateway-layer::before {
                    content: '';
                    position: absolute;
                    inset: 18px;
                    border: 1px solid rgba(255, 255, 255, 0.055);
                    border-radius: 30px;
                    pointer-events: none;
                }

                .mobile-ui.login-gateway-layer .login-card {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 382px;
                    max-height: calc(100dvh - 164px);
                    padding: 30px 24px 24px;
                    overflow-y: auto;
                    color: #ffffff;
                    background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.038));
                    border: 1px solid rgba(255,255,255,0.11);
                    border-radius: 30px;
                    backdrop-filter: blur(22px);
                    box-shadow: 0 30px 80px rgba(0,0,0,0.46);
                }

                .mobile-ui .yj-mobile-brand-lockup {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 14px;
                    margin-bottom: 16px;
                    text-align: left;
                    font-style: normal;
                    text-transform: none;
                    letter-spacing: normal;
                }

                .mobile-ui .yj-mobile-mark {
                    width: 58px;
                    height: 58px;
                    flex: 0 0 58px;
                    border-radius: 20px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    color: #dbeafe;
                    font-size: 26px;
                    font-weight: 900;
                    letter-spacing: -0.08em;
                    background: rgba(255,255,255,0.055);
                    border: 1px solid rgba(255,255,255,0.12);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 16px 34px rgba(0,0,0,0.22);
                }

                .mobile-ui .yj-mobile-brand-title {
                    color: #ffffff;
                    font-size: 23px;
                    line-height: 1.05;
                    font-weight: 900;
                    letter-spacing: 0.02em;
                }

                .mobile-ui .yj-mobile-brand-subtitle {
                    margin-top: 5px;
                    color: rgba(255,255,255,0.52);
                    font-size: 10px;
                    line-height: 1.35;
                    font-weight: 700;
                    letter-spacing: 0.01em;
                }

                .mobile-ui #securityStatus {
                    color: rgba(191, 219, 254, 0.68) !important;
                    margin-bottom: 18px !important;
                }

                .mobile-ui .login-method-stack {
                    gap: 0 !important;
                }

                .mobile-ui .yj-mobile-login-group {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    padding: 16px;
                    border-radius: 24px;
                    border: 1px solid rgba(255,255,255,0.10);
                    background: rgba(15,23,42,0.34);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.055), 0 16px 34px rgba(0,0,0,0.18);
                }

                .mobile-ui .yj-mobile-login-group .google-login-panel {
                    margin: 0 !important;
                    padding: 0 !important;
                    border: 0 !important;
                    border-radius: 0 !important;
                    background: transparent !important;
                    box-shadow: none !important;
                }

                .mobile-ui .google-login-panel > div:first-child {
                    color: rgba(219,234,254,0.82) !important;
                    margin-bottom: 10px !important;
                }

                .mobile-ui .login-action-btn {
                    border-color: rgba(255,255,255,0.24);
                    background: linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.075) 100%);
                    color: #ffffff;
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 28px rgba(0,0,0,0.22);
                }

                .mobile-ui .login-action-btn::after {
                    border-color: rgba(255,255,255,0.10);
                }

                .mobile-ui .login-action-btn:hover {
                    border-color: rgba(191, 219, 254, 0.42);
                    background: linear-gradient(180deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.095) 100%);
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 14px 30px rgba(0,0,0,0.26);
                }

                .mobile-ui .pin-collapse-toggle {
                    width: 100%;
                    border-color: rgba(255,255,255,0.12);
                    background: linear-gradient(180deg, rgba(255,255,255,0.060) 0%, rgba(255,255,255,0.035) 100%);
                    color: rgba(255,255,255,0.74) !important;
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.055);
                }

                .mobile-ui .pin-collapse-toggle:hover {
                    border-color: rgba(255,255,255,0.20);
                    background: linear-gradient(180deg, rgba(255,255,255,0.085) 0%, rgba(255,255,255,0.052) 100%);
                    color: rgba(255,255,255,0.88) !important;
                }

                .mobile-ui .yj-mobile-login-group .login-pin-panel {
                    margin-top: 0 !important;
                    padding: 14px 0 0 !important;
                    border: 0 !important;
                    border-top: 1px solid rgba(255,255,255,0.10) !important;
                    border-radius: 0 !important;
                    background: transparent !important;
                    box-shadow: none !important;
                }

                .mobile-ui .role-sel-btn,
                .mobile-ui .kp-btn {
                    border-color: rgba(255,255,255,0.12);
                    background: rgba(255,255,255,0.06);
                    color: rgba(255,255,255,0.78);
                }

                .mobile-ui .role-sel-btn.chosen,
                .mobile-ui .pin-dot.on {
                    border-color: rgba(147,197,253,0.72);
                    background: #2563eb;
                    color: #ffffff;
                }

                .mobile-ui.login-gateway-layer .system-footer {
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 1;
                    margin-top: 0;
                    padding: 16px 24px calc(18px + env(safe-area-inset-bottom));
                    text-align: center;
                    color: rgba(255,255,255,0.32) !important;
                }

                .mobile-ui.login-gateway-layer .system-footer p {
                    font-size: 9px;
                    letter-spacing: 1.2px;
                }

                .yj-inventory-beta-badge,
                .yj-inventory-status-badge {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 999px;
                    border: 1px solid rgba(251,191,36,0.32);
                    background: rgba(251,191,36,0.11);
                    color: #fbbf24;
                    font-size: 9px;
                    font-weight: 900;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    padding: 2px 7px;
                    line-height: 1.1;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function applyMobileLoginBranding() {
        const mobileLogin = document.getElementById('loginMobile');
        const card = mobileLogin?.querySelector('.login-card');
        if (!card) return;

        const brand = card.querySelector('.yj-mobile-brand-lockup') || card.firstElementChild;
        if (brand && !brand.classList.contains('yj-mobile-brand-lockup')) {
            brand.className = 'yj-mobile-brand-lockup';
            brand.innerHTML = `
                <span class="yj-mobile-mark" aria-hidden="true">YJ</span>
                <span>
                    <span class="yj-mobile-brand-title">YJ Flow</span>
                    <span class="yj-mobile-brand-subtitle">Smart Accounting Operating System</span>
                </span>
            `;
        }
    }

    function applyMobileLoginPanelGrouping() {
        const mobileLogin = document.getElementById('loginMobile');
        const stack = mobileLogin?.querySelector('.login-method-stack');
        const googlePanel = mobileLogin?.querySelector('.google-login-panel');
        const pinToggle = document.getElementById('mobilePinLoginToggle');
        const pinArea = document.getElementById('mobilePinLoginArea');
        if (!stack || !googlePanel || !pinToggle) return;

        let group = stack.querySelector('.yj-mobile-login-group');
        if (!group) {
            group = document.createElement('div');
            group.className = 'yj-mobile-login-group';
            stack.insertBefore(group, stack.firstChild);
        }

        if (googlePanel.parentElement !== group) group.appendChild(googlePanel);
        if (pinToggle.parentElement !== group) group.appendChild(pinToggle);
        if (pinArea && pinArea.parentElement !== group) group.appendChild(pinArea);
    }

    function applyReleaseText() {
        const releaseLine = document.querySelector('#loginMobile .system-footer p:first-child');
        if (releaseLine && releaseLine.textContent.trim() !== RELEASE_TEXT) {
            releaseLine.textContent = RELEASE_TEXT;
        }
    }

    function applyInventoryBetaState() {
        const inventoryTab = document.getElementById('pc-tab-inventory');
        const inventoryLabel = inventoryTab?.querySelector('span:last-child');
        if (inventoryLabel && !inventoryLabel.querySelector('.yj-inventory-beta-badge')) {
            inventoryLabel.innerHTML = 'Inventory <span class="yj-inventory-beta-badge">Beta</span>';
            inventoryLabel.style.display = 'inline-flex';
            inventoryLabel.style.alignItems = 'center';
            inventoryLabel.style.gap = '6px';
        }

        const inventoryPage = document.getElementById('pc-page-inventory');
        const title = inventoryPage?.querySelector('h2');
        if (title && !title.querySelector('.yj-inventory-status-badge')) {
            title.innerHTML = '재고관리 대시보드 <span class="yj-inventory-status-badge">수정중</span>';
            title.style.display = 'flex';
            title.style.alignItems = 'center';
            title.style.gap = '10px';
            title.style.flexWrap = 'wrap';
        }

        const desc = inventoryPage?.querySelector('p.text-xs');
        if (desc && !desc.dataset.work25InventoryBeta) {
            desc.dataset.work25InventoryBeta = 'true';
            desc.textContent = '재고 데이터 소스 연결 전 단계의 표시 전용 Beta 화면입니다. 정식 업무 메뉴가 아니라 후순위 검증 메뉴입니다.';
        }
    }

    function applyWork25MobileLoginUi03() {
        installStyle();
        applyMobileLoginBranding();
        applyMobileLoginPanelGrouping();
        applyReleaseText();
        applyInventoryBetaState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyWork25MobileLoginUi03);
    } else {
        applyWork25MobileLoginUi03();
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        applyWork25MobileLoginUi03();
        if (attempts >= 40) clearInterval(timer);
    }, 250);
})();
