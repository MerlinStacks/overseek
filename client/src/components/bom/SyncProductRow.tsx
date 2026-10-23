import { useId } from 'react';
import { ChevronDown, ChevronRight, Package, RefreshCw, Loader2 } from 'lucide-react';
import type { PendingChange } from '../../hooks/useBOMSync';
import { getErrorDetails } from '../../hooks/useBOMSync';
import { getSafeNavigationUrl } from '../../utils/url';

interface SyncProductRowProps {
    item: PendingChange; isExpanded: boolean; isSyncingThis: boolean; isSyncingAll: boolean; errorMsg: string | null;
    onToggleExpand: () => void; onSync: () => void;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function SyncProductRow({ item, isExpanded, isSyncingThis, isSyncingAll, errorMsg, onToggleExpand, onSync }: SyncProductRowProps) {
    const id = useId(); const rawComponents = Array.isArray(item.components) ? item.components : [];
    const components = rawComponents.filter(component => component && typeof component === 'object');
    const knownCurrent = finite(item.currentWooStock) && Number.isInteger(item.currentWooStock);
    const knownTarget = finite(item.effectiveStock) && Number.isInteger(item.effectiveStock) && item.effectiveStock >= 0 && item.effectiveStock <= 2147483647;
    const complete = components.length > 0 && components.length === rawComponents.length && components.every(component => finite(component.requiredQty) && component.requiredQty > 0 && finite(component.childStock) && finite(component.buildableUnits) && component.buildableUnits >= 0);
    const difference = knownCurrent && knownTarget ? item.effectiveStock - item.currentWooStock! : null;
    const minimum = complete ? components.reduce((lowest, component) => Math.min(lowest, component.buildableUnits), Infinity) : null;
    const eligible = knownCurrent && knownTarget && complete && item.needsSync === true;
    const image = getSafeNavigationUrl(item.mainImage);
    const error = errorMsg ? getErrorDetails(errorMsg) : null;
    return <div className="border-b border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
        <div className="px-4 py-4 flex flex-wrap items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40">
            <button type="button" aria-label={`Show components for ${item.name}`} aria-expanded={isExpanded} aria-controls={id} disabled={!components.length} onClick={onToggleExpand} className="p-2 disabled:opacity-40">
                {isExpanded ? <ChevronDown aria-hidden="true" size={18} /> : <ChevronRight aria-hidden="true" size={18} />}
            </button>
            {image ? <img src={image} alt="" className="w-12 h-12 object-cover rounded-lg" /> : <Package aria-hidden="true" className="w-10 h-10 text-slate-400" />}
            <div className="min-w-0 flex-1"><p className="font-medium break-words">{item.name}{item.variationId > 0 ? ` (variant ${item.variationId})` : ''}</p><p className="text-xs text-slate-500">{item.sku}</p>
                <p className="text-xs text-slate-500">{components.length} components · {complete ? 'Component capacities available' : 'Component availability incomplete'}</p>
            </div>
            <dl className="flex flex-wrap gap-4 text-sm"><div><dt>WooCommerce</dt><dd>{knownCurrent ? item.currentWooStock : 'Unavailable'}</dd></div><div><dt>Effective</dt><dd>{knownTarget ? item.effectiveStock : 'Unavailable'}</dd></div><div><dt>Difference</dt><dd>{difference == null ? 'Unavailable' : `${difference > 0 ? '+' : ''}${difference}`}</dd></div></dl>
            <p className="text-xs">{errorMsg ? 'Error' : !knownCurrent || !knownTarget || !complete ? 'Preview incomplete' : item.needsSync ? 'Needs sync' : 'In sync'}</p>
            <button type="button" disabled={!eligible || isSyncingThis || isSyncingAll} aria-label={`${errorMsg ? 'Retry sync' : 'Sync'} ${item.name}${item.variationId ? ` variant ${item.variationId}` : ''}`}
                onClick={() => { if (eligible && !isSyncingThis && !isSyncingAll) onSync(); }} className="inline-flex items-center gap-2 px-3 py-2 text-[var(--brand-text)] rounded-lg disabled:opacity-40">
                {isSyncingThis ? <Loader2 aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" size={16} />}{errorMsg ? 'Retry' : 'Sync'}
            </button>
        </div>
        {error && <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200">{error.message} <span>{error.fix}</span></div>}
        {!eligible && (!knownCurrent || !knownTarget || !complete) && <p className="px-4 pb-3 text-sm text-amber-700 dark:text-amber-300">Refresh the authoritative preview before syncing. Unknown values are not zero.</p>}
        <div id={id} hidden={!isExpanded} className="p-4 bg-slate-50 dark:bg-slate-900">
            <h4 className="text-sm font-semibold mb-3">Component Breakdown</h4>
            {components.map((component, index) => {
                const bottleneck = minimum != null && component.buildableUnits === minimum;
                const identity = component.childProductId || component.childWooId || index;
                return <div key={`${component.componentType}:${identity}:${index}`} className="flex flex-wrap justify-between gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg mb-2">
                    <div><p>{typeof component.childName === 'string' ? component.childName : 'Unknown component'}</p><p className="text-xs text-slate-500">{finite(component.requiredQty) ? component.requiredQty : 'Unavailable'} required per unit · {typeof component.componentType === 'string' ? component.componentType : 'Unknown type'}</p></div>
                    <p>Stock: {finite(component.childStock) ? component.childStock : 'Unavailable'}</p><p>Can build: {finite(component.buildableUnits) ? component.buildableUnits : 'Unavailable'}</p>
                    {bottleneck && <span className="text-amber-700 dark:text-amber-300">Bottleneck</span>}
                </div>;
            })}
        </div>
    </div>;
}
