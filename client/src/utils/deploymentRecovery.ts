/**
 * Deployment Cache Recovery
 * 
 * Handles stale chunk errors that occur when the app is redeployed
 * and users have cached pages that reference old chunk hashes.
 * 
 * @module utils/deploymentRecovery
 */

/** Cooldown tracking to prevent infinite reload loops */
const RELOAD_TIMESTAMP_KEY = 'deployment-reload-timestamp';
const RELOAD_COOLDOWN_MS = 30000; // 30 seconds between reload attempts

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
    toast.innerHTML = `
        <div style="
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4);
            z-index: 99999;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideUp 0.3s ease-out;
        ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            New version available, refreshing...
        </div>
        <style>
            @keyframes slideUp {
                from { transform: translateX(-50%) translateY(20px); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        </style>
    `;
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
            console.warn('[DeploymentRecovery] Cache clear failed:', e);
        }
    }

    // Force SW update if available
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.update();
        } catch (e) {
            console.warn('[DeploymentRecovery] SW update failed:', e);
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

    const elapsed = Date.now() - parseInt(lastAttempt, 10);
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
    return (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Loading chunk') ||
        message.includes('ChunkLoadError') ||
        message.includes('Loading CSS chunk') ||
        message.includes("Couldn't resolve module") ||
        message.includes('error loading dynamically imported module')
    );
}

/**
 * Handles a chunk load error by showing a toast and reloading.
 * Returns true if handling was performed, false if skipped.
 */
export function handleChunkLoadError(error?: Error | string): boolean {
    const errorToCheck = error || '';

    // Only handle chunk errors
    if (error && !isChunkLoadError(errorToCheck)) {
        return false;
    }

    // Check cooldown
    if (!canAttemptReload()) {
        console.warn('[DeploymentRecovery] Reload attempted too recently, skipping');
        return false;
    }

    console.log('[DeploymentRecovery] Chunk load error detected, reloading...');
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
            handleChunkLoadError();
        }
    });

    // Handle unhandled promise rejections (async chunk loads)
    window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason;
        const message = error?.message || String(error);

        if (isChunkLoadError(message)) {
            event.preventDefault();
            handleChunkLoadError();
        }
    });

    // Handle Vite HMR disconnection (dev server restart)
    window.addEventListener('vite:ws-disconnect', () => {
        console.log('[DeploymentRecovery] Vite WebSocket disconnected');
        if (canAttemptReload()) {
            showReloadToast();
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        }
    });

    console.log('[DeploymentRecovery] Installed');
}
