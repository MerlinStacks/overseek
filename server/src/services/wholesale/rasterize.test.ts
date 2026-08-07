import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async importOriginal => ({ ...await importOriginal<typeof import('child_process')>(), spawn: spawnMock }));

import { rasterizePdf } from './shareWorker';

describe('wholesale PDF rasterization', () => {
    beforeEach(() => spawnMock.mockReset());

    it('invokes pdftoppm without a shell at approximately 150 DPI', async () => {
        const pages = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wholesale-raster-'));
        const thumbnails = `${pages}-thumbnails`;
        await fs.promises.mkdir(thumbnails);
        let invocation = 0;
        spawnMock.mockImplementation(() => {
            const child = new EventEmitter() as any;
            child.stderr = new EventEmitter();
            child.kill = vi.fn();
            const output = invocation++ === 0 ? pages : thumbnails;
            fs.mkdirSync(output, { recursive: true });
            fs.writeFileSync(path.join(output, 'page-1.png'), 'png');
            queueMicrotask(() => child.emit('close', 0));
            return child;
        });
        await expect(rasterizePdf('/private/catalog.pdf', pages, thumbnails)).resolves.toEqual({ pageCount: 1 });
        expect(spawnMock).toHaveBeenCalledWith('pdftoppm', ['-png', '-r', '150', '/private/catalog.pdf', `${pages}/page`], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        expect(spawnMock).toHaveBeenCalledWith('pdftoppm', ['-png', '-scale-to-x', '280', '-scale-to-y', '-1', '/private/catalog.pdf', `${thumbnails}/page`], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        await Promise.all([pages, thumbnails].map(directory => fs.promises.rm(directory, { recursive: true, force: true })));
    });

    it('reports a clearly unavailable rasterizer', async () => {
        const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wholesale-raster-unavailable-'));
        spawnMock.mockImplementation(() => {
            return {
                stderr: { on: vi.fn() },
                kill: vi.fn(),
                on(event: string, callback: (value: any) => void) {
                    if (event === 'error') queueMicrotask(() => callback(new Error('ENOENT')));
                    return this;
                },
            } as any;
        });
        await expect(rasterizePdf('/private/catalog.pdf', path.join(root, 'pages'), path.join(root, 'thumbnails'))).rejects.toThrow('PDF rasterization unavailable: ENOENT');
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    it('kills a rasterizer that exceeds its deadline and cleans partial pages', async () => {
        vi.useFakeTimers();
        try {
            const pages = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wholesale-raster-timeout-'));
            const thumbnails = `${pages}-thumbnails`;
            const child = new EventEmitter() as any;
            child.stderr = new EventEmitter();
            child.kill = vi.fn();
            spawnMock.mockReturnValue(child);
            const result = rasterizePdf('/private/catalog.pdf', pages, thumbnails, Date.now() + 100);
            const rejection = expect(result).rejects.toThrow('PDF rasterization timed out');
            await vi.advanceTimersByTimeAsync(101);
            await rejection;
            expect(child.kill).toHaveBeenCalledWith('SIGKILL');
            expect(fs.existsSync(pages)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects thumbnails that do not exactly match the validated full page set', async () => {
        const pages = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wholesale-raster-pages-'));
        const thumbnails = `${pages}-thumbnails`;
        let invocation = 0;
        spawnMock.mockImplementation(() => {
            const child = new EventEmitter() as any;
            child.stderr = new EventEmitter();
            child.kill = vi.fn();
            const output = invocation++ === 0 ? pages : thumbnails;
            fs.mkdirSync(output, { recursive: true });
            fs.writeFileSync(path.join(output, 'page-1.png'), 'png');
            if (output === pages) fs.writeFileSync(path.join(output, 'page-2.png'), 'png');
            queueMicrotask(() => child.emit('close', 0));
            return child;
        });
        await expect(rasterizePdf('/private/catalog.pdf', pages, thumbnails, undefined, 2)).rejects.toThrow('does not match full pages');
        await fs.promises.rm(pages, { recursive: true, force: true });
    });
});
