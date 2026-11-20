/**
 * The score server (Firebase functions, see `functions/`). It gets a round number and words — never a
 * name, a message or an id from the cloud.
 */

// In development the Firebase emulator (`npm run server`); a release build needs `VITE_API_BASE` in
// `.env.production`, or the page says the server is missing.
const EMULATOR = 'http://127.0.0.1:5101/demo-closer-word/asia-northeast3';
const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? (import.meta.env.DEV ? EMULATOR : '')).replace(
    /\/$/,
    ''
);

export interface WordScore {
    word: string;
    score: number;
    correct: boolean;
}

export interface ScoreAnswer {
    round: number;
    solved: boolean;
    secret?: string;
    scores: WordScore[];
}

/** A server answer the page knows how to tell the user about. */
export class ServerError extends Error {
    constructor(readonly code: 'NO_SERVER' | 'OFFLINE' | 'NO_ROUND' | 'WRONG_ROOM' | 'RATE_LIMITED' | 'FAILED') {
        super(code);
    }
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
    if (!BASE) throw new ServerError('NO_SERVER');
    let response: Response;
    try {
        response = await fetch(`${BASE}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {
        throw new ServerError('OFFLINE');
    }
    if (response.ok) return (await response.json()) as T;
    const error = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new ServerError(
        error === 'NO_ROUND' || error === 'WRONG_ROOM' ? error : response.status === 429 ? 'RATE_LIMITED' : 'FAILED'
    );
};

export const hasServer = () => BASE !== '';

/**
 * How the server tells rooms apart without learning them: the hex SHA-256 of `<cloud id>:<room id>`. Every
 * phone in the room makes the same key, and the server only ever compares it.
 */
export const roomKey = async (cloudId: string, roomId: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${cloudId}:${roomId}`));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const createRound = (room: string) => post<{ round: number }>('createRound', { room });

/** At most 30 words a call; `[]` reads the round's state alone. */
export const scoreWords = (round: number, room: string, words: string[]) =>
    post<ScoreAnswer>('score', { round, room, words });
