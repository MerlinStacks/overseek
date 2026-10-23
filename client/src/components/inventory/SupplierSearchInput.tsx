import { useEffect, useId, useRef, useState } from 'react';
import { Building2, X } from 'lucide-react';

interface SupplierSelection { id: string; name: string; currency: string }
interface SupplierSearchInputProps {
    value: string; suppliers: SupplierSelection[]; onChange: (supplierId: string) => void; onCreateNew?: () => void;
    disabled?: boolean; placeholder?: string; label?: string;
}
export function SupplierSearchInput(props: SupplierSearchInputProps) {
    const valid = Array.isArray(props.suppliers) ? props.suppliers.filter(supplier => supplier && typeof supplier.id === 'string' && supplier.id.trim() && typeof supplier.name === 'string' && supplier.name.trim()) : [];
    const ids = new Map<string, number>(); valid.forEach(supplier => ids.set(supplier.id, (ids.get(supplier.id) || 0) + 1));
    const suppliers = valid.filter(supplier => ids.get(supplier.id) === 1);
    const fingerprint = JSON.stringify([props.disabled, suppliers.map(supplier => [supplier.id, supplier.name, supplier.currency])]);
    return <SupplierCombobox key={fingerprint} {...props} suppliers={suppliers} invalid={suppliers.length !== (props.suppliers?.length ?? 0)} />;
}
function SupplierCombobox({ value, suppliers, onChange, onCreateNew, disabled = false, placeholder = 'Search suppliers...', label = 'Supplier', invalid }: SupplierSearchInputProps & { invalid: boolean }) {
    const [query, setQuery] = useState(''); const [openState, setOpenState] = useState({ value, open: false }); const [active, setActive] = useState(0);
    const open = openState.value === value && openState.open;
    const setOpen = (next: boolean) => setOpenState({ value, open: next });
    const root = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null); const id = useId();
    const selected = suppliers.find(supplier => supplier.id === value);
    const matches = suppliers.filter(supplier => supplier.name.toLowerCase().includes(query.trim().toLowerCase()));
    const visible = matches.slice(0, 100);
    const close = () => { setOpen(false); setQuery(''); setActive(0); };
    useEffect(() => {
        const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpenState(current => ({ ...current, open: false })); setQuery(''); setActive(0); } };
        document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
    }, []);
    const select = (supplier: SupplierSelection) => { if (disabled) return; close(); onChange(supplier.id); input.current?.focus(); };
    return <div ref={root} className="relative">
        <div className="relative">
            <Building2 aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input ref={input} type="text" role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={`${id}-list`} aria-activedescendant={open && visible[active] ? `${id}-${active}` : undefined}
                disabled={disabled} placeholder={placeholder} value={open ? query : selected?.name || ''} onFocus={() => { if (!disabled) { setQuery(''); setActive(0); setOpen(true); } }}
                onClick={() => { if (!disabled && !open) { setQuery(''); setActive(0); setOpen(true); } }}
                onChange={event => { if (!disabled) { setQuery(event.target.value); setActive(0); setOpen(true); } }}
                onKeyDown={event => {
                    if (disabled) return;
                    if (event.key === 'Escape') { event.preventDefault(); close(); }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) setQuery(''); setOpen(true); setActive(index => !open ? 0 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
                    if (event.key === 'Enter' && open) { event.preventDefault(); if (visible[active]) select(visible[active]); }
                    if (event.key === 'Tab') close();
                }} className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 disabled:opacity-50" />
            {value && <button type="button" disabled={disabled} aria-label="Clear supplier" onClick={() => { if (!disabled) { close(); onChange(''); input.current?.focus(); } }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 disabled:opacity-50"><X aria-hidden="true" size={16} /></button>}
        </div>
        {value && !selected && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Selected supplier is unavailable. Choose a valid supplier.</p>}
        {invalid && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Some supplier records are invalid or ambiguous and cannot be selected.</p>}
        {open && !disabled && <div className="absolute z-50 w-full mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg max-h-64 overflow-y-auto">
            <ul id={`${id}-list`} role="listbox" aria-label={`${label} options`}>{visible.map((supplier, index) => <li id={`${id}-${index}`} key={supplier.id} role="option" aria-selected={supplier.id === value}
                    onPointerDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(supplier)} className={`px-4 py-3 cursor-pointer flex justify-between gap-3 text-slate-900 dark:text-slate-100 ${index === active ? 'bg-[var(--brand-subtle)]' : ''}`}>
                <span>{supplier.name}</span><span className="text-xs text-slate-500">{typeof supplier.currency === 'string' && /^[A-Z]{3}$/.test(supplier.currency) ? supplier.currency : 'Currency unavailable'}</span>
            </li>)}</ul>
            {!visible.length && <p role="status" className="p-4 text-sm text-slate-500">No suppliers found</p>}
            {matches.length > visible.length && <p className="p-2 text-xs text-slate-500">Showing the first 100 matches. Refine your search.</p>}
        </div>}
        {onCreateNew && <button type="button" disabled={disabled} onClick={() => { if (!disabled) { close(); onCreateNew(); } }} className="mt-1 px-2 py-1 text-sm text-[var(--brand-text)] disabled:opacity-50">Create New Supplier</button>}
    </div>;
}
