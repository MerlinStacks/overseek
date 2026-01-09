import { useState, useEffect } from 'react';
import { X, Save, Box, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface ProductEditorProps {
    productId: string | number; // WooId
    onClose: () => void;
}

export function ProductEditor({ productId, onClose }: ProductEditorProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [product, setProduct] = useState<any>(null);
    const [binLocation, setBinLocation] = useState('');

    useEffect(() => {
        if (!currentAccount) return;

        fetch(`/api/products/${productId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount.id
            }
        })
            .then(res => res.json())
            .then(data => {
                setProduct(data);
                setBinLocation(data.binLocation || '');
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
                alert('Failed to load product');
                onClose();
            });
    }, [productId, currentAccount, token]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/products/${productId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id
                },
                body: JSON.stringify({ binLocation })
            });

            if (res.ok) {
                alert('Product saved!');
                onClose();
            } else {
                throw new Error('Failed to save');
            }
        } catch (error) {
            alert('Failed to save product');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
            <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Edit Product</h2>
                        <p className="text-sm text-gray-500">Update product details and warehouse location</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex justify-center p-12">
                            <Loader2 className="animate-spin text-blue-600" size={32} />
                        </div>
                    ) : (
                        <>
                            {/* Product Info Card */}
                            <div className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div className="w-16 h-16 bg-white rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden">
                                    {product?.mainImage ? (
                                        <img src={product.mainImage} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                    ) : (
                                        <Box className="text-gray-300" />
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">{product?.name}</h3>
                                    <p className="text-sm text-gray-500 font-mono">SKU: {product?.sku || 'N/A'}</p>
                                    <p className="text-sm text-gray-500">ID: {product?.wooId}</p>
                                </div>
                            </div>

                            {/* Warehouse / Bin Location */}
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700">Bin Location</label>
                                <div className="relative">
                                    <Box className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        value={binLocation}
                                        onChange={(e) => setBinLocation(e.target.value)}
                                        placeholder="e.g. A-12-3"
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <p className="text-xs text-gray-500">Enter the shelf or bin number where this product is stored.</p>
                            </div>

                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t bg-white flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg"
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-md disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        Save Changes
                    </button>
                </div>

            </div>
        </div>
    );
}
