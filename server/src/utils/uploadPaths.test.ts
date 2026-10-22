import { afterEach, expect, it, vi } from 'vitest';
import { getPublicUploadsDir, getUploadsDir } from './uploadPaths';
afterEach(() => vi.unstubAllEnvs());
it('separates publication from the legacy/private root without relocating private files', () => {
    vi.stubEnv('UPLOADS_DIR', '/fixtures/private'); vi.stubEnv('PUBLIC_UPLOADS_DIR', '/fixtures/public');
    expect(getUploadsDir()).toBe('/fixtures/private'); expect(getPublicUploadsDir()).toBe('/fixtures/public');
});
it('refuses blank/relative storage configuration and public roots containing private data', () => {
    for (const value of ['', ' ', './uploads']) { vi.stubEnv('UPLOADS_DIR', value); expect(getUploadsDir).toThrow('absolute'); }
    vi.stubEnv('UPLOADS_DIR', '/fixtures/private');
    for (const value of ['/fixtures', '/fixtures/private']) { vi.stubEnv('PUBLIC_UPLOADS_DIR', value); expect(getPublicUploadsDir).toThrow('private'); }
});
