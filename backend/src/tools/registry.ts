/**
 * ToolRegistry — central registry for all tools.
 * Maps tool names to instances and provides execution dispatch.
 */

import type { Tool, ToolInput, ToolResult } from '../types/index.js';

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    /** Register a tool */
    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    /** Get a tool by name */
    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /** Execute a tool by name with given input */
    async execute(name: string, input: ToolInput): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                content: `Error: Tool "${name}" not found. Available tools: ${this.getNames().join(', ')}`,
                sources: [],
            };
        }
        try {
            return await tool.execute(input);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: `Error executing tool "${name}": ${message}`,
                sources: [],
            };
        }
    }

    /** Get all tool names */
    getNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /** Get tool descriptions for LLM context */
    getDescriptions(): Array<{ name: string; description: string }> {
        return Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
        }));
    }

    /** Get descriptions filtered by enabled tool names */
    getEnabledDescriptions(enabled: string[]): Array<{ name: string; description: string }> {
        return this.getDescriptions().filter((t) => enabled.includes(t.name));
    }
}
