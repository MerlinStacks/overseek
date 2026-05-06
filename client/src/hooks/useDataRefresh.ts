import { useState, useEffect, useRef, useCallback } from 'react';

export function useDataRefresh(fetchFn: () => Promise<void>, deps: React.DependencyList = []) {
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const [secondsAgo, setSecondsAgo] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const fetchFnRef = useRef(fetchFn);
    fetchFnRef.current = fetchFn;

    const refresh = useCallback(async () => {
        await fetchFnRef.current();
        setLastRefreshed(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            if (lastRefreshed) {
                setSecondsAgo(Math.floor((Date.now() - lastRefreshed.getTime()) / 1000));
            }
        }, 1000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [lastRefreshed]);

    return { lastRefreshed, secondsAgo, refresh };
}
