import { lazy, Suspense, useMemo, useState } from 'react';
import { compileEmailDesignV2, isEmailDesignV2, EMAIL_RENDERER_VERSION } from '../../lib/emailDesignerV2';
import { importEmailHtml } from '../../lib/importEmailHtml';
import type { EmailDeliveryPreviewOptions } from '@overseek/core';

const EmailDesignEditorV2 = lazy(() => import('./EmailDesignEditorV2').then((module) => ({ default: module.EmailDesignEditorV2 })));

interface Props {
    deliveryOptions?: EmailDeliveryPreviewOptions;
    storageScope?: string;
    initialHtml?: string;
    emailCategory?: 'MARKETING' | 'TRANSACTIONAL';
    onTestSent?: (html: string, design: unknown, meta: { subject: string; previewText: string }) => void;
    initialDesign?: unknown;
    initialSubject?: string;
    initialPreviewText?: string;
    previewOrderMode?: 'latest' | 'none';
    onSave: (html: string, design: unknown, meta?: { subject: string; previewText: string; autosave?: boolean }) => void | Promise<void>;
    onCancel: () => void;
}

export function MarketingEmailDesigner(props: Props) {
    const legacy = isEmailDesignV2(props.initialDesign) && props.initialDesign.rendererVersion !== EMAIL_RENDERER_VERSION;
    const [choice, setChoice] = useState<'html' | 'upgrade' | null>(null);
    const [upgrading, setUpgrading] = useState(false); const [upgradeError, setUpgradeError] = useState('');
    const initialDesign = useMemo(() => {
        if (legacy && !choice) return undefined;
        if (legacy && choice === 'html') return importEmailHtml(props.initialHtml || '', { title: props.initialSubject, previewText: props.initialPreviewText });
        if (legacy && choice === 'upgrade' && isEmailDesignV2(props.initialDesign)) return { ...props.initialDesign, rendererVersion: EMAIL_RENDERER_VERSION };
        const matchingDesign = isEmailDesignV2(props.initialDesign)
            ? compileEmailDesignV2(props.initialDesign).trim() === props.initialHtml?.trim()
            : false;
        if (props.initialHtml?.trim() && !matchingDesign) {
            return importEmailHtml(props.initialHtml, { title: props.initialSubject, previewText: props.initialPreviewText });
        }
        return props.initialDesign;
    }, [props.initialDesign, props.initialHtml, props.initialSubject, props.initialPreviewText, legacy, choice]);

    if (legacy && !choice) return <div role="dialog" aria-modal="true" aria-label="Email renderer upgrade" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="max-w-lg space-y-4 rounded-xl bg-white p-6 text-slate-900 shadow-sm"><h2 className="text-lg font-semibold">Review this older email layout</h2><p className="text-sm">Its saved HTML and visual document use an older or unversioned renderer. Keep the saved HTML, or explicitly upgrade the editable layout. Upgrading may change its appearance; review Delivery preview before publishing.</p>{upgradeError && <p role="alert" className="text-sm text-red-700">{upgradeError}</p>}<div className="flex flex-wrap gap-2"><button disabled={upgrading} onClick={() => setChoice('html')} className="rounded-lg border px-3 py-2 text-sm">Keep saved HTML</button><button disabled={upgrading} onClick={async () => { if (!isEmailDesignV2(props.initialDesign)) return; setUpgrading(true); try { const upgraded = { ...props.initialDesign, rendererVersion: EMAIL_RENDERER_VERSION }; await props.onSave(compileEmailDesignV2(upgraded), upgraded, { subject: props.initialSubject || upgraded.document.meta.title, previewText: props.initialPreviewText || upgraded.document.meta.previewText || '', autosave: true }); setChoice('upgrade'); } catch { setUpgradeError('Upgrade could not be saved. Your original email was not replaced.'); } finally { setUpgrading(false); } }} className="rounded-lg bg-[var(--primary-color)] px-3 py-2 text-sm text-[var(--primary-foreground)]">{upgrading ? 'Saving upgrade…' : 'Upgrade visual layout'}</button><button disabled={upgrading} onClick={props.onCancel} className="rounded-lg border px-3 py-2 text-sm">Cancel</button></div></div></div>;

    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-500">Loading email editor...</div>}>
            <EmailDesignEditorV2 {...props} initialDesign={initialDesign} />
        </Suspense>
    );
}
