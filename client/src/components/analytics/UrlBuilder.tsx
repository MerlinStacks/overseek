import { useState } from 'react';

export const UrlBuilder = () => {
    const [url, setUrl] = useState('');
    const [source, setSource] = useState('');
    const [medium, setMedium] = useState('');
    const [name, setName] = useState('');
    const [generated, setGenerated] = useState('');

    const generate = () => {
        try {
            const u = new URL(url);
            if (source) u.searchParams.set('utm_source', source);
            if (medium) u.searchParams.set('utm_medium', medium);
            if (name) u.searchParams.set('utm_campaign', name);
            setGenerated(u.toString());
        } catch {
            alert('Invalid Website URL');
        }
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200 max-w-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Campaign URL Builder</h3>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Website URL *</label>
                    <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Source *</label>
                        <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="google, newsletter" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Medium *</label>
                        <input type="text" value={medium} onChange={e => setMedium(e.target.value)} placeholder="cpc, email" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name *</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="summer_sale" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                </div>
                <button onClick={generate} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">Generate URL</button>

                {generated && (
                    <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Generated URL</label>
                        <div className="break-all font-mono text-sm bg-white p-3 rounded-sm border border-gray-200 select-all">{generated}</div>
                    </div>
                )}
            </div>
        </div>
    );
};
