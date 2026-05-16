import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { InvoiceRenderer } from '../components/invoicing/InvoiceRenderer';

type CanonicalPayload = {
    layout: any[];
    items: any[];
    order: Record<string, unknown>;
    settings?: Record<string, unknown>;
};

function parsePayload(raw: string | null): CanonicalPayload | null {
    if (!raw) return null;
    try {
        const json = atob(raw);
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            layout: Array.isArray(parsed.layout) ? parsed.layout : [],
            items: Array.isArray(parsed.items) ? parsed.items : [],
            order: parsed.order && typeof parsed.order === 'object' ? parsed.order : {},
            settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
        };
    } catch {
        return null;
    }
}

export function InvoiceCanonicalPrintPage() {
    const { artifactId } = useParams<{ artifactId?: string }>();
    const [params] = useSearchParams();
    const [fetchedPayload, setFetchedPayload] = useState<CanonicalPayload | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const payload = useMemo(() => {
        if (artifactId) return fetchedPayload;
        return parsePayload(params.get('payload'));
    }, [artifactId, fetchedPayload, params]);

    useEffect(() => {
        if (!artifactId) return;
        const expires = params.get('expires');
        const sig = params.get('sig');
        if (!expires || !sig) {
            setLoadError('Missing canonical payload signature');
            return;
        }

        let cancelled = false;
        const url = `/api/invoices/relay/canonical-print-payload/${encodeURIComponent(artifactId)}?expires=${encodeURIComponent(expires)}&sig=${encodeURIComponent(sig)}`;

        (async () => {
            try {
                const res = await fetch(url);
                if (!res.ok) {
                    setLoadError('Unable to load invoice payload');
                    return;
                }

                const data = await res.json();
                if (!data?.success || !data?.payload) {
                    setLoadError('Invalid invoice payload response');
                    return;
                }

                if (!cancelled) {
                    const parsed = data.payload;
                    setFetchedPayload({
                        layout: Array.isArray(parsed.layout) ? parsed.layout : [],
                        items: Array.isArray(parsed.items) ? parsed.items : [],
                        order: parsed.order && typeof parsed.order === 'object' ? parsed.order : {},
                        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
                    });
                }
            } catch {
                if (!cancelled) setLoadError('Failed to fetch invoice payload');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [artifactId, params]);

    if (!payload) {
        return <div style={{ padding: 24 }}>{loadError || 'Loading invoice payload...'}</div>;
    }

    return (
        <div style={{ background: '#fff', minHeight: '100vh', padding: 0 }} data-canonical-invoice-ready="1">
            <InvoiceRenderer
                layout={payload.layout as any}
                items={payload.items as any}
                data={payload.order as any}
                settings={payload.settings as any}
                readOnly
                pageMode="single"
            />
        </div>
    );
}

export default InvoiceCanonicalPrintPage;
