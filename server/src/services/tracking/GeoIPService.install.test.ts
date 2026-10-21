import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ directory: '', open: vi.fn(), close: vi.fn() }));
vi.mock('path', async importOriginal => {
    const actual = await importOriginal<typeof import('path')>();
    return { default: { ...actual, join: (...parts: string[]) => parts.length === 2 && parts[1] === '../../../data' ? m.directory : actual.join(...parts) } };
});
vi.mock('maxmind', () => ({ default: { open: m.open } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
describe('atomic GeoIP installation using isolated temporary files', () => {
    beforeEach(async () => {
        vi.resetModules(); vi.resetAllMocks();
        m.directory = await fs.mkdtemp('/tmp/opencode/geoip-safety-').catch(() => fs.mkdtemp(path.join(tmpdir(), 'overseek-geoip-safety-')));
        m.open.mockImplementation(async (file: string) => {
            const contents = await fs.readFile(file, 'utf8');
            if (contents === 'invalid') throw new Error('Invalid MMDB');
            return { metadata: { databaseType: contents === 'country-only' ? 'GeoLite2-Country' : 'GeoLite2-City', buildEpoch: new Date('2026-10-01') }, get: () => ({ country: { iso_code: 'AU' } }), close: m.close };
        });
        await fs.writeFile(path.join(m.directory, 'GeoLite2-City.mmdb'), 'original');
    });
    afterEach(async () => { await fs.rm(m.directory, { recursive: true, force: true }); });
    it('retains the active file and cleans staging files after invalid, wrong-type or truncated uploads', async () => {
        const { installManualGeoIP } = await import('./GeoIPService');
        for (const input of ['invalid', 'country-only']) {
            await expect(installManualGeoIP(Readable.from([input]))).rejects.toThrow(); expect(await fs.readFile(path.join(m.directory, 'GeoLite2-City.mmdb'), 'utf8')).toBe('original');
        }
        await expect(installManualGeoIP(Readable.from(['valid']), () => true)).rejects.toThrow('truncated'); expect(await fs.readdir(m.directory)).toEqual(['GeoLite2-City.mmdb']);
    });
    it('publishes the already-validated reader only after replacing the staged file', async () => {
        const { installManualGeoIP, getDatabaseStatus, geoipLookupSync } = await import('./GeoIPService');
        const result = await installManualGeoIP(Readable.from(['valid-city'])); expect(result.size).toBe(10); expect(await fs.readFile(path.join(m.directory, 'GeoLite2-City.mmdb'), 'utf8')).toBe('valid-city'); expect(getDatabaseStatus()).toHaveLength(1); expect(geoipLookupSync('1.2.3.4')?.country).toBe('AU');
    });
    it('serializes uploads with automatic updates and retains old data after stream errors', async () => {
        const { installManualGeoIP, updateGeoLiteDB } = await import('./GeoIPService'); const input = new PassThrough();
        const first = installManualGeoIP(input); await expect(installManualGeoIP(Readable.from(['second']))).rejects.toMatchObject({ statusCode: 409 }); expect(await updateGeoLiteDB()).toBe(false);
        input.end('valid'); await first;
        const failing = Readable.from((async function* () { yield 'partial'; throw new Error('Upload disconnected'); })());
        await expect(installManualGeoIP(failing)).rejects.toThrow('Upload disconnected'); expect(await fs.readFile(path.join(m.directory, 'GeoLite2-City.mmdb'), 'utf8')).toBe('valid'); expect(await fs.readdir(m.directory)).toEqual(['GeoLite2-City.mmdb']);
    });
});
