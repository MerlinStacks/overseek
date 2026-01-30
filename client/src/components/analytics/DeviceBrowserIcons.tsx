/**
 * DeviceBrowserIcon - Displays browser and OS icons for visitor sessions
 * 
 * Shows recognizable icons for common browsers (Chrome, Firefox, Safari, Edge)
 * and operating systems (Windows, macOS, iOS, Android, Linux).
 */
import * as React from 'react';
import { Monitor, Smartphone, Tablet, Globe, Apple } from 'lucide-react';

/** Browser icon mapping - returns inline SVG for brand recognition */
export function getBrowserIcon(browser?: string | null): React.ReactNode {
    if (!browser) return <Globe className="w-3.5 h-3.5 text-gray-400" />;

    const b = browser.toLowerCase();

    // Chrome
    if (b.includes('chrome') && !b.includes('edge')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#4285F4" />
                <circle cx="12" cy="12" r="4" fill="white" />
                <path d="M12 8L21.5 12L12 16" fill="#34A853" />
                <path d="M12 8L2.5 12L12 16" fill="#EA4335" />
                <path d="M12 16L16 21.5L8 21.5" fill="#FBBC05" />
            </svg>
        );
    }

    // Firefox
    if (b.includes('firefox')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#FF7139" />
                <path d="M7 8c1-2 4-3 5-3s4 1 5 4c.5 2-.5 5-2 6s-4 2-6 1-3-3-3-5 .5-2 1-3z" fill="#FFE900" />
            </svg>
        );
    }

    // Safari
    if (b.includes('safari') && !b.includes('chrome')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#006CFF" />
                <polygon points="12,4 14,11 12,12 10,11" fill="white" />
                <polygon points="12,20 10,13 12,12 14,13" fill="#FF3B30" />
            </svg>
        );
    }

    // Edge
    if (b.includes('edge')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#0078D4" />
                <path d="M8 15c1 2 4 3 6 2s3-3 3-5-2-4-5-4-5 2-5 5c0 1 .5 2 1 2z" fill="#50E6FF" />
            </svg>
        );
    }

    // Samsung Internet
    if (b.includes('samsung')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#1428A0" />
                <circle cx="12" cy="12" r="5" fill="white" />
            </svg>
        );
    }

    // Opera
    if (b.includes('opera')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="#FF1B2D" />
                <ellipse cx="12" cy="12" rx="4" ry="6" fill="white" />
            </svg>
        );
    }

    // Default browser icon
    return <Globe className="w-3.5 h-3.5 text-gray-400" />;
}

/** OS icon mapping */
export function getOSIcon(os?: string | null): React.ReactNode {
    if (!os) return null;

    const o = os.toLowerCase();

    // iOS
    if (o.includes('ios') || o.includes('iphone') || o.includes('ipad')) {
        return <Apple className="w-3.5 h-3.5 text-gray-600" />;
    }

    // macOS
    if (o.includes('mac')) {
        return <Apple className="w-3.5 h-3.5 text-gray-600" />;
    }

    // Windows
    if (o.includes('windows')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#00A4EF" d="M3 12.5V6.2l8-1.1v7.4H3zm9-1.1V4l9-1.2v9.7h-9v-.1zM3 13.5h8v7.4l-8-1.1V13.5zm9 0h9v8.5l-9-1.2v-7.3z" />
            </svg>
        );
    }

    // Android
    if (o.includes('android')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#3DDC84" d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0012 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.983 5.983 0 006 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z" />
            </svg>
        );
    }

    // Linux
    if (o.includes('linux') || o.includes('ubuntu')) {
        return (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#333" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1-7c0 1.5-1 2.5-2 3v1h-4v-1c-1-.5-2-1.5-2-3 0-2.21 1.79-4 4-4s4 1.79 4 4z" />
            </svg>
        );
    }

    return null;
}

/** Device type icon */
export function getDeviceIcon(deviceType?: string | null): React.ReactNode {
    if (!deviceType) return <Monitor className="w-3.5 h-3.5 text-gray-400" />;

    const d = deviceType.toLowerCase();

    if (d === 'mobile') {
        return <Smartphone className="w-3.5 h-3.5 text-gray-500" />;
    }
    if (d === 'tablet') {
        return <Tablet className="w-3.5 h-3.5 text-gray-500" />;
    }

    return <Monitor className="w-3.5 h-3.5 text-gray-500" />;
}

interface DeviceBrowserBadgeProps {
    browser?: string | null;
    os?: string | null;
    deviceType?: string | null;
    showLabel?: boolean;
}

/**
 * Combined badge showing device, browser, and OS icons
 * Compact display suitable for tables and lists
 */
export const DeviceBrowserBadge: React.FC<DeviceBrowserBadgeProps> = ({
    browser,
    os,
    deviceType,
    showLabel = false
}) => {
    return (
        <div className="flex items-center gap-1" title={`${browser || 'Unknown'} on ${os || 'Unknown'}`}>
            {getDeviceIcon(deviceType)}
            {getBrowserIcon(browser)}
            {getOSIcon(os)}
            {showLabel && (
                <span className="text-xs text-gray-500 ml-1 truncate max-w-[80px]">
                    {os || 'Unknown'}
                </span>
            )}
        </div>
    );
};

export default DeviceBrowserBadge;
