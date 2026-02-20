/**
 * Ingestion & Knowledge routes — endpoints for Drive ingestion and knowledge sources.
 */

import { Router } from 'express';
import { ingestionPipeline } from '../ingestion/pipeline.js';
import { vectorStore } from '../vectordb/store.js';
import { LLMClient } from '../llm/client.js';

const router = Router();

/**
 * GET /api/ingestion/files — List Drive files and folders for user selection
 */
router.get('/files', async (_req, res) => {
    try {
        const files = await ingestionPipeline.listSelectableFiles();
        return res.json({ files });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: msg });
    }
});

/**
 * POST /api/ingestion/run — Trigger ingestion pipeline (all files)
 */
router.post('/run', async (_req, res) => {
    try {
        const llm = new LLMClient(
            process.env.LLM_API_KEY || '',
            process.env.LLM_MODEL || 'gpt-4o-mini',
            process.env.LLM_BASE_URL,
            process.env.LLM_EMBEDDING_MODEL
        );

        // Start ingestion in background
        ingestionPipeline.run(llm).catch(err => {
            console.error('[Ingestion] Background error:', err);
        });

        // Return current status immediately (isRunning: true)
        return res.json({ message: 'Ingestion started', status: ingestionPipeline.getStatus() });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: msg });
    }
});

/**
 * POST /api/ingestion/selective — Trigger ingestion for selected files/folders
 * Body: { fileIds: string[] }
 */
router.post('/selective', async (req, res) => {
    try {
        const { fileIds = [] } = req.body;

        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ error: 'No files selected. Provide fileIds array.' });
        }

        const llm = new LLMClient(
            process.env.LLM_API_KEY || '',
            process.env.LLM_MODEL || 'gpt-4o-mini',
            process.env.LLM_BASE_URL,
            process.env.LLM_EMBEDDING_MODEL
        );

        // Start selective ingestion in background
        ingestionPipeline.runSelective(llm, fileIds).catch(err => {
            console.error('[Ingestion] Background error:', err);
        });

        return res.json({ message: 'Selective ingestion started', status: ingestionPipeline.getStatus() });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: msg });
    }
});

/**
 * POST /api/ingestion/clear — Clear all indexed data from vector store
 */
router.post('/clear', (_req, res) => {
    try {
        vectorStore.clear();
        vectorStore.save();
        // Also clear ingestion status so Knowledge tab resets
        ingestionPipeline.clearStatus();
        console.log('[Ingestion] Vector store cleared');
        return res.json({ message: 'Vector store cleared', totalRemaining: 0 });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: msg });
    }
});

/**
 * GET /api/ingestion/status — Get ingestion pipeline status.
 */
router.get('/status', (_req, res) => {
    return res.json(ingestionPipeline.getStatus());
});

/**
 * GET /api/knowledge/sources — List all ingested knowledge sources.
 */
router.get('/sources', (_req, res) => {
    const status = ingestionPipeline.getStatus();
    return res.json({
        files: status.files,
        totalFiles: status.files.length,
        totalChunks: vectorStore.size(),
        lastIngestionAt: status.lastRunAt,
    });
});

/**
 * GET /api/knowledge/sources/:fileId/chunks — Get chunks for a specific file.
 */
router.get('/sources/:fileId/chunks', (req, res) => {
    const entries = vectorStore.getEntriesByFileId(req.params.fileId);
    const chunks = entries.map((e) => ({
        id: e.id,
        text: e.text.slice(0, 500) + (e.text.length > 500 ? '...' : ''),
        chunkIndex: e.metadata.chunkIndex,
        fileName: e.metadata.fileName,
    }));
    return res.json({ fileId: req.params.fileId, chunks, total: entries.length });
});

export default router;
