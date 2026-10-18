import { Filter, List, Globe } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { EmailListsPage } from './EmailListsPage';
import { SegmentsPage } from './SegmentsPage';
import { AdAudiencesPage } from './AdAudiencesPage';
import { useAccount } from '../context/AccountContext';

type AudienceTab = 'segments' | 'lists' | 'advertising';

function isAudienceTab(value: string | null): value is AudienceTab {
    return value === 'segments' || value === 'lists' || value === 'advertising';
}

export function AudiencesPage() {
    const { currentAccount } = useAccount();
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
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Audiences</h1>
                <p className="text-gray-500">Build customer groups for broadcasts, automations and advertising.</p>
            </div>

            <div className="flex overflow-x-auto border-b border-gray-200" role="tablist" aria-label="Audience type">
                <button
                    role="tab"
                    aria-selected={activeTab === 'segments'}
                    onClick={() => setActiveTab('segments')}
                    className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'segments'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                >
                    <Filter size={18} />
                    Segments
                </button>
                <button
                    role="tab"
                    aria-selected={activeTab === 'lists'}
                    onClick={() => setActiveTab('lists')}
                    className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'lists'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                >
                    <List size={18} />
                    Lists
                </button>
                <button role="tab" aria-selected={activeTab === 'advertising'} onClick={() => setActiveTab('advertising')}
                    className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'advertising' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}>
                    <Globe size={18} />Advertising
                </button>
            </div>

            <div role="tabpanel">
                {activeTab === 'segments' ? <SegmentsPage embedded /> : activeTab === 'lists' ? <EmailListsPage embedded /> : <AdAudiencesPage key={currentAccount?.id} />}
            </div>
        </div>
    );
}
