import { useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { Send, AlertTriangle, CheckCircle, Info, MessageSquare, Bell } from 'lucide-react';

export function AdminBroadcastPage() {
    const { token } = useAuth();
    const [formData, setFormData] = useState({
        title: '',
        message: '',
        type: 'INFO',
        link: '',
        sendPush: false
    });
    const [sending, setSending] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSending(true);
        setSuccessMsg('');

        try {
            const res = await fetch('/api/admin/broadcast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                const data = await res.json();
                let msg = `Successfully sent to ${data.count} accounts.`;
                if (formData.sendPush) {
                    msg += ` Push: ${data.pushSent} sent, ${data.pushFailed} failed.`;
                }
                setSuccessMsg(msg);
                setFormData({ title: '', message: '', type: 'INFO', link: '', sendPush: false });
            } else {
                alert('Failed to send broadcast');
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            alert('Error sending broadcast');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Global Broadcast</h1>
            <p className="text-slate-500">Send a notification to ALL active accounts system-wide.</p>

            {successMsg && (
                <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-2">
                    <CheckCircle size={20} /> {successMsg}
                </div>
            )}

            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                    <input
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
                    <textarea
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
                        <select
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
                        <input
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
            </form>
        </div>
    );
}
