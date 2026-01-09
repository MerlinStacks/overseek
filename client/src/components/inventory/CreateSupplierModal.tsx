import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface CreateSupplierModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called with the newly created supplier after successful creation */
    onSuccess: (supplier: { id: string; name: string; currency: string }) => void;
}

/**
 * Modal form for inline supplier creation during Purchase Order editing.
 * Reuses the form structure from SuppliersList.tsx for consistency.
 */
export function CreateSupplierModal({ isOpen, onClose, onSuccess }: CreateSupplierModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        contactName: '',
        email: '',
        currency: 'USD',
        leadTimeMin: '',
        leadTimeMax: '',
        paymentTerms: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentAccount || !token) return;

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/inventory/suppliers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify(formData)
            });

            if (!res.ok) {
                throw new Error('Failed to create supplier');
            }

            const newSupplier = await res.json();
            // Reset form state
            setFormData({
                name: '',
                contactName: '',
                email: '',
                currency: 'USD',
                leadTimeMin: '',
                leadTimeMax: '',
                paymentTerms: ''
            });
            onSuccess(newSupplier);
        } catch (error) {
            console.error('Error creating supplier:', error);
            alert('Failed to create supplier. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        if (!isSubmitting) {
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Create New Supplier" maxWidth="max-w-xl">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Supplier Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            required
                            placeholder="e.g. ABC Manufacturing"
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                        <input
                            type="text"
                            placeholder="John Smith"
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.contactName}
                            onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            placeholder="supplier@example.com"
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                        <select
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.currency}
                            onChange={e => setFormData({ ...formData, currency: e.target.value })}
                        >
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                            <option value="GBP">GBP</option>
                            <option value="AUD">AUD</option>
                            <option value="CAD">CAD</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                        <input
                            type="text"
                            placeholder="e.g. Net 30"
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.paymentTerms}
                            onChange={e => setFormData({ ...formData, paymentTerms: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Min Lead Time (Days)</label>
                        <input
                            type="number"
                            min="0"
                            placeholder="7"
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.leadTimeMin}
                            onChange={e => setFormData({ ...formData, leadTimeMin: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Max Lead Time (Days)</label>
                        <input
                            type="number"
                            min="0"
                            placeholder="14"
                            className="w-full border border-gray-300 rounded-lg p-2.5 outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.leadTimeMax}
                            onChange={e => setFormData({ ...formData, leadTimeMax: e.target.value })}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting || !formData.name.trim()}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                        Create Supplier
                    </button>
                </div>
            </form>
        </Modal>
    );
}
