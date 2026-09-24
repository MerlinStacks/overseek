import { Monitor, Package, RotateCcw, Smartphone } from 'lucide-react';
import type { SettingsFieldsProps } from './types';

const colourFields = [
    { key: 'textColor', label: 'Text colour', fallback: '#334155' },
    { key: 'accentColor', label: 'Accent colour', fallback: '#4f46e5' },
    { key: 'backgroundColor', label: 'Background colour', fallback: '#ffffff' },
] as const;

/** A presentation-only sample avoids implying that a date calculator is live. */
export function BrandingSettings({ settings, onChange }: SettingsFieldsProps) {
    const branding = settings.branding;
    const update = (patch: Partial<typeof branding>) => onChange({ ...settings, branding: { ...branding, ...patch } });
    return <section className="flex flex-col gap-6">
        <details className="order-2 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <summary className="cursor-pointer font-medium">Customise appearance (optional)</summary>
        <div className="mt-4 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h3 className="text-lg font-semibold">Compact storefront branding</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Style the delivery details on your storefront. Select a swatch to choose a colour.</p>
            </div>
            <button type="button" className="inline-flex items-center gap-2 border-slate-200 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => update({ textColor: null, accentColor: null, backgroundColor: null, fontSize: 14, spacing: 'compact', showIcon: false })}>
                <RotateCcw size={14} aria-hidden="true" />Reset to theme defaults
            </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
            {colourFields.map(({ key, label, fallback }) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
                <label className="flex cursor-pointer items-center gap-3">
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-300 shadow-sm ring-offset-2 focus-within:ring-2 focus-within:ring-indigo-500 dark:border-slate-600 dark:ring-offset-slate-900"
                        style={{ background: branding[key] ?? 'conic-gradient(#e2e8f0 25%, #ffffff 0 50%, #e2e8f0 0 75%, #ffffff 0)' }}>
                        <input type="color" aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                            value={branding[key] ?? fallback} onChange={e => update({ [key]: e.target.value })} />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-slate-900 dark:text-slate-100">{label}</span>
                        <span className="mt-0.5 block font-mono text-xs text-slate-500 dark:text-slate-400">{branding[key]?.toUpperCase() ?? 'Theme default'}</span>
                    </span>
                </label>
                <label className="mt-4 flex items-center gap-2 text-slate-600 dark:text-slate-400"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={branding[key] === null}
                    onChange={e => update({ [key]: e.target.checked ? null : fallback })} />Inherit theme</label>
            </div>)}
        </div>
        <div className="grid items-center gap-4 sm:grid-cols-3">
            <label className="space-y-2">Text size (px)<input type="number" required min={12} max={20} step={1} value={Number.isNaN(branding.fontSize) ? '' : branding.fontSize}
                onChange={e => update({ fontSize: e.target.valueAsNumber })} /></label>
            <label className="space-y-2">Spacing<select value={branding.spacing} onChange={e => update({ spacing: e.target.value as typeof branding.spacing })}>
                <option value="compact">Compact</option><option value="comfortable">Comfortable</option>
            </select></label>
            <label className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={branding.showIcon} onChange={e => update({ showIcon: e.target.checked })} />
                <Package size={18} className="text-slate-400" aria-hidden="true" />Show delivery icon
            </label>
        </div>
        </div>
        </details>
        <div className="order-1 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div>
                <p className="text-sm font-semibold">Style preview</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sample wording and dates, not calculated estimates. Inherited colours use your storefront theme.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">{[false, true].map(mobile => <div key={String(mobile)} className="min-w-0">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {mobile ? <Smartphone size={14} aria-hidden="true" /> : <Monitor size={14} aria-hidden="true" />}{mobile ? 'Narrow' : 'Wide'} sample
                </p>
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="break-words rounded" style={{ color: branding.textColor ?? undefined, backgroundColor: branding.backgroundColor ?? undefined,
                    fontSize: Number.isFinite(branding.fontSize) ? branding.fontSize : 14, padding: branding.spacing === 'compact' ? 4 : 8 }}>
                    {branding.showIcon && <Package aria-hidden="true" size={16} className="inline mr-1" style={{ color: branding.accentColor ?? undefined }} />}
                    Estimated delivery: <span style={{ color: branding.accentColor ?? undefined }}>12–16 October</span>
                    <div>Ready for collection: 12 October</div>
                </div>
                </div>
            </div>)}</div>
        </div>
    </section>;
}
