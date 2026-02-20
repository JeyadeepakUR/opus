/**
 * VectorSearchTool — searches the in-memory vector store for relevant content chunks.
 * Used for semantic search over previously-ingested Drive documents.
 */

import type { Tool, ToolInput, ToolResult } from '../types/index.js';
import { vectorStore } from '../vectordb/store.js';
import { LLMClient } from '../llm/client.js';

export class VectorSearchTool implements Tool {
    name = 'vector_search';
    description = 'Search through previously-ingested documents using semantic similarity. Provide a "query" parameter. Returns the most relevant document chunks with source information.';

    private llm: LLMClient;

    constructor(llm: LLMClient) {
        this.llm = llm;
    }

    async execute(input: ToolInput): Promise<ToolResult> {
        const query = input.query;
        if (!query) {
            return { content: 'Error: No query provided for vector search.', sources: [] };
        }

        const storeSize = vectorStore.size();
        console.log(`[VectorSearch] Query: "${query}", Store size: ${storeSize}`);
        
        if (storeSize === 0) {
            console.warn('[VectorSearch] Store is empty - no ingested documents');
            return {
                content: 'No documents have been ingested yet. Please ingest documents from Google Drive in the Settings page first.',
                sources: [],
            };
        }

        try {
            const queryEmbedding = await this.llm.getEmbedding(query);
            
            // Always retrieve all chunks to maximize chances of finding relevant content
            // Rather than limiting to topK=5, get everything we have up to 20
            const maxResults = Math.min(Math.max(storeSize, 1), 20);
            const results = vectorStore.search(queryEmbedding, maxResults);
            console.log(`[VectorSearch] Search returned ${results.length}/${maxResults} results, top score: ${results[0]?.score?.toFixed(3) || 'N/A'}`);
            
            if (results.length === 0) {
                console.warn('[VectorSearch] No similar chunks found (all similarity scores too low?)');
                return { content: 'No relevant document chunks found.', sources: [] };
            }

            const content = results
                .map((r, i) => {
                    const meta = r.entry.metadata;
                    return `[${i + 1}] (Score: ${r.score.toFixed(3)}) ${meta.fileName || 'Unknown'} (chunk ${meta.chunkIndex || 0})\n${r.entry.text}`;
                })
                .join('\n\n---\n\n');

            const sources = results
                .filter((r) => r.entry.metadata.driveFileId)
                .map((r) => ({
                    type: 'drive' as const,
                    reference: r.entry.metadata.driveFileId!,
                    label: r.entry.metadata.fileName || 'Unknown file',
                }));

            const hits = results.map((r) => ({
                text: r.entry.text,
                score: r.score,
                metadata: {
                    driveFileId: r.entry.metadata.driveFileId,
                    fileName: r.entry.metadata.fileName,
                    mimeType: r.entry.metadata.mimeType,
                    chunkIndex: r.entry.metadata.chunkIndex,
                },
            }));

            // Deduplicate sources
            const uniqueSources = sources.filter(
                (s, i, arr) => arr.findIndex((x) => x.reference === s.reference) === i
            );

            return {
                content,
                sources: uniqueSources,
                metadata: { resultCount: results.length, storeSize, hits },
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: `Vector search error: ${msg}`, sources: [] };
        }
    }
}
