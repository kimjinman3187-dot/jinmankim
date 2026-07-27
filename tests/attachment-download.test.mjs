import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const PRODUCTION_SOURCE = new URL('../js/firebase-shared.js', import.meta.url);

function downloadInstallerSource() {
    const source = fs.readFileSync(PRODUCTION_SOURCE, 'utf8');
    const start = source.indexOf('(function installYJAttachmentDownload()');
    assert.notEqual(start, -1, 'attachment download installer not found in production source');
    const end = source.indexOf('})();', start);
    assert.notEqual(end, -1, 'attachment download installer end not found');
    return { source, installer: source.slice(start, end + 5) };
}

function createHarness(options = {}) {
    const anchors = [];
    const appended = [];
    const removed = [];
    const revoked = [];
    const createdUrls = [];
    const warnings = [];
    const blob = options.blob || { kind: 'blob' };
    const anchorFactory = () => {
        const anchor = {
            href: '',
            download: '',
            rel: '',
            clicked: false,
            click() { this.clicked = true; },
            remove() { removed.push(this); }
        };
        anchors.push(anchor);
        return anchor;
    };
    const document = {
        body: {
            appendChild(anchor) {
                appended.push(anchor);
            }
        },
        createElement(tag) {
            assert.equal(tag, 'a');
            return anchorFactory();
        }
    };
    const window = {
        storage: {
            ref(path) {
                return {
                    async getDownloadURL() {
                        if (options.urlError) throw options.urlError;
                        return options.url || `https://storage.example/${path}`;
                    }
                };
            }
        },
        setTimeout(callback) {
            callback();
        }
    };
    const URL = {
        createObjectURL(value) {
            assert.equal(value, blob);
            const url = 'blob:attachment';
            createdUrls.push(url);
            return url;
        },
        revokeObjectURL(url) {
            revoked.push(url);
        }
    };
    const fetch = async url => {
        if (options.fetchError) throw options.fetchError;
        return {
            ok: options.httpStatus ? options.httpStatus >= 200 && options.httpStatus < 300 : true,
            status: options.httpStatus || 200,
            async blob() {
                if (options.blobError) throw options.blobError;
                return blob;
            },
            url
        };
    };
    const sandbox = {
        window,
        document,
        URL,
        fetch,
        console: { warn: (...args) => warnings.push(args) }
    };
    const { source, installer } = downloadInstallerSource();
    vm.runInNewContext(installer, sandbox, { filename: 'js/firebase-shared.js#attachment-download' });
    return {
        source,
        window,
        anchors,
        appended,
        removed,
        revoked,
        createdUrls,
        warnings,
        download: window.yjDownloadAttachment,
        message: window.yjAttachmentDownloadMessage
    };
}

test('D4-P-01 정상 getDownloadURL → fetch → blob 다운로드 성공', async () => {
    const h = createHarness();
    const result = await h.download('document-approval-attachments/A/request/a0', '증빙.pdf');
    assert.deepEqual({ ...result }, { ok: true, code: '' });
    assert.equal(h.anchors[0].clicked, true);
});

test('D4-P-02 원래 파일명이 anchor download 속성에 적용된다', async () => {
    const h = createHarness();
    await h.download('path/a0', '원래이름.pdf');
    assert.equal(h.anchors[0].download, '원래이름.pdf');
});

test('D4-P-03 Object URL 생성 후 revoke가 실행된다', async () => {
    const h = createHarness();
    await h.download('path/a0', 'a.pdf');
    assert.deepEqual(h.createdUrls, ['blob:attachment']);
    assert.deepEqual(h.revoked, ['blob:attachment']);
});

test('D4-P-04 임시 anchor는 클릭 후 제거된다', async () => {
    const h = createHarness();
    await h.download('path/a0', 'a.pdf');
    assert.equal(h.appended.length, 1);
    assert.equal(h.removed.length, 1);
    assert.equal(h.removed[0], h.appended[0]);
});

test('D4-P-05 storage/unauthorized는 permission-denied로 반환된다', async () => {
    const h = createHarness({ urlError: { code: 'storage/unauthorized' } });
    const result = await h.download('path/a0', 'a.pdf');
    assert.equal(result.code, 'permission-denied');
});

test('D4-P-06 storage/object-not-found는 not-found로 반환된다', async () => {
    const h = createHarness({ urlError: { code: 'storage/object-not-found' } });
    const result = await h.download('path/a0', 'a.pdf');
    assert.equal(result.code, 'not-found');
});

test('D4-P-07 HTTP 403은 permission-denied로 반환된다', async () => {
    const h = createHarness({ httpStatus: 403 });
    const result = await h.download('path/a0', 'a.pdf');
    assert.equal(result.code, 'permission-denied');
});

test('D4-P-08 그 외 비정상 HTTP 응답은 fetch-failed로 반환된다', async () => {
    const h = createHarness({ httpStatus: 500 });
    const result = await h.download('path/a0', 'a.pdf');
    assert.equal(result.code, 'fetch-failed');
});

test('D4-P-09 fetch와 blob 예외는 network-or-cors로 반환된다', async t => {
    await t.test('fetch 예외', async () => {
        const h = createHarness({ fetchError: new TypeError('Failed to fetch') });
        const result = await h.download('path/a0', 'a.pdf');
        assert.equal(result.code, 'network-or-cors');
    });
    await t.test('blob 읽기 예외', async () => {
        const h = createHarness({ blobError: new Error('body stream failed') });
        const result = await h.download('path/a0', 'a.pdf');
        assert.equal(result.code, 'network-or-cors');
    });
});

test('D4-P-10 사용자 문구는 CORS 확정 표현을 사용하지 않는다', () => {
    const h = createHarness();
    const message = h.message('network-or-cors');
    assert.match(message, /네트워크 또는 브라우저 교차 출처 정책/);
    assert.doesNotMatch(message, /CORS GATE FAILED/);
});

test('D4-P-11 _blank와 새 탭 fallback은 0건이다', () => {
    const { source } = downloadInstallerSource();
    const activeSource = source.replace(/\/\/.*$/gm, '');
    assert.equal(/_blank/.test(activeSource), false);
    assert.equal(/window\.open\s*\(/.test(activeSource), false);
});

test('D4-P-12 다운로드 URL 영구 저장은 0건이다', () => {
    const { installer } = downloadInstallerSource();
    assert.equal(/localStorage|sessionStorage|firestore|collection\s*\(/.test(installer), false);
    assert.match(installer, /url = '';/);
});
