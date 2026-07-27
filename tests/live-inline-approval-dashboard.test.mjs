import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const standaloneHtml = await readFile(new URL('../approval-dashboard.html', import.meta.url), 'utf8');
const dashboardJs = await readFile(new URL('../js/approval-dashboard.js', import.meta.url), 'utf8');
const liveHubJs = await readFile(new URL('../js/live-operations-hub.js', import.meta.url), 'utf8');
const dashboardCss = await readFile(new URL('../approval-dashboard.css', import.meta.url), 'utf8');

const requiredIds = [
    'dash_authState', 'dash_body', 'dash_userInfo', 'dash_scopeNote', 'dash_summary',
    'dash_filterPeriod', 'dash_customRange', 'dash_startDate', 'dash_endDate',
    'dash_filterStatus', 'dash_filterType', 'dash_search', 'dash_refreshBtn',
    'dash_lastQuery', 'dash_tbody', 'dash_listNote', 'dash_pageInfo',
    'dash_prevBtn', 'dash_nextBtn', 'dash_detail', 'dash_printArea', 'dash_printBtn'
];

test('LIVE dashboard embeds the complete read-only approval surface', () => {
    assert.match(indexHtml, /id="pc-page-dashboard"/);
    assert.match(indexHtml, /id="pcLiveDocumentApprovalDashboard"[^>]+data-yj-approval-dashboard/);
    for (const id of requiredIds) {
        const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
        assert.equal(matches.length, 1, `${id} must occur exactly once in index.html`);
    }
    assert.match(indexHtml, /href="approval-dashboard\.css"/);
    assert.match(indexHtml, /src="js\/approval-dashboard\.js"/);
    assert.doesNotMatch(indexHtml, /<iframe\b/i);
});

test('summary navigation stays in LIVE and scrolls to the inline dashboard', () => {
    assert.doesNotMatch(liveHubJs, /window\.location\.href\s*=\s*['"]approval-dashboard\.html/);
    assert.match(liveHubJs, /scrollToPanel\('pcLiveDocumentApprovalDashboard'\)/);
    assert.match(liveHubJs, /updateApprovalDashboardSummary/);
    assert.match(liveHubJs, /if \(\$\('pcLiveDocumentApprovalDashboard'\)\) return;/);
});

test('dashboard has one reusable mount and remains read-only', () => {
    assert.match(dashboardJs, /mount:\s*init/);
    assert.match(dashboardJs, /state\.initialized/);
    assert.match(dashboardJs, /querySelector\('\[data-yj-approval-dashboard\]'\)/);
    assert.match(dashboardJs, /if \(!window\.auth \|\| !window\.db\) \{\s*try \{\s*window\.FirebaseShared\.initializeFirebase\(\)/);
    assert.doesNotMatch(dashboardJs, /\.onSnapshot\s*\(/);
    const withoutDomClassAdds = dashboardJs.replace(/classList\.add\s*\(/g, 'classListAdd(');
    assert.doesNotMatch(withoutDomClassAdds, /\.(?:add|set|update|delete)\s*\(/);
    assert.match(dashboardJs, /baseListQuery\(range\)\.limit\(PAGE_SIZE \+ 1\)/);
    assert.match(dashboardJs, /\.limit\(SUMMARY_CAP \+ 1\)\.get\(\)/);
});

test('standalone entry point reuses the same component contract', () => {
    assert.match(standaloneHtml, /data-yj-approval-dashboard/);
    assert.match(standaloneHtml, /href="approval-dashboard\.css"/);
    assert.match(standaloneHtml, /src="js\/approval-dashboard\.js"/);
    for (const id of requiredIds) assert.match(standaloneHtml, new RegExp(`id="${id}"`));
});

test('shared styles are scoped and support inline printing', () => {
    assert.match(dashboardCss, /\.yj-approval-dashboard \{/);
    assert.match(dashboardCss, /body\.yj-approval-dashboard-printing/);
    assert.doesNotMatch(dashboardCss, /(?:^|\n)\s*button\s*\{/);
    assert.doesNotMatch(dashboardCss, /(?:^|\n)\s*table\s*\{/);
});
