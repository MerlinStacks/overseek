import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { getDateRange } from '../../utils/dateUtils';
import { rows, label, metric, count, money } from './analyticsRead';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
function decode(value: unknown) { return rows(value).map(row => {
    const rate = row.conversionRate == null ? null : metric(row.conversionRate); if (rate != null && rate > 100) throw new Error('Invalid conversion rate');
    return { country: label(row.country), sessions: count(row.sessions), revenue: metric(row.revenue), rate,
        currency: typeof row.currency === 'string' ? row.currency : '' };
}); }
function decodeCities(value: unknown) { return rows(value).map(row => ({ city: label(row.city), sessions: count(row.sessions), revenue: metric(row.revenue), currency: typeof row.currency === 'string' ? row.currency : '' })); }
export function GeographyView({ dateRange, explicitRange }: { dateRange: string; explicitRange?: { startDate: string; endDate: string } }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Sign in and select an account to view geography.</p>;
    const range = explicitRange ?? getDateRange(dateRange);
    const query = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate }).toString();
    return <GeographyContent key={`${currentAccount.id}:${token}:${query}`} query={query} accountId={currentAccount.id} token={token} />;
}
function GeographyContent({ query, accountId, token }: { query: string; accountId: string; token: string }) {
    const read = useScopedRequest(`/api/analytics/geography/countries?${query}`, accountId, token, decode);
    return <section className={`${ui.card} space-y-3 text-slate-900 dark:text-slate-100`}><h2 className="font-semibold">Traffic by Country</h2>
        {read.loading ? <p role="status">Loading geography…</p> : read.error ? <p role="alert">Geography unavailable. <button type="button" onClick={read.retry}>Retry geography</button></p> : !read.data?.length ? <p>No returned geography observations.</p> : read.data.map((country, index) => <Country key={`${country.country}:${index}`} country={country} query={query} accountId={accountId} token={token} />)}
    </section>;
}
function Country({ country, query, accountId, token }: { country: ReturnType<typeof decode>[number]; query: string; accountId: string; token: string }) {
    const [open, setOpen] = useState(false);
    return <div className="overflow-hidden rounded-lg border border-slate-100 dark:border-slate-700"><button className="w-full break-words bg-slate-50 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-[var(--brand-subtle)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-color)] dark:bg-slate-900 dark:hover:bg-[var(--brand-subtle)]" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{country.country} · {country.sessions} sessions · {money(country.revenue, country.currency)} · {country.sessions && country.rate != null ? `${country.rate.toFixed(2)}% conversion` : 'Conversion unavailable'}</button>
        {open && <Cities country={country.country} query={query} accountId={accountId} token={token} />}
    </div>;
}
function Cities({ country, query, accountId, token }: { country: string; query: string; accountId: string; token: string }) {
    const read = useScopedRequest(`/api/analytics/geography/cities?country=${encodeURIComponent(country)}&${query}`, accountId, token, decodeCities);
    return read.loading ? <p className="p-4 text-xs" role="status">Loading cities…</p> : read.error ? <p className={ui.alert} role="alert">Cities unavailable. <button className={ui.secondary} type="button" onClick={read.retry}>Retry cities</button></p> : <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-700">{read.data?.map((city, index) => <li className="py-3 text-xs" key={index}>{city.city}: {city.sessions} sessions · {money(city.revenue, city.currency)}</li>)}{!read.data?.length && <li className="py-3 text-xs text-slate-500">No returned city observations.</li>}</ul>;
}
