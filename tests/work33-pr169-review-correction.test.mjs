import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach(name => this.values.add(name)); }
    remove(...names) { names.forEach(name => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
        const next = force === undefined ? !this.values.has(name) : force;
        next ? this.values.add(name) : this.values.delete(name);
        return next;
    }
}

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.classList = new FakeClassList();
        this.style = {};
        this.dataset = {};
        this.disabled = false;
        this.id = '';
        this.className = '';
        this._text = '';
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
    addEventListener() {}
    scrollIntoView() {}
    set textContent(value) { this._text = String(value ?? ''); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
}

function findById(node, id) {
    if (node.id === id) return node;
    for (const child of node.children) {
        const found = findById(child, id);
        if (found) return found;
    }
    return null;
}

async function loadDashboardHarness() {
    const source = await readFile(new URL('../js/approval-dashboard.js', import.meta.url), 'utf8');
    const body = new FakeElement('body');
    const listeners = new Map();
    const document = {
        readyState: 'loading',
        body,
        createElement: tag => new FakeElement(tag),
        getElementById: id => findById(body, id),
        querySelector: () => null,
        addEventListener() {}
    };
    const window = {
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
        printCalls: 0,
        print() { this.printCalls += 1; },
        console
    };
    const context = { window, document, console, firebase: {}, setTimeout, clearTimeout };
    vm.runInNewContext(source, context, { filename: 'approval-dashboard.js' });
    return { api: window.YJApprovalDashboard.__test, window, document, listeners };
}

async function loadLiveHubHarness() {
    const source = await readFile(new URL('../js/live-operations-hub.js', import.meta.url), 'utf8');
    const document = {
        getElementById: () => null,
        createElement: tag => new FakeElement(tag),
        querySelectorAll: () => [],
        addEventListener() {}
    };
    const window = {
        currentUser: { uid: 'admin-1', role: 'admin', status: 'active' },
        addEventListener() {},
        setTimeout,
        console
    };
    vm.runInNewContext(source, { window, document, console, Date, setTimeout, clearTimeout }, { filename: 'live-operations-hub.js' });
    return window.YJLiveOperationsHub;
}

test('R1: list failure clears prior list, selection, history, print and query time', async () => {
    const { api, document } = await loadDashboardHarness();
    const tbody = new FakeElement('tbody');
    const detail = new FakeElement('div');
    const printArea = new FakeElement('div');
    printArea.appendChild(new FakeElement('p'));
    const lastQuery = new FakeElement('span');
    lastQuery.textContent = '이전 성공 시각';
    const printBtn = new FakeElement('button');
    const historySeq = 7;
    api.setDom({ tbody, detail, printArea, lastQuery, printBtn, pageInfo: new FakeElement('span'), prevBtn: new FakeElement('button'), nextBtn: new FakeElement('button') });
    api.seedState({
        rows: [{ id: 'old-1', title: '이전 문서' }],
        selectedId: 'old-1',
        _lastHistory: [{ id: 'history-1' }],
        _historyForId: 'old-1',
        lastQueryAt: new Date(),
        hasNext: true,
        historySeq,
        loading: true
    });
    const stalePrintHost = new FakeElement('div');
    stalePrintHost.id = 'yjApprovalDashboardPrintHost';
    document.body.appendChild(stalePrintHost);

    api.failListClosed({ code: 'unavailable' });
    const state = api.state();
    assert.equal(state.rows.length, 0);
    assert.equal(state.selectedId, '');
    assert.equal(state._lastHistory, null);
    assert.equal(state._historyForId, '');
    assert.equal(state.lastQueryAt, null);
    assert.equal(state.hasNext, false);
    assert.ok(state.historySeq > historySeq);
    assert.equal(printArea.children.length, 0);
    assert.equal(printBtn.disabled, true);
    assert.equal(lastQuery.textContent, '');
    assert.equal(document.getElementById('yjApprovalDashboardPrintHost'), null);

    state.filters.status = 'approved';
    state.filters.requestType = 'document';
    state.filters.search = '이전';
    api.renderTable();
    assert.doesNotMatch(tbody.textContent, /이전 문서/);
});

test('R1: a slow older success cannot overwrite the newer fail-closed state', async () => {
    const { api, window } = await loadDashboardHarness();
    const tbody = new FakeElement('tbody');
    api.setDom({ tbody, detail: new FakeElement('div'), printArea: new FakeElement('div'), printBtn: new FakeElement('button'), lastQuery: new FakeElement('span'), pageInfo: new FakeElement('span'), prevBtn: new FakeElement('button'), nextBtn: new FakeElement('button') });
    api.seedState({ user: { uid: 'admin-1' }, isAdmin: true, rows: [], startCursors: [], pageIndex: 0, filters: { period: 'all', start: '', end: '', status: 'all', requestType: 'all', search: '' } });

    const pending = [];
    window.db = {
        collection() {
            const query = {
                orderBy() { return query; },
                limit() { return query; },
                startAfter() { return query; },
                get() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
            };
            return query;
        }
    };

    const older = api.loadList();
    const newer = api.loadList();
    pending[1].reject({ code: 'unavailable' });
    await newer;
    pending[0].resolve({ docs: [{ id: 'stale-1', data: () => ({ title: '늦은 이전 문서' }) }] });
    await older;

    assert.equal(api.state().rows.length, 0);
    assert.doesNotMatch(tbody.textContent, /늦은 이전 문서/);
});

test('R2: print uses one body-direct host and afterprint removes all print state', async () => {
    const { api, window, document, listeners } = await loadDashboardHarness();
    const request = { id: 'req-1', title: '인쇄 문서', status: 'approved', requesterName: '관리자', createdAt: Date.now(), description: '안전한 본문' };
    api.setDom({ printBtn: new FakeElement('button') });
    api.seedState({ rows: [request], selectedId: 'req-1', _lastHistory: [{ action: 'approve', createdAt: Date.now() }], _historyForId: 'req-1' });

    api.doPrint();
    let host = document.getElementById('yjApprovalDashboardPrintHost');
    assert.equal(host.parentNode, document.body);
    assert.match(host.textContent, /인쇄 문서/);
    assert.match(host.textContent, /결재 이력/);
    assert.equal(window.printCalls, 1);
    assert.equal(document.body.classList.contains('yj-approval-dashboard-printing'), true);

    api.doPrint();
    assert.equal(document.body.children.filter(child => child.id === 'yjApprovalDashboardPrintHost').length, 1);
    assert.equal(window.printCalls, 2);
    listeners.get('afterprint')();
    assert.equal(document.getElementById('yjApprovalDashboardPrintHost'), null);
    assert.equal(document.body.classList.contains('yj-approval-dashboard-printing'), false);
});

test('R3: shared summary preserves active counts and computes recent partial by oldest row', async () => {
    const hub = await loadLiveHubHarness();
    const now = Date.now();
    const old = now - 9 * 24 * 60 * 60 * 1000;
    const recent = now - 2 * 24 * 60 * 60 * 1000;
    hub.__test.seedDocCard({ pending: 41, onHold: 9, adminActiveCapped: true });

    hub.updateApprovalDashboardSummary({
        role: 'admin',
        rows: [{ id: 'a', status: 'approved', createdAt: recent }, { id: 'p', status: 'pending', createdAt: old }],
        over: true,
        limit: 500
    });
    let card = hub.__test.docCardState();
    assert.equal(card.pending, 41);
    assert.equal(card.onHold, 9);
    assert.equal(card.adminActiveCapped, true);
    assert.equal(card.approved7, 1);
    assert.equal(card.adminRecentPartial, false);
    assert.equal(card.adminRecentLimit, 500);

    const partial = hub.__test.deriveAdminRecentSummary([{ status: 'rejected', createdAt: recent }], true, 500, now);
    assert.equal(partial.partial, true);
    assert.equal(partial.rejected7, 1);

    hub.updateApprovalDashboardSummary({ role: 'admin', error: true, code: 'unavailable' });
    card = hub.__test.docCardState();
    assert.equal(card.pending, 41);
    assert.equal(card.onHold, 9);
    assert.equal(card.approved7, 0);
    assert.equal(card.rejected7, 0);
    assert.equal(card.recent.length, 0);
    assert.equal(card.status, 'error');
});
