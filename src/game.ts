import type { CloudChat } from '@lemoncloud/chatic-apps-sdk';

/**
 * The game read out of a room's messages: the last start message names the round, and every one-word
 * message after it is a guess. Nothing here talks to the app or the server.
 */

export const GAME_NAME = '가까운 말';

const START = /^🎯 가까운 말 #(\d+) 시작/;
const WORD = /^[가-힣]{1,20}$/;

export const startText = (round: number) => `🎯 ${GAME_NAME} #${round} 시작 — 대화방에 단어를 하나씩 쳐 보세요`;

export const answerText = (round: number, word: string, name: string, tries: number) =>
    `🎉 ${GAME_NAME} #${round} 정답은 "${word}"! ${name}님이 맞혔어요 (추측 ${tries}개 만에)`;

const ANSWER = (round: number) => new RegExp(`^🎉 가까운 말 #${round} 정답`);

/** The word as the game compares it, or null when the text is not one Korean word. */
export const toWord = (text: string | undefined): string | null => {
    const word = (text ?? '').normalize('NFC').trim();
    return WORD.test(word) ? word : null;
};

export interface Guess {
    word: string;
    /** Who typed it first, by their id in this cloud. */
    ownerId: string;
    chatNo: number;
}

export interface RoomGame {
    /** The round the room is on, or null before anyone started one. */
    round: number | null;
    /** Each word once, in the order it was first typed. */
    guesses: Guess[];
    /** Whether someone already posted this round's answer message. */
    announced: boolean;
}

/** Only messages the room really has: sent, not failed, in order. */
const settled = (chats: Iterable<CloudChat>) =>
    [...chats]
        .filter(chat => (chat.chatNo ?? 0) > 0 && !chat.isPending && !chat.isFailed)
        .sort((a, b) => (a.chatNo ?? 0) - (b.chatNo ?? 0));

export const readRoom = (chats: Iterable<CloudChat>): RoomGame => {
    const rows = settled(chats);
    let startAt = -1;
    let round: number | null = null;
    rows.forEach((chat, i) => {
        const match = START.exec(chat.content ?? '');
        if (match) {
            startAt = i;
            round = Number(match[1]);
        }
    });
    if (round === null) return { round: null, guesses: [], announced: false };

    const guesses: Guess[] = [];
    const seen = new Set<string>();
    let announced = false;
    for (const chat of rows.slice(startAt + 1)) {
        if (ANSWER(round).test(chat.content ?? '')) announced = true;
        const word = toWord(chat.content);
        if (!word || seen.has(word)) continue;
        seen.add(word);
        guesses.push({ word, ownerId: chat.ownerId ?? '', chatNo: chat.chatNo ?? 0 });
    }
    return { round, guesses, announced };
};
