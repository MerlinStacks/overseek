import { useId, useState, type FormEvent } from 'react';

export const UrlBuilder = () => {
    const [fields, setFields] = useState({ url: '', source: '', medium: '', name: '' });
    const [generated, setGenerated] = useState('');
    const [error, setError] = useState('');
    const id = useId();

    const generate = (event: FormEvent) => {
        event.preventDefault();
        setGenerated('');
        if (Object.values(fields).some(value => !value.trim())) {
            setError('Website URL, campaign source, medium, and name are required.');
            return;
        }
        try {
            const url = new URL(fields.url.trim());
            if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Invalid URL');
            url.searchParams.set('utm_source', fields.source.trim());
            url.searchParams.set('utm_medium', fields.medium.trim());
            url.searchParams.set('utm_campaign', fields.name.trim());
            setGenerated(url.toString());
            setError('');
        } catch {
            setError('Enter a valid HTTP or HTTPS website URL without credentials.');
        }
    };

    return (
        <section className="bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 p-6 rounded-xl shadow-xs border border-gray-200 dark:border-slate-700 max-w-2xl">
            <h3 className="text-lg font-bold mb-6">Campaign URL Builder</h3>
            <form noValidate onSubmit={generate} className="space-y-4" aria-describedby={error ? `${id}-error` : undefined}>
                {([
                    ['url', 'Website URL', 'https://example.com'],
                    ['source', 'Campaign Source', 'google, newsletter'],
                    ['medium', 'Campaign Medium', 'cpc, email'],
                    ['name', 'Campaign Name', 'summer_sale'],
                ] as const).map(([key, label, placeholder]) => (
                    <div key={key}>
                        <label htmlFor={`${id}-${key}`} className="block text-sm font-medium mb-1">{label} *</label>
                        <input id={`${id}-${key}`} type={key === 'url' ? 'url' : 'text'} required value={fields[key]} placeholder={placeholder}
                            onChange={event => {
                                setFields(previous => ({ ...previous, [key]: event.target.value }));
                                setGenerated(''); setError('');
                            }}
                            className="w-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-lg px-3 py-2" />
                    </div>
                ))}
                {error && <p id={`${id}-error`} role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
                <button type="submit" className="bg-[var(--primary-color)] text-[var(--primary-foreground)] px-4 py-2 rounded-lg font-medium hover:bg-[var(--primary-hover)] focus-visible:outline-[var(--focus-color)]">Generate URL</button>
                {generated && (
                    <div role="status" className="mt-6 p-4 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2">Generated URL</p>
                        <div className="break-all font-mono text-sm select-all">{generated}</div>
                    </div>
                )}
            </form>
        </section>
    );
};
