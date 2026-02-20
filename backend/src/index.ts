/**
 * Express server entry point.
 * Loads environment, configures middleware, and mounts all route modules.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import agentRoutes from './routes/agent.js';
import authRoutes from './routes/auth.js';
import ingestionRoutes from './routes/ingestion.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
}));
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            llm: !!process.env.LLM_API_KEY,
            serper: !!process.env.SERPER_API_KEY,
            googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        },
    });
});

// Routes
app.use('/api/agent', agentRoutes);
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/knowledge', ingestionRoutes);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Opus API running at http://localhost:${PORT}`);
    console.log(`   Frontend URL: ${FRONTEND_URL}`);
    console.log(`   LLM configured: ${!!process.env.LLM_API_KEY}`);
    console.log(`   Serper configured: ${!!process.env.SERPER_API_KEY}`);
    console.log(`   Google OAuth configured: ${!!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}`);
    
    if (process.env.LLM_API_KEY) {
        const model = process.env.LLM_MODEL || 'gpt-4o-mini';
        const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
        console.log(`   LLM Model: ${model}`);
        console.log(`   LLM Base URL: ${baseUrl}`);
        
        if (!process.env.LLM_MODEL) {
            console.warn(`   ⚠️  LLM_MODEL not set, using default: gpt-4o-mini`);
        }
    } else {
        console.error(`   ❌ LLM_API_KEY not configured! Agent will not work.`);
    }
    
    console.log();
});

export default app;
