/**
 * AgentRunner — orchestrates the full agent execution loop.
 * Runs explicit reasoning phases with a persistent run state:
 * understanding → internal knowledge → structuring → optional external knowledge → final reasoning.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
    AgentConfig,
    AgentRun,
    AgentState,
    AgentStep,
    Citation,
    ToolInput,
    ToolResult,
} from '../types/index.js';
import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { runStore } from './store.js';

/** Default agent configuration */
const DEFAULT_CONFIG: AgentConfig = {
    maxSteps: 12,
    temperature: 0.3,
    enabledTools: ['vector_search', 'web_search', 'web_scrape', 'reasoning'],
};

export class AgentRunner {
    private llm: LLMClient;
    private tools: ToolRegistry;

    constructor(llm: LLMClient, tools: ToolRegistry) {
        this.llm = llm;
        this.tools = tools;
    }

    /**
     * Start a new agent run for the given task.
     * Runs asynchronously — returns the run ID immediately.
     */
    async startRun(task: string, config?: Partial<AgentConfig>): Promise<string> {
        const mergedConfig = { ...DEFAULT_CONFIG, ...config };
        const initialState: AgentState = {
            taskType: 'general',
            intentSummary: '',
            internalQueries: [],
            externalQueries: [],
            needsExternalKnowledge: false,
            shouldFinishEarly: false,
            internalChunks: [],
            structuredKnowledge: null,
            externalFindings: [],
            decisions: [],
        };

        const run: AgentRun = {
            id: uuidv4(),
            task,
            status: 'running',
            phase: 'understanding',
            plan: null,
            steps: [],
            state: initialState,
            finalAnswer: null,
            citations: [],
            config: mergedConfig,
            createdAt: new Date().toISOString(),
            completedAt: null,
        };

        runStore.set(run);

        // Execute asynchronously
        this.executeRun(run).catch((err) => {
            run.status = 'failed';
            run.error = err instanceof Error ? err.message : String(err);
            run.completedAt = new Date().toISOString();
            runStore.set(run);
            console.error(`[AgentRunner] Run ${run.id} failed:`, err);
        });

        return run.id;
    }

    /**
     * Core phased execution for reasoning-layer orchestration.
     */
    private async executeRun(run: AgentRun): Promise<void> {
        const { task, config } = run;
        const availableTools = config.enabledTools.length > 0
            ? this.tools.getEnabledDescriptions(config.enabledTools)
            : this.tools.getDescriptions();

        try {
            console.log(`[AgentRunner] Starting phased run ${run.id} for task: "${task}"`);

            run.plan = {
                overview: 'Phased reasoning run with explicit state and layered tool usage.',
                steps: [
                    'Understand user task and retrieval strategy',
                    'Retrieve internal knowledge via semantic search',
                    'Structure internal findings into facts',
                    'Gap-fill with optional external search',
                    'Reason and answer using structured evidence',
                ],
            };
            runStore.set(run);

            const driveHandled = await this.tryDriveQuery(run);
            if (driveHandled) {
                run.status = 'completed';
                run.completedAt = new Date().toISOString();
                run.citations = this.collectCitations(run.steps);
                runStore.set(run);
                console.log(`[AgentRunner] Run ${run.id} completed via Drive query handling`);
                return;
            }

            await this.runUnderstandingPhase(run, availableTools);
            await this.runInternalKnowledgePhase(run);
            await this.runStructuringPhase(run);
            await this.runExternalKnowledgePhase(run);
            await this.runFinalReasoningPhase(run);

            run.status = 'completed';
            run.completedAt = new Date().toISOString();
            run.citations = this.collectCitations(run.steps);
            runStore.set(run);

            console.log(`[AgentRunner] Run ${run.id} completed via phased architecture`);
            return;
        } catch (err) {
            if (run.status !== 'max_steps_reached') {
                run.status = 'failed';
            }
            run.error = err instanceof Error ? err.message : String(err);
            if (!run.finalAnswer) {
                run.finalAnswer = 'The agent could not complete the phased reasoning workflow.';
            }
            run.completedAt = new Date().toISOString();
            run.citations = this.collectCitations(run.steps);
            runStore.set(run);
            console.error(`[AgentRunner] Phased run ${run.id} failed:`, err);
        }
    }

    private async runUnderstandingPhase(
        run: AgentRun,
        tools: Array<{ name: string; description: string }>
    ): Promise<void> {
        run.phase = 'understanding';
        runStore.set(run);

        const understanding = await this.llm.understandTask(run.task, tools, run.config.temperature);
        run.state.taskType = understanding.taskType;
        run.state.intentSummary = understanding.intentSummary;
        run.state.internalQueries = this.normalizeQueries(understanding.internalQueries, run.task);
        run.state.externalQueries = this.normalizeQueries(understanding.externalQueries);
        run.state.needsExternalKnowledge = understanding.needsExternalKnowledge;
        run.state.decisions.push(`understanding: ${understanding.decision}`);
        runStore.set(run);
    }

    private async runInternalKnowledgePhase(run: AgentRun): Promise<void> {
        run.phase = 'internal_knowledge';
        runStore.set(run);

        if (!this.isToolEnabled(run.config, 'vector_search')) {
            run.state.decisions.push('internal_knowledge: vector_search disabled, skipping internal retrieval');
            runStore.set(run);
            return;
        }

        const queries = run.state.internalQueries.length > 0 ? run.state.internalQueries : [run.task];
        const expandedQueries = this.expandInternalQueries(run.state.taskType, queries, run.task);
        for (const query of expandedQueries.slice(0, 6)) {
            const result = await this.executeToolStep(run, 'vector_search', { query }, `Internal retrieval query: ${query}`);
            this.mergeInternalHits(run, result);

            if (this.hasReachedMaxSteps(run)) {
                return;
            }
        }

        run.state.decisions.push(`internal_knowledge: collected ${run.state.internalChunks.length} internal chunks`);
        runStore.set(run);
    }

    private async runStructuringPhase(run: AgentRun): Promise<void> {
        run.phase = 'structuring';
        runStore.set(run);

        const structured = await this.llm.structureInternalKnowledge(
            run.task,
            run.state.taskType,
            run.state.internalChunks.map((c) => ({
                text: c.text,
                score: c.score,
                fileName: c.fileName,
                driveFileId: c.driveFileId,
                chunkIndex: c.chunkIndex,
            })),
            run.config.temperature
        );

        run.state.structuredKnowledge = structured.structuredKnowledge;
        run.state.needsExternalKnowledge = run.state.needsExternalKnowledge || structured.needsExternalKnowledge;
        run.state.decisions.push(`structuring: ${structured.decision}`);
        run.state.decisions.push(`structuring: gaps=${(structured.gaps || []).join('; ') || 'none'}`);
        runStore.set(run);

        await this.runReplanPhase(run);
    }

    private async runExternalKnowledgePhase(run: AgentRun): Promise<void> {
        run.phase = 'external_knowledge';
        runStore.set(run);

        if (!run.state.needsExternalKnowledge || run.state.shouldFinishEarly) {
            run.state.decisions.push('external_knowledge: skipped (internal knowledge sufficient)');
            runStore.set(run);
            return;
        }

        if (!this.isToolEnabled(run.config, 'web_search')) {
            run.state.decisions.push('external_knowledge: web_search disabled, skipping external retrieval');
            runStore.set(run);
            return;
        }

        const queries = run.state.externalQueries.length > 0 ? run.state.externalQueries : [run.task];
        for (const query of queries.slice(0, 4)) {
            const searchResult = await this.executeToolStep(run, 'web_search', { query }, `External gap-fill query: ${query}`);
            run.state.externalFindings.push({
                type: 'web_search',
                queryOrUrl: query,
                content: searchResult.content,
                sources: searchResult.sources || [],
            });

            if (this.hasReachedMaxSteps(run)) {
                return;
            }

            const results = Array.isArray(searchResult.metadata?.results) ? searchResult.metadata?.results : [];
            const topResults = results.slice(0, 2);
            for (const hit of topResults) {
                if (!hit?.url) continue;
                const scrapeResult = await this.executeToolStep(run, 'web_scrape', { url: hit.url }, `Scrape: ${hit.title || hit.url}`);
                run.state.externalFindings.push({
                    type: 'web_scrape',
                    queryOrUrl: hit.url,
                    content: scrapeResult.content,
                    sources: scrapeResult.sources || [],
                });

                if (this.hasReachedMaxSteps(run)) {
                    return;
                }

                const links = Array.isArray(scrapeResult.metadata?.links) ? scrapeResult.metadata?.links : [];
                const followUps = links
                    .filter((link: { label?: string; url?: string }) => link.url)
                    .slice(0, 3);

                for (const link of followUps) {
                    if (!link?.url) continue;
                    const followResult = await this.executeToolStep(run, 'web_scrape', { url: link.url }, `Follow link: ${link.label || link.url}`);
                    run.state.externalFindings.push({
                        type: 'web_scrape',
                        queryOrUrl: link.url,
                        content: followResult.content,
                        sources: followResult.sources || [],
                    });

                    if (this.hasReachedMaxSteps(run)) {
                        return;
                    }
                }
            }
        }

        run.state.decisions.push(`external_knowledge: collected ${run.state.externalFindings.length} findings`);
        runStore.set(run);
    }

    private async runReplanPhase(run: AgentRun): Promise<void> {
        const replan = await this.llm.replan(
            run.task,
            run.steps,
            run.state.structuredKnowledge,
            run.state.needsExternalKnowledge,
            run.state.internalQueries,
            run.state.externalQueries,
            run.config.temperature
        );

        run.state.decisions.push(`replan: ${replan.decision}`);
        run.state.needsExternalKnowledge = replan.needsExternalKnowledge;
        run.state.internalQueries = this.normalizeQueries(replan.updatedInternalQueries, run.task);
        run.state.externalQueries = this.normalizeQueries(replan.updatedExternalQueries);
        run.state.shouldFinishEarly = replan.shouldFinish;
        if (replan.shouldFinish) {
            run.state.needsExternalKnowledge = false;
            run.state.externalQueries = [];
        }
        runStore.set(run);

        if (replan.shouldFinish) {
            run.state.decisions.push('replan: recommended finishing early');
        }
    }

    private async runFinalReasoningPhase(run: AgentRun): Promise<void> {
        run.phase = 'reasoning_answer';
        runStore.set(run);

        const final = await this.llm.reasonFinalAnswer(
            run.task,
            run.state.structuredKnowledge,
            run.state.externalFindings,
            run.config.temperature
        );

        run.finalAnswer = final.finalAnswer;
        run.state.decisions.push('reasoning_answer: final synthesis complete');
        runStore.set(run);
    }

    private async tryDriveQuery(run: AgentRun): Promise<boolean> {
        if (!this.isToolEnabled(run.config, 'drive_retrieval')) {
            return false;
        }

        const drivePlan = await this.llm.planDriveQuery(run.task, run.config.temperature);
        if (drivePlan.intent === 'none') {
            return false;
        }

        run.state.decisions.push(`drive_plan: ${drivePlan.decision}`);
        const safeIndex = Number.isFinite(drivePlan.selectIndex) && drivePlan.selectIndex > 0
            ? Math.floor(drivePlan.selectIndex)
            : 0;

        const documents: Array<{ id: string; name: string; content: string }> = [];

        if (drivePlan.intent === 'list') {
            const listQuery = (drivePlan.listQuery || run.task).trim();
            const listResult = await this.executeToolStep(run, 'drive_retrieval', { query: listQuery }, `List Drive files: ${listQuery}`);
            const files = Array.isArray(listResult.metadata?.files) ? listResult.metadata?.files : [];

            if (drivePlan.summary && files.length > 0) {
                const selected = files[safeIndex > 0 ? safeIndex - 1 : 0];
                if (selected?.id) {
                    const fetchResult = await this.executeToolStep(run, 'drive_retrieval', { driveFileId: selected.id }, `Fetch Drive file: ${selected.name || selected.id}`);
                    const fileName = typeof fetchResult.metadata?.fileName === 'string' ? fetchResult.metadata.fileName : selected.name || selected.id;
                    documents.push({ id: selected.id, name: fileName, content: fetchResult.content });
                }
            } else {
                run.finalAnswer = listResult.content;
                run.state.decisions.push('drive_plan: returned file list without summary');
                return true;
            }
        }

        if (drivePlan.intent === 'fetch' || drivePlan.intent === 'compare') {
            const ids = Array.isArray(drivePlan.fileIds) ? drivePlan.fileIds : [];
            const toFetch = drivePlan.intent === 'compare' ? ids.slice(0, 2) : ids.slice(0, 1);
            if (toFetch.length === 0) {
                const listQuery = (drivePlan.listQuery || run.task).trim();
                const listResult = await this.executeToolStep(run, 'drive_retrieval', { query: listQuery }, `List Drive files: ${listQuery}`);
                const files = Array.isArray(listResult.metadata?.files) ? listResult.metadata?.files : [];
                const selected = files[safeIndex > 0 ? safeIndex - 1 : 0];
                if (!selected?.id) {
                    run.finalAnswer = 'No matching Drive files were found for that name.';
                    return true;
                }
                const fetchResult = await this.executeToolStep(run, 'drive_retrieval', { driveFileId: selected.id }, `Fetch Drive file: ${selected.name || selected.id}`);
                const fileName = typeof fetchResult.metadata?.fileName === 'string' ? fetchResult.metadata.fileName : selected.name || selected.id;
                documents.push({ id: selected.id, name: fileName, content: fetchResult.content });
            }
            for (const id of toFetch) {
                const fetchResult = await this.executeToolStep(run, 'drive_retrieval', { driveFileId: id }, `Fetch Drive file: ${id}`);
                const fileName = typeof fetchResult.metadata?.fileName === 'string' ? fetchResult.metadata.fileName : id;
                documents.push({ id, name: fileName, content: fetchResult.content });
            }
        }

        if (documents.length === 0) {
            run.finalAnswer = 'No Drive documents could be retrieved for that request.';
            return true;
        }

        const final = await this.llm.reasonFinalAnswer(
            run.task,
            { documents },
            [],
            run.config.temperature
        );
        run.finalAnswer = final.finalAnswer;
        run.state.decisions.push('drive_plan: summarized retrieved Drive documents');
        return true;
    }

    private async executeToolStep(
        run: AgentRun,
        toolName: string,
        toolInput: ToolInput,
        reasoning: string
    ): Promise<ToolResult> {
        if (run.steps.length >= run.config.maxSteps) {
            run.status = 'max_steps_reached';
            run.finalAnswer = 'The agent reached the maximum allowed tool steps before finishing all phases.';
            run.state.decisions.push('step_limit: reached max steps during phased execution');
            runStore.set(run);
            return { content: 'Max steps reached.', sources: [] };
        }

        const startTime = Date.now();
        const toolResult = await this.tools.execute(toolName, toolInput);
        const durationMs = Date.now() - startTime;

        const step: AgentStep = {
            stepNumber: run.steps.length + 1,
            toolName,
            toolInput,
            reasoning,
            output: toolResult.content,
            sources: toolResult.sources || [],
            timestamp: new Date().toISOString(),
            durationMs,
        };
        run.steps.push(step);
        runStore.set(run);
        return toolResult;
    }

    private mergeInternalHits(run: AgentRun, result: ToolResult): void {
        const hits = Array.isArray(result.metadata?.hits) ? result.metadata?.hits : [];
        for (const hit of hits) {
            const text = typeof hit?.text === 'string' ? hit.text : '';
            if (!text) continue;

            const fileName = typeof hit?.metadata?.fileName === 'string' ? hit.metadata.fileName : undefined;
            const chunkIndex = typeof hit?.metadata?.chunkIndex === 'number' ? hit.metadata.chunkIndex : undefined;
            const dedupeKey = `${hit?.metadata?.driveFileId || ''}::${chunkIndex ?? ''}::${text.slice(0, 120)}`;
            const exists = run.state.internalChunks.some((c) => {
                const key = `${c.driveFileId || ''}::${c.chunkIndex ?? ''}::${c.text.slice(0, 120)}`;
                return key === dedupeKey;
            });
            if (exists) continue;

            run.state.internalChunks.push({
                text,
                score: typeof hit?.score === 'number' ? hit.score : undefined,
                fileName,
                driveFileId: typeof hit?.metadata?.driveFileId === 'string' ? hit.metadata.driveFileId : undefined,
                chunkIndex,
                mimeType: typeof hit?.metadata?.mimeType === 'string' ? hit.metadata.mimeType : undefined,
                sourceType: 'internal',
            });
        }
        runStore.set(run);
    }

    private normalizeQueries(queries: string[] | undefined, fallback?: string): string[] {
        const normalized = (queries || [])
            .map((q) => (typeof q === 'string' ? q.trim() : ''))
            .filter((q) => q.length > 0);

        if (normalized.length > 0) {
            return Array.from(new Set(normalized));
        }
        return fallback ? [fallback] : [];
    }

    private expandInternalQueries(taskType: AgentState['taskType'], queries: string[], fallback: string): string[] {
        const base = queries.length > 0 ? queries : [fallback];
        const extras: string[] = [];

        if (base.length < 2) {
            extras.push(`${fallback} overview`);
            extras.push(`${fallback} details`);
        }

        if (taskType === 'profile_analysis') {
            extras.push('skills');
            extras.push('experience');
            extras.push('projects');
            extras.push('certifications');
        }

        const combined = [...base, ...extras]
            .map((q) => q.trim())
            .filter((q) => q.length > 0);

        return Array.from(new Set(combined));
    }

    private isToolEnabled(config: AgentConfig, toolName: string): boolean {
        return config.enabledTools.length === 0 || config.enabledTools.includes(toolName);
    }

    private hasReachedMaxSteps(run: AgentRun): boolean {
        return run.steps.length >= run.config.maxSteps;
    }

    /**
     * Collect unique citations from all steps.
     */
    private collectCitations(steps: AgentStep[]): Citation[] {
        const seen = new Set<string>();
        const citations: Citation[] = [];
        let counter = 1;

        for (const step of steps) {
            for (const source of step.sources) {
                if (!seen.has(source.reference)) {
                    seen.add(source.reference);
                    citations.push({
                        id: String(counter++),
                        type: source.type,
                        label: source.label || source.reference,
                        reference: source.reference,
                    });
                }
            }
        }

        return citations;
    }
}
