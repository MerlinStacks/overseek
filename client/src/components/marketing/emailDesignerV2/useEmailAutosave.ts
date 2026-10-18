import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EmailDesignV2Envelope } from '../../../lib/emailDesignerV2';

type Save = (html: string, design: EmailDesignV2Envelope, meta: { subject: string; previewText: string; autosave: boolean }) => void | Promise<void>;

/** One serialized save queue. Flush waits for every edit, including edits made during a request. */
export function useEmailAutosave(design: EmailDesignV2Envelope, html: string, onSave: Save, onSnapshot: (design: EmailDesignV2Envelope) => void) {
    const serialized = JSON.stringify(design);
    const latest = useRef({ design, html, onSave, onSnapshot });
    useLayoutEffect(() => { latest.current = { design, html, onSave, onSnapshot }; }, [design, html, onSave, onSnapshot]);
    const baseline = useRef(serialized);
    const inFlight = useRef<Promise<boolean> | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted = useRef(true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [savedRevision, setSavedRevision] = useState(serialized);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    const flush = useCallback((): Promise<boolean> => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (inFlight.current) return inFlight.current;

        const persist = async () => {
            if (mounted.current) { setSaving(true); setSaveError(false); }
            try {
                while (baseline.current !== JSON.stringify(latest.current.design)) {
                    const { design: next, html: nextHtml, onSave: save, onSnapshot: snapshot } = latest.current;
                    const revision = JSON.stringify(next);
                    await save(nextHtml, next, { subject: next.document.meta.title, previewText: next.document.meta.previewText || '', autosave: true });
                    baseline.current = revision;
                    if (mounted.current) {
                        try { snapshot(next); } catch { /* Local history must not fail a server save. */ }
                        setSavedRevision(revision);
                        setLastSavedAt(new Date());
                    }
                    if (!mounted.current) break;
                }
                return true;
            } catch {
                if (mounted.current) setSaveError(true);
                return false;
            } finally {
                inFlight.current = null;
                if (mounted.current) setSaving(false);
            }
        };
        // Schedule the body after assigning the promise, even for a no-op flush.
        inFlight.current = Promise.resolve().then(persist);
        return inFlight.current;
    }, []);

    useEffect(() => {
        if (serialized === baseline.current) return;
        setSaveError(false);
        timer.current = setTimeout(() => { timer.current = null; void flush(); }, 1000);
        return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    }, [serialized, flush]);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
    }, []);

    return { flush, saving, saveError, hasUnsavedChanges: serialized !== savedRevision, lastSavedAt };
}
