import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const PRODUCTION_SOURCE = new URL('../js/employee-document-requests.js', import.meta.url);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function element(id) {
    return {
        id,
        value: '',
        disabled: false,
        textContent: '',
        children: [],
        files: [],
        renderCount: 0,
        classList: { toggle() {} },
        appendChild(child) {
            this.children.push(child);
            this.renderCount += 1;
            return child;
        },
        addEventListener(type, listener) {
            this[`on${type}`] = listener;
        },
        reset() {
            this.resetCount = (this.resetCount || 0) + 1;
        },
        click() {}
    };
}

function requestSnapshot(items) {
    return {
        docs: items.map(item => ({
            id: item.id,
            data: () => ({ ...item })
        }))
    };
}

function createHarness(initialUid = 'A') {
    const ids = [
        'pcEmployeeDocumentRequestPanel',
        'pcEmployeeDocumentForm',
        'pcEmployeeDocumentTitleInput',
        'pcEmployeeDocumentDescriptionInput',
        'pcEmployeeDocumentSubmitBtn',
        'pcEmployeeDocumentStatusFilter',
        'pcEmployeeDocumentRefreshBtn',
        'pcEmployeeDocumentMessage',
        'pcEmployeeDocumentBody',
        'pcEmployeeDocumentDetail',
        'pcEmployeeDocumentAttachmentInput',
        'pcEmployeeDocumentAttachmentSelectBtn',
        'pcEmployeeDocumentAttachmentList',
        'pcEmployeeDocumentAttachmentProgress'
    ];
    const nodes = Object.fromEntries(ids.map(id => [id, element(id)]));
    nodes.pcEmployeeDocumentTitleInput.value = '결재 제목';
    nodes.pcEmployeeDocumentDescriptionInput.value = '결재 상세';
    nodes.pcEmployeeDocumentStatusFilter.value = 'all';

    const auth = { uid: initialUid };
    const user = {
        uid: initialUid,
        auth_uid: initialUid,
        id: initialUid,
        name: initialUid,
        role: 'employee',
        status: 'active'
    };
    const queryQueue = [];
    const addQueue = [];
    const docQueue = [];
    const transactionQueue = [];
    const puts = [];
    const deletes = [];
    const liveCalls = [];
    const warnings = [];

    const document = {
        getElementById: id => nodes[id] || null,
        createElement: tag => element(tag),
        addEventListener() {}
    };

    const window = {
        currentUser: user,
        yjGetCurrentUser: () => user,
        auth: { currentUser: auth, onAuthStateChanged() {} },
        firebase: {
            firestore: {
                FieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) }
            }
        },
        YJLiveOperationsHub: {
            updateEmployeeDocumentApprovals(...args) {
                liveCalls.push(args);
            }
        },
        db: {
            collection(collectionName) {
                const query = {
                    add() {
                        const queued = addQueue.shift();
                        return queued ? queued.promise : Promise.resolve({ id: 'auto-request' });
                    },
                    doc() {
                        return docQueue.shift() || makeDoc('draft-auto');
                    },
                    where() { return this; },
                    orderBy() { return this; },
                    limit() { return this; },
                    get() {
                        if (collectionName === 'expense_approval_requests') {
                            return Promise.resolve(requestSnapshot([]));
                        }
                        const queued = queryQueue.shift();
                        return queued ? queued.promise : Promise.resolve(requestSnapshot([]));
                    }
                };
                return query;
            },
            async runTransaction(callback) {
                const queued = transactionQueue.shift();
                if (queued) await queued.promise;
                return callback({
                    get: async () => ({ exists: true, data: () => ({ status: 'draft' }) }),
                    update() {},
                    set() {}
                });
            }
        },
        storage: {
            ref(path) {
                return {
                    async put(file) {
                        puts.push({ path, file });
                        if (file.putGate) await file.putGate.promise;
                    },
                    async getMetadata() {
                        const uploaded = [...puts].reverse().find(item => item.path === path);
                        if (!uploaded) throw Object.assign(new Error('missing'), { code: 'storage/object-not-found' });
                        return {
                            fullPath: path,
                            size: uploaded.file.size,
                            contentType: uploaded.file.type
                        };
                    },
                    async delete() {
                        deletes.push(path);
                    }
                };
            }
        },
        addEventListener() {},
        setTimeout
    };

    function makeDoc(id, options = {}) {
        return {
            id,
            set: options.set || (() => Promise.resolve()),
            get: options.get || (() => Promise.resolve({
                exists: options.exists ?? true,
                data: () => ({ status: options.status || 'draft' })
            })),
            delete: options.delete || (() => {
                deletes.push(`doc:${id}`);
                return Promise.resolve();
            }),
            collection: () => ({
                doc: () => ({ id: `history-${id}` })
            })
        };
    }

    const sandbox = {
        window,
        document,
        console: {
            warn: (...args) => warnings.push(args),
            error: (...args) => warnings.push(args),
            log() {}
        },
        setTimeout
    };
    let source = fs.readFileSync(PRODUCTION_SOURCE, 'utf8');
    const exportPattern = /window\.YJEmployeeDocumentRequests = \{\s*init,\s*refresh,\s*openDetail\s*\};/;
    assert.match(source, exportPattern, 'production export shape changed; update only this harness adapter');
    source = source.replace(
        exportPattern,
        `window.YJEmployeeDocumentRequests = {
            init, refresh, openDetail,
            __raceTest: {
                state, submit, refresh, enforceUserContext, addFiles,
                rollbackDraft, buildAttachmentMeta, verifyUploadedObjects,
                cacheDom, renderAttachmentList
            }
        };`
    );
    vm.runInNewContext(source, sandbox, { filename: 'js/employee-document-requests.js' });
    const api = window.YJEmployeeDocumentRequests.__raceTest;
    assert.equal(api.cacheDom(), true);
    api.enforceUserContext();

    function switchUser(uid) {
        auth.uid = uid;
        Object.assign(user, {
            uid,
            auth_uid: uid,
            id: uid,
            name: uid,
            status: 'active'
        });
        api.enforceUserContext();
    }

    function logout() {
        auth.uid = '';
        user.status = 'inactive';
        api.enforceUserContext();
    }

    return {
        api, nodes, auth, user, window, queryQueue, addQueue, docQueue,
        transactionQueue, puts, deletes, liveCalls, warnings,
        switchUser, logout, makeDoc
    };
}

function file(name, size = 10, type = 'application/pdf', putGate) {
    return { name, size, type, putGate };
}

async function flush() {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
}

test('R3-A-01/R3-A-06 A 조회 성공은 B 목록·상세·선택 ID를 변경하지 않는다', async () => {
    const h = createHarness();
    const a = deferred();
    h.queryQueue.push(a);
    const runA = h.api.refresh();
    h.switchUser('B');
    h.api.state.selectedId = 'B-selected';
    const detailBefore = h.nodes.pcEmployeeDocumentDetail.textContent;
    a.resolve(requestSnapshot([{ id: 'A-request', requesterUid: 'A' }]));
    const result = await runA;
    assert.equal(result.reason, 'context-changed');
    assert.equal(h.api.state.requests.length, 0);
    assert.equal(h.api.state.selectedId, 'B-selected');
    assert.equal(h.nodes.pcEmployeeDocumentDetail.textContent, detailBefore);
});

test('R3-A-02 A 조회 실패 문구는 B 화면에 반영되지 않는다', async () => {
    const h = createHarness();
    const a = deferred();
    h.queryQueue.push(a);
    const run = h.api.refresh();
    h.switchUser('B');
    h.nodes.pcEmployeeDocumentMessage.textContent = 'B 최신 메시지';
    a.reject(Object.assign(new Error('late A'), { code: 'permission-denied' }));
    const result = await run;
    assert.equal(result.reason, 'context-changed');
    assert.equal(h.nodes.pcEmployeeDocumentMessage.textContent, 'B 최신 메시지');
});

test('R3-A-03 로그아웃 뒤 A 조회 결과가 재등장하지 않는다', async () => {
    const h = createHarness();
    const a = deferred();
    h.queryQueue.push(a);
    const run = h.api.refresh();
    h.logout();
    a.resolve(requestSnapshot([{ id: 'A-request' }]));
    await run;
    assert.equal(h.api.state.requests.length, 0);
});

test('R3-A-04/R3-A-05 B 결과와 loading은 늦은 A 성공·finally에 유지된다', async () => {
    const h = createHarness();
    const a = deferred();
    const b = deferred();
    h.queryQueue.push(a, b);
    const runA = h.api.refresh();
    h.switchUser('B');
    const runB = h.api.refresh();
    b.resolve(requestSnapshot([{ id: 'B-request', requesterUid: 'B' }]));
    await runB;
    a.resolve(requestSnapshot([{ id: 'A-request', requesterUid: 'A' }]));
    await runA;
    assert.deepEqual(Array.from(h.api.state.requests, item => item.id), ['B-request']);
    assert.equal(h.api.state.loading, false);
});

test('R3-A-05 오래된 A finally는 진행 중인 B loading을 해제하지 않는다', async () => {
    const h = createHarness();
    const a = deferred();
    const b = deferred();
    h.queryQueue.push(a, b);
    const runA = h.api.refresh();
    h.switchUser('B');
    const runB = h.api.refresh();
    a.resolve(requestSnapshot([]));
    await runA;
    assert.equal(h.api.state.loading, true);
    b.resolve(requestSnapshot([]));
    await runB;
});

test('R3-A-07 오래된 A 성공·실패는 LIVE 카드에 전달되지 않는다', async () => {
    const h = createHarness();
    const a = deferred();
    h.queryQueue.push(a);
    const run = h.api.refresh();
    h.switchUser('B');
    a.resolve(requestSnapshot([{ id: 'A-request' }]));
    await run;
    assert.equal(h.liveCalls.length, 0);
});

test('R3-A-08 동일 사용자 정상 조회는 목록과 LIVE 카드에 반영된다', async () => {
    const h = createHarness();
    h.queryQueue.push({ promise: Promise.resolve(requestSnapshot([{ id: 'A-1', requesterUid: 'A' }])) });
    const result = await h.api.refresh();
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(h.api.state.requests, item => item.id), ['A-1']);
    assert.equal(h.liveCalls.length, 1);
});

test('R3-B-01/R5-02 A 늦은 성공은 B 메시지와 폼을 변경하지 않는다', async () => {
    const h = createHarness();
    const add = deferred();
    h.addQueue.push(add);
    const run = h.api.submit({ preventDefault() {} });
    h.switchUser('B');
    const resetCount = h.nodes.pcEmployeeDocumentForm.resetCount || 0;
    h.nodes.pcEmployeeDocumentMessage.textContent = 'B 메시지';
    add.resolve({ id: 'A-request' });
    await run;
    assert.equal(h.nodes.pcEmployeeDocumentMessage.textContent, 'B 메시지');
    assert.equal(h.nodes.pcEmployeeDocumentForm.resetCount || 0, resetCount);
});

test('R5-01 A 늦은 add 실패는 B 오류 문구를 만들지 않는다', async () => {
    const h = createHarness();
    const add = deferred();
    h.addQueue.push(add);
    const run = h.api.submit({ preventDefault() {} });
    h.switchUser('B');
    h.nodes.pcEmployeeDocumentMessage.textContent = 'B 최신';
    add.reject(Object.assign(new Error('late'), { code: 'permission-denied' }));
    await run;
    assert.equal(h.nodes.pcEmployeeDocumentMessage.textContent, 'B 최신');
});

test('R6-01 A 제출 미완료 중 B가 자기 제출을 시작할 수 있다', async () => {
    const h = createHarness();
    const a = deferred();
    const b = deferred();
    h.addQueue.push(a);
    const runA = h.api.submit({ preventDefault() {} });
    h.switchUser('B');
    h.addQueue.push(b);
    const runB = h.api.submit({ preventDefault() {} });
    assert.equal(h.api.state.submitting, true);
    b.resolve({ id: 'B-request' });
    await runB;
    a.resolve({ id: 'A-request' });
    await runA;
});

test('R6-02/R6-03 A 오래된 finally는 B 버튼과 첨부 목록을 변경하지 않는다', async () => {
    const h = createHarness();
    const a = deferred();
    const b = deferred();
    h.addQueue.push(a);
    const runA = h.api.submit({ preventDefault() {} });
    h.switchUser('B');
    h.api.addFiles([file('b.pdf')]);
    h.addQueue.push(b);
    const runB = h.api.submit({ preventDefault() {} });
    const renders = h.nodes.pcEmployeeDocumentAttachmentList.renderCount;
    a.resolve({ id: 'A-request' });
    await runA;
    assert.equal(h.nodes.pcEmployeeDocumentSubmitBtn.disabled, true);
    assert.equal(h.nodes.pcEmployeeDocumentAttachmentList.renderCount, renders);
    b.resolve({ id: 'B-request' });
    await runB;
});

test('R6-04 A→B→A 뒤 최초 A 제출은 새 A 세대에 반영되지 않는다', async () => {
    const h = createHarness();
    const add = deferred();
    h.addQueue.push(add);
    const run = h.api.submit({ preventDefault() {} });
    h.switchUser('B');
    h.switchUser('A');
    h.nodes.pcEmployeeDocumentMessage.textContent = '새 A 세대';
    add.reject(new Error('old A'));
    await run;
    assert.equal(h.nodes.pcEmployeeDocumentMessage.textContent, '새 A 세대');
});

test('R6-05 동일 사용자 버튼 연타는 중복 add를 차단한다', async () => {
    const h = createHarness();
    const add = deferred();
    h.addQueue.push(add);
    const first = h.api.submit({ preventDefault() {} });
    await h.api.submit({ preventDefault() {} });
    assert.equal(h.addQueue.length, 0);
    add.resolve({ id: 'A-request' });
    await first;
});

test('R4-01 제출 성공과 목록 갱신 실패를 구분한다', async () => {
    const h = createHarness();
    h.addQueue.push({ promise: Promise.resolve({ id: 'A-request' }) });
    h.queryQueue.push({ promise: Promise.reject(Object.assign(new Error('query'), { code: 'unavailable' })) });
    await h.api.submit({ preventDefault() {} });
    assert.match(h.nodes.pcEmployeeDocumentMessage.textContent, /제출 완료 · 목록 갱신 실패/);
    assert.match(h.nodes.pcEmployeeDocumentMessage.textContent, /A-request/);
});

test('R4-02 정상 제출 성공 문구는 조회 문구에 덮이지 않는다', async () => {
    const h = createHarness();
    h.addQueue.push({ promise: Promise.resolve({ id: 'A-request' }) });
    h.queryQueue.push({ promise: Promise.resolve(requestSnapshot([])) });
    await h.api.submit({ preventDefault() {} });
    assert.equal(h.nodes.pcEmployeeDocumentMessage.textContent, '문서 결재 요청을 결재 대기로 제출했습니다.');
});

test('R7-01/R7-02 첨부 스냅샷은 원본 배열 교체와 분리된다', async () => {
    const h = createHarness();
    h.api.addFiles([file('a.pdf'), file('a2.pdf')]);
    const draftGate = deferred();
    h.docQueue.push(h.makeDoc('draft-A', { set: () => draftGate.promise }));
    const run = h.api.submit({ preventDefault() {} });
    h.api.state.attachments = [file('mutated.pdf')];
    draftGate.resolve();
    await run;
    assert.equal(h.puts.some(item => item.file.name === 'mutated.pdf'), false);
});

test('R7-03 첫 파일 업로드 중 사용자 변경은 다음 파일을 중단한다', async () => {
    const h = createHarness();
    const gate = deferred();
    h.api.addFiles([file('a.pdf', 10, 'application/pdf', gate), file('a2.pdf')]);
    h.docQueue.push(h.makeDoc('draft-A'));
    const run = h.api.submit({ preventDefault() {} });
    await flush();
    h.switchUser('B');
    gate.resolve();
    await run;
    assert.deepEqual(h.puts.map(item => item.file.name), ['a.pdf']);
});

test('R7-04 중간 파일 업로드 중 사용자 변경은 잔여 업로드를 중단한다', async () => {
    const h = createHarness();
    const gate = deferred();
    h.api.addFiles([file('a.pdf'), file('a2.pdf', 10, 'application/pdf', gate), file('a3.pdf')]);
    h.docQueue.push(h.makeDoc('draft-A'));
    const run = h.api.submit({ preventDefault() {} });
    while (h.puts.length < 2) await flush();
    h.switchUser('B');
    gate.resolve();
    await run;
    assert.deepEqual(h.puts.map(item => item.file.name), ['a.pdf', 'a2.pdf']);
});

test('R7-05 B 새 파일은 A Storage 경로에 사용되지 않는다', async () => {
    const h = createHarness();
    const gate = deferred();
    h.api.addFiles([file('a.pdf', 10, 'application/pdf', gate)]);
    h.docQueue.push(h.makeDoc('draft-A'));
    const run = h.api.submit({ preventDefault() {} });
    await flush();
    h.switchUser('B');
    h.api.addFiles([file('b.pdf')]);
    gate.resolve();
    await run;
    assert.equal(h.puts.some(item => item.file.name === 'b.pdf' && item.path.includes('/A/')), false);
});

test('R7-06 업로드 후 컨텍스트 검사가 pending 전환을 차단한다', async () => {
    const h = createHarness();
    const gate = deferred();
    h.api.addFiles([file('a.pdf', 10, 'application/pdf', gate)]);
    h.docQueue.push(h.makeDoc('draft-A'));
    const run = h.api.submit({ preventDefault() {} });
    await flush();
    h.switchUser('B');
    gate.resolve();
    await run;
    assert.equal(h.transactionQueue.length, 0);
});

test('R3-C-01 metadata 확인 중 사용자 변경은 pending 전환 0건', async () => {
    const source = fs.readFileSync(PRODUCTION_SOURCE, 'utf8');
    const verification = source.indexOf('const verification = await verifyUploadedObjects(meta)');
    const guard = source.indexOf('if (!contextUnchanged(captured))', verification);
    const transaction = source.indexOf('await window.db.runTransaction', verification);
    assert.ok(verification >= 0 && guard > verification && transaction > guard);
});

test('R3-C-02 트랜잭션 완료 뒤 변경은 성공 문구와 폼 reset을 차단한다', async () => {
    const h = createHarness();
    const tx = deferred();
    h.api.addFiles([file('a.pdf')]);
    h.docQueue.push(h.makeDoc('draft-A'));
    h.transactionQueue.push(tx);
    const run = h.api.submit({ preventDefault() {} });
    while (h.puts.length < 1) await flush();
    h.switchUser('B');
    const resets = h.nodes.pcEmployeeDocumentForm.resetCount || 0;
    tx.resolve();
    await run;
    assert.equal(h.nodes.pcEmployeeDocumentForm.resetCount || 0, resets);
    assert.doesNotMatch(h.nodes.pcEmployeeDocumentMessage.textContent, /제출했습니다/);
});

test('R3-C-03/R3-C-04 pending 재확인 중 사용자 변경은 성공 확정·삭제 0건', async () => {
    const h = createHarness();
    const getGate = deferred();
    const doc = h.makeDoc('draft-A', {
        get: async () => {
            await getGate.promise;
            return { exists: true, data: () => ({ status: 'pending' }) };
        }
    });
    const rollback = h.api.rollbackDraft(doc, ['path/A']);
    h.switchUser('B');
    getGate.resolve();
    const result = await rollback;
    assert.equal(result.outcome, 'submitted');
    assert.equal(h.deletes.length, 0);
});

test('R3-C-05 사용자 변경 뒤 제출 catch는 파괴적 rollback 0건', async () => {
    const h = createHarness();
    const gate = deferred();
    const doc = h.makeDoc('draft-A');
    h.api.addFiles([file('a.pdf', 10, 'application/pdf', gate)]);
    h.docQueue.push(doc);
    const run = h.api.submit({ preventDefault() {} });
    await flush();
    h.switchUser('B');
    gate.reject(new Error('upload failed'));
    await run;
    assert.equal(h.deletes.length, 0);
});

test('D3-01 동일 사용자 draft 정리 성공 경로를 유지한다', async () => {
    const h = createHarness();
    const doc = h.makeDoc('draft-A');
    const result = await h.api.rollbackDraft(doc, ['path/A']);
    assert.equal(result.outcome, 'cleaned');
    assert.deepEqual(h.deletes, ['path/A', 'doc:draft-A']);
});

test('D3-02 상태 불명확 시 draft 삭제를 금지한다', async () => {
    const h = createHarness();
    const doc = h.makeDoc('draft-A', { get: () => Promise.reject(new Error('unknown')) });
    const result = await h.api.rollbackDraft(doc, ['path/A']);
    assert.equal(result.outcome, 'unknown');
    assert.equal(h.deletes.length, 0);
});

test('D3-03 Storage 객체 삭제 실패 시 draft 삭제를 금지한다', async () => {
    const h = createHarness();
    h.window.storage.ref = () => ({ delete: () => Promise.reject(Object.assign(new Error('denied'), { code: 'storage/unauthorized' })) });
    const result = await h.api.rollbackDraft(h.makeDoc('draft-A'), ['path/A']);
    assert.equal(result.outcome, 'cleanup-failed');
    assert.equal(h.deletes.some(item => item === 'doc:draft-A'), false);
});

test('CONTRACT-01 첨부 메타는 정확한 4개 필드만 생성한다', () => {
    const h = createHarness();
    const meta = h.api.buildAttachmentMeta('A', 'request-1', [{
        name: 'a.pdf', size: 10, contentType: 'application/pdf', file: file('a.pdf')
    }]);
    assert.deepEqual(Object.keys(meta.attachments.a0).sort(), ['contentType', 'name', 'size', 'storagePath']);
});

test('CONTRACT-02 최대 5개·파일당 10MB·합계 30MB 상수를 유지한다', () => {
    const source = fs.readFileSync(PRODUCTION_SOURCE, 'utf8');
    assert.match(source, /const ATTACH_MAX_FILES = 5;/);
    assert.match(source, /const ATTACH_MAX_FILE_BYTES = 10 \* 1024 \* 1024;/);
    assert.match(source, /const ATTACH_MAX_TOTAL_BYTES = 30 \* 1024 \* 1024;/);
});

test('CONTRACT-03 metadata 확인·스냅샷 순회·안전 렌더 계약을 유지한다', () => {
    const source = fs.readFileSync(PRODUCTION_SOURCE, 'utf8');
    assert.match(source, /verifyUploadedObjects\(meta\)/);
    assert.equal(/for \(let i = 0; i < state\.attachments\.length/.test(source), false);
    assert.equal(/\.innerHTML\s*=/.test(source), false);
    assert.equal(/_blank/.test(source), false);
});
