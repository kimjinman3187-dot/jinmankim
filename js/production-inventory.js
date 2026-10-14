/*
 * WORK61 주문 생산·재고 확보 생산 분리
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
  let unsubJobs = null;
  let unsubItems = null;
  let unsubMovements = null;
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

  function normalizeItemCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }

  function setStatus(message, tone = 'normal') {
    const el = document.getElementById('stockProductionFormMessage');
    if (!el) return;
    el.textContent = message || '';
    el.className = `text-[11px] font-bold mt-3 min-h-[16px] ${tone === 'error' ? 'text-red-300' : tone === 'success' ? 'text-emerald-300' : 'text-slate-400'}`;
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
    const total = inventoryItems.length;
    const shortage = inventoryItems.filter(item => Number(item.currentQty || 0) <= 0).length;
    const safety = inventoryItems.filter(item => {
      const qty = Number(item.currentQty || 0);
      return qty > 0 && qty <= Number(item.safetyStock || 0);
    }).length;
    const review = inventoryItems.filter(item => !item.itemName || !item.itemCode || !item.warehouse).length;
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
        const safetyQty = Number(item.safetyStock || 0);
        const state = qty <= 0
          ? '<span class="text-red-300">부족</span>'
          : qty <= safetyQty
            ? '<span class="text-amber-300">보충 검토</span>'
            : '<span class="text-emerald-300">정상</span>';
        return `<tr><td class="px-4 py-3"><strong class="block text-white">${esc(item.itemName)}</strong><span class="text-[9px] text-slate-500">${esc(item.itemCode)}</span></td><td class="px-4 py-3">${esc(item.warehouse || '-')}</td><td class="px-4 py-3 text-right font-black text-white">${qty.toLocaleString()}</td><td class="px-4 py-3 text-right">${safetyQty.toLocaleString()}</td><td class="px-4 py-3 text-center text-[10px] font-black">${state}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="px-4 py-10 text-center text-slate-500 font-bold">재고 입고 확정된 완제품이 없습니다.</td></tr>';
    }

    const movementList = document.getElementById('pcInventoryMovementList');
    if (movementList) {
      movementList.innerHTML = inventoryMovements.length ? inventoryMovements.slice(0, 12).map(movement =>
        `<div class="rounded-lg border border-[#334155] bg-[#111827] p-3"><div class="flex justify-between gap-3"><strong class="text-xs text-white">${esc(movement.itemName || movement.itemCode)}</strong><span class="text-xs font-black text-emerald-300">+${Number(movement.quantity || 0).toLocaleString()}장</span></div><p class="mt-1 text-[9px] font-bold text-slate-500">생산입고 · ${esc(movement.actorName || '-')} · ${esc(movement.warehouse || '-')}</p></div>`
      ).join('') : '<p class="text-center text-xs font-bold text-slate-500">아직 재고 이동 이력이 없습니다.</p>';
    }
  }

  function stop() {
    [unsubJobs, unsubItems, unsubMovements].forEach(unsub => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
    unsubJobs = unsubItems = unsubMovements = null;
    startedUid = '';
  }

  function start(user) {
    activeUser = user || null;
    updatePermissionUI();
    const nextUid = userUid();
    if (nextUid && nextUid === startedUid && unsubJobs && unsubItems && unsubMovements) {
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
        const afterQty = beforeQty + quantity;
        const itemData = {
          itemCode: job.itemCode, itemName: job.itemName, material: job.material || '', specification: job.specification || '',
          warehouse: job.targetWarehouse, unit: '장', currentQty: afterQty, safetyStock: Number(job.safetyStock || itemSnapshot.data()?.safetyStock || 0),
          lastMovementId: id, updatedAt: timestamp(), updatedByUid: userUid()
        };
        transaction.set(itemRef, itemData, { merge: true });
        transaction.set(movementRef, {
          movementId: id, movementType: 'production_receipt', sourceJobId: id,
          itemCode: job.itemCode, itemName: job.itemName, warehouse: job.targetWarehouse,
          quantity, beforeQty, afterQty, actorUid: userUid(), actorName: activeUser?.name || '사용자', actorRole: activeUser?.role || '', createdAt: timestamp()
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

  window.YJProductionInventory = {
    start,
    stop,
    refresh: function () { renderJobs(); renderInventory(); },
    createStockJob,
    startJob,
    addProgress,
    passQuality,
    receiveStock
  };
})();
