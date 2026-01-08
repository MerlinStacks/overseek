/**
 * Prisma Configuration for Prisma ORM v7
 * 
 * Required for Prisma 7+ which uses a config file instead of .env auto-loading.
 * Database URL is now configured here instead of in schema.prisma.
 */

import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Get directory name (works in both ESM and CommonJS contexts)
const configDir = typeof import.meta !== 'undefined' && import.meta.dirname
    ? import.meta.dirname
    : __dirname;

export default defineConfig({
    earlyAccess: true,

    schema: path.join(configDir, 'schema.prisma'),

    migrate: {
        migrations: path.join(configDir, 'migrations'),
    },

    // Datasource URL for migrations and db push (read directly from env)
    datasource: {
        url: process.env.DATABASE_URL || '',
    },
});
