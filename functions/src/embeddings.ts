import { GoogleGenAI } from '@google/genai';

/** Turns words into vectors whose cosine says how close their meanings are. */
export interface Embedder {
    /** Stored next to each cached vector: vectors from different models never mix. */
    readonly model: string;
    embed(words: string[]): Promise<number[][]>;
}

const FAKE_DIMENSIONS = 256;

const hash = (text: string): number => {
    let h = 2166136261;
    for (const ch of text) {
        h ^= ch.codePointAt(0) ?? 0;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

/**
 * For the emulator only: a vector from the word's syllables and syllable pairs, so words that share
 * syllables score higher. It knows nothing of meaning — it lets the game run with no cloud account.
 */
export const fakeEmbedder: Embedder = {
    model: 'fake-syllables-v1',
    async embed(words) {
        return words.map(word => {
            const vector = new Array<number>(FAKE_DIMENSIONS).fill(0);
            const syllables = [...word];
            const features = [...syllables, ...syllables.slice(1).map((s, i) => syllables[i] + s), `#${word}`];
            for (const feature of features) {
                const h = hash(feature);
                vector[h % FAKE_DIMENSIONS] += h & 1 ? 1 : -1;
            }
            // A small shared part, so unrelated words land near 0.1 rather than exactly 0.
            vector[0] += 0.5;
            return vector;
        });
    },
};

/**
 * Gemini embeddings on Vertex AI, in the functions' own project (no API key: the functions' service
 * account signs in). One request per word keeps to what every embedding model accepts.
 */
export const vertexEmbedder = (options: { project: string; location: string; model: string }): Embedder => {
    const ai = new GoogleGenAI({ vertexai: true, project: options.project, location: options.location });
    return {
        model: options.model,
        async embed(words) {
            return Promise.all(
                words.map(async word => {
                    const response = await ai.models.embedContent({
                        model: options.model,
                        contents: word,
                        config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 768 },
                    });
                    const values = response.embeddings?.[0]?.values;
                    if (!values?.length) throw new Error('The embedding came back empty');
                    return values;
                })
            );
        },
    };
};
