/**
 * AdConnectForm
 * 
 * Form component for connecting new ad platforms.
 */
import { Facebook, Lock } from 'lucide-react';

interface AdConnectFormProps {
    platform: string;
    onPlatformChange: (platform: string) => void;
    isMetaEnabled: boolean;
    isGoogleEnabled: boolean;
    onGoogleOAuth: () => void;
    onMetaOAuth: () => void;
}

/**
 * Google icon SVG component.
 */
function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    );
}

export function AdConnectForm({
    platform,
    onPlatformChange,
    isMetaEnabled,
    isGoogleEnabled,
    onGoogleOAuth,
    onMetaOAuth
}: AdConnectFormProps) {
    const isCurrentDisabled = (platform === 'META' && !isMetaEnabled) || (platform === 'GOOGLE' && !isGoogleEnabled);

    return (
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
            <h3 className="font-semibold mb-4">Connect Ad Platform</h3>
            <div className="grid gap-4 max-w-md">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
                    <select
                        className="w-full p-2 border rounded-lg"
                        value={platform}
                        onChange={e => onPlatformChange(e.target.value)}
                    >
                        <option value="META" disabled={!isMetaEnabled}>
                            Meta Ads (Facebook/Instagram) {!isMetaEnabled && '(Disabled by Admin)'}
                        </option>
                        <option value="GOOGLE" disabled={!isGoogleEnabled}>
                            Google Ads {!isGoogleEnabled && '(Disabled by Admin)'}
                        </option>
                    </select>
                    {isCurrentDisabled && (
                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                            <Lock size={12} />
                            This platform is currently disabled for your account.
                        </p>
                    )}
                </div>

                {platform === 'GOOGLE' ? (
                    <div className="space-y-4 relative">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800">
                                Google Ads requires OAuth authentication. Click below to connect securely.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onGoogleOAuth}
                            disabled={!isGoogleEnabled}
                            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <GoogleIcon className="w-5 h-5" />
                            Connect with Google
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4 relative">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800">
                                Meta Ads requires OAuth authentication. Click below to connect securely.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onMetaOAuth}
                            disabled={!isMetaEnabled}
                            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Facebook className="w-5 h-5 text-blue-600" />
                            Connect with Meta
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
