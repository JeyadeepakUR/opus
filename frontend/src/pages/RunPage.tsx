import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
    ArrowLeft,
    CheckCircle2,
    AlertCircle,
    Clock,
    Loader2,
    Globe,
    FileText,
    Search,
    Brain,
    Zap,
    ExternalLink,
    Download,
    Copy,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';
import { api, type AgentRun, type AgentStep, type Citation } from '../api/client';

const TOOL_ICONS: Record<string, typeof Globe> = {
    web_search: Globe,
    web_scrape: FileText,
    drive_retrieval: FileText,
    vector_search: Search,
    reasoning: Brain,
    error: AlertCircle,
};

const TOOL_COLORS: Record<string, string> = {
    web_search: '#3b82f6',
    web_scrape: '#22c55e',
    drive_retrieval: '#f59e0b',
    vector_search: '#a855f7',
    reasoning: '#6366f1',
    error: '#ef4444',
};

export default function RunPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [run, setRun] = useState<AgentRun | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
    const [copied, setCopied] = useState(false);
    const [followUpInput, setFollowUpInput] = useState('');
    const [followUpLoading, setFollowUpLoading] = useState(false);
    const [followUpError, setFollowUpError] = useState<string | null>(null);
    const [followUps, setFollowUps] = useState<Array<{ id: string; question: string; answer: string }>>([]);

    const fetchRun = useCallback(async () => {
        if (!id) return;
        try {
            const data = await api.getRun(id);
            setRun(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load run');
        }
    }, [id]);

    // Poll for updates while running
    useEffect(() => {
        fetchRun();
        const interval = setInterval(() => {
            if (run?.status === 'running') {
                fetchRun();
            }
        }, 1500);
        return () => clearInterval(interval);
    }, [fetchRun, run?.status]);

    const toggleStep = (stepNum: number) => {
        setExpandedSteps((prev) => {
            const next = new Set(prev);
            if (next.has(stepNum)) next.delete(stepNum);
            else next.add(stepNum);
            return next;
        });
    };

    const copyAnswer = () => {
        if (run?.finalAnswer) {
            navigator.clipboard.writeText(run.finalAnswer);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const submitFollowUp = async () => {
        if (!followUpInput.trim() || !run || followUpLoading) return;
        setFollowUpLoading(true);
        setFollowUpError(null);
        try {
            const response = await api.followUp(followUpInput.trim(), run.config, run.finalAnswer || undefined);
            setFollowUps((prev) => [
                {
                    id: `${Date.now()}`,
                    question: followUpInput.trim(),
                    answer: response.answer,
                },
                ...prev,
            ]);
            setFollowUpInput('');
        } catch (err) {
            setFollowUpError(err instanceof Error ? err.message : 'Follow-up failed');
        } finally {
            setFollowUpLoading(false);
        }
    };

    const exportJSON = () => {
        if (!run) return;
        const data = JSON.stringify(run, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent-run-${run.id.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportMarkdown = () => {
        if (!run) return;
        let md = `# Agent Run: ${run.task}\n\n`;
        md += `**Status:** ${run.status}\n`;
        md += `**Created:** ${new Date(run.createdAt).toLocaleString()}\n\n`;
        if (run.finalAnswer) {
            md += `## Answer\n\n${run.finalAnswer}\n\n`;
        }
        if (run.citations.length > 0) {
            md += `## Sources\n\n`;
            run.citations.forEach((c) => {
                md += `- [${c.label}](${c.reference})\n`;
            });
        }
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent-run-${run.id.slice(0, 8)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getCompletedPlanSteps = (currentRun: AgentRun): number => {
        if (!currentRun.plan) return 0;

        // Completed run should always mark entire plan as complete.
        if (currentRun.status === 'completed' || currentRun.finalAnswer) {
            return currentRun.plan.steps.length;
        }

        const phaseOrder: Array<NonNullable<AgentRun['phase']>> = [
            'understanding',
            'internal_knowledge',
            'structuring',
            'external_knowledge',
            'reasoning_answer',
        ];

        if (currentRun.phase) {
            const phaseIndex = phaseOrder.indexOf(currentRun.phase);
            if (phaseIndex >= 0) {
                // Running: phases before current are complete.
                // Non-running terminal states: include current phase as completed.
                const completed = currentRun.status === 'running' ? phaseIndex : phaseIndex + 1;
                return Math.min(Math.max(completed, 0), currentRun.plan.steps.length);
            }
        }

        // Fallback for older runs that don't have phase.
        return Math.min(currentRun.steps.length, currentRun.plan.steps.length);
    };

    if (error) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-error)' }} />
                    <p className="text-lg font-medium mb-2">Error Loading Run</p>
                    <p style={{ color: 'var(--color-text-secondary)' }}>{error}</p>
                    <button
                        onClick={() => navigate('/')}
                        className="mt-4 px-4 py-2 rounded-lg text-sm font-medium"
                        style={{ background: 'var(--color-bg-surface)', color: 'var(--color-accent-light)' }}
                    >
                        Back to Home
                    </button>
                </div>
            </div>
        );
    }

    if (!run) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
        );
    }

    const isRunning = run.status === 'running';
    const isComplete = run.status === 'completed' || run.status === 'max_steps_reached';

    return (
        <div className="h-full flex flex-col">
            {/* Top Bar */}
            <div
                className="flex items-center justify-between px-6 py-3 border-b shrink-0"
                style={{
                    background: 'rgba(10, 11, 22, 0.8)',
                    borderColor: 'var(--color-border)',
                    backdropFilter: 'blur(12px)',
                }}
            >
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/')}
                        className="p-1.5 rounded-lg transition-all"
                        style={{ color: 'var(--color-text-secondary)' }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface)')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h2 className="text-sm font-semibold line-clamp-1" style={{ color: 'var(--color-text-primary)' }}>
                            {run.task}
                        </h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <StatusBadge status={run.status} />
                            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                {run.steps.length} step{run.steps.length !== 1 ? 's' : ''}
                                {run.completedAt && ` · ${formatDuration(run.createdAt, run.completedAt)}`}
                            </span>
                        </div>
                    </div>
                </div>

                {isComplete && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={copyAnswer}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}
                        >
                            <Copy className="w-3.5 h-3.5" />
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                            onClick={exportMarkdown}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}
                        >
                            <Download className="w-3.5 h-3.5" />
                            Markdown
                        </button>
                        <button
                            onClick={exportJSON}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}
                        >
                            <Download className="w-3.5 h-3.5" />
                            JSON
                        </button>
                    </div>
                )}
            </div>

            {/* 3-Column Layout */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: Plan & Status */}
                <div
                    className="w-[280px] border-r p-5 overflow-auto shrink-0 hidden md:block"
                    style={{ borderColor: 'var(--color-border)', background: 'rgba(10, 11, 22, 0.3)' }}
                >
                    {/* Plan */}
                    {run.plan && (
                        <div className="mb-6">
                            <h3
                                className="text-xs font-semibold uppercase tracking-wider mb-3"
                                style={{ color: 'var(--color-text-muted)' }}
                            >
                                Plan
                            </h3>
                            <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                                {run.plan.overview}
                            </p>
                            <div className="space-y-2">
                                {(() => {
                                    const completedPlanSteps = getCompletedPlanSteps(run);
                                    return run.plan.steps.map((step, i) => (
                                        <div
                                            key={i}
                                            className="flex items-start gap-2 text-xs"
                                            style={{ color: i < completedPlanSteps ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                                        >
                                            <span className="flex-shrink-0 mt-0.5">
                                                {i < completedPlanSteps ? (
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                ) : (
                                                    <div
                                                        className="w-3.5 h-3.5 rounded-full border"
                                                        style={{ borderColor: 'var(--color-border)' }}
                                                    />
                                                )}
                                            </span>
                                            <span>{step}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>
                    )}

                    {/* Config */}
                    <div>
                        <h3
                            className="text-xs font-semibold uppercase tracking-wider mb-3"
                            style={{ color: 'var(--color-text-muted)' }}
                        >
                            Configuration
                        </h3>
                        <div className="space-y-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            <div className="flex justify-between">
                                <span>Max Steps</span>
                                <span>{run.config.maxSteps}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Temperature</span>
                                <span>{run.config.temperature}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Tools</span>
                                <span>{run.config.enabledTools.length}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Center: Steps & Result */}
                <div className="flex-1 overflow-auto p-6">
                    {/* Steps */}
                    <div className="max-w-3xl mx-auto space-y-3">
                        <AnimatePresence>
                            {run.steps.map((step, i) => (
                                <StepCard
                                    key={step.stepNumber}
                                    step={step}
                                    index={i}
                                    isExpanded={expandedSteps.has(step.stepNumber)}
                                    onToggle={() => toggleStep(step.stepNumber)}
                                />
                            ))}
                        </AnimatePresence>

                        {/* Running indicator */}
                        {isRunning && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex items-center gap-3 p-4 rounded-xl"
                                style={{
                                    background: 'var(--color-bg-surface)',
                                    border: '1px solid var(--color-border)',
                                }}
                            >
                                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
                                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                                    Agent is thinking...
                                </span>
                            </motion.div>
                        )}

                        {/* Final Answer */}
                        {isComplete && run.finalAnswer && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4 }}
                                className="mt-6"
                            >
                                <div
                                    className="rounded-xl p-6"
                                    style={{
                                        background: 'var(--color-bg-surface)',
                                        border: '1px solid var(--color-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-4">
                                        <Zap className="w-5 h-5" style={{ color: 'var(--color-accent-light)' }} />
                                        <h3 className="text-lg font-semibold gradient-text">Final Answer</h3>
                                    </div>
                                    <div className="markdown-content">
                                        <ReactMarkdown>{run.finalAnswer}</ReactMarkdown>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Follow-up (stateless) */}
                        {isComplete && run.finalAnswer && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: 0.1 }}
                                className="mt-4"
                            >
                                <div
                                    className="rounded-xl p-5"
                                    style={{
                                        background: 'var(--color-bg-surface)',
                                        border: '1px solid var(--color-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <Search className="w-4 h-4" style={{ color: 'var(--color-accent-light)' }} />
                                        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                                            Follow-up (stateless)
                                        </h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={followUpInput}
                                            onChange={(e) => setFollowUpInput(e.target.value)}
                                            placeholder="Ask a follow-up..."
                                            className="flex-1 bg-transparent outline-none text-sm px-3 py-2 rounded-lg"
                                            style={{
                                                color: 'var(--color-text-primary)',
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-bg-secondary)',
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    submitFollowUp();
                                                }
                                            }}
                                        />
                                        <button
                                            onClick={submitFollowUp}
                                            disabled={!followUpInput.trim() || followUpLoading}
                                            className="px-3 py-2 rounded-lg text-xs font-semibold"
                                            style={{
                                                background: 'var(--color-accent)',
                                                color: 'white',
                                                opacity: !followUpInput.trim() || followUpLoading ? 0.5 : 1,
                                            }}
                                        >
                                            {followUpLoading ? 'Searching...' : 'Ask'}
                                        </button>
                                    </div>
                                    {followUpError && (
                                        <p className="text-xs mt-2" style={{ color: 'var(--color-error)' }}>
                                            {followUpError}
                                        </p>
                                    )}

                                    {followUps.length > 0 && (
                                        <div className="mt-4 space-y-3">
                                            {followUps.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="p-3 rounded-lg"
                                                    style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                                                >
                                                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                                                        Q: {item.question}
                                                    </p>
                                                    <div className="markdown-content">
                                                        <ReactMarkdown>{item.answer}</ReactMarkdown>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>

                {/* Right: Sources */}
                <div
                    className="w-[260px] border-l p-4 overflow-auto shrink-0 hidden lg:block"
                    style={{ borderColor: 'var(--color-border)' }}
                >
                    <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--color-text-muted)' }}
                    >
                        Sources ({run.citations.length})
                    </h3>
                    <div className="space-y-2">
                        {run.citations.length === 0 && !isRunning && (
                            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                No sources collected yet.
                            </p>
                        )}
                        {run.citations.map((citation, i) => (
                            <CitationCard key={citation.id} citation={citation} index={i} />
                        ))}
                        {/* Show step-level sources while running */}
                        {isRunning && run.citations.length === 0 && (
                            <div className="space-y-2">
                                {run.steps.flatMap((s) => s.sources).map((source, i) => (
                                    <div
                                        key={i}
                                        className="p-2.5 rounded-lg text-xs"
                                        style={{
                                            background: 'var(--color-bg-surface)',
                                            border: '1px solid var(--color-border)',
                                        }}
                                    >
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span
                                                className="px-1.5 py-0.5 rounded text-[10px] uppercase font-medium"
                                                style={{
                                                    background: source.type === 'web' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                                    color: source.type === 'web' ? '#3b82f6' : '#f59e0b',
                                                }}
                                            >
                                                {source.type}
                                            </span>
                                        </div>
                                        <p className="line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
                                            {source.label || source.reference}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Step card component */
function StepCard({
    step,
    index,
    isExpanded,
    onToggle,
}: {
    step: AgentStep;
    index: number;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const Icon = TOOL_ICONS[step.toolName] || Zap;
    const color = TOOL_COLORS[step.toolName] || 'var(--color-accent)';

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="rounded-xl overflow-hidden transition-all duration-300 group"
            style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 4px 20px -5px rgba(0,0,0,0.2)',
            }}
            onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = 'var(--color-accent-dim)';
                el.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = 'var(--color-border)';
                el.style.transform = 'translateY(0)';
            }}
        >
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 p-4 text-left transition-all"
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-hover)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
                <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}20` }}
                >
                    <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                            #{step.stepNumber}
                        </span>
                        <span className="text-sm font-medium" style={{ color }}>
                            {step.toolName.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {step.durationMs}ms
                        </span>
                    </div>
                    <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>
                        {step.reasoning}
                    </p>
                </div>
                {isExpanded ? (
                    <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                ) : (
                    <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                )}
            </button>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                            {/* Input */}
                            {Object.keys(step.toolInput).length > 0 && (
                                <div className="pt-3">
                                    <label className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                                        Input
                                    </label>
                                    <pre
                                        className="mt-1 text-xs p-2.5 rounded-lg overflow-x-auto"
                                        style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)' }}
                                    >
                                        {JSON.stringify(step.toolInput, null, 2)}
                                    </pre>
                                </div>
                            )}

                            {/* Output */}
                            <div>
                                <label className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                                    Output
                                </label>
                                <pre
                                    className="mt-1 text-xs p-2.5 rounded-lg overflow-x-auto max-h-48"
                                    style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)' }}
                                >
                                    {step.output.slice(0, 1000)}{step.output.length > 1000 ? '...' : ''}
                                </pre>
                            </div>

                            {/* Sources */}
                            {step.sources.length > 0 && (
                                <div>
                                    <label className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                                        Sources
                                    </label>
                                    <div className="mt-1 space-y-1">
                                        {step.sources.map((s, i) => (
                                            <div
                                                key={i}
                                                className="flex items-center gap-2 text-xs p-2 rounded"
                                                style={{ background: 'var(--color-bg-primary)' }}
                                            >
                                                <span
                                                    className="px-1.5 py-0.5 rounded text-[10px] uppercase font-medium"
                                                    style={{
                                                        background: s.type === 'web' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                                        color: s.type === 'web' ? '#3b82f6' : '#f59e0b',
                                                    }}
                                                >
                                                    {s.type}
                                                </span>
                                                <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                                    {s.label || s.reference}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

/** Citation card component */
function CitationCard({ citation, index }: { citation: Citation; index: number }) {
    const isUrl = citation.reference.startsWith('http');

    return (
        <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-2.5 rounded-lg transition-all"
            style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
            }}
        >
            <div className="flex items-center gap-1.5 mb-1">
                <span
                    className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                    style={{ background: 'rgba(124, 58, 237, 0.2)', color: 'var(--color-accent-light)' }}
                >
                    {citation.id}
                </span>
                <span
                    className="px-1.5 py-0.5 rounded text-[10px] uppercase font-medium"
                    style={{
                        background: citation.type === 'web' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        color: citation.type === 'web' ? '#3b82f6' : '#f59e0b',
                    }}
                >
                    {citation.type}
                </span>
            </div>
            {isUrl ? (
                <a
                    href={citation.reference}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs hover:underline"
                    style={{ color: 'var(--color-accent-light)' }}
                >
                    {citation.label}
                    <ExternalLink className="w-3 h-3" />
                </a>
            ) : (
                <p className="text-xs line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {citation.label}
                </p>
            )}
        </motion.div>
    );
}

/** Status badge component */
function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; color: string; label: string }> = {
        running: { bg: 'rgba(124, 58, 237, 0.15)', color: 'var(--color-accent-light)', label: 'Running' },
        completed: { bg: 'rgba(34, 197, 94, 0.15)', color: 'var(--color-success)', label: 'Completed' },
        failed: { bg: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-error)', label: 'Failed' },
        max_steps_reached: { bg: 'rgba(245, 158, 11, 0.15)', color: 'var(--color-warning)', label: 'Max Steps' },
    };
    const c = config[status] || config.running;

    return (
        <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider"
            style={{ background: c.bg, color: c.color }}
        >
            {status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
            {status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
            {status === 'failed' && <AlertCircle className="w-3 h-3" />}
            {c.label}
        </span>
    );
}

/** Format duration between two ISO strings */
function formatDuration(start: string, end: string): string {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}
