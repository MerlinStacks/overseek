import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useToast } from '../../context/ToastContext';
import type { PlatformSegment } from './PlatformSegmentCard';
import type { AdAudienceDestination } from './NativeAudienceForm';

/** Platform membership stays remote; these definitions share the Segments workspace. */
export function usePlatformSegments() {
    const api = useApi();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const result = useApiQuery<{ segments: PlatformSegment[]; destinations: AdAudienceDestination[] }>({
        queryKey: ['platform-segments', api.accountId],
        queryFn: async () => {
            const [segments, destinations] = await Promise.all([
                api.get<PlatformSegment[]>('/api/segments/native-audiences'),
                api.get<AdAudienceDestination[]>('/api/segments/destinations')
            ]);
            return { segments, destinations };
        },
        enabled: api.isReady, refetchInterval: 15000
    });

    async function act(id: string, action: 'retry' | 'reconcile') {
        if (action === 'retry' && !window.confirm('Retry segment creation? This reconfirms that the required advertising consent and platform audience terms remain satisfied.')) return;
        setBusy(true);
        try {
            await api.post(`/api/segments/native-audiences/${id}/${action}`, action === 'retry' ? { consentConfirmed: true } : undefined);
            await result.refetch();
            toast.success(action === 'retry' ? 'Segment creation queued again' : 'Platform segment found and linked');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update segment'); }
        finally { setBusy(false); }
    }

    return { ...result, busy, retry: (id: string) => void act(id, 'retry'), reconcile: (id: string) => void act(id, 'reconcile') };
}
