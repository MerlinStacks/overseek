import { FormEvent, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { cmToMm, gramsToKg, kgToGrams, mmToCm, shippingFetch, ShippingPackagePreset } from './shippingApi';

interface PackageFormState {
    id?: string;
    name: string;
    type: string;
    innerLengthCm: string;
    innerWidthCm: string;
    innerHeightCm: string;
    outerLengthCm: string;
    outerWidthCm: string;
    outerHeightCm: string;
    fallbackItemWeightKg: string;
    forcedPackageWeightKg: string;
    packagingWeightKg: string;
    maxWeightKg: string;
    selectionPriority: string;
    carrierProductCode: string;
    isDefault: boolean;
    isActive: boolean;
}

const emptyForm: PackageFormState = {
    name: '',
    type: 'custom_box',
    innerLengthCm: '',
    innerWidthCm: '',
    innerHeightCm: '',
    outerLengthCm: '',
    outerWidthCm: '',
    outerHeightCm: '',
    fallbackItemWeightKg: '',
    forcedPackageWeightKg: '',
    packagingWeightKg: '0',
    maxWeightKg: '',
    selectionPriority: '0',
    carrierProductCode: '',
    isDefault: false,
    isActive: true,
};

const packageTypeOptions = [
    { value: 'custom_box', label: 'Box / Rigid Carton' },
    { value: 'satchel', label: 'Satchel (Flexible)' },
    { value: 'poly_mailer', label: 'Poly Mailer (Flexible)' },
    { value: 'mailer_bag', label: 'Mailer Bag (Flexible)' },
    { value: 'flat_mailer', label: 'Flat Mailer (Flexible)' },
];

const isFlexibleType = (type: string) => type === 'satchel' || type === 'poly_mailer' || type === 'flat_mailer' || type === 'mailer_bag';

function toForm(pkg: ShippingPackagePreset): PackageFormState {
    return {
        id: pkg.id,
        name: pkg.name,
        type: pkg.type,
        innerLengthCm: String(mmToCm(pkg.innerLengthMm)),
        innerWidthCm: String(mmToCm(pkg.innerWidthMm)),
        innerHeightCm: String(mmToCm(pkg.innerHeightMm)),
        outerLengthCm: String(mmToCm(pkg.outerLengthMm)),
        outerWidthCm: String(mmToCm(pkg.outerWidthMm)),
        outerHeightCm: String(mmToCm(pkg.outerHeightMm)),
        fallbackItemWeightKg: String(gramsToKg(pkg.fallbackItemWeightGrams)),
        forcedPackageWeightKg: String(gramsToKg(pkg.forcedPackageWeightGrams)),
        packagingWeightKg: String(gramsToKg(pkg.packagingWeightGrams) || 0),
        maxWeightKg: String(gramsToKg(pkg.maxWeightGrams)),
        selectionPriority: String(pkg.selectionPriority),
        carrierProductCode: pkg.carrierProductCode || '',
        isDefault: pkg.isDefault,
        isActive: pkg.isActive,
    };
}

function toPayload(form: PackageFormState) {
    return {
        name: form.name.trim(),
        type: form.type,
        innerLengthMm: cmToMm(form.innerLengthCm),
        innerWidthMm: cmToMm(form.innerWidthCm),
        innerHeightMm: cmToMm(form.innerHeightCm),
        outerLengthMm: cmToMm(form.outerLengthCm),
        outerWidthMm: cmToMm(form.outerWidthCm),
        outerHeightMm: cmToMm(form.outerHeightCm),
        fallbackItemWeightGrams: kgToGrams(form.fallbackItemWeightKg),
        forcedPackageWeightGrams: kgToGrams(form.forcedPackageWeightKg),
        packagingWeightGrams: kgToGrams(form.packagingWeightKg) || 0,
        maxWeightGrams: kgToGrams(form.maxWeightKg),
        selectionPriority: Number(form.selectionPriority || 0),
        carrierProductCode: form.carrierProductCode.trim() || null,
        isDefault: form.isDefault,
        isActive: form.isActive,
    };
}

export function ShippingPackagesPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [form, setForm] = useState<PackageFormState>(emptyForm);

    const canFetch = Boolean(token && currentAccount?.id);
    const packagesQuery = useApiQuery<{ packages: ShippingPackagePreset[] }>({
        queryKey: ['shipping-packages', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/packages', token!, currentAccount!.id),
    });

    const savePackage = useApiMutation<{ package: ShippingPackagePreset }, PackageFormState>({
        invalidateQueries: [['shipping-packages', currentAccount?.id]],
        mutationFn: async (values) => {
            const payload = toPayload(values);
            const path = values.id ? `/packages/${values.id}` : '/packages';
            return shippingFetch(path, token!, currentAccount!.id, {
                method: values.id ? 'PATCH' : 'POST',
                body: JSON.stringify(payload),
            });
        },
        onSuccess: () => setForm(emptyForm),
    });

    const deactivatePackage = useApiMutation<{ package: ShippingPackagePreset }, string>({
        invalidateQueries: [['shipping-packages', currentAccount?.id]],
        mutationFn: (id) => shippingFetch(`/packages/${id}`, token!, currentAccount!.id, { method: 'DELETE' }),
        onSuccess: () => setForm(emptyForm),
    });

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        savePackage.mutate(form);
    };

    const update = (key: keyof PackageFormState, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));
    const flexibleType = isFlexibleType(form.type);

    return (
        <ShippingPageShell
            title="Packages"
            description="Manage package presets with internal dimensions, carrier dimensions, fallback weights, forced weights, packaging weight, and max weight rules. UI uses cm/kg; OverSeek stores mm/grams."
        >
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
                <ShippingComingSoonCard>
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Package Presets</h2>
                        <button onClick={() => setForm(emptyForm)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                            <Plus size={16} /> New Package
                        </button>
                    </div>

                    {packagesQuery.isLoading ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Loading packages...</p>
                    ) : packagesQuery.error ? (
                        <p className="text-sm text-red-600">{packagesQuery.error.message}</p>
                    ) : (packagesQuery.data?.packages.length || 0) === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No package presets yet. Add the first package to enable dispatch readiness checks.</p>
                    ) : (
                        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-3">Package</th>
                                        <th className="px-4 py-3">Type</th>
                                        <th className="px-4 py-3">Outer Size</th>
                                        <th className="px-4 py-3">Max Weight</th>
                                        <th className="px-4 py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {packagesQuery.data?.packages.map((pkg) => (
                                        <tr key={pkg.id} onClick={() => setForm(toForm(pkg))} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                                                {pkg.name}{pkg.isDefault ? <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">Default</span> : null}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{pkg.type}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{mmToCm(pkg.outerLengthMm)} x {mmToCm(pkg.outerWidthMm)} x {mmToCm(pkg.outerHeightMm)} cm</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{gramsToKg(pkg.maxWeightGrams) || '-'} kg</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{pkg.isActive ? 'Active' : 'Inactive'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </ShippingComingSoonCard>

                <ShippingComingSoonCard>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{form.id ? 'Edit Package' : 'New Package'}</h2>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Package Title<input value={form.name} onChange={(e) => update('name', e.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Package Type<select value={form.type} onChange={(e) => update('type', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900">{packageTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                        {flexibleType ? (
                            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                                Flexible package mode is active. Auto-selection treats this as form-fitting, including fold-over seal allowance and relaxed depth checks.
                            </p>
                        ) : (
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                                Rigid package mode is active. Auto-selection uses box-style orientation, usable volume, and stacked-dimension checks.
                            </p>
                        )}
                        <div className="grid grid-cols-3 gap-3">
                            <NumberField label={flexibleType ? 'Layflat L (cm)' : 'Outer L (cm)'} value={form.outerLengthCm} onChange={(v) => update('outerLengthCm', v)} required />
                            <NumberField label={flexibleType ? 'Layflat W (cm)' : 'Outer W (cm)'} value={form.outerWidthCm} onChange={(v) => update('outerWidthCm', v)} required />
                            <NumberField label={flexibleType ? 'Depth Limit (cm)' : 'Outer H (cm)'} value={form.outerHeightCm} onChange={(v) => update('outerHeightCm', v)} required />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <NumberField label={flexibleType ? 'Usable L Override (cm)' : 'Inner L (cm)'} value={form.innerLengthCm} onChange={(v) => update('innerLengthCm', v)} />
                            <NumberField label={flexibleType ? 'Usable W Override (cm)' : 'Inner W (cm)'} value={form.innerWidthCm} onChange={(v) => update('innerWidthCm', v)} />
                            <NumberField label={flexibleType ? 'Usable D Override (cm)' : 'Inner H (cm)'} value={form.innerHeightCm} onChange={(v) => update('innerHeightCm', v)} />
                        </div>
                        <NumberField label="Fallback item weight (kg)" value={form.fallbackItemWeightKg} onChange={(v) => update('fallbackItemWeightKg', v)} />
                        <NumberField label="Force package weight (kg)" value={form.forcedPackageWeightKg} onChange={(v) => update('forcedPackageWeightKg', v)} />
                        <NumberField label="Packaging material weight (kg)" value={form.packagingWeightKg} onChange={(v) => update('packagingWeightKg', v)} />
                        <NumberField label="Maximum package weight (kg)" value={form.maxWeightKg} onChange={(v) => update('maxWeightKg', v)} />
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.isDefault} onChange={(e) => update('isDefault', e.target.checked)} /> Default package</label>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.isActive} onChange={(e) => update('isActive', e.target.checked)} /> Active</label>
                        {savePackage.error ? <p className="text-sm text-red-600">{savePackage.error.message}</p> : null}
                        <div className="flex gap-2">
                            <button type="submit" disabled={savePackage.isPending} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"><Save size={16} /> Save</button>
                            {form.id ? <button type="button" onClick={() => deactivatePackage.mutate(form.id)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={16} /> Disable</button> : null}
                        </div>
                    </form>
                </ShippingComingSoonCard>
            </div>
        </ShippingPageShell>
    );
}

function NumberField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
    return <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}<input type="number" step="0.001" min="0" value={value} onChange={(e) => onChange(e.target.value)} required={required} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>;
}
