import { useCallback, useState, type SetStateAction } from 'react';
import type { EmailDesignV2Envelope } from '../../../lib/emailDesignerV2';

export function useDesignHistory(initialize: () => EmailDesignV2Envelope) {
    const [history, setHistory] = useState(() => ({ past: [] as EmailDesignV2Envelope[], present: initialize(), future: [] as EmailDesignV2Envelope[] }));
    const setDesign = useCallback((update: SetStateAction<EmailDesignV2Envelope>) => {
        setHistory((current) => {
            const next = typeof update === 'function' ? update(current.present) : update;
            if (JSON.stringify(next) === JSON.stringify(current.present)) return current;
            return { past: [...current.past, current.present].slice(-50), present: next, future: [] };
        });
    }, []);
    const undo = useCallback(() => setHistory((current) => current.past.length ? {
        past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future],
    } : current), []);
    const redo = useCallback(() => setHistory((current) => current.future.length ? {
        past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1),
    } : current), []);
    return { design: history.present, setDesign, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}
