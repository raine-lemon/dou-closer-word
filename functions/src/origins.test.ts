import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowedOrigins, isAllowed } from './origins';

test('the page origins are allowed and others are not', () => {
    const list = allowedOrigins('https://abc.trycloudflare.com');
    assert.ok(isAllowed('https://closer-word-x1.apps.chatic.io', list));
    assert.ok(isAllowed('https://closer-word.apps-dev.chatic.io', list));
    assert.ok(isAllowed('http://localhost:5180', list));
    assert.ok(isAllowed('https://abc.trycloudflare.com', list));
    assert.ok(!isAllowed('https://evil.example.com', list));
    assert.ok(!isAllowed('https://apps.chatic.io.evil.com', list));
    assert.ok(!isAllowed('http://x.apps.chatic.io', list));
    assert.ok(!isAllowed('https://a.b.apps.chatic.io', list));
});
