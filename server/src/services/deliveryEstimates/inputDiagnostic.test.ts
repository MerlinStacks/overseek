import { describe, expect, it } from 'vitest';
import { diagnosticMessages, historicalInputSuppression, inboundNeedsRebuild, localInputDiagnostic, readInputDiagnostic, readRowInputDiagnostic, remoteInputDiagnostic, requiresVariantSupplierLeads } from './inputDiagnostic';

describe('bounded delivery diagnostics', () => {
    it('requires exact remote input-rejection evidence for a locally fresh inbound rebuild', () => {
        const diagnostic = remoteInputDiagnostic({ response: { status: 400, data: { code: 'overseek_delivery_input_invalid', data: { reason: 'inbound_expired' } } } }, 'inputs', 2n, false);
        const row = { scope: 'inbound', desiredRevision: 2n, payload: { expiresAt: '2099-01-01T00:00:00.000Z' }, lastDiagnostic: diagnostic };
        expect(inboundNeedsRebuild(row)).toBe(true);
        for (const change of [{ attemptedRevision: '1' }, { source: 'local' }, { phase: 'capabilities' }, { disposition: 'account_suppression' }, { message: 'untrusted' }]) {
            expect(inboundNeedsRebuild({ ...row, lastDiagnostic: { ...diagnostic, ...change } })).toBe(false);
        }
        expect(inboundNeedsRebuild({ ...row, scope: 'product' })).toBe(false);
    });
    it('validates revision-bound historical suppression without exposing its storage wrapper', () => {
        const diagnostic = historicalInputSuppression(localInputDiagnostic('authorization_unavailable', 'capabilities', null, true));
        const stored = { revision: '2', diagnostic };
        expect(readInputDiagnostic(diagnostic)).toEqual(diagnostic);
        expect(readRowInputDiagnostic(stored, 2n)).toEqual(diagnostic);
        expect(readRowInputDiagnostic(stored, 3n)).toBeNull();
        expect(readRowInputDiagnostic({ ...stored, secret: 'secret' }, 2n)).toBeNull();
        expect(readRowInputDiagnostic({ revision: '2', diagnostic: { ...diagnostic, attemptedRevision: '2' } }, 2n)).toBeNull();
        expect(readRowInputDiagnostic({ diagnostic: null }, 2n)).toBeNull();
    });
    it.each(Object.keys(diagnosticMessages).slice(0, 13))('captures precise remote %s without upstream prose', reason => {
        const diagnostic = remoteInputDiagnostic({ response: { status: 400, data: { code: 'overseek_delivery_input_invalid', message: 'https://secret.invalid?token=cost', data: { reason, payload: 'SECRET' } } } }, 'inputs', 4n, false);
        expect(diagnostic).toMatchObject({ code: 'overseek_delivery_input_invalid', reason, attemptedRevision: '4', disposition: 'record_rejection' });
        expect(readInputDiagnostic(diagnostic)).toEqual(diagnostic);
        expect(JSON.stringify(diagnostic)).not.toMatch(/SECRET|secret.invalid|cost/);
    });
    it('drops unknown codes/reasons, extra stored keys, invalid dates and arbitrary messages', () => {
        const diagnostic = remoteInputDiagnostic({ response: { status: 400, data: { code: 'SECRET', data: { reason: 'SECRET' }, message: 'SECRET' } } }, 'inputs', 1n, false);
        expect(diagnostic).toMatchObject({ code: null, reason: null, message: 'Delivery input was rejected.' });
        expect(readInputDiagnostic(diagnostic)).toEqual(diagnostic);
        for (const corrupt of [{ ...diagnostic, proof: {} }, { ...diagnostic, message: 'SECRET' }, { ...diagnostic, occurredAt: 'SECRET' }, { ...diagnostic, code: 'SECRET' }]) expect(readInputDiagnostic(corrupt)).toBeNull();
        expect(readInputDiagnostic(null)).toBeNull();
        expect(readInputDiagnostic('Delivery authorization, schema or revision rejected.')).toBeNull();
    });
    it('does not invent a schema cause for older plugins with only a generic validation code', () => {
        const diagnostic = remoteInputDiagnostic({ response: { status: 400, data: { code: 'overseek_delivery_input_invalid' } } }, 'inputs', 1n, false);
        expect(diagnostic).toMatchObject({ code: 'overseek_delivery_input_invalid', reason: null, message: 'Delivery input was rejected.' });
        expect(readInputDiagnostic(diagnostic)).toEqual(diagnostic);
    });
    it.each(['overseek_delivery_forbidden', 'overseek_delivery_account_mismatch', 'rest_forbidden', 'woocommerce_rest_authentication_error'])('allows safe auth code %s', code => {
        expect(remoteInputDiagnostic({ response: { status: 403, data: { code } } }, 'capabilities', 1n, true)).toMatchObject({ code, reason: 'authorization_unavailable', disposition: 'account_suppression' });
    });
    it('detects only heterogeneous leads within the same non-null owner', () => {
        const target = (owner: number | null, min: number | null) => ({ stockOwnerWooId: owner, supplierLead: min === null ? null : { min, max: min } });
        expect(requiresVariantSupplierLeads({ targets: [target(10, 2), target(10, 3)] })).toBe(true);
        expect(requiresVariantSupplierLeads({ targets: [target(10, null), target(10, 3)] })).toBe(true);
        for (const targets of [[target(10, 2), target(10, 2)], [target(10, 2), target(11, 3)], [target(null, 2), target(null, 3)]]) expect(requiresVariantSupplierLeads({ targets })).toBe(false);
        expect(readInputDiagnostic(localInputDiagnostic('variant_supplier_leads_required', 'capabilities', 2n))).not.toBeNull();
    });
});
