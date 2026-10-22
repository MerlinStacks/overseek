/** Tracking links are navigation, not authority to fetch a provider on the server. */
export function approvedTrackingUrl(value: string | null | undefined): string | null {
    try {
        const url = new URL(value ?? '');
        return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ['auspost.com.au', 'myparceldelivery.com.au'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
    } catch { return null; }
}
