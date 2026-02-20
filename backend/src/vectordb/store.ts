/**
 * In-memory vector store with cosine similarity search.
 * Supports on-disk persistence via JSON, with bounded memory growth.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { VectorEntry } from '../types/index.js';

/** Search result with score */
export interface SearchResult {
    entry: VectorEntry;
    score: number;
}

/** Max total entries in the store — prevents unbounded growth */
const MAX_TOTAL_ENTRIES = 50_000;

export class VectorStore {
    private entries: VectorEntry[] = [];
    private persistPath: string | null;

    constructor(persistPath?: string) {
        // Resolve path to absolute (default to backend root)
        if (persistPath) {
            this.persistPath = resolve(persistPath);
        } else {
            this.persistPath = null;
        }
        
        if (this.persistPath) {
            console.log(`[VectorStore] Using persistence path: ${this.persistPath}`);
            if (existsSync(this.persistPath)) {
                this.load();
            } else {
                console.log(`[VectorStore] No existing store file found at ${this.persistPath}`);
            }
        }
    }

    /** Add an entry to the store */
    addEntry(entry: VectorEntry): void {
        // Remove existing entry with same ID
        this.entries = this.entries.filter((e) => e.id !== entry.id);
        this.entries.push(entry);
        this.enforceMaxEntries();
    }

    /** Add multiple entries */
    addEntries(entries: VectorEntry[]): void {
        for (const entry of entries) {
            // Remove existing entry with same ID
            this.entries = this.entries.filter((e) => e.id !== entry.id);
            this.entries.push(entry);
        }
        this.enforceMaxEntries();
    }

    /** Search for the top-K most similar entries */
    search(queryEmbedding: number[], topK: number = 5): SearchResult[] {
        if (this.entries.length === 0) return [];

        const results: SearchResult[] = this.entries.map((entry) => ({
            entry,
            score: this.cosineSimilarity(queryEmbedding, entry.embedding),
        }));

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /** Get the number of entries */
    size(): number {
        return this.entries.length;
    }

    /** Get all entries for a specific Drive file */
    getEntriesByFileId(driveFileId: string): VectorEntry[] {
        return this.entries.filter((e) => e.metadata.driveFileId === driveFileId);
    }

    /** Remove all entries for a specific Drive file */
    removeByFileId(driveFileId: string): void {
        this.entries = this.entries.filter((e) => e.metadata.driveFileId !== driveFileId);
    }

    /** Clear all entries */
    clear(): void {
        this.entries = [];
    }

    /** Save to disk */
    save(): void {
        if (!this.persistPath) return;
        try {
            writeFileSync(this.persistPath, JSON.stringify(this.entries), 'utf-8');
            console.log(`[VectorStore] Saved ${this.entries.length} entries to ${this.persistPath}`);
        } catch (err) {
            console.error(`[VectorStore] Failed to save to ${this.persistPath}:`, err instanceof Error ? err.message : String(err));
        }
    }

    /** Enforce the maximum entry count by keeping the latest entries */
    private enforceMaxEntries(): void {
        if (this.entries.length > MAX_TOTAL_ENTRIES) {
            const excess = this.entries.length - MAX_TOTAL_ENTRIES;
            this.entries = this.entries.slice(excess);  // Remove oldest entries
            console.warn(
                `[VectorStore] Exceeded MAX_TOTAL_ENTRIES (${MAX_TOTAL_ENTRIES}). ` +
                `Removed ${excess} oldest entries. Current size: ${this.entries.length}`
            );
        }
    }

    /** Load from disk */
    private load(): void {
        if (!this.persistPath) return;
        try {
            const data = readFileSync(this.persistPath, 'utf-8');
            this.entries = JSON.parse(data);
            console.log(`[VectorStore] ✓ Loaded ${this.entries.length} entries from disk`);
            this.enforceMaxEntries();
        } catch (err) {
            console.warn(
                `[VectorStore] Failed to load from ${this.persistPath}:`,
                err instanceof Error ? err.message : String(err)
            );
        }
    }

    /** Get diagnostics about store state */
    getDiagnostics(): {
        totalEntries: number;
        persistPath: string | null;
        isPersistent: boolean;
        maxEntries: number;
        filesRepresented: Set<string>;
    } {
        const filesRepresented = new Set(
            this.entries
                .map((e) => e.metadata.driveFileId)
                .filter((id): id is string => !!id)
        );
        return {
            totalEntries: this.entries.length,
            persistPath: this.persistPath,
            isPersistent: this.persistPath !== null,
            maxEntries: MAX_TOTAL_ENTRIES,
            filesRepresented,
        };
    }

    /** Compute cosine similarity between two vectors */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dot = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dot / denominator;
    }
}

/** Singleton vector store instance with disk persistence */
export const vectorStore = new VectorStore('./vector-store.json');
