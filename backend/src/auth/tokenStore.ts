/**
 * OAuth token storage — in-memory store for Google OAuth tokens.
 * For production, this should be replaced with a database-backed store.
 */

import type { OAuthTokens } from '../types/index.js';

class TokenStore {
    private tokens: OAuthTokens | null = null;
    private userEmail: string | null = null;

    /** Store OAuth tokens */
    setTokens(tokens: OAuthTokens, email?: string): void {
        this.tokens = tokens;
        if (email) this.userEmail = email;
    }

    /** Get stored tokens */
    getTokens(): OAuthTokens | null {
        return this.tokens;
    }

    /** Get connected user email */
    getEmail(): string | null {
        return this.userEmail;
    }

    /** Check if authenticated */
    isAuthenticated(): boolean {
        return this.tokens !== null;
    }

    /** Clear tokens (disconnect) */
    clear(): void {
        this.tokens = null;
        this.userEmail = null;
    }
}

/** Singleton token store instance */
export const tokenStore = new TokenStore();
