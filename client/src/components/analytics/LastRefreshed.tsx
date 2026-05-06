import { RefreshCw, Clock } from 'lucide-react';
import { useDataRefresh } from '../../hooks/useDataRefresh';

interface LastRefreshedProps {
    fetchFn: () => Promise<void>;
    deps?: React.DependencyList;
}

function formatSecondsAgo(seconds: number): string {
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
}

export const LastRefreshed: React.FC<LastRefreshedProps> = ({ fetchFn, deps = [] }) => {
    const { lastRefreshed, secondsAgo, refresh } = useDataRefresh(fetchFn, deps);

    const handleRefresh = async () => {
        await refresh();
    };

    return (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
            <Clock className="w-3.5 h-3.5" />
            <span>
                {lastRefreshed ? `Last refreshed: ${formatSecondsAgo(secondsAgo)}` : 'Not yet loaded'}
            </span>
            <button
                onClick={handleRefresh}
                className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                title="Refresh data"
            >
                <RefreshCw className="w-3.5 h-3.5" />
            </button>
        </div>
    );
};

export default LastRefreshed;
