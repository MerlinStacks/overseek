import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEV', true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function metadata(): unknown {
    const line = vi.mocked(console.error).mock.calls[0][0] as string;
    return JSON.parse(line.slice(line.indexOf(' message ') + ' message '.length));
}

describe('client logger', () => {
    it('preserves the timestamp, level, message and ordinary metadata format', async () => {
        const { Logger } = await import('./logger');
        Logger.error('message', { count: 3 });
        expect(console.error).toHaveBeenCalledWith('[2026-10-20T12:00:00.000Z] [ERROR] message {"count":3}');
        Logger.warn('Warning');
        expect(console.warn).toHaveBeenCalledWith('[2026-10-20T12:00:00.000Z] [WARN] Warning');
    });
    it('serializes circular metadata without mutating it', async () => {
        const { Logger } = await import('./logger');
        const data: Record<string, unknown> = { name: 'record' }; data.self = data;
        expect(() => Logger.error('message', data)).not.toThrow();
        expect(metadata()).toEqual({ name: 'record', self: '[Circular]' });
        expect(data.self).toBe(data);
    });
    it('does not mistake repeated references for cycles', async () => {
        const { Logger } = await import('./logger');
        const shared = { value: 1 }; Logger.error('message', { a: shared, b: shared });
        expect(metadata()).toEqual({ a: { value: 1 }, b: { value: 1 } });
    });
    it('preserves BigInt values as decimal strings without losing precision', async () => {
        const { Logger } = await import('./logger');
        Logger.error('message', { value: BigInt('900719925474099312345') });
        expect(metadata()).toEqual({ value: '900719925474099312345' });
    });
    it('includes native error details, custom properties and chained causes', async () => {
        const { Logger } = await import('./logger');
        const cause = new Error('Original failure');
        const error = Object.assign(new TypeError('Outer failure', { cause }), { code: 'FAILED' });
        Logger.error('message', { error });
        expect(metadata()).toEqual({ error: { name: 'TypeError', message: 'Outer failure', stack: error.stack, code: 'FAILED', cause: { name: 'Error', message: cause.message, stack: cause.stack } } });
    });
    it('handles circular error causes and shared errors', async () => {
        const { Logger } = await import('./logger');
        const error = new Error('Failure'); error.cause = error;
        Logger.error('message', { error, repeated: error });
        const details = { name: 'Error', message: error.message, stack: error.stack, cause: '[Circular]' };
        expect(metadata()).toEqual({ error: details, repeated: details });
    });
    it.each(['getter', 'toJSON', 'proxy'] as const)('falls back safely when a %s throws', async kind => {
        const { Logger } = await import('./logger');
        const fail = () => { throw new Error('Serialization failed'); };
        const data = kind === 'getter' ? Object.defineProperty({}, 'bad', { enumerable: true, get: fail })
            : kind === 'toJSON' ? { toJSON: fail } : new Proxy({}, { get: fail });
        expect(() => Logger.error('message', data)).not.toThrow();
        expect(metadata()).toBe('[Unserializable metadata]');
    });
    it('retains development debug and info logging', async () => {
        const { Logger } = await import('./logger'); Logger.debug('Debug'); Logger.info('Info');
        expect(console.debug).toHaveBeenCalledOnce(); expect(console.info).toHaveBeenCalledOnce();
    });
    it('suppresses debug and info in production without evaluating metadata', async () => {
        vi.stubEnv('DEV', false);
        const { Logger } = await import('./logger');
        const getter = vi.fn(() => { throw new Error('Must not evaluate'); });
        const data = Object.defineProperty({}, 'bad', { enumerable: true, get: getter });
        Logger.debug('Debug', data); Logger.info('Info', data);
        expect(console.debug).not.toHaveBeenCalled(); expect(console.info).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
        Logger.warn('Warn'); Logger.error('Error'); expect(console.warn).toHaveBeenCalledOnce(); expect(console.error).toHaveBeenCalledOnce();
    });
});
