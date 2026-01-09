import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Settings, Upload, Check, AlertCircle, Loader2, Globe, HardDrive, Calendar, RefreshCw } from 'lucide-react';

interface GeoIPStatus {
    installed: boolean;
    stats: {
        size: number;
        sizeFormatted: string;
        lastModified: string;
    } | null;
}

/**
 * Super Admin settings page for system configuration.
 * Currently includes GeoIP database management.
 */
export function AdminSettingsPage() {
    const { token } = useAuth();
    const [geoipStatus, setGeoipStatus] = useState<GeoIPStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/admin/geoip-status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setGeoipStatus(data);
            }
        } catch (e) {
            console.error('Failed to fetch GeoIP status:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, [token]);

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

    return (
        <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                <Settings size={28} />
                System Settings
            </h1>

            {/* GeoIP Database Section */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                    <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <Globe size={20} className="text-blue-600" />
                        GeoIP Database
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        MaxMind GeoLite2 database for IP geolocation
                    </p>
                </div>

                <div className="p-6">
                    {/* Status Card */}
                    <div className={`rounded-lg p-4 mb-6 ${geoipStatus?.installed ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                        <div className="flex items-start gap-4">
                            <div className={`p-2 rounded-lg ${geoipStatus?.installed ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                {geoipStatus?.installed ? (
                                    <Check className="text-emerald-600" size={24} />
                                ) : (
                                    <AlertCircle className="text-amber-600" size={24} />
                                )}
                            </div>
                            <div className="flex-1">
                                <h3 className={`font-medium ${geoipStatus?.installed ? 'text-emerald-800' : 'text-amber-800'}`}>
                                    {geoipStatus?.installed ? 'Database Installed' : 'Database Not Installed'}
                                </h3>
                                {geoipStatus?.installed && geoipStatus.stats ? (
                                    <div className="mt-2 space-y-1 text-sm text-slate-600">
                                        <p className="flex items-center gap-2">
                                            <HardDrive size={14} />
                                            Size: {geoipStatus.stats.sizeFormatted}
                                        </p>
                                        <p className="flex items-center gap-2">
                                            <Calendar size={14} />
                                            Last updated: {new Date(geoipStatus.stats.lastModified).toLocaleDateString()}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-amber-700 mt-1">
                                        Upload a GeoLite2-City.mmdb file to enable IP geolocation.
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={fetchStatus}
                                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                title="Refresh status"
                            >
                                <RefreshCw size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Upload Area */}
                    <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onClick={() => fileInputRef.current?.click()}
                        className={`
                            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
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
                            <div className="space-y-3">
                                <Loader2 className="animate-spin mx-auto text-blue-600" size={40} />
                                <p className="text-slate-600">Uploading... {uploadProgress}%</p>
                                <div className="w-48 mx-auto h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-600 transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <>
                                <Upload className="mx-auto text-slate-400 mb-3" size={40} />
                                <p className="text-slate-600 font-medium">
                                    {geoipStatus?.installed ? 'Upload New Database' : 'Upload GeoIP Database'}
                                </p>
                                <p className="text-sm text-slate-500 mt-1">
                                    Drag & drop a .mmdb file or click to browse
                                </p>
                                <p className="text-xs text-slate-400 mt-3">
                                    Download from <a href="https://www.maxmind.com/en/geolite2/signup" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>MaxMind (free account required)</a>
                                </p>
                            </>
                        )}
                    </div>

                    {/* Message */}
                    {message && (
                        <div className={`mt-4 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                            {message.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
                            {message.text}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
