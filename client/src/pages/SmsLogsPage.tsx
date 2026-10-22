import { Navigate, useLocation } from 'react-router-dom';

export function SmsLogsPage() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    params.set('channel', 'sms');
    return <Navigate to={`/emails/logs?${params}`} replace />;
}
