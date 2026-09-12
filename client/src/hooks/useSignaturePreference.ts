import { useCallback, useState } from 'react';

function readPreference(key: string | null): boolean {
    try {
        // Preserve the default for new users, but do not treat stored false as missing.
        return !key || localStorage.getItem(key) !== 'false';
    } catch {
        return true;
    }
}

/** Remember the inbox signature choice per user in this browser. */
export function useSignaturePreference(userId?: string) {
    const key = userId ? `inbox:signatureEnabled:${userId}` : null;
    const [preference, setPreference] = useState(() => ({ key, enabled: readPreference(key) }));

    // Auth can hydrate or change without remounting the composer. Never reuse another user's choice.
    if (preference.key !== key) {
        setPreference({ key, enabled: readPreference(key) });
    }

    const setSignatureEnabled = useCallback((enabled: boolean) => {
        setPreference({ key, enabled });
        try {
            if (key) localStorage.setItem(key, String(enabled));
        } catch {
            // Storage may be blocked; the toggle must still work for this mounted composer.
        }
    }, [key]);

    return { signatureEnabled: preference.enabled, setSignatureEnabled };
}
