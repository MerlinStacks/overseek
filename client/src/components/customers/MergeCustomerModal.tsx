/**
 * MergeCustomerModal - Find and merge duplicate customer records.
 */
import { useState, useEffect } from 'react';
import { Users, ArrowRight, AlertTriangle, Check, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../ui/Modal';
import { formatCurrency } from '../../utils/format';

interface Customer {
    id: string;
    wooId: number;
    firstName: string;
    lastName: string;
    email: string;
    ordersCount: number;
    totalSpent: number;
}

interface MergeCustomerModalProps {
    isOpen: boolean;
    onClose: () => void;
    customerId: string;
    onMergeComplete: () => void;
}

export function MergeCustomerModal({ isOpen, onClose, customerId, onMergeComplete }: MergeCustomerModalProps) {
    const { token } = useAuth();
    const [target, setTarget] = useState<Customer | null>(null);
    const [duplicates, setDuplicates] = useState<Customer[]>([]);
    const [selectedSource, setSelectedSource] = useState<Customer | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen && customerId) {
            fetchDuplicates();
        }
    }, [isOpen, customerId]);

    const fetchDuplicates = async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/customers/${customerId}/duplicates`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTarget(data.target);
                setDuplicates(data.duplicates || []);
            }
        } catch (e) {
            setError('Failed to load duplicates');
        } finally {
            setIsLoading(false);
        }
    };

    const handleMerge = async () => {
        if (!selectedSource || !target) return;

        setIsMerging(true);
        try {
            const res = await fetch(`/api/customers/${target.id}/merge`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ sourceId: selectedSource.id })
            });

            if (res.ok) {
                onMergeComplete();
                onClose();
            } else {
                const err = await res.json();
                setError(err.error || 'Merge failed');
            }
        } catch (e) {
            setError('Failed to merge customers');
        } finally {
            setIsMerging(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Merge Duplicate Customers" maxWidth="max-w-2xl">
            <div className="space-y-4">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                    </div>
                ) : duplicates.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Users size={48} className="mx-auto mb-3 text-gray-300" />
                        <p className="font-medium">No Duplicates Found</p>
                        <p className="text-sm mt-1">No other customers match this email or phone.</p>
                    </div>
                ) : (
                    <>
                        {/* Target Customer */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="text-xs font-medium text-blue-600 uppercase mb-2">Keep This Customer</div>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-medium text-gray-900">{target?.firstName} {target?.lastName}</div>
                                    <div className="text-sm text-gray-500">{target?.email}</div>
                                </div>
                                <div className="text-right text-sm">
                                    <div>{target?.ordersCount} orders</div>
                                    <div className="font-medium text-green-600">{formatCurrency(target?.totalSpent || 0)}</div>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-center">
                            <ArrowRight className="text-gray-400" />
                        </div>

                        {/* Duplicate Customers */}
                        <div className="space-y-2">
                            <div className="text-xs font-medium text-gray-500 uppercase">Select Customer to Merge Into Above</div>
                            {duplicates.map((dup) => (
                                <button
                                    key={dup.id}
                                    onClick={() => setSelectedSource(dup)}
                                    className={`w-full border rounded-lg p-4 text-left transition-colors ${selectedSource?.id === dup.id
                                        ? 'border-red-300 bg-red-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {selectedSource?.id === dup.id && (
                                                <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                                                    <Check size={12} className="text-white" />
                                                </div>
                                            )}
                                            <div>
                                                <div className="font-medium text-gray-900">{dup.firstName} {dup.lastName}</div>
                                                <div className="text-sm text-gray-500">{dup.email}</div>
                                            </div>
                                        </div>
                                        <div className="text-right text-sm">
                                            <div>{dup.ordersCount} orders</div>
                                            <div className="font-medium">{formatCurrency(dup.totalSpent)}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {selectedSource && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                                <div className="text-sm text-amber-800">
                                    <strong>Warning:</strong> This will transfer all orders and conversations from
                                    <span className="font-medium"> {selectedSource.firstName} {selectedSource.lastName}</span> to
                                    <span className="font-medium"> {target?.firstName} {target?.lastName}</span>, then delete the merged customer.
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="text-red-600 text-sm">{error}</div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={onClose} className="btn-white">
                                Cancel
                            </button>
                            <button
                                onClick={handleMerge}
                                disabled={!selectedSource || isMerging}
                                className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50"
                            >
                                {isMerging ? 'Merging...' : 'Merge & Delete'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
