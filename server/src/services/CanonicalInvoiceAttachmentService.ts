import { canonicalInvoiceService } from './CanonicalInvoiceService';

interface ResolveCanonicalInvoicePathResult {
    absolutePath: string | null;
    artifactId: string;
}

export class CanonicalInvoiceAttachmentService {
    async resolveAbsolutePath(accountId: string, orderId: string): Promise<ResolveCanonicalInvoicePathResult> {
        const artifact = await canonicalInvoiceService.getOrQueue(accountId, orderId, {
            forceRegenerate: false,
        });

        const settledArtifact = await canonicalInvoiceService.waitForReady(artifact, 15000, 300);

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
