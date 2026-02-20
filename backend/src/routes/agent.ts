/**
 * Agent API routes — endpoints for starting and monitoring agent runs.
 */

import { Router } from 'express';
import type { AgentConfig, ToolInput, ToolResult } from '../types/index.js';
import { AgentRunner } from '../agent/runner.js';
import { runStore } from '../agent/store.js';
import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { WebSearchTool } from '../tools/webSearch.js';
import { WebScrapeTool } from '../tools/webScrape.js';
import { GoogleDriveRetrievalTool } from '../tools/driveRetrieval.js';
import { VectorSearchTool } from '../tools/vectorSearch.js';
import { ReasoningTool } from '../tools/reasoning.js';
import { vectorStore } from '../vectordb/store.js';

const router = Router();

/** Initialize LLM client and tool registry - recreate on each request to use fresh env vars */
function createToolRegistry(llm: LLMClient): ToolRegistry {
    const tools = new ToolRegistry();
    tools.register(new WebSearchTool());
    tools.register(new WebScrapeTool());
    tools.register(new GoogleDriveRetrievalTool());
    tools.register(new VectorSearchTool(llm));
    tools.register(new ReasoningTool());
    return tools;
}

function createAgentRunner(): AgentRunner {
    const apiKey = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';
    const baseUrl = process.env.LLM_BASE_URL;
    const embeddingModel = process.env.LLM_EMBEDDING_MODEL;

    console.log(`[Agent Route] Creating LLMClient with:`);
    console.log(`  - apiKey: ${apiKey ? apiKey.substring(0, 20) + '...' : 'MISSING'}`);
    console.log(`  - model: ${model}`);
    console.log(`  - baseUrl: ${baseUrl}`);

    if (!apiKey) {
        throw new Error('LLM_API_KEY environment variable is not set');
    }

    const llm = new LLMClient(apiKey, model, baseUrl, embeddingModel);

    const tools = createToolRegistry(llm);

    return new AgentRunner(llm, tools);
}

function normalizeQueries(queries: string[] | undefined, fallback?: string): string[] {
    const normalized = (queries || [])
        .map((q) => (typeof q === 'string' ? q.trim() : ''))
        .filter((q) => q.length > 0);
    if (normalized.length > 0) {
        return Array.from(new Set(normalized));
    }
    return fallback ? [fallback] : [];
}

function collectCitationsFromSources(sources: Array<{ type: 'web' | 'drive' | 'local'; reference: string; label?: string }>) {
    const seen = new Set<string>();
    const citations: Array<{ id: string; type: 'web' | 'drive' | 'local'; label: string; reference: string }> = [];
    let counter = 1;
    for (const source of sources) {
        if (!source?.reference) continue;
        if (seen.has(source.reference)) continue;
        seen.add(source.reference);
        citations.push({
            id: String(counter++),
            type: source.type,
            label: source.label || source.reference,
            reference: source.reference,
        });
    }
    return citations;
}

/**
 * GET /api/agent/health — Test LLM connectivity.
 */
router.get('/health', async (req, res) => {
    try {
        if (!process.env.LLM_API_KEY) {
            return res.status(500).json({ 
                status: 'error',
                error: 'LLM_API_KEY not configured' 
            });
        }

        const apiKey = process.env.LLM_API_KEY;
        const model = process.env.LLM_MODEL || 'gpt-4o-mini';
        const baseUrl = process.env.LLM_BASE_URL;

        console.log('[Agent Health] Testing LLM connection...');
        console.log(`  - apiKey: ${apiKey.substring(0, 20)}...`);
        console.log(`  - model: ${model}`);
        console.log(`  - baseUrl: ${baseUrl}`);

        const llm = new LLMClient(apiKey, model, baseUrl, process.env.LLM_EMBEDDING_MODEL);

        // Simple test: generate a plan with minimal tools
        const testTools = [{ name: 'reasoning', description: 'Think step by step' }];
        const plan = await llm.generatePlan('What is 2+2?', testTools, 0.3);
        
        console.log('[Agent Health] LLM test successful');
        return res.json({ 
            status: 'ok',
            model,
            baseUrl: baseUrl || 'https://api.openai.com/v1',
            testResult: plan
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Agent Health] LLM test failed:', error);
        return res.status(500).json({ 
            status: 'error',
            error: msg,
            model: process.env.LLM_MODEL || 'gpt-4o-mini',
            baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        });
    }
});

/**
 * POST /api/agent/run — Start a new agent run.
 * Body: { task: string, config?: Partial<AgentConfig> }
 */
router.post('/run', async (req, res) => {
    try {
        const { task, config } = req.body;

        if (!task || typeof task !== 'string' || task.trim().length === 0) {
            return res.status(400).json({ error: 'Task is required and must be a non-empty string.' });
        }

        // Validate LLM configuration before attempting run
        if (!process.env.LLM_API_KEY) {
            return res.status(500).json({ 
                error: 'LLM_API_KEY not configured. Check backend .env file.' 
            });
        }

        console.log(`[Agent API] Starting new run for task: "${task.trim().substring(0, 100)}..."`);
        console.log(`[Agent API] Using model: ${process.env.LLM_MODEL || 'gpt-4o-mini'}`);
        
        // Create a fresh agent runner with current env vars
        const agentRunner = createAgentRunner();
        
        const runId = await agentRunner.startRun(task.trim(), config as Partial<AgentConfig>);
        const run = runStore.get(runId);

        return res.status(201).json({ runId, run });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Agent API] Error starting run:', error);
        return res.status(500).json({ error: msg });
    }
});

/**
 * POST /api/agent/followup — Stateless follow-up chat for a query.
 * Body: { query: string, config?: Partial<AgentConfig> }
 */
router.post('/followup', async (req, res) => {
    try {
        const { query, config, context } = req.body || {};
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return res.status(400).json({ error: 'Query is required and must be a non-empty string.' });
        }

        if (!process.env.LLM_API_KEY) {
            return res.status(500).json({ error: 'LLM_API_KEY not configured. Check backend .env file.' });
        }

        const apiKey = process.env.LLM_API_KEY;
        const model = process.env.LLM_MODEL || 'gpt-4o-mini';
        const baseUrl = process.env.LLM_BASE_URL;
        const embeddingModel = process.env.LLM_EMBEDDING_MODEL;
        const llm = new LLMClient(apiKey, model, baseUrl, embeddingModel);

        const tools = createToolRegistry(llm);
        const mergedConfig: AgentConfig = {
            maxSteps: 8,
            temperature: 0.3,
            enabledTools: ['vector_search', 'web_search', 'web_scrape', 'reasoning'],
            ...(config || {}),
        };
        const toolDescriptions = mergedConfig.enabledTools.length > 0
            ? tools.getEnabledDescriptions(mergedConfig.enabledTools)
            : tools.getDescriptions();

        const sources: Array<{ type: 'web' | 'drive' | 'local'; reference: string; label?: string }> = [];
        const internalChunks: Array<{ text: string; score?: number; fileName?: string; driveFileId?: string; chunkIndex?: number }> = [];
        const externalFindings: Array<{ type: 'web_search' | 'web_scrape'; queryOrUrl: string; content: string }> = [];

        // Inject chat context as internal knowledge if provided
        if (typeof context === 'string' && context.trim().length > 0) {
            internalChunks.push({
                text: context.trim(),
                score: 1,
                fileName: 'chat_context',
                driveFileId: undefined,
                chunkIndex: undefined,
            });
        }

        // Skip Drive query planning for follow-ups with context (unlikely to need Drive in chat)
        const shouldPlanDrive = !(typeof context === 'string' && context.trim().length > 0);
        const drivePlan = shouldPlanDrive 
            ? await llm.planDriveQuery(query.trim(), mergedConfig.temperature)
            : { intent: 'none' as const, summary: false };
        
        if (drivePlan.intent !== 'none') {
            let stepsUsed = 0;
            const canRunStep = () => stepsUsed < mergedConfig.maxSteps;
            const runTool = async (toolName: string, toolInput: ToolInput): Promise<ToolResult> => {
                stepsUsed += 1;
                return tools.execute(toolName, toolInput);
            };

            const documents: Array<{ id: string; name: string; content: string }> = [];
            const safeIndex = Number.isFinite(drivePlan.selectIndex) && drivePlan.selectIndex > 0
                ? Math.floor(drivePlan.selectIndex)
                : 0;

            if (drivePlan.intent === 'list') {
                const listQuery = (drivePlan.listQuery || query.trim()).trim();
                const listResult = await runTool('drive_retrieval', { query: listQuery });
                sources.push(...(listResult.sources || []));

                const files = Array.isArray(listResult.metadata?.files) ? listResult.metadata?.files : [];
                if (drivePlan.summary && safeIndex > 0 && files[safeIndex - 1]) {
                    const selected = files[safeIndex - 1];
                    if (canRunStep()) {
                        const fetchResult = await runTool('drive_retrieval', { driveFileId: selected.id });
                        sources.push(...(fetchResult.sources || []));
                        documents.push({ id: selected.id, name: selected.name, content: fetchResult.content });
                    }
                } else if (drivePlan.summary && files.length > 0 && safeIndex === 0) {
                    // If user asked to summarize but no index given, summarize the first result
                    const selected = files[0];
                    if (canRunStep()) {
                        const fetchResult = await runTool('drive_retrieval', { driveFileId: selected.id });
                        sources.push(...(fetchResult.sources || []));
                        documents.push({ id: selected.id, name: selected.name, content: fetchResult.content });
                    }
                } else {
                    const citations = collectCitationsFromSources(sources);
                    return res.json({ answer: listResult.content, citations });
                }
            }

            if (drivePlan.intent === 'fetch' || drivePlan.intent === 'compare') {
                const ids = Array.isArray(drivePlan.fileIds) ? drivePlan.fileIds : [];
                const toFetch = drivePlan.intent === 'compare' ? ids.slice(0, 2) : ids.slice(0, 1);
                if (toFetch.length === 0) {
                    const listQuery = (drivePlan.listQuery || query.trim()).trim();
                    const listResult = await runTool('drive_retrieval', { query: listQuery });
                    sources.push(...(listResult.sources || []));
                    const files = Array.isArray(listResult.metadata?.files) ? listResult.metadata?.files : [];
                    const selected = files[safeIndex > 0 ? safeIndex - 1 : 0];
                    if (!selected?.id) {
                        const citations = collectCitationsFromSources(sources);
                        return res.json({ answer: 'No matching Drive files were found for that name.', citations });
                    }
                    if (canRunStep()) {
                        const fetchResult = await runTool('drive_retrieval', { driveFileId: selected.id });
                        sources.push(...(fetchResult.sources || []));
                        documents.push({ id: selected.id, name: selected.name, content: fetchResult.content });
                    }
                }
                for (const id of toFetch) {
                    if (!canRunStep()) break;
                    const fetchResult = await runTool('drive_retrieval', { driveFileId: id });
                    sources.push(...(fetchResult.sources || []));
                    const fileName = typeof fetchResult.metadata?.fileName === 'string' ? fetchResult.metadata.fileName : id;
                    documents.push({ id, name: fileName, content: fetchResult.content });
                }
            }

            if (documents.length === 0) {
                const citations = collectCitationsFromSources(sources);
                return res.json({ answer: 'No Drive documents could be retrieved for that request.', citations });
            }

            const final = await llm.reasonFinalAnswer(
                query.trim(),
                { documents },
                [],
                mergedConfig.temperature
            );
            const citations = collectCitationsFromSources(sources);
            return res.json({ answer: final.finalAnswer, citations });
        }

        const understanding = await llm.understandTask(query.trim(), toolDescriptions, mergedConfig.temperature);
        let internalQueries = normalizeQueries(understanding.internalQueries, query.trim());
        let externalQueries = normalizeQueries(understanding.externalQueries);
        let needsExternal = understanding.needsExternalKnowledge;

        let stepsUsed = 0;
        const canRunStep = () => stepsUsed < mergedConfig.maxSteps;
        const runTool = async (toolName: string, toolInput: ToolInput): Promise<ToolResult> => {
            stepsUsed += 1;
            return tools.execute(toolName, toolInput);
        };

        // Run vector search only if context wasn't already provided
        if (internalChunks.length === 0 && mergedConfig.enabledTools.includes('vector_search')) {
            for (const q of internalQueries.slice(0, 4)) {
                if (!canRunStep()) break;
                const result = await runTool('vector_search', { query: q });
                sources.push(...(result.sources || []));
                const hits = Array.isArray(result.metadata?.hits) ? result.metadata?.hits : [];
                for (const hit of hits) {
                    if (!hit?.text) continue;
                    internalChunks.push({
                        text: hit.text,
                        score: typeof hit?.score === 'number' ? hit.score : undefined,
                        fileName: hit?.metadata?.fileName,
                        driveFileId: hit?.metadata?.driveFileId,
                        chunkIndex: hit?.metadata?.chunkIndex,
                    });
                }
            }
        }

        const structured = await llm.structureInternalKnowledge(
            query.trim(),
            understanding.taskType,
            internalChunks,
            mergedConfig.temperature
        );

        needsExternal = needsExternal || structured.needsExternalKnowledge;
        const replan = await llm.replan(
            query.trim(),
            [],
            structured.structuredKnowledge,
            needsExternal,
            internalQueries,
            externalQueries,
            mergedConfig.temperature
        );
        internalQueries = normalizeQueries(replan.updatedInternalQueries, query.trim());
        externalQueries = normalizeQueries(replan.updatedExternalQueries);
        needsExternal = replan.needsExternalKnowledge && !replan.shouldFinish;

        if (needsExternal && mergedConfig.enabledTools.includes('web_search')) {
            for (const q of externalQueries.slice(0, 2)) {
                if (!canRunStep()) break;
                const searchResult = await runTool('web_search', { query: q });
                sources.push(...(searchResult.sources || []));
                externalFindings.push({ type: 'web_search', queryOrUrl: q, content: searchResult.content });

                const results = Array.isArray(searchResult.metadata?.results) ? searchResult.metadata?.results : [];
                const topResult = results[0];
                if (topResult?.url && mergedConfig.enabledTools.includes('web_scrape') && canRunStep()) {
                    const scrapeResult = await runTool('web_scrape', { url: topResult.url });
                    sources.push(...(scrapeResult.sources || []));
                    externalFindings.push({ type: 'web_scrape', queryOrUrl: topResult.url, content: scrapeResult.content });
                }
            }
        }

        const final = await llm.reasonFinalAnswer(
            query.trim(),
            structured.structuredKnowledge,
            externalFindings,
            mergedConfig.temperature
        );

        const citations = collectCitationsFromSources(sources);
        return res.json({ answer: final.finalAnswer, citations });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Agent API] Follow-up error:', error);
        return res.status(500).json({ error: msg });
    }
});

/**
 * GET /api/agent/run/:id — Get an agent run's status and data.
 */
router.get('/run/:id', (req, res) => {
    const run = runStore.get(req.params.id);
    if (!run) {
        return res.status(404).json({ error: 'Run not found.' });
    }
    return res.json(run);
});

/**
 * GET /api/agent/runs — List all agent runs (history).
 */
router.get('/runs', (_req, res) => {
    const runs = runStore.list().map((run) => ({
        id: run.id,
        task: run.task,
        status: run.status,
        stepsCount: run.steps.length,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
    }));
    return res.json(runs);
});

/**
 * GET /api/agent/vector-store/diagnostics — Check vector store health.
 */
router.get('/vector-store/diagnostics', (_req, res) => {
    const diag = vectorStore.getDiagnostics();
    return res.json({
        status: 'ok',
        vectorStore: {
            totalEntries: diag.totalEntries,
            maxEntries: diag.maxEntries,
            utilizationPercent: ((diag.totalEntries / diag.maxEntries) * 100).toFixed(1),
            isPersistent: diag.isPersistent,
            persistPath: diag.persistPath,
            filesRepresented: Array.from(diag.filesRepresented),
            fileCount: diag.filesRepresented.size,
        },
        recommendation: diag.totalEntries === 0 
            ? 'No entries in store. Please run ingestion from the Settings page.' 
            : `Store is healthy with ${diag.totalEntries} entries from ${diag.filesRepresented.size} file(s).`,
    });
});

export default router;
