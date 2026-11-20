import {
    ChaticAppsError,
    type ChaticApps,
    type CloudChannel,
    type CloudChat,
    type DataSubscription,
} from '@lemoncloud/chatic-apps-sdk';

import { createRound, hasServer, roomKey, scoreWords, ServerError, type WordScore } from './api';
import {
    ago,
    answerText,
    GAME_NAME,
    IDLE_MS,
    mayStart,
    readRoom,
    guessText,
    rankOf,
    startText,
    took,
    toWord,
    type RoomFacts,
    type RoomGame,
} from './game';

/**
 * 가까운 말: two screens in an in-memory stack — the place's rooms, and one room's board. The board
 * reads the room's messages, finds the round and the guesses in them (`game.ts`), and asks the score
 * server how close each word is (`api.ts`). Messages go out only when the user taps: a guess they typed,
 * a new round, or the answer they found.
 */

const LAST_ROOM_KEY = 'lastRoom';
const SHOWN_ROWS = 50;
const SCORE_BATCH = 30;

type Screen = { name: 'rooms' } | { name: 'board'; room: CloudChannel };

interface Mounted {
    leave(): void;
}

type Child = Node | string | null | undefined | false;

const h = (tag: string, attributes: Record<string, string> = {}, ...children: Child[]): HTMLElement => {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    for (const child of children) if (child) element.append(child);
    return element;
};

const button = (action: string, label: string, onClick: () => unknown, extra: Record<string, string> = {}) => {
    const element = h('button', { type: 'button', 'data-action': action, ...extra }, label);
    element.addEventListener('click', () => void onClick());
    return element;
};

const codeOf = (error: unknown) => (error instanceof ChaticAppsError ? error.code : null);

const SERVER_NOTES: Record<ServerError['code'], string> = {
    NO_SERVER: '점수 서버 주소가 없어요.',
    OFFLINE: '점수 서버에 연결할 수 없어요.',
    NO_ROUND: '서버에 없는 판이에요. 새 판을 시작해 주세요.',
    WRONG_ROOM: '이 대화방의 판이 아니에요. 새 판을 시작해 주세요.',
    RATE_LIMITED: '잠시 뒤에 다시 채점할게요.',
    FAILED: '점수를 받지 못했어요.',
};

export const startApp = (apps: ChaticApps, root: HTMLElement): void => {
    const stack: Screen[] = [{ name: 'rooms' }];
    let mounted: Mounted | null = null;
    let dataState: 'off' | 'waiting' | 'refused' | 'on' | 'moved' = 'off';
    let lastRoomId: string | null = null;
    let notice = '';

    const applyTheme = (theme: string) => (document.documentElement.dataset.theme = theme);
    applyTheme(apps.context?.theme ?? 'light');
    apps.onContextChange(context => applyTheme(context.theme));

    const say = (text: string) => {
        notice = text;
        const line = root.querySelector('[data-field="notice"]');
        if (line) line.textContent = text;
    };

    const failed = (error: unknown) => {
        const code = codeOf(error);
        if (code === 'RATE_LIMITED') return say('너무 빨라요. 잠시 뒤에 다시 해 주세요.');
        if (code) return say(`하지 못했어요 (${code})`);
        if (error instanceof ServerError) return say(SERVER_NOTES[error.code]);
        void apps.reportError(error);
        say('문제가 생겼어요.');
    };

    const run = (action: () => Promise<unknown>) => () => action().then(() => undefined, failed);

    // -- Screens ---------------------------------------------------------------------------------------

    const syncBack = () => apps.onBack(stack.length > 1 ? back : null);

    function open(screen: Screen) {
        stack.push(screen);
        syncBack();
        render();
    }

    function back() {
        if (stack.length > 1) stack.pop();
        syncBack();
        render();
    }

    // -- Storage: the room picked last, saved as it changes and again as the app hides the page ------

    const saveRoom = () => apps.storage.set(LAST_ROOM_KEY, lastRoomId).catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void saveRoom();
    });

    // -- The cloud's data ------------------------------------------------------------------------------

    const myUserId = () => apps.data.session()?.context.identity?.userId ?? null;
    const placeId = () => apps.data.session()?.committedSiteId ?? undefined;

    const names = new Map<string, Promise<string>>();
    const nameOf = (userId: string): Promise<string> => {
        if (!userId) return Promise.resolve('멤버');
        if (!names.has(userId)) {
            names.set(
                userId,
                apps.data.placeProfile(userId).then(
                    profile => profile?.nick || '멤버',
                    () => '멤버'
                )
            );
        }
        return names.get(userId) as Promise<string>;
    };

    /**
     * A start message's link carries its room (`?room=<id>`): opened from it, the page goes straight to that
     * room's board. Only a room of this place the user can read — anything else stays on the room list.
     */
    let linkedRoomOpened = false;
    const openLinkedRoom = async () => {
        if (linkedRoomOpened) return;
        linkedRoomOpened = true;
        const roomId = new URLSearchParams(location.search).get('room');
        if (!roomId || !apps.data.can('channel.cacheRead')) return;
        const room = await apps.data.call('channel.cacheRead', roomId).catch(() => null);
        if (room && stack.length === 1) open({ name: 'board', room });
    };

    const startData = async () => {
        if (!apps.supports('data')) return render();
        dataState = 'waiting';
        render();
        try {
            await apps.data.connect();
        } catch (error) {
            if (codeOf(error) === 'CONSENT_REFUSED') {
                dataState = 'refused';
                return render();
            }
            throw error;
        }
        dataState = 'on';
        void openLinkedRoom().catch(failed);
        apps.data.onCloudChanged(() => {
            dataState = 'moved';
            mounted?.leave();
            mounted = null;
            stack.splice(1);
            syncBack();
            render();
        });
        render();
    };

    // -- Rendering -------------------------------------------------------------------------------------

    const header = (title: string) =>
        h(
            'header',
            {},
            stack.length > 1 ? button('back', '‹', back, { 'aria-label': '뒤로' }) : null,
            h('h1', {}, title),
            // The top-right corner stays clear: the app's close button floats there.
            h('span', { class: 'corner' })
        );

    const privacyNote = () =>
        h(
            'p',
            { class: 'fine' },
            '점수를 매기려고 대화방에 올라온 단어와, 대화방을 구분하는 암호화된 값만 가까운 말 서버로 보냅니다. 이름 · 메시지 · 대화 내용은 보내지 않아요.'
        );

    const roomsScreen = (body: HTMLElement): Mounted => {
        body.append(
            h(
                'p',
                { class: 'lead' },
                '숨은 단어를 대화방 사람들과 함께 맞혀요. 단어를 칠 때마다 숨은 단어와 뜻이 얼마나 가까운지 점수가 나와요.'
            )
        );
        if (dataState !== 'on') {
            // In the app but without `data` is not the same as outside the app: the app decides per launch
            // (who holds the session, which build, which page) whether a page may read the cloud, so say
            // that rather than sending the user to a place they are already in.
            const text = {
                off: apps.inApp
                    ? '이 DoU 앱에서는 아직 미니앱이 대화방을 읽을 수 없어요. 개발용(dev) 앱의 최신 버전에서 열어 주세요.'
                    : 'DoU 앱의 플레이스에서 열어 주세요.',
                waiting: '대화방을 읽어도 되는지 묻고 있어요…',
                refused: '대화방의 단어를 읽어야 게임을 할 수 있어요.',
                moved: '다른 클라우드로 옮겼어요. 이 창을 닫고 다시 열어 주세요.',
                on: '',
            }[dataState];
            body.append(h('p', { 'data-field': 'state' }, text));
            if (dataState === 'off' && apps.inApp) {
                // A line to read back from a screenshot: what this launch got from the app.
                const has = (capability: Parameters<typeof apps.supports>[0]) => (apps.supports(capability) ? 'O' : 'X');
                body.append(
                    h(
                        'p',
                        { class: 'fine', 'data-field': 'diagnostic' },
                        `앱 연결 O · 대화방 읽기 ${has('data')} · 저장 ${has('storage')} · ${apps.context?.platform ?? '?'}`
                    )
                );
            }
            if (dataState === 'refused') body.append(button('retry', '다시 묻기', run(startData)));
            body.append(privacyNote());
            return { leave: () => undefined };
        }

        const list = h('ul', { class: 'rooms', 'data-field': 'rooms' });
        body.append(h('h2', {}, '어느 대화방에서 할까요?'), list, privacyNote());
        let stream: DataSubscription | null = null;
        let left = false;
        void apps.data
            .subscribe('channel.observeList', [{ sid: placeId() }], result => {
                const rows = (result?.list ?? []).slice(0, SHOWN_ROWS);
                list.replaceChildren(
                    ...rows.map(room =>
                        h(
                            'li',
                            {},
                            button(
                                'room',
                                room.name || '(이름 없는 방)',
                                run(async () => {
                                    lastRoomId = room.id;
                                    await saveRoom();
                                    open({ name: 'board', room });
                                }),
                                room.id === lastRoomId ? { class: 'recent' } : {}
                            )
                        )
                    )
                );
                if (!rows.length) list.replaceChildren(h('li', { class: 'empty' }, '들어가 있는 대화방이 없어요.'));
            })
            .then(subscription => {
                stream = subscription;
                if (left) void subscription.stop();
            }, failed);
        return {
            leave: () => {
                left = true;
                void stream?.stop();
            },
        };
    };

    const boardScreen = (body: HTMLElement, room: CloudChannel): Mounted => {
        const chats = new Map<string, CloudChat>();
        const secrets = new Map<number, string>();
        const refused = new Set<number>();
        const managers = new Set<string>();
        const facts: RoomFacts = { secrets, refused, managers };
        let game: RoomGame = readRoom([], facts);
        /** Scores by round, then by word. */
        const scores = new Map<number, Map<string, WordScore>>();
        /** Rounds the server has confirmed belong to this room. */
        const confirmed = new Set<number>();
        const inFlight = new Set<string>();
        let serverNote = hasServer() ? '' : SERVER_NOTES.NO_SERVER;
        let confirmNewRound = false;
        let left = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        // The server tells rooms apart by a hash of the cloud and the room, never by the ids themselves.
        let key: string | null = null;
        // Hashing needs Web Crypto, which a page served over https always has; without it the board still
        // shows the room, it just cannot ask the server.
        const keyReady = roomKey(apps.data.session()?.context.cloud.cloudId ?? 'home', room.id).then(
            made => void (key = made),
            () => {
                serverNote = '이 기기에서는 점수 서버에 대화방을 알릴 수 없어요.';
                if (!left) draw();
            }
        );

        const card = h('section', { class: 'status', 'data-field': 'status', 'aria-label': '게임 진행 상황' });
        const banner = h('div', { class: 'banner', 'data-field': 'banner' });
        const list = h('ol', { class: 'board', 'data-field': 'board' });
        const server = h('p', { class: 'fine', 'data-field': 'server' });
        const input = h('input', {
            'data-field': 'word',
            placeholder: '단어 하나 (한글)',
            maxlength: '20',
            autocomplete: 'off',
            enterkeyhint: 'send',
        }) as HTMLInputElement;
        const form = h(
            'form',
            { class: 'guess' },
            input,
            h('button', { type: 'submit', 'data-action': 'send' }, '보내기')
        );
        const newRound = button('new-round', '새 판', run(startRound));
        const tools = h('div', { class: 'tools' }, newRound);

        const me = () => myUserId() ?? '';
        const roundScores = () => {
            const round = game.round ?? 0;
            if (!scores.has(round)) scores.set(round, new Map());
            return scores.get(round) as Map<string, WordScore>;
        };
        const recompute = () => {
            const before = game.round;
            game = readRoom(chats.values(), facts);
            if (game.round !== before) confirmNewRound = false;
        };
        const named = (userId: string) => {
            const span = h('span', { class: 'who-inline' }, '…');
            void nameOf(userId).then(text => (span.textContent = text));
            return span;
        };

        // -- Drawing ---------------------------------------------------------------------------------

        const drawStatus = () => {
            const now = Date.now();
            const known = roundScores();
            card.replaceChildren();
            if (game.round === null) {
                card.append(
                    h('p', { class: 'state' }, h('span', { class: 'badge idle' }, '대기'), ' 아직 시작한 판이 없어요'),
                    h('p', { class: 'fine' }, '"새 판"을 누르면 이 대화방에 시작 메시지가 올라가고, 그 뒤에 친 단어가 채점돼요.')
                );
                return;
            }
            const solved = game.solved;
            const idle = !solved && now - game.lastActivityAt >= IDLE_MS;
            const [label, tone] = solved ? ['끝남', 'done'] : idle ? ['쉬는 중', 'idle'] : ['진행 중', 'live'];
            card.append(h('p', { class: 'state' }, h('span', { class: `badge ${tone}` }, label), ` #${game.round}`));

            const players = new Set(game.guesses.map(guess => guess.ownerId)).size;
            card.append(
                h('p', {}, '시작 ', named(game.starterId), ` · ${ago(game.startedAt, now)}`),
                h(
                    'p',
                    {},
                    `참여 ${players}명 · 추측 ${game.guesses.length}개` +
                        (game.guesses.length ? ` · 마지막 추측 ${ago(game.lastActivityAt, now)}` : '')
                )
            );
            const open = game.guesses.map(guess => known.get(guess.word)).filter((s): s is WordScore => !!s && !s.correct);
            if (open.length && !solved) {
                card.append(h('p', {}, `지금 가장 가까운 점수 ${Math.max(...open.map(s => s.score)).toFixed(2)}`));
            }
            const mine = game.guesses.filter(guess => guess.ownerId === me());
            if (mine.length) {
                const myScores = mine.map(guess => known.get(guess.word)?.score).filter((s): s is number => s !== undefined);
                card.append(
                    h('p', {}, `내 추측 ${mine.length}개` + (myScores.length ? ` · 내 최고 ${Math.max(...myScores).toFixed(2)}` : ''))
                );
            }
            if (solved) {
                card.append(
                    h(
                        'p',
                        { class: 'answer' },
                        `정답 "${solved.word}" — `,
                        named(solved.by.ownerId),
                        `님이 ${solved.tries}번째 추측에 맞혔어요 · ${took(solved.by.at - game.startedAt)} 걸림`
                    )
                );
            } else {
                card.append(
                    h(
                        'p',
                        { class: 'fine' },
                        idle
                            ? '10분 넘게 추측이 없어서 누구나 새 판을 열 수 있어요.'
                            : '진행 중에는 시작한 사람과 방장·관리자만 새 판을 열 수 있어요. 10분 동안 추측이 없으면 누구나 열 수 있어요.'
                    )
                );
            }
            const last = game.ignored[game.ignored.length - 1];
            if (last) {
                card.append(
                    h(
                        'p',
                        { class: 'fine', 'data-field': 'ignored' },
                        named(last.ownerId),
                        last.reason === 'running'
                            ? `님이 연 #${last.round} 판은 진행 중인 판이 있어서 무시했어요`
                            : `님이 올린 #${last.round} 판은 이 대화방의 판이 아니라 무시했어요`
                    )
                );
            }
        };

        const drawControls = () => {
            const allowed = mayStart(game, me(), Date.now(), facts);
            newRound.toggleAttribute('disabled', !allowed);
            newRound.textContent = !allowed ? '새 판 (진행 중)' : confirmNewRound ? '정말 새 판?' : '새 판';
        };

        const draw = () => {
            const known = roundScores();
            drawStatus();
            const latest = game.guesses.reduce((max, guess) => Math.max(max, guess.chatNo), 0);
            const rows = [...game.guesses]
                .sort((a, b) => (known.get(b.word)?.score ?? -Infinity) - (known.get(a.word)?.score ?? -Infinity))
                .slice(0, SHOWN_ROWS);
            list.replaceChildren(
                ...rows.map(guess => {
                    const score = known.get(guess.word);
                    const name = h('span', { class: 'who' }, '');
                    void nameOf(guess.ownerId).then(text => (name.textContent = text));
                    const width = Math.max(0, Math.min(100, score?.score ?? 0));
                    return h(
                        'li',
                        {
                            class: [score?.correct ? 'correct' : '', guess.chatNo === latest ? 'latest' : '']
                                .join(' ')
                                .trim(),
                        },
                        h('span', { class: 'word' }, score?.correct ? `★ ${guess.word}` : guess.word),
                        name,
                        h('span', { class: 'score' }, score ? score.score.toFixed(2) : '…'),
                        h('span', { class: 'bar', style: `--w:${width}%` })
                    );
                })
            );

            banner.replaceChildren();
            const solved = game.solved;
            if (solved && solved.by.ownerId === me() && !game.announced && apps.data.can('chat.sendChat')) {
                banner.append(
                    button(
                        'announce',
                        '정답 알리기',
                        run(async () => {
                            const name = await nameOf(solved.by.ownerId);
                            await apps.data.sendMessage(room.id, answerText(game.round as number, solved.word, name, solved.tries));
                            apps.haptic('success');
                        })
                    )
                );
            }
            drawControls();
            server.textContent = serverNote;
        };

        // -- Scoring ---------------------------------------------------------------------------------

        const scoreSoon = () => {
            if (timer || left || !hasServer()) return;
            timer = setTimeout(() => {
                timer = null;
                void scoreMissing();
            }, 300);
        };

        const scoreMissing = async () => {
            const round = game.round;
            if (round === null || left) return;
            await keyReady;
            if (!key || left) return;
            const known = roundScores();
            const words = game.guesses
                .map(guess => guess.word)
                .filter(word => !known.has(word) && !inFlight.has(`${round}:${word}`))
                .slice(0, SCORE_BATCH);
            // A round nobody has guessed in yet is still asked about once: is it this room's?
            if (!words.length && confirmed.has(round)) return;
            if (!words.length && inFlight.has(`${round}:`)) return;
            const flights = words.length ? words.map(word => `${round}:${word}`) : [`${round}:`];
            flights.forEach(flight => inFlight.add(flight));
            try {
                const answer = await scoreWords(round, key, words);
                confirmed.add(round);
                answer.scores.forEach(score => known.set(score.word, score));
                if (answer.secret) secrets.set(round, answer.secret);
                serverNote = '';
            } catch (error) {
                if (error instanceof ServerError && (error.code === 'NO_ROUND' || error.code === 'WRONG_ROOM')) {
                    // Not this room's round: its start message stops counting, on every phone that asks.
                    refused.add(round);
                    serverNote = '';
                } else {
                    serverNote = error instanceof ServerError ? SERVER_NOTES[error.code] : SERVER_NOTES.FAILED;
                    if (!(error instanceof ServerError)) void apps.reportError(error);
                }
            } finally {
                flights.forEach(flight => inFlight.delete(flight));
            }
            if (left) return;
            recompute();
            draw();
            // More words came while this batch was out, the batch was full, or the round changed.
            if (!serverNote) scoreSoon();
        };

        // -- Actions ---------------------------------------------------------------------------------

        async function startRound() {
            if (!mayStart(game, me(), Date.now(), facts)) {
                say('진행 중인 판이 있어요. 시작한 사람이나 방장·관리자만 새 판을 열 수 있어요.');
                return draw();
            }
            const active = game.round !== null && !game.solved && game.guesses.length > 0;
            if (active && !confirmNewRound) {
                confirmNewRound = true;
                say('진행 중인 판이 있어요. 한 번 더 누르면 새 판을 시작해요.');
                return draw();
            }
            confirmNewRound = false;
            await keyReady;
            if (!key) throw new ServerError('FAILED');
            const { round } = await createRound(key);
            confirmed.add(round);
            // A link that opens this room's board straight away (`?room=`); an app without page links gets the
            // page's own address with the same query, which opens the same way.
            await apps.data.sendMessage(room.id, startText(round, apps.link({ room: room.id })));
            apps.haptic('success');
            say(`#${round} 판을 시작했어요.`);
        }

        form.addEventListener('submit', event => {
            event.preventDefault();
            void run(async () => {
                const word = toWord(input.value);
                if (!word) return say('띄어쓰기 없는 한글 한 단어만 보낼 수 있어요.');
                const round = game.round;
                if (round === null) return say('먼저 "새 판"으로 판을 시작해 주세요.');
                const known = roundScores();
                const already = known.get(word);
                if (game.guesses.some(guess => guess.word === word)) {
                    return say(`이미 나온 단어예요${already ? ` · ${already.score.toFixed(2)}점` : ''}.`);
                }
                // Scored before it goes out, so the message can say how it did. If the server cannot be
                // reached the word goes out bare: the boards score it when they can.
                let text = word;
                await keyReady;
                if (key) {
                    try {
                        const answer = await scoreWords(round, key, [word]);
                        const scored = answer.scores.find(row => row.word === word);
                        if (answer.secret) secrets.set(round, answer.secret);
                        if (scored) {
                            known.set(word, scored);
                            const others = [...known.entries()]
                                .filter(([other, row]) => other !== word && !row.correct)
                                .map(([, row]) => row.score);
                            const total = new Set([...game.guesses.map(guess => guess.word), word]).size;
                            text = guessText(word, scored.score, rankOf(scored.score, others), total, scored.correct);
                        }
                    } catch (error) {
                        if (!(error instanceof ServerError)) throw error;
                    }
                }
                // Sent in the user's name: only on their tap, the word they typed and how it scored.
                await apps.data.sendMessage(room.id, text);
                input.value = '';
                say('');
            })();
        });

        // -- The room's messages and who runs it -----------------------------------------------------

        const streams: Array<Promise<DataSubscription | null>> = [];
        const keep = (subscription: Promise<DataSubscription>) =>
            streams.push(
                subscription.then(
                    open => {
                        if (left) void open.stop();
                        return open;
                    },
                    error => {
                        failed(error);
                        return null;
                    }
                )
            );

        keep(
            apps.data.subscribe('chat.observeList', [{ channelId: room.id, limit: 200 }], result => {
                for (const chat of result?.list ?? []) if (chat.id) chats.set(chat.id, chat);
                recompute();
                draw();
                scoreSoon();
            })
        );
        if (apps.data.can('join.observeList')) {
            keep(
                apps.data.subscribe('join.observeList', [{ channelId: room.id, activeOnly: true }], result => {
                    managers.clear();
                    for (const join of result?.list ?? []) {
                        if (join.stereo === 'owner' || join.stereo === 'admin') managers.add(join.userId);
                    }
                    recompute();
                    draw();
                })
            );
        }

        // "3분 전" and the 10-minute rule move with the clock, not only with new messages.
        const clock = setInterval(draw, 15_000);

        body.append(card, banner, list, server);
        if (apps.data.can('chat.sendChat')) body.append(form, tools);
        draw();
        return {
            leave: () => {
                left = true;
                if (timer) clearTimeout(timer);
                clearInterval(clock);
                streams.forEach(subscription => void subscription.then(open => open?.stop()));
            },
        };
    };

    function render() {
        mounted?.leave();
        const screen = stack[stack.length - 1];
        const body = h('div', { class: 'body' });
        const title = screen.name === 'board' ? screen.room.name || GAME_NAME : GAME_NAME;
        root.replaceChildren(header(title), body, h('p', { class: 'notice', 'data-field': 'notice' }, notice));
        root.dataset.screen = screen.name;
        mounted = screen.name === 'board' ? boardScreen(body, screen.room) : roomsScreen(body);
    }

    syncBack();
    render();
    void run(async () => {
        const stored = await apps.storage.get<string>(LAST_ROOM_KEY);
        if (typeof stored === 'string') lastRoomId = stored;
    })();
    void run(startData)();
    root.dataset.state = 'ready';
};
