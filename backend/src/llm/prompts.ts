/**
 * Prompt templates for the LLM client.
 * Each function returns { system, user } message pairs for different agent operations.
 */

import type { AgentExternalFinding, AgentStep, AgentTaskType, Plan, Tool } from '../types/index.js';

/** Format tool descriptions for the LLM */
function formatToolDescriptions(tools: Array<{ name: string; description: string }>): string {
    return tools
        .map((t) => `- **${t.name}**: ${t.description}`)
        .join('\n');
}

/** Format step history for context */
function formatStepHistory(steps: AgentStep[]): string {
    if (steps.length === 0) return 'No steps executed yet.';
    return steps
        .map(
            (s) =>
                `Step ${s.stepNumber}: Used "${s.toolName}" — Reasoning: "${s.reasoning}" — Output summary: "${s.output.slice(0, 300)}${s.output.length > 300 ? '...' : ''}"`
        )
        .join('\n');
}

/**
 * Generate the plan prompt for creating a multi-step strategy.
 */
export function buildPlanPrompt(
    task: string,
    tools: Array<{ name: string; description: string }>
): { system: string; user: string } {
    return {
        system: `You are an expert AI planning agent. Your job is to create a high-level plan to accomplish a user's task.

You have access to the following tools:
${formatToolDescriptions(tools)}

Respond ONLY with valid JSON matching this schema:
{
  "overview": "Brief summary of the approach",
  "steps": ["Step 1 description", "Step 2 description", ...]
}

Guidelines:
- Create 2-8 concrete steps.
- Each step should map to a specific tool or a reasoning action.
- Be strategic — gather information before synthesizing.
- IMPORTANT: When possible, use BOTH vector_search (for ingested documents) AND web_search (for external sources) to give comprehensive answers.
- Consider searching multiple sources to provide complete and cross-verified information.
- Do NOT include any text outside the JSON.`,
        user: `Task: ${task}`,
    };
}

/**
 * Generate the tool decision prompt for selecting the next action.
 */
export function buildDecisionPrompt(
    task: string,
    plan: Plan,
    steps: AgentStep[],
    tools: Array<{ name: string; description: string }>,
    maxSteps: number
): { system: string; user: string } {
    const remainingSteps = maxSteps - steps.length;
    const hasVectorSearch = tools.some((t) => t.name === 'vector_search');
    const hasWebSearch = tools.some((t) => t.name === 'web_search');
    const usedVectorSearch = steps.some((s) => s.toolName === 'vector_search');
    const usedWebSearch = steps.some((s) => s.toolName === 'web_search');

    return {
        system: `You are an autonomous AI agent executing a task step by step.

Available tools:
${formatToolDescriptions(tools)}

You must respond ONLY with valid JSON matching this schema:
{
  "action": "use_tool" | "finish",
  "tool": "tool_name" | null,
  "toolInput": { "query": "...", "url": "...", "driveFileId": "..." },
  "thought": "Brief explanation of why this action is chosen",
  "finalAnswer": "Only if action is 'finish' — the complete final answer in markdown"
}

Rules:
- Analyze what has been done so far and what still needs to be done.
- Choose the most appropriate tool for the next step.
- IMPORTANT: Prefer vector_search for searching ingested documents. Only use drive_retrieval to fetch a SPECIFIC file by ID, NOT for general queries.
- For comprehensive answers, try BOTH vector_search (ingested docs) AND web_search (external sources) if:
  ${hasVectorSearch && !usedVectorSearch ? '  - vector_search has not been tried yet' : ''}
  ${hasWebSearch && !usedWebSearch ? '  - web_search has not been tried yet (to supplement local docs)' : ''}
- If vector_search found relevant content, do NOT call drive_retrieval — use the vector search results instead.
- If you have enough information to answer the task, use action "finish" with a comprehensive finalAnswer.
- If you are running low on steps (${remainingSteps} remaining), prioritize finishing.
- The "thought" field is shown to the user as reasoning — keep it concise and informative.
- Do NOT include any text outside the JSON.`,
        user: `Task: ${task}

Plan:
${plan.overview}
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Steps completed so far:
${formatStepHistory(steps)}

Remaining steps allowed: ${remainingSteps}

Decide the next action:`,
    };
}

/**
 * Generate the summarization prompt for final answer with citations.
 */
export function buildSummaryPrompt(
    task: string,
    steps: AgentStep[]
): { system: string; user: string } {
    const allSources = steps.flatMap((s) => s.sources || []);
    const sourcesText = allSources.length > 0
        ? allSources.map((s, i) => `[${i + 1}] ${s.type}: ${s.reference}${s.label ? ` (${s.label})` : ''}`).join('\n')
        : 'No external sources used.';

    return {
        system: `You are a summarization agent. Given a task and the steps taken to solve it, produce a comprehensive final answer.

Respond ONLY with valid JSON matching this schema:
{
  "finalAnswer": "Complete answer in markdown format. Use [1], [2] etc. to cite sources inline.",
  "citations": [
    { "id": "1", "type": "web" | "drive" | "local", "label": "Source title", "reference": "URL or file ID" }
  ]
}

Guidelines:
- Produce a thorough, well-structured markdown answer.
- Reference sources inline using citation markers like [1], [2].
- Include ALL relevant sources in the citations array.
- Do NOT include chain-of-thought reasoning — only the polished answer.
- Do NOT include any text outside the JSON.`,
        user: `Task: ${task}

Steps taken:
${formatStepHistory(steps)}

Available sources:
${sourcesText}

Produce the final answer with citations:`,
    };
}

/**
 * Understanding phase: classify task and propose internal/external query strategy.
 */
export function buildTaskUnderstandingPrompt(
    task: string,
    tools: Array<{ name: string; description: string }>
): { system: string; user: string } {
    return {
                system: `You are the reasoning layer of an agentic system.

Architecture rules:
- Tool layer performs I/O only (search/fetch).
- Knowledge layer stores ingested internal chunks.
- Reasoning layer decides strategy and sequencing.

Universal exploration playbook:
- Classify the task type (user_profile, doc_qa, research, coding, general).
- Decide search order based on type:
    - user_profile: internal docs first, then portfolio, then external profiles, then web.
    - doc_qa: internal docs first, then web only for gaps.
    - research: web first, but check internal notes for context.
    - coding: internal docs/tools first, then official docs, then web.
- Internal phase: run 2-3 semantically different queries, merge+dedupe chunks, then structure facts.
- External phase: start from official/hub pages, extract outbound links, follow the most relevant once or twice, then stop to summarize.

Available tools:
${formatToolDescriptions(tools)}

Respond ONLY as valid JSON with this schema:
{
    "taskType": "profile_analysis" | "document_qa" | "research" | "coding" | "general",
    "intentSummary": "short summary",
    "internalQueries": ["query1", "query2"],
    "externalQueries": ["query1", "query2"],
    "needsExternalKnowledge": true | false,
    "decision": "one short sentence about why this strategy"
}

Guidance:
- Prefer internal knowledge first for user/profile/doc-centric tasks.
- Use external knowledge only for gaps, freshness, or explicit web intent.
- Propose 2-6 internal queries with coverage-oriented wording.
- Keep externalQueries empty when not required.`,
        user: `User task: ${task}`,
    };
}

/**
 * Structuring phase: convert raw internal chunks into structured facts.
 */
export function buildStructuringPrompt(
    task: string,
    taskType: AgentTaskType,
    internalChunks: Array<{ text: string; score?: number; fileName?: string; driveFileId?: string; chunkIndex?: number }>
): { system: string; user: string } {
    const chunkText = internalChunks.length === 0
        ? 'No internal chunks were retrieved.'
        : internalChunks
            .map((chunk, idx) => {
                const meta = `${chunk.fileName || 'Unknown'}${typeof chunk.chunkIndex === 'number' ? `#${chunk.chunkIndex}` : ''}`;
                return `[Chunk ${idx + 1}] score=${chunk.score ?? 'n/a'} source=${meta}\n${chunk.text.slice(0, 1500)}`;
            })
            .join('\n\n---\n\n');

    return {
                system: `You are the reasoning layer's internal structuring function.

Your ONLY job is to transform retrieved internal chunks into structured knowledge.
Do not browse web. Do not invent facts.

Respond ONLY as valid JSON:
{
    "structuredKnowledge": {
        "entities": [],
        "skills": [],
        "projects": [],
        "certifications": [],
        "claims": []
    },
    "gaps": ["missing info 1", "missing info 2"],
    "needsExternalKnowledge": true | false,
    "decision": "one short sentence"
}

Rules:
- Extract only supported facts from chunks.
- Deduplicate repeated facts.
- Mark needsExternalKnowledge=true only when gaps are material to answering the task.
- Keep output concise but structured.`,
        user: `Task: ${task}
Task type: ${taskType}

Internal chunks:
${chunkText}`,
    };
}

/**
 * Final reasoning phase: produce final answer from structured internal + optional external evidence.
 */
export function buildFinalReasoningPrompt(
    task: string,
    structuredKnowledge: Record<string, any> | null,
    externalFindings: AgentExternalFinding[]
): { system: string; user: string } {
    const externalText = externalFindings.length === 0
        ? 'No external findings.'
        : externalFindings
            .map((finding, idx) => `[External ${idx + 1}] type=${finding.type} input=${finding.queryOrUrl}\n${finding.content.slice(0, 1800)}`)
            .join('\n\n---\n\n');

    return {
        system: `You are the reasoning layer final synthesizer.

You must reason over internal structured knowledge first, then use external findings only as supplement.
Resolve contradictions conservatively and prefer well-supported claims.

Respond ONLY as valid JSON:
{
  "finalAnswer": "final markdown answer with clear bullets/sections and evidence-aware wording"
}

Rules:
- Do not fabricate unavailable details.
- Explicitly note uncertainty when evidence is sparse.
- Keep answer practical and directly focused on user task.`,
        user: `Task: ${task}

Structured internal knowledge:
${JSON.stringify(structuredKnowledge || {}, null, 2)}

External findings:
${externalText}`,
    };
}

/**
 * Replanning prompt: update queries/strategy based on current evidence.
 */
export function buildReplanPrompt(
    task: string,
    steps: AgentStep[],
    structuredKnowledge: Record<string, any> | null,
    needsExternalKnowledge: boolean,
    internalQueries: string[],
    externalQueries: string[]
): { system: string; user: string } {
    const stepsText = formatStepHistory(steps);
    return {
        system: `You are a replanning function for the reasoning layer.

Rules:
- Keep the exploration playbook: internal first for user/doc tasks, external for gaps.
- Decide what is still unknown and essential.
- Update internal/external queries only if you need more evidence.
- If enough evidence exists, recommend finishing.

Respond ONLY as JSON:
{
  "shouldFinish": true | false,
  "updatedInternalQueries": ["query1", "query2"],
  "updatedExternalQueries": ["query1", "query2"],
  "needsExternalKnowledge": true | false,
  "decision": "one short sentence"
}`,
        user: `Task: ${task}

Steps taken:
${stepsText}

Structured knowledge:
${JSON.stringify(structuredKnowledge || {}, null, 2)}

Current internal queries:
${internalQueries.join(', ') || 'none'}

Current external queries:
${externalQueries.join(', ') || 'none'}

Needs external knowledge: ${needsExternalKnowledge}`,
    };
}

/**
 * Drive query planner: decide if Drive retrieval is needed and how to do it.
 */
export function buildDriveQueryPrompt(task: string): { system: string; user: string } {
    return {
        system: `You are a Drive query planner. Your job is to decide whether the user is asking for Drive-specific actions and produce a structured plan.

Respond ONLY as valid JSON:
{
  "intent": "none" | "list" | "fetch" | "compare",
  "listQuery": "string or empty",
  "selectIndex": 0,
  "fileIds": ["id1", "id2"],
  "summary": true | false,
  "decision": "one short sentence"
}

Guidelines:
- intent=list when user asks to list files by name or keyword.
- intent=fetch when user requests a specific file by ID or name reference.
- intent=compare when user requests comparison between two Drive files (prefer IDs).
- selectIndex is 1-based when user says "#3" or "third".
- summary=true when user asks to summarize, compare, or explain.
- If the request is NOT about Drive files, use intent="none" and empty fields.`,
        user: `User query: ${task}`,
    };
}
