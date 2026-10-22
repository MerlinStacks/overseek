import type { FastifyPluginAsync } from 'fastify';
import { open, realpath } from 'fs/promises';
import path from 'path';
import { getPublicUploadsDir, getUploadsDir } from '../utils/uploadPaths';

/** Only deliberately published raster assets. Legacy fallback never exposes the
 * entire private root, and realpath containment rejects symlink escapes. */
export const publicUploadsRoutes: FastifyPluginAsync = async app => {
    const roots = [getPublicUploadsDir(), getUploadsDir()];
    app.get<{ Params: { '*': string } }>('/uploads/*', async (request, reply) => {
        const relative = request.params['*'];
        if (!/^(?:avatar-\d+-\d+\.(?:png|jpg|jpeg|gif|webp)|email-assets\/[a-f0-9]{24}\/[a-f0-9]{64}\.png)$/.test(relative)) return reply.code(404).send();
        for (const root of roots) {
            try {
                const resolvedRoot = await realpath(root), file = await realpath(path.join(root, relative));
                if (!file.startsWith(`${resolvedRoot}${path.sep}`) || file !== path.join(resolvedRoot, relative)) continue;
                const handle = await open(file, 'r');
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > 10 * 1024 * 1024) { await handle.close(); continue; }
                const ext = path.extname(file).slice(1);
                reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=3600').type(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
                return reply.send(handle.createReadStream());
            } catch { /* Missing legacy/current artifact: try next explicit root. */ }
        }
        return reply.code(404).send();
    });
};
