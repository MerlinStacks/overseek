import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { finiteFields, isRecord } from '../../utils/responseValidation';
import { formatCompact } from '../../utils/format';
import { reportMoney } from '../analytics/useReportRequest';

interface ShoppingProduct { productId: string; productTitle: string; productBrand: string; spend: number; clicks: number; conversions: number; roas: number; currency: string }
interface Props { adAccountId: string; campaignId: string; days: number }
function decodeProducts(value: unknown): ShoppingProduct[] {
    if (!Array.isArray(value) || !value.every(item => isRecord(item) && typeof item.productId === 'string' && typeof item.productTitle === 'string' && (item.productBrand == null || typeof item.productBrand === 'string') && typeof item.currency === 'string' && /^[A-Z]{3}$/i.test(item.currency) && finiteFields(item, ['spend', 'clicks', 'conversions', 'roas']))) throw new Error('Invalid campaign products');
    return value;
}
export function CampaignProductsPanel(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount || !props.adAccountId || !props.campaignId || !Number.isInteger(props.days) || props.days < 1) return <p role="status">Select an account, campaign and valid reporting period.</p>;
    return <CampaignProducts key={JSON.stringify([token, currentAccount.id, props.adAccountId, props.campaignId, props.days])} {...props} token={token} accountId={currentAccount.id} />;
}
function CampaignProducts({ token, accountId, adAccountId, campaignId, days }: Props & { token: string; accountId: string }) {
    const url = `/api/ads/${encodeURIComponent(adAccountId)}/campaigns/${encodeURIComponent(campaignId)}/products?days=${days}`;
    const { data, loading, error, retry } = useScopedRequest(url, accountId, token, decodeProducts);
    if (loading) return <p role="status" className="p-6">Loading products...</p>;
    if (error || !data) return <p role="alert" className="p-6">Could not load campaign products. <button type="button" onClick={retry}>Retry products</button></p>;
    if (!data.length) return <p className="p-6">No products available for this campaign. It may not be a Shopping campaign.</p>;
    return <section aria-label="Campaign products" className="p-4 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        <p className="font-medium mb-3">{data.length} products in campaign</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Campaign product performance, sorted by spend</caption><thead><tr>{['Product', 'Spend', 'Clicks', 'Conversions', 'ROAS'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
            {[...data].sort((a, b) => b.spend - a.spend).slice(0, 10).map((item, index) => <tr key={`${item.productId}-${index}`}><th scope="row" className="p-2 font-medium">{item.productTitle}<span className="block text-xs text-slate-500 dark:text-slate-400">{item.productBrand} {item.productId}</span></th><td className="p-2">{reportMoney(item.spend, item.currency)}</td><td className="p-2">{formatCompact(item.clicks)}</td><td className="p-2">{formatCompact(item.conversions)}</td><td className="p-2">{item.roas.toFixed(2)}x</td></tr>)}
        </tbody></table></div>{data.length > 10 && <p className="text-xs mt-2">Showing top 10 of {data.length} products by spend.</p>}
    </section>;
}
