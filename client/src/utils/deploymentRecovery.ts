/**
 * Deployment Cache Recovery
 * 
 * Handles stale chunk errors that occur when the app is redeployed
 * and users have cached pages that reference old chunk hashes.
 * 
 */

import { Logger } from './logger';
import * as Sentry from '@sentry/react';

/** Cooldown tracking to prevent infinite reload loops */
const RELOAD_TIMESTAMP_KEY = 'deployment-reload-timestamp';
const RELOAD_COOLDOWN_MS = 30000; // 30 seconds between reload attempts
const TELEMETRY_KEY_PREFIX = 'deployment-recovery-telemetry';

function trackRecoveryTelemetry(event: string, meta: Record<string, unknown> = {}): void {
    const now = Date.now();
    const sessionKey = `${TELEMETRY_KEY_PREFIX}:${event}`;
    let sessionCount = 1;

    try {
        const raw = sessionStorage.getItem(sessionKey);
        const previous = raw ? parseInt(raw, 10) : 0;
        sessionCount = Number.isFinite(previous) ? previous + 1 : 1;
        sessionStorage.setItem(sessionKey, String(sessionCount));
    } catch (error) {
        Logger.warn('[DeploymentRecovery] Failed to persist telemetry counter', { error, event });
    }

    const payload = {
        ...meta,
        event,
        sessionCount,
        pathname: window.location.pathname,
        isOnline: navigator.onLine,
        timestamp: now,
    };

    Logger.warn('[DeploymentRecovery] Telemetry event', payload);
    Sentry.captureMessage(`[DeploymentRecovery] ${event}`, {
        level: 'warning',
        tags: {
            area: 'deployment-recovery',
            event,
        },
        extra: payload,
    });
}

/**
 * Shows a toast notification before reloading.
 * Uses a simple inline toast since React may not be available.
 */
function showReloadToast(): void {
    // Create toast container if it doesn't exist
    const existingToast = document.getElementById('deployment-reload-toast');
    if (existingToast) return; // Already showing

    const toast = document.createElement('div');
    toast.id = 'deployment-reload-toast';
    const content = document.createElement('div');
    content.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:16px 24px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;box-shadow:0 10px 40px rgba(99,102,241,0.4);z-index:99999;display:flex;align-items:center;gap:12px;animation:slideUp 0.3s ease-out;";
    const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spinner.setAttribute('width', '20');
    spinner.setAttribute('height', '20');
    spinner.setAttribute('viewBox', '0 0 24 24');
    spinner.setAttribute('fill', 'none');
    spinner.setAttribute('stroke', 'currentColor');
    spinner.setAttribute('stroke-width', '2');
    spinner.style.animation = 'spin 1s linear infinite';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 12a9 9 0 1 1-6.219-8.56');
    spinner.appendChild(path);
    content.appendChild(spinner);
    content.appendChild(document.createTextNode('New version available, refreshing...'));

    const style = document.createElement('style');
    style.textContent = '@keyframes slideUp{from{transform:translateX(-50%) translateY(20px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    toast.append(content, style);
    document.body.appendChild(toast);
}

/**
 * Clears all caches and reloads the page.
 * Used when stale chunks are detected.
 */
async function clearCachesAndReload(): Promise<void> {
    // Clear service worker caches
    if ('caches' in window) {
        try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        } catch (e) {
            Logger.warn('[DeploymentRecovery] Cache clear failed', { error: e });
        }
    }

    // Force SW update if available
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.update();
        } catch (e) {
            Logger.warn('[DeploymentRecovery] SW update failed', { error: e });
        }
    }

    // Reload without cache
    window.location.reload();
}

/**
 * Checks if a reload is allowed (cooldown not active).
 */
function canAttemptReload(): boolean {
    const lastAttempt = sessionStorage.getItem(RELOAD_TIMESTAMP_KEY);
    if (!lastAttempt) return true;

    const parsed = parseInt(lastAttempt, 10);
    if (!Number.isFinite(parsed)) {
        sessionStorage.removeItem(RELOAD_TIMESTAMP_KEY);
        return true;
    }

    const elapsed = Date.now() - parsed;
    return elapsed > RELOAD_COOLDOWN_MS;
}

/**
 * Marks that a reload was attempted.
 */
function markReloadAttempted(): void {
    sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, Date.now().toString());
}

/**
 * Determines if an error is a chunk load error.
 */
export function isChunkLoadError(error: Error | string): boolean {
    const message = typeof error === 'string' ? error : error?.message || '';
    const lowerMessage = message.toLowerCase();

    // Require deployment/chunk context to avoid false positives from generic module errors.
    // `Failed to fetch dynamically imported module` can happen from transient network
    // drops, so for that case we also require an explicit built-asset path hint.
    const hasAssetPathHint =
        lowerMessage.includes('/assets/') ||
        lowerMessage.includes('assets/');

    const hasChunkContext =
        lowerMessage.includes('chunk') ||
        hasAssetPathHint;

    if (!hasChunkContext) return false;

    const dynamicImportFetchFailure =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('error loading dynamically imported module');

    if (dynamicImportFetchFailure && !hasAssetPathHint) {
        trackRecoveryTelemetry('suppressed-non-chunk-dynamic-import-error', {
            reason: 'missing-asset-path-hint',
            message,
        });
        return false;
    }

    return (
        dynamicImportFetchFailure ||
        message.includes('Loading chunk') ||
        message.includes('ChunkLoadError') ||
        message.includes('Loading CSS chunk')
    );
}

/**
 * Handles a chunk load error by showing a toast and reloading.
 * Returns true if handling was performed, false if skipped.
 */
export function handleChunkLoadError(error?: Error | string): boolean {
    if (!error) return false;
    const errorToCheck = error;

    // Only handle chunk errors
    if (!isChunkLoadError(errorToCheck)) {
        return false;
    }

    // Don't hard-reload while offline; users can recover naturally once online.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        Logger.warn('[DeploymentRecovery] Skipping reload while offline');
        trackRecoveryTelemetry('suppressed-offline-reload', {
            reason: 'browser-offline',
            error: typeof errorToCheck === 'string' ? errorToCheck : (errorToCheck as Error)?.message,
        });
        return false;
    }

    // Check cooldown
    if (!canAttemptReload()) {
        Logger.warn('[DeploymentRecovery] Reload attempted too recently, skipping');
        return false;
    }

    Logger.info('[DeploymentRecovery] Chunk load error detected, reloading...');
    markReloadAttempted();
    showReloadToast();

    // Small delay to show toast, then reload
    setTimeout(() => {
        clearCachesAndReload();
    }, 800);

    return true;
}

/**
 * Installs global error handlers for chunk load errors.
 * Should be called early in app initialization.
 */
export function installDeploymentRecovery(): void {
    // Handle uncaught errors (sync chunk loads)
    window.addEventListener('error', (event) => {
        if (isChunkLoadError(event.message || '')) {
            event.preventDefault();
            handleChunkLoadError(event.error || event.message);
        }
    });

    // Handle unhandled promise rejections (async chunk loads)
    window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason;
        const message = error?.message || String(error);

        if (isChunkLoadError(message)) {
            event.preventDefault();
            handleChunkLoadError(error || message);
        }
    });

    // Why: Vite HMR events only fire in dev — but guard explicitly to avoid
    // the reload handler running from any unrelated WebSocket disconnect.
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        window.addEventListener('vite:ws-disconnect', () => {
            Logger.info('[DeploymentRecovery] Vite WebSocket disconnected');
            if (canAttemptReload()) {
                showReloadToast();
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        });
    }

    Logger.info('[DeploymentRecovery] Installed');
}
