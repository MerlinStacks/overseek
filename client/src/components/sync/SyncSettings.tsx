import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';
import { SyncStatus } from './SyncStatus';

const BOMSyncPage = lazy(() => import('../../pages/BOMSyncPage').then(module => ({ default: module.BOMSyncPage })));

/** Load the stock preview only when requested, not with the sync overview. */
export function SyncSettings() {
    const [params, setParams] = useSearchParams();
    const { currentAccount } = useAccount();
    const view = params.get('view') === 'bom' ? 'bom' : 'overview';

    return (
        <div className="space-y-6">
            <nav aria-label="Sync views" className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                {(['overview', 'bom'] as const).map(value => (
                    <button
                        key={value}
                        aria-current={view === value ? 'page' : undefined}
                        onClick={() => setParams(previous => {
                            const next = new URLSearchParams(previous);
                            next.set('tab', 'sync');
                            if (value === 'bom') next.set('view', value);
                            else next.delete('view');
                            return next;
                        })}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${view === value
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                    >
                        {value === 'bom' ? 'BOM Inventory' : 'Overview & schedules'}
                    </button>
                ))}
            </nav>
            {view === 'bom' ? (
                <Suspense fallback={<p role="status" className="py-8 text-slate-500">Loading BOM inventory…</p>}>
                    <BOMSyncPage key={currentAccount?.id} />
                </Suspense>
            ) : <SyncStatus />}
        </div>
    );
}
