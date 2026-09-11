import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    vi.stubGlobal('__APP_VERSION__', '2026.09.10');
    vi.stubGlobal('__APP_BUILD_ID__', 'current-build');
    vi.stubGlobal('__APP_BUILT_AT__', '2026-09-10T10:00:00.000Z');
});

import { usePWAUpdate } from './PWAUpdateModal';

const currentRelease = {
    version: '2026.09.10',
    buildId: 'current-build',
    builtAt: '2026-09-10T10:00:00.000Z',
};
const fetchMock = vi.fn();
let worker: EventTarget;
const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function respond(release: unknown) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => release });
}

async function activateWorker() {
    await act(async () => {
        worker.dispatchEvent(new MessageEvent('message', {
            data: { type: 'SW_UPDATED', version: 'worker-cache-timestamp' },
        }));
    });
}

describe('usePWAUpdate', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        localStorage.clear();
        worker = new EventTarget();
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
        respond(currentRelease);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker);
        else Reflect.deleteProperty(navigator, 'serviceWorker');
    });

    it('does not age an unchanged deployment into an update', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-20T12:00:00Z'));
        const { result } = renderHook(() => usePWAUpdate());
        await act(async () => {});
        expect(fetchMock).toHaveBeenCalledWith('/health/version', expect.objectContaining({ cache: 'no-store' }));
        expect(result.current.updateAvailable).toBe(false);
        expect(result.current.showModal).toBe(false);
    });

    it('does not announce an update when the worker activates on the latest page', async () => {
        localStorage.setItem('pwa-version', '2025.01.01');
        const { result } = renderHook(() => usePWAUpdate());
        await act(async () => {});
        await activateWorker();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.current.updateAvailable).toBe(false);
        expect(result.current.showModal).toBe(false);
    });

    it('detects a genuine same-day release', async () => {
        respond({ ...currentRelease, buildId: 'new-build', builtAt: '2026-09-10T11:00:00Z' });
        const { result } = renderHook(() => usePWAUpdate());
        await waitFor(() => expect(result.current.updateAvailable).toBe(true));
        expect(result.current.updateInfo.type).toBe('minor');
    });

    it.each([
        { ...currentRelease, buildId: 'old-build', builtAt: '2026-09-09T10:00:00Z' },
        { ...currentRelease, builtAt: '2026-09-11T10:00:00Z' },
        { version: '2026.12.20' },
        { buildId: 'new-build', builtAt: 'invalid' },
    ])('ignores older, identical, or unverified releases: %j', async release => {
        respond(release);
        const { result } = renderHook(() => usePWAUpdate());
        await act(async () => {});
        expect(result.current.updateAvailable).toBe(false);
    });

    it('clears a previous alert when the deployed build matches again', async () => {
        respond({ ...currentRelease, buildId: 'new-build', builtAt: '2026-11-10T10:00:00Z' });
        const { result } = renderHook(() => usePWAUpdate());
        await waitFor(() => expect(result.current.showModal).toBe(true));
        respond(currentRelease);
        await activateWorker();
        expect(result.current.updateAvailable).toBe(false);
        expect(result.current.showModal).toBe(false);
        expect(result.current.updateInfo.type).toBe('minor');
    });

    it('does not use worker activation as evidence of an update while offline', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => usePWAUpdate());
        await act(async () => {});
        await activateWorker();
        expect(result.current.updateAvailable).toBe(false);
    });
});
