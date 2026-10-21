import { Modal } from '../ui/Modal';
import { validAdAccountId } from './adAccountValues';

interface AdAccount { id: string; platform: string; name: string; externalId: string }
interface EditForm { name: string; externalId: string; accessToken: string; refreshToken: string }
interface EditProps { account: AdAccount | null; form: EditForm; onFormChange: (form: EditForm) => void; onClose: () => void; onSave: () => void; isSaving: boolean; error?: string | null }
export function EditAdAccountModal({ account, form, onFormChange, onClose, onSave, isSaving, error }: EditProps) {
    if (!account) return null;
    const valid = !!form.name.trim() && validAdAccountId(account.platform, form.externalId);
    return <Modal isOpen onClose={isSaving ? undefined : onClose} title={`Edit ${account.platform} Account`} maxWidth="max-w-md">
        <fieldset disabled={isSaving} className="space-y-4 text-slate-900 dark:text-slate-100">
            {([['name', 'Account Name'], ['externalId', account.platform === 'GOOGLE' ? 'Customer ID' : 'Ad Account ID'], ['accessToken', 'New Access Token (leave blank to keep current)'], ...(account.platform === 'GOOGLE' ? [['refreshToken', 'New Refresh Token (leave blank to keep current)']] : [])] as Array<[keyof EditForm, string]>).map(([field, label]) => <label className="block" key={field}>{label}<input className="block w-full p-2 border rounded-lg bg-white dark:bg-slate-900" autoComplete="off" type={field.endsWith('Token') ? 'password' : 'text'} value={form[field]} onChange={event => onFormChange({ ...form, [field]: event.target.value })} /></label>)}
            {!valid && <p>Enter an account name and a valid {account.platform === 'GOOGLE' ? '10-digit Customer ID (dashes optional)' : 'numeric Ad Account ID (act_ prefix optional)'}.</p>}
            <p>Use Reconnect to reauthorize an expired connection without deleting it.</p>
            <div className="flex gap-4 justify-end"><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={!valid} onClick={onSave}>{isSaving ? 'Saving...' : 'Save Changes'}</button></div>
        </fieldset>{error && <p role="alert">{error}</p>}
    </Modal>;
}
interface PendingProps { isOpen: boolean; pendingId: string; customerId: string; isSubmitting: boolean; onCustomerIdChange: (value: string) => void; onClose: () => void; onComplete: () => void; onCancel: () => void; error?: string | null }
export function PendingSetupModal({ isOpen, pendingId, customerId, isSubmitting, onCustomerIdChange, onClose, onComplete, onCancel, error }: PendingProps) {
    return <Modal isOpen={isOpen} onClose={isSubmitting ? undefined : onClose} title="Complete Google Ads Setup" maxWidth="max-w-md">
        <fieldset disabled={isSubmitting} className="space-y-4 text-slate-900 dark:text-slate-100"><p>Enter the Google Ads Customer ID to finish this pending connection. Closing keeps the pending connection; disconnecting removes it after confirmation.</p>
            <label className="block">Google Ads Customer ID<input className="block w-full p-2 border rounded-lg bg-white dark:bg-slate-900" placeholder="123-456-7890" value={customerId} onChange={event => onCustomerIdChange(event.target.value)} /></label>
            <p>Use 10 digits, with optional dashes. Find the ID in <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Ads</a>.</p>
            <div className="flex flex-wrap gap-4"><button type="button" onClick={onClose}>Close</button><button type="button" disabled={!pendingId} onClick={onCancel}>Disconnect pending account</button><button type="button" disabled={!pendingId || !validAdAccountId('GOOGLE', customerId)} onClick={onComplete}>{isSubmitting ? 'Completing...' : 'Complete Setup'}</button></div>
        </fieldset>{error && <p role="alert">{error}</p>}
    </Modal>;
}
