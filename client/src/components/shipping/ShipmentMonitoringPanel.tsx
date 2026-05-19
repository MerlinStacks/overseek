import type { ReactNode } from 'react';
import { ExternalLink, RefreshCw, Truck } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { shippingFetch } from '../../pages/shipping/shippingApi';

interface TrackingEvent {
    id: string;
    normalizedState?: string | null;
    status?: string | null;
    description?: string | null;
    location?: string | null;
    occurredAt: string;
}

interface ShipmentLabel {
    id: string;
    carrier: string;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    latestTrackingStatus?: string | null;
    latestTrackingSummary?: string | null;
    serviceName?: string | null;
    status: string;
    printedAt?: string | null;
    createdAt: string;
    trackingEvents: TrackingEvent[];
}

export function ShipmentMonitoringPanel({ wooOrderId, fallback }: { wooOrderId: number; fallback: ReactNode }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const canFetch = Boolean(token && currentAccount?.id && wooOrderId);
    const shipmentsQuery = useApiQuery<{ labels: ShipmentLabel[] }>({
        queryKey: ['shipping-order-shipments', currentAccount?.id, wooOrderId],
        enabled: canFetch,
        queryFn: () => shippingFetch(`/orders/${wooOrderId}/shipments`, token!, currentAccount!.id),
    });
    const refreshTracking = useApiMutation<unknown, string>({
        invalidateQueries: [['shipping-order-shipments', currentAccount?.id, wooOrderId]],
        mutationFn: (labelId) => shippingFetch(`/labels/${labelId}/tracking/refresh`, token!, currentAccount!.id, { method: 'POST' }),
    });

    if (shipmentsQuery.isLoading) {
        return <PanelShell><p className="text-sm text-gray-500">Loading shipment monitoring...</p></PanelShell>;
    }

    if (shipmentsQuery.error || !shipmentsQuery.data?.labels.length) {
        return <>{fallback}</>;
    }

    return (
        <PanelShell>
            <div className="font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
                <Truck size={18} className="text-blue-500" />
                Shipment Monitoring
            </div>
            <div className="space-y-4">
                {shipmentsQuery.data.labels.map((label) => (
                    <div key={label.id} className="space-y-3 border-b border-dashed border-gray-200 pb-4 last:border-b-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-gray-900">{label.serviceName || label.carrier}</p>
                                <p className="text-xs text-gray-500">{label.latestTrackingSummary || label.latestTrackingStatus || label.status}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => refreshTracking.mutate(label.id)} className="text-gray-400 hover:text-gray-700" title="Refresh tracking"><RefreshCw size={16} /></button>
                                {label.trackingUrl ? <a href={label.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={16} /></a> : null}
                            </div>
                        </div>
                        {label.trackingNumber ? <code className="block rounded bg-gray-50 px-2 py-1 text-sm text-gray-900">{label.trackingNumber}</code> : null}
                        {label.trackingEvents.length === 0 ? (
                            <p className="flex items-center gap-2 text-xs text-gray-500"><RefreshCw size={13} /> Waiting for AusPost scan events.</p>
                        ) : (
                            <div className="space-y-2">
                                {label.trackingEvents.slice(0, 5).map((event) => (
                                    <div key={event.id} className="rounded-lg bg-gray-50 p-3">
                                        <p className="text-xs font-semibold uppercase text-gray-500">{(event.normalizedState || event.status || 'tracking').replace(/_/g, ' ')}</p>
                                        <p className="text-sm text-gray-800">{event.description || 'AusPost scan event'}</p>
                                        <p className="text-xs text-gray-500">{event.location ? `${event.location} · ` : ''}{new Date(event.occurredAt).toLocaleString()}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </PanelShell>
    );
}

function PanelShell({ children }: { children: ReactNode }) {
    return <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">{children}</div>;
}
