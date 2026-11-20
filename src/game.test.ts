import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CloudChat } from '@lemoncloud/chatic-apps-sdk';

import { ago, guessOf, withGwa, guessText, IDLE_MS, mayStart, rankOf, readRoom, startText, type RoomFacts } from './game.ts';

const T0 = 1_700_000_000_000;
let no = 0;
const chat = (ownerId: string, content: string, minutes = no): CloudChat => {
    no += 1;
    return {
        id: `c${no}`,
        cid: 'cloud',
        channelId: 'room',
        chatNo: no,
        ownerId,
        isPending: false,
        isFailed: false,
        createdAtMs: T0 + minutes * 60_000,
        updatedAtMs: T0,
        content,
    };
};
const facts = (over: Partial<RoomFacts> = {}): RoomFacts => ({
    secrets: new Map(),
    refused: new Set(),
    managers: new Set(),
    ...over,
});

test('a start opens a round and one-word messages are its guesses, each word once', () => {
    no = 0;
    const game = readRoom(
        [chat('ann', startText(1), 0), chat('bob', '바다', 1), chat('cy', '바다', 2), chat('cy', '안녕 하세요', 3)],
        facts()
    );
    assert.equal(game.round, 1);
    assert.equal(game.starterId, 'ann');
    assert.deepEqual(
        game.guesses.map(guess => [guess.word, guess.ownerId]),
        [['바다', 'bob']]
    );
    assert.equal(game.lastActivityAt, T0 + 2 * 60_000);
});

test('a member cannot replace a running round, and the attempt is kept', () => {
    no = 0;
    const game = readRoom([chat('ann', startText(1), 0), chat('bob', '바다', 1), chat('bob', startText(2), 2)], facts());
    assert.equal(game.round, 1);
    assert.deepEqual(game.ignored, [{ round: 2, ownerId: 'bob', at: T0 + 2 * 60_000, reason: 'running' }]);
});

test('the starter, a manager, or anyone after the idle time may replace it', () => {
    no = 0;
    const base = [chat('ann', startText(1), 0), chat('bob', '바다', 1)];
    assert.equal(readRoom([...base, chat('ann', startText(2), 2)], facts()).round, 2);
    assert.equal(readRoom([...base, chat('max', startText(2), 2)], facts({ managers: new Set(['max']) })).round, 2);
    const late = chat('bob', startText(2), 1 + IDLE_MS / 60_000);
    assert.equal(readRoom([...base, late], facts()).round, 2);
});

test('a solved round is open to anyone, once the server has revealed its word', () => {
    no = 0;
    const chats = [chat('ann', startText(1), 0), chat('bob', '바다', 1), chat('cy', startText(2), 2)];
    assert.equal(readRoom(chats, facts()).round, 1);
    const solved = readRoom(chats, facts({ secrets: new Map([[1, '바다']]) }));
    assert.equal(solved.round, 2);
});

test('the solved round reports its answer, who found it and after how many words', () => {
    no = 0;
    const game = readRoom(
        [chat('ann', startText(1), 0), chat('bob', '파도', 1), chat('cy', '바다', 3)],
        facts({ secrets: new Map([[1, '바다']]) })
    );
    assert.equal(game.solved?.word, '바다');
    assert.equal(game.solved?.by.ownerId, 'cy');
    assert.equal(game.solved?.tries, 2);
});

test("a start the server refused for this room never takes, even with no round running", () => {
    no = 0;
    const game = readRoom([chat('bob', startText(9), 0)], facts({ refused: new Set([9]) }));
    assert.equal(game.round, null);
    assert.equal(game.ignored[0]?.reason, 'refused');
});

test('mayStart and ago', () => {
    no = 0;
    const game = readRoom([chat('ann', startText(1), 0)], facts());
    assert.equal(mayStart(game, 'bob', T0 + 60_000, facts()), false);
    assert.equal(mayStart(game, 'ann', T0 + 60_000, facts()), true);
    assert.equal(ago(T0, T0 + 10_000), '방금');
    assert.equal(ago(T0, T0 + 3 * 60_000), '3분 전');
});

test('a scored guess counts as its word; other text does not', () => {
    assert.equal(guessOf(guessText('바다', 41.2, 3, 17, false)), '바다');
    assert.equal(guessText('바다', 41.2, 3, 17, false), '바다 · 41.20점 (17개 중 3위)');
    assert.equal(guessOf(guessText('바다', 100, 1, 5, true)), '바다');
    assert.equal(guessOf('바다'), '바다');
    assert.equal(guessOf('바다 소리'), null);
    assert.equal(guessOf('바다·41점'), null);
});

test('a start message with a link still opens the round', () => {
    no = 0;
    const game = readRoom([chat('ann', startText(4, 'https://app.chatic.io/apps/dou-closer-word?room=r1'), 0)], facts());
    assert.equal(game.round, 4);
});

test('rankOf puts the closest first and shares ties', () => {
    assert.equal(rankOf(50, [10, 60, 70]), 3);
    assert.equal(rankOf(80, [10, 60, 70]), 1);
    assert.equal(rankOf(60, [60, 70]), 2);
    assert.equal(rankOf(5, []), 1);
});

test('withGwa picks 과 after a final consonant and 와 otherwise', () => {
    assert.equal(withGwa('바다'), '바다와');
    assert.equal(withGwa('사람'), '사람과');
});
