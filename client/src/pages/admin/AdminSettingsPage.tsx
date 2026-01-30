import { useEffect, useState, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { Settings, Upload, Check, AlertCircle, Loader2, Globe, HardDrive, RefreshCw, UserPlus, ToggleLeft, ToggleRight } from 'lucide-react';

interface DatabaseInfo {
    source: 'manual' | 'auto';
    installed: boolean;
    size: number;
    sizeFormatted: string;
    buildDate: string;
    type: string;
}

interface GeoIPStatus {
    databases: DatabaseInfo[];
}

interface PlatformSettings {
    registrationEnabled: boolean;
    updatedAt: string;
}

/**
 * Super Admin settings page for system configuration.
 * Currently includes GeoIP database management.
 */
export function AdminSettingsPage() {
    const { token } = useAuth();
    const [status, setStatus] = useState<GeoIPStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [forcingUpdate, setForcingUpdate] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Platform settings state
    const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
    const [togglingRegistration, setTogglingRegistration] = useState(false);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/admin/geoip-status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch (e) {
            Logger.error('Failed to fetch GeoIP status:', { error: e });
        } finally {
            setLoading(false);
        }
    };

    const fetchPlatformSettings = async () => {
        try {
            const res = await fetch('/api/admin/platform-settings', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setPlatformSettings(data);
            }
        } catch (e) {
            Logger.error('Failed to fetch platform settings:', { error: e });
        }
    };

    const handleToggleRegistration = async () => {
        if (!platformSettings) return;

        setTogglingRegistration(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/platform-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    registrationEnabled: !platformSettings.registrationEnabled
                })
            });
            const data = await res.json();
            if (res.ok) {
                setPlatformSettings(data);
                setMessage({
                    type: 'success',
                    text: data.registrationEnabled
                        ? 'New user registrations enabled'
                        : 'New user registrations disabled'
                });
            } else {
                setMessage({ type: 'error', text: data.error || 'Failed to update settings' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Network request failed' });
        } finally {
            setTogglingRegistration(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchPlatformSettings();
    }, [token]);

    const handleForceUpdate = async () => {
        setForcingUpdate(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/geoip-force-update', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: 'Auto-update completed successfully.' });
                fetchStatus();
            } else {
                setMessage({ type: 'error', text: data.error || 'Update failed' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Network request failed' });
        } finally {
            setForcingUpdate(false);
        }
    };

    const handleUpload = async (file: File) => {
        if (!file.name.endsWith('.mmdb')) {
            setMessage({ type: 'error', text: 'Only .mmdb files are accepted' });
            return;
        }

        setUploading(true);
        setUploadProgress(0);
        setMessage(null);

        const formData = new FormData();
        formData.append('database', file);

        try {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    setUploadProgress(Math.round((e.loaded / e.total) * 100));
                }
            });

            await new Promise<void>((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        const data = JSON.parse(xhr.responseText);
                        setMessage({ type: 'success', text: data.message || 'Database uploaded successfully!' });
                        fetchStatus();
                        resolve();
                    } else {
                        const error = JSON.parse(xhr.responseText);
                        reject(new Error(error.error || 'Upload failed'));
                    }
                };
                xhr.onerror = () => reject(new Error('Network error'));

                xhr.open('POST', '/api/admin/upload-geoip-db');
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.send(formData);
            });
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || 'Upload failed' });
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleUpload(file);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) {
            handleUpload(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = () => {
        setDragOver(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        );
    }

    const manualDB = status?.databases.find(d => d.source === 'manual');
    const autoDB = status?.databases.find(d => d.source === 'auto');

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                <Settings size={28} />
                System Settings
            </h1>

            {/* Platform Settings Section */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                    <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <UserPlus size={20} className="text-purple-600" />
                        User Registration
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Control whether new users can register accounts on the platform.
                    </p>
                </div>

                <div className="p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-slate-800">Allow New Registrations</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                {platformSettings?.registrationEnabled
                                    ? 'New users can create accounts'
                                    : 'Only existing users can access the platform'}
                            </p>
                        </div>
                        <button
                            onClick={handleToggleRegistration}
                            disabled={togglingRegistration || !platformSettings}
                            className={`
                                relative inline-flex h-8 w-14 items-center rounded-full transition-colors
                                ${platformSettings?.registrationEnabled
                                    ? 'bg-emerald-500 hover:bg-emerald-600'
                                    : 'bg-slate-300 hover:bg-slate-400'}
                                ${togglingRegistration ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                            `}
                        >
                            {togglingRegistration ? (
                                <Loader2 className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" size={16} />
                            ) : (
                                <span
                                    className={`
                                        inline-block h-6 w-6 transform rounded-full bg-white shadow-sm transition-transform
                                        ${platformSettings?.registrationEnabled ? 'translate-x-7' : 'translate-x-1'}
                                    `}
                                />
                            )}
                        </button>
                    </div>

                    {platformSettings && !platformSettings.registrationEnabled && (
                        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                            <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
                            <div className="text-sm text-amber-800">
                                <strong>Registration is disabled.</strong> New users will not be able to create accounts.
                                Existing users and team members added manually can still log in.
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* GeoIP Database Section */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                            <Globe size={20} className="text-blue-600" />
                            GeoIP Databases
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            Manage IP geolocation providers. The system automatically uses the newest database.
                        </p>
                    </div>
                    <button
                        onClick={fetchStatus}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                        title="Refresh status"
                    >
                        <RefreshCw size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Auto DB Card */}
                    <div className="border border-slate-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                                    DB-IP Lite (Auto-Update)
                                    {autoDB?.installed && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Automated</span>}
                                </h3>
                                <p className="text-sm text-slate-500">Automatically fetches monthly updates from db-ip.com</p>
                            </div>
                            <button
                                onClick={handleForceUpdate}
                                disabled={forcingUpdate}
                                className="text-sm border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
                            >
                                {forcingUpdate ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                Force Update
                            </button>
                        </div>

                        {autoDB ? (
                            <div className="bg-slate-50 rounded-md p-3 flex items-center gap-4">
                                <div className="p-2 bg-emerald-100 rounded-full">
                                    <Check className="text-emerald-600" size={16} />
                                </div>
                                <div className="text-sm text-slate-600">
                                    <p className="font-medium text-slate-900">Installed</p>
                                    <p>Build Date: {new Date(autoDB.buildDate).toLocaleDateString()}</p>
                                    <p>Size: {autoDB.sizeFormatted}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-amber-50 rounded-md p-3 flex items-center gap-4 text-amber-800">
                                <AlertCircle size={20} />
                                <span className="text-sm">Not installed yet. Will fetch automatically or click Force Update.</span>
                            </div>
                        )}
                    </div>

                    {/* Manual DB Card */}
                    <div className="border border-slate-200 rounded-lg p-4">
                        <div className="mb-4">
                            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                                MaxMind GeoLite2 (Manual)
                                {manualDB?.installed && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Uploaded</span>}
                            </h3>
                            <p className="text-sm text-slate-500">Manually uploaded .mmdb file</p>
                        </div>

                        {manualDB ? (
                            <div className="bg-slate-50 rounded-md p-3 flex items-center gap-4 mb-4">
                                <div className="p-2 bg-emerald-100 rounded-full">
                                    <Check className="text-emerald-600" size={16} />
                                </div>
                                <div className="text-sm text-slate-600">
                                    <p className="font-medium text-slate-900">Installed</p>
                                    <p>Build Date: {new Date(manualDB.buildDate).toLocaleDateString()}</p>
                                    <p>Size: {manualDB.sizeFormatted}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-50 rounded-md p-3 flex items-center gap-4 mb-4 text-slate-500">
                                <div className="p-2 bg-slate-200 rounded-full">
                                    <HardDrive className="text-slate-500" size={16} />
                                </div>
                                <span className="text-sm">No custom database uploaded.</span>
                            </div>
                        )}

                        {/* Upload Dropzone */}
                        <div
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                            className={`
                                border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
                                ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}
                                ${uploading ? 'pointer-events-none opacity-60' : ''}
                            `}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".mmdb"
                                onChange={handleFileSelect}
                                className="hidden"
                            />

                            {uploading ? (
                                <div className="space-y-2">
                                    <Loader2 className="animate-spin mx-auto text-blue-600" size={24} />
                                    <p className="text-sm text-slate-600">Uploading... {uploadProgress}%</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2">
                                    <Upload className="text-slate-400" size={24} />
                                    <p className="text-sm font-medium text-slate-600">
                                        {manualDB ? 'Replace Manual Database' : 'Upload Manual Database'}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Drag & drop .mmdb file
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Message */}
                    {message && (
                        <div className={`p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                            {message.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
                            {message.text}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
