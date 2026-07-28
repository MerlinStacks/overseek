import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calculator, History, Truck } from 'lucide-react';
import { SuppliersList } from '../components/inventory/SuppliersList';
import { PurchaseOrderList } from '../components/inventory/PurchaseOrderList';
import { StockMovementsList } from '../components/inventory/StockMovementsList';

type SupplyChainTab = 'suppliers' | 'purchasing' | 'movements';

const DEFAULT_TAB: SupplyChainTab = 'purchasing';
const VALID_TABS: SupplyChainTab[] = ['purchasing', 'suppliers', 'movements'];

export function SupplyChainPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tabFromUrl = searchParams.get('tab') as SupplyChainTab | null;
    const initialTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;
    const [activeTab, setActiveTab] = useState<SupplyChainTab>(initialTab);

    useEffect(() => {
        const currentTabParam = searchParams.get('tab');
        if (activeTab !== DEFAULT_TAB && currentTabParam !== activeTab) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('tab', activeTab);
            setSearchParams(nextParams, { replace: true });
        } else if (activeTab === DEFAULT_TAB && currentTabParam) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete('tab');
            setSearchParams(nextParams, { replace: true });
        }
    }, [activeTab, searchParams, setSearchParams]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Stock & Suppliers</h1>
                    <p className="text-sm text-gray-500">Manage suppliers, materials, and purchase orders</p>
                </div>

                <div className="flex gap-2 overflow-x-auto sm:gap-4">
                    <button
                        onClick={() => setActiveTab('purchasing')}
                        className={`flex shrink-0 items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'purchasing' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <Calculator size={18} /> Purchase Orders
                    </button>
                    <button
                        onClick={() => setActiveTab('suppliers')}
                        className={`flex shrink-0 items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'suppliers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <Truck size={18} /> Suppliers & Materials
                    </button>
                    <button
                        onClick={() => setActiveTab('movements')}
                        className={`flex shrink-0 items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'movements' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <History size={18} /> Stock Movements
                    </button>
                </div>
            </div>

            {activeTab === 'purchasing' && <PurchaseOrderList />}
            {activeTab === 'suppliers' && <SuppliersList />}
            {activeTab === 'movements' && <StockMovementsList />}
        </div>
    );
}
