/**
 * WebScrapeTool — fetches a URL and extracts readable text content.
 * Uses cheerio for HTML parsing.
 */

import * as cheerio from 'cheerio';
import type { Tool, ToolInput, ToolResult } from '../types/index.js';

export class WebScrapeTool implements Tool {
    name = 'web_scrape';
    description = 'Fetch and extract readable text content from a web page URL. Provide a "url" parameter. Returns the main text content of the page.';

    async execute(input: ToolInput): Promise<ToolResult> {
        const url = input.url;
        if (!url) {
            return { content: 'Error: No URL provided for web scraping.', sources: [] };
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; LibraAgent/1.0)',
                    'Accept': 'text/html,application/xhtml+xml',
                },
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            // Remove non-content elements
            $('script, style, nav, footer, header, aside, iframe, noscript').remove();

            // Extract title
            const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';

            // Extract main content — try common content selectors
            let content = '';
            const selectors = ['article', 'main', '[role="main"]', '.content', '.post-content', '#content'];
            for (const sel of selectors) {
                const el = $(sel);
                if (el.length > 0) {
                    content = el.text().trim();
                    break;
                }
            }

            // Fallback to body text
            if (!content) {
                content = $('body').text().trim();
            }

            // Clean up whitespace
            content = content
                .replace(/\s+/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            // Extract outbound links for optional follow-up (hub-page handling)
            const links = $('a[href]')
                .map((_, el) => {
                    const href = $(el).attr('href') || '';
                    const label = $(el).text().trim();
                    return { label, url: href };
                })
                .get()
                .filter((l) => l.url && !l.url.startsWith('#'))
                .slice(0, 50);

            // Truncate if too long
            const maxLength = 5000;
            if (content.length > maxLength) {
                content = content.slice(0, maxLength) + '... [truncated]';
            }

            return {
                content: `Title: ${title}\n\n${content}`,
                sources: [{ type: 'web', reference: url, label: title }],
                metadata: { url, title, contentLength: content.length, links },
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: `Web scrape error for ${url}: ${msg}`, sources: [] };
        }
    }
}
