/**
 * WebSearchTool — searches the web using Serper API.
 * Returns top results with title, snippet, and URL.
 */

import type { Tool, ToolInput, ToolResult } from '../types/index.js';

export class WebSearchTool implements Tool {
    name = 'web_search';
    description = 'Search the web for information. Provide a "query" parameter with your search terms. Returns top search results with titles, snippets, and URLs.';

    private apiKey: string | undefined;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.SERPER_API_KEY;
    }

    async execute(input: ToolInput): Promise<ToolResult> {
        const query = input.query;
        if (!query) {
            return { content: 'Error: No query provided for web search.', sources: [] };
        }

        if (!this.apiKey) {
            // Return mock results when no API key is configured
            return this.getMockResults(query);
        }

        try {
            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': this.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ q: query, num: 5 }),
            });

            if (!response.ok) {
                throw new Error(`Serper API returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json() as any;
            const organic = data.organic || [];

            const results = organic.slice(0, 5).map((r: any, i: number) => ({
                position: i + 1,
                title: r.title,
                snippet: r.snippet,
                url: r.link,
            }));

            const content = results
                .map((r: any) => `[${r.position}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
                .join('\n\n');

            const sources = results.map((r: any) => ({
                type: 'web' as const,
                reference: r.url,
                label: r.title,
            }));

            return { content: content || 'No results found.', sources, metadata: { results } };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: `Web search error: ${msg}`, sources: [] };
        }
    }

    private getMockResults(query: string): ToolResult {
        const results = [
            {
                title: `Search results for: ${query}`,
                snippet: `This is a mock search result for "${query}". Configure SERPER_API_KEY in .env to enable real web search.`,
                url: `https://example.com/search?q=${encodeURIComponent(query)}`,
            },
        ];

        return {
            content: results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`).join('\n\n'),
            sources: results.map((r) => ({
                type: 'web' as const,
                reference: r.url,
                label: r.title,
            })),
            metadata: { mock: true, results },
        };
    }
}
