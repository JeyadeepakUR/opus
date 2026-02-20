/**
 * LLM Client — wraps the OpenAI SDK to provide structured agent operations.
 * All methods return strongly-typed parsed JSON responses.
 */

import OpenAI from 'openai';
import type { AgentExternalFinding, AgentStep, AgentTaskType, Citation, LLMDecision, Plan } from '../types/index.js';
import {
    buildDecisionPrompt,
    buildDriveQueryPrompt,
    buildFinalReasoningPrompt,
    buildPlanPrompt,
    buildReplanPrompt,
    buildStructuringPrompt,
    buildSummaryPrompt,
    buildTaskUnderstandingPrompt,
} from './prompts.js';

export class LLMClient {
    private client: OpenAI;
    private model: string;
    private embeddingModel: string;

    constructor(apiKey: string, model: string = 'gpt-4o-mini', baseUrl?: string, embeddingModel: string = 'text-embedding-3-small') {
        console.log(`[LLMClient] Initializing with baseUrl: ${baseUrl || '(default OpenAI)'}`);
        
        const config: any = { 
            apiKey,
        };
        
        if (baseUrl) {
            config.baseURL = baseUrl;
            console.log(`[LLMClient] Using custom baseURL: ${baseUrl}`);
        }
        
        this.client = new OpenAI(config);
        this.model = model;
        this.embeddingModel = embeddingModel;
        
        console.log(`[LLMClient] Initialized: model=${model}, hasApiKey=${!!apiKey}`);
    }

    /**
     * Generate a high-level plan for the given task.
     */
    async generatePlan(
        task: string,
        tools: Array<{ name: string; description: string }>,
        temperature: number = 0.3
    ): Promise<Plan> {
        const { system, user } = buildPlanPrompt(task, tools);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<Plan>(response);
    }

    /**
     * Decide the next tool to use or whether to finish.
     */
    async decideNextTool(
        task: string,
        plan: Plan,
        steps: AgentStep[],
        tools: Array<{ name: string; description: string }>,
        maxSteps: number,
        temperature: number = 0.2
    ): Promise<LLMDecision> {
        const { system, user } = buildDecisionPrompt(task, plan, steps, tools, maxSteps);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<LLMDecision>(response);
    }

    /**
     * Summarize all collected results into a final answer with citations.
     */
    async summarizeResults(
        task: string,
        steps: AgentStep[],
        temperature: number = 0.3
    ): Promise<{ finalAnswer: string; citations: Citation[] }> {
        const { system, user } = buildSummaryPrompt(task, steps);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<{ finalAnswer: string; citations: Citation[] }>(response);
    }

    /**
     * Understanding phase: classify task and produce internal/external retrieval strategy.
     */
    async understandTask(
        task: string,
        tools: Array<{ name: string; description: string }>,
        temperature: number = 0.2
    ): Promise<{
        taskType: AgentTaskType;
        intentSummary: string;
        internalQueries: string[];
        externalQueries: string[];
        needsExternalKnowledge: boolean;
        decision: string;
    }> {
        const { system, user } = buildTaskUnderstandingPrompt(task, tools);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<{
            taskType: AgentTaskType;
            intentSummary: string;
            internalQueries: string[];
            externalQueries: string[];
            needsExternalKnowledge: boolean;
            decision: string;
        }>(response);
    }

    /**
     * Structuring phase: convert raw internal chunks into structured knowledge.
     */
    async structureInternalKnowledge(
        task: string,
        taskType: AgentTaskType,
        internalChunks: Array<{ text: string; score?: number; fileName?: string; driveFileId?: string; chunkIndex?: number }>,
        temperature: number = 0.2
    ): Promise<{
        structuredKnowledge: Record<string, any>;
        gaps: string[];
        needsExternalKnowledge: boolean;
        decision: string;
    }> {
        const { system, user } = buildStructuringPrompt(task, taskType, internalChunks);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<{
            structuredKnowledge: Record<string, any>;
            gaps: string[];
            needsExternalKnowledge: boolean;
            decision: string;
        }>(response);
    }

    /**
     * Final reasoning phase: synthesize final answer from structured evidence.
     */
    async reasonFinalAnswer(
        task: string,
        structuredKnowledge: Record<string, any> | null,
        externalFindings: AgentExternalFinding[],
        temperature: number = 0.3
    ): Promise<{ finalAnswer: string }> {
        const { system, user } = buildFinalReasoningPrompt(task, structuredKnowledge, externalFindings);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<{ finalAnswer: string }>(response);
    }

    /**
     * Replanning phase: update queries/strategy based on current evidence.
     */
    async replan(
        task: string,
        steps: AgentStep[],
        structuredKnowledge: Record<string, any> | null,
        needsExternalKnowledge: boolean,
        internalQueries: string[],
        externalQueries: string[],
        temperature: number = 0.2
    ): Promise<{
        shouldFinish: boolean;
        updatedInternalQueries: string[];
        updatedExternalQueries: string[];
        needsExternalKnowledge: boolean;
        decision: string;
    }> {
        const { system, user } = buildReplanPrompt(
            task,
            steps,
            structuredKnowledge,
            needsExternalKnowledge,
            internalQueries,
            externalQueries
        );
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<{
            shouldFinish: boolean;
            updatedInternalQueries: string[];
            updatedExternalQueries: string[];
            needsExternalKnowledge: boolean;
            decision: string;
        }>(response);
    }

    /**
     * Drive query planner: decide if request needs Drive operations.
     */
    async planDriveQuery(
        task: string,
        temperature: number = 0.2
    ): Promise<{
        intent: 'none' | 'list' | 'fetch' | 'compare';
        listQuery: string;
        selectIndex: number;
        fileIds: string[];
        summary: boolean;
        decision: string;
    }> {
        const { system, user } = buildDriveQueryPrompt(task);
        const response = await this.chat(system, user, temperature);
        return this.parseJSON<{
            intent: 'none' | 'list' | 'fetch' | 'compare';
            listQuery: string;
            selectIndex: number;
            fileIds: string[];
            summary: boolean;
            decision: string;
        }>(response);
    }

    /**
     * Generate embeddings for the given text.
     */
    async getEmbedding(text: string): Promise<number[]> {
        const response = await this.client.embeddings.create({
            model: this.embeddingModel,
            input: text,
        });
        return response.data[0].embedding;
    }

    /**
     * Safe embedding wrapper — truncates input to prevent API limits,
     * then generates embedding. Use this for large or unknown-size text.
     */
    async getSafeEmbedding(text: string): Promise<number[]> {
        // 4k char limit (~1000 tokens) to prevent API overload
        const truncated = text.slice(0, 4000);
        return this.getEmbedding(truncated);
    }

    /**
     * Core chat completion call with JSON response format.
     * Falls back to non-strict mode if the model rejects `response_format`.
     */
    private async chat(
        system: string,
        user: string,
        temperature: number
    ): Promise<string> {
        try {
            // Try with strict JSON format first
            const response = await this.client.chat.completions.create({
                model: this.model,
                temperature,
                response_format: { type: 'json_object' } as any,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('LLM returned empty response');
            }
            return content;
        } catch (err) {
            // If response_format is not supported, retry without it
            if (err instanceof Error && err.message.includes('response_format')) {
                console.warn('[LLMClient] Model does not support response_format, retrying without strict JSON...');
                try {
                    const response = await this.client.chat.completions.create({
                        model: this.model,
                        temperature,
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: user },
                        ],
                    });

                    const content = response.choices[0]?.message?.content;
                    if (!content) {
                        throw new Error('LLM returned empty response');
                    }
                    return content;
                } catch (retryErr) {
                    console.error('[LLMClient] Retry without response_format failed:', retryErr);
                    throw retryErr;
                }
            }

            console.error('[LLMClient] Chat completion failed:', err);
            if (err instanceof Error) {
                // Provide more specific error messages
                if (err.message.includes('API key') || err.message.includes('401')) {
                    throw new Error('Invalid API key. Check your LLM_API_KEY environment variable.');
                }
                if (err.message.includes('model') || err.message.includes('404')) {
                    throw new Error(`Model "${this.model}" not available. Check your LLM_MODEL configuration.`);
                }
                if (err.message.includes('429')) {
                    throw new Error('Rate limited by LLM provider. Try again in a few moments or use a different model.');
                }
            }
            throw err;
        }
    }

    /**
     * Safely parse JSON from LLM response.
     */
    private parseJSON<T>(text: string): T {
        try {
            return JSON.parse(text) as T;
        } catch (err) {
            // Try to extract JSON from markdown code blocks
            const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) {
                return JSON.parse(match[1].trim()) as T;
            }
            throw new Error(`Failed to parse LLM response as JSON: ${text.slice(0, 200)}`);
        }
    }
}
