/**
 * Ingestion Pipeline â€” indexes Google Drive files into the vector store.
 * Handles file listing, content extraction, chunking, embedding, and upserting.
 *
 * Binary / complex formats (PDF, DOCX, PPTX, XLSX, images, notebooks, HTML)
 * are extracted by the Python ingestion sidecar running at INGESTION_SIDECAR_URL.
 * Google-native files (Docs, Sheets) are exported directly via the Drive API.
 * Plain-text files are downloaded as-is.
 */

import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import type { IngestionFile, IngestionStatus, VectorEntry } from '../types/index.js';
import { tokenStore } from '../auth/tokenStore.js';
import { vectorStore } from '../vectordb/store.js';
import { chunkText } from '../vectordb/chunker.js';
import { LLMClient } from '../llm/client.js';

/** URL of the Python ingestion sidecar */
const SIDECAR_URL = process.env.INGESTION_SIDECAR_URL || 'http://localhost:8001';

/**
 * Helper: log memory usage at key points.
 */
function logMem(label: string): void {
    const mem = process.memoryUsage();
    console.log(
        `[Memory] ${label}: ` +
        `heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB / ` +
        `${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`
    );
}

/**
 * MIME types that go through the Python sidecar for binary extraction.
 * Everything text-based or Google-native stays in Node.
 */
const SIDECAR_MIME_TYPES = new Set([
    'application/pdf',
    // Uploaded Office files (not Google-native)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Jupyter notebooks
    'application/json',
    'application/x-ipynb+json',
    'application/vnd.google.colaboratory',
    // HTML
    'text/html',
    // Images (OCR via pytesseract in sidecar)
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/tiff',
    'image/bmp',
]);

/**
 * Google-native files â€” exported directly through the Drive API.
 * Value = the export MIME type to request.
 */
const DRIVE_EXPORT_TYPES: Record<string, string> = {
    'application/vnd.google-apps.document':    'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
};

/** Plain-text downloads â€” fetched as-is from Drive */
const PLAIN_TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);

/** All MIME types the pipeline will ingest */
const SUPPORTED_TYPES = [
    ...Object.keys(DRIVE_EXPORT_TYPES),
    ...SIDECAR_MIME_TYPES,
    ...PLAIN_TEXT_TYPES,
];

const MAX_TEXT_BYTES_SELECTIVE = 5 * 1024 * 1024;

class IngestionPipeline {
    private status: IngestionStatus = {
        isRunning: false,
        lastRunAt: null,
        totalFilesIndexed: 0,
        files: [],
    };

    /** Merge ingestion results into status, keyed by driveFileId */
    private updateStatusFiles(newFiles: IngestionFile[], replaceAll: boolean): void {
        if (replaceAll) {
            this.status.files = newFiles;
        } else {
            const byId = new Map<string, IngestionFile>();
            for (const existing of this.status.files) {
                byId.set(existing.driveFileId, existing);
            }
            for (const updated of newFiles) {
                byId.set(updated.driveFileId, updated);
            }
            this.status.files = Array.from(byId.values());
        }

        this.status.totalFilesIndexed = this.status.files.filter((f) => f.ingestionStatus === 'indexed').length;
        this.status.lastRunAt = new Date().toISOString();
    }

    /** Get current ingestion status */
    getStatus(): IngestionStatus {
        return { ...this.status };
    }

    /** Clear in-memory ingestion status */
    clearStatus(): void {
        this.status.files = [];
        this.status.totalFilesIndexed = 0;
        this.status.lastRunAt = null;
    }

    /**
     * Run the ingestion pipeline.
     * Lists files from Drive, extracts content, chunks, embeds, and stores.
     */
    async run(llm: LLMClient): Promise<IngestionStatus> {
        const tokens = tokenStore.getTokens();
        if (!tokens) {
            throw new Error('Google Drive not connected. Please connect first.');
        }

        if (this.status.isRunning) {
            throw new Error('Ingestion is already running.');
        }

        this.status.isRunning = true;

        try {
            const auth = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            auth.setCredentials(tokens);

            const drive = google.drive({ version: 'v3', auth });

            // Clear vector store at start of ingestion
            vectorStore.clear();
            console.log('[Ingestion] Cleared existing vector store');

            // List all supported files
            console.log('[Ingestion] Listing Drive files...');
            const fileList = await this.listFiles(drive);
            console.log(`[Ingestion] Found ${fileList.length} files`);

            const ingestionFiles: IngestionFile[] = [];

            // Process files in small batches to avoid memory exhaustion
            const fileBatchSize = 2; // Reduced from 5 to 2
            for (let fileIdx = 0; fileIdx < fileList.length; fileIdx += fileBatchSize) {
                const fileBatch = fileList.slice(fileIdx, fileIdx + fileBatchSize);

                for (const file of fileBatch) {
                    const ingestionFile: IngestionFile = {
                        driveFileId: file.id!,
                        fileName: file.name!,
                        mimeType: file.mimeType!,
                        size: parseInt(file.size || '0', 10),
                        lastModified: file.modifiedTime || new Date().toISOString(),
                        ingestionStatus: 'pending',
                        chunkCount: 0,
                    };

                    try {
                        if (SIDECAR_MIME_TYPES.has(file.mimeType)) {
                            await this.processViaSidecar(auth, file, llm, ingestionFile);
                            ingestionFiles.push(ingestionFile);
                            continue;
                        }

                        // Fetch content (Google Apps export or plain-text download)
                        const content = await this.fetchContent(drive, file);
                        if (!content || content.trim().length === 0) {
                            ingestionFile.ingestionStatus = 'error';
                            ingestionFile.error = 'No content extracted';
                            ingestionFiles.push(ingestionFile);
                            continue;
                        }

                        // Guard against unexpectedly large text responses
                        if (content.length > 50_000_000) {
                            ingestionFile.ingestionStatus = 'error';
                            ingestionFile.error = `Content too large (${(content.length / 1_000_000).toFixed(1)}MB text)`;
                            console.warn(`[Ingestion] Skipping ${file.name}: content size ${content.length} bytes`);
                            ingestionFiles.push(ingestionFile);
                            continue;
                        }

                        // Chunk the content
                        logMem(`Before chunking ${file.name}`);
                        const chunks = chunkText(content);
                        logMem(`After chunking ${file.name} (${chunks.length} chunks)`);

                        // Embed and store chunks in batches
                        const chunkBatchSize = 4;  // Reduced from 10 for safer memory usage

                        for (let i = 0; i < chunks.length; i += chunkBatchSize) {
                            const batch = chunks.slice(i, i + chunkBatchSize);
                            const entries: VectorEntry[] = [];

                            for (let j = 0; j < batch.length; j++) {
                                const embedding = await llm.getSafeEmbedding(batch[j]);
                                entries.push({
                                    id: `${file.id}-chunk-${i + j}`,
                                    embedding,
                                    text: batch[j],
                                    metadata: {
                                        driveFileId: file.id!,
                                        fileName: file.name!,
                                        mimeType: file.mimeType!,
                                        chunkIndex: i + j,
                                        source: 'google_drive',
                                    },
                                });
                            }

                            vectorStore.addEntries(entries);

                            // Small delay between batches to avoid API rate limits
                            if (i + chunkBatchSize < chunks.length) {
                                await new Promise((resolve) => setTimeout(resolve, 500));
                            }
                        }

                        ingestionFile.chunkCount = chunks.length;
                        ingestionFile.ingestionStatus = 'indexed';
                        console.log(`[Ingestion] Indexed ${file.name}: ${chunks.length} chunks`);
                    } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        ingestionFile.ingestionStatus = 'error';
                        ingestionFile.error = `Processing failed: ${errMsg.slice(0, 100)}`;
                        console.error(`[Ingestion] Error indexing ${file.name}:`, errMsg);
                    }

                    ingestionFiles.push(ingestionFile);
                }

                // Save to disk after each batch
                vectorStore.save();
                console.log(
                    `[Ingestion] Batch complete (${Math.min(fileIdx + fileBatchSize, fileList.length)}/${fileList.length} files), saved to disk`
                );

                // Force garbage collection
                if (global.gc) {
                    global.gc();
                    console.log('[Ingestion] Garbage collection triggered');
                }

                // Pause to allow cleanup
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            // Final save
            vectorStore.save();

            this.updateStatusFiles(ingestionFiles, true);

            console.log(`[Ingestion] Complete: ${this.status.totalFilesIndexed}/${fileList.length} files indexed`);
            return this.getStatus();
        } finally {
            this.status.isRunning = false;
        }
    }

    /**
     * List selectable files and folders for the user to choose from
     */
    async listSelectableFiles(): Promise<any[]> {
        const tokens = tokenStore.getTokens();
        if (!tokens) {
            throw new Error('Google Drive not connected. Please connect first.');
        }

        const auth = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        auth.setCredentials(tokens);

        const drive = google.drive({ version: 'v3', auth });

        // Get files ONLY from "My Drive" with deduplication
        const res = await drive.files.list({
            q: "trashed = false and 'me' in owners",
            spaces: 'drive',
            fields: 'files(id, name, mimeType, size, modifiedTime)',
            pageSize: 1000,
            orderBy: 'name',
        });

        // Deduplicate and skip folders
        const seen = new Set<string>();
        const uniqueFiles = (res.data.files || []).filter((file: any) => {
            if (seen.has(file.id)) return false;
            seen.add(file.id);
            // Exclude folders (selection is file-only)
            return file.mimeType !== 'application/vnd.google-apps.folder';
        });

        return uniqueFiles.map((file: any) => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            isFolder: file.mimeType === 'application/vnd.google-apps.folder',
            size: parseInt(file.size || '0', 10),
            modifiedTime: file.modifiedTime || null,
        }));
    }

    /**
     * Run selective ingestion for chosen files only
     */
    async runSelective(llm: LLMClient, fileIds: string[]): Promise<IngestionStatus> {
        const tokens = tokenStore.getTokens();
        if (!tokens) {
            throw new Error('Google Drive not connected. Please connect first.');
        }

        if (this.status.isRunning) {
            throw new Error('Ingestion is already running.');
        }

        this.status.isRunning = true;

        try {
            const auth = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            auth.setCredentials(tokens);

            const drive = google.drive({ version: 'v3', auth });

            console.log(`[Ingestion] Starting selective ingestion for ${fileIds.length} files...`);

            const ingestionFiles: IngestionFile[] = [];
            const fileBatchSize = 5;

            for (let idx = 0; idx < fileIds.length; idx += fileBatchSize) {
                const batch = fileIds.slice(idx, idx + fileBatchSize);

                for (const fileId of batch) {
                    try {
                        // Get file metadata
                        console.log(`[Ingestion] Processing file ID: ${fileId}`);
                        const fileRes = await drive.files.get({
                            fileId,
                            fields: 'id, name, mimeType, modifiedTime, size',
                        });

                        const file = fileRes.data;
                        console.log(`[Ingestion] File: ${file.name} (${file.mimeType}, ${file.size} bytes)`);

                        const ingestionFile: IngestionFile = {
                            driveFileId: file.id!,
                            fileName: file.name!,
                            mimeType: file.mimeType!,
                            size: parseInt(file.size || '0', 10),
                            lastModified: file.modifiedTime || new Date().toISOString(),
                            ingestionStatus: 'pending',
                            chunkCount: 0,
                        };

                        if (SIDECAR_MIME_TYPES.has(file.mimeType!)) {
                            await this.processViaSidecar(auth, file, llm, ingestionFile);
                            ingestionFiles.push(ingestionFile);
                            continue;
                        }

                        const fileSizeBytes = parseInt(file.size || '0', 10);
                        const mimeType = file.mimeType || '';

                        // Only Drive-export and plain-text files remain here
                        const shouldDownload =
                            (mimeType in DRIVE_EXPORT_TYPES || PLAIN_TEXT_TYPES.has(mimeType)) &&
                            fileSizeBytes <= MAX_TEXT_BYTES_SELECTIVE;

                        try {
                            let content: string;
                            if (shouldDownload) {
                                content = await this.fetchContent(drive, file);
                            } else {
                                const reason = fileSizeBytes > MAX_TEXT_BYTES_SELECTIVE
                                    ? `File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Indexed as metadata only.`
                                    : 'Unsupported format. Indexed as metadata only.';
                                content = this.buildMetadataContent(file, reason);
                            }

                            // CRITICAL: Check content size BEFORE processing to prevent V8 crash
                            if (!content || content.length === 0) {
                                ingestionFile.ingestionStatus = 'error';
                                ingestionFile.error = 'No content extracted';
                                ingestionFiles.push(ingestionFile);
                                continue;
                            }

                            if (content.length > 50_000_000) {
                                // 50MB text limit
                                ingestionFile.ingestionStatus = 'error';
                                ingestionFile.error = `Content too large (${(content.length / 1_000_000).toFixed(1)}MB text)`;
                                console.warn(`[Ingestion] Skipping ${file.name}: content size ${content.length} bytes`);
                                ingestionFiles.push(ingestionFile);
                                continue;
                            }

                            logMem(`Before chunking (selective) ${file.name}`);
                            const chunks = chunkText(content);
                            logMem(`After chunking (selective) ${file.name} (${chunks.length} chunks)`);
                            vectorStore.removeByFileId(file.id!);

                            const chunkBatchSize = 4;  // Reduced from 10 for safer memory usage
                            for (let i = 0; i < chunks.length; i += chunkBatchSize) {
                                const chunkBatch = chunks.slice(i, i + chunkBatchSize);
                                const entries: VectorEntry[] = [];

                                for (let j = 0; j < chunkBatch.length; j++) {
                                    const embedding = await llm.getSafeEmbedding(chunkBatch[j]);
                                    entries.push({
                                        id: `${file.id}-chunk-${i + j}`,
                                        embedding,
                                        text: chunkBatch[j],
                                        metadata: {
                                            driveFileId: file.id!,
                                            fileName: file.name!,
                                            mimeType: file.mimeType!,
                                            chunkIndex: i + j,
                                            source: 'google_drive',
                                        },
                                    });
                                }

                                vectorStore.addEntries(entries);

                                if (i + chunkBatchSize < chunks.length) {
                                    await new Promise((resolve) => setTimeout(resolve, 500));
                                }
                            }

                            ingestionFile.chunkCount = chunks.length;
                            ingestionFile.ingestionStatus = 'indexed';
                            console.log(`[Ingestion] Indexed ${file.name}: ${chunks.length} chunks`);
                        } catch (contentErr) {
                            // Catch V8 fatal errors during content extraction
                            const errMsg = contentErr instanceof Error ? contentErr.message : String(contentErr);
                            ingestionFile.ingestionStatus = 'error';
                            ingestionFile.error = `Content extraction failed: ${errMsg.slice(0, 100)}`;
                            console.error(`[Ingestion] Content extraction error for ${file.name}:`, errMsg);
                        }

                        ingestionFiles.push(ingestionFile);
                    } catch (err) {
                        console.error(`[Ingestion] Error processing file ${fileId}:`, err);
                    }
                }

                vectorStore.save();
                console.log(
                    `[Ingestion] Batch complete (${Math.min(idx + fileBatchSize, fileIds.length)}/${fileIds.length} files), saved to disk`
                );

                if (global.gc) {
                    global.gc();
                    console.log('[Ingestion] Garbage collection triggered');
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            vectorStore.save();

            this.updateStatusFiles(ingestionFiles, false);

            console.log(`[Ingestion] Complete: ${this.status.totalFilesIndexed}/${fileIds.length} files indexed`);
            return this.getStatus();
        } finally {
            this.status.isRunning = false;
        }
    }

    /** List all supported files from Drive (My Drive only) */
    private async listFiles(drive: any): Promise<any[]> {
        const mimeQuery = SUPPORTED_TYPES.map((t) => `mimeType='${t}'`).join(' or ');
        const res = await drive.files.list({
            q: `(${mimeQuery}) and 'me' in owners and trashed = false`,
            spaces: 'drive',
            fields: 'files(id, name, mimeType, modifiedTime, size)',
            pageSize: 100,
        });

        // Filter and validate files
        let files = (res.data.files || []);

        // Sort by size ascending (smaller files first)
        files.sort((a: any, b: any) => parseInt(a.size || '0', 10) - parseInt(b.size || '0', 10));

        // Skip noise (< 100 bytes) and very large files (> 50 MB)
        files = files.filter((file: any) => {
            const sizeBytes = parseInt(file.size || '0', 10);
            return sizeBytes >= 100 && sizeBytes <= 50 * 1024 * 1024;
        });

        const limitedFiles = files.slice(0, 50);
        console.log(`[Ingestion] Filtered: ${limitedFiles.length}/${files.length} valid files`);

        return limitedFiles;
    }

    /** Fetch content from a Drive file (Google-native export and plain-text only) */
    private async fetchContent(drive: any, file: any): Promise<string> {
        const { id, mimeType, name } = file;

        try {
            // Google-native files â€” export via Drive API
            if (mimeType in DRIVE_EXPORT_TYPES) {
                const exportMime = DRIVE_EXPORT_TYPES[mimeType];
                const res = await drive.files.export({ fileId: id, mimeType: exportMime });
                return res.data as string;
            }

            // Plain-text types â€” download as-is
            if (PLAIN_TEXT_TYPES.has(mimeType)) {
                const res = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'text' });
                return res.data as string;
            }

            throw new Error(`fetchContent called for unsupported type ${mimeType} â€” should use processViaSidecar`);
        } catch (err) {
            console.error(`[Ingestion] Failed to fetch content for ${name} (${mimeType}):`, err);
            throw new Error(`Content extraction failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Process a binary/complex file via the Python ingestion sidecar.
     * Downloads raw file bytes from Drive, POSTs to sidecar, then
     * chunks + embeds + stores the extracted text.
     *
     * All heavy parsing (pymupdf, python-docx, pytesseract â€¦) happens
     * in Python â€” zero V8 heap pressure, no child-process spawning in Node.
     */
    /**

     * Process a binary/complex file via the Python ingestion sidecar.

     * Node sends only a JSON payload { file_id, access_token, mime_type, filename }.

     * Python downloads the file directly from Google Drive â€” Node never loads file bytes.

     */

    private async processViaSidecar(

        auth: any,

        file: any,

        llm: LLMClient,

        ingestionFile: IngestionFile

    ): Promise<void> {

        try {

            // Get a fresh access token â€” sent to Python as JSON, not the file bytes

            const tokenResponse = await auth.getAccessToken();

            const accessToken = tokenResponse?.token ?? tokenResponse?.res?.data?.access_token;

            if (!accessToken) throw new Error('Could not retrieve Google access token');



            // Send only JSON â€” Python downloads the file. Node never allocates file bytes.

            const response = await fetch(`${SIDECAR_URL}/extract-from-drive`, {

                method: 'POST',

                headers: { 'Content-Type': 'application/json' },

                body: JSON.stringify({

                    file_id: file.id,

                    access_token: accessToken,

                    mime_type: file.mimeType,

                    filename: file.name || 'unknown',

                }),

            });



            if (!response.ok) {

                const errText = await response.text();

                throw new Error(`Sidecar ${response.status}: ${errText.slice(0, 200)}`);

            }



            const { text, page_count } = (await response.json()) as { text: string; page_count: number };



            if (!text || text.trim().length === 0) {

                ingestionFile.ingestionStatus = 'error';

                ingestionFile.error = 'Sidecar returned empty text';

                return;

            }



            console.log(`[Ingestion] Sidecar extracted ${text.length} chars, ${page_count} pages  [${file.name}]`);

            logMem(`Before chunking (sidecar) ${file.name}`);
            const chunks = chunkText(text);
            logMem(`After chunking (sidecar) ${file.name} (${chunks.length} chunks)`);

            vectorStore.removeByFileId(file.id);

            let chunkIndex = 0;

            logMem(`Before chunking (sidecar) ${file.name}`);

            for (let i = 0; i < chunks.length; i += 4) {

                const batch = chunks.slice(i, i + 4);

                const entries: VectorEntry[] = [];



                for (let j = 0; j < batch.length; j++) {

                    const embedding = await llm.getSafeEmbedding(batch[j]);

                    entries.push({

                        id: `${file.id}-chunk-${chunkIndex}`,

                        embedding,

                        text: batch[j],

                        metadata: {

                            driveFileId: file.id,

                            fileName: file.name,

                            mimeType: file.mimeType,

                            chunkIndex,

                            source: 'google_drive',

                            ...(page_count ? { pageCount: page_count } : {}),

                        },

                    });

                    chunkIndex += 1;

                }



                vectorStore.addEntries(entries);

                if (i + 4 < chunks.length) await new Promise((r) => setTimeout(r, 300));

            }



            ingestionFile.chunkCount = chunkIndex;

            ingestionFile.ingestionStatus = 'indexed';

            console.log(`[Ingestion] Indexed ${file.name}: ${chunkIndex} chunks`);

        } catch (err) {

            const errMsg = err instanceof Error ? err.message : String(err);

            ingestionFile.ingestionStatus = 'error';

            ingestionFile.error = `Sidecar extraction failed: ${errMsg.slice(0, 200)}`;

            console.error(`[Ingestion] Sidecar error for ${file.name}:`, errMsg);

        }

    }
    /** Metadata stub for files that cannot be extracted */
    private buildMetadataContent(file: any, reason: string): string {
        const name = file.name || 'Unknown';
        const mimeType = file.mimeType || 'unknown';
        const size = parseInt(file.size || '0', 10);
        const sizeMb = size > 0 ? (size / 1024 / 1024).toFixed(2) : '0.00';
        const modified = file.modifiedTime || 'unknown';
        return [
            `# File: ${name}`,
            `Type: ${mimeType}`,
            `Size: ${sizeMb} MB`,
            `Modified: ${modified}`,
            `Note: ${reason}`,
        ].join('\n');
    }
}

/** Singleton ingestion pipeline */
export const ingestionPipeline = new IngestionPipeline();
