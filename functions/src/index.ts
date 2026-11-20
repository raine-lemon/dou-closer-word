import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Response } from 'express';

import { allowedOrigins } from './origins';
import { fakeEmbedder, vertexEmbedder, type Embedder } from './embeddings';
import { calibrate, cosine, isRoomKey, loadSecretWords, normalizeWord, toScore } from './words';

/**
 * The score server of 가까운 말. Two endpoints, both JSON `POST`:
 *
 * - `createRound` `{ room }` → `{ round }` — starts a round with a hidden word only the server knows, bound
 *   to one chat room.
 * - `score` `{ round, room, words }` → `{ round, solved, secret?, scores, invalid }` — how close each word is
 *   to the round's hidden word. `words: []` reads the round's state alone. A round asked about from another
 *   room is refused (`WRONG_ROOM`): a start message copied into a second room does not carry its game along.
 *
 * `room` is a SHA-256 of the cloud id and the room id, made on the phone: the server can tell two rooms apart
 * without ever learning which rooms they are.
 *
 * The page sends nothing but a round number and the words people typed: no names, no ids. Nothing here
 * is a login — anyone can call these — so every value is checked and the calls are rate limited.
 */

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 5, memory: '256MiB', timeoutSeconds: 30 });

const ORIGINS = allowedOrigins();

const MAX_WORDS = 30;
/** Vectors written to Firestore per batch: a whole list at once is over the transaction size limit. */
const WRITE_BATCH = 50;

let embedder: Embedder | null = null;
const getEmbedder = (): Embedder => {
    if (embedder) return embedder;
    if (process.env.EMBEDDINGS === 'fake') return (embedder = fakeEmbedder);
    const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) throw new Error('No project id for Vertex AI');
    return (embedder = vertexEmbedder({
        project,
        location: process.env.EMBEDDING_LOCATION ?? 'us-central1',
        model: process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001',
    }));
};

// -- Rate limits: per caller address, per instance. Enough to stop a loop, not a determined abuser. --

const buckets = new Map<string, { count: number; resetAt: number }>();
const overLimit = (request: Request, name: string, perMinute: number): boolean => {
    const key = `${name}:${request.ip ?? 'unknown'}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        if (buckets.size > 10_000) buckets.clear();
        buckets.set(key, { count: 1, resetAt: now + 60_000 });
        return false;
    }
    bucket.count += 1;
    return bucket.count > perMinute;
};

const fail = (response: Response, status: number, code: string) => {
    response.status(status).json({ error: code });
};

/** Vectors for the words, from the cache where they are and from the model for the rest. */
const vectorsFor = async (words: string[]): Promise<Map<string, number[]>> => {
    const model = getEmbedder();
    const refs = words.map(word => db.doc(`embeddings/${model.model}:${word}`));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const vectors = new Map<string, number[]>();
    snaps.forEach((snap, i) => {
        const v = snap.get('v');
        if (Array.isArray(v)) vectors.set(words[i], v as number[]);
    });
    const missing = words.filter(word => !vectors.has(word));
    if (missing.length) {
        const fresh = await model.embed(missing);
        for (let start = 0; start < missing.length; start += WRITE_BATCH) {
            const batch = db.batch();
            missing.slice(start, start + WRITE_BATCH).forEach((word, i) => {
                const vector = fresh[start + i];
                vectors.set(word, vector);
                batch.set(db.doc(`embeddings/${model.model}:${word}`), { v: vector, word, model: model.model });
            });
            await batch.commit();
        }
    }
    return vectors;
};

const handle =
    (name: string, perMinute: number, body: (request: Request, response: Response) => Promise<void>) =>
    async (request: Request, response: Response) => {
        if (request.method !== 'POST') return fail(response, 405, 'METHOD');
        if (overLimit(request, name, perMinute)) return fail(response, 429, 'RATE_LIMITED');
        try {
            await body(request, response);
        } catch (error) {
            logger.error(`${name} failed`, error);
            fail(response, 500, 'INTERNAL');
        }
    };

export const createRound = onRequest(
    // The first round embeds the whole word list once; later rounds read it from the cache.
    { cors: ORIGINS, timeoutSeconds: 180, memory: '512MiB' },
    handle('createRound', 6, async (request, response) => {
        const room = request.body?.room;
        if (!isRoomKey(room)) return fail(response, 400, 'BAD_ROOM');
        const words = loadSecretWords();
        const secret = words[Math.floor(Math.random() * words.length)];
        // Embedding similarities of single words sit close together (often 0.75 – 0.85). The round's zero
        // point is how close the hidden word is to an average word from the list, so scores spread out.
        const vectors = await vectorsFor(words);
        const target = vectors.get(secret) as number[];
        const others = words.filter(word => word !== secret).map(word => cosine(target, vectors.get(word) as number[]));
        const baseline = others.length ? others.reduce((sum, value) => sum + value, 0) / others.length : 0;
        const round = await db.runTransaction(async tx => {
            const counter = db.doc('meta/counter');
            const next = ((await tx.get(counter)).get('rounds') ?? 0) + 1;
            tx.set(counter, { rounds: next }, { merge: true });
            tx.set(db.doc(`rounds/${next}`), {
                number: next,
                secret,
                solved: false,
                baseline,
                room,
                createdAt: FieldValue.serverTimestamp(),
            });
            return next as number;
        });
        response.json({ round });
    })
);

export const score = onRequest(
    { cors: ORIGINS },
    handle('score', 60, async (request, response) => {
        const round = request.body?.round;
        const raw = request.body?.words;
        const room = request.body?.room;
        if (!Number.isInteger(round) || round < 1) return fail(response, 400, 'BAD_ROUND');
        if (!isRoomKey(room)) return fail(response, 400, 'BAD_ROOM');
        if (!Array.isArray(raw) || raw.length > MAX_WORDS) return fail(response, 400, 'BAD_WORDS');

        const roundRef = db.doc(`rounds/${round}`);
        const snap = await roundRef.get();
        if (!snap.exists) return fail(response, 404, 'NO_ROUND');
        // Rounds made before rooms were recorded have none and stay open to any room.
        const boundTo = snap.get('room');
        if (typeof boundTo === 'string' && boundTo !== room) return fail(response, 403, 'WRONG_ROOM');
        const secret = snap.get('secret') as string;
        const baseline = typeof snap.get('baseline') === 'number' ? (snap.get('baseline') as number) : 0;

        const invalid: unknown[] = [];
        const words: string[] = [];
        for (const item of raw) {
            const word = normalizeWord(item);
            if (word === null) invalid.push(typeof item === 'string' ? item.slice(0, 40) : null);
            else if (!words.includes(word)) words.push(word);
        }

        const vectors = await vectorsFor([secret, ...words.filter(word => word !== secret)]);
        const target = vectors.get(secret) as number[];
        const scores = words.map(word =>
            word === secret
                ? { word, score: 100, correct: true }
                : { word, score: toScore(calibrate(cosine(target, vectors.get(word) as number[]), baseline)), correct: false }
        );

        let solved = snap.get('solved') === true;
        if (!solved && words.includes(secret)) {
            await roundRef.update({ solved: true, solvedAt: FieldValue.serverTimestamp() });
            solved = true;
        }
        response.json({ round, solved, ...(solved ? { secret } : {}), scores, invalid });
    })
);
