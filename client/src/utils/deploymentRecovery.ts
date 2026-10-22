/** Deployment failures do not authorize cache deletion, automatic reload or loss of a draft. */
let installed: (() => void) | null = null;
let lastOffered = -Infinity;
let prompt: HTMLElement | null = null;
export function isChunkLoadError(error: Error | string): boolean {
    const message = typeof error === 'string' ? error : error?.message;
    return typeof message === 'string' && message.length <= 10000 && /(?:Loading (?:CSS )?chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module)/i.test(message) && /(?:chunk|\/assets\/)/i.test(message);
}
export function handleChunkLoadError(error?: Error | string): boolean {
    if (!error || !isChunkLoadError(error) || navigator.onLine === false || prompt || Date.now() - lastOffered < 30000) return false;
    lastOffered = Date.now();
    const panel = document.createElement('section'); panel.setAttribute('role', 'alert'); panel.setAttribute('aria-label', 'Application resource unavailable');
    panel.style.cssText = 'position:fixed;bottom:1rem;left:1rem;right:1rem;z-index:99999;padding:1rem;background:#0f172a;color:#fff;border-radius:.5rem';
    const text = document.createElement('p'); text.textContent = 'An application resource could not load. This may be a network or deployment issue. Save/reconcile drafts and in-flight work before deliberately reloading. No caches were deleted.';
    const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload after reviewing my work';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Keep working';
    const remove = () => { panel.remove(); if (prompt === panel) prompt = null; };
    reload.onclick = () => { if (window.confirm('Reload now? Unsaved drafts may be lost and pending server operations are not rolled back.')) { remove(); window.location.reload(); } };
    dismiss.onclick = remove; panel.append(text, reload, dismiss); document.body.appendChild(panel); prompt = panel;
    return true;
}
/** Idempotent installation with cleanup; original error reporting is never suppressed. */
export function installDeploymentRecovery(): () => void {
    if (installed) return installed;
    const onError = (event: ErrorEvent) => { handleChunkLoadError(event.error instanceof Error ? event.error : event.message); };
    const onRejection = (event: PromiseRejectionEvent) => { if (event.reason instanceof Error || typeof event.reason === 'string') handleChunkLoadError(event.reason); };
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    installed = () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); prompt?.remove(); prompt = null; installed = null; };
    return installed;
}
