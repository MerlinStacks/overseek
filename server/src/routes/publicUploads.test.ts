import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ realpath: vi.fn(), open: vi.fn() }));
vi.mock('fs/promises', () => m);
vi.mock('../utils/uploadPaths', () => ({ getUploadsDir: () => '/private', getPublicUploadsDir: () => '/public' }));
import { publicUploadsRoutes } from './publicUploads';
afterEach(() => vi.resetAllMocks());
it('never opens invoices, incoming attachments, arbitrary files or traversal URLs', async () => {
    const app = Fastify(); await app.register(publicUploadsRoutes);
    for (const path of ['invoices/private.pdf', 'attachments/secret.png', 'secret.txt', 'email-assets/wrong/secret.png']) expect((await app.inject(`/uploads/${path}`)).statusCode).toBe(404);
    expect(m.open).not.toHaveBeenCalled(); await app.close();
});
it('rejects a public or legacy asset resolving outside its root', async () => {
    m.realpath.mockImplementation(async (file: string) => file.includes('avatar-') ? '/private/invoices/secret.png' : file);
    const app = Fastify(); await app.register(publicUploadsRoutes);
    expect((await app.inject('/uploads/avatar-123-456.png')).statusCode).toBe(404);
    expect(m.open).not.toHaveBeenCalled();
    await app.close();
});
