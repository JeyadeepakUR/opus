/**
 * Auth routes — Google OAuth endpoints.
 */

import { Router } from 'express';
import { getAuthUrl, handleCallback, getAuthStatus, disconnect } from '../auth/google.js';

const router = Router();

/**
 * GET /auth/google — Redirect to Google OAuth consent screen.
 */
router.get('/google', (_req, res) => {
    try {
        const url = getAuthUrl();
        return res.redirect(url);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: `Failed to generate auth URL: ${msg}` });
    }
});

/**
 * GET /auth/google/callback — Handle OAuth callback.
 */
router.get('/google/callback', async (req, res) => {
    try {
        const code = req.query.code as string;
        if (!code) {
            return res.status(400).json({ error: 'No authorization code provided.' });
        }

        const { email } = await handleCallback(code);

        // Redirect to frontend settings page with success
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        return res.redirect(`${frontendUrl}/settings?auth=success&email=${encodeURIComponent(email || '')}`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        return res.redirect(`${frontendUrl}/settings?auth=error&message=${encodeURIComponent(msg)}`);
    }
});

/**
 * GET /api/auth/status — Get current authentication status.
 */
router.get('/status', (_req, res) => {
    return res.json(getAuthStatus());
});

/**
 * POST /api/auth/disconnect — Disconnect Google account.
 */
router.post('/disconnect', (_req, res) => {
    disconnect();
    return res.json({ success: true });
});

export default router;
