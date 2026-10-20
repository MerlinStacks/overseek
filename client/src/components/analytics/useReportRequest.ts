import { useEffect, useState } from 'react';
import { formatCurrency } from '../../utils/format';

export function reportMoney(amount: number, currency?: string): string {
    if (!Number.isFinite(amount) || !currency || !/^[A-Z]{3}$/i.test(currency)) return 'Unavailable';
    try { return `${currency.toUpperCase()} ${formatCurrency(amount, currency.toUpperCase())}`; } catch { return 'Unavailable'; }
}

/** Callers key their report by account/date scope so old data is hidden immediately. */
export function useReportRequest<T>(url: string, accountId: string, token: string, decode: (data: unknown) => T) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => {
            if (controller.signal.aborted) return;
            setLoading(true); setError(false);
            void (async () => {
                try {
                    const response = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } });
                    if (!response.ok) throw new Error('Report unavailable');
                    const report = decode(await response.json());
                    if (!controller.signal.aborted) setData(report);
                } catch { if (!controller.signal.aborted) setError(true); }
                finally { if (!controller.signal.aborted) setLoading(false); }
            })();
        });
        return () => controller.abort();
    }, [url, accountId, token, decode, attempt]);
    return { data, loading, error, retry: () => setAttempt(value => value + 1) };
}
