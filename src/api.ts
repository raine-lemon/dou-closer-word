/**
 * The score server (Firebase functions, see `functions/`). It gets a round number and words — never a
 * name, a message or an id from the cloud.
 */

// In development the Firebase emulator (`npm run server`); a release build needs `VITE_API_BASE` in
// `.env.production`, or the page says the server is missing.
const EMULATOR = 'http://127.0.0.1:5001/demo-closer-word/asia-northeast3';
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
    constructor(readonly code: 'NO_SERVER' | 'OFFLINE' | 'NO_ROUND' | 'RATE_LIMITED' | 'FAILED') {
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
    throw new ServerError(error === 'NO_ROUND' ? 'NO_ROUND' : response.status === 429 ? 'RATE_LIMITED' : 'FAILED');
};

export const hasServer = () => BASE !== '';

export const createRound = () => post<{ round: number }>('createRound', {});

/** At most 30 words a call; `[]` reads the round's state alone. */
export const scoreWords = (round: number, words: string[]) => post<ScoreAnswer>('score', { round, words });
