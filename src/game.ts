import type { CloudChat } from '@lemoncloud/chatic-apps-sdk';

/**
 * The game read out of a room's messages: start messages open rounds, and every one-word message after
 * the accepted start is a guess. Nothing here talks to the app or the server, so every phone that reads the
 * same messages with the same facts (`RoomFacts`) settles on the same round.
 *
 * Who may open a new round while one is running: the person who started it, the room's owner or an admin,
 * or anyone once the round has gone quiet for `idleMs`. Any other start message is kept as an ignored
 * attempt and changes nothing — a member cannot switch everyone's game by tapping "new round" or by typing
 * a start message by hand.
 */

export const GAME_NAME = '가까운 말';

/** A round with no guess for this long may be replaced by anyone. */
export const IDLE_MS = 10 * 60 * 1000;

const START = /^🎯 가까운 말 #(\d+) 시작/;
const WORD = /^[가-힣]{1,20}$/;
/** A guess sent from the page carries its score after the word: `바다 · 41.20점 (17개 중 3위)`. */
const SCORED_GUESS = /^([가-힣]{1,20}) · /;

/** The start message, with a link that opens this room's board in the app when there is one. */
export const startText = (round: number, link?: string) =>
    `🎯 ${GAME_NAME} #${round} 시작 — 대화방에 단어를 하나씩 쳐 보세요` + (link ? `\n같이 하기: ${link}` : '');

/**
 * A guess as the page sends it: the word, then how it did. The score is only for the people reading the
 * room — every board scores the word again with the server, so a score typed by hand changes nothing.
 */
export const guessText = (word: string, score: number, rank: number, total: number, correct: boolean) =>
    correct ? `${word} · 🎉 정답!` : `${word} · ${score.toFixed(2)}점 (${total}개 중 ${rank}위)`;

/** Where a score would sit among the round's words: 1 for the closest. Ties share the better place. */
export const rankOf = (score: number, others: Iterable<number>): number => {
    let rank = 1;
    for (const other of others) if (other > score) rank += 1;
    return rank;
};

export const answerText = (round: number, word: string, name: string, tries: number) =>
    `🎉 ${GAME_NAME} #${round} 정답은 "${word}"! ${name}님이 맞혔어요 (추측 ${tries}개 만에)`;

const ANSWER = (round: number) => new RegExp(`^🎉 가까운 말 #${round} 정답`);

/** The word as the game compares it, or null when the text is not one Korean word. */
export const toWord = (text: string | undefined): string | null => {
    const word = (text ?? '').normalize('NFC').trim();
    return WORD.test(word) ? word : null;
};

/** The guess a message makes: a bare word, or the word of a scored guess the page sent. */
export const guessOf = (text: string | undefined): string | null => {
    const content = (text ?? '').normalize('NFC').trim();
    return toWord(content) ?? SCORED_GUESS.exec(content)?.[1] ?? null;
};

/** What a phone knows besides the messages; every phone learns the same, so they converge. */
export interface RoomFacts {
    /** Hidden words the server has revealed, by round: a round is solved once a guess equals its word. */
    secrets: ReadonlyMap<number, string>;
    /** Rounds the server refused for this room (made elsewhere, or never made): their starts are ignored. */
    refused: ReadonlySet<number>;
    /** The room's owner and admins, by user id. */
    managers: ReadonlySet<string>;
    idleMs?: number;
}

export interface Guess {
    word: string;
    /** Who typed it first, by their id in this cloud. */
    ownerId: string;
    chatNo: number;
    at: number;
}

export type IgnoredReason = 'running' | 'refused';

export interface IgnoredStart {
    round: number;
    ownerId: string;
    at: number;
    reason: IgnoredReason;
}

export interface Solved {
    word: string;
    by: Guess;
    /** How many different words were guessed up to and including the answer. */
    tries: number;
}

export interface RoomGame {
    /** The round the room is on, or null before anyone started one. */
    round: number | null;
    starterId: string;
    startedAt: number;
    /** Each word once, in the order it was first typed. */
    guesses: Guess[];
    /** The last start or guess: how long the round has been quiet. */
    lastActivityAt: number;
    solved: Solved | null;
    /** Whether someone already posted this round's answer message. */
    announced: boolean;
    /** Start messages that did not take, since this round began. */
    ignored: IgnoredStart[];
}

const EMPTY: RoomGame = {
    round: null,
    starterId: '',
    startedAt: 0,
    guesses: [],
    lastActivityAt: 0,
    solved: null,
    announced: false,
    ignored: [],
};

/** Only messages the room really has: sent, not failed, in order. */
const settled = (chats: Iterable<CloudChat>) =>
    [...chats]
        .filter(chat => (chat.chatNo ?? 0) > 0 && !chat.isPending && !chat.isFailed)
        .sort((a, b) => (a.chatNo ?? 0) - (b.chatNo ?? 0));

const solvedOf = (game: RoomGame, secrets: RoomFacts['secrets']): Solved | null => {
    const secret = game.round === null ? undefined : secrets.get(game.round);
    if (!secret) return null;
    const index = game.guesses.findIndex(guess => guess.word === secret);
    return index < 0 ? null : { word: secret, by: game.guesses[index], tries: index + 1 };
};

/** Whether `userId` may open a new round now, with `game` as it stands at `at`. */
export const mayStart = (game: RoomGame, userId: string, at: number, facts: RoomFacts): boolean =>
    game.round === null ||
    game.solved !== null ||
    game.starterId === userId ||
    facts.managers.has(userId) ||
    at - game.lastActivityAt >= (facts.idleMs ?? IDLE_MS);

export const readRoom = (chats: Iterable<CloudChat>, facts: RoomFacts): RoomGame => {
    let game: RoomGame = EMPTY;
    let seen = new Set<string>();
    for (const chat of settled(chats)) {
        const ownerId = chat.ownerId ?? '';
        const at = chat.createdAtMs ?? 0;
        const start = START.exec(chat.content ?? '');
        if (start) {
            const round = Number(start[1]);
            if (round === game.round) continue; // the same start posted twice
            if (facts.refused.has(round)) {
                game = { ...game, ignored: [...game.ignored, { round, ownerId, at, reason: 'refused' }] };
            } else if (mayStart(game, ownerId, at, facts)) {
                game = { ...EMPTY, round, starterId: ownerId, startedAt: at, lastActivityAt: at };
                seen = new Set();
            } else {
                game = { ...game, ignored: [...game.ignored, { round, ownerId, at, reason: 'running' }] };
            }
            continue;
        }
        if (game.round === null) continue;
        if (ANSWER(game.round).test(chat.content ?? '')) {
            game = { ...game, announced: true };
            continue;
        }
        const word = guessOf(chat.content);
        if (!word) continue;
        game = { ...game, lastActivityAt: at };
        if (seen.has(word)) continue;
        seen.add(word);
        game = { ...game, guesses: [...game.guesses, { word, ownerId, chatNo: chat.chatNo ?? 0, at }] };
        // Solved as soon as the answer is in, so a start right after it is open to anyone.
        if (!game.solved) game = { ...game, solved: solvedOf(game, facts.secrets) };
    }
    return game.solved || game.round === null ? game : { ...game, solved: solvedOf(game, facts.secrets) };
};

/** "방금", "3분 전", "2시간 전": how long ago, in the words the status card uses. */
export const ago = (at: number, now: number): string => {
    const seconds = Math.max(0, Math.floor((now - at) / 1000));
    if (seconds < 30) return '방금';
    if (seconds < 60) return `${seconds}초 전`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
};

/** "12분", "1시간 5분": how long something took. */
export const took = (ms: number): string => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
};
