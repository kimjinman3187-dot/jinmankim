// WORK52-2 defect#1 회귀 방지: 정정 모달이 만드는 DOM id와, 미리보기·저장 함수가 읽는 id의 일치 계약.
// (라이브 DOM 동작은 브라우저 하네스로 별도 검증. 이 테스트는 CDN/로그인 없이 결정적으로 배선을 고정한다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '..', 'index.html'), 'utf8');

// function <name>( ... ) 부터 다음 '\nasync function '/'\nfunction ' 전까지 추출
function fnBody(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(html);
  assert.ok(m, name + ' 함수를 찾을 수 없음');
  const start = m.index;
  const rest = html.slice(start + m[0].length);
  const nextRe = /\n(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/;
  const nm = nextRe.exec(rest);
  return html.slice(start, start + m[0].length + (nm ? nm.index : 2000));
}

const openBody = fnBody('openPaymentCorrectionModal');
const previewBody = fnBody('paymentCorrPreview');
const submitBody = fnBody('submitPaymentCorrection');

test('정정 모달은 paymentCorr* 숨김/입력 id를 생성한다', () => {
  for (const id of ['paymentCorrOpId', 'paymentCorrOrig', 'paymentCorrTarget', 'paymentCorrAmount', 'paymentCorrDate', 'paymentCorrMethod']) {
    assert.ok(openBody.includes('id="' + id + '"'), '모달에 id=' + id + ' 없음');
  }
});

test('paymentCorrPreview는 paymentCorrOrig를 읽는다(paymentOpOrig 아님)', () => {
  assert.ok(previewBody.includes("getElementById('paymentCorrOrig')"), 'preview가 paymentCorrOrig를 읽지 않음');
  assert.ok(!previewBody.includes("getElementById('paymentOpOrig')"), 'preview가 잘못된 paymentOpOrig를 읽음');
});

test('submitPaymentCorrection은 정정 모달의 실제 id를 읽는다', () => {
  assert.ok(submitBody.includes("getElementById('paymentCorrOpId')"), 'operationId를 paymentCorrOpId에서 읽지 않음');
  assert.ok(submitBody.includes("getElementById('paymentCorrTarget')"), 'targetEventId를 paymentCorrTarget에서 읽지 않음');
  assert.ok(submitBody.includes("getElementById('paymentCorrAmount')"), 'correctedAmount를 paymentCorrAmount에서 읽지 않음');
  // 잘못된(존재하지 않는) id를 읽지 않아야 함 → operationId·targetEventId 누락 방지
  for (const bad of ['paymentOpOpId', 'paymentOpOrig', 'paymentOpTarget']) {
    assert.ok(!submitBody.includes("getElementById('" + bad + "')"), 'submit이 잘못된 id ' + bad + '를 읽음');
  }
});

test('submit op에 operationId·targetEventId·correctedAmount 키가 포함된다', () => {
  assert.ok(/operationId\s*:/.test(submitBody), 'op.operationId 없음');
  assert.ok(/targetEventId\s*:/.test(submitBody), 'op.targetEventId 없음');
  assert.ok(/correctedAmount\s*:/.test(submitBody), 'op.correctedAmount 없음');
});
