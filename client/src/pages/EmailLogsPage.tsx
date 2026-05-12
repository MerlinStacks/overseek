import { EmailLogPanel } from '../components/settings/EmailLogPanel';

export function EmailLogsPage() {
    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Email Logs</h1>
                <p className="text-gray-500">Review sent email outcomes and diagnose delivery issues.</p>
            </div>

            <EmailLogPanel />
        </div>
    );
}
