/**
 * SupplierSearchInput - Searchable combobox for selecting suppliers
 * 
 * Provides a better UX than a plain select when there are many suppliers.
 */

import { useState, useEffect, useRef } from 'react';
import { Building2, ChevronDown, X, Plus } from 'lucide-react';

export interface SupplierSelection {
    id: string;
    name: string;
    currency: string;
}

interface SupplierSearchInputProps {
    value: string;  // Current supplier ID
    suppliers: SupplierSelection[];
    onChange: (supplierId: string) => void;
    onCreateNew?: () => void;
    disabled?: boolean;
    placeholder?: string;
}

export function SupplierSearchInput({
    value,
    suppliers,
    onChange,
    onCreateNew,
    disabled = false,
    placeholder = 'Search suppliers...'
}: SupplierSearchInputProps) {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Get selected supplier name
    const selectedSupplier = suppliers.find(s => s.id === value);

    // Filter suppliers based on query
    const filteredSuppliers = query.trim()
        ? suppliers.filter(s =>
            s.name.toLowerCase().includes(query.toLowerCase())
        )
        : suppliers;

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const handleSelect = (supplier: SupplierSelection) => {
        onChange(supplier.id);
        setQuery('');
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange('');
        setQuery('');
        inputRef.current?.focus();
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />

                {/* Show selected supplier or search input */}
                {selectedSupplier && !isOpen ? (
                    <button
                        type="button"
                        onClick={() => { setIsOpen(true); inputRef.current?.focus(); }}
                        disabled={disabled}
                        className="w-full pl-10 pr-8 py-2.5 text-left text-sm border border-gray-300 rounded-lg bg-white disabled:bg-gray-50 disabled:text-gray-500 flex items-center justify-between"
                    >
                        <span className="font-medium text-gray-900">{selectedSupplier.name}</span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{selectedSupplier.currency}</span>
                    </button>
                ) : (
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setIsOpen(true);
                        }}
                        onFocus={() => setIsOpen(true)}
                        placeholder={placeholder}
                        disabled={disabled}
                        className="w-full pl-10 pr-8 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50"
                    />
                )}

                {selectedSupplier ? (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        <X size={16} />
                    </button>
                ) : (
                    <ChevronDown
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                        size={16}
                    />
                )}
            </div>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {filteredSuppliers.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            No suppliers found
                        </div>
                    ) : (
                        filteredSuppliers.map((supplier) => (
                            <button
                                key={supplier.id}
                                type="button"
                                onClick={() => handleSelect(supplier)}
                                className={`w-full px-4 py-3 text-left hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-0 ${supplier.id === value ? 'bg-blue-50' : ''
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-gray-100 rounded">
                                        <Building2 size={14} className="text-gray-500" />
                                    </div>
                                    <span className="font-medium text-gray-900">{supplier.name}</span>
                                </div>
                                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                    {supplier.currency}
                                </span>
                            </button>
                        ))
                    )}

                    {onCreateNew && (
                        <button
                            type="button"
                            onClick={() => { setIsOpen(false); onCreateNew(); }}
                            className="w-full px-4 py-3 text-left text-blue-600 hover:bg-blue-50 flex items-center gap-2 border-t border-gray-200 font-medium"
                        >
                            <Plus size={16} />
                            Create New Supplier
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
