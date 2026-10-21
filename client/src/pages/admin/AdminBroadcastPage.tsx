import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { abortable } from '../../utils/abortable';
import { Send, CheckCircle, Bell } from 'lucide-react';

export function AdminBroadcastPage() {
    const { token, user } = useAuth();
    if (!token || !user?.isSuperAdmin) return <p role="status">Sign in as a super admin to send broadcasts.</p>;
    return <BroadcastForm key={JSON.stringify([token, user.id])} token={token} />;
}
function BroadcastForm({ token }: { token: string }) {
    const [formData, setFormData] = useState({
        title: '',
        message: '',
        type: 'INFO',
        link: '',
        sendPush: false
    });
    const mutation = useScopedMutation();
    const sending = mutation.busy;
    const [validation, setValidation] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (mutation.isPending()) return;
        const submitted = { ...formData, title: formData.title.trim(), message: formData.message.trim(), link: formData.link.trim() };
        const validLink = !submitted.link || (/^\/(?![\\/])[^\\\s]*$/.test(submitted.link)) || (() => { try { const url = new URL(submitted.link); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } })();
        if (!submitted.title || !submitted.message || !['INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(submitted.type) || !validLink) { setValidation('Enter a title, message, valid type and an optional app path or HTTP(S) link.'); return; }
        setValidation('');
        if (!confirm(`Send “${submitted.title}” to ALL active accounts${submitted.sendPush ? ' and subscribed push devices' : ''}?`)) return;
        setSuccessMsg('');

        const result = await mutation.run(async signal => {
            const res = await abortable(fetch('/api/admin/broadcast', {
                method: 'POST',
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(submitted)
            }), signal);

            if (res.ok) {
                const data: unknown = await abortable(res.json(), signal);
                if (!isRecord(data) || data.success !== true || !['count', 'pushSent', 'pushFailed'].every(key => typeof data[key] === 'number' && Number.isSafeInteger(data[key]) && (data[key] as number) >= 0)) throw new Error('Invalid broadcast confirmation');
                let msg = `Successfully sent to ${data.count} accounts.`;
                if (submitted.sendPush) {
                    msg += ` Push: ${data.pushSent} sent, ${data.pushFailed} failed.`;
                }
                return msg;
            } else {
                throw new Error('Broadcast failed');
            }
        }, 'Could not confirm the broadcast outcome. It may have been sent. Check delivery before retrying; your draft is retained.');
        if (result.ok) { setSuccessMsg(result.value); setFormData({ title: '', message: '', type: 'INFO', link: '', sendPush: false }); }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Global Broadcast</h1>
            <p className="text-slate-500">Send a notification to ALL active accounts system-wide.</p>

            {successMsg && (
                <div role="status" className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-2">
                    <CheckCircle size={20} /> {successMsg}
                </div>
            )}

            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
                {(validation || mutation.error) && <p role="alert" className="text-red-600">{validation || mutation.error}</p>}
                {sending && <p role="status">Sending broadcast...</p>}
                <fieldset disabled={sending} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                    <input aria-label="Title"
                        type="text"
                        required
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g. Scheduled Maintenance"
                        value={formData.title}
                        onChange={e => setFormData({ ...formData, title: e.target.value })}
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                    <textarea aria-label="Message"
                        required
                        rows={4}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        placeholder="Details about the update..."
                        value={formData.message}
                        onChange={e => setFormData({ ...formData, message: e.target.value })}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                        <select aria-label="Type"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={formData.type}
                            onChange={e => setFormData({ ...formData, type: e.target.value })}
                        >
                            <option value="INFO">Info (Blue)</option>
                            <option value="SUCCESS">Success (Green)</option>
                            <option value="WARNING">Warning (Yellow)</option>
                            <option value="ERROR">Error (Red)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Link (Optional)</label>
                        <input aria-label="Link (Optional)"
                            type="text"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="/settings or https://..."
                            value={formData.link}
                            onChange={e => setFormData({ ...formData, link: e.target.value })}
                        />
                    </div>
                </div>

                {/* Push Notification Toggle */}
                <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                    <input
                        type="checkbox"
                        id="sendPush"
                        checked={formData.sendPush}
                        onChange={e => setFormData({ ...formData, sendPush: e.target.checked })}
                        className="w-5 h-5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="sendPush" className="flex items-center gap-2 cursor-pointer">
                        <Bell size={18} className="text-indigo-600" />
                        <div>
                            <p className="font-medium text-slate-800">Send Push Notification</p>
                            <p className="text-sm text-slate-500">Also send as a push notification to all subscribed devices</p>
                        </div>
                    </label>
                </div>

                <div className="pt-4">
                    <button
                        type="submit"
                        disabled={sending}
                        className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {sending ? 'Sending...' : <><Send size={18} /> Send Broadcast</>}
                    </button>
                </div>
                </fieldset>
            </form>
        </div>
    );
}
