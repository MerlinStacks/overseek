import { useCallback, useState } from 'react';
import { Logger } from '../utils/logger';

/**
 * Web Share data structure (Level 2 with file support)
 */
interface ShareData {
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
}

/**
 * Hook for Web Share API Level 2 (with file sharing)
 *
 * Enables sharing files and content to native apps on mobile devices.
 *
 * @example
 * ```tsx
 * const { shareData, shareFiles, isSupported, canShareFiles } = useWebShare();
 *
 * // Share text/URL
 * await shareData({ title: 'Report', text: 'Check out this report', url: 'https://...' });
 *
 * // Share files (Level 2)
 * const file = new File([blob], 'report.pdf', { type: 'application/pdf' });
 * await shareFiles([file], { title: 'Monthly Report' });
 * ```
 */
export function useWebShare() {
    const [isSharing, setIsSharing] = useState(false);
    const [isSupported] = useState(() => 'share' in navigator);
    const [canShareFiles] = useState(() => 'canShare' in navigator);

    /**
     * Checks if the given data can be shared on this device.
     */
    const canShare = useCallback((data: ShareData): boolean => {
        if (!('canShare' in navigator)) {
            return 'share' in navigator;
        }

        try {
            return navigator.canShare(data);
        } catch {
            return false;
        }
    }, []);

    /**
     * Shares data (text, URL) using the native share dialog.
     */
    const shareData = useCallback(async (data: Omit<ShareData, 'files'>): Promise<boolean> => {
        if (!('share' in navigator)) {
            Logger.warn('[WebShare] Share API not supported');
            return false;
        }

        setIsSharing(true);
        try {
            await navigator.share(data);
            Logger.debug('[WebShare] Shared successfully:', { title: data.title });
            return true;
        } catch (err) {
            // User cancelled or share failed
            if ((err as Error).name !== 'AbortError') {
                Logger.warn('[WebShare] Share failed:', { error: err });
            }
            return false;
        } finally {
            setIsSharing(false);
        }
    }, []);

    /**
     * Shares files with optional title/text using Web Share Level 2.
     * Provides fallback to download if sharing is not supported.
     */
    const shareFiles = useCallback(async (
        files: File[],
        options?: { title?: string; text?: string }
    ): Promise<boolean> => {
        const sharePayload: ShareData = {
            files,
            title: options?.title,
            text: options?.text
        };

        // Check if we can share files
        if (!canShare(sharePayload)) {
            Logger.warn('[WebShare] Cannot share files, falling back to download');
            // Fallback: trigger download for first file
            if (files.length > 0) {
                const url = URL.createObjectURL(files[0]);
                const a = document.createElement('a');
                a.href = url;
                a.download = files[0].name;
                a.click();
                URL.revokeObjectURL(url);
                return true;
            }
            return false;
        }

        setIsSharing(true);
        try {
            await navigator.share(sharePayload as ShareData);
            Logger.debug('[WebShare] Files shared successfully:', { count: files.length });
            return true;
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                Logger.warn('[WebShare] File share failed:', { error: err });
            }
            return false;
        } finally {
            setIsSharing(false);
        }
    }, [canShare]);

    return {
        shareData,
        shareFiles,
        canShare,
        isSupported,
        canShareFiles,
        isSharing
    };
}
