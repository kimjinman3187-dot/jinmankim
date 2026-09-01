import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('WORK40: PC navigation uses Korean task labels', () => {
    const expected = [
        ['dashboard', '업무 홈'],
        ['docbox', '내 결재문서'],
        ['approval', '결재 처리'],
        ['sales', '영업·주문'],
        ['accounting', '회계'],
        ['receivables', '미수금'],
        ['factory', '생산'],
        ['inventory', '재고']
    ];
    expected.forEach(([id, label]) => {
        assert.match(indexHtml, new RegExp(`id="pc-tab-${id}"[^>]*>[\\s\\S]*?<span>${label}</span>`));
    });
});

test('WORK40: user display is team and name without auth provider text', () => {
    const formatter = indexHtml.match(/function getCurrentUserDisplayText\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(formatter, /sales: '영업팀'/);
    assert.match(formatter, /accounting: '회계팀'/);
    assert.match(formatter, /factory: '생산팀'/);
    assert.match(formatter, /`\$\{name\} · 관리자`/);
    assert.doesNotMatch(formatter, /Google|PIN|provider/);
    const pcUserHeader = indexHtml.match(/id="pcDisplayUser"[\s\S]*?<\/header>/)?.[0] || '';
    assert.match(pcUserHeader, />계정 전환</);
    assert.doesNotMatch(pcUserHeader, /Google 계정전환/);
});

test('WORK40: right detail panel is collapsed until a row is selected', () => {
    assert.match(indexHtml, /id="rightDetailPanel" class="hidden /);
    assert.match(indexHtml, /if \(detailPanel\) detailPanel\.classList\.add\('hidden'\)/);
    assert.match(indexHtml, /if \(detailPanel\) detailPanel\.classList\.remove\('hidden'\)/);
});
