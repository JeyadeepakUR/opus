import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Send,
    Sparkles,
    Settings2,
    Clock,
    ChevronRight,
    Globe,
    FileText,
    Search,
    Brain,
    Zap,
    Trash2,
    Trash,
} from 'lucide-react';
import { api, type RunSummary } from '../api/client';

const AVAILABLE_TOOLS = [
    { key: 'web_search', label: 'Web Search', icon: Globe },
    { key: 'web_scrape', label: 'Web Scrape', icon: FileText },
    { key: 'drive_retrieval', label: 'Google Drive', icon: FileText },
    { key: 'vector_search', label: 'Vector Search', icon: Search },
    { key: 'reasoning', label: 'Reasoning', icon: Brain },
];

export default function AgentPage() {
    const navigate = useNavigate();
    const [task, setTask] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [maxSteps, setMaxSteps] = useState(10);
    const [temperature, setTemperature] = useState(0.3);
    const [enabledTools, setEnabledTools] = useState<string[]>(
        AVAILABLE_TOOLS.map((t) => t.key)
    );
    const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
    const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
    const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

    useEffect(() => {
        api.listRuns().then(setRecentRuns).catch(() => { });
    }, []);

    const handleSubmit = async () => {
        if (!task.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const { runId } = await api.startRun(task.trim(), {
                maxSteps,
                temperature,
                enabledTools,
            });
            navigate(`/run/${runId}`);
        } catch (err) {
            console.error('Failed to start run:', err);
            setIsSubmitting(false);
        }
    };

    const toggleTool = (key: string) => {
        setEnabledTools((prev) =>
            prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
        );
    };

    const handleDeleteRun = async (runId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (deletingRunId === runId) {
            try {
                await api.deleteRun(runId);
                setRecentRuns((prev) => prev.filter((r) => r.id !== runId));
                setDeletingRunId(null);
            } catch (err) {
                console.error('Failed to delete run:', err);
            }
        } else {
            setDeletingRunId(runId);
        }
    };

    const handleDeleteAll = async () => {
        try {
            await api.deleteAllRuns();
            setRecentRuns([]);
            setShowDeleteAllConfirm(false);
        } catch (err) {
            console.error('Failed to delete all runs:', err);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'var(--color-success)';
            case 'running': return 'var(--color-accent-light)';
            case 'failed': return 'var(--color-error)';
            default: return 'var(--color-warning)';
        }
    };

    return (
        <div className="h-full flex">
            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center justify-center px-6">
                {/* Hero */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-8 max-w-2xl"
                >
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <Zap className="w-5 h-5 text-accent-light" />
                        <span
                            className="text-xs font-medium px-2.5 py-1 rounded-full bg-[rgba(124,58,237,0.15)] text-accent-light"
                        >
                            Autonomous Agent
                        </span>
                    </div>
                    <h1 className="text-4xl font-bold mb-3 bg-gradient-to-br from-accent to-accent-light bg-clip-text text-transparent">
                        What do you want the agent to do?
                    </h1>
                    <p className="text-lg text-text-secondary">
                        Describe your task in natural language. The agent will plan, execute, and deliver results with citations.
                    </p>
                </motion.div>

                {/* Input */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="w-full max-w-2xl"
                >
                    <div
                        className="rounded-2xl p-[1px] input-glow shadow-2xl relative overflow-hidden group bg-gradient-to-br from-[rgba(139,92,246,0.3)] to-[rgba(59,130,246,0.15)] shadow-[0_0_50px_-10px_rgba(139,92,246,0.15)]"
                    >
                        <div className="rounded-[15px] p-1 h-full bg-bg-primary">
                            <textarea
                                value={task}
                                onChange={(e) => setTask(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                                placeholder="Describe a task..."
                                rows={3}
                                className="w-full bg-transparent outline-none resize-none text-lg p-5 placeholder-opacity-40 font-medium text-text-primary"
                            />

                            {/* Toolbar */}
                            <div className="flex items-center justify-between px-3 pb-3 mt-2">
                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/5"
                                    style={{ color: showSettings ? 'var(--color-accent-light)' : 'var(--color-text-muted)' }}
                                >
                                    <Settings2 className="w-4 h-4" />
                                    <span>Configuration</span>
                                </button>

                                <button
                                    onClick={handleSubmit}
                                    disabled={!task.trim() || isSubmitting}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
                                    style={{ boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)' }}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Sparkles className="w-4 h-4 animate-spin-slow" />
                                            <span>Thinking...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            <span>Run Agent</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Advanced Settings */}
                    <AnimatePresence>
                        {showSettings && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.3 }}
                                className="overflow-hidden"
                            >
                                <div
                                    className="mt-3 rounded-xl p-5 space-y-5 bg-bg-surface border border-border"
                                >
                                    {/* Max Steps */}
                                    <div>
                                        <label className="text-sm font-medium flex items-center justify-between mb-2">
                                            <span>Max Steps</span>
                                            <span
                                                className="text-xs px-2 py-0.5 rounded"
                                                style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-accent-light)' }}
                                            >
                                                {maxSteps}
                                            </span>
                                        </label>
                                        <input
                                            type="range"
                                            min={1}
                                            max={20}
                                            value={maxSteps}
                                            onChange={(e) => setMaxSteps(Number(e.target.value))}
                                            className="w-full accent-[#7c3aed]"
                                        />
                                    </div>

                                    {/* Temperature */}
                                    <div>
                                        <label className="text-sm font-medium flex items-center justify-between mb-2">
                                            <span>Temperature</span>
                                            <span
                                                className="text-xs px-2 py-0.5 rounded"
                                                style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-accent-light)' }}
                                            >
                                                {temperature.toFixed(1)}
                                            </span>
                                        </label>
                                        <input
                                            type="range"
                                            min={0}
                                            max={10}
                                            step={1}
                                            value={temperature * 10}
                                            onChange={(e) => setTemperature(Number(e.target.value) / 10)}
                                            className="w-full accent-[#7c3aed]"
                                        />
                                    </div>

                                    {/* Enabled Tools */}
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">Enabled Tools</label>
                                        <div className="flex flex-wrap gap-2">
                                            {AVAILABLE_TOOLS.map(({ key, label, icon: Icon }) => (
                                                <button
                                                    key={key}
                                                    onClick={() => toggleTool(key)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                                                    style={{
                                                        background: enabledTools.includes(key)
                                                            ? 'rgba(124, 58, 237, 0.15)'
                                                            : 'var(--color-bg-elevated)',
                                                        color: enabledTools.includes(key)
                                                            ? 'var(--color-accent-light)'
                                                            : 'var(--color-text-muted)',
                                                        border: enabledTools.includes(key)
                                                            ? '1px solid rgba(124, 58, 237, 0.3)'
                                                            : '1px solid transparent',
                                                    }}
                                                >
                                                    <Icon className="w-3.5 h-3.5" />
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>

            {/* Recent Runs Sidebar */}
            {recentRuns.length > 0 && (
                <div
                    className="w-[280px] border-l p-4 overflow-auto hidden lg:block bg-bg-secondary border-border flex flex-col"
                >
                    <div className="flex items-center justify-between mb-3">
                        <h3
                            className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2 text-text-muted"
                        >
                            <Clock className="w-3.5 h-3.5" />
                            Recent Tasks
                        </h3>
                        <button
                            onClick={() => setShowDeleteAllConfirm(true)}
                            className="p-1 rounded hover:bg-red-500/10 transition-colors"
                            title="Delete all runs"
                        >
                            <Trash className="w-3.5 h-3.5 text-red-500" />
                        </button>
                    </div>

                    {showDeleteAllConfirm && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/50"
                        >
                            <p className="text-xs text-red-400 mb-2">Delete all {recentRuns.length} runs?</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleDeleteAll}
                                    className="flex-1 px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                >
                                    Delete
                                </button>
                                <button
                                    onClick={() => setShowDeleteAllConfirm(false)}
                                    className="flex-1 px-2 py-1 text-xs bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 rounded transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </motion.div>
                    )}

                    <div className="space-y-2 flex-1">
                        {recentRuns.slice(0, 10).map((run, i) => (
                            <motion.button
                                key={run.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                onClick={() => navigate(`/run/${run.id}`)}
                                className="w-full text-left p-3 rounded-lg transition-all duration-200 group relative"
                                style={{ background: 'var(--color-bg-surface)' }}
                                onMouseEnter={(e) =>
                                    ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-hover)')
                                }
                                onMouseLeave={(e) => {
                                    ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface)');
                                    if (deletingRunId === run.id) setDeletingRunId(null);
                                }}
                            >
                                <div className="flex items-start justify-between">
                                    <p
                                        className="text-sm leading-snug line-clamp-2 flex-1"
                                        style={{ color: 'var(--color-text-primary)' }}
                                    >
                                        {run.task}
                                    </p>
                                    {deletingRunId === run.id ? (
                                        <Trash2 className="w-4 h-4 flex-shrink-0 mt-0.5 ml-2 text-red-500" />
                                    ) : (
                                        <ChevronRight
                                            className="w-4 h-4 flex-shrink-0 mt-0.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                            style={{ color: 'var(--color-text-muted)' }}
                                        />
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-1.5">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="w-1.5 h-1.5 rounded-full"
                                            style={{ background: getStatusColor(run.status) }}
                                        />
                                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                            {run.stepsCount} steps · {new Date(run.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                    {deletingRunId === run.id && (
                                        <button
                                            onClick={(e) => handleDeleteRun(run.id, e)}
                                            className="text-xs px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
                                        >
                                            Confirm
                                        </button>
                                    )}
                                </div>
                            </motion.button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
