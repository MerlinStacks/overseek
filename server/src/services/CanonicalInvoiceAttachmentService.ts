import { canonicalInvoiceService } from './CanonicalInvoiceService';

interface ResolveCanonicalInvoicePathResult {
    absolutePath: string | null;
    artifactId: string;
}

export class CanonicalInvoiceAttachmentService {
    async resolveAbsolutePath(accountId: string, orderId: string): Promise<ResolveCanonicalInvoicePathResult> {
        const deadline = Date.now() + 15000;
        let artifact = await canonicalInvoiceService.getOrQueue(accountId, orderId, {
            forceRegenerate: false,
        });

        let settledArtifact = await canonicalInvoiceService.waitForReady(artifact, Math.max(0, deadline - Date.now()), 300);
        // This notification has not been sent yet. Re-admit once when the
        // worker proves that its attempt did not reserve an invoice number.
        if (settledArtifact?.status === 'retryable' && Date.now() < deadline) {
            artifact = await canonicalInvoiceService.getOrQueue(accountId, orderId, { forceRegenerate: false });
            settledArtifact = await canonicalInvoiceService.waitForReady(artifact, Math.max(0, deadline - Date.now()), 300);
        }

        if (canonicalInvoiceService.isReadableReady(settledArtifact)) {
            return {
                absolutePath: settledArtifact.storagePath,
                artifactId: settledArtifact.id,
            };
        }

        return {
            absolutePath: null,
            artifactId: artifact.id,
        };
    }
}

export const canonicalInvoiceAttachmentService = new CanonicalInvoiceAttachmentService();
