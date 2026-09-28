import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildWidgetScript } from './WidgetScriptBuilder';

describe('cache-safe chat business hours', () => {
    const script = buildWidgetScript({ apiUrl: 'https://overseek.test', accountId: 'store', primaryColor: '#2563eb',
        headerText: 'Chat', welcomeMessage: 'Hello', position: 'bottom-right', showOnMobile: true,
        businessTimezone: 'Australia/Sydney', businessHours: { enabled: true, days: { mon: { isOpen: true, open: '09:00', close: '17:00' } } } });
    function run(at: string) {
        class Clock extends Date { constructor() { super(at); } }
        return () => runInNewContext(script, { Date: Clock, Intl,
            window: { innerWidth: 1024 },
            document: { cookie: '_os_vid=visitor', createElement() { throw new Error('widget mounted'); } } });
    }
    it('same cached page can load chat after opening and hide it after closing', () => {
        expect(run('2026-09-27T22:00:00Z')).not.toThrow(); // Monday 08:00 Sydney
        expect(run('2026-09-27T23:00:00Z')).toThrow('widget mounted'); // Monday 09:00
        expect(run('2026-09-28T08:00:00Z')).not.toThrow(); // Monday 18:00
    });
    it('respects closed days in the configured store timezone', () => {
        expect(run('2026-09-26T23:00:00Z')).not.toThrow(); // Sunday 09:00
    });
});
