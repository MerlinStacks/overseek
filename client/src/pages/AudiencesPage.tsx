import { Filter, Info, List, UsersRound } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { EmailListsPage } from './EmailListsPage';
import { SegmentsPage } from './SegmentsPage';

type AudienceTab = 'segments' | 'lists';

function isAudienceTab(value: string | null): value is AudienceTab {
    return value === 'segments' || value === 'lists';
}

export function AudiencesPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const requestedTab = searchParams.get('tab');
    const legacyDefault: AudienceTab = location.pathname === '/emails/lists' ? 'lists' : 'segments';
    const activeTab = isAudienceTab(requestedTab) ? requestedTab : legacyDefault;

    function setActiveTab(tab: AudienceTab) {
        navigate(`/emails/audiences?tab=${tab}`, { replace: location.pathname === '/emails/audiences' });
    }

    return (
        <div className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="relative overflow-hidden border-b border-slate-200 bg-slate-950 px-5 py-6 text-white sm:px-7">
                    <div className="absolute -right-12 -top-20 size-56 rounded-full bg-indigo-500/20 blur-3xl" />
                    <div className="relative max-w-3xl">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-indigo-100">
                            <UsersRound size={14} /> Audience workspace
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Audiences</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                            Build reusable groups for broadcasts and automations. Use segments when membership should update automatically, or lists when you need direct control.
                        </p>
                    </div>
                </div>

                <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4" role="tablist" aria-label="Audience type">
                    <button
                        role="tab"
                        aria-selected={activeTab === 'segments'}
                        onClick={() => setActiveTab('segments')}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${activeTab === 'segments'
                            ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                        <span className={`rounded-lg p-2 ${activeTab === 'segments' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                            <Filter size={18} />
                        </span>
                        <span>
                            <span className="block text-sm font-semibold text-slate-900">Dynamic segments</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-500">Rule-based groups that stay current as customer data changes.</span>
                        </span>
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === 'lists'}
                        onClick={() => setActiveTab('lists')}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${activeTab === 'lists'
                            ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                        <span className={`rounded-lg p-2 ${activeTab === 'lists' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                            <List size={18} />
                        </span>
                        <span>
                            <span className="block text-sm font-semibold text-slate-900">Static lists</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-500">Hand-picked email groups with direct subscription controls.</span>
                        </span>
                    </button>
                </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">
                <Info size={16} className="mt-0.5 shrink-0" />
                <p>{activeTab === 'segments'
                    ? 'Segment membership is calculated from customer data whenever the audience is used.'
                    : 'List membership is explicit. Account-wide email suppressions still apply when a campaign is sent.'}</p>
            </div>

            <div role="tabpanel">
                {activeTab === 'segments' ? <SegmentsPage embedded /> : <EmailListsPage embedded />}
            </div>
        </div>
    );
}
