/**
 * GoogleDriveRetrievalTool — fetches file content from Google Drive.
 * Supports Google Docs (export as text), PDFs, and plain text files.
 */

import { google } from 'googleapis';
import type { Tool, ToolInput, ToolResult } from '../types/index.js';
import { tokenStore } from '../auth/tokenStore.js';

export class GoogleDriveRetrievalTool implements Tool {
    name = 'drive_retrieval';
    description = 'Retrieve file content from Google Drive. Provide either a "driveFileId" to fetch a specific file, or a "query" to search for files by name. Returns the file content as text.';

    async execute(input: ToolInput): Promise<ToolResult> {
        const tokens = tokenStore.getTokens();
        if (!tokens) {
            return {
                content: 'Error: Google Drive is not connected. Please connect your Google account in Settings.',
                sources: [],
            };
        }

        try {
            const auth = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            auth.setCredentials(tokens);

            const drive = google.drive({ version: 'v3', auth });

            // If a specific file ID is provided, fetch that file
            if (input.driveFileId) {
                return await this.fetchFileContent(drive, input.driveFileId);
            }

            // Otherwise, search for files by query
            if (input.query) {
                return await this.searchFiles(drive, input.query);
            }

            return { content: 'Error: Provide either a "driveFileId" or "query" parameter.', sources: [] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: `Drive retrieval error: ${msg}`, sources: [] };
        }
    }

    /** Search for files matching a query */
    private async searchFiles(drive: any, query: string): Promise<ToolResult> {
        // Extract meaningful keywords from query (filter out common words)
        const stopWords = new Set(['the', 'a', 'an', 'by', 'about', 'of', 'in', 'on', 'at', 'to', 'for', 'document', 'file', 'tell', 'me', 'something']);
        const keywords = query
            .toLowerCase()
            .split(/[\s\-_]+/)
            .filter(word => word.length > 2 && !stopWords.has(word));

        // Build flexible query: search for files containing ANY of the keywords
        const searchQuery = keywords.length > 0
            ? keywords.map(kw => `name contains '${kw.replace(/'/g, "\\'")}'`).join(' or ')
            : `name contains '${query.replace(/'/g, "\\'")}'`;

        const res = await drive.files.list({
            q: searchQuery,
            fields: 'files(id, name, mimeType, modifiedTime, size)',
            pageSize: 10,
            orderBy: 'modifiedTime desc',
        });

        const files = res.data.files || [];
        if (files.length === 0) {
            return { content: `No files found matching "${query}".`, sources: [] };
        }

        // Rank results by keyword match count (simple scoring)
        const scored = files.map((f: any) => {
            const nameLower = f.name.toLowerCase();
            const matchCount = keywords.filter(kw => nameLower.includes(kw)).length;
            return { file: f, score: matchCount };
        });
        scored.sort((a: any, b: any) => b.score - a.score);

        const rankedFiles = scored.map((s: any) => s.file);
        const fileList = rankedFiles
            .map((f: any) => `- ${f.name} (${f.mimeType}, ID: ${f.id})`)
            .join('\n');

        return {
            content: `Found ${rankedFiles.length} files:\n${fileList}`,
            sources: rankedFiles.map((f: any) => ({
                type: 'drive' as const,
                reference: f.id,
                label: f.name,
            })),
            metadata: { files: rankedFiles },
        };
    }

    /** Fetch content from a specific Drive file */
    private async fetchFileContent(drive: any, fileId: string): Promise<ToolResult> {
        // Get file metadata
        const meta = await drive.files.get({
            fileId,
            fields: 'id, name, mimeType, modifiedTime, size',
        });

        const { name, mimeType } = meta.data;
        let content = '';

        if (mimeType === 'application/vnd.google-apps.document') {
            // Export Google Docs as plain text
            const res = await drive.files.export({
                fileId,
                mimeType: 'text/plain',
            });
            content = res.data as string;
        } else if (mimeType === 'application/pdf') {
            // Download PDF and parse
            const res = await drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'arraybuffer' }
            );
            const pdfParse = (await import('pdf-parse')).default;
            const parsed = await pdfParse(Buffer.from(res.data as ArrayBuffer));
            content = parsed.text;
        } else {
            // Download as text
            const res = await drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'text' }
            );
            content = res.data as string;
        }

        // Truncate if very long
        if (content.length > 8000) {
            content = content.slice(0, 8000) + '\n... [truncated]';
        }

        return {
            content: `File: ${name}\n\n${content}`,
            sources: [{ type: 'drive', reference: fileId, label: name }],
            metadata: { fileId, fileName: name, mimeType },
        };
    }
}
