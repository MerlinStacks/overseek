/**
 * Simple build script using esbuild.
 * Transpiles TypeScript to JavaScript without type checking.
 */

const esbuild = require('esbuild');

esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'dist/index.js',
    sourcemap: true,
    external: [
        // Node built-ins
        'fs', 'path', 'os', 'crypto', 'stream', 'http', 'https', 'net', 'tls', 'events', 'util', 'buffer', 'url', 'querystring', 'child_process', 'cluster', 'dns', 'readline', 'tty', 'zlib',
        // Native modules (need to stay external)
        '@prisma/client',
        'argon2',
        'bcryptjs',
        // Other heavy deps
        'pino',
        'pino-pretty',
        'bullmq',
        'ioredis',
        'socket.io',
        '@socket.io/redis-adapter',
        '@elastic/elasticsearch',
        'fastify',
        '@fastify/cors',
        '@fastify/helmet',
        '@fastify/compress',
        '@fastify/static',
        '@fastify/multipart',
        '@fastify/rate-limit',
        '@bull-board/api',
        '@bull-board/fastify',
        'pg',
        'nodemailer',
        'jsonwebtoken',
        'imapflow',
        'mailparser',
        'maxmind',
        'qrcode',
        'web-push',
        'zod',
        'marked',
        'otplib',
        'ua-parser-js',
        'google-ads-api',
        '@woocommerce/woocommerce-rest-api'
    ],
    logLevel: 'info'
}).then(() => {
    console.log('Build complete!');
}).catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
