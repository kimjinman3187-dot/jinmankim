import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../docs/schedule/schedule-auto-reflect.js', import.meta.url), 'utf8');

function loadApi(document) {
    const window = { fetch: undefined };
    vm.runInNewContext(source, { window, document, globalThis: window, console, Date, Error, module: undefined }, { filename: 'schedule-auto-reflect.js' });
    return window.YJScheduleAutoReflect;
}

function merged(number, workId, updatedAt = '2026-07-28T00:00:00Z') {
    return {
        number,
        title: `${workId}: completed`,
        body: '',
        head: { ref: `codex/${workId.toLowerCase()}` },
        updated_at: updatedAt,
        merged_at: updatedAt
    };
}

function open(number, workId, draft = false) {
    return {
        number,
        title: `${workId}: in progress`,
        body: '',
        head: { ref: `codex/${workId.toLowerCase()}` },
        updated_at: '2026-07-28T01:00:00Z',
        merged_at: null,
        draft
    };
}

test('merged PRs complete WORK31-WORK33 and expose WORK34 as next work', () => {
    const api = loadApi(undefined);
    const schedule = api.computeSchedule([merged(167, 'WORK31'), merged(168, 'WORK32'), merged(169, 'WORK33')]);
    assert.equal(schedule.completed, 3);
    assert.equal(schedule.total, 4);
    assert.equal(schedule.progress, 75);
    assert.equal(schedule.releaseReady, false);
    assert.equal(schedule.nextWork, 'WORK34');
});

test('open or draft PR does not complete a work item', () => {
    const api = loadApi(undefined);
    const schedule = api.computeSchedule([
        merged(167, 'WORK31'), merged(168, 'WORK32'), merged(169, 'WORK33'),
        open(170, 'WORK34', true)
    ]);
    assert.equal(schedule.completed, 3);
    assert.equal(schedule.items.find(item => item.id === 'WORK34').state, 'in_progress');
    assert.equal(schedule.releaseReady, false);
});

test('repeated and duplicate merged PR data is idempotent', () => {
    const api = loadApi(undefined);
    const pulls = [
        merged(167, 'WORK31'),
        merged(167, 'WORK31', '2026-07-28T02:00:00Z'),
        merged(168, 'WORK32'),
        merged(169, 'WORK33'),
        merged(170, 'WORK34')
    ];
    const first = api.computeSchedule(pulls);
    const second = api.computeSchedule(pulls.concat(pulls));
    assert.equal(first.completed, 4);
    assert.equal(second.completed, 4);
    assert.equal(second.progress, 100);
    assert.equal(second.releaseReady, true);
    assert.equal(second.nextWork, '없음');
});

test('a later open PR cannot regress an already merged WORK', () => {
    const api = loadApi(undefined);
    const schedule = api.computeSchedule([
        merged(167, 'WORK31'),
        merged(168, 'WORK32'),
        merged(169, 'WORK33'),
        merged(170, 'WORK34', '2026-07-28T01:00:00Z'),
        open(171, 'WORK34')
    ]);
    assert.equal(schedule.completed, 4);
    assert.equal(schedule.items.find(item => item.id === 'WORK34').prNumber, 170);
    assert.equal(schedule.releaseReady, true);
});

test('sync failure preserves the last rendered schedule metrics', async () => {
    const nodes = new Map();
    for (const id of ['scheduleCompletedCount', 'scheduleProgressValue', 'scheduleReleaseState', 'scheduleNextWork', 'scheduleProgressBar', 'scheduleWorkBody', 'scheduleSyncState']) {
        nodes.set(id, { id, textContent: '', className: '', style: {}, appendChild() {} });
    }
    nodes.get('scheduleCompletedCount').textContent = '3 / 4';
    nodes.get('scheduleProgressValue').textContent = '75%';
    nodes.get('scheduleNextWork').textContent = 'WORK34';
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById: id => nodes.get(id) || null,
        createElement: () => ({ textContent: '', className: '', append() {} })
    };
    const api = loadApi(document);
    const result = await api.sync({ fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(result.ok, false);
    assert.equal(nodes.get('scheduleCompletedCount').textContent, '3 / 4');
    assert.equal(nodes.get('scheduleProgressValue').textContent, '75%');
    assert.equal(nodes.get('scheduleNextWork').textContent, 'WORK34');
    assert.match(nodes.get('scheduleSyncState').textContent, /마지막 정상 Schedule을 유지/);
});
