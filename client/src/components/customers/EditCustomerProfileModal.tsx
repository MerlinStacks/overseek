import { FormEvent, useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';

export interface CustomerProfileValues {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    company: string;
    abn: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
}

interface Props {
    isOpen: boolean;
    initialValues: CustomerProfileValues;
    isSaving: boolean;
    error?: string | null;
    onClose: () => void;
    onSave: (values: CustomerProfileValues) => Promise<void>;
}

type FieldName = keyof CustomerProfileValues;
type FieldErrors = Partial<Record<FieldName, string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatAbn(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8), digits.slice(8, 11)]
        .filter(Boolean)
        .join(' ');
}

function isValidAbn(value: string) {
    const digits = value.replace(/\s/g, '');
    if (!/^\d{11}$/.test(digits)) return false;
    const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const sum = digits.split('').reduce((total, digit, index) => {
        const number = Number(digit) - (index === 0 ? 1 : 0);
        return total + number * weights[index];
    }, 0);
    return sum % 89 === 0;
}

function normalizeForEditing(values: CustomerProfileValues): CustomerProfileValues {
    return {
        ...values,
        abn: formatAbn(values.abn),
        country: values.country.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase(),
    };
}

function validate(values: CustomerProfileValues): FieldErrors {
    const errors: FieldErrors = {};
    const email = values.email.trim();
    if (!email) errors.email = 'Email is required.';
    else if (!emailPattern.test(email)) errors.email = 'Enter a valid email address.';
    if (values.country && !/^[A-Z]{2}$/.test(values.country)) {
        errors.country = 'Country code must be two letters.';
    }
    if (values.abn && !isValidAbn(values.abn)) {
        errors.abn = 'ABN must be 11 digits with a valid checksum.';
    }
    return errors;
}

export function EditCustomerProfileModal({ isOpen, initialValues, isSaving, error, onClose, onSave }: Props) {
    const normalizedInitialValues = normalizeForEditing(initialValues);
    const [values, setValues] = useState(normalizedInitialValues);
    const [baseline, setBaseline] = useState(normalizedInitialValues);
    const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
    const [submitted, setSubmitted] = useState(false);
    const wasOpen = useRef(false);

    useEffect(() => {
        if (isOpen && !wasOpen.current) {
            const nextValues = normalizeForEditing(initialValues);
            setValues(nextValues);
            setBaseline(nextValues);
            setTouched({});
            setSubmitted(false);
        }
        wasOpen.current = isOpen;
    }, [isOpen, initialValues]);

    const errors = validate(values);
    const isDirty = (Object.keys(values) as FieldName[]).some(name => values[name] !== baseline[name]);

    const requestClose = () => {
        if (isSaving) return;
        if (isDirty && !window.confirm('Discard your unsaved contact profile changes?')) return;
        onClose();
    };

    const updateField = (name: FieldName, value: string) => {
        let nextValue = value;
        if (name === 'country') nextValue = value.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
        if (name === 'abn') nextValue = formatAbn(value);
        setValues(current => ({ ...current, [name]: nextValue }));
    };

    const field = (
        name: FieldName,
        label: string,
        options?: {
            required?: boolean;
            span?: boolean;
            maxLength?: number;
            type?: 'text' | 'email' | 'tel';
            autoComplete?: string;
            inputMode?: 'text' | 'email' | 'tel' | 'numeric';
            initialFocus?: boolean;
        },
    ) => {
        const fieldError = errors[name];
        const showError = Boolean(fieldError && (touched[name] || submitted));
        const inputId = `customer-profile-${name}`;
        const errorId = `${inputId}-error`;
        return (
            <label htmlFor={inputId} className={options?.span ? 'sm:col-span-2' : ''}>
                <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
                <input
                    id={inputId}
                    name={name}
                    type={options?.type ?? 'text'}
                    autoComplete={options?.autoComplete}
                    inputMode={options?.inputMode}
                    data-modal-initial-focus={options?.initialFocus ? '' : undefined}
                    value={values[name]}
                    required={options?.required}
                    maxLength={options?.maxLength}
                    aria-invalid={showError || undefined}
                    aria-describedby={showError ? errorId : undefined}
                    onBlur={() => setTouched(current => ({ ...current, [name]: true }))}
                    onChange={event => updateField(name, event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {showError && <span id={errorId} className="mt-1 block text-sm text-red-700">{fieldError}</span>}
            </label>
        );
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setSubmitted(true);
        const firstInvalidField = (Object.keys(errors) as FieldName[])[0];
        if (firstInvalidField) {
            document.getElementById(`customer-profile-${firstInvalidField}`)?.focus();
            return;
        }
        if (!isDirty || isSaving) return;

        await onSave({
            ...values,
            email: values.email.trim(),
            abn: values.abn.replace(/\s/g, ''),
            country: values.country.toUpperCase(),
        });
    };

    const visibleValidationErrors = (Object.keys(errors) as FieldName[])
        .filter(name => touched[name] || submitted)
        .map(name => errors[name]);

    return (
        <Modal isOpen={isOpen} onClose={isSaving ? undefined : requestClose} title="Edit Contact Profile" maxWidth="max-w-2xl">
            <form onSubmit={submit} noValidate className="space-y-5">
                <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-slate-900">Identity</legend>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {field('firstName', 'First name', { autoComplete: 'given-name', initialFocus: true })}
                        {field('lastName', 'Last name', { autoComplete: 'family-name' })}
                        {field('email', 'Email', { required: true, span: true, type: 'email', autoComplete: 'email', inputMode: 'email' })}
                        {field('phone', 'Phone', { span: true, type: 'tel', autoComplete: 'tel', inputMode: 'tel' })}
                    </div>
                </fieldset>

                <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-slate-900">Business</legend>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {field('company', 'Company name', { autoComplete: 'organization' })}
                        {field('abn', 'ABN', { maxLength: 14, inputMode: 'numeric' })}
                    </div>
                </fieldset>

                <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-slate-900">Billing address</legend>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {field('address1', 'Address line 1', { span: true, autoComplete: 'address-line1' })}
                        {field('address2', 'Address line 2', { span: true, autoComplete: 'address-line2' })}
                        {field('city', 'City / suburb', { autoComplete: 'address-level2' })}
                        {field('state', 'State', { autoComplete: 'address-level1' })}
                        {field('postcode', 'Postcode', { autoComplete: 'postal-code' })}
                        {field('country', 'Country code', { maxLength: 2, autoComplete: 'country' })}
                    </div>
                </fieldset>

                <div aria-live="assertive" aria-atomic="true">
                    {visibleValidationErrors.length > 0 && (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Please correct the highlighted fields.</p>
                    )}
                    {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                </div>
                <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                    <button type="button" onClick={requestClose} disabled={isSaving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50">Cancel</button>
                    <button type="submit" disabled={isSaving || !isDirty} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save profile'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
