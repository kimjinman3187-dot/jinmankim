// WORK52-2: 입금 원장 순수 계산 모듈 (단일 진실원)
// - 브라우저(index.html applyPaymentLedgerOp)와 자동 테스트가 동일 함수를 사용한다(복사 금지).
// - Firestore 접근 없음. 트랜잭션 안에서 읽은 스냅샷을 ctx로 받아 "쓸 문서 계획"을 반환한다.
// - 취소·정정 금액은 화면 숨김 입력이 아니라 반드시 대상 이벤트(ctx.targetEvent.amount)에서 계산한다.
// - 대상 이벤트별 결정적 처리 마커(paymentEventActions/{targetEventId})로 중복 취소·정정을 차단한다.
(function (global) {
  'use strict';
  function num(v) { return Math.max(0, Number(v) || 0); }

  // op:  { kind:'payment'|'reversal'|'correction', operationId, correctedAmount?, targetEventId?, reason?,
  //        amount?(입금 등록에만 사용), paymentDate?, paymentMethod?, senderName?, reference?, memo? }
  // ctx: { order:{price,qty,paidAmount,paymentLedgerInitialized,paidAt}, actor:{uid,name,role}, now,
  //        primaryExists:boolean,           // paymentEvents/{operationId} 존재(멱등 재실행 판정)
  //        targetEvent:{eventId,type,amount}|null,  // 취소·정정 대상(트랜잭션 내 재조회 결과)
  //        markerExists:boolean }           // paymentEventActions/{targetEventId} 존재(중복 처리 판정)
  // 반환: { idempotent:true } | { idempotent:false, events:[{docId,data}], marker:{docId,data}|null, summary, total, after }
  function computeLedgerOp(op, ctx) {
    op = op || {}; ctx = ctx || {};
    const o = ctx.order || {};
    const actor = ctx.actor || {};
    const now = ctx.now;
    if (!op.operationId) throw new Error('operationId가 필요합니다.');
    if (!actor.uid || !(actor.role === 'admin' || actor.role === 'accounting')) {
      throw new Error('입금 등록·취소·정정은 관리자·회계만 가능합니다.');
    }
    if (ctx.primaryExists) return { idempotent: true }; // 같은 operationId 재실행: 재반영 금지

    const total = (Number(o.price) || 0) * (Number(o.qty) || 0);
    if (total <= 0) throw new Error('총 청구액을 확인할 수 없습니다.');
    const before = num(o.paidAmount);

    function mkEvent(docId, type, signedAmount, evBefore, evAfter) {
      return { docId, data: {
        eventId: docId, operationId: docId, type: type, amount: signedAmount,
        paymentDate: op.paymentDate || '', paymentMethod: op.paymentMethod || '',
        senderName: op.senderName || '', reference: op.reference || '', memo: op.memo || '',
        targetEventId: op.targetEventId || '', reason: op.reason || '',
        actorUid: actor.uid, actorName: actor.name || '', actorRole: actor.role,
        createdAt: now, beforePaidAmount: evBefore, afterPaidAmount: evAfter
      } };
    }
    function mkMarker() {
      return { docId: op.targetEventId, data: {
        targetEventId: op.targetEventId, operationId: op.operationId, kind: op.kind,
        actorUid: actor.uid, actorRole: actor.role, createdAt: now
      } };
    }
    // 취소·정정 공통: 대상 이벤트 재검증 + 중복 처리 차단 + 금액은 대상에서 산출
    function requireTarget(labelVerb) {
      const t = ctx.targetEvent;
      if (!op.targetEventId) throw new Error('대상 입금 기록이 지정되지 않았습니다.');
      if (!t || t.eventId !== op.targetEventId) throw new Error('대상 입금 기록을 찾을 수 없습니다.');
      if (!(t.type === 'payment' || t.type === 'corrected_payment')) {
        throw new Error('입금(또는 정정 입금) 기록만 ' + labelVerb + '할 수 있습니다.');
      }
      const tAmt = Number(t.amount);
      if (!(tAmt > 0)) throw new Error('대상 입금액이 올바르지 않습니다.');
      if (!op.reason) throw new Error((op.kind === 'reversal' ? '취소' : '정정') + ' 사유는 필수입니다.');
      if (ctx.markerExists) throw new Error('이미 취소·정정 처리된 입금입니다.');
      return tAmt;
    }

    const events = [];
    let marker = null;
    let after = before;

    if (op.kind === 'payment') {
      const amt = Number(op.amount);
      if (!(amt > 0)) throw new Error('입금액은 0보다 커야 합니다.');
      if (before + amt > total) throw new Error('잔금을 초과했습니다.');
      after = before + amt;
      events.push(mkEvent(op.operationId, 'payment', amt, before, after));
    } else if (op.kind === 'reversal') {
      const tAmt = requireTarget('취소');
      if (before - tAmt < 0) throw new Error('취소 후 누적 입금액이 음수가 될 수 없습니다.');
      after = before - tAmt;
      events.push(mkEvent(op.operationId, 'reversal', -tAmt, before, after));
      marker = mkMarker();
    } else if (op.kind === 'correction') {
      const tAmt = requireTarget('정정');
      const newAmt = Number(op.correctedAmount);
      if (!(newAmt > 0)) throw new Error('정정 입금액은 0보다 커야 합니다.');
      const afterRev = before - tAmt;
      if (afterRev < 0) throw new Error('정정(취소) 후 누적 입금액이 음수가 됩니다.');
      const afterPay = afterRev + newAmt;
      if (afterPay > total) throw new Error('정정 후 잔금을 초과했습니다.');
      after = afterPay;
      events.push(mkEvent(op.operationId, 'reversal', -tAmt, before, afterRev));
      events.push(mkEvent(op.operationId + '__c', 'corrected_payment', newAmt, afterRev, afterPay));
      marker = mkMarker();
    } else {
      throw new Error('알 수 없는 처리 유형입니다.');
    }

    const fully = after >= total && after > 0;
    const firstDocId = events[0].docId;
    const finalDocId = events[events.length - 1].docId;
    const lastPaymentAmount = op.kind === 'payment' ? Number(op.amount)
      : (op.kind === 'correction' ? Number(op.correctedAmount) : -Number(ctx.targetEvent.amount));
    const summary = { updatedAt: now };
    if (!o.paymentLedgerInitialized) { // 레거시 기존 누적액 보존(합성 이벤트 생성 안 함)
      summary.paymentLedgerOpeningBalance = before;
      summary.paymentLedgerInitialized = true;
    }
    summary.paidAmount = after;
    summary.paymentStatus = after <= 0 ? 'unpaid' : (fully ? 'paid' : 'partial');
    summary.lastPaymentAmount = lastPaymentAmount;
    summary.lastPaymentAt = now;
    summary.paidAt = fully ? (o.paidAt || now) : null;
    summary.firstOperationId = firstDocId; // 첫 이벤트 문서 id(=operationId) — Rules before 검증
    summary.lastOperationId = finalDocId;  // 최종 이벤트 문서 id — Rules after 검증

    return { idempotent: false, events: events, marker: marker, summary: summary, total: total, after: after };
  }

  const api = { computeLedgerOp: computeLedgerOp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.YJPaymentLedger = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
