import { useState } from 'react';
import { isAttentionInput, useDeliverySyncInputs, type InputFilter, type InputScope } from '../../../hooks/useDeliverySyncInputs';

type Props = { accountId: string; token: string; canEdit: boolean; disabled: boolean; onRetry: () => unknown };
const controlClass = 'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 disabled:opacity-50';

export function DeliverySyncInputs(props: Props) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<InputFilter>('attention');
    const [scope, setScope] = useState<InputScope | ''>('');
    return <div className="space-y-3">
        <button type="button" className={controlClass} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide blocked inputs' : 'View blocked inputs'}</button>
        {open && <section aria-label="Blocked input diagnostics" className="space-y-3">
            <div className="flex flex-wrap gap-3">
                <label>Status <select className={controlClass} value={status} onChange={event => setStatus(event.target.value as InputFilter)}>
                    <option value="attention">Needs attention</option><option value="blocked">Blocked</option><option value="failed">Failed</option><option value="plugin_update_required">Plugin update required</option>
                </select></label>
                <label>Scope <select className={controlClass} value={scope} onChange={event => setScope(event.target.value as InputScope | '')}>
                    <option value="">All scopes</option><option value="settings">Settings</option><option value="product">Product</option><option value="inbound">Inbound</option>
                </select></label>
            </div>
            <InputList key={JSON.stringify([props.accountId, status, scope])} {...props} status={status} scope={scope} />
        </section>}
    </div>;
}

function InputList({ status, scope, ...props }: Props & { status: InputFilter; scope: InputScope | '' }) {
    const data = useDeliverySyncInputs({ ...props, status, scope, canRetry: props.canEdit && !props.disabled });
    return <div className="space-y-3 text-sm">
        <p>Diagnostics describe saved inputs only. Retrying one input does not request a full resync or confirm that it is fixed.</p>
        {data.loading && <p role="status">Loading input diagnostics…</p>}
        {data.error && <p role="alert">{data.error}</p>}
        {Object.entries(data.results).map(([id, message]) => message && <p role="status" key={id}>Input {id}: {message}</p>)}
        <button type="button" className={controlClass} disabled={data.loading || data.pending.length > 0} onClick={() => void data.refresh()}>Refresh input diagnostics</button>
        {data.page && <>
            <p>Observed at: {data.page.observedAt}</p>
            {!data.page.items.length && <p>No inputs match these filters.</p>}
            <ul className="space-y-3">
                {data.page.items.map(input => <li key={input.id} className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 p-3 break-words">
                    <h4 className="font-semibold">{{ settings: 'Settings', product: 'Product', inbound: 'Inbound' }[input.scope]}{input.scope !== 'settings' ? ` · WooCommerce product ID: ${input.entityId}` : ''}</h4>
                    <p>Input ID: {input.id} · Status: {input.status}</p>
                    <p>Desired revision: {input.desiredRevision} · Acknowledged revision: {input.ackRevision || 'None'}</p>
                    {input.diagnostic ? <>
                        <p>{input.diagnostic.message}</p>
                        <p>Reason: {input.diagnostic.reason ?? 'Not captured'} · Code: {input.diagnostic.code ?? 'Not captured'} · HTTP status: {input.diagnostic.httpStatus ?? 'Not captured'}</p>
                        <p>Source: {input.diagnostic.source} · Phase: {input.diagnostic.phase} · Attempted revision: {input.diagnostic.attemptedRevision ?? 'Not captured'} · Occurred at: {input.diagnostic.occurredAt}</p>
                        {input.diagnostic.disposition === 'account_suppression' && <p>Account-suppressed: this input is held by an account-wide condition, not an independent input failure.</p>}
                    </> : <p>Reason not captured for this input.</p>}
                    {input.status === 'plugin_update_required' && <p>Update the WooCommerce companion plugin before retrying. A retry cannot resolve a missing plugin capability by itself.</p>}
                    <p>{input.payloadSummary.isTombstone ? 'Tombstone — removes saved input data.' : 'Data payload — not a tombstone.'} {input.payloadSummary.expiredAtObservation ? 'Payload expired at observation; saved data may need rebuilding.' : 'Payload not marked expired at observation.'}</p>
                    <p>Envelope: {input.payloadSummary.envelopeBytes} bytes · Variations: {input.payloadSummary.variationCount ?? 'Not applicable'} · Targets: {input.payloadSummary.targetCount ?? 'Not applicable'}</p>
                    <p>Generated: {input.payloadSummary.generatedAt ?? 'Not captured'} · Expires: {input.payloadSummary.expiresAt ?? 'Not captured'}</p>
                    <p>Attempts: {input.attempts} · Proof rebuilds: {input.proofRebuilds} · Last acknowledged: {input.lastAcknowledgedAt ?? 'Never'} · Updated: {input.updatedAt}</p>
                    {props.canEdit && isAttentionInput(input.status) && <button type="button" className={controlClass} disabled={props.disabled || data.loading || data.unsupported || data.pending.includes(input.id)} onClick={() => void data.retry(input.id)}>Retry this input</button>}
                </li>)}
            </ul>
        </>}
        <div className="flex gap-3">
            <button type="button" className={controlClass} disabled={data.loading || data.pending.length > 0 || !data.hasPrevious} onClick={data.previous}>Previous inputs</button>
            <button type="button" className={controlClass} disabled={data.loading || data.pending.length > 0 || !data.page?.nextCursor} onClick={data.next}>Next inputs</button>
        </div>
    </div>;
}
