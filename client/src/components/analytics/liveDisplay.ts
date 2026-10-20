import { useEffect, useState } from 'react';
import { formatCurrency } from '../../utils/format';

export function flagEmoji(code: string | null): string {
    const normalized = code?.trim().toUpperCase() || '';
    if (!/^[A-Z]{2}$/.test(normalized)) return '🌍';
    return String.fromCodePoint(...[...normalized].map(char => 127397 + char.charCodeAt(0)));
}

export function cartAmount(value: unknown): number | null {
    const amount = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function cartMoney(value: number | null, currency?: string): string {
    if (value === null || !Number.isFinite(value) || !currency || !/^[A-Z]{3}$/i.test(currency)) return 'Unavailable';
    try { return `${currency.toUpperCase()} ${formatCurrency(value, currency.toUpperCase())}`; }
    catch { return 'Unavailable'; }
}

/** Recency must advance even when a live query returns the same array instance. */
export function useLiveClock(): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    return now;
}
