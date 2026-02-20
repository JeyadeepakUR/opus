/**
 * Core type definitions for the Opus system.
 * All shared interfaces used across backend modules.
 */

/** Input parameters passed to a tool during execution */
export interface ToolInput {
    query?: string;
    url?: string;
    driveFileId?: string;
    [key: string]: any;
}

/** Result returned by a tool after execution */
export interface ToolResult {
    content: string;
    sources?: Array<{ type: 'web' | 'drive' | 'local'; reference: string; label?: string }>;
    metadata?: Record<string, any>;
}

/** Interface that all tools must implement */
export interface Tool {
    name: string;
    description: string;
    execute(input: ToolInput): Promise<ToolResult>;
}

/** A single citation / source reference */
export interface Citation {
    id: string;
    type: 'web' | 'drive' | 'local';
    label: string;
    reference: string;
}

/** LLM-generated high-level plan for a task */
export interface Plan {
    overview: string;
    steps: string[];
}

/** LLM decision for the next action in the agent loop */
export interface LLMDecision {
    action: 'use_tool' | 'finish';
    tool: string | null;
    toolInput: ToolInput;
    thought: string;
    finalAnswer?: string;
}

/** Task category inferred during understanding phase */
export type AgentTaskType =
    | 'profile_analysis'
    | 'document_qa'
    | 'research'
    | 'coding'
    | 'general';

/** Explicit run phases for the reasoning layer */
export type AgentPhase =
    | 'understanding'
    | 'internal_knowledge'
    | 'structuring'
    | 'external_knowledge'
    | 'reasoning_answer';

/** Structured chunk representation captured from internal search */
export interface AgentChunkFinding {
    text: string;
    score?: number;
    fileName?: string;
    driveFileId?: string;
    chunkIndex?: number;
    mimeType?: string;
    sourceType: 'internal' | 'external';
}

/** Structured record for external evidence */
export interface AgentExternalFinding {
    type: 'web_search' | 'web_scrape';
    queryOrUrl: string;
    content: string;
    sources: Array<{ type: 'web' | 'drive' | 'local'; reference: string; label?: string }>;
}

/** State owned by the reasoning layer during a single run */
export interface AgentState {
    taskType: AgentTaskType;
    intentSummary: string;
    internalQueries: string[];
    externalQueries: string[];
    needsExternalKnowledge: boolean;
    shouldFinishEarly: boolean;
    internalChunks: AgentChunkFinding[];
    structuredKnowledge: Record<string, any> | null;
    externalFindings: AgentExternalFinding[];
    decisions: string[];
}

/** A single step in an agent run */
export interface AgentStep {
    stepNumber: number;
    toolName: string;
    toolInput: ToolInput;
    reasoning: string;
    output: string;
    sources: Array<{ type: 'web' | 'drive' | 'local'; reference: string; label?: string }>;
    timestamp: string;
    durationMs: number;
}

/** Configuration for an agent run */
export interface AgentConfig {
    maxSteps: number;
    temperature: number;
    enabledTools: string[];
}

/** Status of an agent run */
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'max_steps_reached';

/** A complete agent run with all its data */
export interface AgentRun {
    id: string;
    task: string;
    status: AgentRunStatus;
    phase: AgentPhase;
    plan: Plan | null;
    steps: AgentStep[];
    state: AgentState;
    finalAnswer: string | null;
    citations: Citation[];
    config: AgentConfig;
    createdAt: string;
    completedAt: string | null;
    error?: string;
}

/** Status of Google Drive ingestion */
export interface IngestionStatus {
    isRunning: boolean;
    lastRunAt: string | null;
    totalFilesIndexed: number;
    files: IngestionFile[];
}

/** A single file tracked by the ingestion pipeline */
export interface IngestionFile {
    driveFileId: string;
    fileName: string;
    mimeType: string;
    size: number;
    lastModified: string;
    ingestionStatus: 'indexed' | 'pending' | 'error';
    chunkCount: number;
    error?: string;
}

/** Vector store entry */
export interface VectorEntry {
    id: string;
    embedding: number[];
    text: string;
    metadata: {
        driveFileId?: string;
        fileName?: string;
        mimeType?: string;
        chunkIndex?: number;
        source?: string;
        [key: string]: any;
    };
}

/** Google OAuth tokens */
export interface OAuthTokens {
    access_token: string;
    refresh_token?: string;
    expiry_date?: number;
    token_type?: string;
    scope?: string;
}
