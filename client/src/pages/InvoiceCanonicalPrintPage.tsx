import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    const [params] = useSearchParams();
    const payload = useMemo(() => parsePayload(params.get('payload')), [params]);

    if (!payload) {
        return <div style={{ padding: 24 }}>Invalid invoice payload</div>;
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
