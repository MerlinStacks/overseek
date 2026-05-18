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

        const settledArtifact: any = await canonicalInvoiceService.waitForReady(artifact.id, 15000, 300);

        if (canonicalInvoiceService.isReadableReady(settledArtifact)) {
            return {
                absolutePath: settledArtifact.storagePath,
                artifactId: settledArtifact.id,
            };
        }

        if (settledArtifact && settledArtifact.status === 'pending') {
            await canonicalInvoiceService.processGenerationJob({
                artifactId: settledArtifact.id,
                accountId,
                orderId,
                templateId: artifact.templateId,
            });

            const refreshed: any = await canonicalInvoiceService.getArtifactById(settledArtifact.id);
            if (canonicalInvoiceService.isReadableReady(refreshed)) {
                return {
                    absolutePath: refreshed.storagePath,
                    artifactId: refreshed.id,
                };
            }
        }

        return {
            absolutePath: null,
            artifactId: artifact.id,
        };
    }
}

export const canonicalInvoiceAttachmentService = new CanonicalInvoiceAttachmentService();
