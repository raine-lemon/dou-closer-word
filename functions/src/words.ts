import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A guess is one Korean word: Hangul syllables only, no spaces, 1 to 20 of them. */
const WORD = /^[가-힣]{1,20}$/;

/** The word as the game compares it, or null when it is not a word the game takes. */
export const normalizeWord = (raw: unknown): string | null => {
    if (typeof raw !== 'string') return null;
    const word = raw.normalize('NFC').trim();
    return WORD.test(word) ? word : null;
};

/**
 * The hidden words a round picks from. The real list stays out of the public repository: put it in
 * `words.private.json` (a JSON array of words, git-ignored) before deploying. Without it the small
 * example list is used, which is fine on the emulator and too easy to guess anywhere else.
 */
export const loadSecretWords = (): string[] => {
    const root = join(__dirname, '..');
    const file = [join(root, 'words.private.json'), join(root, 'words.example.json')].find(existsSync);
    if (!file) throw new Error('No word list: add words.private.json');
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const words = Array.isArray(parsed) ? parsed.map(normalizeWord).filter((w): w is string => w !== null) : [];
    if (words.length === 0) throw new Error(`The word list in ${file} has no usable words`);
    return [...new Set(words)];
};

/** A room as the page names it: the hex SHA-256 of `<cloud id>:<room id>`, never the ids themselves. */
export const isRoomKey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * A similarity measured from the round's zero point: 0 for a word as close as an average word, 1 for the
 * hidden word itself. Words further than average go below 0, as in other games of this kind.
 */
export const calibrate = (similarity: number, baseline: number): number =>
    baseline >= 1 ? similarity : (similarity - baseline) / (1 - baseline);

/** The score shown to players: the cosine as a percentage with two decimals, like 57.83. */
export const toScore = (similarity: number): number => Math.round(similarity * 10000) / 100;
