import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { OnboardingStepProps } from '../types';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { getPublicApiUrl } from '../../../utils/url';
import { PLUGIN_RELEASE } from '../../../utils/pluginRelease';
import { readBoundedBytes } from '../../../utils/boundedResponse';
const resultSchema = z.object({ accountId: z.string().optional(), success: z.boolean(), storeReachable: z.boolean(), pluginInstalled: z.boolean(), pluginVersion: z.string().max(100).optional(), configured: z.boolean().nullish(), accountMatch: z.boolean().nullish(), trackingEnabled: z.boolean().nullish(), chatEnabled: z.boolean().nullish() });
export function PluginStep(props: OnboardingStepProps) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !props.draft.store.connectionVerified || props.draft.store.accountId !== currentAccount.id) return <p role="alert">Verify this store account before configuring its plugin.</p>;
    return <ScopedPlugin key={JSON.stringify([user?.id, token, currentAccount.id])} {...props} token={token} accountId={currentAccount.id} editable={hasPermission('manage_channels')} />;
}
function ScopedPlugin({ token, accountId, editable, setDraft, onBack, onNext, onSkip, isSubmitting }: OnboardingStepProps & { token: string; accountId: string; editable: boolean }) {
    const origin = getPublicApiUrl(), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [archive, setArchive] = useState<string | null>(null);
    const lock = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null), objectUrl = useRef<string | null>(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }; }, []);
    const run = async (kind: 'config' | 'webhook' | 'download' | 'verify') => {
        if (lock.current || !origin || !editable) return;
        lock.current = true; setBusy(true); setMessage(''); controller.current = new AbortController(); const timeout = setTimeout(() => controller.current?.abort(), 20000);
        try {
            if (kind === 'config' || kind === 'webhook') {
                await navigator.clipboard.writeText(kind === 'config' ? JSON.stringify({ apiUrl: origin, accountId }, null, 2) : `${origin}/api/webhooks/${accountId}`);
                if (!alive.current) return;
                setMessage('Clipboard write acknowledged. This does not establish plugin configuration.');
                if (kind === 'config') setDraft(previous => ({ ...previous, plugin: { ...previous.plugin, configCopied: true } }));
            } else if (kind === 'download') {
                const response = await fetch(`${origin}/uploads/plugins/overseek-wc-plugin.zip`, { signal: controller.current.signal, credentials: 'omit' }); if (!response.ok) throw new Error('Archive unavailable');
                const bytes = await readBoundedBytes(response, PLUGIN_RELEASE.maxBytes); if (!bytes.byteLength) throw new Error('Archive size unavailable');
                const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (digest !== PLUGIN_RELEASE.sha256) throw new Error('Archive does not match the reviewed release'); if (!alive.current) return;
                if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); setArchive(objectUrl.current); setMessage(`Verified ${PLUGIN_RELEASE.version} archive prepared. Saving/installing is not yet confirmed.`);
            } else {
                setDraft(previous => ({ ...previous, plugin: { ...previous.plugin, verified: false } }));
                const response = await fetch('/api/tracking/verify-store', { signal: controller.current.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } }); if (!response.ok) throw new Error('Observation unavailable'); const result = resultSchema.parse(await response.json()); if (!alive.current) return;
                const verified = result.accountId === accountId && result.success && result.storeReachable && result.pluginInstalled && result.configured === true && result.accountMatch === true;
                setDraft(previous => ({ ...previous, plugin: { ...previous.plugin, verified, pluginVersion: result.pluginVersion } }));
                setMessage(`${result.pluginInstalled ? 'Plugin installation observed' : 'Installation not established'}. Configuration/account match: ${verified ? 'confirmed in this observation' : 'not established'}. Tracking: ${result.trackingEnabled == null ? 'unknown' : result.trackingEnabled ? 'enabled' : 'disabled'}. Chat: ${result.chatEnabled == null ? 'unknown' : result.chatEnabled ? 'enabled' : 'disabled'}.`);
            }
        } catch { if (alive.current) { if (kind === 'verify') setDraft(previous => ({ ...previous, plugin: { ...previous.plugin, verified: false } })); setMessage('Operation unavailable or not acknowledged. No copy/download/verification success was assumed.'); } }
        finally { clearTimeout(timeout); lock.current = false; if (alive.current) setBusy(false); }
    };
    const leave = (next: () => void) => { alive.current = false; controller.current?.abort(); next(); };
    return <div className="space-y-4 text-slate-900 dark:text-slate-100"><h2 className="text-xl font-semibold">Install and configure the plugin</h2><p>Reviewed release {PLUGIN_RELEASE.version}. Preparing an archive is not proof it was downloaded or installed.</p>{!origin && <p role="alert">Public HTTPS API origin unavailable. Check deployment configuration.</p>}{message && <p role="status">{message}</p>}<fieldset disabled={!editable || busy || !origin} className="space-y-3"><button type="button" onClick={() => void run('download')}>Prepare verified plugin ZIP</button><pre className="overflow-x-auto">{origin ? JSON.stringify({ apiUrl: origin, accountId }, null, 2) : 'Configuration unavailable'}</pre><button type="button" onClick={() => void run('config')}>Copy plugin configuration</button><button type="button" onClick={() => void run('webhook')}>Copy webhook URL</button><button type="button" onClick={() => void run('verify')}>Observe store plugin</button></fieldset>{archive && <a href={archive} download={`overseek-wc-plugin-${PLUGIN_RELEASE.version}.zip`}>Save verified archive</a>}<div className="flex flex-wrap gap-4"><button type="button" onClick={() => leave(onBack)}>Back</button><button type="button" onClick={() => leave(onSkip)}>Skip for now</button><button type="button" disabled={isSubmitting || busy} onClick={() => leave(onNext)}>Continue</button></div></div>;
}
