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
            const orderList = Array.isArray(window.orders) ? window.orders : [];
            const o = orderList.find(x => x.id === id);
            if (!o) return alert('주문 데이터를 찾을 수 없습니다.');

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
                if (typeof window.db !== 'undefined') {
                    await window.db.collection('orders').doc(id).update(updatePayload);
                }

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

                if (typeof window.executeSearch === 'function') window.executeSearch();
                if (typeof window.renderAccounting === 'function') window.renderAccounting();
                if (typeof window.renderReceivables === 'function') window.renderReceivables();
                setTimeout(renderPaymentDateBadges, 150);
            } catch (e) {
                alert('입금 처리 실패: ' + e.message);
            }
        };

        window.confirmPayment.__WORK22_PAYMENT_HOTFIX__ = true;
        console.log('✅ 작업22-PAYMENT-HOTFIX confirmPayment 오버라이드 완료');
        return true;
    }

    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        installConfirmPaymentOverride();
        renderPaymentDateBadges();
        if (window.confirmPayment?.__WORK22_PAYMENT_HOTFIX__ && attempts >= 8) clearInterval(timer);
        if (attempts >= 120) clearInterval(timer);
    }, 250);
})();
