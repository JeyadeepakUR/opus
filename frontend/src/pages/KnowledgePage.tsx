import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Database,
    FileText,
    ChevronDown,
    ChevronRight,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Search,
} from 'lucide-react';
import { api, type KnowledgeSources, type IngestionFile, type FileChunks } from '../api/client';

export default function KnowledgePage() {
    const [sources, setSources] = useState<KnowledgeSources | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedFile, setExpandedFile] = useState<string | null>(null);
    const [chunks, setChunks] = useState<FileChunks | null>(null);
    const [loadingChunks, setLoadingChunks] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        api.getKnowledgeSources()
            .then(setSources)
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    const handleExpandFile = async (fileId: string) => {
        if (expandedFile === fileId) {
            setExpandedFile(null);
            setChunks(null);
            return;
        }
        setExpandedFile(fileId);
        setLoadingChunks(true);
        try {
            const data = await api.getFileChunks(fileId);
            setChunks(data);
        } catch (err) {
            console.error('Failed to load chunks:', err);
        } finally {
            setLoadingChunks(false);
        }
    };

    const filteredFiles = sources?.files.filter((f) =>
        f.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'indexed':
                return <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-success)' }} />;
            case 'error':
                return <AlertCircle className="w-4 h-4" style={{ color: 'var(--color-error)' }} />;
            default:
                return <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--color-accent)' }} />;
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '—';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getMimeLabel = (mime: string) => {
        if (mime.includes('document')) return 'Doc';
        if (mime.includes('pdf')) return 'PDF';
        if (mime.includes('spreadsheet')) return 'Sheet';
        if (mime.includes('plain')) return 'Text';
        if (mime.includes('csv')) return 'CSV';
        return 'File';
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold mb-1 gradient-text">Knowledge Sources</h1>
                        <p className="text-sm text-text-secondary">
                            View and manage ingested documents
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-text-muted">
                        <span>{sources?.totalFiles || 0} files</span>
                        <span>·</span>
                        <span>{sources?.totalChunks || 0} chunks</span>
                    </div>
                </div>

                {/* Search */}
                <div
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 bg-bg-surface border border-border"
                >
                    <Search className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent outline-none flex-1 text-sm"
                        style={{ color: 'var(--color-text-primary)' }}
                    />
                </div>

                {/* Empty State */}
                {filteredFiles.length === 0 && (
                    <div className="text-center py-16">
                        <Database className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
                        <p className="text-lg font-medium mb-2 text-text-secondary">
                            No documents indexed yet
                        </p>
                        <p className="text-sm text-text-muted">
                            Connect Google Drive and run ingestion from the Settings page.
                        </p>
                    </div>
                )}

                {/* File Table */}
                {filteredFiles.length > 0 && (
                    <div
                        className="rounded-xl overflow-hidden border border-border"
                    >
                        {/* Header */}
                        <div
                            className="grid grid-cols-[1fr_80px_80px_120px_80px_80px] px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
                            style={{
                                background: 'var(--color-bg-secondary)',
                                color: 'var(--color-text-muted)',
                            }}
                        >
                            <span>File Name</span>
                            <span>Type</span>
                            <span>Size</span>
                            <span>Modified</span>
                            <span>Chunks</span>
                            <span>Status</span>
                        </div>

                        {/* Rows */}
                        {filteredFiles.map((file, i) => (
                            <FileRow
                                key={file.driveFileId}
                                file={file}
                                index={i}
                                isExpanded={expandedFile === file.driveFileId}
                                onToggle={() => handleExpandFile(file.driveFileId)}
                                chunks={expandedFile === file.driveFileId ? chunks : null}
                                loadingChunks={loadingChunks && expandedFile === file.driveFileId}
                                getStatusIcon={getStatusIcon}
                                formatSize={formatSize}
                                getMimeLabel={getMimeLabel}
                            />
                        ))}
                    </div>
                )}
            </motion.div>
        </div>
    );
}

function FileRow({
    file,
    index,
    isExpanded,
    onToggle,
    chunks,
    loadingChunks,
    getStatusIcon,
    formatSize,
    getMimeLabel,
}: {
    file: IngestionFile;
    index: number;
    isExpanded: boolean;
    onToggle: () => void;
    chunks: FileChunks | null;
    loadingChunks: boolean;
    getStatusIcon: (status: string) => React.ReactNode;
    formatSize: (bytes: number) => string;
    getMimeLabel: (mime: string) => string;
}) {
    return (
        <div
            style={{ borderTop: index > 0 ? '1px solid var(--color-border)' : undefined }}
        >
            <button
                onClick={onToggle}
                className="w-full grid grid-cols-[1fr_80px_80px_120px_80px_80px] px-4 py-3 text-sm text-left items-center transition-all"
                style={{ background: isExpanded ? 'var(--color-bg-surface)' : 'transparent' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-surface-hover)')}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = isExpanded ? 'var(--color-bg-surface)' : 'transparent';
                }}
            >
                <span className="flex items-center gap-2 min-w-0">
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                    ) : (
                        <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                    )}
                    <FileText className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-accent-light)' }} />
                    <span className="truncate">{file.fileName}</span>
                </span>
                <span
                    className="text-xs px-2 py-0.5 rounded text-center"
                    style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
                >
                    {getMimeLabel(file.mimeType)}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">{formatSize(file.size)}</span>
                <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                    {new Date(file.lastModified).toLocaleDateString()}
                </span>
                <span className="text-center text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {file.chunkCount}
                </span>
                <span className="flex justify-center">{getStatusIcon(file.ingestionStatus)}</span>
            </button>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div
                            className="px-6 py-4 space-y-3"
                            style={{
                                background: 'var(--color-bg-surface)',
                                borderTop: '1px solid var(--color-border)',
                            }}
                        >
                            <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                                Sample Chunks
                            </h4>
                            {loadingChunks ? (
                                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
                            ) : chunks && chunks.chunks.length > 0 ? (
                                <div className="space-y-2">
                                    {chunks.chunks.slice(0, 3).map((chunk) => (
                                        <div
                                            key={chunk.id}
                                            className="p-3 rounded-lg text-xs"
                                            style={{
                                                background: 'var(--color-bg-primary)',
                                                color: 'var(--color-text-secondary)',
                                            }}
                                        >
                                            <span
                                                className="text-[10px] font-mono mb-1 block"
                                                style={{ color: 'var(--color-text-muted)' }}
                                            >
                                                Chunk #{chunk.chunkIndex}
                                            </span>
                                            {chunk.text}
                                        </div>
                                    ))}
                                    {chunks.total > 3 && (
                                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                            + {chunks.total - 3} more chunks
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                    No chunks available.
                                </p>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
