import type { CloudChannel, CloudChat, CloudJoin, CloudList, CloudProfile } from '@lemoncloud/chatic-apps-sdk';
import type { MockData } from '@lemoncloud/chatic-apps-sdk/mock';

/**
 * Made-up data for the mock: a place with two rooms and three members. Every id and name is invented.
 * The mock room is live: a message the page sends shows up in the room's stream, and after a start
 * message two made-up friends type a few guesses, so the board can be tried alone in a browser. 미나 owns
 * 게임방; 준 is a plain member who, halfway through, tries to open a round of his own — the board should
 * ignore it.
 */

const CLOUD = 'cloud-mock';
const PLACE = 'place-mock';
const ME = 'user-me';
const FRIENDS = ['user-mina', 'user-jun'];

const listOf = <Row>(rows: Row[]): CloudList<Row> => ({ list: rows, meta: { total: rows.length } });

const room = (id: string, name: string): CloudChannel => ({
    id,
    cid: CLOUD,
    sid: PLACE,
    isNotificationEnabled: true,
    name,
});
const ROOMS: CloudChannel[] = [room('room-games', '게임방'), room('room-lobby', '수다방')];

const profile = (userId: string, nick: string): CloudProfile => ({
    id: `${PLACE}@${userId}`,
    cid: CLOUD,
    sid: PLACE,
    uid: userId,
    userId,
    updatedAtMs: 1_700_000_000_000,
    nick,
});
const PROFILES: CloudProfile[] = [profile(ME, '나'), profile(FRIENDS[0], '미나'), profile(FRIENDS[1], '준')];

// -- A live room ---------------------------------------------------------------------------------------

const rooms = new Map<string, CloudChat[]>();
const listeners = new Map<string, Set<(list: CloudList<CloudChat>) => void>>();
let nextNo = 1;

const chatsOf = (channelId: string) => {
    if (!rooms.has(channelId)) rooms.set(channelId, []);
    return rooms.get(channelId) as CloudChat[];
};

const post = (channelId: string, ownerId: string, content: string): CloudChat => {
    const now = Date.now();
    const chat: CloudChat = {
        id: `${channelId}-chat-${nextNo}`,
        cid: CLOUD,
        channelId,
        chatNo: nextNo++,
        ownerId,
        isPending: false,
        isFailed: false,
        createdAtMs: now,
        updatedAtMs: now,
        content,
    };
    chatsOf(channelId).push(chat);
    listeners.get(channelId)?.forEach(emit => emit(listOf(chatsOf(channelId).slice(-200))));
    return chat;
};

post('room-games', FRIENDS[0], '오늘 저녁 뭐 먹지');
post('room-games', FRIENDS[1], '단어 게임 한 판 할 사람?');

const FRIEND_GUESSES = ['사람', '여름', '바닷가', '🎯 가까운 말 #999 시작', '고양이', '음악']; // the 4th is 준's

/** After a start message, the friends type one message every 1.5 s — a guess, or 준's start of his own. */
const friendsPlay = (channelId: string) => {
    FRIEND_GUESSES.forEach((text, i) =>
        setTimeout(() => post(channelId, FRIENDS[i % FRIENDS.length], text), 1500 * (i + 1))
    );
};

const join = (channelId: string, userId: string, stereo: CloudJoin['stereo']): CloudJoin => ({
    id: `${channelId}@${userId}`,
    cid: CLOUD,
    channelId,
    userId,
    joined: 1,
    readNo: 0,
    stereo,
});
const JOINS: CloudJoin[] = [
    join('room-games', FRIENDS[0], 'owner'),
    join('room-games', FRIENDS[1], 'member'),
    join('room-games', ME, 'member'),
];

export const mockData: MockData = {
    session: {
        context: {
            cloud: { cloudId: CLOUD, siteId: PLACE, isActive: true },
            identity: { userId: ME, isAuthenticated: true },
        },
        committedSiteId: PLACE,
    },
    calls: {
        'channel.cacheRead': id => ROOMS.find(row => row.id === id) ?? null,
        'profile.cacheRead': id => PROFILES.find(row => row.id === id) ?? null,
        'profile.cacheReadList': () => listOf(PROFILES),
        // Answers like the app and also puts the message in the room, as the real room would show it.
        'chat.sendChat': ({ channelId, content }) => {
            const chat = post(channelId, ME, content);
            if (content.startsWith('🎯')) friendsPlay(channelId);
            return chat;
        },
    },
    streams: {
        'channel.observeList': emit => {
            emit(listOf(ROOMS));
            return () => undefined;
        },
        'chat.observeList': (emit, query) => {
            const channelId = query.channelId;
            const set = listeners.get(channelId) ?? new Set();
            listeners.set(channelId, set);
            set.add(emit);
            emit(listOf(chatsOf(channelId).slice(-200)));
            return () => set.delete(emit);
        },
        'join.observeList': (emit, query) => {
            emit(listOf(JOINS.filter(row => row.channelId === query.channelId)));
            return () => undefined;
        },
        'profile.observeItem': (emit, id) => {
            emit(PROFILES.find(row => row.id === id) ?? null);
            return () => undefined;
        },
    },
};
