/**
 * Unit tests for tool implementations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import { WebSearchTool } from '../tools/webSearch.js';
import { WebScrapeTool } from '../tools/webScrape.js';
import { ReasoningTool } from '../tools/reasoning.js';

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    it('should register and retrieve tools', () => {
        const tool = new ReasoningTool();
        registry.register(tool);
        expect(registry.get('reasoning')).toBe(tool);
    });

    it('should list all tool names', () => {
        registry.register(new WebSearchTool());
        registry.register(new ReasoningTool());
        expect(registry.getNames()).toContain('web_search');
        expect(registry.getNames()).toContain('reasoning');
    });

    it('should return error for unknown tool', async () => {
        const result = await registry.execute('unknown_tool', {});
        expect(result.content).toContain('not found');
    });

    it('should return tool descriptions', () => {
        registry.register(new WebSearchTool());
        registry.register(new ReasoningTool());
        const descriptions = registry.getDescriptions();
        expect(descriptions.length).toBe(2);
        expect(descriptions[0]).toHaveProperty('name');
        expect(descriptions[0]).toHaveProperty('description');
    });
});

describe('WebSearchTool', () => {
    it('should return mock results when no API key', async () => {
        const tool = new WebSearchTool('');
        const result = await tool.execute({ query: 'test query' });
        expect(result.content).toContain('test query');
        expect(result.sources).toBeDefined();
        expect(result.metadata?.mock).toBe(true);
    });

    it('should return error when no query provided', async () => {
        const tool = new WebSearchTool('');
        const result = await tool.execute({});
        expect(result.content).toContain('Error');
    });
});

describe('WebScrapeTool', () => {
    it('should return error when no URL provided', async () => {
        const tool = new WebScrapeTool();
        const result = await tool.execute({});
        expect(result.content).toContain('Error');
    });
});

describe('ReasoningTool', () => {
    it('should return reasoning output', async () => {
        const tool = new ReasoningTool();
        const result = await tool.execute({ query: 'analyze this data' });
        expect(result.content).toContain('analyze this data');
        expect(result.sources).toEqual([]);
    });

    it('should return error when no query provided', async () => {
        const tool = new ReasoningTool();
        const result = await tool.execute({});
        expect(result.content).toContain('Error');
    });
});
