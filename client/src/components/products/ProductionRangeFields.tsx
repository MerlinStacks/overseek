import { useId } from 'react';
import { validateProductionRange, type ProductionRangeDraft } from '../../utils/productionRange';
export type { ProductionRangeDraft } from '../../utils/productionRange';

export type ProductionRangeFieldsProps = {
    label: string;
    value: ProductionRangeDraft | undefined;
    onChange: (range: ProductionRangeDraft) => void;
    inherited?: ProductionRangeDraft;
    disabled?: boolean;
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
};

export type VariationProductionEditor = {
    parent: ProductionRangeDraft;
    values: Record<number, ProductionRangeDraft>;
    onChange: (wooId: number, value: ProductionRangeDraft) => void;
    disabled?: boolean;
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
};

/** Controlled drafts belong to the product editor, including while a variation is collapsed. */
export function ProductionRangeFields({ label, value, onChange, inherited, disabled, loading, error, onRetry }: ProductionRangeFieldsProps) {
    const id = useId();
    const unavailable = value === undefined;
    const blocked = disabled || loading || unavailable || !!error;
    const validation = value && !loading && !error ? validateProductionRange(value) : null;
    const blank = value?.min === '' && value.max === '';
    const inheritedError = blank && inherited ? validateProductionRange(inherited) : null;
    const message = error || validation || (inheritedError ? `Parent production range: ${inheritedError}` : null);
    let hint = inherited ? 'Leave both blank to inherit the product range.' : 'Leave both blank for no product production range.';
    if (loading) hint = 'Loading production range…';
    else if (unavailable || error) hint = 'Production range unavailable.';
    else if (blank && inherited && !inheritedError) {
        hint = inherited.min === ''
            ? 'Inherits product: no production range set.'
            : `Inherits product: minimum ${inherited.min} days, maximum ${inherited.max} days.`;
    } else if (blank && !inherited) hint = 'No product production range set.';

    return (
        <fieldset aria-busy={!!loading} className="space-y-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-700 dark:text-slate-200">{label}</legend>
            <div className="grid grid-cols-2 gap-3 max-w-md">
                {(['min', 'max'] as const).map(key => (
                    <div key={key}>
                        <label htmlFor={`${id}-${key}`} className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                            {key === 'min' ? 'Minimum days' : 'Maximum days'}
                        </label>
                        <input
                            id={`${id}-${key}`}
                            type="text"
                            inputMode="numeric"
                            value={value?.[key] ?? ''}
                            disabled={blocked}
                            aria-invalid={!!message}
                            aria-describedby={`${id}-hint${message ? ` ${id}-error` : ''}`}
                            onChange={event => { if (value && !blocked) onChange({ ...value, [key]: event.target.value }); }}
                            className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                    </div>
                ))}
            </div>
            <p id={`${id}-hint`} aria-live="polite" className="text-xs text-gray-500 dark:text-slate-400">{hint}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Business days using the production calendar and cutoff. Transit time is additional.</p>
            {message && <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">{message}</p>}
            {onRetry && (error || unavailable) && !loading && (
                <button type="button" onClick={onRetry} disabled={disabled} className="text-xs text-blue-600 dark:text-blue-400 underline disabled:opacity-50">Retry loading production range</button>
            )}
        </fieldset>
    );
}
