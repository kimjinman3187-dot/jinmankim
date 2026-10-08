import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const requestSource = fs.readFileSync(new URL('../js/employee-document-requests.js', import.meta.url), 'utf8');

function extractBetween(source, start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert.notEqual(startIndex, -1, `${start} 시작점을 찾을 수 없습니다.`);
    assert.notEqual(endIndex, -1, `${end} 종료점을 찾을 수 없습니다.`);
    return source.slice(startIndex, endIndex);
}

function classList() {
    const values = new Set(['hidden']);
    return {
        toggle(name, force) {
            if (force) values.add(name);
            else values.delete(name);
        },
        contains(name) {
            return values.has(name);
        }
    };
}

test('Google 팝업 뒤 뷰포트가 복원되면 인증 화면도 PC 화면으로 전환된다', () => {
    const appPC = { classList: classList(), style: {} };
    const appMobile = { classList: classList(), style: {} };
    const listeners = {};
    const switchedTabs = [];
    const sandbox = {
        currentUser: { role: 'admin' },
        googleGateActive: false,
        window: {
            innerWidth: 640,
            addEventListener(type, listener) {
                listeners[type] = listener;
            }
        },
        document: {
            getElementById(id) {
                return id === 'appPC' ? appPC : id === 'appMobile' ? appMobile : null;
            }
        },
        sessionStorage: { setItem() {} },
        location: { hash: '#docbox' },
        getDefaultPCTab: () => 'docbox',
        getHashTargetTab: () => 'docbox',
        getAllowedPCTabs: () => ['dashboard', 'docbox'],
        getAccessAreaForTab: tab => tab,
        canView: () => true,
        switchPCTab: tab => switchedTabs.push(tab),
        enforceCurrentHashAccess() {}
    };
    vm.createContext(sandbox);
    const shellSource = extractBetween(
        indexSource,
        "let authenticatedShellMode = '';",
        'function processLoginSuccess()'
    );
    vm.runInContext(shellSource, sandbox);

    vm.runInContext('syncAuthenticatedShellForViewport()', sandbox);
    assert.equal(appMobile.style.display, 'flex');
    assert.equal(appPC.style.display, 'none');

    sandbox.window.innerWidth = 1200;
    listeners.resize();
    assert.equal(appPC.style.display, 'flex');
    assert.equal(appMobile.style.display, 'none');
    assert.deepEqual(switchedTabs, ['docbox']);
});

test('운영 로그인 준비 중 users 목록을 읽지 않고 Google 로그인 안내를 유지한다', () => {
    const syncUsersSource = extractBetween(indexSource, 'async function syncUsers()', 'function chooseUser(');
    assert.match(syncUsersSource, /if\(AUTH_DEV_MODE && typeof db !== 'undefined'\)/);
    assert.doesNotMatch(indexSource, /Login is disabled unless dev auth fallback/);
});

test('지출 결재 본인 조회는 별도 복합 인덱스 없이 수행하고 화면에서 최신순 정렬한다', () => {
    const refreshSource = extractBetween(requestSource, 'async function refresh()', 'function bindEvents(');
    const expenseQuery = extractBetween(
        refreshSource,
        'window.db.collection(EXPENSE_COLLECTION)',
        ']);'
    );
    assert.match(expenseQuery, /where\('requesterUid', '==', ready\.auth\.uid\)/);
    assert.doesNotMatch(expenseQuery, /orderBy|limit/);
    assert.match(refreshSource, /\.sort\(\(a, b\) =>/);
    assert.match(refreshSource, /\.slice\(0, LIMIT\)/);
});

test('WORK58 배포 파일은 캐시 버전을 명시한다', () => {
    assert.match(indexSource, /employee-document-requests\.js\?v=20261008-work58/);
});
