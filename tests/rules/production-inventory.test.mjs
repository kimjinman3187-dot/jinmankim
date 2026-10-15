import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { makeFirestoreEnv, seedUsers } from './helpers.mjs';

let env;
let fs;
const JOB_ID = 'STOCK_JOB_1';
const ITEM_CODE = 'FG-WHITE-001';
const rootPath = (name, id) => `production_inventory/main/${name}/${id}`;

before(async () => {
  env = await makeFirestoreEnv();
  await seedUsers(env);
  fs = await import('firebase/firestore');
});

after(async () => { await env.cleanup(); });

function stockJob(overrides = {}) {
  const st = fs.serverTimestamp();
  return {
    productionType: 'stock', itemCode: ITEM_CODE, itemName: '퍼펙화이트 완제품',
    material: '양면코팅/미백', specification: '18T', targetWarehouse: '완제품 창고',
    stockReason: '안전재고 보충', dueDate: '2026-10-31', plannedQty: 10, completedQty: 0,
    safetyStock: 5, inventoryQtyAtCreate: 0, productionStage: 'planned', status: 'active',
    isTestData: false, createdByUid: 'manager1', createdByName: '생산관리자',
    createdByRole: 'factory_manager', createdAt: st, updatedAt: st,
    stockReceiptId: null, stockedQty: 0, stockedAt: null,
    ...overrides
  };
}

async function clearCollections() {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const name of ['jobs', 'items', 'movements', 'allocations']) {
      const snapshot = await fs.getDocs(fs.collection(db, `production_inventory/main/${name}`));
      for (const doc of snapshot.docs) await fs.deleteDoc(doc.ref);
    }
    const orderSnapshot = await fs.getDocs(fs.collection(db, 'orders'));
    for (const doc of orderSnapshot.docs) await fs.deleteDoc(doc.ref);
  });
}

beforeEach(clearCollections);

test('생산관리자는 재고 생산계획을 생성하고 일반 생산담당자는 생성하지 못한다', async () => {
  const managerDb = env.authenticatedContext('manager1').firestore();
  await assertSucceeds(fs.setDoc(fs.doc(managerDb, rootPath('jobs', JOB_ID)), stockJob()));

  const factoryDb = env.authenticatedContext('factory1').firestore();
  await assertFails(fs.setDoc(fs.doc(factoryDb, rootPath('jobs', 'STOCK_JOB_2')), stockJob({ createdByUid: 'factory1', createdByRole: 'factory', createdByName: '생산담당' })));
});

test('영업·회계는 주문 생산수량을 변경하지 못하고 생산 역할만 변경한다', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await fs.setDoc(fs.doc(ctx.firestore(), 'orders', 'ORDER_1'), {
      qty: 10, completedQty: 0, status: 'approved', productionStage: 'in_production', productionHistory: []
    });
  });
  const patch = {
    completedQty: 5, productionStage: 'in_production', productionUpdatedAt: 1,
    productionHistory: [{ action: 'progress', quantity: 5 }]
  };
  await assertFails(fs.updateDoc(fs.doc(env.authenticatedContext('emp1').firestore(), 'orders', 'ORDER_1'), patch));
  await assertFails(fs.updateDoc(fs.doc(env.authenticatedContext('emp2').firestore(), 'orders', 'ORDER_1'), patch));
  await assertSucceeds(fs.updateDoc(fs.doc(env.authenticatedContext('factory1').firestore(), 'orders', 'ORDER_1'), patch));
});

test('재고 생산은 순차적 단계를 거쳐 품질 확인까지 진행한다', async () => {
  const db = env.authenticatedContext('manager1').firestore();
  const ref = fs.doc(db, rootPath('jobs', JOB_ID));
  await assertSucceeds(fs.setDoc(ref, stockJob()));
  await assertSucceeds(fs.updateDoc(ref, {
    productionStage: 'in_production', productionStartedAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1', updatedByName: '생산관리자'
  }));
  await assertSucceeds(fs.updateDoc(ref, {
    completedQty: 10, productionStage: 'quantity_complete', lastProgressQty: 10,
    productionCompletedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp(),
    updatedByUid: 'manager1', updatedByName: '생산관리자'
  }));
  await assertSucceeds(fs.updateDoc(ref, {
    productionStage: 'quality_passed', qualityCheckedAt: fs.serverTimestamp(), qualityCheckedByUid: 'manager1',
    updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1', updatedByName: '생산관리자'
  }));
  await assertFails(fs.updateDoc(ref, {
    productionStage: 'in_production', updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1', updatedByName: '생산관리자'
  }));
});

test('품질 확인된 수량만 생산계획·재고·입고원장 원자 트랜잭션으로 입고한다', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await fs.setDoc(fs.doc(ctx.firestore(), rootPath('jobs', JOB_ID)), stockJob({
      productionStage: 'quality_passed', completedQty: 10,
      createdAt: fs.Timestamp.now(), updatedAt: fs.Timestamp.now(), productionCompletedAt: fs.Timestamp.now(),
      qualityCheckedAt: fs.Timestamp.now(), qualityCheckedByUid: 'manager1', updatedByUid: 'manager1', updatedByName: '생산관리자'
    }));
  });

  const db = env.authenticatedContext('manager1').firestore();
  const jobRef = fs.doc(db, rootPath('jobs', JOB_ID));
  const itemRef = fs.doc(db, rootPath('items', ITEM_CODE));
  const movementRef = fs.doc(db, rootPath('movements', JOB_ID));
  await assertSucceeds(fs.runTransaction(db, async tx => {
    await tx.get(jobRef); await tx.get(movementRef); await tx.get(itemRef);
    tx.set(itemRef, {
      itemCode: ITEM_CODE, itemName: '퍼펙화이트 완제품', material: '양면코팅/미백', specification: '18T',
      warehouse: '완제품 창고', unit: '장', currentQty: 10, reservedQty: 0, availableQty: 10, safetyStock: 5,
      lastMovementId: JOB_ID, updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1'
    });
    tx.set(movementRef, {
      movementId: JOB_ID, movementType: 'production_receipt', sourceJobId: JOB_ID, allocationId: '', orderId: '', orderLabel: '',
      itemCode: ITEM_CODE, itemName: '퍼펙화이트 완제품', warehouse: '완제품 창고', unit: '장',
      quantity: 10, stockDelta: 10, reservedDelta: 0, beforeQty: 0, afterQty: 10,
      beforeReservedQty: 0, afterReservedQty: 0, reason: '안전재고 보충', actorUid: 'manager1', actorName: '생산관리자',
      actorRole: 'factory_manager', createdAt: fs.serverTimestamp()
    });
    tx.update(jobRef, {
      productionStage: 'stocked', status: 'completed', stockReceiptId: JOB_ID, stockedQty: 10,
      stockedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1', updatedByName: '생산관리자'
    });
  }));

  const item = await fs.getDoc(itemRef);
  assert.equal(item.data().currentQty, 10);
  await assertFails(fs.updateDoc(movementRef, { quantity: 999 }));
  await assertFails(fs.updateDoc(itemRef, { currentQty: 20 }));
});

test('입고원장 단독 생성과 품질 확인 전 입고는 거부한다', async () => {
  const db = env.authenticatedContext('manager1').firestore();
  await assertSucceeds(fs.setDoc(fs.doc(db, rootPath('jobs', JOB_ID)), stockJob()));
  await assertFails(fs.setDoc(fs.doc(db, rootPath('movements', JOB_ID)), {
    movementId: JOB_ID, movementType: 'production_receipt', sourceJobId: JOB_ID, allocationId: '', orderId: '', orderLabel: '',
    itemCode: ITEM_CODE, itemName: 'x', warehouse: 'w', unit: '장', quantity: 10, stockDelta: 10, reservedDelta: 0,
    beforeQty: 0, afterQty: 10, beforeReservedQty: 0, afterReservedQty: 0, reason: 'test',
    actorUid: 'manager1', actorName: '생산관리자', actorRole: 'factory_manager', createdAt: fs.serverTimestamp()
  }));
});

async function seedCycleBase() {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await fs.setDoc(fs.doc(db, 'orders', 'ORDER-STOCK-1'), { status: 'approved', orderNo: 'ORD-001', client: '테스트 거래처', qty: 4 });
    await fs.setDoc(fs.doc(db, rootPath('items', ITEM_CODE)), {
      itemCode: ITEM_CODE, itemName: '퍼펙화이트 완제품', material: '양면코팅/미백', specification: '18T',
      warehouse: '완제품 창고', unit: '장', currentQty: 10, reservedQty: 0, availableQty: 10, safetyStock: 5,
      lastMovementId: 'SEED', updatedAt: fs.Timestamp.now(), updatedByUid: 'manager1'
    });
  });
}

function movement(overrides = {}) {
  return {
    movementId: 'ALLOC-1', movementType: 'allocation', sourceJobId: '', allocationId: 'ALLOC-1',
    orderId: 'ORDER-STOCK-1', orderLabel: 'ORD-001', itemCode: ITEM_CODE, itemName: '퍼펙화이트 완제품',
    warehouse: '완제품 창고', unit: '장', quantity: 4, stockDelta: 0, reservedDelta: 4,
    beforeQty: 10, afterQty: 10, beforeReservedQty: 0, afterReservedQty: 4, reason: '주문 재고 배정',
    actorUid: 'manager1', actorName: '생산관리자', actorRole: 'factory_manager', createdAt: fs.serverTimestamp(),
    ...overrides
  };
}

async function allocateBase(db) {
  const itemRef = fs.doc(db, rootPath('items', ITEM_CODE));
  const allocationRef = fs.doc(db, rootPath('allocations', 'ALLOC-1'));
  const movementRef = fs.doc(db, rootPath('movements', 'ALLOC-1'));
  await fs.runTransaction(db, async tx => {
    await tx.get(fs.doc(db, 'orders', 'ORDER-STOCK-1')); await tx.get(itemRef);
    tx.set(allocationRef, {
      allocationId: 'ALLOC-1', orderId: 'ORDER-STOCK-1', orderLabel: 'ORD-001', itemCode: ITEM_CODE,
      itemName: '퍼펙화이트 완제품', warehouse: '완제품 창고', unit: '장', allocatedQty: 4,
      shippedQty: 0, returnedQty: 0, status: 'allocated', createdAt: fs.serverTimestamp(), createdByUid: 'manager1',
      updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1'
    });
    tx.set(movementRef, movement());
    tx.update(itemRef, { reservedQty: 4, availableQty: 6, lastMovementId: 'ALLOC-1', updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1' });
  });
}

test('주문 배정은 가용재고를 예약하고 단독 재고 변경은 차단한다', async () => {
  await seedCycleBase();
  const db = env.authenticatedContext('manager1').firestore();
  await assertSucceeds(allocateBase(db));
  const itemRef = fs.doc(db, rootPath('items', ITEM_CODE));
  assert.equal((await fs.getDoc(itemRef)).data().availableQty, 6);
  await assertFails(fs.updateDoc(itemRef, { reservedQty: 9, availableQty: 1 }));
});

test('배정된 재고는 출고 시 현재고·예약이 함께 감소하고 전량 반품으로 복구한다', async () => {
  await seedCycleBase();
  const db = env.authenticatedContext('manager1').firestore();
  await allocateBase(db);
  const itemRef = fs.doc(db, rootPath('items', ITEM_CODE));
  const allocationRef = fs.doc(db, rootPath('allocations', 'ALLOC-1'));
  const shipRef = fs.doc(db, rootPath('movements', 'ALLOC-1__shipment'));
  await assertSucceeds(fs.runTransaction(db, async tx => {
    await tx.get(allocationRef); await tx.get(itemRef); await tx.get(shipRef);
    tx.set(shipRef, movement({ movementId: 'ALLOC-1__shipment', movementType: 'shipment', stockDelta: -4, reservedDelta: -4, beforeReservedQty: 4, afterReservedQty: 0, afterQty: 6, reason: '출고' }));
    tx.update(itemRef, { currentQty: 6, reservedQty: 0, availableQty: 6, lastMovementId: 'ALLOC-1__shipment', updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1' });
    tx.update(allocationRef, { status: 'shipped', shippedQty: 4, returnedQty: 0, updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1', lastMovementId: 'ALLOC-1__shipment' });
  }));
  const returnRef = fs.doc(db, rootPath('movements', 'ALLOC-1__return_receipt'));
  await assertSucceeds(fs.runTransaction(db, async tx => {
    await tx.get(allocationRef); await tx.get(itemRef); await tx.get(returnRef);
    tx.set(returnRef, movement({ movementId: 'ALLOC-1__return_receipt', movementType: 'return_receipt', stockDelta: 4, reservedDelta: 0, beforeQty: 6, afterQty: 10, beforeReservedQty: 0, afterReservedQty: 0, reason: '반품 입고' }));
    tx.update(itemRef, { currentQty: 10, reservedQty: 0, availableQty: 10, lastMovementId: 'ALLOC-1__return_receipt', updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1' });
    tx.update(allocationRef, { status: 'returned', shippedQty: 4, returnedQty: 4, updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1', lastMovementId: 'ALLOC-1__return_receipt' });
  }));
  assert.equal((await fs.getDoc(itemRef)).data().currentQty, 10);
});

test('재고 정정은 사유가 있는 불변 원장과 함께만 허용한다', async () => {
  await seedCycleBase();
  const db = env.authenticatedContext('manager1').firestore();
  const itemRef = fs.doc(db, rootPath('items', ITEM_CODE));
  const adjustRef = fs.doc(db, rootPath('movements', 'ADJUST-1'));
  await assertSucceeds(fs.runTransaction(db, async tx => {
    await tx.get(itemRef);
    tx.set(adjustRef, movement({ movementId: 'ADJUST-1', movementType: 'stock_adjustment', allocationId: '', orderId: '', orderLabel: '', quantity: 2, stockDelta: -2, reservedDelta: 0, afterQty: 8, afterReservedQty: 0, reason: '실사 차이' }));
    tx.update(itemRef, { currentQty: 8, reservedQty: 0, availableQty: 8, lastMovementId: 'ADJUST-1', updatedAt: fs.serverTimestamp(), updatedByUid: 'manager1' });
  }));
  await assertFails(fs.updateDoc(adjustRef, { reason: '변경' }));
});
