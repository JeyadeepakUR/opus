/**
 * Text chunker — simple fixed-size sliding window with bounded output.
 * No paragraph/sentence logic, just straightforward chunking.
 */

/** Max input text length (5 MB protection) */
const MAX_INPUT_LENGTH = 5_000_000;

/** Max chunks per file (prevents unbounded growth) */
export const MAX_CHUNKS_PER_FILE = 512;

/** Configuration for chunking */
export interface ChunkConfig {
    /** Target chunk size in characters (~4 chars per token) */
    chunkSize: number;
    /** Overlap between chunks in characters */
    overlap: number;
}

const DEFAULT_CONFIG: ChunkConfig = {
    chunkSize: 2000,  // ~500 tokens
    overlap: 200,     // ~50 tokens
};

/**
 * Split text into fixed-size overlapping chunks.
 * Returns at most MAX_CHUNKS_PER_FILE chunks.
 */
export function chunkText(text: string, config?: Partial<ChunkConfig>): string[] {
    const { chunkSize, overlap } = { ...DEFAULT_CONFIG, ...config };

    if (!text || text.trim().length === 0) return [];

    // Hard cap input length — prevents V8 memory explosion
    let workText = text;
    if (text.length > MAX_INPUT_LENGTH) {
        console.warn(
            `[Chunker] Input text ${(text.length / 1_000_000).toFixed(1)}MB exceeds ` +
            `${(MAX_INPUT_LENGTH / 1_000_000).toFixed(1)}MB limit, truncating`
        );
        workText = text.slice(0, MAX_INPUT_LENGTH);
    }

    if (workText.length <= chunkSize) {
        return [workText.trim()].filter((c) => c.length > 0);
    }

    // Simple sliding window: fixed chunkSize, fixed overlap, no logic
    const chunks: string[] = [];
    const step = chunkSize - overlap;

    for (let i = 0; i < workText.length; i += step) {
        const chunk = workText.slice(i, i + chunkSize).trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }
        // Stop if we hit the per-file cap
        if (chunks.length >= MAX_CHUNKS_PER_FILE) {
            break;
        }
    }

    return chunks;
}
