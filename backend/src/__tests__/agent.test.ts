/**
 * Unit tests for the AgentRunner — tests the agent loop with mocked LLM and tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunner } from '../agent/runner.js';
import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { runStore } from '../agent/store.js';
import type { Plan, LLMDecision, ToolResult } from '../types/index.js';

// Mock the LLM Client
vi.mock('../llm/client.js', () => ({
    LLMClient: vi.fn().mockImplementation(() => ({
        generatePlan: vi.fn(),
        decideNextTool: vi.fn(),
        summarizeResults: vi.fn(),
        getEmbedding: vi.fn(),
    })),
}));

describe('AgentRunner', () => {
    let runner: AgentRunner;
    let mockLLM: any;
    let tools: ToolRegistry;

    beforeEach(() => {
        mockLLM = new LLMClient('test-key');
        tools = new ToolRegistry();

        // Register a mock tool
        tools.register({
            name: 'web_search',
            description: 'Search the web',
            execute: vi.fn().mockResolvedValue({
                content: 'Search results for test query',
                sources: [{ type: 'web', reference: 'https://example.com', label: 'Example' }],
            } as ToolResult),
        });

        tools.register({
            name: 'reasoning',
            description: 'Reasoning tool',
            execute: vi.fn().mockResolvedValue({
                content: 'Reasoning complete',
                sources: [],
            } as ToolResult),
        });

        runner = new AgentRunner(mockLLM, tools);
    });

    it('should create a run and return an ID', async () => {
        const plan: Plan = { overview: 'Test plan', steps: ['Step 1', 'Step 2'] };
        mockLLM.generatePlan.mockResolvedValue(plan);
        mockLLM.decideNextTool.mockResolvedValue({
            action: 'finish',
            tool: null,
            toolInput: {},
            thought: 'Done',
            finalAnswer: 'Test answer',
        } as LLMDecision);

        const runId = await runner.startRun('Test task');
        expect(runId).toBeDefined();
        expect(typeof runId).toBe('string');

        // Wait for async execution
        await new Promise((resolve) => setTimeout(resolve, 100));

        const run = runStore.get(runId);
        expect(run).toBeDefined();
        expect(run!.task).toBe('Test task');
    });

    it('should generate a plan on start', async () => {
        const plan: Plan = { overview: 'Search and summarize', steps: ['Search web', 'Summarize results'] };
        mockLLM.generatePlan.mockResolvedValue(plan);
        mockLLM.decideNextTool.mockResolvedValue({
            action: 'finish',
            tool: null,
            toolInput: {},
            thought: 'Task complete',
            finalAnswer: 'Final result',
        } as LLMDecision);

        const runId = await runner.startRun('Search for info');
        await new Promise((resolve) => setTimeout(resolve, 100));

        const run = runStore.get(runId);
        expect(run!.plan).toEqual(plan);
    });

    it('should execute tools and collect results', async () => {
        const plan: Plan = { overview: 'Test', steps: ['Search'] };
        mockLLM.generatePlan.mockResolvedValue(plan);

        // First call: use a tool, second call: finish
        mockLLM.decideNextTool
            .mockResolvedValueOnce({
                action: 'use_tool',
                tool: 'web_search',
                toolInput: { query: 'test' },
                thought: 'Searching for info',
            } as LLMDecision)
            .mockResolvedValueOnce({
                action: 'finish',
                tool: null,
                toolInput: {},
                thought: 'Done',
                finalAnswer: 'Found the answer',
            } as LLMDecision);

        const runId = await runner.startRun('Test task');
        await new Promise((resolve) => setTimeout(resolve, 200));

        const run = runStore.get(runId);
        expect(run!.status).toBe('completed');
        expect(run!.steps.length).toBe(1);
        expect(run!.steps[0].toolName).toBe('web_search');
        expect(run!.finalAnswer).toBe('Found the answer');
        expect(run!.citations.length).toBeGreaterThan(0);
    });

    it('should handle max steps limit', async () => {
        const plan: Plan = { overview: 'Test', steps: ['Step 1'] };
        mockLLM.generatePlan.mockResolvedValue(plan);

        // Always choose a tool (never finish)
        mockLLM.decideNextTool.mockResolvedValue({
            action: 'use_tool',
            tool: 'reasoning',
            toolInput: { query: 'think' },
            thought: 'Thinking...',
        } as LLMDecision);

        mockLLM.summarizeResults.mockResolvedValue({
            finalAnswer: 'Partial answer',
            citations: [],
        });

        const runId = await runner.startRun('Test task', { maxSteps: 2 });
        await new Promise((resolve) => setTimeout(resolve, 500));

        const run = runStore.get(runId);
        expect(run!.status).toBe('max_steps_reached');
        expect(run!.steps.length).toBe(2);
    });
});
