import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Link2,
    Unlink,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Loader2,
    HardDrive,
    Clock,
    FileText,
    Zap,
    ChevronDown,
    ChevronUp,
    Trash2,
} from 'lucide-react';
import { api, type AuthStatus, type IngestionStatus, type DriveFile } from '../api/client';

const TEXT_MAX_BYTES_SELECTIVE = 5 * 1024 * 1024;
const PDF_MAX_BYTES_SELECTIVE = 2 * 1024 * 1024;

const isMediaType = (mimeType: string) =>
    mimeType.startsWith('video/') || mimeType.startsWith('audio/') || mimeType.startsWith('image/');

const isNotebookFile = (mimeType: string, name: string) =>
    mimeType === 'application/json' && name.toLowerCase().endsWith('.ipynb');

const getFileCategory = (file: DriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.document') return 'docs';
    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') return 'sheets';
    if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'slides';
    if (file.mimeType === 'application/pdf') return 'pdfs';
    if (isNotebookFile(file.mimeType, file.name)) return 'notebooks';
    if (isMediaType(file.mimeType)) return 'media';
    if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json') return 'text';
    return 'other';
};

const formatBytes = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const getIngestionHint = (file: DriveFile) => {
    if (isMediaType(file.mimeType)) return 'metadata only';
    if (file.mimeType === 'application/pdf' && file.size > PDF_MAX_BYTES_SELECTIVE) return 'metadata only';
    if ((file.mimeType.startsWith('text/') || file.mimeType === 'application/json') && file.size > TEXT_MAX_BYTES_SELECTIVE) {
        return 'metadata only';
    }
    return null;
};

export default function SettingsPage() {
    const [searchParams] = useSearchParams();
    const [authStatus, setAuthStatus] = useState<AuthStatus>({ isConnected: false, email: null });
    const [ingestionStatus, setIngestionStatus] = useState<IngestionStatus>({
        isRunning: false,
        lastRunAt: null,
        totalFilesIndexed: 0,
        files: [],
    });
    const [loading, setLoading] = useState(true);
    const [ingesting, setIngesting] = useState(false);
    const [authMessage, setAuthMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [showFileSelector, setShowFileSelector] = useState(false);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'docs' | 'sheets' | 'slides' | 'pdfs' | 'notebooks' | 'media' | 'text' | 'other'>('all');
    const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');

    useEffect(() => {
        // Check for auth callback result
        const authResult = searchParams.get('auth');
        if (authResult === 'success') {
            setAuthMessage({ type: 'success', text: 'Google Drive connected successfully!' });
        } else if (authResult === 'error') {
            setAuthMessage({ type: 'error', text: searchParams.get('message') || 'Authentication failed.' });
        }
        loadStatus();
    }, [searchParams]);

    const loadStatus = async () => {
        try {
            const [auth, ingestion] = await Promise.all([
                api.getAuthStatus(),
                api.getIngestionStatus(),
            ]);
            setAuthStatus(auth);
            setIngestionStatus(ingestion);
        } catch (err) {
            console.error('Failed to load status:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleConnect = () => {
        window.location.href = api.getGoogleAuthUrl();
    };

    const handleDisconnect = async () => {
        await api.disconnectGoogle();
        setAuthStatus({ isConnected: false, email: null });
    };

    const handleIngest = async () => {
        setIngesting(true);
        try {
            await api.triggerIngestion();
            // Poll for completion
            const poll = setInterval(async () => {
                const status = await api.getIngestionStatus();
                setIngestionStatus(status);
                if (!status.isRunning) {
                    clearInterval(poll);
                    setIngesting(false);
                }
            }, 2000);
        } catch (err) {
            console.error('Ingestion failed:', err);
            setIngesting(false);
        }
    };

    const loadDriveFiles = async () => {
        setLoadingFiles(true);
        try {
            const res = await api.listDriveFiles();
            setDriveFiles(res.files);
            setShowFileSelector(true);
        } catch (err) {
            console.error('Failed to load Drive files:', err);
        } finally {
            setLoadingFiles(false);
        }
    };

    const handleSelectiveIngest = async () => {
        if (selectedFiles.size === 0) {
            return;
        }
        setIngesting(true);
        try {
            await api.triggerSelectiveIngestion(Array.from(selectedFiles));
            // Poll for completion
            const poll = setInterval(async () => {
                const status = await api.getIngestionStatus();
                setIngestionStatus(status);
                if (!status.isRunning) {
                    clearInterval(poll);
                    setIngesting(false);
                    setShowFileSelector(false);
                    setSelectedFiles(new Set());
                }
            }, 2000);
        } catch (err) {
            console.error('Selective ingestion failed:', err);
            setIngesting(false);
        }
    };

    const toggleFileSelection = (fileId: string) => {
        const newSelection = new Set(selectedFiles);
        if (newSelection.has(fileId)) {
            newSelection.delete(fileId);
        } else {
            newSelection.add(fileId);
        }
        setSelectedFiles(newSelection);
    };

    const toggleSelectAll = () => {
        if (selectedFiles.size === driveFiles.length) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(driveFiles.map(f => f.id)));
        }
    };

    const filteredFiles = driveFiles
        .filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .filter((file) => typeFilter === 'all' || getFileCategory(file) === typeFilter)
        .sort((a, b) => {
            if (sortBy === 'size') return b.size - a.size;
            if (sortBy === 'modified') {
                const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
                const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
                return bTime - aTime;
            }
            return a.name.localeCompare(b.name);
        });

    const visibleFileIds = filteredFiles.map((file) => file.id);
    const allVisibleSelected = visibleFileIds.length > 0 && visibleFileIds.every((id) => selectedFiles.has(id));

    const toggleSelectVisible = () => {
        const next = new Set(selectedFiles);
        if (allVisibleSelected) {
            visibleFileIds.forEach((id) => next.delete(id));
        } else {
            visibleFileIds.forEach((id) => next.add(id));
        }
        setSelectedFiles(next);
    };

    const handleClearVectorStore = async () => {
        if (!confirm('Are you sure you want to clear all indexed data? This cannot be undone.')) {
            return;
        }
        try {
            await api.clearVectorStore();
            await loadStatus(); // Refresh status
        } catch (err) {
            console.error('Failed to clear vector store:', err);
        }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-3xl mx-auto">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <h1 className="text-2xl font-bold mb-1 bg-gradient-to-br from-accent to-accent-light bg-clip-text text-transparent">Settings</h1>
                <p className="text-sm mb-8 text-text-secondary">
                    Manage integrations and data sources
                </p>

                {/* Auth Message */}
                {authMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 p-4 rounded-xl mb-6"
                        style={{
                            background: authMessage.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            border: `1px solid ${authMessage.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                            color: authMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                        }}
                    >
                        {authMessage.type === 'success' ? (
                            <CheckCircle2 className="w-5 h-5" />
                        ) : (
                            <AlertCircle className="w-5 h-5" />
                        )}
                        <span className="text-sm">{authMessage.text}</span>
                    </motion.div>
                )}

                {/* Google Drive Card */}
                <div
                    className="rounded-xl p-6 mb-6 bg-bg-surface border border-border"
                >
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-10 h-10 rounded-lg flex items-center justify-center"
                                style={{ background: 'rgba(66, 133, 244, 0.15)' }}
                            >
                                <HardDrive className="w-5 h-5" style={{ color: '#4285f4' }} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-base">Google Drive</h3>
                                <p className="text-xs mt-0.5 text-text-muted">
                                    Connect to access and index your Drive files
                                </p>
                            </div>
                        </div>
                        <span
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                            style={{
                                background: authStatus.isConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                                color: authStatus.isConnected ? 'var(--color-success)' : 'var(--color-text-muted)',
                            }}
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{
                                    background: authStatus.isConnected ? 'var(--color-success)' : 'var(--color-text-muted)',
                                }}
                            />
                            {authStatus.isConnected ? 'Connected' : 'Not Connected'}
                        </span>
                    </div>

                    {authStatus.isConnected && authStatus.email && (
                        <p className="text-sm mb-4 text-text-secondary">
                            Signed in as <span className="font-medium text-text-primary">{authStatus.email}</span>
                        </p>
                    )}

                    <div className="flex items-center gap-3">
                        {!authStatus.isConnected ? (
                            <button
                                onClick={handleConnect}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                                style={{
                                    background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-light))',
                                    color: 'white',
                                }}
                            >
                                <Link2 className="w-4 h-4" />
                                Connect Google Drive
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={handleConnect}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                                    style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Re-authorize
                                </button>
                                <button
                                    onClick={handleDisconnect}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)' }}
                                >
                                    <Unlink className="w-4 h-4" />
                                    Disconnect
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Ingestion Card */}
                <div
                    className="rounded-xl p-6 bg-bg-surface border border-border"
                >
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-10 h-10 rounded-lg flex items-center justify-center"
                                style={{ background: 'rgba(124, 58, 237, 0.15)' }}
                            >
                                <Zap className="w-5 h-5" style={{ color: 'var(--color-accent-light)' }} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-base">Data Ingestion</h3>
                                <p className="text-xs mt-0.5 text-text-muted">
                                    Index Drive files for semantic search
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-5">
                        <div className="p-3 rounded-lg bg-bg-primary">
                            <div className="flex items-center gap-2 mb-1">
                                <FileText className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} />
                                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Files Indexed</span>
                            </div>
                            <p className="text-lg font-semibold">{ingestionStatus.totalFilesIndexed}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-bg-primary">
                            <div className="flex items-center gap-2 mb-1">
                                <Clock className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} />
                                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Last Run</span>
                            </div>
                            <p className="text-sm font-medium">
                                {ingestionStatus.lastRunAt
                                    ? new Date(ingestionStatus.lastRunAt).toLocaleDateString()
                                    : 'Never'}
                            </p>
                        </div>
                        <div className="p-3 rounded-lg bg-bg-primary">
                            <div className="flex items-center gap-2 mb-1">
                                <Zap className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} />
                                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Status</span>
                            </div>
                            <p className="text-sm font-medium" style={{ color: ingesting ? 'var(--color-accent-light)' : 'var(--color-success)' }}>
                                {ingesting ? 'Running...' : 'Idle'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={handleIngest}
                            disabled={!authStatus.isConnected || ingesting}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                            style={{
                                background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-light))',
                                color: 'white',
                            }}
                        >
                            {ingesting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Ingesting...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-4 h-4" />
                                    Ingest All
                                </>
                            )}
                        </button>

                        <button
                            onClick={showFileSelector ? () => setShowFileSelector(false) : loadDriveFiles}
                            disabled={!authStatus.isConnected || ingesting || loadingFiles}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                            style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)' }}
                        >
                            {loadingFiles ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                <>
                                    {showFileSelector ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    {showFileSelector ? 'Hide Files' : 'Select Files (All Formats)'}
                                </>
                            )}
                        </button>

                        <button
                            onClick={handleClearVectorStore}
                            disabled={ingestionStatus.totalFilesIndexed === 0 || ingesting}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                            style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)' }}
                        >
                            <Trash2 className="w-4 h-4" />
                            Clear All Data
                        </button>
                    </div>

                    {showFileSelector && driveFiles.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mt-4 p-4 rounded-lg"
                            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                <p className="text-sm font-medium">
                                    {selectedFiles.size} selected · {filteredFiles.length} shown · {driveFiles.length} total
                                </p>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={toggleSelectVisible}
                                        className="text-xs px-2 py-1 rounded"
                                        style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-accent)' }}
                                    >
                                        {allVisibleSelected ? 'Deselect Visible' : 'Select Visible'}
                                    </button>
                                    <button
                                        onClick={toggleSelectAll}
                                        className="text-xs px-2 py-1 rounded"
                                        style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-muted)' }}
                                    >
                                        {selectedFiles.size === driveFiles.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search files..."
                                    className="flex-1 min-w-[180px] px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border"
                                />
                                <select
                                    value={typeFilter}
                                    onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                                    className="px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border"
                                >
                                    <option value="all">All Types</option>
                                    <option value="docs">Docs</option>
                                    <option value="sheets">Sheets</option>
                                    <option value="slides">Slides</option>
                                    <option value="pdfs">PDFs</option>
                                    <option value="notebooks">Notebooks</option>
                                    <option value="media">Media</option>
                                    <option value="text">Text/Code</option>
                                    <option value="other">Other</option>
                                </select>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                                    className="px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border"
                                >
                                    <option value="name">Sort: Name</option>
                                    <option value="size">Sort: Size</option>
                                    <option value="modified">Sort: Modified</option>
                                </select>
                            </div>

                            <div className="max-h-72 overflow-y-auto mb-3 space-y-1">
                                {filteredFiles.length === 0 && (
                                    <div className="text-sm text-text-muted py-3">No files match your filters.</div>
                                )}
                                {filteredFiles.map((file) => {
                                    const category = getFileCategory(file);
                                    const hint = getIngestionHint(file);
                                    return (
                                        <label
                                            key={file.id}
                                            className="flex items-center gap-3 p-2 rounded hover:bg-bg-surface cursor-pointer transition-colors"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedFiles.has(file.id)}
                                                onChange={() => toggleFileSelection(file.id)}
                                                className="w-4 h-4 rounded accent-accent"
                                            />
                                            <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                                            <span className="text-sm flex-1 truncate">{file.name}</span>
                                            <span
                                                className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                                                style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-muted)' }}
                                            >
                                                {category}
                                            </span>
                                            {hint && (
                                                <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--color-warning)' }}>
                                                    {hint}
                                                </span>
                                            )}
                                            <span className="text-xs text-text-muted w-20 text-right">
                                                {formatBytes(file.size)}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>

                            <button
                                onClick={handleSelectiveIngest}
                                disabled={selectedFiles.size === 0 || ingesting}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                                style={{
                                    background: selectedFiles.size > 0
                                        ? 'linear-gradient(135deg, var(--color-accent), var(--color-accent-light))'
                                        : 'var(--color-bg-elevated)',
                                    color: selectedFiles.size > 0 ? 'white' : 'var(--color-text-muted)',
                                }}
                            >
                                {ingesting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Ingesting {selectedFiles.size} files...
                                    </>
                                ) : (
                                    <>
                                        <Zap className="w-4 h-4" />
                                        Ingest {selectedFiles.size} Selected {selectedFiles.size === 1 ? 'File' : 'Files'}
                                    </>
                                )}
                            </button>
                        </motion.div>
                    )}

                    {!authStatus.isConnected && (
                        <p className="text-xs mt-3 text-text-muted">
                            Connect Google Drive first to enable ingestion.
                        </p>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
