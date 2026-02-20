/**
 * RunStore — in-memory storage for agent runs.
 * Provides CRUD operations for AgentRun objects.
 */

import type { AgentRun } from '../types/index.js';

export class RunStore {
    private runs: Map<string, AgentRun> = new Map();

    /** Get a run by ID */
    get(id: string): AgentRun | undefined {
        return this.runs.get(id);
    }

    /** Save or update a run */
    set(run: AgentRun): void {
        this.runs.set(run.id, run);
    }

    /** List all runs, sorted by creation time (newest first) */
    list(): AgentRun[] {
        return Array.from(this.runs.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }

    /** Delete a run */
    delete(id: string): boolean {
        return this.runs.delete(id);
    }
}

/** Singleton run store instance */
export const runStore = new RunStore();
