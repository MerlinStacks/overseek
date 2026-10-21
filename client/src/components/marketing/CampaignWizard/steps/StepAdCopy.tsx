import { useState } from 'react';
import { type WizardStepProps, MAX_HEADLINE_LENGTH, MAX_DESCRIPTION_LENGTH, MIN_HEADLINES, MIN_DESCRIPTIONS, MAX_HEADLINES, MAX_DESCRIPTIONS } from '../types';

const filled = (values: string[], minimum: number) => Array.from({ length: Math.max(minimum, values.length) }, (_, index) => values[index] ?? '');
/** Manual copy with optional, explicitly labelled starter templates. No simulated AI. */
export function StepAdCopy({ draft, setDraft }: WizardStepProps) {
    const [notice, setNotice] = useState('');
    const headlines = filled(draft.adCopy.headlines, MIN_HEADLINES); const descriptions = filled(draft.adCopy.descriptions, MIN_DESCRIPTIONS);
    const insertTemplate = () => {
        if ([...draft.adCopy.headlines, ...draft.adCopy.descriptions].some(value => value.trim()) && !confirm('Replace the current headlines and descriptions with starter templates? Your destination URL will be kept.')) return;
        const productName = draft.selectedProducts[0]?.name.trim() || 'Product';
        const copySnapshot = JSON.stringify(draft.adCopy); const productSnapshot = JSON.stringify(draft.selectedProducts.map(product => [product.id, product.name]));
        const short = productName.slice(0, MAX_HEADLINE_LENGTH - 'Product Details: '.length).trim();
        const generated = {
            headlines: [`View ${short}`, `Explore ${short}`, `Product Details: ${short}`],
            descriptions: [`View product information for ${productName}.`.slice(0, MAX_DESCRIPTION_LENGTH), `Read the product details before choosing ${productName}.`.slice(0, MAX_DESCRIPTION_LENGTH)],
        };
        setDraft(current => {
            if (JSON.stringify(current.adCopy) !== copySnapshot || JSON.stringify(current.selectedProducts.map(product => [product.id, product.name])) !== productSnapshot) return current;
            return { ...current, adCopy: { ...current.adCopy, ...generated } };
        });
        setNotice('Starter templates inserted. Review accuracy and enter the real landing-page URL before launching.');
    };
    const update = (kind: 'headlines' | 'descriptions', index: number, value: string) => {
        setDraft(current => {
            const values = filled(current.adCopy[kind], kind === 'headlines' ? MIN_HEADLINES : MIN_DESCRIPTIONS);
            values[index] = value;
            return { ...current, adCopy: { ...current.adCopy, [kind]: values } };
        });
    };
    const add = (kind: 'headlines' | 'descriptions') => setDraft(current => {
        const values = filled(current.adCopy[kind], kind === 'headlines' ? MIN_HEADLINES : MIN_DESCRIPTIONS);
        if (values.length >= (kind === 'headlines' ? MAX_HEADLINES : MAX_DESCRIPTIONS)) return current;
        return { ...current, adCopy: { ...current.adCopy, [kind]: [...values, ''] } };
    });
    const remove = (kind: 'headlines' | 'descriptions', index: number) => setDraft(current => {
        const minimum = kind === 'headlines' ? MIN_HEADLINES : MIN_DESCRIPTIONS; const values = filled(current.adCopy[kind], minimum);
        if (values.length <= minimum) return current;
        return { ...current, adCopy: { ...current.adCopy, [kind]: values.filter((_, currentIndex) => currentIndex !== index) } };
    });
    let destination: URL | null = null;
    try { const url = new URL(draft.adCopy.finalUrl.trim()); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) destination = url; } catch { /* A missing destination must not become example.com. */ }
    const inputClass = 'block w-full p-2 border rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100';
    return <section aria-label="Campaign ad copy" className="space-y-6 text-slate-900 dark:text-slate-100">
        <h3 className="text-2xl font-bold">Review Ad Copy</h3><p>Write your ad copy manually, or insert starter templates based on the selected product name. Templates are not AI-generated and make no shipping, discount or quality claims.</p>
        <button type="button" onClick={insertTemplate} className="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">Insert starter templates</button>
        {notice && <p role="status">{notice}</p>}
        <section aria-label="Ad preview" className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-2">
            <p className="text-xs">Ad preview · {destination ? `${destination.host}${destination.pathname}${destination.search}` : 'Enter a valid destination URL'}</p>
            <p className="text-lg text-indigo-700 dark:text-indigo-300">{headlines.filter(value => value.trim()).slice(0, 2).join(' | ') || 'Your headlines will appear here'}</p><p>{descriptions[0] || 'Your description will appear here'}</p>
        </section>
        {(['headlines', 'descriptions'] as const).map(kind => {
            const values = kind === 'headlines' ? headlines : descriptions; const minimum = kind === 'headlines' ? MIN_HEADLINES : MIN_DESCRIPTIONS;
            const maximum = kind === 'headlines' ? MAX_HEADLINES : MAX_DESCRIPTIONS; const length = kind === 'headlines' ? MAX_HEADLINE_LENGTH : MAX_DESCRIPTION_LENGTH;
            return <fieldset key={kind} className="space-y-3"><legend className="font-semibold capitalize">{kind} (Min {minimum}, Max {maximum})</legend>{values.map((value, index) => <div key={index}>
                <label className="text-sm">{kind === 'headlines' ? 'Headline' : 'Description'} {index + 1}{kind === 'headlines' ? <input className={inputClass} value={value} maxLength={length} onChange={event => update(kind, index, event.target.value)} /> : <textarea className={inputClass} value={value} maxLength={length} rows={2} onChange={event => update(kind, index, event.target.value)} />}</label>
                <p className={value.length > length ? 'text-xs text-red-600 dark:text-red-400' : 'text-xs text-slate-500 dark:text-slate-400'}>{value.length}/{length}{value.length > length ? ' · Too long' : ''}</p>
                {values.length > minimum && <button type="button" aria-label={`Remove ${kind === 'headlines' ? 'headline' : 'description'} ${index + 1}`} onClick={() => remove(kind, index)}>Remove</button>}
            </div>)}{values.length < maximum && <button type="button" onClick={() => add(kind)}>+ Add {kind === 'headlines' ? 'Headline' : 'Description'}</button>}</fieldset>;
        })}
        <label className="block font-semibold">Final URL<input type="url" className={inputClass} value={draft.adCopy.finalUrl} placeholder="Enter the actual product or landing-page URL" onChange={event => setDraft(current => ({ ...current, adCopy: { ...current.adCopy, finalUrl: event.target.value } }))} /></label>
        {!destination && <p role="status">A valid HTTP or HTTPS landing-page URL is required before launch.</p>}
    </section>;
}
