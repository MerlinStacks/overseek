/**
 * TriggerConfig - Configuration panel for flow trigger nodes.
 * Extracted from NodeConfigPanel for modularity.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { LTR_TEXT_STYLE } from '../textInputBidi';

interface TriggerNodeConfig {
    triggerType?: string;
    filterByValue?: boolean;
    filterOperator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
    filterValue?: string | number;
    filterByProduct?: boolean;
    filterProductId?: string;
    filterByCategory?: boolean;
    filterCategoryId?: string;
    daysWithoutPurchase?: number;
    targetOrderStatus?: string;
    frequencyCapHours?: number;
    frequencyCapValue?: number;
    frequencyCapUnit?: 'hours' | 'days' | 'weeks' | 'months';
    accountWideEmailCapHours?: number;
    accountWideEmailCapValue?: number;
    accountWideEmailCapUnit?: 'hours' | 'days' | 'weeks' | 'months';
    quietHoursEnabled?: boolean;
    quietHoursStart?: number;
    quietHoursEnd?: number;
}

const DURATION_UNITS = [
    { value: 'hours', label: 'hours' },
    { value: 'days', label: 'days' },
    { value: 'weeks', label: 'weeks' },
    { value: 'months', label: 'months' }
] as const;

export interface TriggerConfigProps {
    config: TriggerNodeConfig;
    onUpdate: (key: string, value: unknown) => void;
}

interface ProductOption {
    id: string;
    name: string;
}

interface CategoryOption {
    id: string;
    name: string;
}

interface OrderStatusCountsResponse {
    counts?: Record<string, number>;
}

interface WooOrderStatusesResponse {
    data?: Array<{ slug?: string; name?: string }> | Record<string, { slug?: string; name?: string }>;
}

const DEFAULT_ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];

const formatStatusLabel = (status: string) => status
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const normalizeStatusSlug = (status: string) => status.replace(/^wc-/, '').toLowerCase();

const TRIGGER_TYPES = [
    { value: 'ORDER_CREATED', label: 'New Paid Order', group: 'WooCommerce' },
    { value: 'ORDER_PAID', label: 'Order Paid', group: 'WooCommerce' },
    { value: 'ORDER_COMPLETED', label: 'Order Completed', group: 'WooCommerce' },
    { value: 'ORDER_STATUS_CHANGED', label: 'Order Status Changed', group: 'WooCommerce' },
    { value: 'FIRST_ORDER', label: 'First Order', group: 'WooCommerce' },
    { value: 'ABANDONED_CART', label: 'Cart Abandoned', group: 'WooCommerce' },
    { value: 'REVIEW_LEFT', label: 'Review Left', group: 'WooCommerce' },
    { value: 'ARTWORK_UPLOADED', label: 'Artwork Uploaded', group: 'WooCommerce' },
    { value: 'ARTWORK_APPROVAL_REQUESTED', label: 'Artwork Approval Requested', group: 'WooCommerce' },
    { value: 'ARTWORK_APPROVED', label: 'Artwork Approved', group: 'WooCommerce' },
    { value: 'ARTWORK_CHANGES_REQUESTED', label: 'Artwork Changes Requested', group: 'WooCommerce' },
    { value: 'ARTWORK_OVERRIDE_USED', label: 'Artwork Override Used', group: 'WooCommerce' },
    { value: 'SHIPMENT_RECEIVED_BY_CARRIER', label: 'Shipment Received By AusPost', group: 'Shipping' },
    { value: 'SHIPMENT_IN_TRANSIT', label: 'Shipment In Transit', group: 'Shipping' },
    { value: 'SHIPMENT_OUT_FOR_DELIVERY', label: 'Shipment Out For Delivery', group: 'Shipping' },
    { value: 'SHIPMENT_DELIVERY_ATTEMPTED', label: 'Shipment Delivery Attempted', group: 'Shipping' },
    { value: 'SHIPMENT_DELIVERED', label: 'Shipment Delivered', group: 'Shipping' },
    { value: 'SHIPMENT_EXCEPTION', label: 'Shipment Exception', group: 'Shipping' },
    { value: 'CUSTOMER_CREATED', label: 'Customer Created', group: 'Customer' },
    { value: 'NO_PURCHASE_IN_X_DAYS', label: 'No Purchase In X Days', group: 'Customer' },
    { value: 'TAG_ADDED', label: 'Tag Added', group: 'Customer' },
];

export const TriggerConfig: React.FC<TriggerConfigProps> = ({ config, onUpdate }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
    const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
    const [orderStatusOptions, setOrderStatusOptions] = useState<string[]>([]);
    const [isLoadingFilters, setIsLoadingFilters] = useState(false);

    const selectedTrigger = config.triggerType || 'ORDER_CREATED';
    const supportsValueFilter = [
        'ORDER_CREATED',
        'ORDER_PAID',
        'ORDER_COMPLETED',
        'FIRST_ORDER',
        'ABANDONED_CART'
    ].includes(selectedTrigger);
    const supportsOrderConditions = [
        'ORDER_CREATED',
        'ORDER_PAID',
        'ORDER_COMPLETED',
        'FIRST_ORDER',
        'ORDER_STATUS_CHANGED'
    ].includes(selectedTrigger);

    const frequencyCapUnit = config.frequencyCapUnit || 'hours';
    const frequencyCapValue = config.frequencyCapValue ?? config.frequencyCapHours ?? 0;
    const accountWideEmailCapUnit = config.accountWideEmailCapUnit || 'hours';
    const accountWideEmailCapValue = config.accountWideEmailCapValue ?? config.accountWideEmailCapHours ?? 0;

    useEffect(() => {
        const loadFilterOptions = async () => {
            if (!token || !currentAccount?.id || !supportsOrderConditions) return;

            setIsLoadingFilters(true);
            try {
                const [productsRes, categoriesRes, statusCountsRes, wooStatusesRes] = await Promise.all([
                    fetch('/api/products?limit=100', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/products/categories?limit=100', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/sync/orders/status-counts?source=db', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    }),
                    fetch('/api/woocommerce/order-statuses', {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Account-ID': currentAccount.id,
                        }
                    })
                ]);

                if (productsRes.ok) {
                    const productsData = await productsRes.json();
                    const rawProducts = Array.isArray(productsData.products)
                        ? productsData.products
                        : Array.isArray(productsData.items)
                            ? productsData.items
                            : [];

                    const mappedProducts = rawProducts
                        .map((product: { id?: string; wooId?: number | string; name?: string }) => ({
                            id: String(product.wooId ?? product.id ?? ''),
                            name: product.name || 'Unnamed Product'
                        }))
                        .filter((product: ProductOption) => product.id)
                        .sort((a: ProductOption, b: ProductOption) => a.name.localeCompare(b.name));

                    setProductOptions(mappedProducts);
                }

                if (categoriesRes.ok) {
                    const categoriesData = await categoriesRes.json();
                    const rawCategories = Array.isArray(categoriesData.items) ? categoriesData.items : [];
                    const mappedCategories = rawCategories
                        .map((category: { id?: number | string; name?: string }) => ({
                            id: String(category.id ?? ''),
                            name: category.name || 'Unnamed Category'
                        }))
                        .filter((category: CategoryOption) => category.id)
                        .sort((a: CategoryOption, b: CategoryOption) => a.name.localeCompare(b.name));

                    setCategoryOptions(mappedCategories);
                }

                if (wooStatusesRes.ok) {
                    const wooStatusesData = await wooStatusesRes.json() as WooOrderStatusesResponse;
                    const source = wooStatusesData.data;
                    const dynamicFromWoo = Array.isArray(source)
                        ? source.map((item) => item.slug).filter((status): status is string => Boolean(status)).map(normalizeStatusSlug)
                        : Object.keys(source || {}).filter(Boolean).map(normalizeStatusSlug);

                    const merged = Array.from(new Set([...DEFAULT_ORDER_STATUSES, ...dynamicFromWoo])).sort((a, b) => a.localeCompare(b));
                    setOrderStatusOptions(merged);
                }

                if (statusCountsRes.ok) {
                    const statusData = await statusCountsRes.json() as OrderStatusCountsResponse;
                    const dynamicStatuses = Object.keys(statusData.counts || {}).filter(Boolean);
                    setOrderStatusOptions((previous) => {
                        const merged = Array.from(new Set([
                            ...DEFAULT_ORDER_STATUSES,
                            ...previous,
                            ...dynamicStatuses,
                        ])).sort((a, b) => a.localeCompare(b));
                        return merged;
                    });
                }

                if (!wooStatusesRes.ok && !statusCountsRes.ok) {
                    setOrderStatusOptions(DEFAULT_ORDER_STATUSES);
                }
            } finally {
                setIsLoadingFilters(false);
            }
        };

        void loadFilterOptions();
    }, [token, currentAccount?.id, supportsOrderConditions]);

    return (
        <>
            {!config.triggerType && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                    <select
                        value={selectedTrigger}
                        onChange={(e) => onUpdate('triggerType', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        {TRIGGER_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>
            )}

            {selectedTrigger === 'NO_PURCHASE_IN_X_DAYS' && (
                <div className="border-t pt-4 space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Lifecycle Window</label>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Trigger when no purchase has happened for</span>
                        <input
                            type="number"
                            min={1}
                            value={config.daysWithoutPurchase || 90}
                            onChange={(e) => onUpdate('daysWithoutPurchase', Number(e.target.value) || 90)}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                        <span className="text-sm text-gray-600">days</span>
                    </div>
                </div>
            )}

            {selectedTrigger === 'ORDER_STATUS_CHANGED' && (
                <div className="border-t pt-4 space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Target Status</label>
                    <select
                        value={config.targetOrderStatus || ''}
                        onChange={(e) => onUpdate('targetOrderStatus', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Any status change</option>
                        {(orderStatusOptions.length > 0 ? orderStatusOptions : DEFAULT_ORDER_STATUSES).map((status) => (
                            <option key={status} value={status}>{formatStatusLabel(status)}</option>
                        ))}
                    </select>
                </div>
            )}

            {(supportsValueFilter || supportsOrderConditions) && (
                <div className="border-t pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Conditions (Optional)</label>
                    <div className="space-y-2">
                        {supportsValueFilter && (
                            <>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="filterByValue"
                                        checked={config.filterByValue || false}
                                        onChange={(e) => onUpdate('filterByValue', e.target.checked)}
                                        className="rounded-sm"
                                    />
                                    <label htmlFor="filterByValue" className="text-sm text-gray-600">Filter by order value</label>
                                </div>
                                {config.filterByValue && (
                                    <div className="flex items-center gap-2 ml-6">
                                        <span className="text-sm text-gray-600">Order total</span>
                                        <select
                                            value={config.filterOperator || 'gt'}
                                            onChange={(e) => onUpdate('filterOperator', e.target.value)}
                                            className="px-2 py-1 border rounded-sm text-sm"
                                        >
                                            <option value="gt">&gt;</option>
                                            <option value="gte">&gt;=</option>
                                            <option value="lt">&lt;</option>
                                            <option value="lte">&lt;=</option>
                                            <option value="eq">=</option>
                                        </select>
                                        <span className="text-sm text-gray-600">$</span>
                                        <input
                                            type="number"
                                            value={config.filterValue || ''}
                                            onChange={(e) => onUpdate('filterValue', e.target.value)}
                                            placeholder="100"
                                            className="w-20 px-2 py-1 border rounded-sm text-sm"
                                            dir="ltr"
                                            style={LTR_TEXT_STYLE}
                                        />
                                    </div>
                                )}
                            </>
                        )}

                        {supportsOrderConditions && (
                            <>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="filterByProduct"
                                        checked={config.filterByProduct || false}
                                        onChange={(e) => onUpdate('filterByProduct', e.target.checked)}
                                        className="rounded-sm"
                                    />
                                    <label htmlFor="filterByProduct" className="text-sm text-gray-600">Order contains product</label>
                                </div>
                                {config.filterByProduct && (
                                    <div className="ml-6">
                                        <select
                                            value={config.filterProductId || ''}
                                            onChange={(e) => onUpdate('filterProductId', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                            disabled={isLoadingFilters}
                                        >
                                            <option value="">Select a product...</option>
                                            {productOptions.map((product) => (
                                                <option key={product.id} value={product.id}>{product.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="filterByCategory"
                                        checked={config.filterByCategory || false}
                                        onChange={(e) => onUpdate('filterByCategory', e.target.checked)}
                                        className="rounded-sm"
                                    />
                                    <label htmlFor="filterByCategory" className="text-sm text-gray-600">Order contains product category</label>
                                </div>
                                {config.filterByCategory && (
                                    <div className="ml-6">
                                        <select
                                            value={config.filterCategoryId || ''}
                                            onChange={(e) => onUpdate('filterCategoryId', e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                            disabled={isLoadingFilters}
                                        >
                                            <option value="">Select a category...</option>
                                            {categoryOptions.map((category) => (
                                                <option key={category.id} value={category.id}>{category.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {isLoadingFilters && (
                                    <p className="text-xs text-gray-500 ml-6">Loading products and categories...</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="border-t pt-4 space-y-2">
                <label className="block text-sm font-medium text-gray-700">Frequency Cap</label>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Do not re-enroll this customer again for</span>
                    <input
                        type="number"
                        min={0}
                        value={frequencyCapValue}
                        onChange={(e) => onUpdate('frequencyCapValue', Number(e.target.value) || 0)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
                    />
                    <select
                        value={frequencyCapUnit}
                        onChange={(e) => onUpdate('frequencyCapUnit', e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                        {DURATION_UNITS.map((unit) => (
                            <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                    </select>
                </div>
                <p className="text-xs text-gray-500">Use `0` to allow immediate re-entry when other dedupe rules permit it.</p>
            </div>

            <div className="border-t pt-4 space-y-2">
                <label className="block text-sm font-medium text-gray-700">Account-Wide Email Cooldown</label>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Do not send another automation email to this customer for</span>
                    <input
                        type="number"
                        min={0}
                        value={accountWideEmailCapValue}
                        onChange={(e) => onUpdate('accountWideEmailCapValue', Number(e.target.value) || 0)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        dir="ltr"
                        style={LTR_TEXT_STYLE}
                    />
                    <select
                        value={accountWideEmailCapUnit}
                        onChange={(e) => onUpdate('accountWideEmailCapUnit', e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                        {DURATION_UNITS.map((unit) => (
                            <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                    </select>
                    <span className="text-sm text-gray-600">across all flows</span>
                </div>
                <p className="text-xs text-gray-500">Uses actual automation email send history for this account and delays the next email step until the cooldown expires.</p>
            </div>

            <div className="border-t pt-4 space-y-3">
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="quietHoursEnabled"
                        checked={config.quietHoursEnabled || false}
                        onChange={(e) => onUpdate('quietHoursEnabled', e.target.checked)}
                        className="rounded-sm"
                    />
                    <label htmlFor="quietHoursEnabled" className="text-sm font-medium text-gray-700">Respect quiet hours for email sends</label>
                </div>

                {config.quietHoursEnabled && (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Pause sends from</span>
                            <input
                                type="number"
                                min={0}
                                max={23}
                                value={config.quietHoursStart ?? 21}
                                onChange={(e) => onUpdate('quietHoursStart', Number(e.target.value) || 0)}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                dir="ltr"
                                style={LTR_TEXT_STYLE}
                            />
                            <span className="text-sm text-gray-600">to</span>
                            <input
                                type="number"
                                min={0}
                                max={23}
                                value={config.quietHoursEnd ?? 8}
                                onChange={(e) => onUpdate('quietHoursEnd', Number(e.target.value) || 0)}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                dir="ltr"
                                style={LTR_TEXT_STYLE}
                            />
                            <span className="text-sm text-gray-600">local store time</span>
                        </div>
                        <p className="text-xs text-gray-500">Uses the account timezone and will hold email action steps until the next allowed hour.</p>
                    </>
                )}
            </div>
        </>
    );
};
