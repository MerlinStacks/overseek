import { Prisma } from '@prisma/client';
import { historicalInputSuppression, InputDiagnostic, readInputDiagnostic } from './inputDiagnostic';

/** Caller holds Account. This records provenance only, never scheduling changes.
 * JSON revision binding survives capability invalidation but not a new intent. */
export async function captureInputSuppression(tx: Prisma.TransactionClient, accountId: string, diagnostic: InputDiagnostic, scope: 'inbound' | null = null) {
    const captured = historicalInputSuppression(diagnostic);
    await tx.$executeRaw`
        UPDATE "DeliveryInputSync" SET "lastDiagnostic" = jsonb_build_object(
            'revision', "desiredRevision"::text, 'diagnostic', ${JSON.stringify(captured)}::jsonb)
        WHERE "accountId" = ${accountId} AND status <> 'synced'
          AND (${scope}::text IS NULL OR scope = ${scope})`;
}

/** Preserve earlier instrumented rows that only had a live account fallback.
 * Truly generic legacy failures (no captured control diagnostic) stay unknown.
 * A new-intent null marker explicitly excludes superseded payloads. */
export async function preserveLegacyInputSuppression(tx: Prisma.TransactionClient, accountId: string,
    control: { capabilityStatus: string; inboundCapabilityStatus: string; lastDiagnostic: unknown } | null) {
    const diagnostic = readInputDiagnostic(control?.lastDiagnostic);
    if (!control || diagnostic?.disposition !== 'account_suppression' || diagnostic.attemptedRevision !== null) return;
    const captured = historicalInputSuppression(diagnostic);
    await tx.$executeRaw`
        UPDATE "DeliveryInputSync" SET "lastDiagnostic" = jsonb_build_object(
            'revision', "desiredRevision"::text, 'diagnostic', ${JSON.stringify(captured)}::jsonb)
        WHERE "accountId" = ${accountId} AND "lastDiagnostic" IS NULL
          AND status IN ('blocked', 'failed', 'plugin_update_required')
          AND (status = ${control.capabilityStatus} OR (scope = 'inbound' AND status = ${control.inboundCapabilityStatus}))`;
}
