/**
 * ReasoningTool — LLM-only tool for synthesis, analysis, and summarization.
 * Does not make external calls; uses the LLM to process/reason about provided context.
 */

import type { Tool, ToolInput, ToolResult } from '../types/index.js';

export class ReasoningTool implements Tool {
    name = 'reasoning';
    description = 'Use this tool for analysis, synthesis, reasoning, or summarization that does not require external data. Provide a "query" with what you want to analyze or reason about.';

    async execute(input: ToolInput): Promise<ToolResult> {
        const query = input.query;
        if (!query) {
            return {
                content: 'Error: No query provided for reasoning.',
                sources: [],
            };
        }

        // The reasoning tool simply passes through — the actual reasoning
        // happens via the LLM in the agent loop. This tool serves as a
        // signal that the agent wants to reason without external tools.
        return {
            content: `Reasoning step completed. The agent processed the following: ${query}`,
            sources: [],
            metadata: { type: 'reasoning' },
        };
    }
}
