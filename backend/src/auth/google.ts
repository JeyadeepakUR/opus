/**
 * Google OAuth2 module — handles the OAuth flow for Google Drive access.
 */

import { google } from 'googleapis';
import { tokenStore } from './tokenStore.js';

const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
];

/** Create an OAuth2 client instance */
function createOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

/**
 * Generate the Google OAuth consent URL.
 */
export function getAuthUrl(): string {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
}

/**
 * Exchange authorization code for tokens and store them.
 */
export async function handleCallback(code: string): Promise<{ email: string | null }> {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user email
    let email: string | null = null;
    try {
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const userInfo = await oauth2.userinfo.get();
        email = userInfo.data.email || null;
    } catch {
        // Email is optional
    }

    tokenStore.setTokens(
        {
            access_token: tokens.access_token!,
            refresh_token: tokens.refresh_token || undefined,
            expiry_date: tokens.expiry_date || undefined,
            token_type: tokens.token_type || undefined,
            scope: tokens.scope || undefined,
        },
        email || undefined
    );

    return { email };
}

/**
 * Get current authentication status.
 */
export function getAuthStatus(): {
    isConnected: boolean;
    email: string | null;
} {
    return {
        isConnected: tokenStore.isAuthenticated(),
        email: tokenStore.getEmail(),
    };
}

/**
 * Disconnect Google account.
 */
export function disconnect(): void {
    tokenStore.clear();
}
