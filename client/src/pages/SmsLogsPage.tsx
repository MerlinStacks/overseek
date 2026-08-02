import { SmsLogPanel } from '../components/settings/SmsLogPanel';

export function SmsLogsPage() {
    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">SMS Logs</h1>
                <p className="text-gray-500">Review Twilio requests, delivery receipts, and send failures.</p>
            </div>
            <SmsLogPanel />
        </div>
    );
}
