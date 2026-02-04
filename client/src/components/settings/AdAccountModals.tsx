/**
 * AdAccountModals
 * 
 * Edit and Pending Setup modals for ad account settings.
 */
import { Loader2, Pencil, X, Check, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface AdAccount {
    id: string;
    platform: string;
    name: string;
    externalId: string;
}

interface EditForm {
    name: string;
    externalId: string;
    accessToken: string;
    refreshToken: string;
}

interface EditAdAccountModalProps {
    account: AdAccount | null;
    form: EditForm;
    onFormChange: (form: EditForm) => void;
    onClose: () => void;
    onSave: () => void;
    isSaving: boolean;
}

export function EditAdAccountModal({
    account,
    form,
    onFormChange,
    onClose,
    onSave,
    isSaving
}: EditAdAccountModalProps) {
    if (!account) return null;

    return (
        <Modal
            isOpen={!!account}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <Pencil size={18} className="text-blue-600" />
                    <span>Edit {account.platform} Account</span>
                </div>
            }
            maxWidth="max-w-md"
        >
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                    <input
                        type="text"
                        className="w-full p-2 border rounded-lg"
                        value={form.name}
                        onChange={e => onFormChange({ ...form, name: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        {account.platform === 'GOOGLE' ? 'Customer ID' : 'Ad Account ID'}
                    </label>
                    <input
                        type="text"
                        className="w-full p-2 border rounded-lg"
                        placeholder={account.externalId}
                        value={form.externalId}
                        onChange={e => onFormChange({ ...form, externalId: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Access Token (leave blank to keep current)</label>
                    <input
                        type="password"
                        className="w-full p-2 border rounded-lg"
                        placeholder="Enter new access token..."
                        value={form.accessToken}
                        onChange={e => onFormChange({ ...form, accessToken: e.target.value })}
                    />
                    {account.platform === 'GOOGLE' && (
                        <p className="text-xs text-gray-500 mt-1">
                            To refresh expired tokens, disconnect and reconnect your account using the OAuth flow.
                        </p>
                    )}
                </div>
                {account.platform === 'GOOGLE' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">New Refresh Token (leave blank to keep current)</label>
                        <input
                            type="password"
                            className="w-full p-2 border rounded-lg"
                            placeholder="Enter new refresh token..."
                            value={form.refreshToken}
                            onChange={e => onFormChange({ ...form, refreshToken: e.target.value })}
                        />
                    </div>
                )}
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-4 border-t">
                <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button
                    onClick={onSave}
                    disabled={isSaving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                    Save Changes
                </button>
            </div>
        </Modal>
    );
}

interface PendingSetupModalProps {
    isOpen: boolean;
    pendingId: string;
    customerId: string;
    isSubmitting: boolean;
    onCustomerIdChange: (value: string) => void;
    onClose: () => void;
    onComplete: () => void;
    onCancel: () => void;
}

export function PendingSetupModal({
    isOpen,
    customerId,
    isSubmitting,
    onCustomerIdChange,
    onClose,
    onComplete,
    onCancel
}: PendingSetupModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <AlertCircle className="text-amber-500" size={20} />
                    <span>Complete Google Ads Setup</span>
                </div>
            }
            maxWidth="max-w-md"
        >
            <p className="text-sm text-gray-600 mb-4">
                Your Google account has been connected. Please enter your Google Ads Customer ID to complete the setup.
            </p>
            <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Google Ads Customer ID</label>
                <input
                    type="text"
                    className="w-full p-3 border rounded-lg"
                    placeholder="123-456-7890"
                    value={customerId}
                    onChange={e => onCustomerIdChange(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-2">
                    Find your Customer ID in the top-right corner of{' '}
                    <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Google Ads</a>
                </p>
            </div>
            <div className="flex gap-3 justify-end pt-4 border-t">
                <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button
                    onClick={onComplete}
                    disabled={!customerId.trim() || isSubmitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Complete Setup
                </button>
            </div>
        </Modal>
    );
}
