import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fakeEmbedder } from './embeddings';
import { calibrate, cosine, isRoomKey, loadSecretWords, normalizeWord, toScore } from './words';

test('normalizeWord takes one Hangul word and nothing else', () => {
    assert.equal(normalizeWord(' 바다 '), '바다');
    assert.equal(normalizeWord('바다 소리'), null);
    assert.equal(normalizeWord('sea'), null);
    assert.equal(normalizeWord('ㅋㅋ'), null);
    assert.equal(normalizeWord(''), null);
    assert.equal(normalizeWord('가'.repeat(21)), null);
    assert.equal(normalizeWord(42), null);
});

test('cosine and toScore', () => {
    assert.equal(toScore(cosine([1, 0], [1, 0])), 100);
    assert.equal(toScore(cosine([1, 0], [0, 1])), 0);
    assert.equal(cosine([0, 0], [1, 0]), 0);
});

test('the example word list loads without the private one', () => {
    const words = loadSecretWords();
    assert.ok(words.length > 0);
    assert.ok(words.every(word => normalizeWord(word) === word));
});

test('the fake embedder scores shared syllables higher', async () => {
    const [sea, seaside, school] = await fakeEmbedder.embed(['바다', '바닷가', '학교']);
    assert.ok(cosine(sea, seaside) > cosine(sea, school));
});

test('calibrate puts the average word at 0 and the hidden word at 1', () => {
    assert.equal(calibrate(0.8, 0.8), 0);
    assert.equal(calibrate(1, 0.8), 1);
    assert.ok(calibrate(0.7, 0.8) < 0);
    assert.equal(calibrate(0.5, 1), 0.5);
});

test('isRoomKey takes a hex SHA-256 and nothing else', () => {
    assert.ok(isRoomKey('a'.repeat(64)));
    assert.ok(!isRoomKey('A'.repeat(64)));
    assert.ok(!isRoomKey('a'.repeat(63)));
    assert.ok(!isRoomKey('room-games'));
    assert.ok(!isRoomKey(undefined));
});
