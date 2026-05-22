import { FormEvent, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { cmToMm, gramsToKg, kgToGrams, mmToCm, shippingFetch, ShippingItemOverride, ShippingPackagePreset } from './shippingApi';

interface OverrideFormState {
    id?: string;
    wooProductId: string;
    wooVariationId: string;
    packagePresetId: string;
    weightKg: string;
    lengthCm: string;
    widthCm: string;
    heightCm: string;
    packingMode: string;
    dangerousGoods: boolean;
    fragile: boolean;
    customsDescription: string;
    countryOfOrigin: string;
    hsCode: string;
    notes: string;
}

const emptyForm: OverrideFormState = {
    wooProductId: '',
    wooVariationId: '',
    packagePresetId: '',
    weightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    packingMode: 'combine_quantities',
    dangerousGoods: false,
    fragile: false,
    customsDescription: '',
    countryOfOrigin: '',
    hsCode: '',
    notes: '',
};

function toForm(item: ShippingItemOverride): OverrideFormState {
    return {
        id: item.id,
        wooProductId: String(item.wooProductId),
        wooVariationId: item.wooVariationId ? String(item.wooVariationId) : '',
        packagePresetId: item.packagePresetId || '',
        weightKg: String(gramsToKg(item.weightGrams)),
        lengthCm: String(mmToCm(item.lengthMm)),
        widthCm: String(mmToCm(item.widthMm)),
        heightCm: String(mmToCm(item.heightMm)),
        packingMode: item.packingMode,
        dangerousGoods: item.dangerousGoods,
        fragile: item.fragile,
        customsDescription: item.customsDescription || '',
        countryOfOrigin: item.countryOfOrigin || '',
        hsCode: item.hsCode || '',
        notes: item.notes || '',
    };
}

function toPayload(form: OverrideFormState) {
    return {
        wooProductId: Number(form.wooProductId),
        wooVariationId: form.wooVariationId ? Number(form.wooVariationId) : null,
        packagePresetId: form.packagePresetId || null,
        weightGrams: kgToGrams(form.weightKg),
        lengthMm: cmToMm(form.lengthCm),
        widthMm: cmToMm(form.widthCm),
        heightMm: cmToMm(form.heightCm),
        packingMode: form.packingMode,
        dangerousGoods: form.dangerousGoods,
        fragile: form.fragile,
        customsDescription: form.customsDescription || null,
        countryOfOrigin: form.countryOfOrigin || null,
        hsCode: form.hsCode || null,
        notes: form.notes || null,
    };
}

export function ShippingItemOverwritesPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [form, setForm] = useState<OverrideFormState>(emptyForm);
    const canFetch = Boolean(token && currentAccount?.id);

    const overridesQuery = useApiQuery<{ itemOverrides: ShippingItemOverride[] }>({
        queryKey: ['shipping-item-overwrites', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/item-overwrites', token!, currentAccount!.id),
    });
    const packagesQuery = useApiQuery<{ packages: ShippingPackagePreset[] }>({
        queryKey: ['shipping-packages', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/packages', token!, currentAccount!.id),
    });

    const saveOverride = useApiMutation<{ itemOverride: ShippingItemOverride }, OverrideFormState>({
        invalidateQueries: [['shipping-item-overwrites', currentAccount?.id]],
        mutationFn: (values) => shippingFetch(values.id ? `/item-overwrites/${values.id}` : '/item-overwrites', token!, currentAccount!.id, {
            method: values.id ? 'PATCH' : 'POST',
            body: JSON.stringify(toPayload(values)),
        }),
        onSuccess: () => setForm(emptyForm),
    });

    const deleteOverride = useApiMutation<{ itemOverride: { id: string } }, string>({
        invalidateQueries: [['shipping-item-overwrites', currentAccount?.id]],
        mutationFn: (id) => shippingFetch(`/item-overwrites/${id}`, token!, currentAccount!.id, { method: 'DELETE' }),
        onSuccess: () => setForm(emptyForm),
    });

    const update = (key: keyof OverrideFormState, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        saveOverride.mutate(form);
    };

    return (
        <ShippingPageShell title="Item Overwrites" description="Override product and variation packing data without mutating WooCommerce product records.">
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
                <ShippingComingSoonCard>
                    <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Overrides</h2>
                    {overridesQuery.isLoading ? <p className="text-sm text-slate-500">Loading overrides...</p> : null}
                    {overridesQuery.error ? <p className="text-sm text-red-600">{overridesQuery.error.message}</p> : null}
                    {(overridesQuery.data?.itemOverrides.length || 0) === 0 && !overridesQuery.isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">No item overrides yet.</p> : null}
                    <div className="space-y-3">
                        {overridesQuery.data?.itemOverrides.map((item) => (
                            <button key={item.id} onClick={() => setForm(toForm(item))} className="block w-full rounded-xl border border-slate-200 p-4 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
                                <p className="font-semibold text-slate-900 dark:text-white">Product #{item.wooProductId}{item.wooVariationId ? ` / Variation #${item.wooVariationId}` : ''}</p>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.packagePreset?.name || 'No package preset'} · {gramsToKg(item.weightGrams) || '-'} kg · {mmToCm(item.lengthMm) || '-'} x {mmToCm(item.widthMm) || '-'} x {mmToCm(item.heightMm) || '-'} cm</p>
                            </button>
                        ))}
                    </div>
                </ShippingComingSoonCard>

                <ShippingComingSoonCard>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{form.id ? 'Edit Override' : 'New Override'}</h2>
                        <TextField label="Woo product ID" value={form.wooProductId} onChange={(v) => update('wooProductId', v)} required type="number" />
                        <TextField label="Woo variation ID" value={form.wooVariationId} onChange={(v) => update('wooVariationId', v)} type="number" />
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Package preset<select value={form.packagePresetId} onChange={(e) => update('packagePresetId', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="">No preset</option>{packagesQuery.data?.packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}</select></label>
                        <TextField label="Packed weight (kg)" value={form.weightKg} onChange={(v) => update('weightKg', v)} type="number" />
                        <div className="grid grid-cols-3 gap-3"><TextField label="L (cm)" value={form.lengthCm} onChange={(v) => update('lengthCm', v)} type="number" /><TextField label="W (cm)" value={form.widthCm} onChange={(v) => update('widthCm', v)} type="number" /><TextField label="H (cm)" value={form.heightCm} onChange={(v) => update('heightCm', v)} type="number" /></div>
                        <TextField label="Customs description" value={form.customsDescription} onChange={(v) => update('customsDescription', v)} />
                        <div className="grid grid-cols-2 gap-3"><TextField label="Country of origin" value={form.countryOfOrigin} onChange={(v) => update('countryOfOrigin', v)} /><TextField label="HS code" value={form.hsCode} onChange={(v) => update('hsCode', v)} /></div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.dangerousGoods} onChange={(e) => update('dangerousGoods', e.target.checked)} /> Dangerous goods</label>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.fragile} onChange={(e) => update('fragile', e.target.checked)} /> Fragile</label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Packer notes<textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>
                        {saveOverride.error ? <p className="text-sm text-red-600">{saveOverride.error.message}</p> : null}
                        <div className="flex gap-2"><button type="submit" className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"><Save size={16} /> Save</button>{form.id ? <button type="button" onClick={() => deleteOverride.mutate(form.id!)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={16} /> Delete</button> : null}</div>
                    </form>
                </ShippingComingSoonCard>
            </div>
        </ShippingPageShell>
    );
}

function TextField({ label, value, onChange, required = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
    return <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}<input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>;
}
