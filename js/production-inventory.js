/*
 * WORK61/63 생산입고 → 재고 보유 → 주문 배정 → 출고 → 정정 순환
 * - 주문 생산은 기존 orders 흐름을 유지한다.
 * - 재고 생산은 production_jobs에서 독립 관리한다.
 * - 품질 확인 후 '재고 입고 확정'할 때만 inventory_items + inventory_movements를
 *   하나의 Firestore transaction으로 반영한다.
 */
(function () {
  'use strict';

  const STOCK_STAGES = {
    planned: '생산 대기',
    in_production: '생산 중',
    quantity_complete: '품질 확인 대기',
    quality_passed: '재고 입고 대기',
    stocked: '재고 입고 완료'
  };
  const MANAGER_ROLES = ['admin', 'factory_manager'];
  const PRODUCTION_ROLES = ['admin', 'factory', 'factory_manager'];

  let activeUser = null;
  let stockJobs = [];
  let inventoryItems = [];
  let inventoryMovements = [];
  let inventoryAllocations = [];
  let orderOptions = [];
  let unsubJobs = null;
  let unsubItems = null;
  let unsubMovements = null;
  let unsubAllocations = null;
  let startedUid = '';
  const busy = new Set();

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function userUid() {
    return activeUser?.auth_uid || activeUser?.id || '';
  }

  function isProductionUser() {
    return PRODUCTION_ROLES.includes(activeUser?.role);
  }

  function isProductionManager() {
    return MANAGER_ROLES.includes(activeUser?.role);
  }

  function timestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function inventoryRoot() {
    return db.collection('production_inventory').doc('main');
  }

  function jobsCollection() { return inventoryRoot().collection('jobs'); }
  function itemsCollection() { return inventoryRoot().collection('items'); }
  function movementsCollection() { return inventoryRoot().collection('movements'); }
  function allocationsCollection() { return inventoryRoot().collection('allocations'); }

  function normalizeItemCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }

  function setStatus(message, tone = 'normal') {
    const el = document.getElementById('stockProductionFormMessage');
    if (!el) return;
    el.textContent = message || '';
    el.className = `text-[11px] font-bold mt-3 min-h-[16px] ${tone === 'error' ? 'text-red-300' : tone === 'success' ? 'text-emerald-300' : 'text-slate-400'}`;
  }

  function setCycleStatus(message, tone = 'normal') {
    const el = document.getElementById('inventoryCycleMessage');
    if (!el) return;
    el.textContent = message || '';
    el.className = `mt-3 min-h-[16px] text-[11px] font-bold ${tone === 'error' ? 'text-red-300' : tone === 'success' ? 'text-emerald-300' : 'text-slate-400'}`;
  }

  function availableQty(item) {
    if (Number.isFinite(Number(item?.availableQty))) return Number(item.availableQty);
    return Math.max(0, Number(item?.currentQty || 0) - Number(item?.reservedQty || 0));
  }

  function updateCyclePermissionUI() {
    const allowed = isProductionManager();
    document.getElementById('inventoryAllocationCreatePanel')?.classList.toggle('hidden', !allowed);
    document.getElementById('inventoryAdjustmentPanel')?.classList.toggle('hidden', !allowed);
    const permission = document.getElementById('inventoryCyclePermission');
    if (permission) {
      permission.textContent = allowed ? '생산관리자 처리 가능' : '조회 전용';
      permission.className = allowed
        ? 'text-[10px] font-black text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-md px-2 py-1'
        : 'text-[10px] font-black text-slate-400 border border-slate-600 rounded-md px-2 py-1';
    }
  }

  function visibleJobs() {
    if (window.yjIncludeTestData) return stockJobs;
    return stockJobs.filter(job => !job.isTestData);
  }

  function updatePermissionUI() {
    const createPanel = document.getElementById('stockProductionCreatePanel');
    const permission = document.getElementById('stockProductionPermission');
    const allowed = isProductionManager();
    if (createPanel) createPanel.classList.toggle('hidden', !allowed);
    if (permission) {
      permission.textContent = allowed ? '생산관리자 등록 가능' : '조회 전용';
      permission.className = allowed
        ? 'text-[10px] font-black text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-md px-2 py-1'
        : 'text-[10px] font-black text-slate-400 border border-slate-600 bg-slate-700/40 rounded-md px-2 py-1';
    }
  }

  function renderStageRail(stage) {
    const stages = ['planned', 'in_production', 'quantity_complete', 'quality_passed', 'stocked'];
    const current = Math.max(0, stages.indexOf(stage));
    return `<div class="grid grid-cols-5 gap-1 mt-4">${stages.map((key, index) => {
      const complete = stage === 'stocked' || index < current;
      const currentStage = index === current && stage !== 'stocked';
      const style = complete
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : currentStage
          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
          : 'border-slate-700 bg-[#111827] text-slate-500';
      return `<div class="rounded-lg border px-2 py-2 text-center text-[9px] font-black ${style}">${complete ? '✓ ' : ''}${esc(STOCK_STAGES[key])}</div>`;
    }).join('')}</div>`;
  }

  function jobActions(job) {
    if (!isProductionUser() || job.productionStage === 'stocked') return '';
    if (job.productionStage === 'planned') {
      return `<button type="button" onclick="YJProductionInventory.startJob('${esc(job.id)}')" class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-black">생산 시작</button>`;
    }
    if (job.productionStage === 'in_production') {
      const remaining = Math.max(0, Number(job.plannedQty || 0) - Number(job.completedQty || 0));
      return `<label class="text-[10px] text-slate-400 font-black">이번 생산수량<input id="stockJobQty-${esc(job.id)}" type="number" min="1" max="${remaining}" step="1" inputmode="numeric" class="mt-1 w-28 px-3 py-2 rounded-lg bg-[#0f1522] border border-[#334155] text-white text-right font-black" placeholder="0"></label><button type="button" onclick="YJProductionInventory.addProgress('${esc(job.id)}')" class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-black">수량 등록</button>`;
    }
    if (job.productionStage === 'quantity_complete') {
      return `<button type="button" onclick="YJProductionInventory.passQuality('${esc(job.id)}')" class="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-black">품질 확인 완료</button>`;
    }
    if (job.productionStage === 'quality_passed' && isProductionManager()) {
      return `<button type="button" onclick="YJProductionInventory.receiveStock('${esc(job.id)}')" class="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black">재고 입고 확정</button>`;
    }
    return '<span class="text-[10px] font-bold text-slate-500">생산관리자가 입고를 확정합니다.</span>';
  }

  function renderJobs() {
    updatePermissionUI();
    const container = document.getElementById('stockProductionList');
    const meta = document.getElementById('stockProductionListMeta');
    if (!container) return;
    const jobs = visibleJobs();
    const active = jobs.filter(job => job.productionStage !== 'stocked').length;
    const awaiting = jobs.filter(job => job.productionStage === 'quality_passed').length;
    const stocked = jobs.filter(job => job.productionStage === 'stocked').length;
    const activeEl = document.getElementById('pcStockProductionActiveCount');
    const awaitingEl = document.getElementById('pcStockProductionAwaitingCount');
    const stockedEl = document.getElementById('pcStockProductionStockedCount');
    if (activeEl) activeEl.textContent = String(active);
    if (awaitingEl) awaitingEl.textContent = String(awaiting);
    if (stockedEl) stockedEl.textContent = String(stocked);
    if (meta) meta.textContent = `전체 ${jobs.length}건 · 진행 ${active}건 · 입고대기 ${awaiting}건`;
    if (!jobs.length) {
      container.innerHTML = '<div class="rounded-xl border border-dashed border-[#334155] bg-[#111827]/60 p-8 text-center"><p class="text-sm font-black text-slate-300">재고 확보 생산이 없습니다.</p><p class="mt-2 text-[11px] font-bold text-slate-500">생산관리자가 상단에서 재고 생산계획을 등록하면 이 영역에 표시됩니다.</p></div>';
      return;
    }
    container.innerHTML = jobs.map(job => {
      const planned = Number(job.plannedQty) || 0;
      const completed = Math.min(Number(job.completedQty) || 0, planned);
      const remaining = Math.max(0, planned - completed);
      const expected = Number(job.inventoryQtyAtCreate || 0) + planned;
      const disabled = busy.has(job.id) ? ' opacity-60 pointer-events-none' : '';
      return `<article class="rounded-xl border border-cyan-500/20 bg-[#111827] p-5${disabled}">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><div class="flex flex-wrap items-center gap-2"><span class="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[9px] font-black text-cyan-200">재고 확보</span><strong class="text-sm text-white">${esc(job.itemName)}</strong><span class="text-[10px] font-bold text-slate-500">${esc(job.itemCode)}</span></div><p class="mt-2 text-[11px] font-bold text-slate-400">${esc(job.material || '자재 미지정')} · ${esc(job.specification || '규격 미지정')} · ${esc(job.targetWarehouse || '창고 미지정')}</p></div>
          <span class="rounded-lg bg-slate-700 px-3 py-1.5 text-[10px] font-black text-slate-200">${esc(STOCK_STAGES[job.productionStage] || job.productionStage)}</span>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 text-[10px] font-bold"><div><span class="text-slate-500">계획</span><strong class="mt-1 block text-white">${planned.toLocaleString()}장</strong></div><div><span class="text-slate-500">완료</span><strong class="mt-1 block text-blue-300">${completed.toLocaleString()}장</strong></div><div><span class="text-slate-500">잔여</span><strong class="mt-1 block text-orange-300">${remaining.toLocaleString()}장</strong></div><div><span class="text-slate-500">예상재고</span><strong class="mt-1 block text-emerald-300">${expected.toLocaleString()}장</strong></div><div><span class="text-slate-500">목표일</span><strong class="mt-1 block text-white">${esc(job.dueDate || '-')}</strong></div></div>
        <p class="mt-3 rounded-lg bg-[#0f1522] px-3 py-2 text-[10px] font-bold text-slate-400">생산 사유: ${esc(job.stockReason || '-')}</p>
        ${renderStageRail(job.productionStage)}
        <div class="mt-4 flex flex-wrap items-end justify-end gap-2">${jobActions(job)}</div>
      </article>`;
    }).join('');
  }

  function renderInventory() {
    updateCyclePermissionUI();
    const total = inventoryItems.length;
    const shortage = inventoryItems.filter(item => availableQty(item) <= 0).length;
    const safety = inventoryItems.filter(item => {
      const qty = availableQty(item);
      return qty > 0 && qty <= Number(item.safetyStock || 0);
    }).length;
    const review = inventoryItems.filter(item => !item.itemName || !item.itemCode || !item.warehouse || !item.unit || !item.specification).length;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
    set('pcInventoryTotalItems', total);
    set('pcInventoryShortageItems', shortage);
    set('pcInventorySafetyItems', safety);
    set('pcInventoryReviewItems', review);

    const body = document.getElementById('pcInventoryLowStockBody');
    const count = document.getElementById('pcInventoryItemCount');
    if (count) count.textContent = `${total}건`;
    if (body) {
      body.innerHTML = inventoryItems.length ? inventoryItems.map(item => {
        const qty = Number(item.currentQty || 0);
        const reserved = Number(item.reservedQty || 0);
        const available = availableQty(item);
        const safetyQty = Number(item.safetyStock || 0);
        const state = available <= 0
          ? '<span class="text-red-300">부족</span>'
          : available <= safetyQty
            ? '<span class="text-amber-300">보충 검토</span>'
            : '<span class="text-emerald-300">정상</span>';
        return `<tr><td class="px-4 py-3"><strong class="block text-white">${esc(item.itemName)}</strong><span class="text-[9px] text-slate-500">${esc(item.itemCode)} · ${esc(item.unit || '단위 미지정')}</span></td><td class="px-4 py-3">${esc(item.warehouse || '-')}</td><td class="px-4 py-3 text-right font-black text-white">${qty.toLocaleString()}</td><td class="px-4 py-3 text-right text-blue-300">${reserved.toLocaleString()}</td><td class="px-4 py-3 text-right font-black text-cyan-200">${available.toLocaleString()}</td><td class="px-4 py-3 text-right">${safetyQty.toLocaleString()}</td><td class="px-4 py-3 text-center text-[10px] font-black">${state}</td></tr>`;
      }).join('') : '<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500 font-bold">재고 입고 확정된 완제품이 없습니다.</td></tr>';
    }

    const movementList = document.getElementById('pcInventoryMovementList');
    if (movementList) {
      const labels = { production_receipt: '생산입고', allocation: '주문 배정', allocation_release: '배정 해제', shipment: '출고', return_receipt: '반품 입고', stock_adjustment: '재고 정정' };
      inventoryMovements.length ? inventoryMovements.slice(0, 12).map(movement => {
        const stockDelta = Number(movement.stockDelta ?? movement.quantity ?? 0);
        const reservedDelta = Number(movement.reservedDelta || 0);
        const deltaText = stockDelta ? `${stockDelta > 0 ? '+' : ''}${stockDelta.toLocaleString()}` : `예약 ${reservedDelta > 0 ? '+' : ''}${reservedDelta.toLocaleString()}`;
        const deltaClass = stockDelta < 0 || reservedDelta > 0 ? 'text-orange-300' : 'text-emerald-300';
        return `<div class="rounded-lg border border-[#334155] bg-[#111827] p-3"><div class="flex justify-between gap-3"><strong class="text-xs text-white">${esc(movement.itemName || movement.itemCode)}</strong><span class="text-xs font-black ${deltaClass}">${esc(deltaText)}${esc(movement.unit || '장')}</span></div><p class="mt-1 text-[9px] font-bold text-slate-500">${esc(labels[movement.movementType] || movement.movementType)} · ${esc(movement.orderLabel || movement.reason || movement.actorName || '-')}</p></div>`;
      }).join('') : '<p class="text-center text-xs font-bold text-slate-500">아직 재고 이동 이력이 없습니다.</p>';
    }
    renderCycle();
  }

  function renderCycle() {
    const itemOptions = inventoryItems.map(item => `<option value="${esc(item.itemCode)}">${esc(item.itemName)} · 가용 ${availableQty(item).toLocaleString()}${esc(item.unit || '장')}</option>`).join('');
    ['inventoryAllocationItem', 'inventoryAdjustmentItem'].forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      const selected = select.value;
      select.innerHTML = `<option value="">품목 선택</option>${itemOptions}`;
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    });
    const orderSelect = document.getElementById('inventoryAllocationOrder');
    if (orderSelect) {
      const selected = orderSelect.value;
      orderSelect.innerHTML = '<option value="">주문 선택</option>' + orderOptions
        .filter(order => ['approved', 'completed'].includes(order.status))
        .map(order => `<option value="${esc(order.id)}">${esc(order.orderNo || order.id)} · ${esc(order.client || '거래처 미지정')} · ${esc(order.material || '')}</option>`).join('');
      if ([...orderSelect.options].some(option => option.value === selected)) orderSelect.value = selected;
    }
    const active = inventoryAllocations.filter(row => row.status === 'allocated');
    const shipped = inventoryAllocations.filter(row => ['shipped', 'returned'].includes(row.status));
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = `${value}건`; };
    set('inventoryAllocatedCount', active.length);
    set('inventoryShippedCount', shipped.length);
    const activeList = document.getElementById('inventoryAllocationList');
    if (activeList) activeList.innerHTML = active.length ? active.map(row => `<article class="rounded-lg border border-blue-500/20 bg-[#0f1522] p-3"><div class="flex justify-between gap-3"><div><strong class="text-xs text-white">${esc(row.orderLabel)}</strong><p class="mt-1 text-[10px] text-slate-500">${esc(row.itemName)} · ${Number(row.allocatedQty || 0).toLocaleString()}${esc(row.unit || '장')} 예약</p></div><span class="text-[9px] font-black text-blue-300">출고 대기</span></div>${isProductionManager() ? `<div class="mt-3 flex justify-end gap-2"><button onclick="YJProductionInventory.releaseAllocation('${esc(row.id)}')" class="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-[10px] font-black">배정 해제</button><button onclick="YJProductionInventory.shipAllocation('${esc(row.id)}')" class="px-3 py-2 rounded-lg bg-blue-600 text-white text-[10px] font-black">출고 확정</button></div>` : ''}</article>`).join('') : '<p class="text-center text-xs text-slate-500 font-bold py-5">배정된 주문이 없습니다.</p>';
    const shippedList = document.getElementById('inventoryShipmentList');
    if (shippedList) shippedList.innerHTML = shipped.length ? shipped.slice(0, 20).map(row => `<article class="rounded-lg border border-[#334155] bg-[#0f1522] p-3"><div class="flex justify-between gap-3"><div><strong class="text-xs text-white">${esc(row.orderLabel)}</strong><p class="mt-1 text-[10px] text-slate-500">${esc(row.itemName)} · 출고 ${Number(row.shippedQty || 0).toLocaleString()}${esc(row.unit || '장')}</p></div><span class="text-[9px] font-black ${row.status === 'returned' ? 'text-emerald-300' : 'text-slate-300'}">${row.status === 'returned' ? '반품 완료' : '출고 완료'}</span></div>${isProductionManager() && row.status === 'shipped' ? `<div class="mt-3 flex justify-end"><button onclick="YJProductionInventory.returnShipment('${esc(row.id)}')" class="px-3 py-2 rounded-lg border border-emerald-500/30 text-emerald-300 text-[10px] font-black">전량 반품 입고</button></div>` : ''}</article>`).join('') : '<p class="text-center text-xs text-slate-500 font-bold py-5">출고 기록이 없습니다.</p>';
  }

  function stop() {
    [unsubJobs, unsubItems, unsubMovements, unsubAllocations].forEach(unsub => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
    unsubJobs = unsubItems = unsubMovements = unsubAllocations = null;
    startedUid = '';
  }

  function start(user, ordersList = null) {
    activeUser = user || null;
    if (Array.isArray(ordersList)) orderOptions = ordersList.map(order => ({ ...order }));
    updatePermissionUI();
    const nextUid = userUid();
    if (nextUid && nextUid === startedUid && unsubJobs && unsubItems && unsubMovements && unsubAllocations) {
      renderJobs();
      renderInventory();
      return;
    }
    stop();
    activeUser = user || null;
    if (typeof db === 'undefined' || !activeUser) {
      renderJobs();
      renderInventory();
      return;
    }
    startedUid = nextUid;
    // 권한 또는 네트워크 오류가 발생해도 사용자가 화면 구조와 빈 상태를 즉시 확인할 수 있게 한다.
    renderJobs();
    renderInventory();
    unsubJobs = jobsCollection().orderBy('createdAt', 'desc').limit(150).onSnapshot(snapshot => {
      stockJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderJobs();
    }, error => {
      console.error('Stock production listener error:', error);
      setStatus('재고 생산계획을 불러오지 못했습니다.', 'error');
    });
    unsubItems = itemsCollection().orderBy('itemCode').limit(300).onSnapshot(snapshot => {
      inventoryItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderInventory();
    }, error => console.error('Inventory items listener error:', error));
    unsubMovements = movementsCollection().orderBy('createdAt', 'desc').limit(50).onSnapshot(snapshot => {
      inventoryMovements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderInventory();
    }, error => console.error('Inventory movements listener error:', error));
    unsubAllocations = allocationsCollection().orderBy('updatedAt', 'desc').limit(100).onSnapshot(snapshot => {
      inventoryAllocations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderInventory();
    }, error => console.error('Inventory allocations listener error:', error));
  }

  async function createStockJob() {
    if (!isProductionManager()) return setStatus('재고 생산계획은 생산관리자만 등록할 수 있습니다.', 'error');
    const value = id => document.getElementById(id)?.value?.trim() || '';
    const itemCode = normalizeItemCode(value('stockProductionItemCode'));
    const itemName = value('stockProductionItemName');
    const material = value('stockProductionMaterial');
    const specification = value('stockProductionSpec');
    const targetWarehouse = value('stockProductionWarehouse');
    const stockReason = value('stockProductionReason');
    const dueDate = value('stockProductionDueDate');
    const plannedQty = Number(value('stockProductionQty'));
    const safetyStock = Number(value('stockProductionSafetyStock') || 0);
    if (!itemCode || !itemName || !Number.isInteger(plannedQty) || plannedQty <= 0 || !targetWarehouse || !stockReason || !dueDate) {
      return setStatus('품목코드·품목명·수량·목표일·창고·생산 사유를 확인해 주세요.', 'error');
    }
    if (!Number.isInteger(safetyStock) || safetyStock < 0) return setStatus('안전재고는 0 이상의 정수로 입력해 주세요.', 'error');
    const existing = inventoryItems.find(item => item.itemCode === itemCode);
    const ref = jobsCollection().doc();
    try {
      setStatus('재고 생산계획을 등록하는 중입니다.');
      await ref.set({
        productionType: 'stock', itemCode, itemName, material, specification,
        targetWarehouse, stockReason, dueDate, plannedQty, completedQty: 0,
        safetyStock, inventoryQtyAtCreate: Number(existing?.currentQty || 0),
        productionStage: 'planned', status: 'active', isTestData: false,
        createdByUid: userUid(), createdByName: activeUser?.name || '사용자',
        createdByRole: activeUser?.role || '', createdAt: timestamp(), updatedAt: timestamp(),
        stockReceiptId: null, stockedQty: 0, stockedAt: null
      });
      ['stockProductionItemCode', 'stockProductionItemName', 'stockProductionMaterial', 'stockProductionSpec', 'stockProductionQty', 'stockProductionSafetyStock', 'stockProductionReason'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      setStatus('재고 생산계획을 등록했습니다.', 'success');
    } catch (error) {
      console.error('Create stock production error:', error);
      setStatus(`등록 실패: ${error?.message || '오류를 확인해 주세요.'}`, 'error');
    }
  }

  async function updateJob(id, handler) {
    if (!isProductionUser() || busy.has(id)) return;
    busy.add(id);
    renderJobs();
    try {
      await db.runTransaction(async transaction => {
        const ref = jobsCollection().doc(id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error('생산계획을 찾을 수 없습니다.');
        const patch = handler(snapshot.data());
        transaction.update(ref, { ...patch, updatedAt: timestamp(), updatedByUid: userUid(), updatedByName: activeUser?.name || '사용자' });
      });
    } catch (error) {
      console.error('Stock production update error:', error);
      alert(error?.message || '재고 생산 처리에 실패했습니다.');
    } finally {
      busy.delete(id);
      renderJobs();
    }
  }

  function startJob(id) {
    return updateJob(id, job => {
      if (job.productionStage !== 'planned') throw new Error('생산 대기 상태에서만 시작할 수 있습니다.');
      return { productionStage: 'in_production', productionStartedAt: timestamp() };
    });
  }

  function addProgress(id) {
    const input = document.getElementById(`stockJobQty-${id}`);
    const quantity = Number(input?.value || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return alert('이번 생산수량을 1 이상의 정수로 입력해 주세요.');
    return updateJob(id, job => {
      if (job.productionStage !== 'in_production') throw new Error('생산 중인 계획에만 수량을 등록할 수 있습니다.');
      const before = Number(job.completedQty || 0);
      const planned = Number(job.plannedQty || 0);
      const after = before + quantity;
      if (after > planned) throw new Error(`잔여 ${Math.max(0, planned - before).toLocaleString()}장을 초과할 수 없습니다.`);
      return { completedQty: after, productionStage: after === planned ? 'quantity_complete' : 'in_production', lastProgressQty: quantity, productionCompletedAt: after === planned ? timestamp() : null };
    });
  }

  function passQuality(id) {
    return updateJob(id, job => {
      if (job.productionStage !== 'quantity_complete' || Number(job.completedQty) !== Number(job.plannedQty)) throw new Error('계획수량이 모두 생산된 후 품질 확인할 수 있습니다.');
      return { productionStage: 'quality_passed', qualityCheckedAt: timestamp(), qualityCheckedByUid: userUid() };
    });
  }

  async function receiveStock(id) {
    if (!isProductionManager() || busy.has(id)) return alert('재고 입고는 생산관리자만 확정할 수 있습니다.');
    if (!confirm('품질 확인된 수량을 완제품 재고로 입고할까요? 입고 후에는 원장 조정 절차가 필요합니다.')) return;
    busy.add(id);
    renderJobs();
    try {
      await db.runTransaction(async transaction => {
        const jobRef = jobsCollection().doc(id);
        const movementRef = movementsCollection().doc(id);
        const jobSnapshot = await transaction.get(jobRef);
        const movementSnapshot = await transaction.get(movementRef);
        if (!jobSnapshot.exists) throw new Error('생산계획을 찾을 수 없습니다.');
        if (movementSnapshot.exists) throw new Error('이미 재고 입고된 생산계획입니다.');
        const job = jobSnapshot.data();
        if (job.productionStage !== 'quality_passed') throw new Error('품질 확인 완료 후 입고할 수 있습니다.');
        const quantity = Number(job.completedQty || 0);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity !== Number(job.plannedQty)) throw new Error('입고 수량이 생산 계획수량과 일치하지 않습니다.');
        const itemRef = itemsCollection().doc(job.itemCode);
        const itemSnapshot = await transaction.get(itemRef);
        const beforeQty = itemSnapshot.exists ? Number(itemSnapshot.data().currentQty || 0) : 0;
        const beforeReservedQty = itemSnapshot.exists ? Number(itemSnapshot.data().reservedQty || 0) : 0;
        const afterQty = beforeQty + quantity;
        const itemData = {
          itemCode: job.itemCode, itemName: job.itemName, material: job.material || '', specification: job.specification || '',
          warehouse: job.targetWarehouse, unit: '장', currentQty: afterQty, reservedQty: beforeReservedQty,
          availableQty: afterQty - beforeReservedQty, safetyStock: Number(job.safetyStock || itemSnapshot.data()?.safetyStock || 0),
          lastMovementId: id, updatedAt: timestamp(), updatedByUid: userUid()
        };
        transaction.set(itemRef, itemData, { merge: true });
        transaction.set(movementRef, {
          movementId: id, movementType: 'production_receipt', sourceJobId: id,
          allocationId: '', orderId: '', orderLabel: '', itemCode: job.itemCode, itemName: job.itemName,
          warehouse: job.targetWarehouse, unit: '장', quantity, stockDelta: quantity, reservedDelta: 0,
          beforeQty, afterQty, beforeReservedQty, afterReservedQty: beforeReservedQty, reason: job.stockReason || '',
          actorUid: userUid(), actorName: activeUser?.name || '사용자', actorRole: activeUser?.role || '', createdAt: timestamp()
        });
        transaction.update(jobRef, {
          productionStage: 'stocked', status: 'completed', stockReceiptId: id, stockedQty: quantity,
          stockedAt: timestamp(), updatedAt: timestamp(), updatedByUid: userUid(), updatedByName: activeUser?.name || '사용자'
        });
      });
      alert('완제품 재고 입고가 확정됐습니다.');
    } catch (error) {
      console.error('Receive production stock error:', error);
      alert(error?.message || '재고 입고 처리에 실패했습니다.');
    } finally {
      busy.delete(id);
      renderJobs();
    }
  }

  async function allocateOrder() {
    if (!isProductionManager()) return setCycleStatus('주문 재고 배정은 생산관리자만 할 수 있습니다.', 'error');
    const orderId = document.getElementById('inventoryAllocationOrder')?.value || '';
    const itemCode = document.getElementById('inventoryAllocationItem')?.value || '';
    const quantity = Number(document.getElementById('inventoryAllocationQty')?.value || 0);
    const order = orderOptions.find(row => row.id === orderId);
    if (!orderId || !itemCode || !Number.isInteger(quantity) || quantity <= 0) return setCycleStatus('주문·품목·배정수량을 확인해 주세요.', 'error');
    const allocationRef = allocationsCollection().doc();
    const movementRef = movementsCollection().doc(allocationRef.id);
    try {
      setCycleStatus('주문에 재고를 배정하는 중입니다.');
      await db.runTransaction(async transaction => {
        const orderRef = db.collection('orders').doc(orderId);
        const itemRef = itemsCollection().doc(itemCode);
        const [orderSnapshot, itemSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(itemRef)]);
        if (!orderSnapshot.exists) throw new Error('선택한 주문을 찾을 수 없습니다.');
        if (!itemSnapshot.exists) throw new Error('선택한 완제품 재고가 없습니다.');
        const item = itemSnapshot.data();
        const beforeQty = Number(item.currentQty || 0);
        const beforeReservedQty = Number(item.reservedQty || 0);
        const beforeAvailable = beforeQty - beforeReservedQty;
        if (quantity > beforeAvailable) throw new Error(`가용재고 ${beforeAvailable.toLocaleString()}${item.unit || '장'}를 초과할 수 없습니다.`);
        const afterReservedQty = beforeReservedQty + quantity;
        const orderLabel = order?.orderNo || orderSnapshot.data().orderNo || orderId;
        const common = { actorUid: userUid(), actorName: activeUser?.name || '사용자', actorRole: activeUser?.role || '', createdAt: timestamp() };
        transaction.set(allocationRef, {
          allocationId: allocationRef.id, orderId, orderLabel, itemCode, itemName: item.itemName || itemCode,
          warehouse: item.warehouse || '', unit: item.unit || '장', allocatedQty: quantity, shippedQty: 0, returnedQty: 0,
          status: 'allocated', createdAt: timestamp(), createdByUid: userUid(), updatedAt: timestamp(), updatedByUid: userUid()
        });
        transaction.set(movementRef, {
          movementId: movementRef.id, movementType: 'allocation', sourceJobId: '', allocationId: allocationRef.id,
          orderId, orderLabel, itemCode, itemName: item.itemName || itemCode, warehouse: item.warehouse || '', unit: item.unit || '장',
          quantity, stockDelta: 0, reservedDelta: quantity, beforeQty, afterQty: beforeQty,
          beforeReservedQty, afterReservedQty, reason: '주문 재고 배정', ...common
        });
        transaction.update(itemRef, { reservedQty: afterReservedQty, availableQty: beforeQty - afterReservedQty, lastMovementId: movementRef.id, updatedAt: timestamp(), updatedByUid: userUid() });
      });
      const qtyInput = document.getElementById('inventoryAllocationQty'); if (qtyInput) qtyInput.value = '';
      setCycleStatus('주문 재고 배정이 완료됐습니다.', 'success');
    } catch (error) {
      console.error('Inventory allocation error:', error);
      setCycleStatus(error?.message || '주문 재고 배정에 실패했습니다.', 'error');
    }
  }

  async function transitionAllocation(id, action) {
    if (!isProductionManager() || busy.has(id)) return;
    const labels = { shipment: '출고', allocation_release: '배정 해제', return_receipt: '반품 입고' };
    if (!confirm(`${labels[action]} 처리할까요? 재고 이동 원장이 함께 기록됩니다.`)) return;
    busy.add(id); renderCycle();
    try {
      await db.runTransaction(async transaction => {
        const allocationRef = allocationsCollection().doc(id);
        const allocationSnapshot = await transaction.get(allocationRef);
        if (!allocationSnapshot.exists) throw new Error('주문 배정 기록을 찾을 수 없습니다.');
        const allocation = allocationSnapshot.data();
        const itemRef = itemsCollection().doc(allocation.itemCode);
        const itemSnapshot = await transaction.get(itemRef);
        if (!itemSnapshot.exists) throw new Error('완제품 재고를 찾을 수 없습니다.');
        const item = itemSnapshot.data();
        const quantity = Number(allocation.allocatedQty || 0);
        const beforeQty = Number(item.currentQty || 0);
        const beforeReservedQty = Number(item.reservedQty || 0);
        let stockDelta = 0, reservedDelta = 0, nextStatus = allocation.status;
        if (action === 'shipment') {
          if (allocation.status !== 'allocated' || beforeQty < quantity || beforeReservedQty < quantity) throw new Error('출고 가능한 배정 상태가 아닙니다.');
          stockDelta = -quantity; reservedDelta = -quantity; nextStatus = 'shipped';
        } else if (action === 'allocation_release') {
          if (allocation.status !== 'allocated' || beforeReservedQty < quantity) throw new Error('해제 가능한 배정 상태가 아닙니다.');
          reservedDelta = -quantity; nextStatus = 'released';
        } else if (action === 'return_receipt') {
          if (allocation.status !== 'shipped') throw new Error('출고 완료 건만 반품 입고할 수 있습니다.');
          stockDelta = quantity; nextStatus = 'returned';
        }
        const afterQty = beforeQty + stockDelta;
        const afterReservedQty = beforeReservedQty + reservedDelta;
        if (afterQty < 0 || afterReservedQty < 0 || afterReservedQty > afterQty) throw new Error('재고 수량 정합성이 맞지 않습니다.');
        const movementRef = movementsCollection().doc(`${id}__${action}`);
        const movementSnapshot = await transaction.get(movementRef);
        if (movementSnapshot.exists) throw new Error('이미 처리된 작업입니다.');
        transaction.set(movementRef, {
          movementId: movementRef.id, movementType: action, sourceJobId: '', allocationId: id,
          orderId: allocation.orderId, orderLabel: allocation.orderLabel, itemCode: allocation.itemCode,
          itemName: allocation.itemName, warehouse: allocation.warehouse || item.warehouse || '', unit: allocation.unit || item.unit || '장',
          quantity, stockDelta, reservedDelta, beforeQty, afterQty, beforeReservedQty, afterReservedQty,
          reason: labels[action], actorUid: userUid(), actorName: activeUser?.name || '사용자', actorRole: activeUser?.role || '', createdAt: timestamp()
        });
        transaction.update(itemRef, { currentQty: afterQty, reservedQty: afterReservedQty, availableQty: afterQty - afterReservedQty, lastMovementId: movementRef.id, updatedAt: timestamp(), updatedByUid: userUid() });
        transaction.update(allocationRef, {
          status: nextStatus, shippedQty: nextStatus === 'shipped' || nextStatus === 'returned' ? quantity : Number(allocation.shippedQty || 0),
          returnedQty: nextStatus === 'returned' ? quantity : Number(allocation.returnedQty || 0),
          updatedAt: timestamp(), updatedByUid: userUid(), lastMovementId: movementRef.id
        });
      });
      setCycleStatus(`${labels[action]} 처리가 완료됐습니다.`, 'success');
    } catch (error) {
      console.error('Inventory allocation transition error:', error);
      setCycleStatus(error?.message || `${labels[action]} 처리에 실패했습니다.`, 'error');
    } finally { busy.delete(id); renderCycle(); }
  }

  function shipAllocation(id) { return transitionAllocation(id, 'shipment'); }
  function releaseAllocation(id) { return transitionAllocation(id, 'allocation_release'); }
  function returnShipment(id) { return transitionAllocation(id, 'return_receipt'); }

  async function adjustStock() {
    if (!isProductionManager()) return setCycleStatus('재고 정정은 생산관리자만 할 수 있습니다.', 'error');
    const itemCode = document.getElementById('inventoryAdjustmentItem')?.value || '';
    const quantity = Number(document.getElementById('inventoryAdjustmentQty')?.value || 0);
    const reason = document.getElementById('inventoryAdjustmentReason')?.value?.trim() || '';
    if (!itemCode || !Number.isInteger(quantity) || quantity === 0 || !reason) return setCycleStatus('품목·0이 아닌 증감수량·정정 사유를 확인해 주세요.', 'error');
    if (!confirm(`${quantity > 0 ? '+' : ''}${quantity.toLocaleString()}만큼 재고를 정정할까요?`)) return;
    const movementRef = movementsCollection().doc();
    try {
      await db.runTransaction(async transaction => {
        const itemRef = itemsCollection().doc(itemCode);
        const itemSnapshot = await transaction.get(itemRef);
        if (!itemSnapshot.exists) throw new Error('완제품 재고를 찾을 수 없습니다.');
        const item = itemSnapshot.data();
        const beforeQty = Number(item.currentQty || 0);
        const beforeReservedQty = Number(item.reservedQty || 0);
        const afterQty = beforeQty + quantity;
        if (afterQty < beforeReservedQty || afterQty < 0) throw new Error('정정 후 현재고는 예약수량보다 작을 수 없습니다.');
        transaction.set(movementRef, {
          movementId: movementRef.id, movementType: 'stock_adjustment', sourceJobId: '', allocationId: '', orderId: '', orderLabel: '',
          itemCode, itemName: item.itemName || itemCode, warehouse: item.warehouse || '', unit: item.unit || '장', quantity: Math.abs(quantity),
          stockDelta: quantity, reservedDelta: 0, beforeQty, afterQty, beforeReservedQty, afterReservedQty: beforeReservedQty,
          reason, actorUid: userUid(), actorName: activeUser?.name || '사용자', actorRole: activeUser?.role || '', createdAt: timestamp()
        });
        transaction.update(itemRef, { currentQty: afterQty, availableQty: afterQty - beforeReservedQty, lastMovementId: movementRef.id, updatedAt: timestamp(), updatedByUid: userUid() });
      });
      ['inventoryAdjustmentQty', 'inventoryAdjustmentReason'].forEach(fieldId => { const el = document.getElementById(fieldId); if (el) el.value = ''; });
      setCycleStatus('재고 정정 원장을 등록했습니다.', 'success');
    } catch (error) {
      console.error('Inventory adjustment error:', error);
      setCycleStatus(error?.message || '재고 정정에 실패했습니다.', 'error');
    }
  }

  window.YJProductionInventory = {
    start,
    stop,
    refresh: function () { renderJobs(); renderInventory(); },
    createStockJob,
    startJob,
    addProgress,
    passQuality,
    receiveStock,
    allocateOrder,
    shipAllocation,
    releaseAllocation,
    returnShipment,
    adjustStock
  };
})();
