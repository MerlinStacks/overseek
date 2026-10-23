import { MessageTimeline } from '../components/marketing/MessageTimeline';
import { useSearchParams } from 'react-router-dom';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';

const channels = ['email', 'both', 'sms'] as const;

export function EmailLogsPage() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const emailEnabled = useAccountFeature('EMAIL');
    const requestedChannel = searchParams.get('channel');
    const channel = !emailEnabled ? 'sms' : requestedChannel === 'email' || requestedChannel === 'sms' ? requestedChannel : 'both';

    const selectChannel = (value: typeof channels[number]) => {
        const params = new URLSearchParams(searchParams);
        params.set('channel', value);
        setSearchParams(params);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Message Logs</h1>
                    <p className="text-gray-500 dark:text-gray-400">Review email and SMS delivery outcomes in one place.</p>
                </div>
                <div role="group" aria-label="Message channel" className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-slate-700 dark:bg-slate-800">
                    {channels.map(value => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={channel === value}
                            disabled={!emailEnabled && value !== 'sms'}
                            onClick={() => selectChannel(value)}
                            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] disabled:cursor-not-allowed disabled:opacity-40 ${channel === value ? 'bg-[var(--primary-color)] text-[var(--primary-foreground)] shadow-xs' : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-slate-700'}`}
                        >
                            {value.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <MessageTimeline key={`${currentAccount?.id}:${token}`} channel={channel} />
        </div>
    );
}
