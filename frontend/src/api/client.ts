/**
 * Typed API client for communicating with the Opus backend.
 */

// In production, use VITE_API_URL env var, otherwise use relative paths (proxied in dev)
const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const API_BASE = `${API_BASE_URL}/api`;
const AUTH_BASE = `${API_BASE_URL}/auth`;

/** Agent run summary (from list endpoint) */
export interface RunSummary {
    id: string;
    task: string;
    status: 'running' | 'completed' | 'failed' | 'max_steps_reached';
    stepsCount: number;
    createdAt: string;
    completedAt: string | null;
}

/** Citation */
export interface Citation {
    id: string;
    type: 'web' | 'drive' | 'local';
    label: string;
    reference: string;
}

/** Agent step */
export interface AgentStep {
    stepNumber: number;
    toolName: string;
    toolInput: Record<string, any>;
    reasoning: string;
    output: string;
    sources: Array<{ type: string; reference: string; label?: string }>;
    timestamp: string;
    durationMs: number;
}

/** Agent plan */
export interface Plan {
    overview: string;
    steps: string[];
}

/** Full agent run */
export interface AgentRun {
    id: string;
    task: string;
    status: 'running' | 'completed' | 'failed' | 'max_steps_reached';
    phase?: 'understanding' | 'internal_knowledge' | 'structuring' | 'external_knowledge' | 'reasoning_answer';
    plan: Plan | null;
    steps: AgentStep[];
    finalAnswer: string | null;
    citations: Citation[];
    config: {
        maxSteps: number;
        temperature: number;
        enabledTools: string[];
    };
    createdAt: string;
    completedAt: string | null;
    error?: string;
}

export interface FollowUpResponse {
    answer: string;
    citations: Citation[];
}

/** Auth status */
export interface AuthStatus {
    isConnected: boolean;
    email: string | null;
}

/** Ingestion status */
export interface IngestionStatus {
    isRunning: boolean;
    lastRunAt: string | null;
    totalFilesIndexed: number;
    files: IngestionFile[];
}

/** Ingestion file */
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

/** Knowledge sources */
export interface KnowledgeSources {
    files: IngestionFile[];
    totalFiles: number;
    totalChunks: number;
    lastIngestionAt: string | null;
}

/** File chunks */
export interface FileChunks {
    fileId: string;
    chunks: Array<{ id: string; text: string; chunkIndex: number; fileName: string }>;
    total: number;
}

/** Drive file for selection */
export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    isFolder: boolean;
    size: number;
    modifiedTime?: string | null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/** API client methods */
export const api = {
    /** Start a new agent run */
    startRun: (task: string, config?: Partial<AgentRun['config']>) =>
        request<{ runId: string; run: AgentRun }>(`${API_BASE}/agent/run`, {
            method: 'POST',
            body: JSON.stringify({ task, config }),
        }),

    /** Get agent run details */
    getRun: (id: string) =>
        request<AgentRun>(`${API_BASE}/agent/run/${id}`),

    /** Delete a specific run */
    deleteRun: (id: string) =>
        request<{ message: string }>(`${API_BASE}/agent/run/${id}`, { method: 'DELETE' }),

    /** List all runs */
    listRuns: () =>
        request<RunSummary[]>(`${API_BASE}/agent/runs`),

    /** Delete all runs */
    deleteAllRuns: () =>
        request<{ message: string; deletedCount: number }>(`${API_BASE}/agent/runs`, { method: 'DELETE' }),

    /** Stateless follow-up query */
    followUp: (query: string, config?: Partial<AgentRun['config']>, context?: string) =>
        request<FollowUpResponse>(`${API_BASE}/agent/followup`, {
            method: 'POST',
            body: JSON.stringify({ query, config, context }),
        }),

    /** Get auth status */
    getAuthStatus: () =>
        request<AuthStatus>(`${API_BASE}/auth/status`),

    /** Disconnect Google */
    disconnectGoogle: () =>
        request<{ success: boolean }>(`${API_BASE}/auth/disconnect`, { method: 'POST' }),

    /** Get ingestion status */
    getIngestionStatus: () =>
        request<IngestionStatus>(`${API_BASE}/ingestion/status`),

    /** List selectable Drive files */
    listDriveFiles: () =>
        request<{ files: DriveFile[] }>(`${API_BASE}/ingestion/files`),

    /** Trigger ingestion (all files) */
    triggerIngestion: () =>
        request<{ message: string; status: IngestionStatus }>(`${API_BASE}/ingestion/run`, { method: 'POST' }),

    /** Trigger selective ingestion (chosen files only) */
    triggerSelectiveIngestion: (fileIds: string[]) =>
        request<{ message: string; status: IngestionStatus }>(`${API_BASE}/ingestion/selective`, {
            method: 'POST',
            body: JSON.stringify({ fileIds }),
        }),

    /** Clear all indexed data from vector store */
    clearVectorStore: () =>
        request<{ message: string; totalRemaining: number }>(`${API_BASE}/ingestion/clear`, { method: 'POST' }),

    /** Get knowledge sources */
    getKnowledgeSources: () =>
        request<KnowledgeSources>(`${API_BASE}/knowledge/sources`),

    /** Get file chunks */
    getFileChunks: (fileId: string) =>
        request<FileChunks>(`${API_BASE}/knowledge/sources/${fileId}/chunks`),

    /** Google OAuth URL (redirect) */
    getGoogleAuthUrl: () => `${AUTH_BASE}/google`,
};
