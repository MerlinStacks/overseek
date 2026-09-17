import { useRef, useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';

interface ComponentStockEditorProps {
    name: string;
    quantity: number;
    onSave: (quantity: number) => Promise<void>;
}

/** Stock changes are drafts until explicitly saved, avoiding accidental inventory updates. */
export function ComponentStockEditor({ name, quantity, onSave }: ComponentStockEditorProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const saving = useRef(false);
    const value = draft ?? String(quantity);
    const stock = Number(value);
    const isValid = value.trim() !== '' && Number.isSafeInteger(stock) && stock >= 0 && stock <= 2147483647;
    const isChanged = draft !== null && stock !== quantity;

    async function save() {
        if (saving.current || !isValid || !isChanged) return;
        saving.current = true;
        setIsSaving(true);
        try {
            await onSave(stock);
            setDraft(null);
        } catch {
            // The list displays the error toast; keep the draft available for retry.
        } finally {
            saving.current = false;
            setIsSaving(false);
        }
    }

    const buttonClass = 'p-1.5 rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500';

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-1">
                <button type="button" aria-label={`Decrease stock for ${name}`} className={buttonClass}
                    disabled={isSaving || !isValid || stock === 0} onClick={() => setDraft(String(stock - 1))}>
                    <Minus size={14} />
                </button>
                <input
                    type="number" min={0} max={2147483647} step={1}
                    aria-label={`Stock for ${name}`} aria-invalid={!isValid}
                    value={value} disabled={isSaving}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); void save(); }
                        if (event.key === 'Escape' && !isSaving) { event.preventDefault(); setDraft(null); }
                    }}
                    className={`w-20 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-center font-semibold focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${stock === 0 ? 'text-red-600 dark:text-red-400' : stock < 10 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}
                />
                <button type="button" aria-label={`Increase stock for ${name}`} className={buttonClass}
                    disabled={isSaving || !isValid || stock === 2147483647} onClick={() => setDraft(String(stock + 1))}>
                    <Plus size={14} />
                </button>
                {(isChanged || isSaving) && (
                    <button type="button" aria-label={`Save stock for ${name}`} disabled={isSaving || !isValid}
                        onClick={() => void save()}
                        className="ml-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        {isSaving ? <Loader2 size={16} className="animate-spin" aria-label="Saving stock" /> : 'Save'}
                    </button>
                )}
            </div>
            {!isValid && <p className="text-xs text-red-600 dark:text-red-400" role="alert">Enter a whole number from 0 to 2,147,483,647.</p>}
        </div>
    );
}
