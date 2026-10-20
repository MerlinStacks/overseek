import { describe, expect, it, vi } from 'vitest';
const ping = vi.hoisted(() => vi.fn());
vi.mock('@elastic/elasticsearch', () => ({ Client: class { ping = ping; } }));
import { isElasticsearchAvailable } from './elastic';
describe('Elasticsearch availability probes', () => {
    it('coalesces concurrent probes and bounds the request timeout', async () => {
        let resolve!: () => void; ping.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
        const first = isElasticsearchAvailable(); const second = isElasticsearchAvailable(); expect(ping).toHaveBeenCalledOnce();
        expect(ping).toHaveBeenCalledWith({}, { requestTimeout: 5000, maxRetries: 0 }); resolve(); expect(await first).toBe(true); expect(await second).toBe(true); await isElasticsearchAvailable(); expect(ping).toHaveBeenCalledOnce();
    });
});
